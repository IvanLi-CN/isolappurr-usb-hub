# Buzzer Prompt Tones（提示音）设计

## 背景

目前固件没有“提示音”能力：用户无法通过声音快速获知开机完成、关键异常发生等状态。硬件已集成无源蜂鸣器，因此需要在固件侧增加统一的提示音管理模块，并为关键状态预置可扩展的提示音集合。

## 硬件约束（从网表提取）

- 蜂鸣器网络：`BUZZER` 连接到 ESP32‑S3 的 `GPIO21`。
- 驱动拓扑：`GPIO21(BUZZER)` 驱动 `Q9(SS8050)`（NPN 低边开关），蜂鸣器正端接 `3V3`，负端经 Q9 下拉到 GND；并联有钳位二极管 `D10`。
- 器件标称频率：`2.7kHz`（BOM `BUZZER1: MLT-7525`）。
- 网表未见 Q9 基极串联电阻：固件侧应以“低占空比 + 合理 GPIO 驱动强度”作为保守策略，但软件无法从根本上替代硬件限流。

> 备注：本设计将“轻响度”作为默认目标，避免对 GPIO/Q9 造成不必要风险。

## 目标

- 提供提示音管理模块（非阻塞），支持通过事件触发预设提示音。
- 默认响度偏轻（固定低占空比），不提供音量/静音控制接口。
- **安全风险**：持续报警（循环播放，直到风险解除）。
- 其他异常：仅在“进入异常”时提示一次，但单次提示音**整体时长 ≥ 2s**。
- 开机音：在“初始化完成”后播放；若初始化阶段出现致命失败，则播放对应故障音而非开机音。
- 预置多种提示音，覆盖当前需求并为未来扩展预留空间。

## 范围与非目标

### 范围

- 固件侧新增：蜂鸣器驱动层 + 提示音管理层 + 事件到提示音的映射策略。
- 将既有异常路径（初始化/运行期）挂接到提示音事件（以“状态变化”为主，避免刷屏）。

### 非目标

- 不实现复杂音乐/旋律编曲；提示音以“可辨识、可扩展、低风险”为优先。
- 不新增 Web UI 配置、也不提供运行期静音/音量调节入口。
- 不修改硬件（如补基极电阻）；仅在软件侧采取保守驱动策略并在风险章节明确限制。

## 核心用例 / 用户流程

1) **正常开机**
- 系统完成初始化 → 播放 `BootOk`（≥2s）。

2) **开机阶段出现告警**
- 某些子系统初始化失败但主循环仍可运行 → 播放 `BootWarn`（≥2s），不播放 `BootOk`。

3) **开机阶段出现致命失败**
- 关键路径失败（例如 PD 协调关键芯片不可用）→ 播放 `BootFail`（≥2s），不播放 `BootOk`。

4) **运行期安全风险**
- 进入风险状态 → 启动 `SafetyAlarm`（持续循环）。
- 风险解除 → 立即停止 `SafetyAlarm`（可选：播放一次 `RecoverOnce`，本次不强制接线）。

5) **运行期一般异常**
- 进入异常 → 播放一次 `ErrorOnce/WarningOnce`（≥2s）。
- 异常持续 → 不重复播放。
- 异常恢复 → 默认不提示（可预留恢复提示音）。

## 模块边界与接口形状（概要设计）

本功能拆为两层：硬件驱动层 `buzzer` 与管理层 `prompt_tone`（名称可在实现阶段微调，但职责边界固定）。

### 1) `buzzer`：蜂鸣器驱动层（硬件 PWM）

职责：
- 初始化并绑定蜂鸣器输出引脚（`GPIO21`）。
- 提供“开始输出方波 / 停止输出”的最小接口。
- 输出参数：`freq_hz` + `duty_pct`（占空比用于控制“轻响度”）。
- 确保停止后蜂鸣器不会卡在持续鸣叫状态。

