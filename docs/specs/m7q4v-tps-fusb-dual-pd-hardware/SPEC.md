# `tps-fusb` 双 FUSB302B PD 与电源路径硬件（#m7q4v）

Status: 待实现

## Background

当前 `tps-sw` variant 使用 CH224Q 处理 USB-PD 输入、SW2303 处理
USB-C 输出协议、TPS55288 产生可调电压。下一版需要让 ESP32-S3 直接控制
输入和输出两颗 PD PHY，并在 DC5025 与 USB-PD 输入同时插入时保证只有
一路被主动导通。

`tps-fusb` 是新增 variant，不取代 `tps-sw`。当前设计网表已归档为
[`hardware/tps-fusb/netlist.enet`](../../../hardware/tps-fusb/netlist.enet)；它是
实现与硬件验证的基线，不表示 PCB、BOM、生产贴装或固件已经完成。

## Goals

- 使用两颗 FUSB302B 分别承担 USB-PD sink PHY 和 source PHY。
- 由 MCU 实现两侧 PD 3.0 Fixed + PPS 协议与策略。
- 冻结输入 PMOS 主动增强互斥、测量、TPS 输出 PMOS 和 MCU 资源合同。
- 为 `tps-sw` 与 `tps-fusb` 保留独立编译期固件 profile。

## Non-Goals

- 修改 `hardware/tps-sw/netlist.enet`、现有 `tps-sw` PCB 或 BOM。
- 实现 FUSB302B 驱动、PD 协议栈、电源状态机、ADC 或固件 profile。
- 用本 spec 改写或取代 SW2303/CH224Q 的既有规格与调试文档。
- 修改 Web UI、API、EEPROM 格式或生成视觉证据。

## Scope

In scope:

- `tps-fusb` PD PHY 角色和 TPS55288 职责边界。
- `VIN_DC` / `VIN_USB` 到 `VIN_SYS` 的 PMOS 输入选择。
- 输入有效性测量、DC 优先策略和切换时序。
- `VOUT_TPS` 到 `VBUS_TPS` 的单 PMOS 输出路径及反灌边界。
- 当前 `tps-fusb` 网表、GPIO、I2C、告警和 LED 生产数据合同。

Out of scope:

- PCB Layout、BOM、生产贴装和可生产性结论。
- 运行时 variant detection。

## Requirements

### PD and regulator

- 输入侧 FUSB302B MUST 作为 USB-PD sink PHY。
- 输出侧 FUSB302B MUST 作为 TPS USB-C 端口的 source PHY。
- 两侧 MCU 协议栈 MUST 支持 PD 3.0 Fixed + PPS。
- FUSB302B MUST 只作为 PHY 使用；MCU MUST 承担 PD protocol/policy。
- TPS55288 MUST 承担输出电压和限流控制。
- `tps-sw` 与 `tps-fusb` MUST 使用独立编译期 firmware profile。
- `U10` MUST 作为输入 PHY 连接 `SDA2/SCL2` 和 `INT2`；`U11` MUST 作为
  输出 PHY 连接 `SDA/SCL` 和 `INT`。两颗相同地址的 FUSB302B 不得进入同一
  I2C 物理总线。
- TPS55288 `U14` MUST 位于 `SDA2/SCL2`，其 `FB/INT` MUST 位于共享 `INT`。
  `INT` 服务例程 MUST 处理跨 I2C 总线的告警来源。
- FUSB302B VBUS 的正常工作电压 MUST 不超过 21 V；`VIN_DC` 的 28 V 额定
  输入不适用于 USB-PD VBUS。

### Input power selection

- `VIN_DC` 和 `VIN_USB` MUST 各通过反向安装的 PMOS 接到 `VIN_SYS`，
  PMOS drain 接输入、source 接 `VIN_SYS`，体二极管允许输入向系统冷启动。
- PMOS Gate-Source 上拉和 VGS 钳位 MUST 参考 `VIN_SYS`。
- SN74LVC1G3157 MUST 按 pin1=`B2/USB`、pin2=`GND`、pin3=`B1/DC`、
  pin4=`A/VIN_EN`、pin5=`3V3`、pin6=`S/VIN_SEL` 连接。
- SN74LVC1G3157 的 B1/B2 MUST 各有默认下拉，VCC MUST 就近使用
  `100nF` 去耦。
