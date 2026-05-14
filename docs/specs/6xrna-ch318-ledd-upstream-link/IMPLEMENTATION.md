# CH318T 隔离侧 USB 状态指示实现（#6xrna）

## 当前实现状态

- 固件已将 `GPIO6/LEDD` 配置为无内部上下拉的高阻输入，并通过 `hub.upstream_connected` 对外暴露状态。
- 固件已将 `GPIO18/UP0_PG` 配置为无内部上下拉的高阻输入，并通过 `hub.isolated_downstream_connected` 对外暴露隔离侧 USB 下行端口连接状态。
- LEDD 采样使用 active-low 普通 GPIO 读取，采样周期为 `1000ms`。
- UP0_PG 采样使用 active-low 普通 GPIO 读取，采样周期为 `1000ms`。
- `hub.isolated_usb_ready` 与兼容字段 `hub.upstream_connected` 均来自 `GPIO6/LEDD`。
- 固件只在采样结果变化时输出调试日志。
- 固件不再初始化或驱动 `GPIO36/PU_CE`；新硬件已移除上游 CH442E 通断控制，USB 信号由硬件直接连接。

## Coverage / Rollout

- HTTP API 字段保持兼容：`GET /api/v1/ports` 仍返回 `hub.upstream_connected`。
- HTTP API 与 USB JSONL `ports.get` 新增 `hub.isolated_downstream_connected` 与 `hub.isolated_usb_ready`，Web Dashboard 优先显示这两个隔离侧语义字段。
- Web Storybook 覆盖当前固件新字段响应与旧固件缺少隔离侧字段的未知态。
- 默认固件不会控制上游 USB 通断。

## Remaining Gaps

- 需要实机确认 `LEDD=Low` 与 `hub.isolated_usb_ready=true` 在当前 CH318T 丝印版本和新硬件短接路径下保持一致。
- 需要实机确认 `UP0_PG=Low` 与 `hub.isolated_downstream_connected=true` 在当前 CH318T 丝印版本和新硬件短接路径下保持一致。
