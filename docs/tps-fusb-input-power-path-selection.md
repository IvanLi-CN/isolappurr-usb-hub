# `tps-fusb` 输入电源路径选择模块

本文是 `tps-fusb` 输入电源路径选择模块的设计、固件和验证规范。模块负责在
`VIN_DC` 与 `VIN_USB` 同时可能存在时，仅允许一路 PMOS 被主动增强导通，
并以 DC 输入优先。本文是该模块的项目文档真相源；总体硬件设计和 MCU 使用
规范只引用本文，不重复维护控制细节。

当前状态：待设计。本文不表示正式原理图、PCB、BOM 或固件已经实现。

## 1. 模块职责与边界

模块输入：

- `VIN_DC`：DC5025 直流输入。
- `VIN_USB`：USB-PD sink 协商后的输入。
- `VIN_DC_SENSE`：DC 输入 ADC 采样。
- 输入侧 FUSB302B 的 VBUS 比较器结果和 PD contract 状态。

模块输出：

- `VIN_SYS`：3.3 V、5 V 和后级 TPS55288 的系统输入母线。
- `PWR_INPUT_EN`：两路 PMOS gate-driver 的总主动增强使能。
- `PWR_INPUT_SEL`：选择 DC 或 USB gate-driver。

模块不负责：

- 实现 USB-PD 协议报文和策略引擎。
- 产生 `VOUT_TPS` 或控制 USB-C 输出 PMOS。
- 提供输入端到 `VIN_SYS` 的双向隔离或理想二极管功能。

## 2. 设计目标

- 任意时刻最多只有一颗输入 PMOS 被 gate driver 主动增强。
- 两路输入切换必须 break-before-make，禁止 gate 控制重叠。
- DC 输入有效时优先使用 DC；USB 输入是备用路径。
- 任一路输入均可通过 PMOS 体二极管为 MCU 和低压电源冷启动。
- 同时插入两路输入时，不因 MCU 输出冲突造成两颗 PMOS 同时主动导通。
- 电压无效、测量不确定、MCU 复位或固件故障时回到“不主动增强”状态。

## 3. 电源拓扑

`VIN_DC` 和 `VIN_USB` 各通过一颗反向安装的 PMOS 接到 `VIN_SYS`：

```text
VIN_DC  -> PMOS_DC drain   PMOS_DC source  -> VIN_SYS
VIN_USB -> PMOS_USB drain  PMOS_USB source -> VIN_SYS
```

两颗 PMOS 的体二极管方向均为输入到 `VIN_SYS`。每颗 PMOS 必须具备：

- Gate-Source 上拉，参考 PMOS source=`VIN_SYS`，保证 gate driver 未工作时关断。
- 约 12 V 的 Gate-Source 钳位，限制负向 `VGS`。
- 独立 gate-driver 输入，分别由 SN74LVC1G3157 的 B1/B2 输出控制。

单 PMOS不提供输入隔离。未选输入高于 `VIN_SYS` 时，仍可能通过体二极管向
`VIN_SYS` 供电。模块互锁只约束 gate-driver 的主动增强，不承诺：

- `PWR_INPUT_EN=0` 时输入与 `VIN_SYS` 断开。
- 未选输入电流为零。
- `VIN_SYS` 电压严格等于主动选择输入的电压。

如果未来要求阻断未选输入体二极管电流，必须改为背靠背 MOSFET、ideal-diode
controller 或具备 reverse-current blocking 的 load switch，并重新制定规范。

## 4. SN74LVC1G3157 连接

SN74LVC1G3157 只路由一个总使能信号，使 MCU 无法通过两根独立 GPIO 同时
命令两路主动增强。