技术路线：
- 优先使用 `esp-hal` 的 `LEDC` 产生 PWM 方波（硬件定时，非阻塞）。
- 实现阶段需评估/接受 `esp-hal` 中 `ledc` API 属于 `unstable`（启用对应 feature）。

### 2) `prompt_tone`：提示音管理层（非阻塞播放 + 策略）

职责：
- 定义提示音 ID（`SoundId`）及默认音效表（`SoundPattern`）。
- 提供事件接口（`SoundEvent`），完成事件到提示音的映射。
- 调度：优先级、抢占、去重/冷却、一次性与持续报警。
- 通过 `tick(now)` 推进播放状态机，保证主循环不被阻塞。

建议接口形状（示意，非实现代码）：
- `notify(event: SoundEvent)`：上报状态变化（进入/退出异常、初始化结果等）。
- `tick(now_ms: u64)`：推进内部状态（处理队列、切换 tone/silence step）。
- `enter_safety(kind)` / `exit_safety(kind)`：显式控制持续报警生命周期（实现时也可用 `notify` 表达）。

## 数据模型（提示音表）

### `SoundPattern` 表达

提示音以“步骤序列”表达，每步为 `Tone(freq_hz, duty_pct, duration_ms)` 或 `Silence(duration_ms)`。

约束：
- `Boot* / WarningOnce / ErrorOnce`：总时长 ≥ 2s。
- `ActionOkOnce / ActionFailOnce`：动作结果提示音，**刻意短促**（<200ms），用于“确认/拒绝”，不参与 ≥2s 约束（详见 `docs/hw-button-action-tones-design.md`）。
- `SafetyAlarm`：循环播放（例如 `Tone(2200Hz, 6%, 300ms)` + `Silence(700ms)`）。
- 默认响度：低占空比（当前默认 `6%`；根据实机试听可在较小范围内调整），且避免长时间高占空比。

### 默认频率与辨识度

- 默认基频：`2200Hz`（器件标称 2.7kHz；默认略偏离共振点以降低“刺耳感”）。
- 为提高可辨识度，可在不同 SoundId 上做轻微频率偏移（例如 1800/2200/2600Hz），但不追求复杂旋律（当前实现统一使用默认基频，偏移属于未来扩展）。

## 默认提示音集合（建议）

> 说明：以下为概要节奏规范；实现时可用常量数组落地。除 `SafetyAlarm` 与 `Action*Once` 外均保证 ≥2s。

| SoundId | 类型 | 频率 | 节奏（示意） | 总时长 | 备注 |
|---|---|---:|---|---:|---|
| `BootOk` | 一次性 | 2200Hz | `短×4 + 长静默` | 2.1s | 正常开机完成 |
| `BootWarn` | 一次性 | 2200Hz | `中×2 + 长静默` | 2.1s | 有降级但可运行 |
| `BootFail` | 一次性 | 2200Hz | `中×3 + 长静默` | 2.1s | 初始化致命失败 |
| `WarningOnce` | 一次性 | 2200Hz | `短×6 + 长静默` | 2.1s | 非安全异常 |
| `ErrorOnce` | 一次性 | 2200Hz | `中×6 + 长静默` | 2.1s | 一般错误 |
| `ActionOkOnce` | 一次性 | 2700Hz | `短×1` | 0.03s | 用户动作成功（短促确认） |
| `ActionFailOnce` | 一次性 | 2700Hz | `短×2` | 0.10s | 用户动作失败（双击拒绝） |
| `SafetyAlarm` | 持续 | 2200Hz | `300ms on / 700ms off` 循环 | 持续 | 安全风险（需持续提示） |
| `RecoverOnce` | 一次性（预留） | — | — | — | 异常恢复提示（本次未接线/未实现 pattern） |

## 事件与映射（覆盖当前需求 + 可扩展）

### 事件分类

- 初始化结果（用于决定是否播放 `BootOk`，以及替换为 `BootWarn/BootFail`）：
  - `InitWarn(reason)`
  - `InitFail(reason)`
  - `InitDone`
