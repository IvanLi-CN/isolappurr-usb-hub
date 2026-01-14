# 接口契约（Contracts）

本目录用于存放 Plan #0008 的接口契约。为避免形状混杂，契约按 `Kind` 拆分成不同文件（不要把 RPC / HTTP / File format 混在同一文件里）。

本计划涉及：

- `http-apis.md`：Desktop local HTTP server（localhost）对本地 UI 暴露的 discovery API
- `cli.md`：Desktop 单一可执行文件的 `gui/tray/cli` 模式与输出契约
- `rpc.md`：Tauri IPC（frontend ↔ Rust backend）的 discovery 契约（可选；HTTP API 仍为 MUST）
