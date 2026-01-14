# CH442E 短按重插 / 长按断电（USB‑A 左键，USB‑C 右键）（#0002）

## 状态

- Status: 已完成
- Created: 2026-01-08
- Last: 2026-01-14

## 背景 / 问题陈述

- 现状：目前固件缺少“按键→USB 口动作”的稳定交互，无法快速让主机侧感知“重新插拔”（重枚举），也缺少一键断电的恢复手段。
- 目标：利用 `CH442E`（USB2.0 数据开关）实现“短按＝数据断开一段时间以触发重枚举”，并用“长按＝断电”作为更强硬的恢复动作；同时在屏幕上提示状态变化，并用提示音确认/拒绝动作结果。

## 目标 / 非目标

### Goals

- **短按（100–500ms）**：触发“数据重插（Data Replug）”——断开 D+/D- 一段时间，再恢复连通，使主机认为设备重新插拔。
- **长按（1000–3000ms）**：触发“断电（Power Off）”——在**松开后**执行断电；后续再短按或长按恢复供电（Power On）。
- 左键控制 **USB‑A**，右键控制 **USB‑C**。
- 状态变化时屏幕显示**可读、可测试**的状态信息。
- 动作生效后播放“操作确认”音；动作被拒绝/不可用时播放“操作拒绝”音。
- 产出：界面效果图 + 两个操作音的 MIDI 试听音频（放入本 Plan 的设计资源中）。
  - 设计资源要求：效果图必须为 **GC9307 像素级渲染（320×172，tile/字形与固件一致）**；操作音需提供 **WAV** 试听音频（与蜂鸣器参数一致的近似听感）。

### Non-goals

- 不在本计划中变更 PD 协议策略、功率协商策略（除“断电”导致的必然中断外）。
- 不新增 Web UI 配置入口（可在后续计划中加入）。
- 不做“按键点击音”（按下瞬间音）；只做结果音（符合既有 `prompt_tone` 设计）。

## 用户与场景（Users & Scenarios）

- 使用者在桌面环境（Windows/macOS/Linux）遇到 USB 设备异常，想快速触发重枚举：
  - 轻按即可“像拔插一样”刷新连接；
  - 若仍无效，再长按断电（强制重置下游设备）。
- 使用者不盯屏也能通过提示音确认操作是否被接受。

## 范围（Scope）

### In scope

- 物理按键：`BTNL(GPIO1)` / `BTNR(GPIO0)` 的去抖、按下/松开与按压时长识别（短按/长按）。
- 端口映射（适用硬件：`tps-sw`）：
  - USB‑A（左键）：数据开关 `P1_CED`（CH442E `IN`：低=连通， 高=断开/NC）；电源开关 `P1_EN#`（`CH217K`，低有效）。
  - USB‑C（右键）：数据开关 `P2_CED`（CH442E `IN`：低=连通， 高=断开/NC）；电源断开 `CE_TPS`（高有效，拉低 TPS55288 的 EN/UVLO）。
- 每口状态机：`Power=On/Off`、`Data=Connected/Disconnected/Pulsing`、`Busy` 与拒绝原因。
- 屏幕提示：状态变化的 toast/overlay（不破坏现有“正常界面”基线）。
- 提示音：复用 `PromptToneManager` 的 `SoundEvent::ActionOk` / `SoundEvent::ActionFail`。
- 设计资源：效果图（`images/`）与 MIDI（`audio/`）。

### Out of scope

- 自动识别“主机是否已重枚举成功”的闭环（只保证物理层断开/恢复与提示）。
- 端口动作的持久化配置（断开时长、阈值）与升级迁移。

## 需求（Requirements）

### MUST

- **CH442E 控制语义（来自数据手册）**：
  - CH442E 具有 `EN#`（全局使能，低有效）与 `IN`（选择脚，高电平选 `S2x`，低电平选 `S1x`）。
  - 在 `tps-sw` 网表中：
    - `P1_CED/P2_CED` 连接到 CH442E 的 `IN`（pin1）
    - `EN#`（pin9）连接到 `GND`（常使能）
    - `S2B/S2C`（pin3/pin7）未连接（NC）
  - 因此本计划将 CH442E 当作“**单一通断开关**”使用：通过 `IN` 选择“连接端（S1x）/断开端（S2x=NC）”，实现 D+/D- 同步连通/断开。
