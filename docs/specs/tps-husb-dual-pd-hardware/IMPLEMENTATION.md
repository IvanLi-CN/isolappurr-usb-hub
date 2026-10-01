# `tps-husb` 双 PD 电源路径硬件实现状态

> 规范以 `./SPEC.md` 为准；本文记录当前可验证的落地范围。

## Current Status

- Implementation: 网表与 Gerber 投产快照已归档（由用户确认已投产）；独立固件、BOM 和实物验证记录仍需分别跟踪。
- Lifecycle: active
- Catalog note: 独立新增版本，不替代 `tps-fusb` 或 `tps-sw`。

## Implementation Coverage

- `REQ-HUSB-001`: `hardware/tps-husb/netlist.enet` 与本版文档和目录索引；源文件 SHA-256 为 `4dbb26d6a1d2dcb6d5ce968be72b4398958bac0b4d9f2919fa8c7dfe0e94ff2a`。
- `REQ-HUSB-002`: 本版网表与 `docs/tps-husb-hardware-design.md` 描述 U10/U11/U14 分工及保留的 R28/R30。
- `REQ-HUSB-003`: `docs/tps-husb-input-power-path-selection.md` 记录 DC/USB 拓扑和 `DC_CE` 极性。
- `REQ-HUSB-004`: `docs/mcu-resource-allocation-tps-husb.md` 与 `docs/netlist/tps-husb-checklist.md` 记录 RN4 默认态和 GPIO/I2C 归属。
- `REQ-HUSB-005`: `hardware/tps-husb/manufacturing/2026-09-30/` 保存用户提供的网表与 Gerber ZIP 原始字节；`MANIFEST.md` 记录 SHA-256、来源关系和导出物边界。

## Verification Commands

- `shasum -a 256 hardware/tps-husb/netlist.enet`（与上文来源 SHA-256 比对）
- `shasum -a 256 hardware/tps-husb/manufacturing/2026-09-30/*`
- `cmp hardware/tps-husb/netlist.enet hardware/tps-husb/manufacturing/2026-09-30/Netlist_Schematic1_1_2026-09-30.enet`
- `unzip -t hardware/tps-husb/manufacturing/2026-09-30/Gerber_PCB1_1_2026-09-30.zip`
- `python3 .github/scripts/test_tps_husb_power_contract.py`
- 旧版专属文件相对远程主干无差异：

  ```sh
  git fetch origin
  git diff --exit-code origin/main -- \
    hardware/tps-sw hardware/tps-fusb \
    ':(glob)docs/**/*tps-sw*' ':(glob)docs/**/*tps-fusb*' \
    ':(glob)docs/**/*tps-sw*/**' ':(glob)docs/**/*tps-fusb*/**'
  test -z "$(git ls-files --others --exclude-standard -- \
    hardware/tps-sw hardware/tps-fusb \
    ':(glob)docs/**/*tps-sw*' ':(glob)docs/**/*tps-fusb*' \
    ':(glob)docs/**/*tps-sw*/**' ':(glob)docs/**/*tps-fusb*/**')"
  ```

## Remaining Gaps

- 未归档可编辑 PCB 源文件、生产 BOM 或贴装文件；Gerber 是制造导出物。
- 独立固件 profile、冷启动、双输入、10 A 热设计、30 V 极限及 USB-PD 合同的实物验证状态未由本次材料证明。

## Related Changes

- `./SPEC.md`
- `./HISTORY.md`
