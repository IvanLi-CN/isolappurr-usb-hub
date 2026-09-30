# `tps-husb` MCU 使用规范

本文件仅约束 [tps-husb 网表](../hardware/tps-husb/netlist.enet) 的固件
profile。`tps-fusb`、`tps-sw` 保持各自独立的资源合同；目前没有将此
profile 视为已实现固件。

| MCU GPIO | 网络 | 初始状态及所有者 |
| --- | --- | --- |
| 1 | `VIN_DC_SENSE` | ADC 高阻输入；R3=200 kΩ/R13=20 kΩ 分压 |
| 7 | `INT` | 高阻共享告警；U11/U13/U14 来源 |
| 8/9 | `SDA/SCL` | I2C1；U11 FUSB302B、U13 INA226 |
| 34 | NC | 不分配 |
| 35 | `DC_CE` | 先置 Low 锁存再启用输出；High 关闭 DC |
| 36 | `TPS_USB_C_VBUS_EN` | 初始 Low；控制输出 VBUS gate |
| 37 | `CE_TPS` | 初始 High；控制 TPS55288 使能下拉 |
| 38 | `INT2` | 高阻共享告警；U10/U17/U23 来源 |
| 39/40 | `SDA2/SCL2` | I2C0；U10 HUSB311BLA、U14 TPS55288、U17/U21/U23 |
| 47 | `LED_TPS` | 开漏释放为关，Low 吸电流点亮 |

`RN4` 在 MCU 复位/高阻时将 GPIO35、GPIO36 对应网络下拉，并将
`CE_TPS` 上拉到 `3V3`。这些是板级默认偏置，不依赖固件先运行；
但 3V3 尚未建立或掉电过程中的动态行为仍需实测。GPIO35 High 不代表
“选择 USB”，只表示禁止 DC；USB 路本身不具备正向硬断开功能。

启动时先配置输出锁存为上述安全态，再接管 GPIO；随后初始化 ADC、
两条 I2C 和共享中断。`INT` 服务范围跨两条 I2C 总线，ISR 只标记待服务，
任务上下文检查 U11/U13 与 U14；`INT2` 则检查 U10/U17/U23。
U10 HUSB311BLA 与 U11 FUSB302B 的寄存器和驱动合同不同，不得沿用
原双 FUSB302B 输入驱动。输入状态机仅在 USB 已确认能承载系统电源时
允许将 `DC_CE` 置 High；DC-only、复位和 USB 掉电时保持 Low。

调试接口 U15 的 1–5 脚依次为 `GND/U0TX/U0RX/BOOT0/CHIP_EN`；
6、7 脚为接地安装脚。U14 TPS55288 的 R28/R30 数值保持网表原样，
不属于本次固件资源变更。
