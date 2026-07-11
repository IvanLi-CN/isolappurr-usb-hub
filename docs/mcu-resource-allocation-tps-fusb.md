# `tps-fusb` MCU 资源分配

本文是设计中 `tps-fusb` 的 MCU 资源预算与原理图输入合同，覆盖 GPIO、外设
控制器、I2C 拓扑、中断、ADC、DMA、定时器、通信接口和启动安全态。当前尚无
正式网表和固件；只有“冻结”项可以直接作为设计约束。

## 状态与边界

| 标记 | 含义 |
| --- | --- |
| 冻结 | 已由 [`#m7q4v`](specs/m7q4v-tps-fusb-dual-pd-hardware/SPEC.md) 决定 |
| 候选 | 计划继承 `tps-sw`，尚未由正式网表确认 |
| 待确认 | 存在拓扑或资源冲突，画板前必须闭环 |
| 未实现 | 当前固件不提供该 variant 功能 |

- PD 输入：FUSB302B sink PHY；PD 输出：FUSB302B source PHY + TPS55288。
- MCU 分别实现 PD 3.0 Fixed + PPS sink/source protocol 与 policy。
- 使用独立 `tps-fusb` firmware profile 和镜像，不运行时猜测硬件版本。
- 本文不是正式网表、PCB 完成证明或固件支持声明。

## 控制器资源预算

| MCU 资源 | 预算用途 | 状态 / 约束 |
| --- | --- | --- |
| `I2C0` | 一组 PD PHY/系统设备 | 控制器保留；引脚和成员待确认 |
| `I2C1` | 一组系统设备/PD PHY | 控制器保留；GPIO8/9 为候选 |
| `SPI2` + `DMA_CH0` | GC9307 显示 | 候选继承 |
| `LEDC` timer0/channel0 | GPIO21 蜂鸣器 | 候选继承 |
| `USB_DEVICE` | GPIO19/20 USB Serial/JTAG | 候选继承 |
| `UART0` | GPIO43/44 调试串口 | 候选继承 |
| `ADC1_CH0` | GPIO1 `VIN_DC_SENSE` | 冻结 |
| GPIO interrupt 1 | GPIO7 `INT` | 候选；成员待确认 |
| GPIO interrupt 2 | GPIO38 `INT2` | GPIO/电气合同冻结；成员待确认 |
| PSRAM | 显示缓冲和外部内存 | 候选；容量须实机验证 |

400 kHz 本身不会成为 PD 协议的主要速度瓶颈。真正需要闭环的是同地址器件、
共享总线故障域和长事务抢占；固件必须使用静态 allowlist、短事务和按控制器
串行化，不允许运行时扫描。

## I2C 拓扑门禁

| 设备 | 角色 | 地址 / 速率要求 | 中断要求 |
| --- | --- | --- | --- |
| FUSB302B input | USB-PD sink PHY | 精确 7-bit 地址须按选定料号确认 | 可确定服务的低有效中断 |
| FUSB302B output | USB-PD source PHY | 同地址时必须物理隔离总线 | 可确定服务的低有效中断 |
| TPS55288 | 输出电压/限流 | `0x74` 或硬件选择的 `0x75`；最高 400 kHz | 可共享开漏中断 |
| INA226 x2 | 遥测 | 地址由装配配置；最高 400 kHz | 按正式网表 |
| TMP112 | 温度 | 地址由装配配置；最高 400 kHz | 按正式网表 |
| EEPROM | 配置 | `0x50`；写周期不得阻塞 PD 紧急路径 | 无 |

两颗 FUSB302B 不得仅靠软件“区分角色”。若选定器件不能配置不同的 7-bit
地址，两颗必须分别放在 `I2C0` 和 `I2C1`，或增加经评审批准的 I2C mux。

| 控制器 | SDA / SCL 候选 | 当前决定 | 复用风险 |
| --- | --- | --- | --- |
| `I2C1` | GPIO8 / GPIO9 | 候选继承系统总线 | 设备数量、上拉并联、事务时延 |
| `I2C0` | GPIO39 / GPIO40 | 候选第二组总线 | 与外部 JTAG 冲突 |

GPIO39/40 若冻结为第二组 I2C，调试必须使用 USB Serial/JTAG 或 UART0。
若 Layout 放弃这组引脚，正式网表与 firmware profile 必须同时给出替代方案。

## 中断资源

| 网络 | GPIO | 电气合同 | 状态 |
| --- | --- | --- | --- |
| `INT` | 7 | 3.3 V 上拉、低有效、仅开漏共享 | 候选继承 |
| `INT2` | 38 | 3.3 V 上拉、低有效、仅开漏共享 | GPIO/电气冻结 |

两颗 FUSB302B 必须各有可确定服务的中断路径。共享时必须通过状态寄存器消歧
并验证最坏服务延迟；ISR 只唤醒协调器，不在 ISR 内执行 I2C 事务。

## ADC 与输入测量

