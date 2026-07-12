# `tps-fusb` MCU 使用规范

本文是下一版 `tps-fusb` 硬件使用 ESP32-S3 的设计说明、指导和约束，包含
MCU 资源分配、封装引脚分配、外设初始配置、用途、安全默认态和注意事项。
当前版本处于设计阶段；“冻结”项可直接进入原理图，“候选/待确认”项必须在
正式网表评审前闭环，不能描述为已实现。

## 1. 适用范围与状态

| 项目 | 本版合同 |
| --- | --- |
| Hardware variant | `tps-fusb`（待设计） |
| MCU | 候选沿用 `ESP32-S3R2` |
| 封装 | 候选沿用 QFN-56-EP |
| 规范来源 | [`#m7q4v`](specs/m7q4v-tps-fusb-dual-pd-hardware/SPEC.md) |
| 正式网表/固件 | 尚不存在 |
| PD 输入/输出 | FUSB302B sink PHY / FUSB302B source PHY + TPS55288 |

标记定义：`冻结`=已决定；`候选`=计划继承当前版；`待确认`=画板前必须决定；
`固定`=MCU 器件自身不可分配资源。若 MCU 精确料号不再是 ESP32-S3R2，必须
重新审核 GPIO33-38、Flash/PSRAM 和封装 Pin，不允许只替换 BOM 料号。

## 2. MCU 固定资源与设计前提

- 候选 MCU 是裸片 `ESP32-S3R2`，不是模组；RF、晶体、复位和去耦必须保留。
- Pin 28、30-37 为 SPI memory 固定资源，不分配为 GPIO。
- GPIO0/3/45/46 受 strapping 约束；GPIO46 仅输入。
- GPIO19/20 为原生 USB；GPIO39/40 若用于 I2C0，将与 PAD-JTAG 冲突。
- 两版使用独立 firmware profile；不允许运行时猜测 variant。

## 3. MCU 资源预算

| 资源 | 分配/初始配置要求 | 用途 | 状态/注意事项 |
| --- | --- | --- | --- |
| `I2C0` | 400 kHz async，短事务、timeout | 一颗 FUSB302B/第二组设备 | 引脚与成员待确认 |
| `I2C1` | 400 kHz async，短事务、timeout | 系统设备/另一颗 FUSB302B | GPIO8/9 候选 |
| `SPI2` | Mode 0，40 MHz | GC9307 | 候选沿用 |
| `DMA_CH0` | RX/TX 各 4096 bytes | 显示 | 候选独占 |
| `LEDC` | LS timer0/channel0，10-bit | 蜂鸣器 | 候选沿用 |
| GPIO interrupt 1 | GPIO7 `INT`，AnyEdge | 第一组共享中断 | 候选；成员待确认 |
| GPIO interrupt 2 | GPIO38 `INT2`，AnyEdge | 第二组共享中断 | GPIO/电气冻结 |
| `ADC1_CH0` | GPIO1，校准采样 | `VIN_DC_SENSE` | 冻结 |
| `USB_DEVICE` | GPIO19/20 | USB Serial/JTAG | 候选沿用 |
| `UART0` | GPIO43/44 | 调试 | 候选沿用 |
| PSRAM | framebuffer/external allocator | 显示 | 候选；容量待实机确认 |

## 4. GPIO 引脚分配总表

