# 接口契约（Contracts）

本目录用于存放本计划的**接口契约**。为避免形状混杂，契约按 `Kind` 拆分成不同文件（不要把 UI Route / UI Component / Config / File format 混在一个文件里）。

编写约定：

- `../PLAN.md` 是唯一的“接口清单（Inventory）”：每条接口都必须在那张表里出现，并链接到本目录对应契约文件。
- 修改既有接口时，契约里必须写清楚：
  - 变化点（旧 → 新）
  - 向后兼容期望
  - 迁移 / rollout 方案（如需要）

本计划涉及：

- `ui-routes.md`：路由与导航（Dashboard / Device / About）
- `ui-components.md`：关键 UI 组件 props 与领域数据形状
- `config.md`：DaisyUI 自定义主题与主题切换规则
- `file-formats.md`：localStorage 的主题偏好持久化约定

