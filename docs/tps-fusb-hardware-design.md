# `tps-fusb` 硬件设计

`tps-fusb` 是与当前 `tps-sw` 并存的下一版硬件方案。当前设计网表为
[`hardware/tps-fusb/netlist.enet`](../hardware/tps-fusb/netlist.enet)，与
`hardware/tps-sw/netlist.enet` 独立维护。该网表是设计基线，不代表 PCB、
BOM、生产贴装或固件实现已经验证。规范真相源见
[`#m7q4v`](specs/m7q4v-tps-fusb-dual-pd-hardware/SPEC.md)。

## USB-PD 架构

- 输入侧 FUSB302B 连接 USB-PD 输入口，作为 sink PHY。
- 输出侧 FUSB302B 连接 `VBUS_TPS` USB-C 口，作为 source PHY。
- 两颗 FUSB302B 都只承担 Type-C/PD PHY 功能。ESP32-S3 固件必须实现
  PD 3.0 Fixed + PPS 协议与策略，TPS55288负责输出电压和限流。
- 当前网表将两颗 FUSB302B 分到不同 I2C 总线，隔离相同地址的 PHY：

| 器件 | 角色 | I2C | 告警线 |
| --- | --- | --- | --- |
| `U10` | USB-PD 输入 sink PHY | `SDA2/SCL2`，GPIO39/GPIO40 | `INT2`，GPIO38 |
| `U11` | TPS USB-C 输出 source PHY | `SDA/SCL`，GPIO8/GPIO9 | `INT`，GPIO7 |
| `U14` | TPS55288 输出调节器 | `SDA2/SCL2`，GPIO39/GPIO40 | `FB/INT -> INT`，GPIO7 |

`INT` 因此跨两条 I2C 总线。中断服务只能置事件标志；任务上下文必须检查
`SDA/SCL` 上的 `U11/U13`，以及 `SDA2/SCL2` 上的 `U14`。`INT2` 的候选
来源为 `U10/U17/U23`。

## 输入电源选择

该功能是独立模块，完整拓扑、控制真值、测量、选源状态机、故障处理和
bring-up 要求见
[`docs/tps-fusb-input-power-path-selection.md`](tps-fusb-input-power-path-selection.md)。
项目有效输入范围为 9 V 至 28 V，28 V 为额定最高输入。

总体合同：两颗单 PMOS 允许输入通过体二极管冷启动；MCU 通过
`VIN_EN/VIN_SEL` 和 SN74LVC1G3157 只互锁主动增强，切换使用
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

## 状态指示 LED 与 EDA 元件占位

正在评审的 `tps-fusb` EDA 原理图中，部分 LED 元件仅为满足封装、焊盘和
极性表达而选用的库内替代件。其 `Manufacturer Part`、颜色属性、供应商料号、
3D 模型和自动生成的 BOM 字段均不是生产实装依据。

- EDA 占位件可以保留正确的封装、pad 编号和 A/K 极性，但生产 BOM 和贴装数据
  MUST 在下单前将每个 LED 替换为已经批准的实际料号。
- 实装选择 MUST 同时确认颜色、正向电压范围、目标电流下的亮度/bin、封装尺寸、
  焊盘极性和可制造性；不得仅因 EDA 库名称含有 `-R`、`-B` 或颜色属性便视为
  已完成选型。
- `SM1204URC` 在当前 EDA 中仅是可用封装的临时替代件。该料号本身是
  [红色 LED](https://www.bivar.com/parts_content/Datasheets/SM1204URC.pdf)，不得用于
  需要蓝色 LED 的实装位；实际贴装必须替换为已批准的蓝色料号。
- 同一低电流指示组内的同型号、同颜色 LED 可以按视觉需求并联并共用一个限流
  电阻。该取舍只限制组总电流，不保证每颗 LED 的亮度严格一致；若需要一致亮度、
  可预测电流或独立控制，必须改为每颗 LED 独立限流或独立恒流通道。
- `LED_TPS` 仅能使其连接的所有 LED 同步点亮或熄灭。两组需要独立状态时，必须
  在正式原理图中拆分为独立控制网络和 MCU/驱动资源。

当前网表将 `LED_TPS` 接至 U19 package pin 37，即 ESP32-S3 的 `GPIO47`。
该网络为低有效：启动时固件必须尽早将 GPIO47 配置为推挽输出 High，以保持
LED 关闭；驱动 Low 时连接到该网络的视觉组同步点亮。

在所有实装 LED 料号冻结前，不得将当前 EDA 元件属性用于采购、自动贴装或
光学验收结论。

## MCU 资源合同

完整、独立的 `tps-fusb` MCU 使用规范入口见
[`docs/mcu-resource-allocation-tps-fusb.md`](mcu-resource-allocation-tps-fusb.md)。

| GPIO | `tps-fusb` 网络 | 方向 / 约束 |
| --- | --- | --- |
| 1 | `VIN_DC_SENSE` / `ADC1_CH0` | 模拟输入 |
| 33 | `BTNL` | 输入；低有效，内部上拉 |
| 34 | `VIN_EN` | 输出；总输入使能 |
| 35 | `VIN_SEL` | 输出；0=DC，1=USB |
| 36 | `TPS_USB_C_VBUS_EN` | 输出；驱动 BSS138PS 独立通道 |
| 37 | `CE_TPS` | 输出；驱动 BSS138PS 独立通道 |
| 38 | `INT2` | 输入；3.3 V 上拉、低有效、开漏共享 |
| 47 | `LED_TPS` | 输出；低有效的同步 LED 组控制 |

`INT` 与 `INT2` 只允许开漏告警输出共享。中断触发后，固件必须轮询对应总线
上的全部候选设备识别来源；`INT` 还必须服务其跨总线的 TPS55288 来源。

## 固件边界

`tps-sw` 与 `tps-fusb` 使用两个独立编译期 firmware profile 和固件镜像。
本设计不要求运行时自动识别 variant，也不允许在 `tps-sw` 固件中假定
FUSB302B 已存在。