- 运行期状态变化：
  - `EnterError(kind)`
  - `ExitError(kind)`（预留）
  - `EnterSafety(kind)`
  - `ExitSafety(kind)`

### 当前固件已知异常源（建议映射）

初始化阶段（累积“最严重级别”，在 `InitDone` 时只播放一次最终结果）：
- INA226 初始化失败 → `InitWarn(Ina226Init)`
- Display init/draw_frame 失败 → `InitWarn(DisplayInit)`
- SW2303 enable profile 3 次失败后放弃 → `InitFail(Sw2303ProfileBoot)`

运行阶段：
- SW2303 I2C read 进入错误态（`sw2303_error_latched: false -> true`）→ `EnterError(Sw2303I2c)`
- TPS55288 apply 进入错误态（`tps_error_latched: false -> true`）→ `EnterSafety(TpsApply)`（持续报警）
- Display render 进入错误态（`ui_error_latched: false -> true`）→ `EnterError(UiRender)`（可降为 Warning）

### 去重/冷却策略

为避免刷屏：
- 一般异常：仅对 `Enter*` 触发一次；持续异常不重复播放。
- 安全风险：进入后持续循环；退出后立即停止。
- 如未来需要“周期提醒”，仅对 `SafetyAlarm` 保留（本次需求已明确：只有安全风险持续响）。

## 调度策略（概要）

- 优先级：`SafetyAlarm` > `BootFail` > `ErrorOnce` > `BootWarn/WarningOnce` > `BootOk` > 其它。
- 抢占：`SafetyAlarm` 必须立即抢占并持续；其它音效可被安全报警抢占。
- 特例（按键反馈）：当 `SafetyAlarm` active/playing 时，`ActionOkOnce/ActionFailOnce` 仍需可被听到；策略为播放动作结果音前**短暂暂停/抑制** `SafetyAlarm`，动作结果音结束后若安全态仍 active 则恢复（不排队、不补播）。
- 队列：固定容量（例如 4–8 项）即可；队列满时丢弃低优先级项（不阻塞主循环）。
- 非阻塞：所有播放通过硬件 PWM 与 `tick()` 状态机推进，不允许 busy-wait 延迟。

## 集成点（与现有主循环对接）

- 建议在 `main` 初始化早期初始化 `buzzer` + `prompt_tone`，确保后续初始化失败也能发声。
- 初始化阶段：在各子系统 init 失败处上报 `InitWarn/InitFail`；初始化流程末尾上报 `InitDone` 以决定播放 `BootOk/BootWarn/BootFail`。
- 运行阶段：复用现有 `*_error_latched` 状态位，在从 `false -> true` 转换时触发 `EnterError/EnterSafety`，从 `true -> false` 时触发 `Exit*`（本次不强制播放恢复音）。

## 兼容性与迁移

- 不改变现有 PD 主循环的功能行为（仅新增旁路提示音模块与事件上报）。
- 不涉及 Web UI、配置文件、存储迁移。
- `no_std`、无堆分配。

## 风险与限制

- **无基极电阻风险**：固件侧必须默认低占空比，并尽量降低 GPIO 驱动强度；避免长时间高占空比持续鸣叫（仅允许在“安全风险”时持续，但仍保持低占空比）。
- `LEDC` 为 `esp-hal` 的不稳定 API：实现阶段需要接受启用 `unstable` feature（或改用其他硬件 PWM 外设；本设计默认选 LEDC 以简化非阻塞播放）。

## 验收标准（冻结为实现基线）

- 正常启动：初始化完成后播放 `BootOk`（≥2s），且不阻塞主循环。
- 初始化存在告警：播放 `BootWarn`（≥2s），不播放 `BootOk`。
- 初始化致命失败：播放 `BootFail`（≥2s），不播放 `BootOk`。
- TPS apply 进入错误态：立即开始 `SafetyAlarm` 循环；恢复后立即停止。
- 其它异常进入：播放一次对应提示音（≥2s）；异常持续期间不重复播放。
