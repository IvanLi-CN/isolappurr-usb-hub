# `tps-husb` 双 PD 电源路径硬件

> 本文件定义独立硬件版本的长期合同；归档和验证进度见 `IMPLEMENTATION.md`。

## Context and Scope

- Context: 在保留 `tps-fusb` 和 `tps-sw` 既有设计的前提下，建立由 HUSB311BLA 输入 TCPC、FUSB302B 输出 PHY 及双输入 NMOS 电源路径组成的新版本。
- In scope: `tps-husb` 独立网表、输入电源路径、复位默认态、MCU/PD 资源合同和设计资料归属。
- Out of scope: 修改任何旧版设计基线、宣称 PCB/BOM/固件已验证、无硬件条件的 10 A 或 30 V 工作保证。

## Terms and Interfaces

- `tps-husb`: 从 `tps-fusb` 迭代而来的新硬件版本，不是旧版的别名或覆盖更新。
- 网表入口：`hardware/tps-husb/netlist.enet`；旧版各有独立网表。
- `DC_CE`: MCU GPIO35，High 禁止 DC 受控路径，Low 或高阻允许 U20 按自身条件工作。
- `PDIN`: USB 输入 VBUS；`VSYS`: 两路输入汇合的系统供电网络。

## Requirements

### REQ-HUSB-001

- 新版本 MUST 使用独立的 `hardware/tps-husb/` 和 `docs/tps-husb-*` 资料归属；交付新版本时 MUST NOT 覆盖或改名 `tps-fusb`、`tps-sw` 的网表及专属文档。
- 输入是本版 EasyEDA 导出网表；输出是可追溯、可解析且与来源字节一致的独立文件。

### REQ-HUSB-002

- 输入 PD 角色 MUST 由 U10 HUSB311BLA sink TCPC 承担；输出 PD 角色 MUST 由 U11 FUSB302B source PHY 承担。二者使用各自的总线和驱动合同，且都不应被视为 VBUS 电源开关。
- U14 TPS55288 MUST 保持本版网表中的 R28=200 kΩ、R30=36 kΩ 配置。

### REQ-HUSB-003

- DC 路 MUST 保持 U20 LM74800-Q1 + Q2/Q3 双 NMOS；USB 路 MUST 保持 U25 LM74800-Q1 + Q10 单 NMOS 理想二极管。USB 路的反向阻断不得被表述为可正向硬关断。
- GPIO35=`DC_CE` High MUST 表示关闭 DC；Low/高阻 MUST 保留按 U20 UVLO/OV 自动工作的可能性。固件在 USB 供电未确认前 MUST NOT 将其置 High。

### REQ-HUSB-004

- 复位默认态 MUST 由 RN4 的 100 kΩ、1% 电阻网络提供：`DC_CE` 和 `TPS_USB_C_VBUS_EN` 下拉至 GND，`CE_TPS` 上拉至 `3V3`。
- MCU 资源合同 MUST 将 U10 放在 `SDA2/SCL2` 与 `INT2`，U11 放在 `SDA/SCL` 与 `INT`，并为新版本独立的固件 profile 预留上述语义。

### REQ-HUSB-005

- 已投产硬件的网表与制造导出物 MUST 以独立、不可覆盖的快照保存；清单 MUST 绑定文件 SHA-256，并区分可编辑设计源与制造导出物。
- 后续硬件修订 MUST 使用新的快照目录，不得替换 `tps-husb` 的既有投产材料，也不得修改 `tps-fusb` 或 `tps-sw` 的资料。

## Verification

### VER-HUSB-001

- Method: 文件路径、JSON 解析、源文件 `cmp`/SHA-256、版本目录差异审查。
- covers: `REQ-HUSB-001`
- Pass condition: 只新增本版资料；网表与来源字节一致；旧版专属文件相对原基线无差异。

### VER-HUSB-002

- Method: 解析网表的器件料号、引脚网络和电阻值，并对照本版设计文档。
- covers: `REQ-HUSB-002`, `REQ-HUSB-003`, `REQ-HUSB-004`
- Pass condition: U10/U11、U14、U20/U25、Q2/Q3/Q10、RN4、GPIO35 与文档逐项一致；固件接管和断电边界可在 bring-up 中复验。

### VER-HUSB-003

- Method: 对照投产快照清单中的来源 SHA-256，检查归档 ZIP 完整性，并确认快照网表与本版设计网表字节一致。
- covers: `REQ-HUSB-005`
- Pass condition: 文件哈希匹配、ZIP 完整性检查通过、既有设计基线及其他硬件 variant 未被覆盖。

## Related ADRs

None

## References

- `./IMPLEMENTATION.md`
- `./HISTORY.md`
