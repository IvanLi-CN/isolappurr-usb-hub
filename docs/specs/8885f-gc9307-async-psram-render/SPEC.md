# GC9307 无闪屏 async 渲染与 PSRAM 双缓冲（#8885f）

## 状态

- Status: 已完成
- Created: 2026-04-14
- Last: 2026-04-30

## 背景 / 问题陈述

- 当前 GC9307 Dashboard 已完成视觉落地，但运行态仍存在明显整屏闪烁。
- 根因已经确认：`/Users/ivan/.codex/worktrees/20b9/isolapurr-usb-hub/src/display_ui/dashboard.rs` 在每个 `500ms` UI tick 上都会先整屏 `fill_color()` 再重绘卡片。
- 现有 `SPI2` 已固定 `40MHz`，但显示与 I2C 上层调用链仍是阻塞式；在 steady-state 下这会把“整屏清空 + 全屏重刷”的观感直接暴露出来。
- 本规格承接 `#j9twf` 与 `#3j4df`：视觉合同保持不变，目标仅限于把渲染/传输路径改成无闪屏实现。

## 目标 / 非目标

### Goals

- 将 GC9307 显示链路改为 async SPI，并保持 `SPI2 @ 40MHz`。
- 使用 PSRAM front/back framebuffer 承载运行态画面，steady-state 仅刷出发生变化的 full-width dirty row bands。
- 将 PD 控制与 INA226 采样链路切到 async I2C，避免“async driver + 阻塞 helper”的半改造状态。
- 保持 Dashboard / toast 的现有视觉、语义、按钮行为与 `500ms` 业务节奏不变。

### Non-goals

- 不重做 Dashboard 视觉、配色、字号、单位或 toast 文案。
- 不改 SPI 引脚、SPI 频率、I2C 引脚、主循环业务节奏与按钮交互语义。
- 不把当前固件重构成新的多任务 UI 架构。

## 范围（Scope）

### In scope

- `esp-hal` PSRAM 初始化与 `esp-alloc` 外部内存分配。
- `gc9307-async` / `ina226` / `sw2303` / `tps55288-rs` async 特性接线。
- `DisplayUi` async 化、PSRAM 双缓冲、dirty-band flush。
- PD I2C allowlist 与 telemetry I2C allowlist 的 async 化。
- Host-side 视觉证据与 spec 索引更新。

### Out of scope

- Web / desktop 代码。
- 新页面、新动效、新图表或历史曲线。
- 真机连线/硬件改板。

## 需求（Requirements）

### MUST

- steady-state Dashboard 路径不得再以“整屏清空 + 全屏重画”方式运行。
- 显示驱动必须通过 async SPI 访问，并保持 `SPI2 @ 40MHz`。
- PD 与 telemetry I2C helper 必须改为 async 调用链，不能停留在阻塞 trait bound。
- front/back framebuffer 必须驻留在 PSRAM；SPI DMA staging buffer 与 DMA descriptors 保持在内部 RAM。
- toast 与显式整页切换允许 full-frame flush；steady-state Dashboard 必须用 dirty row bands 刷新。
- `#3j4df` 定义的 Dashboard 视觉合同必须保持不变。

### SHOULD

- Dashboard 静态底图只生成一次，运行态每帧只重放动态区。
- 第一次进入 Dashboard、toast 覆盖后恢复 Dashboard 时，优先走单次 full flush 收敛，再恢复 steady-state dirty-band 模式。

### COULD

- 后续若有需要，可在同一 framebuffer pipeline 上扩展更多页面，而不再回退 direct-to-panel immediate mode。

## 实现决策（Implementation Notes）

- `DisplayUi::{init, draw_frame, render_snapshot, render_normal_ui, show_toast, show_toast_compact}` 全部改为 async。
- 新的 `CsSpiDevice` 改为基于 `embedded_hal_async::spi::SpiDevice` 的 async CS wrapper；SPI 总线改用 DMA-capable async bus。
- GC9307 `CS` / `RES` 由前面板 TCA9554/TCA9534 兼容 I/O expander 控制：I2C `0x21`，`CS=P6`，`RES=P5`，两者 idle high；MCU `GPIO13` / `GPIO14` 保持默认状态，不再由固件分配给屏幕控制网络。
- `DisplayUi` 内部新增 PSRAM `front/back/dashboard_base` 三块 RGB565 缓冲：
  - `front`：当前已上屏画面
  - `back`：本帧离屏渲染目标
  - `dashboard_base`：Dashboard 静态底图缓存
- steady-state Dashboard 流程：`dashboard_base -> back`，写入动态 chip/文字后，对比 `front/back` 的整行差异，按连续 row band 执行 async flush，再 swap。
- toast/首帧/切页流程：直接 full flush `back`，随后 swap，使前后台保持一致。
- I2C allowlist、SW2303/TPS55288 helper、INA226 sampler 全部切到 `embedded_hal_async::i2c::I2c`。

## 验收标准（Acceptance）

### Build / wiring

- Given 当前仓库默认固件目标
- When 执行 `cargo check --bin isolapurr-usb-hub` 与 `just build`
- Then 两者都必须通过，且 async/PSRAM 特性参与构建。
- Given 显示初始化
- When 固件准备 GC9307 控制脚
- Then TCA `0x21` P6/P5 被置为输出并先保持高电平，且代码不再构造 `GPIO13` / `GPIO14` 输出。

### Display path

- Given steady-state Dashboard 已进入运行态
- When 连续多个 `500ms` tick 刷新电参量
- Then 不再发生整屏 `fill_color()` 式白闪，只刷新发生变化的 full-width row bands。

### I2C path

- Given PD/telemetry helper 被调用
- When 进行 SW2303/TPS55288/INA226 访问
- Then 调用链必须保持 async trait bound 直通到驱动。

### Visual contract

- Given `#3j4df` Dashboard 视觉基线与现有 toast 版式
- When 生成 host-side 预览图
- Then 画面应与当前视觉合同一致，不引入布局/配色漂移。

## Milestones

- [x] 新建 focused spec，并登记 `docs/specs/README.md`
- [x] 打开 PSRAM 与 async 依赖，初始化内部/外部内存
- [x] 将显示链路改为 async SPI + DMA-capable CS wrapper
- [x] 落地 PSRAM 双缓冲 + Dashboard dirty-band flush
- [x] 将 telemetry / PD I2C helper 全量迁到 async
- [x] 完成构建验证与视觉证据落盘

## 验证记录（Validation）

- `cargo check --bin isolapurr-usb-hub`
- `just build`
- Dashboard host preview：复用 `#3j4df` 的 Dashboard framebuffer 预览工具生成并转 PNG
- Toast host preview：复用当前 compact toast 预览脚本生成 PNG

## Visual Evidence

- 已生成 host-side Dashboard steady-state 与 compact toast 预览，并在实现回合内完成本地验收。
- 按主人本回合指示：预览图不纳入本任务仓库产物，也不放入 PR 正文。

## 风险与开放问题

- 真机上的“30 秒无整屏闪烁”与实际 SPI DMA 节奏仍需最终实板 smoke 复核；本回合先完成构建与 host-side 证据。
- PSRAM 分配依赖板载 PSRAM 正常映射；若后续真机发现容量/映射异常，应保持 fail-fast，不静默降级回 internal-RAM 全屏重刷。
