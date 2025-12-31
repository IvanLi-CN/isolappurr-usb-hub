# ip6557 网表排查清单

网表文件：`hardware/ip6557/netlist.enet`
适用硬件：`ip6557`
说明：本清单基于**网表连线**做连通性排查，不包含 PCB layout/走线/阻抗/ESD 版图级验证。

## 关键器件定位（来自网表自动提取）
- IP6557：`U22`
- CH224Q：`U10`
- INA226：`U13`, `U17`
- CH318T：`U1`, `U2`
- CH442E：`U7`, `U8`
- ECMF02-2AMX6：`L3`
- CH412K：`D2`, `D3`
- RT9013-33GB：`U5`

## 网表总体统计（自动提取）
- components 数：199
- pin 总数：755
- unique net 数：129（不含空字符串）
- 关键字网络名（按网表实际出现）：
  - VBUS：`P0_VBUS`, `P1_VBUS`, `UVBUS`, `VBUS_IP`
  - CC：`CC1`, `CC1_IP`, `CC2`, `CC2_IP`, `P0_CC1`, `P0_CC2`, `UCC1`, `UCC2`, `UVCC`
  - SCL：`SCL`, `SCLK`
  - SDA：`SDA`
  - UGND：`UGND`
  - GND：`GND`, `UGND`
  - 3V3：`3V3`
  - VIN：`VIN`, `VIN_ADC`, `VIN_IP`, `VIN_MCU`, `VIN_UNSAFE`
  - UVBUS：`UVBUS`
  - UVCC：`UVCC`

## P0：必须优先确认（网表可直接判断）
### 1) 引脚 net 为空字符串/缺失
- 说明：以下仅能确认“该 pin 的 `net` 为空”（可能是 NC，也可能是悬空风险）；需对照 datasheet/原理图意图逐一确认。
- [ ] `D3`（`Manufacturer Part: CH412K`）：`pin3`, `pin4` → `net=""`（TODO：对照 datasheet）
- [ ] `L1`（`Manufacturer Part: LT4532B-351MGF T6`）：`pin3`, `pin6` → `net=""`（TODO：对照 datasheet）
- [ ] `L3`（`Manufacturer Part: ECMF02-2AMX6`）：`pin4` → `net=""`（TODO：对照 datasheet）
- [ ] `RN1`（`Manufacturer Part: 4D02WGJ0472TCE`）：`pin4` → `net=""`（TODO：对照 datasheet）
- [ ] `SCREW1`（`Manufacturer Part: (空)`）：`pin1` → `net=""`（TODO：对照 datasheet）
- [ ] `SCREW2`（`Manufacturer Part: (空)`）：`pin1` → `net=""`（TODO：对照 datasheet）
- [ ] `SCREW3`（`Manufacturer Part: (空)`）：`pin1` → `net=""`（TODO：对照 datasheet）
- [ ] `SCREW4`（`Manufacturer Part: (空)`）：`pin1` → `net=""`（TODO：对照 datasheet）
- [ ] `SW3`（`Manufacturer Part: TS-KG89U-AT25F`）：`pin1` → `net=""`（TODO：对照 datasheet）
- [ ] `U1`（`Manufacturer Part: CH318T`）：`pin11`, `pin12`, `pin17`, `pin18`, `pin19`, `pin20` → `net=""`（TODO：对照 datasheet）
- [ ] `U2`（`Manufacturer Part: CH318T`）：`pin11`, `pin12`, `pin17`, `pin18`, `pin19`, `pin20` → `net=""`（TODO：对照 datasheet）
- [ ] `U5`（`Manufacturer Part: RT9013-33GB`）：`pin4` → `net=""`（TODO：对照 datasheet）
- [ ] `U7`（`Manufacturer Part: CH442E`）：`pin3`, `pin7` → `net=""`（TODO：对照 datasheet）
- [ ] `U8`（`Manufacturer Part: CH442E`）：`pin3`, `pin7` → `net=""`（TODO：对照 datasheet）
- [ ] `U9`（`Manufacturer Part: HUSB305-01`）：`pin4` → `net=""`（TODO：对照 datasheet）
- [ ] `U10`（`Manufacturer Part: CH224Q`）：`pin10` → `net=""`（TODO：对照 datasheet）
- [ ] `U19`（`Manufacturer Part: ESP32-S3R2`）：`pin8`, `pin28`, `pin30`, `pin31`, `pin32`, `pin33`, `pin34`, `pin35`, `pin36`, `pin37`, `pin38`, `pin39`, `pin40`, `pin41`, `pin43`, `pin44`, `pin45`, `pin47`, `pin48`, `pin51`, `pin52` → `net=""`（TODO：对照 datasheet）
- [ ] `U22`（`Manufacturer Part: IP6557_C`）：`pin1`, `pin2`, `pin3`, `pin4`, `pin6`, `pin7`, `pin27`, `pin29`, `pin30`, `pin31`, `pin32`, `pin33`, `pin35`, `pin36`, `pin38`, `pin39`, `pin40` → `net=""`（TODO：对照 datasheet）
- [ ] `USB5`（`Manufacturer Part: TYPEC-304A-ACP16O`）：`pinA8`, `pinB8` → `net=""`（TODO：对照 datasheet）

