# CH318T LEDD 上游链路指示与启动恢复实现（#6xrna）

## 当前实现状态

- 固件已将 `GPIO6/LEDD` 配置为无内部上下拉的高阻输入，并通过 `hub.upstream_connected` 对外暴露稳定状态。
- LEDD 稳定化使用 active-low 饱和积分器：分数范围 `0..32`，低电平加分，高电平减分，`>=24` 输出 connected，`<=8` 输出 disconnected。
- 固件已接管 `GPIO36/PU_CE`，默认以低电平保持上游 `U18(CH442E)` 连通。
- `UPSTREAM_BOOT_RECOVERY_ENABLED` 默认关闭；启用时启动期将 `PU_CE` 拉高 `2000ms` 后拉低，用于触发 CH318T 上游 USB 信号重新连接。

## Coverage / Rollout

- 默认固件行为不改变上游 USB 启动连通状态。
- HTTP API 字段保持兼容：`GET /api/v1/ports` 仍返回 `hub.upstream_connected`。
- 实机 flash 与 2 秒恢复效果仍需 owner-confirmed 串口后验证。

## Remaining Gaps

- 需要实机确认 `UPSTREAM_BOOT_RECOVERY_DISCONNECT_MS=2000` 是否足够恢复 CH318T 通信。
- 需要实机观察 LEDD 在异常链路、恢复链路、正常链路中的电平/占空比，以决定是否调整积分阈值。