- `VIN_EN=0` MUST 禁止两路主动增强；`EN=1/SEL=0` MUST 只主动增强
  DC PMOS；`EN=1/SEL=1` MUST 只主动增强 USB PMOS。
- 单 PMOS 体二极管路径 MUST 被视为始终存在；未选的较高输入 MAY 被动向
  `VIN_SYS` 供电，本设计不声称输入隔离或未选输入零电流。
- 切换 MUST 先禁止两路主动增强、等待至少 5 ms、改变 SEL、再使能。

### Measurement and source policy

- 项目有效输入范围 MUST 为 9 V 至 28 V，28 V 为额定最高输入。
- `VIN_DC_SENSE` MUST 使用单颗 `200kΩ` 上臂和 `20kΩ` 下臂的 1:11
  分压，并在 ADC 节点放置 `100nF`，连接 `GPIO1/ADC1_CH0`。
- ADC MUST 使用 11 dB 衰减配置并校准 9 V 至 28 V 范围；不要求
  线性测量超过 28 V 的输入。ADC 初始化或输入连接后 MUST 等待至少
  10 ms 再将采样结果用于选源决策。
- `VIN_USB` MUST 使用输入侧 FUSB302B `MEAS_VBUS/MDAC` 比较器扫描判断；
  固件 MUST 使用 `MEAS_VBUS=1`、MDAC 阈值和 `COMP` 结果，不得用固定
  约 4 V 的 `VBUSOK` 代替 9 V 输入验证。
- 输入选择 MUST 使用测量裕量和滞回；最低有效输入 MUST 为 9 V。
- DC 有效时，固件 MUST 先把 USB 合同降到 5 V 并验证，再选择 DC。
- 仅当 DC 无效时，固件 MUST 协商并验证至少 9 V 的 USB Fixed/PPS，
  再选择 USB。

### TPS USB-C output

- `VOUT_TPS -> VBUS_TPS` MUST 使用单颗 PMOS，source 接 `VOUT_TPS`、
  drain 接 `VBUS_TPS`，Gate 网络为 `TPS_USB_C_VBUS_GATE`。
- PMOS MUST 默认关断并使用 12 V Gate-Source 钳位；关断时 MAY 允许
  `VBUS_TPS -> VOUT_TPS` 体二极管反灌。
- BSS138PS 的两个独立 NMOS 通道 MUST 分别由
  `TPS_USB_C_VBUS_EN` 和 `CE_TPS` 驱动，sources 接 GND，drains/gates
  不得互连。
- 外部 `VBUS_TPS` 存在时，固件 MUST 保持输出 PMOS 关闭且 TPS 输出
  禁用，不得主动对打外部电源。
- 反灌电压 MUST 不超过 TPS55288 VOUT 的 25 V 绝对最大值。
- 设计 MUST 遵守 TPS55288 边界：VIN 推荐最大 36 V、VIN/SW1 绝对最大
  40 V、VOUT 推荐最大 22 V、VOUT/SW2/ISP/ISN 绝对最大 25 V。
- BSS138PS 封装 pin mapping MUST 在最终器件和网表阶段复核；本 spec
  不冻结未经确认的封装编号。

### Indicator LED production data

- EDA 库中为封装、焊盘或极性而选用的 LED 替代件 MUST 被视为占位件，
  不得将其料号、颜色属性、供应商字段或 3D 模型直接作为生产 BOM 和贴装依据。
- 每个 LED 的生产料号 MUST 在下单前冻结颜色、正向电压、目标电流下的亮度/bin、
  封装、焊盘极性和可制造性。