### 2) 同一器件同时连接 `UGND` 与 `GND`（短接风险）
- [x] 未发现同一器件的 net 集合同时包含 `UGND` 与 `GND`（扫描结果：0 个器件；与“UGND/GND 完全隔离”的需求一致）。

### 3) 电源网是否至少挂载 1 个电容（仅网表级：无法判断是否就近/容量是否足够）
- [x] `3V3`：挂载电容 25 个：`C1`, `C10`, `C14`, `C24`, `C25`, `C26`, `C27`, `C36`, `C37`, `C76`, `C77`, `C79`, `C8`, `C80`, `C81`, `C83`, `C84`, `C85`, `C86`, `C87`, `C88`, `C89`, `C9`, `C90`, `C94`
- [x] `P0_VBUS`：挂载电容 1 个：`C33`
- [x] `P1_VBUS`：挂载电容 2 个：`C34`, `C35`
- [x] `UVBUS`：挂载电容 3 个：`C19`, `C30`, `C31`
- [x] `UVCC`：挂载电容 3 个：`C20`, `C5`, `C6`
- [x] `VBUS_IP`：挂载电容 7 个：`C115`, `C117`, `C118`, `C119`, `C59`, `C60`, `C61`
- [x] `VIN`：挂载电容 4 个：`C22`, `C23`, `C40`, `C41`
- [ ] `VIN_ADC`：未发现任何电容挂载
  - 网表连接点：
    - `R108` `pin1`（`RT0402BRD07100KL`）
    - `R109` `pin2`（`RT0402BRD0710KL`）
    - `U19` `pin10`（`ESP32-S3R2`）
  - TODO：确认该网是否应有去耦/储能电容（网表无法判断“就近”与“值”）。
- [x] `VIN_IP`：挂载电容 6 个：`C114`, `C120`, `C121`, `C42`, `C44`, `C45`
- [x] `VIN_MCU`：挂载电容 3 个：`C11`, `C12`, `C32`
- [ ] `VIN_UNSAFE`：未发现任何电容挂载
  - 网表连接点：
    - `F1` `pin1`（`SMD2920P050TF`）
    - `F3` `pin1`（`2920L500/33GR`）
    - `U11` `pin1`（`DC007B-2.5-J`）
    - `USB2` `pin2`（`U264-141N-4BAC10`）
    - `USB2` `pin6`（`U264-141N-4BAC10`）
    - `USB2` `pin9`（`U264-141N-4BAC10`）
    - `USB2` `pin13`（`U264-141N-4BAC10`）
  - TODO：确认该网是否应有去耦/储能电容（网表无法判断“就近”与“值”）。

### 4) CC 网络上是否存在到地电阻（仅通过“电阻两端 net 名”判断）
- 说明：本项只统计“电阻两端 net 同时命中 {`CC1/CC2` 相关网络, `GND/UGND`}”的情况；无法从网表直接区分 Rd/Rp 或阻值是否正确。
- [x] 找到 CC↔GND/UGND 的两端电阻 2 个：
  - `R14`（`0402WGF5101TCE`）：`UGND` ↔ `UCC1`
  - `R15`（`0402WGF5101TCE`）：`UGND` ↔ `UCC2`
- [ ] CC*_IP（例如 `CC1_IP`, `CC2_IP`）：未看到到 `GND/UGND` 的两端电阻：`CC1_IP`, `CC2_IP`
  - TODO：需要对应控制器/端口角色需求 + datasheet，确认 Rd/Rp 是否应外置。
- [ ] P0_CC*（例如 `P0_CC1`, `P0_CC2`）：未看到到 `GND/UGND` 的两端电阻：`P0_CC1`, `P0_CC2`
  - TODO：需要对应控制器/端口角色需求 + datasheet，确认 Rd/Rp 是否应外置。
- [x] UCC*（例如 `UCC1`, `UCC2`）：已看到到 `GND/UGND` 的两端电阻
- [ ] CC*（例如 `CC1`, `CC2`）：未看到到 `GND/UGND` 的两端电阻：`CC1`, `CC2`
  - TODO：需要对应控制器/端口角色需求 + datasheet，确认 Rd/Rp 是否应外置。
