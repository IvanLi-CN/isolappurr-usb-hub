# 规格（Spec）总览

本目录用于管理工作项的规格与追踪：记录范围、验收标准、任务清单与状态，作为交付依据；实现与验证应以对应 `SPEC.md` 为准。

> Legacy compatibility: historical repos may still contain `docs/plan/**/PLAN.md`. New entries live under `docs/specs/**/SPEC.md`.

## 新工作项入口

- 新开工作项统一落在 `docs/specs/**/SPEC.md`。
- 已迁移到 `docs/specs/**` 的工作项，后续维护继续在对应 `SPEC.md` 中完成。
- 仍需引用 legacy 内容时，应在新 spec 中显式标注“承接自哪个 `docs/plan/**`”，避免双来源口径。
- 尚未迁移的既有计划可以暂时继续保留在 `docs/plan/**`，直到单独完成迁移。

## 目录与命名规则

- 每个 spec 使用目录 `docs/specs/<id>-<title>/SPEC.md`。
- `<id>` 使用 5 字符 nanoId 风格的小写标识。
  - 推荐字符集（小写 + 避免易混淆字符）：`23456789abcdefghjkmnpqrstuvwxyz`
  - 正则：`[23456789abcdefghjkmnpqrstuvwxyz]{5}`
- `<title>` 使用稳定的 kebab-case slug；若标题文案变化，优先改 `Title`，不强制改目录名。

## 状态（Status）说明

仅允许使用以下状态值：

- `待设计`：范围/约束/验收标准尚未冻结，仍在补齐信息与决策。
- `待实现`：规格已冻结，允许进入实现阶段。
- `跳过`：规格已冻结或部分完成，但当前明确不应自动开工。
- `部分完成（x/y）`：实现进行中；`y` 为该 spec 的里程碑数，`x` 为已完成里程碑数。
- `已完成`：规格对应的交付已经完成。
- `作废`：不再推进。
- `重新设计（#<id>）`：该规格被另一个规格取代；`#<id>` 指向新的规格编号。

## `Last` 字段约定（推进时间）

- `Last` 表示该规格上一次发生“推进进度/口径变化”的日期。
- 仅在以下情况更新 `Last`：
  - `Status` 变化
  - 里程碑勾选变化
  - 范围、验收标准或关联约束发生实质变化

## `SPEC.md` 最小结构

每个 `SPEC.md` 至少应包含：

- 背景 / 问题陈述
- 目标 / 非目标
- 范围（in/out）
- 需求列表（MUST/SHOULD/COULD）
- 验收标准（Given/When/Then + 边界/异常）
- 里程碑（Milestones）
- 风险与开放问题

## Index

| ID   | Title | Status | Spec | Last | Notes |
|-----:|-------|--------|------|------|-------|
| j9twf | GC9307 正常界面（USB-A + USB-C/PD 双口电参量） | 已完成 | `j9twf-gc9307-normal-ui/SPEC.md` | 2026-03-11 | Migrated from legacy `docs/plan/0001:gc9307-normal-ui/PLAN.md` |
| 3xckq | INA226 兼容地址 fallback | 已完成 | `3xckq-ina226-fallback-addresses/SPEC.md` | 2026-03-11 | Depends on `j9twf`; probe-stage Address/Data NAK fallback only |
