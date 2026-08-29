# `tps-fusb` 网表检查清单

网表文件：[`hardware/tps-fusb/netlist.enet`](../../hardware/tps-fusb/netlist.enet)

适用硬件：`tps-fusb`（`FUSB302B x2 + TPS55288`）

本清单记录当前网表可确认的连接合同和仍待实物验证的边界。它不替代 PCB
布局审查、器件选型/BOM 审查、实物上电或 USB-PD 互操作测试。`tps-sw` 的
SW2303 网表与检查清单保持独立，见
[`tps-sw 网表排查清单`](tps-sw-checklist.md)。

## 文件完整性

- 当前归档文件的 SHA-256：
  `57003ebd01c22c00ccdacd2a8e6bbf9386a9c057b86df1573b677835aadb85db`。
- 该文件来自 `Netlist_Schematic1_1_2026-08-28.enet`，并作为 `tps-fusb`
  独立基线保存；不得覆盖 `hardware/tps-sw/netlist.enet`。
- 网表为 EasyEDA 导出数据，已可作为 JSON 解析；JSON 可解析不表示电气、
  PCB 或生产状态已经验证。

## 核心器件和协议角色

| RefDes | 器件 | 网表角色 |
| --- | --- | --- |
| `U10` | FUSB302B | USB-PD 输入端的 sink PHY |
| `U11` | FUSB302B | `VBUS_TPS` 输出端的 source PHY |
| `U14` | TPS55288 | 可编程 buck-boost 输出调节器 |
| `U19` | ESP32-S3FH4R2 | PD 协议、输入选择和电源策略 MCU |
| `U24` | SN74LVC1G3157 | 输入 PMOS 单一使能的二选一路由 |
| `U3` | TPS62933 | `3V3` 降压电源 |
| `U13` / `U17` | INA226 | I2C 电流/电压监测 |
| `U21` | M24C64 | I2C EEPROM |
| `U23` | TMP112 | I2C 温度传感器 |

两颗 FUSB302B 均是 PHY，不执行 PD 策略或电源调节。固件必须为输入 sink
和输出 source 分别实现 PD 3.0 Fixed + PPS 的协议状态机；TPS55288 只负责
输出设定点和限流。

## I2C 与告警线

| 总线/告警 | MCU 引脚 | 网表成员 | 固件要求 |
| --- | --- | --- | --- |
| `SDA/SCL` | GPIO8 / GPIO9 | `U11`、`U13` | I2C1；使用静态地址 allowlist |
| `SDA2/SCL2` | GPIO39 / GPIO40 | `U10`、`U14`、`U17`、`U21`、`U23` | I2C0；使用静态地址 allowlist |
| `INT` | GPIO7 | `U11`、`U13`、`U14 FB/INT` | 开漏共享；跨 I2C0/I2C1 服务来源 |
| `INT2` | GPIO38 | `U10`、`U17`、`U23` | 开漏共享；服务 I2C0 来源 |

- 两颗 FUSB302B 具有相同固定 I2C 地址，分置两条物理总线是必要条件。
- `U14 FB/INT` 接入 `INT`，但 `U14` 位于 I2C0。`INT` 到来后，任务上下文
  必须检查 I2C1 的 `U11/U13` 和 I2C0 的 `U14`；ISR 只负责置事件标志。
- TPS55288 必须保持内部输出反馈配置。若切换到外部反馈，`FB/INT` 不再能作为
  此共享告警线使用。
- FUSB302B 的 `VCONN` 接 `3V3`。USB-PD 的 VBUS 合同不得超过该芯片 21 V
  正常工作上限；项目 `VIN_DC` 的 28 V 额定输入不是 FUSB302B VBUS 额定值。

## 输入电源选择

- `VIN_DC` 与 `VIN_USB` 分别通过反向安装的单 PMOS 接至 `VIN_SYS`；关断时
  仍允许通过体二极管冷启动，不构成双向隔离。
- `U24` 的连接合同为：pin 1 `B2/USB gate-driver enable`、pin 2 `GND`、
  pin 3 `B1/DC gate-driver enable`、pin 4 `A/VIN_EN`、pin 5 `3V3`、
  pin 6 `S/VIN_SEL`。`B1/B2` 均需要外部默认下拉。