| 信号 | MCU 资源 | 模拟前端 | 量程 / 用途 | 状态 |
| --- | --- | --- | --- | --- |
| `VIN_DC_SENSE` | GPIO1 / `ADC1_CH0` | `3 x 100k + 20k`，`100nF` | 1:16；40 V -> 2.50 V | 冻结 |
| `VIN_USB` | input FUSB302B `MEAS_VBUS/MDAC` | PHY 比较器扫描 | USB 输入/合同判断 | 冻结，不占 MCU ADC |

ADC 固件必须校准并使用滞回；只有 `VIN_DC >= 9 V` 才视为有效，禁止以单次
样本直接切换输入。

## 冻结 GPIO 合同

| GPIO | 网络 | 方向 / 逻辑 | 复位与安全态 | 所有者 |
| --- | --- | --- | --- | --- |
| 1 | `VIN_DC_SENSE` | 模拟输入 | 高阻，无数字上下拉 | 输入电源状态机 |
| 33 | `PWR_INPUT_EN` | 输出；0=全关，1=允许选择 | 默认 0 | 输入电源状态机 |
| 34 | `PWR_INPUT_SEL` | 输出；0=DC，1=USB | 只在 EN=0 时改变 | 输入电源状态机 |
| 35 | `BTNL` | 输入，低有效 | 内部上拉 | UI 输入 |
| 36 | `TPS_USB_C_VBUS_EN` | 输出，经 BSS138PS | 默认关闭输出 PMOS | PD source 状态机 |
| 37 | `CE_TPS` | 输出，经 BSS138PS | 默认关闭 TPS | TPS 协调器 |
| 38 | `INT2` | 输入，低有效 | 高阻，外部 3.3 V 上拉 | 中断协调器 |

GPIO36 与 GPIO37 使用同一颗 BSS138PS 的两个独立 NMOS 通道，只共享封装，
不共享栅极或状态。控制 GPIO 必须只有一个状态机所有者；其他模块提交意图，
禁止多个任务分别写 GPIO33/34 或 GPIO36/37。

## 候选继承与余量

| GPIO / 控制器 | 候选用途 | 冻结前检查 |
| --- | --- | --- |
| GPIO0 | `BTNR` | 启动 strap 与按键上电行为 |
| GPIO2/4/5 | USB 数据路径 | 网络名和默认安全态 |
| GPIO6/16-18 | 隔离状态、USB-A 电源/故障 | 电平和上拉 |
| GPIO8/9 + `I2C1` | 第一组 I2C | 成员、地址、上拉、时延 |
| GPIO10-15 + `SPI2/DMA_CH0` | GC9307 | DMA 独占、背光默认关闭 |
| GPIO19/20 + `USB_DEVICE` | 原生 USB | 禁止普通 GPIO 复用 |
| GPIO21 + `LEDC` | 蜂鸣器 | timer/channel 独占、静音启动 |
| GPIO39/40 + `I2C0` | 第二组 I2C | FUSB 地址冲突、JTAG 取舍 |
| GPIO43/44 + `UART0` | 调试串口 | 生产接口边界 |

GPIO3、GPIO41/42、GPIO45/46 暂不分配；strap/启动相关引脚不能因为网表未连
就视为普通余量。

## 安全启动与切换顺序

1. `PWR_INPUT_EN=0`，GPIO36 关闭输出 PMOS，GPIO37 关闭 TPS55288。
2. 初始化 ADC、两组 I2C 和中断，识别输入源及外部 VBUS。
3. 输入切换时保持 EN=0，设置 GPIO34，等待至少 5 ms，再置 EN=1。
4. DC 有效时先把 USB sink 合同降到 5 V并验证，再选择 DC；DC 失效后才把
   USB 协商到项目可工作的 Fixed/PPS 电压。
5. 仅在确认外部 VBUS 不存在且 TPS 目标/限流已配置后，才启动 TPS 和输出 PMOS。

## 原理图与 bring-up 验收

- [ ] 两颗 FUSB302B 的精确料号、7-bit 地址、I2C 控制器和中断线已冻结。
- [ ] GPIO1、33-38 各只有一个网络，名称与本文一致。
- [ ] `INT`/`INT2` 仅连接开漏输出，且各有单一 3.3 V 上拉预算。
- [ ] GPIO39/40 与 JTAG 的取舍及可用调试路径已记录。
- [ ] 复位期间 GPIO33、36、37 的外部偏置保证功率路径关闭。
- [ ] 两组 I2C 通过 400 kHz 上升时间、恢复和并发压力测试。
- [ ] PD 高负载下中断服务延迟与 USB-PD timing 通过验证。
- [ ] ADC 完成 9 V 阈值、额定输入和 40 V 边界校准。
- [ ] 外部 VBUS 反灌不超过 TPS VOUT 25 V 绝对最大值。
- [ ] 独立 `tps-fusb` firmware profile 可构建且不会误刷为 `tps-sw`。
