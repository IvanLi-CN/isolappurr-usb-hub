# UI 效果图（Mockups）

本目录提供 Plan #0006 的静态效果图（SVG），用于实现阶段对齐布局、信息密度与交互口径。

## 预览方式

- 直接用浏览器打开对应 `.svg` 文件（推荐 Chrome / Safari）。
- 若你是在 Markdown 预览器里看到圆角“变直角”，建议用本地 HTTP 方式打开（避免预览器对 SVG/CSS 的差异实现）：

```bash
cd docs/plan/0006:web-ui-screens-and-theme/references/mockups
python3 -m http.server 4174 --bind 127.0.0.1
```

然后打开：

- `http://127.0.0.1:4174/preview.html`（推荐：一次性预览全部效果图）
- `http://127.0.0.1:4174/README.md`
- `http://127.0.0.1:4174/dashboard-light.svg`

> 注：`preview.html` 会在每次刷新时对 SVG 追加 `?v=<timestamp>`，减少浏览器缓存导致的“改了但看不到”的情况。

## Dashboard

- Light: `dashboard-light.svg`
- Dark: `dashboard-dark.svg`

![Dashboard (light)](./dashboard-light.svg)

![Dashboard (dark)](./dashboard-dark.svg)

## Device details

- Overview: `device-overview.svg`
- Hardware: `device-hardware.svg`

![Device overview](./device-overview.svg)

![Device hardware](./device-hardware.svg)

## About

- `about.svg`

![About](./about.svg)

## Add device

- Modal: `add-device.svg`

![Add device modal](./add-device.svg)