| Package Pin | MCU pin | 网络/功能 | 方向与初始配置 | 状态、用途与注意事项 |
| ---: | --- | --- | --- | --- |
| 5 | GPIO0 | `BTNR` | 输入，内部上拉，低有效 | 候选；[STRAP] 右键 |
| 6 | GPIO1 | `VIN_DC_SENSE` | ADC1_CH0，高阻，无数字上下拉 | 冻结；1:16 DC 输入采样 |
| 7 | GPIO2 | `P2_CED` | 推挽输出，安全态待 profile 冻结 | 候选；USB-C 数据开关 |
| 8 | GPIO3 | NC | 不初始化 | 保留；[STRAP] |
| 9 | GPIO4 | `P1_CED` | 推挽输出，安全态待 profile 冻结 | 候选；USB-A 数据开关 |
| 10 | GPIO5 | `P1_ESP` | 推挽输出，路由默认态待确认 | 候选；USB-A 数据路由 |
| 11 | GPIO6 | `LEDD` | 高阻输入，无内部上下拉 | 候选；隔离侧 ready |
| 12 | GPIO7 | `INT` | 高阻输入，无内部上下拉，AnyEdge | 候选；仅开漏共享 |
| 13 | GPIO8 | I2C1 SDA | 开漏，由 I2C 接管 | 候选；总线成员待确认 |
| 14 | GPIO9 | I2C1 SCL | 开漏，由 I2C 接管 | 候选；总线成员待确认 |
| 15 | GPIO10 | `DC` | 推挽输出，初始 Low | 候选；GC9307 |
| 16 | GPIO11 | `MOSI` | SPI2 输出 | 候选；GC9307 |
| 17 | GPIO12 | `SCLK` | SPI2 输出 | 候选；40 MHz |
| 18 | GPIO13 | `CS` | 推挽输出，初始 High | 候选；GC9307 片选 |
| 19 | GPIO14 | `RES` | 推挽输出，初始 High | 候选；GC9307 复位 |
| 21 | GPIO15 | `BLK` | 推挽输出，安全态 High/背光关 | 候选；低有效；占用 32 kHz pin |
| 22 | GPIO16 | `P1_EN#` | 推挽输出，安全态 High/电源关 | 候选；低有效；占用 32 kHz pin |
| 23 | GPIO17 | `P1_FAULT` | 输入 | 候选；低有效故障 |
| 24 | GPIO18 | `UP0_PG` | 高阻输入，无内部上下拉 | 候选；高有效 fault |
| 25 | GPIO19 | `USB_D-` | USB peripheral | 候选固定原生 USB |
| 26 | GPIO20 | `USB_D+` | USB peripheral | 候选固定原生 USB |
| 27 | GPIO21 | `BUZZER` | 初始 Low，再交给 LEDC | 候选；默认静音 |
| 38 | GPIO33 | `PWR_INPUT_EN` | 推挽输出，初始 Low | 冻结；Low=两路均不主动增强，体二极管仍存在 |
| 39 | GPIO34 | `PWR_INPUT_SEL` | 推挽输出，初始 Low | 冻结；0=DC，1=USB；仅 EN=0 时改变 |
| 40 | GPIO35 | `BTNL` | 输入，内部上拉，低有效 | 冻结；左键从 GPIO1 迁移 |
| 41 | GPIO36 | `TPS_USB_C_VBUS_EN` | 推挽输出，初始 Low | 冻结；经 BSS138PS；逻辑极性须由 gate 电路复核 |
| 42 | GPIO37 | `CE_TPS` | 推挽输出，初始 High | 冻结；经 BSS138PS，High=TPS 硬关闭 |
| 43 | GPIO38 | `INT2` | 高阻输入，无内部上下拉，AnyEdge | 冻结；外部 3.3 V 上拉，仅开漏共享 |
| 44 | GPIO39/MTCK | I2C0 SDA 候选 | 开漏，由 I2C 接管 | 待确认；占用 PAD-JTAG |
| 45 | GPIO40/MTDO | I2C0 SCL 候选 | 开漏，由 I2C 接管 | 待确认；占用 PAD-JTAG |
| 47 | GPIO41/MTDI | NC | 不初始化 | 预留/PAD-JTAG |
| 48 | GPIO42/MTMS | NC | 不初始化 | 预留/PAD-JTAG |
| 49 | GPIO43/U0TXD | `U0TX` | UART0 TX | 候选调试输出 |
| 50 | GPIO44/U0RXD | `U0RX` | UART0 RX | 候选调试输入 |
| 51 | GPIO45 | NC | 不初始化 | [STRAP] 保留 |
| 52 | GPIO46 | NC | 仅输入/不初始化 | [STRAP] 保留，禁止输出用途 |