- 用作蓝色位置的 EDA 占位 `SM1204URC` MUST 在生产数据中替换为批准的蓝色 LED；
  `SM1204URC` 本身为[红色 LED](https://www.bivar.com/parts_content/Datasheets/SM1204URC.pdf)，
  不得按其当前 EDA 颜色属性实装。
- 同型号、同颜色的低电流 LED 可以作为一个视觉组并联、共用限流电阻；该电阻
  仅限制组总电流，不承诺各 LED 均流或亮度一致。独立状态、亮度一致性或电流
  可预测性 MUST 使用独立限流或独立恒流通道。

### MCU pins and interrupts

- GPIO assignment MUST 为：GPIO1=`VIN_DC_SENSE`、GPIO33=`BTNL`、
  GPIO34=`VIN_EN`、GPIO35=`VIN_SEL`、
  GPIO36=`TPS_USB_C_VBUS_EN`、GPIO37=`CE_TPS`、GPIO38=`INT2`。
- `BTNL` MUST 为低有效输入并使用内部上拉，不得继续占用 GPIO1。
- GPIO47 MUST 驱动低有效 `LED_TPS`；firmware 接管后 MUST 先输出 High。
- `INT2` MUST 使用 3.3 V 上拉、低有效，并且只允许开漏设备共享。
- `INT2` 触发后，固件 MUST 轮询共享设备识别中断来源。
- GPIO39/40 MUST 分别作为 `SDA2/SCL2`，占用外部 PAD-JTAG。
- TPS55288 `FB/INT` 与 `INT` 相连时，firmware MUST 保持内部输出反馈模式，
  不得将其切换为外部反馈。

## Acceptance

- Given `tps-sw` 仍是当前正式硬件，when 阅读 variant 入口，then
  `tps-sw` 与 `tps-fusb` 同时列出，且分别指向独立网表。
- Given 两路输入均可能插入，when MCU 切换来源，then gate 控制只允许
  `off/DC/USB` 三种主动增强状态并要求至少 5 ms
  break-before-make；体二极管的被动导通不属于 MCU 可关闭状态。
- Given 28 V `VIN_DC` 额定最高输入，when 经过 1:11 分压，then ADC
  节点约为 2.545 V，且 GPIO1 不再分配给 `BTNL`。
- Given DC 输入有效，when 系统偏好 DC，then USB 合同先降至 5 V 并验证，
  再关闭、选择并启用 DC 路径。
- Given 外部电压出现在 `VBUS_TPS`，when 输出 PMOS 处于关断状态，then
  固件不启用 TPS 输出，且设计只接受不超过 25 V 的受控反灌。
- Given GPIO 合同，when 检查 GPIO1、33 至 38，then 每个 GPIO 只有一个
  `tps-fusb` 功能，`INT2` 仅连接开漏告警输出，GPIO47 仅为 `LED_TPS`。
- Given 当前网表已归档，when 检查仓库，then 所有入口都指向
  `hardware/tps-fusb/netlist.enet`，同时不把 PCB、BOM、生产贴装或固件描述为已完成。

## Milestones

- [x] M1: 冻结设计文档、variant 入口和 MCU 资源合同。
- [ ] M2: 完成器件选型复核、原理图与 PCB Layout 检查。
- [ ] M3: 完成 PCB、BOM、生产数据和制造检查。
- [ ] M4: 建立独立 `tps-fusb` firmware profile，完成 PD 与电源状态机。
- [ ] M5: 完成双输入、PD Fixed/PPS、反灌和异常场景硬件验证。

## Risks and Open Questions

- 需要在 PCB Layout 中验证两条 I2C 的上升时间、FUSB302B VCONN 去耦/bulk、
  CC/PD 走线、GPIO39/40 PAD-JTAG 占用和跨总线 `INT` 的服务时延。
- 最终 PMOS、VGS 钳位和 gate-driver 器件需要按电压、浪涌、热和启动
  条件选型，本文的逻辑合同不替代器件级验证。
- 单 PMOS 明确允许反灌；最终验证必须覆盖外部 VBUS 存在时 TPS 禁用和
  VOUT 节点电压边界。

## References

- [`docs/tps-fusb-input-power-path-selection.md`](../../tps-fusb-input-power-path-selection.md)
- [`docs/mcu-resource-allocation-tps-fusb.md`](../../mcu-resource-allocation-tps-fusb.md)
- [`docs/mcu-resource-allocation-tps-sw.md`](../../mcu-resource-allocation-tps-sw.md)
- [`docs/tps-fusb-hardware-design.md`](../../tps-fusb-hardware-design.md)
- [`docs/hardware-variants.md`](../../hardware-variants.md)
- [`hardware/tps-fusb/netlist.enet`](../../../hardware/tps-fusb/netlist.enet)
- [`docs/netlist/tps-fusb-checklist.md`](../../netlist/tps-fusb-checklist.md)
- [`docs/datasheets/tps55288-datasheet.md`](../../datasheets/tps55288-datasheet.md)
- [`docs/netlist/tps-sw-checklist.md`](../../netlist/tps-sw-checklist.md) (`tps-sw` only)