- 参考（非电阻）：`CC1_IP/CC2_IP` 上存在电容：`C69`(CC1_IP↔GND), `C70`(CC2_IP↔GND)。

## P1：高风险/功能偏差（需要结合 datasheet/需求）
### 1) IP6557（`U22`）逐 pin 连接表（网表证据）
> TODO：需要 IP6557 datasheet，对照每个 pin 的推荐连接/允许悬空条件/外围元件选型。

| Designator | Pin | Net |
|---|---:|---|
| `U22` | 1 | "" |
| `U22` | 2 | "" |
| `U22` | 3 | "" |
| `U22` | 4 | "" |
| `U22` | 5 | `VBUS_IP` |
| `U22` | 6 | "" |
| `U22` | 7 | "" |
| `U22` | 8 | `VBUS_IP` |
| `U22` | 9 | `VBUS_IP` |
| `U22` | 10 | `CSP1` |
| `U22` | 11 | `PCON` |
| `U22` | 12 | `HD1` |
| `U22` | 13 | `BST1` |
| `U22` | 14 | `SW1` |
| `U22` | 15 | `LD1` |
| `U22` | 16 | `LD2` |
| `U22` | 17 | `SW2` |
| `U22` | 18 | `BST2` |
| `U22` | 19 | `HD2` |
| `U22` | 20 | `PCIN` |
| `U22` | 21 | `CSN2` |
| `U22` | 22 | `VIN_IP` |
| `U22` | 23 | `VIN_IP` |
| `U22` | 24 | `GND` |
| `U22` | 25 | `$1N20424` |
| `U22` | 26 | `GND` |
| `U22` | 27 | "" |
| `U22` | 28 | `$1N20487` |
| `U22` | 29 | "" |
| `U22` | 30 | "" |
| `U22` | 31 | "" |
| `U22` | 32 | "" |
| `U22` | 33 | "" |
| `U22` | 34 | `CC2_IP` |
| `U22` | 35 | "" |
| `U22` | 36 | "" |
| `U22` | 37 | `CC1_IP` |
| `U22` | 38 | "" |
| `U22` | 39 | "" |
| `U22` | 40 | "" |
| `U22` | 41 | `GND` |

### 2) CH224Q（`U10`）的 CC/DP/DM 网络（网表证据）
> TODO：需要 CH224Q datasheet（需求已知：仅 PD），才能判断其在“仅 PD”场景下对 `DP/DM` 的依赖，以及 `CC1/CC2` 的外置电阻/外围是否完整。

| Designator | Pin | Net |
|---|---:|---|
| `U10` | 1 | `VIN_MCU` |
| `U10` | 2 | `SCL` |
| `U10` | 3 | `SDA` |
| `U10` | 4 | `DP` |
| `U10` | 5 | `DM` |
| `U10` | 6 | `CC2` |
| `U10` | 7 | `CC1` |
| `U10` | 8 | `VIN_MCU` |
| `U10` | 9 | `$4N280` |
| `U10` | 10 | "" |
| `U10` | 11 | `GND` |

- `CC1` 连接点：
  - `U10` `pin7`（`CH224Q`）
  - `USB2` `pin3`（`U264-141N-4BAC10`）
- `CC2` 连接点：
  - `U10` `pin6`（`CH224Q`）
  - `USB2` `pin10`（`U264-141N-4BAC10`）
- `DP` 连接点：
  - `U10` `pin4`（`CH224Q`）
  - `USB2` `pin4`（`U264-141N-4BAC10`）
  - `USB2` `pin11`（`U264-141N-4BAC10`）
- `DM` 连接点：
  - `U10` `pin5`（`CH224Q`）
  - `USB2` `pin5`（`U264-141N-4BAC10`）
  - `USB2` `pin12`（`U264-141N-4BAC10`）

### 3) Type-C 口（`USB5`）相关网络连通性（网表证据）
> 需求已知：仅 PD；`USB5` 为 Source；`D+ D-` 仅用于通信。网表只能给出“各 pin 连到哪些 net/器件”。

- `USB5` pin→net：
  - `USB5` `pinA1B12` → `GND`
  - `USB5` `pinB1A12` → `GND`
  - `USB5` `pinA4B9` → `VBUS_IP`
  - `USB5` `pinB4A9` → `VBUS_IP`
  - `USB5` `pinA5` → `CC1_IP`
  - `USB5` `pinB5` → `CC2_IP`
  - `USB5` `pinA6` → `DP_IP`
  - `USB5` `pinB6` → `DP_IP`
  - `USB5` `pinA7` → `DM_IP`
  - `USB5` `pinB7` → `DM_IP`
  - `USB5` `pinA8` → ""
  - `USB5` `pinB8` → ""
  - `USB5` `pin12` → `GND`
  - `USB5` `pin13` → `GND`
  - `USB5` `pin14` → `GND`
  - `USB5` `pin15` → `GND`