- **Data Replug 断开时长（默认值，待实机验证后可微调）**：
  - `DATA_DISCONNECT_MS = 250ms`（默认）
  - 备注：USB Hub/Host 对“端口连接变化”的识别存在去抖/稳定窗口；默认值选择偏保守，优先保证“主机确实认为已拔插”。
    - 经验/实现依据：USB2 hub/host 常见连接去抖窗口为 `~100ms` 级别；过短的断开脉冲可能被当作毛刺忽略。
    - Linux `drivers/usb/core/hub.c` 的 USB2 去抖实现使用 `HUB_DEBOUNCE_STABLE=100ms`（并在注释中引用 USB2.0 spec 7.1.7.3），因此默认取 `250ms` 以跨过该窗口并留余量：<https://android.googlesource.com/kernel/common/+/71761b36c37ae15a09fdd4d4adcc98bb939c426c/drivers/usb/core/hub.c>
- **SafetyAlarm 交互策略（主人已确认）**：
  - 当 `SafetyAlarm`（安全报警音）正在播放时，按键动作的结果反馈（`ActionOk/ActionFail`）**不得被抑制**。
  - 为确保可感知反馈：播放 `ActionOk/ActionFail` 前应**暂停/抑制** `SafetyAlarm`；播放完成后若安全态仍然 active，则恢复 `SafetyAlarm`（不排队、不补播旧事件）。
- **按压时长判定（以稳定态为准）**：
  - `100–500ms` ⇒ Short press（短按）
  - `1000–3000ms` ⇒ Long press（长按）
  - 其它时长 ⇒ Reject（拒绝），不得改变端口状态
- **触发时机**：
  - 短按：在**松开时**触发（便于统一判定与减少误触）。
  - 长按：在**松开时**触发（符合“松开后再断”的需求）。
- **短按行为（Data Replug）**：
  - 若该口 `Power=On`：断开该口 D+/D-，保持 `DATA_DISCONNECT_MS`，再恢复连通。
  - 若该口 `Power=Off`：短按不执行 Data Replug，而是执行 Power On（恢复供电）。
- **长按行为（Power Off/On）**：
  - 若该口 `Power=On`：执行 Power Off（松开后断电）。
  - 若该口 `Power=Off`：执行 Power On（松开后上电）。
- **Busy/互斥**：
  - 同一端口在 `Data Replug` 进行中或电源切换窗口内，再次触发应 Reject（避免抖动与不可预测）。
- **屏幕提示**：
  - 动作被接受并生效时，显示：端口（A/C）、动作类型（Replug/Power Off/Power On）、关键参数（例如断开时长）。
  - 动作被拒绝时，显示：端口（A/C）+ 拒绝原因（例如 `invalid-duration` / `busy` / `safety-active`）。
  - Data Replug 完成恢复连通时，必须显示一次“恢复（DATA ON）”提示（toast/overlay）。
- **提示音**：
  - 只在动作“生效后”播放：`ActionOk`。
  - 当动作被拒绝或不可用时播放：`ActionFail`。

### SHOULD

- `DATA_DISCONNECT_MS` 提供一个保守默认值，并允许后续在实现阶段用常量/配置统一调整。
- UI toast 显示时长固定（例如 1–2s），并在新事件到来时覆盖旧 toast（不排队、不积压）。
- 断电时隐式确保数据路径也处于断开（避免“无电但数据线半连接”的边界态）。

### COULD

- 长按期间给出“长按进度”提示（例如屏幕进度条/状态字）。
- 将“短按/长按阈值”做成可配置（例如编译期常量）。

## 设计：状态机（建议形状）

每个端口一个状态机（USB‑A 与 USB‑C 各一份，互不影响）：

- `PowerState`：`On | Off`
- `DataState`：`Connected | Disconnected | Pulsing(until_ms)`
- `GateState`：`Idle | Busy(reason, until_ms)`

