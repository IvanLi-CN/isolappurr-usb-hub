# `tps-husb` 双 PD 电源路径硬件实现状态

> 规范以 `./SPEC.md` 为准；本文记录当前可验证的落地范围。

## Current Status

- Implementation: 设计网表与资料基线已建立；PCB、BOM、固件与实物验证未完成。
- Lifecycle: active
- Catalog note: 独立新增版本，不替代 `tps-fusb` 或 `tps-sw`。

## Implementation Coverage

- `REQ-HUSB-001`: `hardware/tps-husb/netlist.enet` 与本版文档和目录索引；源文件 SHA-256 为 `4dbb26d6a1d2dcb6d5ce968be72b4398958bac0b4d9f2919fa8c7dfe0e94ff2a`。
- `REQ-HUSB-002`: 本版网表与 `docs/tps-husb-hardware-design.md` 描述 U10/U11/U14 分工及保留的 R28/R30。
- `REQ-HUSB-003`: `docs/tps-husb-input-power-path-selection.md` 记录 DC/USB 拓扑和 `DC_CE` 极性。
- `REQ-HUSB-004`: `docs/mcu-resource-allocation-tps-husb.md` 与 `docs/netlist/tps-husb-checklist.md` 记录 RN4 默认态和 GPIO/I2C 归属。

## Verification Commands

- `shasum -a 256 hardware/tps-husb/netlist.enet`（与上文来源 SHA-256 比对）
- `python3 .github/scripts/test_tps_husb_power_contract.py`
- `git diff main -- hardware/tps-fusb hardware/tps-sw docs/tps-fusb-hardware-design.md docs/tps-fusb-input-power-path-selection.md docs/mcu-resource-allocation-tps-fusb.md docs/netlist/tps-fusb-checklist.md`

## Remaining Gaps

- 尚无与本版对应的 PCB、生产 BOM、贴装文件或独立固件 profile。
- 冷启动、双输入、10 A 热设计、30 V 极限及 USB-PD 合同需通过实物验证。

## Related Changes

- `./SPEC.md`
- `./HISTORY.md`
