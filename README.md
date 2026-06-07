# IsolaPurr USB Hub

IsolaPurr USB Hub 是一个带 USB‑C 上行口、一个 USB‑C 下行口和一个 USB‑A 下行口的有源 USB 集线器/供电模块，重点特性是：

- 上行：USB‑C 口（数据 + 供电），使用 **CH334P** 做 USB2.0 Hub 控制。  
- 下行 USB‑A ×1：使用 **URB2405S‑3WR3** 隔离 DC/DC 模块独立供电，实现数据与电源隔离。  
- 下行 USB‑C ×1：使用 **CH224Q + TPS55288 + SW2303**（USB‑PD 受电 + 3.3–21 V 可调输出；PPS/AVS 能力由 SW2303 侧控制），硬件记录见 `docs/hardware-variants.md`。  
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
- `tools/isolapurr-host/`
  - Released-style host tools：`isolapurr-devd` 本地 daemon 与 `isolapurr` 用户 CLI。
- `skills/`
  - `vercel-labs/skills` 兼容的 Agent skills：`isolapurr-user-operations` 用于 released host tools 用户操作，`isolapurr-developer-operations` 用于源码开发/维护操作。
- `hardware/`
  - 硬件方案产物；网表位于 `hardware/tps-sw/netlist.enet`。
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

目前仓库包含 ESP32-S3 固件、Web 控制台、Tauri desktop shell，以及 released-style host tools。三种正式通信方案是 `Wi-Fi / LAN`、`Web Serial` 和 `Local USB`；它们是等价交付路径，只是能力边界不同，不是质量等级不同。默认偏好只在多路同时立即可用时才存在，且只表示同一设备的主路选择，不表示方案优先级高低。Local USB 的长期用户边界是 `isolapurr-devd` + `isolapurr`；CLI 通过本机 IPC 连接 devd，不通过 localhost HTTP。Web Serial 仍是正式浏览器路径。

### 通信方案总览

项目保留多种通信方案，是因为同一台 Hub 会出现在不同生命周期和使用环境里：首次联网前需要 USB provisioning，日常桌面控制可能直接走 LAN，浏览器使用者可能只授权 Web Serial，桌面工具则需要本机 daemon 承担烧录、串口独占和身份校验。这些是场景差异，不是产品等级差异。

- `Wi-Fi / LAN`：适合设备已联网、浏览器或桌面端可直连局域网地址的场景。它是正式产品通道，不是“低配兜底”，但会受浏览器私网访问策略和设备是否已成功绑定 LAN 地址影响。
- `Web Serial`：适合浏览器已授权 USB、并且用户希望在页面内直接和硬件交互的场景。它提供正式的 USB 连接体验，尤其适合无需依赖本机 daemon 的浏览器使用方式。
- `Local USB`：适合桌面 App 或 released host-tools 场景。它提供本机串口、代理、烧录和监视能力，适合需要稳定硬件操作、身份校验和本地工具链支持的工作流。

共通规则：

- 除了各自明确写出的功能限制外，三条方案在交付品质上平等。
- 只有当多个方案都已经“立即可用”时，运行时才做默认偏好选择。
- 默认偏好采用“记住上次成功方案”的稳定策略；当该方案不可用时，再切换到其他立即可用方案。
- 如果某个功能要求特定通道，那是能力边界，不是方案等级差异。

## 开发快速开始

如果你安装了 `just`，建议按以下顺序：

- 构建/测试 host tools：`just host-tools-build` / `just host-tools-test`
- 从源码启动 IPC devd：`just devd-serve`（默认无客户端空闲一段时间后退出；开发时可用 `--idle-timeout-secs 0` 保持常驻）
- 从源码运行 CLI：`just isolapurr devices`（会优先连接默认 IPC endpoint，找不到 daemon 时尝试自动启动同构建目录下的 `isolapurr-devd`，daemon 空闲后自退）
- 仅在需要给浏览器/调试 UI 暴露 localhost API 时启动 HTTP bridge：`just devd-http-bridge --bind 127.0.0.1:51200 --allow-dev-cors`
- 普通 Local USB 操作会先校验设备正在运行 IsolaPurr 项目固件且版本兼容；下载模式、非项目固件或旧版本会被拒绝，并提示首次烧录或升级固件。
- 选择器使用范围：
  - `--hardware <saved-id>`：面向日常 owner-facing 操作，适用于 `status`、`wifi`、`ports`、`diagnostics`、`power` 等普通设备控制命令。这里的 `saved-id` 来自 `isolapurr hardware list`，代表已经绑定/保存过的设备。
  - `--device <temporary-devd-id>`：只用于临时 devd 目标仍然合理的场景，例如硬件绑定/保存前的识别、烧录、`reset` 等 USB 维护操作；它不是普通设备控制命令的正式选择器。
  - `power` 命令族只接受 `--hardware`，或在省略选择器时从“已保存硬件”列表交互选择；不得用 `--device` 指向临时 devd 目标。
- 首次使用或清理过构建产物后，先构建本机 CLI：`just desktop-agent-build`
- 列出 Local USB 候选串口：`just ports`
- 选择 Local USB 端口：`just select-port`（若设备已运行项目固件，会写入端口与 `device_id`/`mac`；若是全新硬件或下载模式，会写入 owner-confirmed 端口用于首次烧录）
- 生成 app `.bin`：`just firmware-bin`
- 烧录：`just flash`（首次烧录会要求再次输入 `yes`，写入 bootloader/partition/app 后尝试回填设备身份；后续已确认烧录只写 app）
- 身份确认后烧录 + reset + 监视：`just flash-monitor`

