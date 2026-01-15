# macOS 首次运行（Gatekeeper / ad-hoc signing）

本项目当前的 Desktop App（Plan `#0008`）以 **ad-hoc signing**（`codesign -s -`）方式签名，用于满足运行时完整性要求与 WebView 相关组件的签名约束。

说明：

- ad-hoc signing **不是** “identified developer” 签名，也 **不包含 notarization**；
- 因此首次运行时，macOS Gatekeeper 仍可能阻止启动。

## 1) Finder 右键打开（推荐）

1. 在 Finder 里找到 `isolapurr-desktop.app`
2. 右键 → `Open`
3. 在弹窗中再次选择 `Open`

## 2) System Settings 放行

1. 尝试启动一次 App（被拦截即可）
2. 打开 **System Settings → Privacy & Security**
3. 找到 “App was blocked …” 相关提示
4. 点击 `Open Anyway`

## 风险提示

只对你信任的来源（本项目发布）执行放行操作；如果下载的文件被篡改，放行可能带来安全风险。

