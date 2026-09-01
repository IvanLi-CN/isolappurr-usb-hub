# `fusb302` crate 的 USB-C Source 可行性

## 结论

**可以，但仅限 PHY 层：`fusb302` 0.1.0 已提供配置 FUSB302B 为 USB-C
Source/DFP 以及收发 USB-PD 物理报文的 API。它不是可直接启用的完整 PD
Source 实现。**

因此，若问题是“该 crate 能否驱动 FUSB302B 作为 Source PHY”，答案是**能**；
若问题是“引入该 crate 后能否立刻作为本产品的 USB-PD Source 对外供电”，答案是
**不能，仍须实现并完成硬件在环验证**。Sink 已验证不等价于 Source 已验证。

| 层级 | 结论 | 边界 |
| --- | --- | --- |
| `fusb302` 0.1.0 API | 支持 Source PHY | Source role、DFP、Rp、VCONN、Source toggle、PD FIFO TX/RX 已有 typed API；不含 PD policy 或 VBUS 控制。 |
| FUSB302B 芯片 | 支持 Type-C Source/DRP 和 USB-PD 2.0 PHY | 芯片是 PHY/controller，不生成或调节 VBUS；官方资料不把 PD 3.0 的 GoodCRC revision encoding 标为可用。 |
| 本仓库 `tps-fusb` | 设计上预留了 Source 端 | `U11`、TPS55288 和输出 PMOS 构成预期路径，但 profile、PD 状态机、PCB/BOM 和 HIL 都尚未完成。 |

## 已有 crate API 证据