- `VBUS_IP` 连接点：
  - `C115` `pin2`（`GRM155R61H105KE05D`）
  - `C117` `pin1`（`H2221M035D090RL`）
  - `C118` `pin2`（`GRM155R61H105KE05D`）
  - `C119` `pin2`（`CL05B104KB54PNC`）
  - `C59` `pin2`（`GRM32ER60J107ME20L`）
  - `C60` `pin2`（`GRM155R61H105KE05D`）
  - `C61` `pin2`（`GRM155R61H105KE05D`）
  - `D13` `pin1`（`SMBJ30A`）
  - `R51` `pin1`（`HoLLR1206-1W-5mR-1%`）
  - `U17` `pin8`（`INA226AIDGSR`）
  - `U17` `pin9`（`INA226AIDGSR`）
  - `U22` `pin5`（`IP6557_C`）
  - `U22` `pin8`（`IP6557_C`）
  - `U22` `pin9`（`IP6557_C`）
  - `USB5` `pinA4B9`（`TYPEC-304A-ACP16O`）
  - `USB5` `pinB4A9`（`TYPEC-304A-ACP16O`）
- `CC1_IP` 连接点：
  - `C69` `pin2`（`GRM155R61H334KE01D`）
  - `D8` `pin4`（`TPD4E05U06DQAR`）
  - `D8` `pin7`（`TPD4E05U06DQAR`）
  - `U22` `pin37`（`IP6557_C`）
  - `USB5` `pinA5`（`TYPEC-304A-ACP16O`）
- `CC2_IP` 连接点：
  - `C70` `pin2`（`GRM155R61H334KE01D`）
  - `D8` `pin5`（`TPD4E05U06DQAR`）
  - `D8` `pin6`（`TPD4E05U06DQAR`）
  - `U22` `pin34`（`IP6557_C`）
  - `USB5` `pinB5`（`TYPEC-304A-ACP16O`）
- `DP_IP` 连接点：
  - `D8` `pin1`（`TPD4E05U06DQAR`）
  - `D8` `pin10`（`TPD4E05U06DQAR`）
  - `U8` `pin8`（`CH442E`）
  - `USB5` `pinA6`（`TYPEC-304A-ACP16O`）
  - `USB5` `pinB6`（`TYPEC-304A-ACP16O`）
- `DM_IP` 连接点：
  - `D8` `pin2`（`TPD4E05U06DQAR`）
  - `D8` `pin9`（`TPD4E05U06DQAR`）
  - `U8` `pin2`（`CH442E`）
  - `USB5` `pinA7`（`TYPEC-304A-ACP16O`）
  - `USB5` `pinB7`（`TYPEC-304A-ACP16O`）
- `DP2` 连接点：
  - `U2` `pin9`（`CH318T`）
  - `U8` `pin6`（`CH442E`）
- `DM2` 连接点：
  - `U2` `pin8`（`CH318T`）
  - `U8` `pin4`（`CH442E`）

- `U8(CH442E)` pin→net（网表证据；功能/通道对应关系需 datasheet 确认）：
  - `U8` `pin1` → `P2_CED`
  - `U8` `pin2` → `DM_IP`
  - `U8` `pin3` → ""
  - `U8` `pin4` → `DM2`
  - `U8` `pin5` → `GND`
  - `U8` `pin6` → `DP2`
  - `U8` `pin7` → ""
  - `U8` `pin8` → `DP_IP`
  - `U8` `pin9` → `GND`
  - `U8` `pin10` → `3V3`
  - TODO：需结合 CH442E datasheet 与其控制脚（例如 `P2_CED`）的默认电平/上电时序，确认 `DP_IP/DM_IP` 与 `DP2/DM2` 的内部连通关系/开关条件。
- `D8(TPD4E05U06DQAR)` pin→net（网表证据；功能/通道对应关系需 datasheet 确认）：
  - `D8` `pin1` → `DP_IP`
  - `D8` `pin2` → `DM_IP`
  - `D8` `pin3` → `GND`
  - `D8` `pin4` → `CC1_IP`
  - `D8` `pin5` → `CC2_IP`
  - `D8` `pin6` → `CC2_IP`
  - `D8` `pin7` → `CC1_IP`
  - `D8` `pin8` → `GND`
  - `D8` `pin9` → `DM_IP`
  - `D8` `pin10` → `DP_IP`
  - TODO：需要该器件 datasheet，核对每个通道/公共端的对应关系与是否需外接电源/接地方式。

## P2：一致性/工程性改进（建议）
- （无）

## 待确认（向主人提问）
- （无）