## 5. 固定封装引脚

| Package Pin | 引脚 | 连接/要求 |
| ---: | --- | --- |
| 1 | `LNA_IN` | RF matching/antenna；沿用时必须重新通过 RF layout review |
| 2, 3, 20, 46, 55, 56 | 3.3 V supply pins | 就近去耦；正式网表逐脚核对 |
| 4 | `CHIP_PU` | 确定复位/上电网络，不可浮空 |
| 28, 30-37 | SPI Flash/PSRAM | 固定，不得作为普通 GPIO |
| 29 | `VDD_SPI` | 3.3 V memory domain |
| 53, 54 | `XTAL_N/P` | 40 MHz 晶体网络 |
| 57/EP | GND/exposed pad | 接地和散热过孔阵列 |

## 6. 外设初始配置规范

### 6.1 输入电源控制与 ADC

本模块的完整硬件和固件规范见
[`tps-fusb` 输入电源路径选择模块](tps-fusb-input-power-path-selection.md)。

- GPIO33 `PWR_INPUT_EN` 必须在最早 GPIO 初始化阶段输出 Low；外部 B1/B2
  下拉必须在 MCU 高阻/复位期间也保证两路 PMOS 不被主动导通。
- 单 PMOS 不隔离未选输入。未选输入电压高于 `VIN_SYS` 时仍可能经体二极管
  供电；状态机只互锁主动增强信号，不得把 EN=0 报告成输入完全断开。
- GPIO34 初始 Low 选择 DC，但只有 GPIO33=High 时选择才生效。切换固定顺序：
  EN=0 -> wait >=5 ms -> set SEL -> EN=1。
- GPIO1 配置 `ADC1_CH0`，不启用数字 pull。模拟前端为 `3 x 100 kOhm`
  上臂、`20 kOhm` 下臂、ADC 点 `100 nF`，40 V 对应约 2.50 V。
- ADC 必须做校准、多样本滤波和滞回；`VIN_DC >= 9 V` 才可判定有效。

### 6.2 TPS 与 USB-C 输出 PMOS

- GPIO37 `CE_TPS` 在启动时先置 High，使 TPS55288 EN/UVLO 被 NMOS 拉低。
- GPIO36 在启动时保持输出 PMOS 关闭。最终原理图必须明确 BSS138PS、PMOS
  gate 上拉和 VGS clamp 后的 MCU 高/低电平真值，并回填本文。
- 外部 `VBUS_TPS` 存在时不得开启 TPS 或输出 PMOS。允许的体二极管反灌
  不得令 TPS VOUT 超过 25 V absolute maximum。
- GPIO36 与 GPIO37 仅共享 BSS138PS 封装，两个 NMOS channel 的 gate/drain
  不得互连，固件所有权也必须分离。

### 6.3 双 I2C 与 FUSB302B

- 两个控制器均按 400 kHz async、transaction timeout、静态 allowlist、禁止
  扫描设计；PD 事件事务优先于 EEPROM 写入和周期遥测。
- 正式选定 FUSB302B 料号后必须确认 7-bit 地址。若两颗地址相同且不可配置，
  必须分别放在 I2C0/I2C1，或增加经批准的 mux，不能同总线并联。
- 每颗 FUSB302B 必须有可确定服务的低有效中断路径。GPIO7/38 共享时只允许
  开漏输出；ISR 仅置 dirty flag，寄存器读取在任务上下文执行。
- GPIO39/40 若冻结为 I2C0，则外部 PAD-JTAG 不可用；调试保留 USB
  Serial/JTAG 和 UART0。

### 6.4 显示、蜂鸣器、USB 与 UART

