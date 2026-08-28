# Implementation Status

Status: 待实现

## Completed

- 建立 `tps-fusb` topic spec 及面向维护者的硬件设计入口。
- 建立输入电源路径选择模块的独立设计与验证规范。
- 建立 `tps-sw` 与 `tps-fusb` 两份独立 MCU 使用规范，覆盖器件与封装、
  完整引脚分配、外设初始化、用途、安全默认态和注意事项。
- 记录双 FUSB302B PHY 角色、PD 3.0 Fixed + PPS 目标和 TPS55288 职责。
- 冻结输入 PMOS 选择器、SN74LVC1G3157 连接、测量策略、输出 PMOS、
  BSS138PS 双通道用途和 GPIO1/33-38 分配。
- 明确 `tps-sw` 与 `tps-fusb` 使用独立编译期 firmware profile。
- 导入独立 `hardware/tps-fusb/netlist.enet`，未覆盖 `hardware/tps-sw/netlist.enet`。
- 按当前网表冻结 U19=`ESP32-S3FH4R2`、GPIO33=`BTNL`、GPIO34=`VIN_EN`、
  GPIO35=`VIN_SEL`、GPIO47=`LED_TPS`，以及 `SDA/SCL`、`SDA2/SCL2` 与
  `INT`/`INT2` 的设备成员。

## Pending Hardware Work

- 选择并校核 PMOS、VGS 钳位、gate driver 和保护器件。
- 完成 PCB Layout、CC/PD、I2C、VCONN 去耦/bulk、gate 与热设计检查。
- 冻结生产 BOM 和贴装数据，特别是替换 LED EDA 占位料为正确的实装料号。
- 完成制造检查和硬件 bring-up。

## Pending Firmware Work

- 建立 `tps-fusb` 独立 firmware profile。
- 实现两颗 FUSB302B 驱动和 PD 3.0 Fixed + PPS sink/source 协议栈。
- 实现输入测量、DC 优先选择、break-before-make 和故障状态机。
- 实现 TPS 输出 PMOS、外部 VBUS 检测和受控反灌保护策略。

## Validation State

本轮已验证导入网表可解析、SHA-256 与来源文件一致，并同步检查文档链接、
网络名和 GPIO 合同。尚未完成 PCB、BOM、生产贴装、固件构建、电气或 HIL 验证。