发布版为 [`fusb302` 0.1.0（crates.io）](https://crates.io/crates/fusb302/0.1.0)，
其 API 文档明确将自身定义为 FUSB302B 的 Type-C/PD BMC **PHY driver**，并明确
排除 PD policy、contract negotiation 和 power-management decisions
([docs.rs crate documentation](https://docs.rs/fusb302/0.1.0/fusb302/))。

以下接口足以让上层状态机把端口配置为 Source PHY：

- [`PowerRole::Source`、`DataRole::Dfp` 和 `PhyConfig`](https://docs.rs/crate/fusb302/0.1.0/source/src/types.rs)
  允许发送 PD 报文与硬件 GoodCRC 采用 Source/DFP header bits；
  [`configure_phy`](https://docs.rs/crate/fusb302/0.1.0/source/src/driver.rs) 会把这些显式
  配置写到 `SWITCHES1`。
- [`CcPull::Up` 和 `set_cc_pull`](https://docs.rs/crate/fusb302/0.1.0/source/src/registers.rs)
  / [`driver.rs`](https://docs.rs/crate/fusb302/0.1.0/source/src/driver.rs) 提供 Rp；
  同一 driver 提供 `set_measure_cc`、`set_tx_cc` 与 `set_vconn`，覆盖 attach
  判断、选定 CC 上的 BMC 与 VCONN 开关。
- [`ToggleMode::Source` 和 `start_toggle`](https://docs.rs/crate/fusb302/0.1.0/source/src/registers.rs)
  / [`driver.rs`](https://docs.rs/crate/fusb302/0.1.0/source/src/driver.rs) 映射为 FUSB302B
  的 DFP/Source autonomous toggle。
- [`transmit`、`receive` 与 `transmit_hard_reset`](https://docs.rs/crate/fusb302/0.1.0/source/src/driver.rs)
  提供原始 PD packet FIFO transport，因而上层可以发送 Source_Capabilities、接收
  Request，并执行 Hard Reset。

上游的 I2C mock test 显式构造 `PowerRole::Source + DataRole::Dfp` 并断言
`configure_phy` 的寄存器事务
([test source](https://github.com/IvanLi-CN/fusb302-rs/blob/b622a72f72071dd75058bb2e068b264cd6be9cb0/tests/driver.rs#L100-L133))。
这证明了 Source 配置代码路径；它是 mock 测试，**不是 Source 端口的电气或
互操作性验证**。发布包及可访问的上游文档没有提供可复核的 Source 真机/HIL
结果；crate 自己也把 physical hardware validation 留给 downstream firmware。

### API 的实际缺口

- `PhyConfig::default()` 是 `PowerRole::Sink`/`DataRole::Ufp`，Source 必须由调用方
  显式配置，不能沿用 Sink 初始化。
- 当前 public API 只提供 `set_host_current_default()`；没有选择 1.5 A 或 3 A
  Type-C Rp advertisement 的 API。FUSB302B 虽有对应硬件档位，产品若要在未完成
  PD 合同前宣告非默认电流，应先扩展 crate 的 typed API，而不是绕过其封装写寄存器。
- crate 不解析 PDO/Request，不维护 message ID、计时器或 attach/contract state machine，
  不选择 Source capabilities，也不根据 Request 调整电压/电流。
- crate 不控制外部调节器、VBUS 开关、反灌保护或过流功率路径；这些是应用/板级责任。

## FUSB302B 芯片能力与限制

ON Semiconductor 的
[FUSB302B datasheet](https://www.onsemi.com/pdf/datasheet/fusb302b-d.pdf) 明确说明：

- 芯片可软件配置为 dedicated host、dedicated device 或 DRP，具有 autonomous
  DRP toggle；其 Type-C host 功能包含 attach/detach detection 与 current-capability
  indication（第 1、6--10 页）。这支撑 Type-C Source/DFP 用法。
- `SWITCHES0.PU_EN*` 是 host pull-up（Rp），`CONTROL0.HOST_CUR` 支持 default、
  1.5 A、3 A 三个 Type-C current advertisement 档位（第 19--20 页）。
- `SWITCHES1.POWERROLE=1` 使自动 GoodCRC 的 SOP header 标记为 Source，且
  `TXCC*` 选择 BMC 发射 CC（第 19 页）。这与 crate 的 `PowerRole::Source` 和
  `set_tx_cc` 对应。
- 官方 Source flow 要求 host software 在 attach 后根据插入方向配置芯片，并启用
  **VBUS 和 VCONN**（第 9 页）。FUSB302B 的 VBUS 管脚是用于 upstream-facing
  device attach/detach detection 的输入，并非可调的 VBUS 电源输出（第 5 页），
  所以 Source 的电源调节、开关和保护必然在芯片外。
- 官方声明的 PD 能力是 **USB PD 2.0, Version 1.2**；`SPECREV=10`（PD 3.0）在
  `SWITCHES1` 定义中标为 **“Do Not Use”**（第 1、19 页）。

因此，FUSB302B 本身可用作 PD 2.0 Source PHY，但不能仅凭芯片或 crate 宣称
PD 3.0/PPS Source 已受支持。crate 的 `PdRevision::Rev30` 只是针对
FUSB302BMPX 的显式 compatibility opt-in；其文档也要求目标硬件验证
([`PdRevision` source](https://docs.rs/crate/fusb302/0.1.0/source/src/registers.rs))。
在没有针对实际芯片、线缆和对端设备的 HIL 结果前，应保持 PD 2.0 结论，不将
PD 3.0 Fixed 或 PPS 列为已验证能力。

## 对本仓库硬件的含义

当前硬件是 `tps-sw`，不含 FUSB302B。`tps-fusb` 是“网表已归档，待验证”的下一版，
不可把其设计意图当作可交付能力
([hardware variant status](hardware-variants.md))。

`tps-fusb` 对 Source 的板级分工已定义：

- `U11` 是 `VBUS_TPS` USB-C 输出的 FUSB302B Source PHY；ESP32-S3 必须实现 PD
  协议与策略，TPS55288 负责电压和限流
  ([hardware design](tps-fusb-hardware-design.md))。
- 输出由 `VOUT_TPS -> VBUS_TPS` 的 PMOS 和 `GPIO36/TPS_USB_C_VBUS_EN` 控制；
  检测到外部 VBUS 时必须保持 PMOS 关闭且禁用 TPS，不能与外部电源对打
  ([output-switch safety contract](tps-fusb-hardware-design.md))。
- `U11` 位于独立 I2C1，`INT` 与 INA226/TPS55288 告警共享；FUSB302B 的 VBUS
  正常工作上限为 21 V，固件不得把 `VIN_DC` 的 28 V 额定范围当作可协商的 USB-PD
  VBUS 范围 ([MCU resource contract](mcu-resource-allocation-tps-fusb.md))。
- 仓库当前仍缺 `tps-fusb` firmware profile、两颗 FUSB302B 驱动、PD 3.0 Fixed +
  PPS sink/source stack、输出 PMOS/VBUS 检测/反灌策略，以及 PCB/BOM/电气 HIL
  验证 ([implementation status](specs/m7q4v-tps-fusb-dual-pd-hardware/IMPLEMENTATION.md))。

## 建议的实施与验证边界

把 `fusb302` 用于 `U11` 时，上层 Source state machine 至少应完成以下职责：

1. 从安全态开始：TPS OE off、输出 PMOS off；配置 `PowerRole::Source`、DFP、
   CC Rp、正确的 TX CC 和必要的 VCONN/interrupt masks。
2. 仅在 Type-C Source attach 已确认且 VBUS 无外部驱动时，先建立受保护的 5 V
   VBUS；随后处理 PD 物理报文。
3. 生成并发送 Source_Capabilities，验证 Request 和 source budget，再由 TPS55288
   设定电压/限流，并在规定时限内使 VBUS 稳定后发送 Accept/PS_RDY。
4. 处理 detach、Soft/Hard Reset、错误重试、over-current、TPS fault、VBUS 异常和
   反灌；任一故障回到 PMOS off/TPS disabled。
5. 先做 PD 2.0 Source HIL（5 V default current、attach/detach、Request、reset、
   fault/replug）；只有在逐个对端和线缆验证后，才评估 PD 3.0/PPS 与非默认 Type-C
   current advertisement。

## 判定

`fusb302` 可以作为本项目 Source 实现的 **底层 FUSB302B PHY 驱动**，且现有 API
已覆盖开始 Source bring-up 的关键寄存器/FIFO 操作。它不能替代输出 PD policy 和
受控 VBUS power path。对于本仓库，下一步是实现独立 `tps-fusb` Source 状态机与
板级安全联动，并以 PD 2.0 Source HIL 作为首个验收门槛；当前不应宣称完整
PD 3.0/PPS Source 已支持或已验证。

## 参考

- [`fusb302` 0.1.0 on crates.io](https://crates.io/crates/fusb302/0.1.0)
- [`fusb302` 0.1.0 API on docs.rs](https://docs.rs/fusb302/0.1.0/fusb302/)
- [`fusb302-rs` upstream repository](https://github.com/IvanLi-CN/fusb302-rs)
- [FUSB302B official datasheet (ON Semiconductor)](https://www.onsemi.com/pdf/datasheet/fusb302b-d.pdf)
