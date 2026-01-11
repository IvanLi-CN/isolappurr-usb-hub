# UI 参考效果（Wireframes）

> 说明：本文件提供 **低保真布局参考**，用于在不依赖 Figma 的情况下统一实现口径。最终视觉细节以 DaisyUI 主题与组件实现为准。

## 1) 全局布局（AppLayout）

```
┌───────────────────────────────────────────────────────────────────────┐
│ Navbar: Isolapurr USB Hub                     Theme ▾   About         │
├───────────────────────────────┬───────────────────────────────────────┤
│ Sidebar (Device List)          │ Main                                  │
│  - Search (optional)           │  page title + subtitle                │
│  - + Add device                │  content area                         │
│  - device cards (select)       │                                       │
│  - remove action               │                                       │
└───────────────────────────────┴───────────────────────────────────────┘
```

- Navbar 必备：App title（链接到 `/`）、Theme selector、About 入口。
- Sidebar 必备：设备列表 + Add；空态时提供引导文案与 Add 入口。

### 全局浮层（Modal / Overlay）

- 任何 modal 的遮罩层必须覆盖整个应用视口（包括 navbar/header 与 sidebar），避免出现“顶部没被遮住”的割裂感。

## 2) Dashboard（`/`）

```
Main: Dashboard

┌───────────────────────────────────────────────────────────────────────┐
│ Dashboard                                                             │
│  - grid: 1 col (sm) / 2 col (xl) / auto-fit (optional)                │
│                                                                       │
│  ┌─────────────────────┐  ┌─────────────────────┐                    │
│  │ DeviceSummaryCard    │  │ DeviceSummaryCard    │                    │
│  │ name + status badge  │  │ name + status badge  │                    │
│  │ last ok: 12:34:56    │  │ last ok: 12:34:12    │                    │
│  │ id: aabbcc           │  │ id: ddeeff           │                    │
│  │ ┌──── USB-A ───────┐ │  │ ┌──── USB-A ───────┐ │                    │
│  │ │ 5.02V 0.12A 0.60W │ │  │ │ --.-V --.-A --.-W│ │                    │
│  │ │ [Power] [Replug]  │ │  │ │ [Power] [Replug] │ │                    │
│  │ └──────────────────┘ │  │ └──────────────────┘ │                    │
│  │ ┌──── USB-C ───────┐ │  │ ┌──── USB-C ───────┐ │                    │
│  │ │ 9.01V 0.83A 7.48W │ │  │ │ --.-V --.-A --.-W│ │                    │
│  │ │ [Power] [Replug]  │ │  │ │ [Power] [Replug] │ │                    │
│  │ └──────────────────┘ │  │ └──────────────────┘ │                    │
│  │ [Open details →]     │  │ [Open details →]     │                    │
│  └─────────────────────┘  └─────────────────────┘                    │
└───────────────────────────────────────────────────────────────────────┘
```

### 状态口径

- `online`: 正常显示数据与按钮。
- `offline`: last_ok 距今 ≥ 10 秒；显示 offline badge；禁用 Power/Replug。
- `unknown`: 初次加载或从未成功拉取；显示 skeleton 或未知占位；禁用写操作。

### Add device 占位卡（Dashboard grid）

- Dashboard 网格可在末尾追加一个 “Add device” 占位卡（用于快速引导新增设备）。
- 占位卡内的图标 + 标题 + 描述应作为一个整体 **水平+垂直居中**（不要只居中图标）。

### 危险操作确认（Power Off）

当端口当前为 `Power: On` 时：

```
 [Power ▾]   (click)  →  popover: "Power off?" [Cancel] [Confirm]
```

- 确认气泡必须在按钮旁（popover/tooltip 风格），点击空白处可关闭。
- 气泡内容按单行垂直居中；确认按钮使用 DaisyUI 最小尺寸（`btn-xs`）。
- 气泡为“浮层”而非卡片内的整行区域：宽度按内容自适应，并用小箭头指向触发按钮（视觉上不应与卡片其它元素做整行对齐）。
- 气泡显示/隐藏不得改变卡片布局：不允许为了“留位置”而让其它元素下移。
- Power On（从 Off → On）不需要二次确认。
- Replug 不需要二次确认（如果未来要加，可另行冻结）。

## 3) Device Overview（`/devices/:deviceId`）

```
Tabs: [Overview] [Hardware]

┌───────────────────────────────────────────────────────────────────────┐
│ Device header: name, baseUrl, status badge, id                         │
│                                                                       │
│  ┌───────────────┐   ┌───────────────┐                                │
│  │ PortCard USB-A │   │ PortCard USB-C │                                │
│  │ big V/A/W      │   │ big V/A/W      │                                │
│  │ status badge   │   │ status badge   │                                │
│  │ [Power] [Replug]   │ [Power] [Replug]                                │
│  └───────────────┘   └───────────────┘                                │
└───────────────────────────────────────────────────────────────────────┘
```

## 4) Device Hardware（`/devices/:deviceId/info`）

```
Tabs: [Overview] [Hardware]

┌───────────────────────────────────────────────────────────────────────┐
│ Identity: device_id / hostname / fqdn / mac / variant                  │
│ Firmware: name / version / uptime_ms                                   │
│ WiFi: state / ipv4 / is_static                                         │
└───────────────────────────────────────────────────────────────────────┘
```

字段缺失时显示 `unknown`（不要留空）。

## 5) About（`/about`）

```
┌───────────────────────────────────────────────────────────────────────┐
│ About                                                                  │
│ Top row (responsive 2-col):                                            │
│  - Build card: build/date/theme                                         │
│  - Links & defaults card: Repo/Docs/Issues + V/A/W + 1s/10s rules       │
│                                                                       │
│ Bottom: Quick usage                                                     │
└───────────────────────────────────────────────────────────────────────┘
```

## 6) 数值显示（V/A/W）

- 数据源允许来自设备的 `*_mv/*_ma/*_mw`，UI 统一转换显示为：
  - `V = voltage_mv / 1000`（保留 2 位小数）
  - `A = current_ma / 1000`（保留 2 位小数）
  - `W = power_mw / 1000`（保留 2 位小数）
- 建议显示组件使用 `font-mono` + `tabular-nums` 以减少跳动。
