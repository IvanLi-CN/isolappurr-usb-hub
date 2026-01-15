# IsolaPurr USB Hub

IsolaPurr USB Hub 是一个带 USB‑C 上行口、一个 USB‑C 下行口和一个 USB‑A 下行口的有源 USB 集线器/供电模块，重点特性是：

- 上行：USB‑C 口（数据 + 供电），使用 **CH334P** 做 USB2.0 Hub 控制。  
- 下行 USB‑A ×1：使用 **URB2405S‑3WR3** 隔离 DC/DC 模块独立供电，实现数据与电源隔离。  
- 下行 USB‑C ×1：硬件实现随方案不同：  
  - `tps-sw`：**CH224Q + TPS55288 + SW2303**（USB‑PD 受电 + 3.3–21 V 可调输出；PPS/AVS 能力由 SW2303 侧控制）  
  - `ip6557`：**CH224Q + IP6557**  
  详见 `docs/hardware-variants.md`。  
- 电源输入：
  - 来自主机的 USB‑C 上行口，通过 **CH224Q** 争取更高功率 PD 档位；  
  - 来自 DC5025 圆孔直流口（12–24 V 输入）；  
  通过两个理想二极管实现双路电源 OR‑ing，自动择优供电。

本仓库将包含完整的原理图、PCB、固件以及相关文档与数据手册的 Markdown 版本。

## 目录结构

当前主要目录：

- `src/` / `Cargo.toml`  
  - ESP32‑S3 固件（Rust `no_std`），用于对电源/协议芯片进行动态控制与状态读取（后续会逐步补齐功能）。  
- `web/`  
  - React SPA Web 界面（Vite + React + TypeScript），支持 GitHub Pages 部署。  
- `hardware/`  
  - 硬件方案产物（按方案名分目录）；当前包含两份网表：  
    - `hardware/tps-sw/netlist.enet`  
    - `hardware/ip6557/netlist.enet`  
- `docs/datasheets/`  
  - `ch224q-datasheet.md` – CH224Q/CH224A/CH224K/CH224D/CH221K 的官方手册 Markdown 版。  
  - `ch217-datasheet.md` – CH217 USB 限流配电开关芯片手册 Markdown 版。  
  - `urb2405s-3wr3-datasheet.md` – URB/URA‑3WR3 3 W 隔离 DC/DC 模块手册 Markdown 版（基于 Hi‑Link HLK‑URB_S‑3WR3）。  
  - `urb2405s-6wr3-datasheet.md` – URB/URA‑6WR3 6 W 隔离 DC/DC 模块手册摘要（基于 MORNSUN URB_S‑6WR3 系列）。  
  - `tps55288-datasheet.md` – TI TPS55288 Buck‑Boost 转换器手册 Markdown 版。  
  - `tps62933-datasheet.md` – TI TPS6293x / TPS62933 降压转换器手册 Markdown 版。  
  - `tvs0500-datasheet.md` – TI TVS0500 5 V Flat‑Clamp 浪涌保护器件手册 Markdown 版（TVS0500DRVR 用于 VBUS 保护）。  
  - `images/` – 上述数据手册中引用的本地图片资源。

其他设计笔记：

- `docs/ch217-upstream-vbus-protection.md` – 上行 USB‑C VBUS 使用 CH217 替代 PPTC 的设计记录。  
- `docs/tps62933-uvlo-en-divider.md` – TPS62933 通过 EN 分压实现约 8 V UVLO（`330 kΩ / 56 kΩ`）的选型记录。  
- `docs/tps55288-uvlo-en-divider.md` – TPS55288 通过 EN/UVLO 分压实现约 8 V LVLO（`200 kΩ / 36 kΩ`）的选型记录。  

后续会补充：

- `hardware/` – 原理图与 PCB 源文件（KiCad / Altium 等，视实际选型而定）。  
- `firmware/` – 如未来出现多固件/多 MCU，可将根目录固件迁移到该目录下分目标管理。  
- `mechanical/` – 外壳及 3D 模型（若有）。

## 开发与文档约定

- 项目中 **不保存 PDF 数据手册**，统一转为 Markdown + 本地图片，放在 `docs/datasheets/`。  
- 如需新增器件，请优先将数据手册转换为 Markdown，并在 README 中补充说明。  
- 提交信息遵循 Conventional Commits（英文）规范，例如：  
  - `docs: add markdown datasheets`  
  - `feat: add upstream power mux schematic`

