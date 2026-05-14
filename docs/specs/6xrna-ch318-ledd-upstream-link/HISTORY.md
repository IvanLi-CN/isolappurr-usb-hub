# CH318T 隔离侧 USB 状态指示历史（#6xrna）

## 演进记录

- 2026-01-28：legacy plan 创建，目标为读取 `GPIO6/LEDD` 并对外提供 Hub 上游状态。
- 2026-01-28：固件与 Web UI 初步接入 `hub.upstream_connected`。
- 2026-01-29：legacy plan 停在实机验收中，M3 未完成。
- 2026-05-10：迁移到 canonical spec；新增 active-low 积分采样和默认关闭的 `GPIO36/PU_CE` 上电恢复开关。不迁移 EEPROM 需求。
- 2026-05-11：根据硬件改版移除固件对 `GPIO36/PU_CE` 的接管；CH318T 数据手册未定义 `LED/MODE` PWM 语义，固件将 LEDD 简化为每秒 active-low 普通 GPIO 采样。
- 2026-05-14：新增 `UP0_PG/GPIO18` 隔离侧下行端口连接采样；将 `LEDD/GPIO6` 对外语义明确为隔离侧 USB ready，并保留 `hub.upstream_connected` 作为兼容别名。

## 关键决策

- `LEDD` 只作为 active-low 状态源使用，不承诺 USB 枚举完成、速率或协议细节。
- `UP0_PG` 只作为 active-low 隔离侧下行端口连接状态源使用。
- `hub.upstream_connected` 保留为兼容字段，值等于 `hub.isolated_usb_ready`。
- 新硬件已移除上游 CH442E 通断控制，固件不再驱动 `GPIO36/PU_CE`。
- EEPROM 持久化配置明确排除在本轮实现之外。

## Legacy Source

- `docs/plan/6xrna:ch318-ledd-raw-signal/PLAN.md` 保留等待删除确认。