规则摘要：

- `Power=Off` 时强制 `Data=Disconnected`（或视为不可用），短按/长按统一作为“恢复供电”入口。
- `Pulsing` 完成后自动回到 `Connected` 并提示“恢复”（是否提示由主人决策，见开放问题）。

## UI 设计（效果图）

> 说明：以下为 **像素级渲染** 预览图（320×172 PNG），用于冻结“屏幕提示”的字符布局与视觉效果；渲染方式复用固件的 6×8 glyph → 24×48 tile 的方法。

- USB‑A（左键）
  - Data Replug：断开提示：![](images/gc9307-action-usb-a-dataoff.png)
  - Data Replug：恢复提示：![](images/gc9307-action-usb-a-dataon.png)
  - Power Off：![](images/gc9307-action-usb-a-pwroff.png)
  - Power On：![](images/gc9307-action-usb-a-pwron.png)
  - Reject（busy）：![](images/gc9307-action-usb-a-busy.png)
  - Reject（invalid duration）：![](images/gc9307-action-usb-a-badtime.png)
- USB‑C（右键）
  - Data Replug：断开提示：![](images/gc9307-action-usb-c-dataoff.png)
  - Data Replug：恢复提示：![](images/gc9307-action-usb-c-dataon.png)
  - Power Off：![](images/gc9307-action-usb-c-pwroff.png)
  - Power On：![](images/gc9307-action-usb-c-pwron.png)
  - Reject（busy）：![](images/gc9307-action-usb-c-busy.png)
  - Reject（invalid duration）：![](images/gc9307-action-usb-c-badtime.png)

## 操作提示音（MIDI 试听）

- “操作确认”：`audio/action-confirm.mid`
- “操作拒绝”：`audio/action-deny.mid`
- WAV 试听（用于实际听感确认）：
  - “操作确认”：`audio/action-confirm.wav`
  - “操作拒绝”：`audio/action-deny.wav`

> 备注：MIDI/WAV 用于试听与对比；实际蜂鸣器以 `PromptToneManager` 的 `ActionOkOnce/ActionFailOnce` pattern 为准。

## 验收标准（Acceptance Criteria）

- **短按触发数据重插**
  - Given：USB‑A 处于 `Power=On` 且 `Gate=Idle`
  - When：左键一次按压时长在 `100–500ms` 内并松开
  - Then：
    - 立即显示 toast：`USB‑A DATA OFF (t ms)`（或等价文案），并播放 `ActionOk`。
    - `P1_CED` 进入“断开”态（`IN=High`）持续 `DATA_DISCONNECT_MS` 后恢复连通（`IN=Low`）。
    - 恢复连通后显示 toast：`USB‑A DATA ON`（或等价文案）。
- **长按触发断电（松开后断）**
  - Given：USB‑A 处于 `Power=On` 且 `Gate=Idle`
  - When：左键按压 `1000–3000ms` 后松开
  - Then：在松开时执行断电（`P1_EN#` 进入 disable 逻辑态）；屏幕显示 `USB‑A Power Off`；播放 `ActionOk`。
- **断电状态下恢复**
  - Given：USB‑A 处于 `Power=Off`
  - When：左键短按或长按并松开
  - Then：恢复供电；屏幕显示 `USB‑A Power On`；播放 `ActionOk`。
- **非法时长拒绝**
  - Given：任一端口 `Gate=Idle`
  - When：按压时长落在 `0–99ms`、`501–999ms`、`>3000ms`
  - Then：不改变电源/数据状态；屏幕提示 `invalid-duration`；播放 `ActionFail`。
- **Busy 拒绝**
  - Given：端口处于 `Pulsing` 或电源切换窗口内
  - When：再次触发短按/长按
  - Then：不改变既有动作进度；屏幕提示 `busy`；播放 `ActionFail`。
- **左右键映射**
  - Given：左右键各执行一次短按
  - Then：左键仅影响 USB‑A（`P1_*`）；右键仅影响 USB‑C（`P2_*` / `CE_TPS`）。
