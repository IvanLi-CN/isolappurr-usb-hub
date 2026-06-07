# Local USB Host Tools

这份文档描述 released-style Local USB host tools：`isolapurr-devd` 与
`isolapurr`。它聚焦日常设备操作、设备选择器边界，以及哪些命令允许使
用临时 devd 目标。

## 日常命令

- 列出已保存硬件：`just isolapurr hardware list`
- 查看电源配置与实时状态：`just isolapurr power show --hardware <saved-id>`
- 进入手动输出模式：`just isolapurr power output manual --hardware <saved-id> --voltage-mv 9000 --current-limit-ma 2000 --usb-c-path automatic`
- 切回自动输出模式：`just isolapurr power output auto --hardware <saved-id>`
- 恢复默认电源配置：`just isolapurr power defaults --hardware <saved-id>`

## 设备选择器使用范围

`isolapurr` 有两类选择器，它们的区别是使用范围，不是“新旧两套写法”。

- `--hardware <saved-id>`
  - 用途：面向日常 owner-facing 操作。
  - 来源：`isolapurr hardware list` 中已经绑定/保存过的设备 ID。
  - 适用命令：`status`、`wifi`、`ports`、`diagnostics`、`power` 等普通设
    备控制命令。

- `--device <temporary-devd-id>`
  - 用途：面向临时 devd 目标仍然合理的 USB 维护操作。
  - 来源：devd 扫描阶段发现的临时目标。
  - 适用命令：绑定/保存前识别、烧录、`reset` 等维护路径。
  - 不适用：普通 owner-facing 设备控制。

## Power 命令特殊规则

`power` 命令族只接受已保存硬件，不接受临时 devd 目标。

- 允许：
  - `just isolapurr power show --hardware <saved-id>`
  - `just isolapurr power output manual --hardware <saved-id> ...`
  - `just isolapurr power output auto --hardware <saved-id>`
  - `just isolapurr power defaults --hardware <saved-id>`

- 也允许：
  - 省略选择器后，从“已保存硬件”列表交互选择。

- 不允许：
  - `just isolapurr power show --device <temporary-devd-id>`
  - 任何用 `--device` 或 `--url` 指向临时/直接目标的 `power` 命令。

## 选择 saved-id

先看已保存硬件：

```bash
just isolapurr hardware list
```

然后把输出里的 ID 用在 `--hardware` 上，例如：

```bash
just isolapurr power show --hardware isolapurr-01
```
