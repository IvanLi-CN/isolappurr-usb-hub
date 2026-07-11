# History

## 2026-07-11

- 新增与 `tps-sw` 并存的 `tps-fusb` variant，状态为待设计，不建立
  supersede 关系。
- 决定以两颗 FUSB302B 作为 input sink 和 TPS output source 的 PD PHY，
  两侧均由 MCU 实现 PD 3.0 Fixed + PPS。
- 冻结 `VIN_DC` / `VIN_USB` 单一使能一选一、DC 优先和至少 5 ms
  break-before-make 合同。
- 冻结 `VIN_DC_SENSE` 1:16 分压、输入侧 FUSB302B VBUS 测量和 9 V
  最低有效输入策略；明确 USB 电压验证使用 `MEAS_VBUS/MDAC + COMP`
  阈值扫描，不使用固定 `VBUSOK`。
- 冻结单 PMOS `VOUT_TPS -> VBUS_TPS` 开关；接受关断时
  `VBUS_TPS -> VOUT_TPS` 体二极管反灌，但限制在 TPS55288 25 V
  绝对最大边界内。
- 冻结 GPIO1、GPIO33 至 GPIO38 的 `tps-fusb` 分配；FUSB302B 总线归属
  和 GPIO39/40 用途留待正式网表。
- 决定两版硬件分别构建独立编译期 firmware profile。
- 将两版 MCU 引脚分配拆成独立文档：`tps-sw` 记录当前正式网表，
  `tps-fusb` 区分已冻结变更、计划沿用项和待正式网表确认项。
