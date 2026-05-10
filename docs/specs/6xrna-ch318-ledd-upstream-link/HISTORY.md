# CH318T LEDD 上游链路指示与启动恢复历史（#6xrna）

## 演进记录

- 2026-01-28：legacy plan 创建，目标为读取 `GPIO6/LEDD` 并对外提供 Hub 上游状态。
- 2026-01-28：固件与 Web UI 初步接入 `hub.upstream_connected`。
- 2026-01-29：legacy plan 停在实机验收中，M3 未完成。
- 2026-05-10：迁移到 canonical spec；新增 active-low 积分采样和默认关闭的 `GPIO36/PU_CE` 上电恢复开关。不迁移 EEPROM 需求。

## 关键决策

- `LEDD` 只作为 active-low 状态源使用，不承诺 USB 枚举完成、速率或协议细节。
- 上电恢复动作使用编译期常量控制，默认关闭，避免未验证前改变每次启动的 USB 行为。
- EEPROM 持久化配置明确排除在本轮实现之外。

## Legacy Source

- `docs/plan/6xrna:ch318-ledd-raw-signal/PLAN.md` 保留等待删除确认。
