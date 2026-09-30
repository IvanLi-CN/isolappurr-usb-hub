# `tps-husb` 双 PD 电源路径硬件主题历史

## Lifecycle / Compatibility

- 作为从 `tps-fusb` 设计迭代的独立新版本建立；两个版本并存，旧版规格和网表保持原路径与原内容。
- `tps-husb` 的固件 profile 尚未落地，不可用旧版镜像自动推断本版硬件能力。

## Replacements / Background

- 本版将输入 PD 控制器改为 HUSB311BLA，并使用 LM74800-Q1 外部 NMOS 输入路径；这属于新增版本，而非对 `tps-fusb` 历史文件的覆盖修订。
- 来源文件为 `Netlist_Schematic1_1_2026-09-30.enet`；归档只读来源与仓库网表的 SHA-256 相同。

## Related Changes

- 本版资料入口：`docs/tps-husb-hardware-design.md`。

## References

- `./SPEC.md`
- `./IMPLEMENTATION.md`
