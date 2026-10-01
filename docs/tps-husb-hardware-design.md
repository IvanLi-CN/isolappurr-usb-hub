# `tps-husb` 硬件设计

`tps-husb` 是从 `tps-fusb` 继续设计的独立新版本，不替换或重命名旧版。
本版网表基线是 [`hardware/tps-husb/netlist.enet`](../hardware/tps-husb/netlist.enet)；
长期约束见 [tps-husb 规格](specs/tps-husb-dual-pd-hardware/SPEC.md)，
逐项连线见 [网表检查清单](netlist/tps-husb-checklist.md)。对应的网表和 Gerber
制造文件保存在 [`hardware/tps-husb/manufacturing/2026-09-30/`](../hardware/tps-husb/manufacturing/2026-09-30/MANIFEST.md)。
Gerber 是制造导出物，不是可编辑 PCB 源文件；保存的网表与本版网表基线逐字节
一致。后续硬件修订必须使用独立版本目录，不覆盖现有文件。

## 电源与 PD 架构

| 功能 | 本版器件与网络 |
| --- | --- |
| DC 输入 | `DCIN -> Q2 -> DCVS -> Q3 -> VSYS`；U20 LM74800-Q1 控制双 NMOS |
| USB 输入 | `PDIN -> Q10 -> VSYS`；U25 LM74800-Q1 控制单 NMOS 理想二极管 |
| USB-C 输入协商 | U10 HUSB311BLA，sink TCPC，`SDA2/SCL2`，`INT2` |
| USB-C 输出协商 | U11 FUSB302B，source PHY，`SDA/SCL`，`INT` |
| 输出调节 | U14 TPS55288，从 `VSYS` 生成 `VOUT_TPS`；Q6 控制 `VBUS_TPS` |

设计目标为 DC 6–28 V、USB 5–28 V、输入路径 10 A；30 V 是极限检查点，
不是已验收的连续工作点。U10 是 PD 控制器而非电源开关。U25/Q10 的单管
连接提供反向电流阻断，但正向体二极管仍允许 `PDIN -> VSYS`，所以 USB
路径不能靠 U25 硬切断。USB Source 降合同或移除 VBUS 由 U10 与固件协商，
实际断电时序和异常行为仍需实测。详见 [输入电源路径](tps-husb-input-power-path-selection.md)。

## 复位默认态

- GPIO35=`DC_CE` 为**高电平关闭 DC**：Q5 导通后拉低 U20 `EN/UVLO`。
  `RN4` 内的一只 100 kΩ、1% 电阻将 `DC_CE` 下拉至 GND，因此 MCU 高阻时
  默认允许 DC 路按 U20 的 UVLO/OV 条件启动。
- `RN4` 还将 `TPS_USB_C_VBUS_EN` 下拉、将 `CE_TPS` 上拉到 `3V3`；
  GPIO35 接管时先装载 Low 再切为输出；
  USB 未确认可持续供电时不可置 High。
- DC 和 USB 同时输入时，本连接不是强制互斥的二选一开关；由两路理想
  二极管特性和电压决定实际承载。`DC_CE` 只能禁止 DC 路。

TPS55288 的 `R28=200 kΩ`、`R30=36 kΩ` 属于本版已指定保留的现有配置；
本次文件整理不修改这组器件。`U15` 为 5 位调试接口，信号是
`GND/U0TX/U0RX/BOOT0/CHIP_EN`，另有两个接地安装脚。固件资源和
上电顺序见 [MCU 使用规范](mcu-resource-allocation-tps-husb.md)。

## 验证边界

当前资料未包含 MOSFET SOA 与散热、30 V 极限、两路反灌电流、
DC-only/USB-only/双输入冷启动和热插拔波形、USB-PD 合同与异常恢复的
实测结果。后续验证结果应关联到对应的网表与 Gerber 文件版本；不得把旧版
实测或资料视为本版验证证据。
