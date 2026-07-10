# `tps-fusb` 硬件设计

`tps-fusb` 是与当前 `tps-sw` 并存的下一版硬件方案。本文记录原理图和
PCB 设计必须遵守的稳定接口；当前仓库尚无 `tps-fusb` 正式网表、PCB、
BOM 或固件实现。规范真相源见
[`#m7q4v`](specs/m7q4v-tps-fusb-dual-pd-hardware/SPEC.md)。

## USB-PD 架构

- 输入侧 FUSB302B 连接 USB-PD 输入口，作为 sink PHY。
- 输出侧 FUSB302B 连接 `VBUS_TPS` USB-C 口，作为 source PHY。
- 两颗 FUSB302B 都只承担 Type-C/PD PHY 功能。ESP32-S3 固件必须实现
  PD 3.0 Fixed + PPS 协议与策略，TPS55288负责输出电压和限流。
- 两颗 FUSB302B 的具体 I2C 总线、地址变体、共享设备和 PCB 位置等待
  最终 Layout 与正式网表确认。不得从当前 `tps-sw` 总线分配直接推导。

## 输入电源选择

`VIN_DC` 和 `VIN_USB` 各通过一颗反向安装的 PMOS 接到 `VIN_SYS`：PMOS
漏极接输入、源极接 `VIN_SYS`，体二极管方向为输入到 `VIN_SYS`。任一路
插入后可先通过体二极管为 3.3 V/5 V 转换器冷启动供电，再由 MCU 只导通
选中的一路。每颗 PMOS 的 Gate-Source 上拉和 VGS 钳位均以源极
`VIN_SYS` 为基准，不接到各自输入端。

SN74LVC1G3157 将单一 `PWR_INPUT_EN` 路由到两路 PMOS gate driver：

| Pin | 器件功能 | 网络 / 连接 |
| --- | --- | --- |
| 1 | `B2` | USB gate-driver enable；默认下拉 |
| 2 | `GND` | `GND` |
| 3 | `B1` | DC gate-driver enable；默认下拉 |
| 4 | `A` | `PWR_INPUT_EN` |
| 5 | `VCC` | `3V3`，就近 `100nF` 去耦 |
| 6 | `S` | `PWR_INPUT_SEL` |

控制真值如下：

| `PWR_INPUT_EN` | `PWR_INPUT_SEL` | 状态 |
| --- | --- | --- |
| 0 | X | DC、USB 两路均关闭 |
| 1 | 0 | 仅 DC 导通 |
| 1 | 1 | 仅 USB 导通 |

切换必须执行 break-before-make：先置 `PWR_INPUT_EN=0`，等待至少 5 ms，
再改变 `PWR_INPUT_SEL`，最后置 `PWR_INPUT_EN=1`。硬件不得再提供可被
MCU 同时置位的两根独立输入使能线。

## 输入测量与选源

- `VIN_DC` 通过 `3 x 100kΩ` 串联上臂和 `20kΩ` 下臂进入
  `GPIO1/ADC1_CH0`，ADC 节点对地并联 `100nF`。分压比为 1:16：24 V、
  36 V、40 V 分别约为 1.50 V、2.25 V、2.50 V。
- `VIN_USB` 使用输入侧 FUSB302B 的 `MEAS_VBUS/MDAC` 读取。离散测量的
  判定必须留出裕量并使用滞回，不能把单个阈值附近的读数当作稳定输入。
- 系统最低有效输入为 9 V。DC 有效时，固件先把 USB-PD 合同降到 5 V
  并验证，再切换到 DC；仅当 DC 无效时，才协商 USB Fixed/PPS 到至少
  9 V、验证稳定后选择 USB。
- USB 输入是备用路径，选源策略偏好 DC；该偏好不得绕过输入有效性检查
  或 break-before-make 时序。

## TPS USB-C 输出开关

`VOUT_TPS -> VBUS_TPS` 使用单颗 PMOS：源极接 `VOUT_TPS`，漏极接
`VBUS_TPS`，Gate 网络命名为 `TPS_USB_C_VBUS_GATE`。Gate-Source 默认
上拉使其关断，并配置 12 V VGS 钳位。该方向在关断时阻断
`VOUT_TPS -> VBUS_TPS`，但允许通过体二极管从 `VBUS_TPS` 反灌到
`VOUT_TPS`；本 variant 不要求双向阻断。

同一颗 BSS138PS 的两个独立 NMOS 通道分别用于：

- `GPIO37/CE_TPS`：下拉 TPS55288 `EN/UVLO` 控制节点。
- `GPIO36/TPS_USB_C_VBUS_EN`：下拉 `TPS_USB_C_VBUS_GATE`。

两个 NMOS 的源极接 GND，漏极和栅极保持彼此独立。BSS138PS 的封装引脚
编号必须以最终选定制造商的数据手册和正式网表复核，本文不冻结未经器件
确认的封装 pin mapping。

检测到外部 `VBUS_TPS` 时，固件不得主动启动 TPS 输出，必须保持输出
PMOS 关闭并禁用 TPS 输出。允许的反灌电压不得使 TPS55288 `VOUT/SW2`
超过 25 V 绝对最大值。TPS55288 设计边界为：

| 节点 | 推荐工作上限 | 绝对最大值 |
| --- | --- | --- |
| `VIN` | 36 V | 40 V（`VIN/SW1`） |
| `VOUT` | 22 V | 25 V（`VOUT/SW2/ISP/ISN`） |

绝对最大值不是可持续工作目标。TPS55288 数据手册只给出特定关断条件下的
VOUT leakage 指标，不能据此宣称支持任意外部反向供电工况。

## MCU 引脚合同

| GPIO | `tps-fusb` 网络 | 方向 / 约束 |
| --- | --- | --- |
| 1 | `VIN_DC_SENSE` / `ADC1_CH0` | 模拟输入 |
| 33 | `PWR_INPUT_EN` | 输出；总输入使能 |
| 34 | `PWR_INPUT_SEL` | 输出；0=DC，1=USB |
| 35 | `BTNL` | 输入；低有效，内部上拉 |
| 36 | `TPS_USB_C_VBUS_EN` | 输出；驱动 BSS138PS 独立通道 |
| 37 | `CE_TPS` | 输出；驱动 BSS138PS 独立通道 |
| 38 | `INT2` | 输入；3.3 V 上拉、低有效、开漏共享 |

`INT2` 只允许开漏告警输出共享。中断触发后，固件必须轮询该总线上的全部
候选设备识别来源。GPIO39/40 是否继续作为第二组 I2C SDA/SCL，以及两颗
FUSB302B 的具体总线归属，均等待正式网表确认。

## 固件边界

`tps-sw` 与 `tps-fusb` 使用两个独立编译期 firmware profile 和固件镜像。
本设计不要求运行时自动识别 variant，也不允许在 `tps-sw` 固件中假定
FUSB302B 已存在。
