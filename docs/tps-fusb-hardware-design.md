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
- 两颗 FUSB302B 的具体 I2C 总线、精确地址、冲突处理、共享设备和 PCB 位置等待
  最终 Layout 与正式网表确认。不得从当前 `tps-sw` 总线分配直接推导。

## 输入电源选择

该功能是独立模块，完整拓扑、控制真值、测量、选源状态机、故障处理和
bring-up 要求见
[`docs/tps-fusb-input-power-path-selection.md`](tps-fusb-input-power-path-selection.md)。

总体合同：两颗单 PMOS 允许输入通过体二极管冷启动；MCU 通过
`PWR_INPUT_EN/PWR_INPUT_SEL` 和 SN74LVC1G3157 只互锁主动增强，切换使用
至少 5 ms break-before-make，并在有效输入中优先选择 DC。

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

## MCU 资源合同

完整、独立的 `tps-fusb` MCU 使用规范入口见
[`docs/mcu-resource-allocation-tps-fusb.md`](mcu-resource-allocation-tps-fusb.md)。

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
FUSB302B 的具体总线归属、精确 7-bit 地址与冲突处理，均等待正式网表确认。

## 固件边界

`tps-sw` 与 `tps-fusb` 使用两个独立编译期 firmware profile 和固件镜像。
本设计不要求运行时自动识别 variant，也不允许在 `tps-sw` 固件中假定
FUSB302B 已存在。