| Pin | 器件功能 | 网络 / 连接 | 要求 |
| ---: | --- | --- | --- |
| 1 | `B2` | USB gate-driver enable | 外部默认下拉 |
| 2 | `GND` | `GND` | 完整地平面 |
| 3 | `B1` | DC gate-driver enable | 外部默认下拉 |
| 4 | `A` | `PWR_INPUT_EN` | MCU GPIO33 |
| 5 | `VCC` | `3V3` | 就近 `100nF` 去耦 |
| 6 | `S` | `PWR_INPUT_SEL` | MCU GPIO34 |

正式原理图必须使用与上述 pin mapping 一致的器件封装；替换制造商或封装时
必须重新核对 pin 号，不得只按逻辑符号名称连线。

## 5. MCU 接口与初始状态

| MCU 资源 | 网络 | 方向 | 最早初始化状态 | 用途 |
| --- | --- | --- | --- | --- |
| GPIO1 / ADC1_CH0 | `VIN_DC_SENSE` | 模拟输入 | 高阻，无数字上下拉 | DC 输入测量 |
| GPIO33 | `PWR_INPUT_EN` | 推挽输出 | Low | 禁止两路主动增强 |
| GPIO34 | `PWR_INPUT_SEL` | 推挽输出 | Low | 预选 DC，不产生增强动作 |

GPIO33 必须在固件最早 GPIO 初始化阶段设为 Low。B1/B2 的外部下拉必须确保
MCU 复位、高阻、下载模式或崩溃重启期间，两颗 PMOS 均不被主动增强。

## 6. 主动增强真值表

| `PWR_INPUT_EN` | `PWR_INPUT_SEL` | DC PMOS | USB PMOS | 说明 |
| --- | --- | --- | --- | --- |
| 0 | X | 不主动增强 | 不主动增强 | 体二极管路径仍存在 |
| 1 | 0 | 主动增强 | 不主动增强 | DC 主动路径 |
| 1 | 1 | 不主动增强 | 主动增强 | USB 主动路径 |

本表描述的是 gate 控制状态，不是完整电流路径真值表。

## 7. 输入测量

### 7.1 DC 输入

`VIN_DC` 通过 `3 x 100kOhm` 串联上臂和 `20kOhm` 下臂进入
`GPIO1/ADC1_CH0`，ADC 节点对地并联 `100nF`：

```text
VIN_DC -> 100k -> 100k -> 100k -> VIN_DC_SENSE -> 20k -> GND
                                      |
                                    100nF
                                      |
                                     GND
```

- 分压比：1:16。
- 24 V -> 约 1.50 V。
- 36 V -> 约 2.25 V。
- 40 V -> 约 2.50 V。
- 电阻必须按输入耐压、单颗功耗和容差校核，不能只校核总阻值。
- 固件必须使用 ADC 校准、多样本滤波和阈值滞回。

### 7.2 USB-PD 输入

`VIN_USB` 不占用 MCU ADC，由输入侧 FUSB302B 测量：

- 使用 `MEAS_VBUS=1`。
- 配置 MDAC 阈值并读取 `COMP`，通过阈值扫描判断 VBUS 范围。
- 不得用固定约 4 V 的 `VBUSOK` 代替 9 V 有效输入验证。
- 必须同时检查 PD contract 状态，不能只依据比较器结果认定合同成立。

### 7.3 有效输入判定

- 项目最低有效工作输入为 9 V。
- 阈值附近必须使用进入/退出滞回和稳定时间，禁止单样本切换。
- 测量超时、结果冲突或来源状态未知时，输入状态必须为 `Unknown`，不得自动
  开启任一路主动增强。

## 8. 选源策略

优先级固定为 DC 优先：

1. DC 有效时，目标来源为 DC。
2. DC 无效且 USB 已协商并验证至少 9 V 时，目标来源为 USB。
3. 两路均无效或状态不确定时，不主动增强任一路。

选择 DC 前必须先把 USB-PD sink 合同降到 5 V并验证。这样即使 USB 输入仍
通过体二极管参与 `VIN_SYS`，也降低与较高 DC 输入同时存在时的对顶风险。

