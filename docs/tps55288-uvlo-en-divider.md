# TPS55288 EN/UVLO 分压实现约 8 V LVLO（200 kΩ / 36 kΩ）

本笔记记录：在 IsolaPurr USB Hub 项目中，针对 **TI TPS55288**，使用 `EN/UVLO` 引脚的**可编程输入欠压锁定（UVLO / LVLO）**功能，将输入欠压门限设定在 **8 V 左右**。

## 1. 目标

- `VIN` 上升到 **≈8 V** 后才进入正常工作（I²C 配置 + 开始开关工作）。
- `VIN` 下降时具备约 **1 V** 的迟滞，避免临界点抖动反复启停。

## 2. 依据与关键参数（来自 TI 数据手册）

`EN/UVLO` 同时具备“逻辑使能”和“可编程 UVLO”两段阈值行为：

- 逻辑使能阈值：`V_ENH`（EN Logic high threshold），最大 **1.15 V**。当 `EN/UVLO` 高于该阈值但仍低于 UVLO 阈值时，器件“enabled but still in standby mode”。  
- UVLO 阈值：`V_UVLO`（UVLO rising threshold at the EN/UVLO pin），`1.20/1.23/1.26 V`（min/typ/max）。  
- 迟滞电流：`I_UVLO`（Sourcing current at the EN/UVLO pin），`4.5/5/5.5 µA`（min/typ/max）。该电流用于实现 UVLO 迟滞（见公式与说明）。

对应出处：

- `docs/datasheets/tps55288-datasheet.md`：章节 **7.3.4 Enable and Programmable UVLO**（Equation 1/2 + Figure 7‑1/7‑2）
- `docs/datasheets/tps55288-datasheet.md`：章节 **6.5 Electrical Characteristics**（`V_ENH` / `V_UVLO` / `I_UVLO`）

## 3. 电阻网络与定稿阻值

按数据手册 Figure 7‑1：

- `R1`：`VIN -> EN/UVLO`
- `R2`：`EN/UVLO -> GND`

定稿：

- `R1 = 200 kΩ`
- `R2 = 36 kΩ`

（建议 1% 精度；阈值精度由 `V_UVLO`、`I_UVLO` 以及电阻容差共同决定。）

## 4. 计算方法与结果（按数据手册 Eq.1 / Eq.2）

### 4.1 UVLO 上升阈值（启动点）

数据手册 Equation 1：

$$
V_{IN(UVLO\_ON)} = V_{UVLO}\cdot\left(1+\frac{R_1}{R_2}\right)
$$

代入（典型值 `V_UVLO=1.23V`）：

$$
V_{IN(UVLO\_ON)}\approx 1.23\cdot\left(1+\frac{200k}{36k}\right)=8.063V
$$

### 4.2 UVLO 迟滞与下降阈值（关断点）

数据手册 Equation 2：

$$
\Delta V_{IN(UVLO)}\approx I_{UVLO}\cdot R_1
$$

代入（典型值 `I_UVLO=5µA`）：

$$
\Delta V_{IN(UVLO)}\approx 5\mu A\cdot 200k\Omega = 1.00V
$$

因此下降阈值（近似）：

$$
V_{IN(UVLO\_OFF)}\approx V_{IN(UVLO\_ON)}-\Delta V_{IN(UVLO)}\approx 7.063V
$$

### 4.3 “逻辑使能阈值”对应的 VIN 区间（可能的待机段）

在 `EN/UVLO` 低于 `V_UVLO` 但高于 `V_ENH` 时，器件处于“enabled but still in standby mode”。用同样的分压关系估算：

$$
V_{IN(ENH)}\approx V_{ENH}\cdot\left(1+\frac{R_1}{R_2}\right)
$$

若以 `V_ENH=1.15V` 计算，得到：

$$
V_{IN(ENH)}\approx 1.15\cdot\left(1+\frac{200k}{36k}\right)=7.533V
$$

这意味着：在约 `7.53V ~ 8.07V` 区间内，器件可能已“逻辑使能”但仍在待机（未进入 UVLO 使能的正常工作段）。

## 5. EN/UVLO 引脚电压与分压电流（工程检查）

- 分压电流：`I_DIV ≈ VIN/(R1+R2)`  
  - 例如 `VIN=24V` 时：`I_DIV≈24/236k≈102µA`
- `EN/UVLO` 节点电压（仅看纯分压）：`V_EN≈VIN·R2/(R1+R2)`  
  - `VIN=24V` 时约 `3.66V`

注意：当 `EN/UVLO` 高于 `V_UVLO` 后，`I_UVLO` 会向该节点“源出”电流，节点电压会比纯分压略高；如需覆盖更高输入电压（例如接近器件 36 V 上限），请务必对照数据手册的 `EN/UVLO` 允许电压范围做最终校核。

## 6. 低功耗建议（可选）

数据手册 Figure 7‑2 提到：用 NMOS + 分压可同时实现逻辑使能与可编程 UVLO，并消除关断时分压从 `VIN` 到 `GND` 的泄放电流；若后续对待机功耗更敏感，可按该方案调整。

## 7. 参考

- `docs/datasheets/tps55288-datasheet.md`
