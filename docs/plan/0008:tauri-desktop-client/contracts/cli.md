# CLI（Desktop single-binary modes）

本文件定义 Desktop 程序的 CLI 契约：同一个可执行文件支持 `gui` / `tray` / `cli` 三种模式（Mode B）。

## Command

> 二进制名以实现阶段为准，此处用 `isolapurr-desktop` 占位。

```bash
isolapurr-desktop <subcommand> [options]
```

默认行为（无参数）：

```bash
isolapurr-desktop
```

等价于：

```bash
isolapurr-desktop gui
```

## Subcommands

### `gui`

启动 GUI（Tauri），并启动本地 HTTP server（供 UI 与 discovery API 使用）。

```bash
isolapurr-desktop gui
```

### `tray`

启动 Menubar/Tray（无主窗口或默认不弹窗），并启动本地 HTTP server。

```bash
isolapurr-desktop tray
```

### `open`（CLI）

启动本地 HTTP server 并用系统浏览器打开 UI（该命令应保持进程存活以维持 server）。

```bash
isolapurr-desktop open
```

### `serve`（CLI）

仅启动本地 HTTP server（不打开浏览器、不启动 tray、不启动 GUI），用于调试或脚本化使用。

```bash
isolapurr-desktop serve
```

### `discover`（CLI）

一次性执行 discovery 并输出结果（不依赖本地 HTTP server 是否已运行）。

```bash
isolapurr-desktop discover --json
```

## Options

全局/常用选项（实现阶段可增量扩展，需保持向后兼容）：

- `--port <port>`：覆盖默认端口（仅对 `gui/tray/open/serve` 生效）；若未指定则自动选择高位端口（优先复用上次端口，否则从 `51200–51299` 中挑选可用端口）
- `--no-open`：用于 `open`，只打印 URL，不自动打开浏览器
- `--json`：用于 `discover`，以 JSON 输出（默认 human readable）

## Output

### `open`

- stdout：打印 UI URL（例如 `http://127.0.0.1:51234/`）
- stderr：错误信息（例如端口被占用时的诊断）

### `discover --json`

stdout 示例（shape 与 Plan #0007 `DiscoveredDevice[]` 对齐）：

```json
{
  "devices": [
    {
      "baseUrl": "http://isolapurr-usb-hub-aabbcc.local",
      "device_id": "aabbcc",
      "hostname": "isolapurr-usb-hub-aabbcc",
      "ipv4": "192.168.1.42",
      "last_seen_at": "2026-01-13T02:30:12Z"
    }
  ]
}
```

## Exit codes

- `0`：成功
- `2`：参数错误（bad args）
- `10`：端口占用 / server 启动失败（`gui/tray/open/serve`）
- `20`：discovery 不可用（例如网络权限/依赖缺失）
- `1`：其它错误
