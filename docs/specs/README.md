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
| j9twf | GC9307 正常界面（USB-A + USB-C/PD 双口电参量） | 已完成 | `j9twf-gc9307-normal-ui/SPEC.md` | 2026-06-16 | White-background palette sync plus shared U17 5 A calibration constants and applied-setpoint wording alignment |
| 3xckq | INA226 兼容地址 fallback | 已完成 | `3xckq-ina226-fallback-addresses/SPEC.md` | 2026-03-11 | Depends on `j9twf`; probe-stage Address/Data NAK fallback only |
| 3j4df | GC9307 外壳联动 Dashboard UI | 已完成 | `3j4df-gc9307-shell-dashboard-ui/SPEC.md` | 2026-04-13 | Hardware-validated shell palette, larger header chips, and fixed rounded-chip renderer on GC9307 |
| 8885f | GC9307 无闪屏 async 渲染与 PSRAM 双缓冲 | 已完成 | `8885f-gc9307-async-psram-render/SPEC.md` | 2026-04-14 | Async SPI/I2C + PSRAM front/back framebuffer + dirty-band flush |
| jqapx | SW2303 高压 PPS PDO 缺失定位与修复 | 已完成 | `jqapx-sw2303-pps-high-voltage-pdo/SPEC.md` | 2026-04-15 | Structured PD/PPS capability readback, auto-mode PPS fix, and hardware validation completed |
| dzcaw | USB-C TPS Power Config | 已完成 | `dzcaw-usb-c-tps-power-config/SPEC.md` | 2026-06-16 | SW2303-only persisted power config plus TPS `IOUT_LIMIT` diagnostics/readback semantics, raw U17 PD diagnostics telemetry, and LAN HIL proof |
| 6xrna | 隔离侧 USB 状态指示 | 已完成 | `6xrna-ch318-ledd-upstream-link/SPEC.md` | 2026-05-16 | GPIO18/UP0_PG active-high fault sampling and GPIO6/LEDD active-low ready sampling; hub API exposes isolated status fields |
| u5b2c | USB 通信、固件更新与 Wi-Fi provisioning | 已验证 | `u5b2c-usb-console-provisioning/SPEC.md` | 2026-06-07 | Web Serial, Local USB, EEPROM Wi-Fi config, firmware update, saved-device Hardware page flow, and equal-grade communication path matrix |
| tvhca | USB-C 下行通道路由切换 | 已完成 | `tvhca-usb-c-downstream-route/SPEC.md` | 2026-05-18 | MCU / USB-C route switching, EEPROM persistence, HTTP/USB JSONL API, Web UI, and dual-button shortcut |
| r7m2q | CLI/devd host-tools alignment | 已验证 | `r7m2q-cli-devd-alignment/SPEC.md` | 2026-06-16 | Split `isolapurr-devd` + `isolapurr`, repo-managed workflow truth-source cleanup, maintainer doc routing, and released CLI command contract gates |
| jdyh2 | PR label driven automatic release | 已完成 | `jdyh2-pr-label-release-automation/SPEC.md` | 2026-06-01 | Label Gate, centralized Release workflow, manifest-free version injection, and release failure notifier |
| d8s4n | Source structure guard | 已完成 | `d8s4n-source-structure-guard/SPEC.md` | 2026-06-02 | Source length guard, generated-file exemption, and oversized source split |
| k7p9x | Firmware Validation Contract | 已完成 | `k7p9x-firmware-validation-contract/SPEC.md` | 2026-06-13 | Shared no_std firmware core host tests plus firmware-check validation entrypoint |
| kvbq9 | Web demo surface policy | 已完成 | `kvbq9-web-demo-surface-policy/SPEC.md` | 2026-06-18 | Formal Web verification surfaces locked to production pages, controlled SPA `?demo=true|false`, composite Storybook stories, and spec-owned visual evidence; extra demo pages and page-level stories forbidden |
| kk6gk | Web error states | 已完成 | `kk6gk-web-error-states/SPEC.md` | 2026-06-18 | Standalone page-level 404, missing saved-device error state, and spec-owned full-viewport browser evidence |