- GPIO34=`VIN_EN`，GPIO35=`VIN_SEL`。`VIN_EN=0` 时两路均不主动增强；
  `VIN_EN=1/VIN_SEL=0` 选择 DC；`VIN_EN=1/VIN_SEL=1` 选择 USB。
- 任何选源切换均须执行至少 5 ms break-before-make：关 `VIN_EN`、等待、
  改 `VIN_SEL`、重新确认目标有效、再开 `VIN_EN`。
- `VIN_DC_SENSE` 使用单颗 `200kOhm` 上臂、`20kOhm` 下臂和 ADC 节点
  对地 `100nF`，用于覆盖额定最高 28 V。详见
  [`tps-fusb 输入电源路径选择模块`](../tps-fusb-input-power-path-selection.md)。

## 3V3、输出和指示灯

- `U3 TPS62933` 的 `EN` 在当前网表中浮空，使 3V3 路按器件默认行为启动，
  用于 USB-C 输入的低压冷启动。`tps-sw` 的 `330kOhm/56kOhm` EN 分压不适用于
  本 variant。
- `GPIO37/CE_TPS` 和 `GPIO36/TPS_USB_C_VBUS_EN` 驱动同一颗 BSS138PS 的
  两个独立 NMOS 通道，分别控制 TPS 硬关断和 `VOUT_TPS -> VBUS_TPS` PMOS。
- 单颗输出 PMOS 在关断时允许 `VBUS_TPS -> VOUT_TPS` 体二极管反灌；外部
  VBUS 存在时固件不得主动启动 TPS 输出，并且反灌不得使 TPS55288 VOUT 超过
  25 V 绝对最大值。
- `LED_TPS` 接 ESP32-S3 GPIO47，采用低端开漏驱动，Low=吸电流点亮，
  High/Hi-Z=释放并关闭。LED 阳极侧经 `R8=2.7kOhm`、`R25=680Ohm` 接 `3V3`；
  按 `Vf=0` 的保守电阻上限，GPIO47 总灌电流约不超过 6.1mA（3.3V）或
  6.6mA（3.6V）。当前 LED 属性包含 EDA 封装占位料；生产实装必须使用
  已批准的实际 LED 料号，不能以 EDA 属性替代 BOM 选型。

## MCU 引脚合同

| GPIO | 网络 | 初始安全语义 |
| --- | --- | --- |
| GPIO1 | `VIN_DC_SENSE` | ADC 高阻输入 |
| GPIO7 | `INT` | 高阻开漏共享告警输入 |
| GPIO8 / GPIO9 | `SDA` / `SCL` | I2C1 开漏 |
| GPIO33 | `BTNL` | 低有效按键输入 |
| GPIO34 | `VIN_EN` | 推挽 Low，禁止主动增强 |
| GPIO35 | `VIN_SEL` | 推挽 Low，预选 DC |
| GPIO36 | `TPS_USB_C_VBUS_EN` | 推挽 Low，关闭输出 PMOS |
| GPIO37 | `CE_TPS` | 推挽 High，TPS 硬关闭 |
| GPIO38 | `INT2` | 高阻开漏共享告警输入 |
| GPIO39 / GPIO40 | `SDA2` / `SCL2` | I2C0 开漏 |
| GPIO47 | `LED_TPS` | 开漏释放（High/Hi-Z），关闭低有效 LED；Low=吸电流点亮 |

完整的资源所有权、外设初始化顺序、PD/I2C 时序约束与 bring-up 验收见
[`tps-fusb MCU 使用规范`](../mcu-resource-allocation-tps-fusb.md)。

## 仍待验证

- PCB 中的电源回路、散热、MOSFET SOA、VGS 钳位、去耦、I2C 上升时间和
  FUSB302B VCONN 布局。
- DC only、USB only、双输入同时存在、热插拔、掉电、合同重协商和 brownout
  时的输入选择波形；确认两路 PMOS 不会同时主动增强。
- PD 3.0 Fixed/PPS 协议栈、IRQ 延迟、I2C 恢复、异常恢复和 source/sink
  互操作性。
- 外部 `VBUS_TPS` 反灌、TPS55288 输出保护与所有生产 LED 的最终料号、极性、
  电流和光学表现。
