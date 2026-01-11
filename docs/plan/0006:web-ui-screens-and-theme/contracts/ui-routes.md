# UI Routes

本文件冻结 Web UI 的路由与导航口径（`react-router`）。

## Route map

| Path | Name | Layout | Notes |
| --- | --- | --- | --- |
| `/` | Dashboard | AppLayout（含 sidebar） | 多设备网格总览；默认入口 |
| `/devices/:deviceId` | Device Overview | AppLayout（含 sidebar） | 单设备总览（双口遥测 + 操作） |
| `/devices/:deviceId/info` | Device Hardware | AppLayout（含 sidebar） | 单设备硬件信息（建议 UI 文案为 “Hardware”） |
| `/about` | About | AppLayout（含 sidebar） | 应用信息/版本/链接 |
| `*` | NotFound | AppLayout（含 sidebar） | 404（保留返回入口） |

## Navigation

- 顶部导航（header）至少提供：
  - Dashboard（`/`）
  - About（`/about`）
- Sidebar 仍负责设备列表（选中设备后进入 `/devices/:deviceId`）。