- **SafetyAlarm 下仍可感知按键反馈**
  - Given：系统处于 `SafetyAlarm` 播放状态
  - When：触发一次按键动作（短按或长按）并产生 `ActionOk` 或 `ActionFail`
  - Then：`SafetyAlarm` 被暂停/抑制，`ActionOk/ActionFail` 可被清晰听到；播放结束后若安全态仍 active，则恢复 `SafetyAlarm`。

## 里程碑（Milestones）

- [x] M1: 冻结交互口径（短按/长按阈值、非法区间行为、Busy 策略）
- [x] M2: 冻结端口硬件映射与电平极性（`P1_CED/P2_CED`、`P1_EN#`、`CE_TPS`）
- [x] M3: 冻结 UI 文案与显示策略（toast 持续时间与文案规范）
- [x] M4: 产出界面效果图与 MIDI 试听资源（`images/`、`audio/`）
- [x] M5: （impl）固件实现：按键时长识别 + 端口状态机 + CH442E/电源控制 + UI toast + 提示音
- [x] M6: （impl）实机验收：Windows/macOS/Linux 至少一种主机侧验证“短按可触发重枚举”；验证断电/恢复与拒绝提示

## 风险与开放问题（Risks & Open Questions）

- **重枚举时长不确定**：不同主机/设备/Hub 对“断开多久才算拔插”敏感度不同；本计划给出默认值，但仍需在目标主机侧做一次实测确认。
- **SafetyAlarm 被短暂打断**：为确保“按键反馈可被感知”，需要允许 `ActionOk/Fail` 暂停报警音；该设计会降低报警的“连续感”，但时长很短且可恢复。
- **GPIO0 启动风险**：右键为 `GPIO0`（已在既有设计中提示）；上电/复位时按住右键可能影响启动模式。
- **USB‑C 断电范围**：`CE_TPS` 拉低 TPS55288 的 EN/UVLO 会同时影响 SW2303 供电与 VBUS；是否需要额外把 USB‑C 数据开关也置断开以形成更干净的“全断开态”？

## 开放问题（需要主人决策）

- 无。

## 假设（Assumptions）

- 非法区间一律 Reject（播放拒绝音），避免“按太久/太短导致意外断电”。
- Data Replug 完成后显示一次“恢复（DATA ON）”toast，不再播放额外提示音。

## 原始输入（摘录）

> 我们有使用 CH442E 作为 USB 2.0 的数据开关。 我希望通过短按（100-500ms） 实现信号断开一定时间（能让主机认为重新插拔 USB 设备），长按（1000ms~3000ms）用来断开电源（松开后再断，然后再短按或长按恢复）。 左键控制 USB A，右键控制 USB C。 状态变化时屏幕上需要有关状态信息，按键功能生效后需要播放“操作确认”音，按键功能被拒绝或不可用时应播放“操作拒绝”音。 记得需要先做界面效果图以及两个操作音的 MIDI 试听音频，并放在相关设计文档中。

## 参考（References）

- `docs/netlist/tps-sw-checklist.md`（CH442E / CH217 / TPS55288 网表证据与注意事项）
- `docs/hw-button-action-tones-design.md`（动作结果提示音设计：成功单击/失败双击）
- `docs/buzzer-prompt-tones-design.md`（提示音模块策略与安全报警抑制）
- `src/bin/main.rs`（已存在按键去抖、`CE_TPS` 逻辑说明）
- CH442E 数据手册（WCH CH440/CH442/CH443/CH444/CH445/CH448 手册；LCSC PDF `620B9380...2617B.pdf`）：
  - CH442E 章节给出 2 路 DPDT 模拟开关与控制逻辑：`EN#` 为全局使能（低有效），`IN` 为选择脚（高电平选 2# 端 `S2x`，低电平选 1# 端 `S1x`）；本硬件将 `S2x` 悬空以实现“选择即断开”。
- 资源生成脚本：
  - `docs/plan/0002:usb-replug-power-cut/tools/generate_assets.py`（生成像素级 PNG + WAV 试听音频）
