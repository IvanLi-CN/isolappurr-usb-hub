# 计划（Plan）总览

本目录保留仓库历史上的 legacy plan 记录，便于追溯旧工作项的冻结口径与当时的验收标准。

> 历史说明：`docs/plan/**` 仅作为 legacy 记录保留；新的或继续维护的规格统一写入 `docs/specs/**/SPEC.md`。

## 新工作项入口

- 新增规格：请改用 `docs/specs/README.md`
- `docs/plan/**` 不再接受新的工作项，也不再作为继续维护时的首选落点
- 本目录只维护历史索引与 legacy 内容的迁移提示

## 目录与命名规则

- Legacy 计划目录格式：`docs/plan/<id>:<title>/`（仅保留历史项，不再用于新增）
- `<id>`：历史上既有 5 字符 nanoId 风格与四位数字（`0001`–`9999`）并存；这里仅用于理解旧目录命名，不再作为新增规范。
  - 推荐字符集（小写 + 避免易混淆字符）：`23456789abcdefghjkmnpqrstuvwxyz`
  - 正则：`[23456789abcdefghjkmnpqrstuvwxyz]{5}`
- `<title>`：短标题 slug（建议 kebab-case，避免空格与特殊字符）；目录名尽量稳定。
- 人类可读标题写在 Index 的 `Title` 列；标题变更优先改 `Title`，不强制改目录名。

## 状态（Status）说明

仅允许使用以下状态值：

- `待设计`：范围/约束/验收标准尚未冻结，仍在补齐信息与决策。
- `待实现`：计划已冻结，允许进入实现阶段（或进入 PM/DEV 交付流程）。
- `跳过`：计划已冻结或部分完成，但当前明确不应自动开工；需要实现时再改回 `待实现`（或由主人显式点名）。
- `部分完成（x/y）`：实现进行中；`y` 为该计划里定义的里程碑数，`x` 为已完成里程碑数（见该计划 `PLAN.md` 的 Milestones）。
- `已完成`：该计划已完成（通常已合并到主分支或已确认不再需要变更）。
- `作废`：不再推进（取消/价值不足/外部条件变化）。
- `重新设计（#<id>）`：该计划被另一个计划取代；`#<id>` 指向新的计划编号。

## `Last` 字段约定（推进时间）

- `Last` 表示该计划**上一次“推进进度/口径”**的日期，用于快速发现长期未推进的计划。
- 仅在以下情况更新 `Last`（不要因为改措辞/排版就更新）：
  - `Status` 变化（例如 `待设计` → `待实现`，或 `待实现` → `已完成`）
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
| 0001 | GC9307 正常界面规范（USB‑A + USB‑C/PD 双口电参量） | 已完成 | `0001:gc9307-normal-ui/PLAN.md` | 2026-01-08 | migrated spec: `docs/specs/j9twf-gc9307-normal-ui/SPEC.md` |
| 0002 | CH442E 短按重插 / 长按断电（USB‑A 左键，USB‑C 右键） | 已完成 | `0002:usb-replug-power-cut/PLAN.md` | 2026-01-14 | - |
| 0003 | 固件联网：Wi‑Fi + mDNS + HTTP（Hello World） | 已完成 | `0003:wifi-mdns-http/PLAN.md` | 2026-01-10 | feature: `net_http` |
| 0004 | GitHub Pages Web：双口遥测与控制台（Mock，多设备） | 已完成 | `0004:github-pages-ports-dashboard/PLAN.md` | 2026-01-14 | Mock only（暂不连真机；后续用 PNA） |
| 0005 | 设备 HTTP API：双口遥测 + 端口操作（Web 对接） | 已完成 | `0005:device-http-api/PLAN.md` | 2026-01-14 | CORS allowlist: `https://isolapurr.ivanli.cc` |
| 0006 | Web UI：多设备 Dashboard / 设备详情 / About + DaisyUI 主题规范 | 已完成 | `0006:web-ui-screens-and-theme/PLAN.md` | 2026-01-12 | branch: `feat/0006-web-ui-screens-and-theme` |
| 0007 | Web UI：添加设备（自动发现 + 手动添加） | 已完成 | `0007:add-device-discovery/PLAN.md` | 2026-01-18 | mDNS 自动发现仅 Desktop App（0008）；Web 支持 IP scan（手动 CIDR）+ 手动添加 |
| 0008 | Desktop：Tauri 客户端（局域网发现 + 本地网络能力） | 已完成 | `0008:tauri-desktop-client/PLAN.md` | 2026-01-18 | branch: `feat/0008-tauri-desktop-client` |
| 0009 | Desktop：全平台支持（Windows/Linux） | 已完成 | `0009:desktop-cross-platform-support/PLAN.md` | 2026-01-16 | Win/Linux: x86_64+arm64 (CI builds arm64 artifacts on public runners); Windows: msi + portable zip; Linux: deb + portable tar.gz; Desktop CI: build + `serve` smoke; branch: `feat/0009-desktop-cross-platform-support` |
| 0010 | Web UI：界面布局与滚动问题修复（含 Add device 弹窗） | 已完成 | `0010:web-ui-layout-polish/PLAN.md` | 2026-01-16 | 关联：0006（UI 规范）、0007（Add device）、0008（Desktop 复用 Web UI） |
| 0011 | Desktop：CI discovery 流程测试（跨平台 smoke） | 已完成 | `0011:desktop-discovery-ci-smoke/PLAN.md` | 2026-01-16 | 关联：0008（discovery 链路）、0009（CI 成本约束/跨平台）；PR gate 覆盖 macOS/Windows/Linux |
| 0012 | Desktop：本地持久化记忆（不依赖浏览器存储） | 已完成 | `0012:desktop-persistent-storage/PLAN.md` | 2026-01-17 | 关联：0008（Desktop local agent）、0004/0006（localStorage 既有格式）、0009（跨平台目录/权限）、0010（UI 交互不变）；branch: `feat/0012-desktop-persistent-storage` |
| 0013 | Desktop：IP scan 输入默认本机局域网信息 | 已完成 | `0013:ip-scan-lan-autofill/PLAN.md` | 2026-01-18 | 关联：0007（Add device）、0008（Desktop discovery）；branch: `feat/0013-ip-scan-lan-autofill` |
| 0014 | GitHub Actions：构建提速与分拆 | 已完成 | `0014:actions-speedup/PLAN.md` | 2026-01-18 | branch: `feat/0014-actions-speedup` |
| 0015 | Desktop：CI 触发去重（避免 push 与 PR 重复） | 已完成 | `0015:desktop-ci-trigger-gating/PLAN.md` | 2026-01-18 | 非主分支 push 不构建 desktop；main/release/tags push 仍构建；fork PR 跳过；merged PR #42 |
| 6xrna | CH318T LEDD 原始电平采集（作为 USB 链路指示输入） | 部分完成（3/4） | `6xrna:ch318-ledd-raw-signal/PLAN.md` | 2026-01-29 | 等待验收 |
| vqp6v | PCB v1.2：背光 MOS 极性修复 + SW2303/TPS55288 外部 +5V 供电（tps-sw） | 已完成 | `vqp6v:pcb-v1-2-5v-backlight/PLAN.md` | 2026-01-28 | - |
| 9psha | TPS55288 故障中断（INT_TPS）：仅在异常变化时打印 | 已完成 | `9psha:tps-int-fault-log/PLAN.md` | 2026-02-02 | PR #46 |