启用本地 Git hooks（格式化 + commitlint）：

- 安装提交工具依赖：`bun install`
- 安装 hooks：`just hooks-install`（等价于 `lefthook install`）

### Agent skills

本仓的 Agent skills 放在 `skills/`，按 `vercel-labs/skills` 约定安装；不要手动复制或链接到 `~/.codex/skills`。

普通用户不需要克隆本仓，只安装用户操作 skill：

- `npx --yes skills add https://github.com/IvanLi-CN/isolappurr-usb-hub --skill isolapurr-user-operations -y`
- 上面的 GitHub URL 使用当前远端仓库名；产品、固件与本地目录名仍使用 `isolapurr-usb-hub`。
- 内容边界：使用 release 版 `isolapurr` / `isolapurr-devd` 与正式 Web Serial 路径；缺少 host tools 时，skill 会先展示安装计划并在确认后运行 release installer；安装与 `--help` 验证完成前，不列出硬件、不扫描系统 USB/串口、不要求源码 checkout、Rust、Bun、Just 或本地构建缓存。
- 如确实需要用户级全局安装，再显式加 `--global`。

普通用户直接安装 host tools 时，也可使用 release installer：

- macOS/Linux：`curl -fsSLO https://github.com/IvanLi-CN/isolappurr-usb-hub/releases/latest/download/install-isolapurr-host.sh && bash install-isolapurr-host.sh`
- Windows：下载 `https://github.com/IvanLi-CN/isolappurr-usb-hub/releases/latest/download/install-isolapurr-host.ps1` 后运行 `powershell -ExecutionPolicy Bypass -File .\install-isolapurr-host.ps1`
- installer 会下载匹配平台的 `isolapurr-host-tools-<platform>.tar.gz`，用同一 release 的 `SHA256SUMS` 校验，并安装 `isolapurr` / `isolapurr-devd` 到用户目录；不会自动修改 shell profile 或系统 PATH。若 release 或 installer asset 尚不可用，应报告该 blocker 并停止，而不是改用系统串口枚举或源码路径代替。

项目开发者或维护者已经有源码 checkout 时，再使用本地路径查看/安装开发 skill：

- 查看本仓可安装的 skills：`npx --yes skills add . --list`
- 安装开发/维护 skill：`npx --yes skills add . --skill isolapurr-developer-operations -y`
- 内容边界：使用 Just、源码构建、release assets、HIL/debug、Web/Desktop/Firmware 验证与维护流程。

### 固件（ESP32‑S3 / Rust no_std / defmt）

- 构建：`just build`（或直接 `cargo build --release`）
- Local USB 烧录 + 串口监视（推荐）：`just flash-monitor`
  - 由项目内 `isolapurr-desktop` CLI 执行；`.esp32-port` 是 owner-confirmed 端口与身份偏好缓存。
  - 常规烧录前会通过 JSONL `info` 校验 `device_id` / `mac`，只写 app `.bin` 到 `0x10000`；全新硬件或下载模式可先 `just select-port` 再 `just flash` 做一次未识别 bootstrap 烧录，用 ELF 写入 bootloader、partition table 和 app。
- `cargo run --release`（可选）：会通过 `tools/mcu-agentd-runner` 调用项目内 Local USB runner（同样要求先运行 `PORT=/dev/cu.xxx just identify`，不会自动选串口）。
- `mcu-agentd` 仅作为 legacy/emergency 工具保留；默认开发流程不得依赖它。

#### 网络功能（Wi‑Fi + mDNS + HTTP）

Plan `#0003` 引入了默认启用的网络与 USB JSONL 能力（feature：`net_http`）：

- Wi‑Fi STA 联网（默认 DHCP；可选静态 IPv4）
- mDNS：`<hostname>.local` 解析 + `_http._tcp.local` 服务发现
- HTTP：`GET /` 返回 `Hello World`
- HTTP APIs：`/api/v1/...`（JSON，供 Web UI 调用：端口遥测、Replug/Power、USB-C/TPS power config）
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
- 设备页：Overview / Settings / Power；Power 页用于 SW2303 USB-C capability、manual TPS 输出和 host-lock 保护的高级设置。
- 质量门槛：`cd web && bun run check`
- 构建：`cd web && bun run build`
- Unit tests：`cd web && bun run test:unit`
- Storybook：`cd web && bun run storybook`
- Storybook（CI）：`cd web && bun run build-storybook && bun run test:storybook`
- E2E（Playwright）：`cd web && bun run build && bun run test:e2e`

### Desktop（Tauri / macOS 首发）

Plan `#0008` 引入 Desktop App；CLI/devd alignment 后，桌面壳定位为 GUI 客户端，Local USB 的 released-style 主路径是 `isolapurr-devd` + `isolapurr`。

- 构建（生成 `.app`）：`cd desktop && cargo tauri build --ci --bundles app --no-sign`
- macOS 首次运行放行（Gatekeeper）：见 `docs/desktop/macos-first-run.md`
- 详细开发/CLI 用法：见 `desktop/README.md`

### GitHub Pages

- 推送到 `main` 后，GitHub Actions 会构建 `web/` 并发布到 GitHub Pages（工作流：`.github/workflows/pages.yml`）。
- 说明：为了支持 SPA 路由的“刷新/直达”，构建产物会额外生成 `web/dist/404.html`。

## 许可证

除 `docs/datasheets/` 等第三方资料外，本仓库的原创代码与文档以 `MIT OR Apache-2.0` 双许可证发布（见 `LICENSE-MIT` / `LICENSE-APACHE`）。
