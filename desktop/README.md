# isolapurr-desktop

Desktop App（Plan `#0008`）：桌面 GUI 壳。新的 released-style 本机硬件边界由 `isolapurr-devd` daemon 和 `isolapurr` CLI 承担；桌面 GUI 应连接同一 localhost API。

- 服务 UI（`web/` 构建产物）
- 连接本机 `isolapurr-devd` API
- 保留旧 CLI 子命令用于迁移期开发，但新用户/Agent 操作应优先使用 `isolapurr` + `isolapurr-devd`

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

桌面可执行文件默认 `gui`：

```bash
isolapurr-desktop
```

迁移期子命令（长期用户 CLI 见 `tools/isolapurr-host` 的 `isolapurr`）：

- `gui`：启动 GUI（Tauri）+ localhost agent
- `tray`：启动 Menubar/Tray + localhost agent
- `open`：启动 localhost agent + 打开系统浏览器（进程保持运行）
- `serve`：仅启动 localhost agent（进程保持运行）
- `discover --json`：一次性发现并输出
- `serial ports [--json]`：列出 ESP32-S3 USB Serial/JTAG 候选
- `serial identify --port <path> [--write-cache] [--json]`：读取 JSONL `info`；带 `--write-cache` 时写入 `.esp32-port`
- `serial request --port <path> --method <method> [--params json] [--json]`：发送 JSONL request 并输出响应
- `firmware make-bin --elf <path> --out <path> [--json]`：从 release ELF 生成 app `.bin`
- `firmware flash --port <path> --bin <path> --address 0x10000 [--json]`：校验缓存身份后写 app 分区
- `firmware reset --port <path> [--json]`：执行 ESP32-S3 USB Serial/JTAG hard reset 并返回证据
- `firmware monitor --port <path> [--elf <release-elf>] [--reset] [--json]`：human 模式带 ELF 时通过 `espflash monitor` 解码 defmt；JSON 模式保留原始串口分类输出

## Cross-platform notes (Plan `#0009`)

- CI builds: `.github/workflows/desktop.yml` builds Windows (`.msi`) + Linux (`.deb`) + macOS (`.app`) and runs a headless `serve + /api/v1/health` smoke check.
- arm64: CI does a compile-check for Windows/Linux arm64 targets (no bundling).
