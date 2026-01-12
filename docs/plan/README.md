# 计划（Plan）总览

本目录用于管理“先计划、后实现”的工作项：每个计划在这里冻结范围与验收标准，进入实现前先把口径对齐，避免边做边改导致失控。

## 快速新增一个计划

1. 分配一个新的四位编号 `ID`（查看下方 Index，取未使用的最小或递增编号）。
2. 新建目录：`docs/plan/<id>:<title>/`（`<title>` 用简短 slug，建议 kebab-case）。
3. 在该目录下创建 `PLAN.md`（模板见下方“PLAN.md 写法（简要）”）。
4. 在下方 Index 表新增一行，并把 `Status` 设为 `待设计` 或 `待实现`（取决于是否已冻结验收标准），并填入 `Last`（通常为当天）。

## 目录与命名规则

- 每个计划一个目录：`docs/plan/<id>:<title>/`
- `<id>`：四位数字（`0001`–`9999`），一经分配不要变更。
- `<title>`：短标题 slug（建议 kebab-case，避免空格与特殊字符）；目录名尽量稳定。
- 人类可读标题写在 Index 的 `Title` 列；标题变更优先改 `Title`，不强制改目录名。

## 状态（Status）说明

仅允许使用以下状态值：

- `待设计`：范围/约束/验收标准尚未冻结，仍在补齐信息与决策。
- `待实现`：计划已冻结，允许进入实现阶段（或进入 PM/DEV 交付流程）。
- `部分完成（x/y）`：实现进行中；`y` 为该计划里定义的里程碑数，`x` 为已完成里程碑数（见该计划 `PLAN.md` 的 Milestones）。
- `待验收`：实现已完成，等待按验收标准进行验证与确认。
- `已完成`：该计划已完成（通常已合并到主分支或已确认不再需要变更）。
- `作废`：不再推进（取消/价值不足/外部条件变化）。
- `重新设计（#<id>）`：该计划被另一个计划取代；`#<id>` 指向新的计划编号。

## `Last` 字段约定（推进时间）

- `Last` 表示该计划**上一次“推进进度/口径”**的日期，用于快速发现长期未推进的计划。
- 仅在以下情况更新 `Last`（不要因为改措辞/排版就更新）：
  - `Status` 变化（例如 `待设计` → `待实现`，或 `待验收` → `已完成`）
  - `PLAN.md` 的里程碑勾选变化
  - 范围/验收标准冻结或发生实质变更

## PLAN.md 写法（简要）

每个计划的 `PLAN.md` 至少应包含：

- 背景/问题陈述（为什么要做）
- 目标 / 非目标（做什么、不做什么）
- 范围（in/out）
- 需求列表（MUST/SHOULD/COULD）
- 验收标准（Given/When/Then + 边界/异常）
- 里程碑（Milestones，用于驱动 `部分完成（x/y）`）
- 风险与开放问题（需要决策的点）

## Index（固定表格）

| ID   | Title | Status | Plan | Last | Notes |
|-----:|-------|--------|------|------|-------|
| 0001 | GC9307 正常界面规范（USB‑A + USB‑C/PD 双口电参量） | 已完成 | `0001:gc9307-normal-ui/PLAN.md` | 2026-01-08 | - |
| 0002 | CH442E 短按重插 / 长按断电（USB‑A 左键，USB‑C 右键） | 待实现 | `0002:usb-replug-power-cut/PLAN.md` | 2026-01-09 | - |
| 0003 | 固件联网：Wi‑Fi + mDNS + HTTP（Hello World） | 已完成 | `0003:wifi-mdns-http/PLAN.md` | 2026-01-10 | feature: `net_http` |
| 0004 | GitHub Pages Web：双口遥测与控制台（Mock，多设备） | 待验收 | `0004:github-pages-ports-dashboard/PLAN.md` | 2026-01-10 | Mock only（暂不连真机；后续用 PNA） |
| 0005 | 设备 HTTP API：双口遥测 + 端口操作（Web 对接） | 待验收 | `0005:device-http-api/PLAN.md` | 2026-01-11 | CORS allowlist: `https://isolapurr.ivanli.cc` |
| 0006 | Web UI：多设备 Dashboard / 设备详情 / About + DaisyUI 主题规范 | 已完成 | `0006:web-ui-screens-and-theme/PLAN.md` | 2026-01-12 | branch: `feat/0006-web-ui-screens-and-theme` |
