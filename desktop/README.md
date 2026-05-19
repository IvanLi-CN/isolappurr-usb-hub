# isolapurr-desktop

Desktop App（Plan `#0008`）：在本机运行一个 localhost agent，用于：

- 服务 UI（`web/` 构建产物）
- 提供 discovery 本机能力（mDNS/DNS‑SD + IP scan）
- 提供开发期 Local USB 能力（串口识别、JSONL、app `.bin` 生成、烧录、reset、monitor）

## Dev

前置：先安装 Web 依赖（一次即可）

```bash
cd web && bun install
```

构建（生成 `.app`，不签名）：

```bash
cd desktop
cargo tauri build --ci --bundles app --no-sign
```

最小冒烟（CLI 启动 agent + health 检查）：

```bash
./src-tauri/target/aarch64-apple-darwin/release/isolapurr-desktop --port 51234 serve
```

Discovery smoke tests（Plan `#0011`）：

```bash
cd desktop
cargo test
```

本机 ad-hoc signing（macOS）：

```bash
codesign -s - --force --deep --timestamp=none src-tauri/target/aarch64-apple-darwin/release/bundle/macos/isolapurr-desktop.app
codesign --verify --deep --strict --verbose=2 src-tauri/target/aarch64-apple-darwin/release/bundle/macos/isolapurr-desktop.app
```

首次运行 Gatekeeper 放行：见 `docs/desktop/macos-first-run.md`。

## CLI

单一可执行文件，默认 `gui`：

```bash
isolapurr-desktop
```

子命令（见 Plan `#0008` 契约）：

- `gui`：启动 GUI（Tauri）+ localhost agent
- `tray`：启动 Menubar/Tray + localhost agent
- `open`：启动 localhost agent + 打开系统浏览器（进程保持运行）
- `serve`：仅启动 localhost agent（进程保持运行）
- `discover --json`：一次性发现并输出
- `serial ports [--json]`：列出 ESP32-S3 USB Serial/JTAG 候选
- `serial identify --port <path> [--write-cache] [--json]`：读取 JSONL `info`；带 `--write-cache` 时写入 `.esp32-port` 与 `.esp32-port.identity.json`
- `serial request --port <path> --method <method> [--params json] [--json]`：发送 JSONL request 并输出响应
- `firmware make-bin --elf <path> --out <path> [--json]`：从 release ELF 生成 app `.bin`
- `firmware flash --port <path> --bin <path> --address 0x10000 [--json]`：校验缓存身份后写 app 分区
- `firmware reset --port <path> [--json]`：执行 ESP32-S3 USB Serial/JTAG hard reset 并返回证据
- `firmware monitor --port <path> [--reset] [--json]`：持续输出串口日志，标注 boot / JSONL / panic / log

## Cross-platform notes (Plan `#0009`)

- CI builds: `.github/workflows/desktop.yml` builds Windows (`.msi`) + Linux (`.deb`) + macOS (`.app`) and runs a headless `serve + /api/v1/health` smoke check.
- arm64: CI does a compile-check for Windows/Linux arm64 targets (no bundling).
