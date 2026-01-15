# 接口契约（Contracts）

本目录用于存放 Plan #0011 涉及的接口契约增量。为避免形状混杂，契约按 `Kind` 拆分成不同文件（不要把 CLI / HTTP / Config / 内部 API 混在同一文件里）。

本计划涉及：

- `internal-rust-api.md`：用于 CI 的确定性 discovery 注入接口（resolved 事件输入）
- `http-apis.md`：对现有 discovery snapshot 的“不可用/降级可诊断”语义补齐
- `cli.md`：`isolapurr-desktop discover` 作为 headless smoke 入口的输出/退出码口径（如有增量）
- `config.md`：GitHub Actions 工作流（desktop.yml）中的 smoke 测试步骤口径（默认不上传 artifacts）
