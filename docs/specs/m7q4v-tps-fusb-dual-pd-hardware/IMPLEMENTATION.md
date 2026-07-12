# Implementation Status

Status: 待设计

## Completed

- 建立 `tps-fusb` topic spec 及面向维护者的硬件设计入口。
- 建立输入电源路径选择模块的独立设计与验证规范。
- 建立 `tps-sw` 与 `tps-fusb` 两份独立 MCU 使用规范，覆盖器件与封装、
  完整引脚分配、外设初始化、用途、安全默认态和注意事项。
- 记录双 FUSB302B PHY 角色、PD 3.0 Fixed + PPS 目标和 TPS55288 职责。
- 冻结输入 PMOS 选择器、SN74LVC1G3157 连接、测量策略、输出 PMOS、
  BSS138PS 双通道用途和 GPIO1/33-38 分配。
- 明确 `tps-sw` 与 `tps-fusb` 使用独立编译期 firmware profile。

## Pending Hardware Work

- 选择并校核 PMOS、VGS 钳位、gate driver 和保护器件。
- 决定两颗 FUSB302B 的 I2C bus membership、精确地址、冲突处理和 PCB 位置。
- 确认 GPIO39/40 最终用途与 `INT2` 共享设备集合。
- 完成正式原理图、网表、PCB、BOM 及制造检查。

## Pending Firmware Work

- 建立 `tps-fusb` 独立 firmware profile。
- 实现两颗 FUSB302B 驱动和 PD 3.0 Fixed + PPS sink/source 协议栈。
- 实现输入测量、DC 优先选择、break-before-make 和故障状态机。
- 实现 TPS 输出 PMOS、外部 VBUS 检测和受控反灌保护策略。

## Validation State

本轮仅验证文档链接、网络名、GPIO 唯一性和 companion 一致性。没有
`tps-fusb` 正式网表或固件可供电气、构建或 HIL 验证。
