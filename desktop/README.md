# isolapurr-desktop

Desktop App（Plan `#0008`）：在本机运行一个 localhost agent，用于：

- 服务 UI（`web/` 构建产物）
- 提供 discovery 本机能力（mDNS/DNS‑SD + IP scan）

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

