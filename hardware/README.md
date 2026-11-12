# 硬件资料

本目录保存 IsolaPurr USB Hub 的硬件设计资料，包括外壳模型、PCB 设计文件和各硬件变体的制造输出。

## 目录结构

```text
hardware/
├── models/   外壳及其他机械 3D 模型
├── pcb/      PCB 设计源文件、制造文件和相关资料
├── tps-fusb/ tps-fusb 硬件变体资料
├── tps-husb/ tps-husb 硬件变体资料
└── tps-sw/   tps-sw 硬件变体资料
```

## 外壳模型

外壳模型位于 [`models/`](models/)：

- `Isolapurr.FCStd`：FreeCAD 工程文件。
- `Isolapurr-Bottom.step`：外壳底部 STEP 模型。
- `Isolapurr-4-Button-Print.step`：4 个按键连在一起、用于一次打印后再拆分的一体打印模型。
- `Isolapurr-Iframe.step`：外壳框架 STEP 模型。

## 资料归档约定

新增机械模型请放入 `models/`，并在本文件的“外壳模型”列表中补充说明。新增 PCB 源文件或制造输出请放入 `pcb/`；如果资料只属于某个硬件变体，请放入对应的 `tps-*` 子目录。
