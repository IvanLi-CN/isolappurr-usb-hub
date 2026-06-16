# Web UI 交互设计规范

## 范围（Scope）

- 适用范围：`web/` 目录下的 React UI（Browser Web + Desktop App 复用的 Web UI）。
- 不适用范围：Tauri 原生外壳层（窗口/菜单/系统栏）、固件侧 UI、设备 API 行为。

## 问题陈述

当前 Web UI（含 Desktop App 复用的 Web UI）需要一份稳定、可落地、可验收的“交互设计规范”，用于：

- 明确弹窗/滚动/键盘等交互边界，避免不同页面/组件口径不一致
- 为“自发现问题 + 修复 + 回归”提供可执行检查清单

## 目标 / 非目标

### Goals

- Modal 的打开/关闭/滚动策略一致，且在小高度窗口下行为可预测。
- 关键流程（Add device）在不同状态（scanning/ready/unavailable/error）下交互一致、无歧义。
- 交互可验收：每条规则都能通过 Given/When/Then 或 checklist 检查。

### Non-goals

- 不改变业务规则（连接协议、串口筛选、HTTP 通道、去重逻辑等以对应 spec 为准）。
- 不要求引入新依赖或重做整体 IA（Information Architecture）。

## 自适应与窗口变化（Responsive / Resize）

目标：窗口尺寸变化（分屏/拉伸）时，交互行为仍可预测；关键 CTA 不会“消失在不可达区域”。

要求：

- 当视口变窄/变矮时：
  - 页面允许纵向滚动，但不得出现横向滚动条（除非是明确的横向滚动组件）。
  - Modal 仍需保持在视口内（含外边距），并确保主要交互（例如 `Cancel/Create`）可达。
- 当窗口在 modal 打开期间发生 resize：滚动归属与 CTA 可达性不应被破坏。

## 全局导航与页面滚动（Global scroll）

目标：用户永远知道“当前滚动的是哪一层”；避免多层嵌套滚动导致迷失。

要求：

- Page-level：页面主体允许纵向滚动；不要因为某个子卡片内容较长就让整页出现意外横向滚动。
- Sidebar（设备列表）当条目过多时应提供可预测的滚动方式：
  - 允许“侧栏内部滚动”（推荐）或“整页滚动”（备选），但必须避免出现“侧栏与主内容同时滚动且难以控制”的双滚动体验。
- 所有可滚动区域必须有明确边界（容器高度与 `overflow-y` 归属清晰）。

## PWA 与离线启动

Web 控制台必须作为可安装 PWA 提供稳定 App shell。已经访问过的控制台应优先从本地缓存启动；真实设备 API 在离线或不可达时继续使用现有 offline/degraded 状态，不伪造设备在线。

规范性要求：

- `vite-plugin-pwa` 负责 manifest、service worker、Workbox 预缓存与离线 App shell。
- 更新策略使用 prompt 模式：发现新 service worker 后显示 toast，用户点击更新时先关闭 toast，再调用 `updateSW(true)` 刷新到新版本。
- 离线可启动范围仅包含 Web App shell 与静态资源；设备 HTTP/Web Serial/Local USB 连接状态仍由现有运行时通道判断。
- 页面标题、theme-color、favicon、Apple touch icon 和 PWA manifest 必须使用 IsolaPurr 产品身份，不得保留 Vite 默认资源。

## Modal 通用规则

### 打开与关闭

- 打开 modal 后必须聚焦到首个可编辑字段（例如 Add device 的 `Name`）。
- 关闭入口：
  - 点击遮罩层（backdrop）可关闭
  - `Escape` 可关闭
  - 明确的 `Cancel` 按钮可关闭
- 关闭时需要取消正在进行的长任务（例如串口读取或 Local USB 请求）。

### 键盘与可访问性（最低要求）

- `Tab` 顺序应符合视觉阅读顺序（左→右，上→下）。
- 不把 `Enter` 作为“全局关闭/全局提交”快捷键（避免误触发与意外关闭）。
- `aria-label` 应为可读的人类文本（例如 `Add device`）。

## 滚动策略（Scroll）

目标：避免“整张弹窗滚动”导致的迷失与 CTA 不可达；优先使用列内滚动。

要求：

- 当内容超过可视高度时，滚动应发生在内容列内部（例如 discovery 列表、表单内容区），避免 modal 外层滚动。
- `Cancel/Create` 操作区在小高度窗口下必须保持可达（不被滚动推离视口）。
- 滚动区域必须有明确边界（容器高度与 `overflow-y` 归属清晰），避免出现“滚着滚着不知道滚的是哪一层”。

