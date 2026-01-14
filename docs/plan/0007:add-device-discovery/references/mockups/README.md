# UI 效果图（Mockups）

本目录提供 Plan #0007 的静态效果图（SVG），用于实现阶段对齐布局、信息密度与交互口径。

## 预览方式

- 直接用浏览器打开对应 `.svg` 文件（推荐 Chrome / Safari）。
- 若你是在 Markdown 预览器里看到圆角“变直角”，建议用本地 HTTP 方式打开（避免预览器对 SVG/CSS 的差异实现）：

```bash
cd docs/plan/0007:add-device-discovery/references/mockups
python3 -m http.server 4175 --bind 127.0.0.1
```

然后打开：

- `http://127.0.0.1:4175/preview.html`（推荐：一次性预览全部效果图）

## Add device（Discovery + Manual）

- Desktop（happy path）: `add-device-discovery-desktop.svg`
- Desktop（IP scan expanded）: `add-device-discovery-desktop-ip-scan-expanded.svg`
- Desktop（long list / scroll）: `add-device-discovery-desktop-long-list.svg`
- Desktop（discovery unavailable）: `add-device-discovery-desktop-unavailable.svg`
- Browser Web（IP scan）: `add-device-discovery-web-ip-scan.svg`

![Add device discovery desktop](./add-device-discovery-desktop.svg)

![Add device discovery desktop ip scan expanded](./add-device-discovery-desktop-ip-scan-expanded.svg)

![Add device discovery desktop long list](./add-device-discovery-desktop-long-list.svg)

![Add device discovery desktop unavailable](./add-device-discovery-desktop-unavailable.svg)

![Add device web ip scan](./add-device-discovery-web-ip-scan.svg)
