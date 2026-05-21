# USB-C 下行通道路由切换历史

## 关键演进

- 2026-05-18：创建 canonical spec，锁定 `USB-C` 默认 route、独立 EEPROM device settings record、HTTP/USB JSONL route API、Web 设置页模式控件与硬件横向菜单入口。
- 2026-05-22：修正硬件菜单交互，`MODE` 先显示当前值，再由第二次确认实际切换，避免进入设置页即生效。

## 决策记录

- 使用双键长按进入横向设置菜单，菜单内左右短按移动光标、双键短按确认，避免隐藏式双键短按直接切换模式。
- route 写入 EEPROM 成功后才让远端设置 API 返回成功；EEPROM 写入失败必须可见，不只返回 accepted。
