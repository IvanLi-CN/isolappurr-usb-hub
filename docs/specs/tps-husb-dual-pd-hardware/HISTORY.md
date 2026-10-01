# `tps-husb` 双 PD 电源路径硬件主题历史

## Lifecycle / Compatibility

- 作为从 `tps-fusb` 设计迭代的独立新版本建立；两个版本并存，旧版规格和网表保持原路径与原内容。
- `tps-husb` 的固件 profile 尚未落地，不可用旧版镜像自动推断本版硬件能力。

## Replacements / Background

- 本版将输入 PD 控制器改为 HUSB311BLA，并使用 LM74800-Q1 外部 NMOS 输入路径；这属于新增版本，而非对 `tps-fusb` 历史文件的覆盖修订。
- 来源文件为 `Netlist_Schematic1_1_2026-09-30.enet`；保存的来源网表与仓库网表 SHA-256 相同。

## Related Changes

- 本版资料入口：`docs/tps-husb-hardware-design.md`。
- `PCB1_1` 网表与 Gerber 制造文件已按原始字节保存在 `hardware/tps-husb/manufacturing/2026-09-30/`；该目录记录网表与 Gerber 哈希，不取代可编辑设计源。

## References

- `./SPEC.md`
- `./IMPLEMENTATION.md`