- 候选继承：SPI2 Mode 0/40 MHz、GPIO10-14、DMA_CH0 4096-byte RX/TX。
- 与当前版不同，安全启动建议 `BLK=High` 先关闭背光，显示初始化成功后再按
  UI 策略开启；最终 firmware profile 必须冻结此行为。
- 候选 LEDC：APB clock、LS timer0/channel0、10-bit、初始 1 kHz/0% duty。
- 原生 USB 固定 GPIO19/20；UART0 GPIO43/44。不得让调试接口控制电源路径。

## 7. 资源所有权规范

| 模块 | 独占资源 | 允许的跨模块接口 |
| --- | --- | --- |
| Input PD policy | input FUSB302B | 发布 USB contract/测量状态 |
| Input power selector | ADC1_CH0、GPIO33/34 | 接收候选输入状态，执行唯一切换序列 |
| Output PD policy | output FUSB302B | 提交 VBUS/电流请求 |
| TPS coordinator | TPS55288、GPIO37 | 接收输出设定请求 |
| VBUS gate controller | GPIO36 | 接收 source 状态机开关请求 |
| Interrupt coordinator | GPIO7/38 | 唤醒对应总线服务，不直接切电源 |

任何两个任务不得直接写同一控制 GPIO。尤其禁止 PD policy 绕过 input power
selector 写 GPIO33/34，或绕过 TPS/VBUS controller 写 GPIO36/37。

## 8. 上电初始化顺序

1. 在外设初始化前建立 GPIO33=Low、GPIO36=关闭态、GPIO37=High。
2. 配置 GPIO1 ADC 与 GPIO7/38 高阻中断输入，读取初始输入/外部 VBUS 状态。
3. 初始化两条 I2C，并确认两颗 PHY、TPS 与系统设备可按 allowlist 访问。
4. 运行输入源状态机：先验证，后按 >=5 ms break-before-make 选择电源。
5. 初始化 TPS 为 OE off/安全 setpoint；完成 source attach/contract 后才开 TPS，
   最后由 GPIO36 接通 `VOUT_TPS -> VBUS_TPS`。
6. 初始化显示/DMA、USB、UART、LEDC 和上层任务。

## 9. 设计注意事项与禁止事项

- 不得用 MCU 软件替代 GPIO33/36/37 的外部复位安全偏置。
- 不得将推挽中断并入 `INT` 或 `INT2`；整线只允许一个上拉预算。
- 不得因 I2C 为 400 kHz 就认定 PD timing 自动满足；必须验证 IRQ latency、
  task scheduling 和最坏总线占用。
- GPIO0/3/45/46 不用于功率使能；GPIO19/20 不复用；memory pins 不引出。
- `tps-sw` 与 `tps-fusb` 的 pin constants、feature/profile 和镜像必须独立。
- 正式原理图改变任何网络、极性或外设实例时，必须先更新本文并重新审核。

## 10. 原理图与 bring-up 验收

- [ ] U19 精确料号、封装、Flash/PSRAM 容量与构建 target 已确认。
- [ ] Package Pin 与 GPIO/网络逐脚对照本文，无重复分配或旧 `BTNL=GPIO1`。
- [ ] GPIO33/36/37 在复位、高阻、下载模式和崩溃重启期间均保持安全。
- [ ] 两颗 FUSB302B 的地址、总线、中断、上拉和 allowlist 已冻结。
- [ ] 两条 I2C 通过上升时间、timeout、bus recovery 和并发压力验证。
- [ ] ADC 在 9 V、额定输入和 40 V 边界完成校准/容差验证。
- [ ] 验证 DC/USB 同插、掉电、重协商和 >=5 ms break-before-make。
- [ ] 验证外部 VBUS、受控反灌、TPS 关闭和 VOUT <=25 V。
- [ ] 验证显示、DMA、USB、UART、蜂鸣器和两个独立 firmware profile。
