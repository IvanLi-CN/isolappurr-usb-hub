# GC9307 正常界面规范（#0001）

## 状态

- Status: 已完成
- Created: 2026-01-07
- Last: 2026-03-10
- Legacy Plan: `docs/plan/0001:gc9307-normal-ui/PLAN.md`

## 目标

- 在 GC9307 屏幕上稳定显示 USB-A 与 USB-C 的电压、电流、功率。
- 保持既有的布局、刷新周期、颜色、present 判定与 INA226 校准规则。
- 在现场出现地址异常兼容件时，优先使用设计地址，失败后回退到兼容地址，避免单口遥测完全丢失。

## 范围

### In scope

- 两列三行 V/I/P 正常界面
- INA226 遥测初始化与采样
- U13/U17 的地址解析与校准写入

### Out of scope

- PD 协议流程与 SW2303 控制逻辑
- USB-C present 判定规则
- Web UI 与 HTTP API

## 需求

### MUST

- USB-A 遥测主地址为 `0x40`，USB-C 遥测主地址为 `0x41`。
- 地址解析必须优先尝试主地址；仅当主地址初始化失败时，才允许回退。
- USB-A 回退地址为 `0x44`；该地址仅用于现场出现的 counterfeit/clone 兼容件。
- USB-C 回退地址为 `0x45`；该地址仅用于现场出现的 counterfeit/clone 兼容件。
- 一旦某口完成地址解析，后续该口的配置写入、校准写入、采样都必须使用解析后的地址。
- `USB-A` present 判定保持不变：有效电压 `< 1.0V` 视为未插入。
- `USB-C` present 判定保持不变：继续使用 `SW2303` 协议激活状态，不得改成基于 keep-alive 或 INA226 电压。
- INA226 校准参数保持不变：
  - U13：`Current_LSB=62µA/bit`，`Calibration=8258`
  - U17：`Current_LSB=107µA/bit`，`Calibration=4785`

## 验收标准

- Given：U13 在 `0x40` 正常应答
  When：固件启动并初始化遥测
  Then：USB-A 使用 `0x40`，不得访问 `0x44`。
- Given：U13 在 `0x40` 初始化失败但 `0x44` 可用
  When：固件启动并初始化遥测
  Then：USB-A 自动回退到 `0x44`，后续采样使用 `0x44`。
- Given：U17 在 `0x41` 正常应答
  When：固件启动并初始化遥测
  Then：USB-C 使用 `0x41`，不得访问 `0x45`。
- Given：U17 在 `0x41` 初始化失败但 `0x45` 可用
  When：固件启动并初始化遥测
  Then：USB-C 自动回退到 `0x45`，后续采样使用 `0x45`。
- Given：现场板卡存在 `U13=0x40`、`U17=0x45`
  When：固件启动
  Then：日志中应能看到解析结果 `usb_a=64`、`usb_c=69`。

## 里程碑

- [x] M1: 冻结正常界面布局、格式、颜色与校准规则
- [x] M2: 实现双口 INA226 遥测采样
- [x] M3: 增加 INA226 地址 fallback 兼容策略

## Change log

- 2026-03-10：补充 `docs/specs`，并同步 INA226 地址 fallback 规则：`0x40 -> 0x44`、`0x41 -> 0x45`。
