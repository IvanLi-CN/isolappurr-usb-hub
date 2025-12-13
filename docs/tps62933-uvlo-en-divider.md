# TPS62933 EN 分压实现约 8 V UVLO（330 kΩ / 56 kΩ）

本笔记记录：在 IsolaPurr USB Hub 项目中，针对 **TI TPS62933DRLR**（`VIN = 9–24 V`），通过 **EN 引脚分压**实现输入欠压锁定（UVLO）在 **8 V 左右**的选型结论。

## 1. 目标

- 期望 **VIN 上升到 ~8 V** 时使能（启动）。
- VIN 下降时具备一定迟滞，避免 8 V 附近抖动反复启停。

## 2. 选用电阻（已定稿）

分压连接方式：

- `R1`：`VIN -> EN`
- `R2`：`EN -> GND`

最终选择：

- `R1 = 330 kΩ`
- `R2 = 56 kΩ`

（建议使用 1% 精度；若使用 5% 需要预留更大门限偏差。）

## 3. 典型值估算结果（用于工程预期）

按数据手册给出的 EN 相关典型参数（门限与内部电流源/迟滞电流）进行估算（见 “依据与参数” 与 “计算方法”）：

- 启动阈值（上升）：约 **8.11 V**
- 关断阈值（下降）：约 **7.37 V**
- 迟滞：约 **0.74 V**

## 4. 依据与参数（来自 TI 数据手册）

本笔记所用符号定义（与数据手册一致）：

- `V_EN_RISE`：EN 上升使能阈值（Rising enable threshold）
- `V_EN_FALL`：EN 下降关断阈值（Falling disable threshold）
- `I_p`：EN 内部上拉电流（EN pullup current，EN 未外接驱动时默认使能）
- `I_h`：EN 迟滞电流（手册表格中写作 “EN pullup hysteresis current”，用于 UVLO 迟滞）

本设计计算使用的 **典型值**（数据手册给出的典型数值）：

- `V_EN_RISE = 1.21 V`，`V_EN_FALL = 1.17 V`
- `I_p = 0.7 µA`，`I_h = 1.4 µA`

对应出处：

- `docs/datasheets/tps62933-datasheet.md`：章节 **9.3.6 Enable and Adjusting Undervoltage Lockout**（包含对 `I_p / I_h / V_EN_RISE / V_EN_FALL` 的说明，以及 Equation 3–5 的 UVLO 分压计算方法）
- `docs/datasheets/tps62933-datasheet.md`：章节 **8.5 Electrical Characteristics** 中的 **ENABLE (EN PIN)** 表格（列出 `V_EN_RISE / V_EN_FALL / I_p / I_h` 的测试条件与典型值）

## 5. 计算方法（由数据手册 Equation 5 推导）

外置 UVLO 分压网络为：

- `R1`：`VIN -> EN`
- `R2`：`EN -> GND`

数据手册给出的 EN 电压表达式（Equation 5）可写成：

$$
V_{EN} = \frac{R_2\cdot V_{IN} + R_1\cdot R_2\cdot (I_p + I_h)}{R_1+R_2}
$$

结合门限条件：

- 上升启动：当 `V_EN` 上升到 `V_EN_RISE` 时启动；此时迟滞电流尚未介入，可按 `I_h = 0` 近似。
- 下降关断：当 `V_EN` 下降到 `V_EN_FALL` 时关断；此时 `I_h` 参与，形成迟滞。

将上式整理，可得到便于“用已选阻值反算门限”的形式：

$$
V_{START}=V_{EN\_RISE}\cdot\left(1+\frac{R_1}{R_2}\right)-I_p\cdot R_1
$$

$$
V_{STOP}=V_{EN\_FALL}\cdot\left(1+\frac{R_1}{R_2}\right)-(I_p+I_h)\cdot R_1
$$

## 6. 将 330 kΩ / 56 kΩ 代入计算（典型值）

已选：

- `R1 = 330 kΩ`
- `R2 = 56 kΩ`

先计算比例项：

$$
1+\frac{R_1}{R_2}=1+\frac{330k}{56k}=6.892857
$$

### 6.1 启动阈值（上升）

$$
\begin{aligned}
V_{START}
&=1.21\times 6.892857 - 0.7\,\mu A\times 330k\\
&=8.339\,V - 0.231\,V\\
&\approx 8.108\,V
\end{aligned}
$$

### 6.2 关断阈值（下降）

$$
\begin{aligned}
V_{STOP}
&=1.17\times 6.892857 - (0.7+1.4)\,\mu A\times 330k\\
&=8.063\,V - 0.693\,V\\
&\approx 7.370\,V
\end{aligned}
$$

因此典型迟滞约：

$$
V_{HYS}=V_{START}-V_{STOP}\approx 0.738\,V
$$

## 7. 约束检查（VIN=24 V 时 EN 最大电压）

数据手册要求 `EN` 引脚电压不得超过 **5.5 V**（Recommended Operating Conditions）。

以 “已使能（含 I_h）” 情况估算 `VIN=24V` 时的 EN 电压：

$$
V_{EN}(24V)\approx\frac{56k\cdot24V + 330k\cdot56k\cdot 2.1\,\mu A}{330k+56k}\approx 3.58V
$$

远低于 5.5 V，满足约束。

## 8. 参考

- `docs/datasheets/tps62933-datasheet.md`（TI TPS6293x / TPS62933 数据手册 Markdown 版）