从 DC 切换到 USB 时，必须先确认 DC 已失效，再协商并验证 USB Fixed/PPS
达到至少 9 V。项目不支持依靠 5 V USB 输入持续工作。

## 9. 固件状态机

建议状态：

| 状态 | GPIO33 | GPIO34 | 含义 |
| --- | ---: | ---: | --- |
| `Off` | 0 | 保持 | 两路均不主动增强 |
| `Evaluating` | 0 | 保持 | 测量/协商中 |
| `DCActive` | 1 | 0 | DC PMOS 主动增强 |
| `USBActive` | 1 | 1 | USB PMOS 主动增强 |
| `Fault` | 0 | 保持 | 故障锁存，不主动增强 |

所有切换必须由唯一的 input-power-selector 状态机执行。PD policy、ADC sampler
和 UI 只能发布状态或请求，禁止直接写 GPIO33/34。

### 9.1 Break-before-make

任意来源切换固定执行：

1. GPIO33=`Low`，禁止两路主动增强。
2. 等待至少 5 ms。
3. 设置 GPIO34 为目标来源。
4. 再次确认目标输入有效且没有故障。
5. GPIO33=`High`，只主动增强目标 PMOS。

不得通过同时更新 GPIO33/34、跳过等待或在 ISR 内切换来缩短流程。

## 10. 故障处理

以下情况必须立即令 GPIO33=`Low`：

- ADC 或 FUSB302B 测量不可用、超时或相互矛盾。
- 目标输入跌破退出阈值。
- PD contract 丢失或 USB VBUS 与合同不一致。
- 状态机检测到非法状态、watchdog 恢复或 brownout 重启。
- gate-driver、电源路径或 `VIN_SYS` 验证出现异常。

故障恢复必须重新从 `Evaluating` 开始，不能直接恢复故障前 GPIO 电平。

## 11. 原理图与 PCB 要求

- 两颗输入 PMOS、VGS clamp、Gate-Source 上拉和 gate driver 按最大输入 40 V、
  浪涌、电流、SOA、热和压降选型。
- SN74LVC1G3157 B1/B2 各自具有默认下拉，VCC 旁放置 `100nF`。
- `VIN_DC_SENSE` 分压器靠近 ADC 侧放置 `20kOhm/100nF`，模拟线远离 TPS55288
  switching nodes 和大 di/dt 回路。
- `PWR_INPUT_EN`、`PWR_INPUT_SEL`、两路 gate-driver 输出和 PMOS gate 网络
  必须使用本文网络名，禁止再引入两根独立 MCU enable 网络。
- 预留 `VIN_DC`、`VIN_USB`、`VIN_SYS`、两颗 PMOS gate 和 GPIO33/34 测试点。

## 12. Bring-up 验收

- [ ] MCU 复位、下载模式和断电期间，两颗 PMOS 均不被主动增强。
- [ ] `EN=0`、`EN=1/SEL=0`、`EN=1/SEL=1` 的 gate 波形符合真值表。
- [ ] DC<->USB 切换的两路 gate 关闭间隔不小于 5 ms。
- [ ] 验证未选高电压输入通过体二极管抬高 `VIN_SYS` 的实际行为和电流。
- [ ] ADC 在 9 V、额定输入和 40 V 边界完成校准、容差和噪声测试。
- [ ] USB 5 V 降合同、9 V 以上升合同和 contract 丢失路径均通过。
- [ ] DC only、USB only、DC+USB、热插拔、brownout 和输入跌落均不出现两路
  同时主动增强。
- [ ] 满载下检查 PMOS 温升、压降、VGS、浪涌和 `VIN_SYS` 稳定性。

## 13. 相关文档

- [`tps-fusb` 总体硬件设计](tps-fusb-hardware-design.md)
- [`tps-fusb` MCU 使用规范](mcu-resource-allocation-tps-fusb.md)
- [`#m7q4v` 长期规格](specs/m7q4v-tps-fusb-dual-pd-hardware/SPEC.md)