## Add device（Wi‑Fi / Web Serial / Local USB）交互规范

本节为当前 Add device modal 的交互口径补充“实现验收要点”；字段与协议形状以 `docs/specs/u5b2c-usb-console-provisioning/SPEC.md` 为准。

### 状态与反馈

- Add device modal 以连接方式为首要分组：`Wi-Fi / LAN`、`Web Serial`、`Local USB`。
- 三种连接方式都是正式产品路径；UI 不得用文案或布局暗示主次等级。只有路径不可用或功能确实需要特定能力时，才展示禁用、切换或替代路径提示。
- Web Serial 与 Local USB 的连接、端口选择、进度与错误必须留在当前 modal 内完成，不跳转到其他页面。
- 不得新增独立设备连接页；设备连接必须经由 Add device modal 发起。
- 固件更新不得出现在 Add device modal 内；它属于已添加设备的 Hardware 页。
- 同一个 `device_id` 可以同时存在 Wi‑Fi / LAN 与 USB 通道；USB 连接成功时不得创建重复设备，而应更新该设备的运行时通道状态。
- Dashboard 运行时必须显示当前主通道，并在主通道失效时自动切换到另一条可用通道。
- 错误提示需可读可执行：
  - 说明原因（短句）
  - 给出下一步（例如切换到 Local USB 或 Wi-Fi）
  - 错误应贴近当前活跃面板，避免漂到无关区域

### Web Serial

- 浏览器支持 Web Serial 时，连接过程应先请求串口选择，再读取设备 `info` / `ports`。
- 若浏览器不支持 Web Serial，或目标设备不是 ESP32 系列，应显示明确的替代路径提示，并允许改走 Local USB 或 Wi-Fi。
- 串口输出中夹杂的非 JSONL 内容不应直接中断流程；应提示未读到有效设备响应，而不是抛出原始乱码。

### Local USB

- Local USB 负责本机串口枚举、JSONL 代理与受控烧录。
- 端口列表需要先过滤出符合 ESP32 串口特征的设备，再让用户确认目标端口。
- Local USB 服务不可用、端口不可达或设备未响应时，必须在 modal 内显示原因与重试入口。

### Wi‑Fi / LAN

- Wi‑Fi / LAN 保留网络可达路径、已有设备接入与 HTTP 通道。
- 远程 Web 保存设备时，优先推荐并保存已验证的 `http://<ipv4>`；`mDNS URL`（`http://<hostname>.local`）仍可作为手动输入或诊断路径，但不再作为默认推荐主地址。
- 若网络侧不可达，应展示可读状态，但不要把当前流程写成“手动添加”。
- 错误提示至少要区分三类可操作结果：名字解析/可达性问题、浏览器私网访问阻断、设备 API 自身返回错误。

### 选择与提交

- 选择某条连接路径后，只应在当前 modal 内填充表单或加载设备状态，不应绕出 modal 或创建额外步骤。
- 提交仍需用户显式点击主 CTA。
- `Escape` 关闭 modal，不提交。

## 交互验收（Given/When/Then 模板）

- Given：打开 Add device modal
  When：窗口高度较矮导致内容超出可视区域
  Then：滚动发生在面板内部，而不是整张 modal 滚动
  And：主 CTA 仍可达

- Given：浏览器不支持 Web Serial
  When：用户切换到 Web Serial
  Then：UI 给出可执行的替代路径提示
  And：用户仍可改走 Local USB 或 Wi-Fi

- Given：Local USB service 未启动
  When：用户切换到 Local USB
  Then：UI 在当前 modal 显示可读错误与重试入口

- Given：设备已经通过 Wi‑Fi / LAN 保存
  When：用户通过 Web Serial 或 Local USB 连接到相同 `device_id`
  Then：Add device modal 关闭
  And：设备列表不新增重复项
  And：Dashboard 使用新的 USB 通道刷新数据

## 审计清单（Interaction audit checklist）

实现/回归时按此清单自检：

- modal 是否支持 `Escape` / 点击遮罩关闭？
- 打开 modal 是否自动聚焦首个字段？
- 小高度窗口下滚动是否“列内滚动”，且 CTA 可达？
- Add device 是否只暴露 `Wi-Fi / LAN`、`Web Serial`、`Local USB` 三种连接路径？
- 是否不存在独立的硬件连接路由或第二套连接按钮？
- Web Serial 不支持或无有效 JSONL 响应时是否给出可执行替代路径？
- Local USB 端口列表是否先过滤 ESP32 串口候选？
- 关键错误提示是否包含“原因 + 下一步”？
- 视口在 360×640 / 768×800 / 1024×700 下是否仍无横向滚动？