## 状态

目前仓库处于早期文档准备阶段，已完成主要电源与协议芯片的数据手册整理，后续会逐步补充原理图和 PCB 设计。

## 开发快速开始

如果你安装了 `just`，建议按以下顺序：

- 安装并启动 `mcu-agentd`：`just agentd-init`（默认使用 `../mcu-agentd`；也可 `path=/path/to/mcu-agentd just agentd-init`）
- 列出串口：`just ports`
- 选择并缓存串口：`PORT=/dev/cu.xxx just select-port`（写入 `.esp32-port`）
- 烧录 + 监视：`just flash`

启用本地 Git hooks（格式化 + commitlint）：

- 安装提交工具依赖：`bun install`
- 安装 hooks：`just hooks-install`（等价于 `lefthook install`）

### 固件（ESP32‑S3 / Rust no_std / defmt）

- 构建：`just build`（或直接 `cargo build --release`）
- 烧录 + 串口监视（推荐）：`just flash`
  - 由 `mcu-agentd` 执行（配置：`mcu-agentd.toml`；串口缓存：`.esp32-port`；日志 `defmt` 解码由 `espflash` 完成）。
- `cargo run --release`（可选）：会通过 `tools/mcu-agentd-runner` 调用 `mcu-agentd`（同样要求先选定 `.esp32-port`，不会自动选串口）。

#### 网络功能（Wi‑Fi + mDNS + HTTP）

Plan `#0003` 引入了实验性网络能力（feature gate：`net_http`）：

- Wi‑Fi STA 联网（默认 DHCP；可选静态 IPv4）
- mDNS：`<hostname>.local` 解析 + `_http._tcp.local` 服务发现
- HTTP：`GET /` 返回 `Hello World`
- HTTP APIs：`/api/v1/...`（JSON，供 Web UI 调用：端口遥测 + Replug/Power）
- Web 对接：支持 CORS + Chrome/Chromium 的 Private Network Access（PNA）预检（用于 HTTPS Pages → HTTP 设备）
- UI 兜底：左右键同时按住 1–5 秒后松手，显示 ID / IPv4（>5 秒作废；未联网显示 `NO WIFI`/`NO IP`）

启用方式与排障命令见：`docs/networking.md`。

### Web（React SPA / bun）

- 安装依赖：`cd web && bun install`
- 本地开发：`cd web && bun dev`
- 默认端口（高位，避免冲突）：Web `http://127.0.0.1:45173`；Storybook `http://127.0.0.1:46006`；Preview `http://127.0.0.1:45175`
- 发现/添加设备：
  - 推荐：使用 Desktop App（Plan `#0008`）做 mDNS/DNS‑SD 自动发现；
  - GitHub Pages / 浏览器：无法使用 mDNS；请使用 “+ Add → IP scan (advanced)” 手动输入 CIDR 扫描，或直接手动填写 Base URL 添加。
- 质量门槛：`cd web && bun run check`
- 构建：`cd web && bun run build`
- Unit tests：`cd web && bun run test:unit`
- Storybook：`cd web && bun run storybook`
- Storybook（CI）：`cd web && bun run build-storybook && bun run test:storybook`
- E2E（Playwright）：`cd web && bun run build && bun run test:e2e`

### Desktop（Tauri / macOS 首发）

Plan `#0008` 引入 Desktop App，用于在本机提供 mDNS/DNS‑SD 自动发现（浏览器 Web 环境不支持）。

- 构建（生成 `.app`）：`cd desktop && cargo tauri build --ci --bundles app --no-sign`
- macOS 首次运行放行（Gatekeeper）：见 `docs/desktop/macos-first-run.md`
- 详细开发/CLI 用法：见 `desktop/README.md`

### GitHub Pages

- 推送到 `main` 后，GitHub Actions 会构建 `web/` 并发布到 GitHub Pages（工作流：`.github/workflows/pages.yml`）。
- 说明：为了支持 SPA 路由的“刷新/直达”，构建产物会额外生成 `web/dist/404.html`。

## 许可证

除 `docs/datasheets/` 等第三方资料外，本仓库的原创代码与文档以 `MIT OR Apache-2.0` 双许可证发布（见 `LICENSE-MIT` / `LICENSE-APACHE`）。
