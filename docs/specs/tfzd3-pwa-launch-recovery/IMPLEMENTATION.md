# PWA 启动壳与启动恢复 实现状态（#tfzd3）

> 当前有效规范仍以 `./SPEC.md` 为准；这里记录实现覆盖、交付进度与 rollout 相关事实，避免这些细节散落到 PR / Git 历史里。

## Current Status

- Implementation: 已实现
- Lifecycle: active
- Catalog note: installed-PWA startup shell, failure recovery shell, proactive prompt-preserving update discovery, Pages hashed-asset retention, and `/flash` PWA workbench metadata caching plus in-session manifest refresh

## Coverage / rollout summary

- `web/index.html` 现在在 React bundle 之前注入独立启动壳，并为 standalone / installed PWA 冷启动提供品牌首屏。
- `web/public/boot-shell.js` 接管启动期错误、standalone 挂载超时、service worker 更新检查、`waiting` worker 激活、自愈 reload 和缓存修复动作；即使浏览器没有把安装窗口报告为 standalone，也会保留显式失败观察器和 Repair 动作，避免旧 PWA shell 崩溃后继续白屏，同时不把普通 browser 慢挂载误报成 PWA 故障。
- `web/src/main.tsx` 与 `web/src/pwa/boot-shell-client.tsx` 已为应用挂载成功和同步启动失败提供桥接信号。
- `web/src/pwa/register.ts` 与 `web/src/pwa/update.ts` 现在保留健康会话的 `prompt` 更新策略，同时在启动、回前台、重新联网和 60 分钟轮询时主动检查 `sw.js` / `registration.update()`。
- 健康会话的更新 toast 现在支持按候选更新指纹做标签页级 `Later` 去重，同一候选更新在同一标签页会话内只提示一次。
- `web/vite.config.ts` 现在把 firmware flash workbench 固定为 PWA shortcut/screenshot 面，`web/scripts/copy-spa-shells.ts` 为稳定 Pages build 生成 `/flash/` 实体 SPA shell，并让 Workbox precache 包含 release manifest 与 catalog JSON 元数据；`.bin` / `.elf` 固件镜像仍按需获取，不进入 service worker install-time precache。
- `web/src/domain/firmwareBundle.ts` 现在以 cache-busted manifest URL 作为在线首选读取路径，并在失败时回退到稳定 URL，让健康会话避开旧 precache，同时保留离线 PWA 的 metadata fallback。
- `web/src/pages/useFirmwareFlashConnection.ts` 现在会在 `/flash` 进入、回到前台、重新联网、收到 PWA 更新候选事件以及 60 分钟轮询时刷新 release manifest；当前选择仍存在时保留，否则切到最新 release。
- `web/src/pwa/register.ts` 在发现健康会话更新候选时派发 `isolapurr:pwa-update-available`，供 `/flash` 在 owner 点击 `Later` 或尚未刷新 shell 前先更新 release list。
- `.github/workflows/release.yml` 现在在 stable public deploy 构建里执行旧 hash 资源 retention，并把 GitHub Release web-dist 资产作为 stable 历史真相源；没有 GitHub Release 凭证，或 GitHub API 成功但没有匹配 web-dist 资产的 bootstrap 路径，才退回线上 retention 清单或线上 `sw.js`。该步骤产出 `asset-retention.json`；`.github/workflows/pages.yml` 只承担 PR build 与 `release_tag` backfill。
- `web/scripts/retain-pages-assets.ts` 从既有 Release web-dist archive 恢复旧 hash 时，会优先读取 archive 内 `asset-retention.json` 中匹配 release id 的资产列表，避免把更旧 release 的继承保留资产继续滚入后续 release。
- Storybook 已覆盖 `PWA/StartupShell` 与 `PWA/UpdateToast`；Playwright E2E 已覆盖健康冷启动、自愈成功、修复后保存设备保留、离线 service-worker 控制下直接打开 `/flash` 时 workbench 与 bundled release list 可见，以及 PWA 更新候选出现后 `/flash` 当前会话 release list 刷新。
- 2026-07-20 已完成一轮 same-machine Chrome acceptance：基于本地 `web/dist` preview 验证了候选更新 toast 的 `Later` 同候选去重，以及 `Update` 触发 reload 后重新进入应用。
- 2026-07-22 的线上 Chrome 安装态诊断确认：旧窗口可持有已删除 hash 入口资产，刷新进入新版本后还会因为旧设备 `pd-diagnostics` 缺少 `thermal` 而白屏；当前实现通过 Release web-dist retention 和旧 schema E2E 回归同时覆盖这两段链路。
- 2026-07-22 的线上 Chrome 安装态复核确认：Chrome 安装窗口可能不匹配 `display-mode: standalone`，导致旧 boot shell 没有挂载失败观察器；当前实现改为健康时隐藏、显式启动故障时仍显示恢复壳，并在没有 `waiting` worker 时先主动 `registration.update()`。

## Remaining Gaps

- 当前没有已知实现缺口；后续若调整更新 toast 的 copy、按钮语义或提示节奏，需要同步刷新本 spec 的 `## Visual Evidence` 与对应 Storybook / E2E 证据。

## Related Changes

- `web/index.html`
- `web/public/boot-shell.js`
- `web/src/main.tsx`
- `web/src/pwa/boot-shell-client.tsx`
- `web/src/pwa/register.ts`
- `web/src/pwa/events.ts`
- `web/src/pwa/update.ts`
- `web/src/pwa/PwaStartupShell.tsx`
- `web/src/pwa/PwaStartupShell.stories.tsx`
- `web/src/pwa/PwaUpdateToastDemo.stories.tsx`
- `web/vite.config.ts`
- `web/scripts/retain-pages-assets.ts`
- `web/scripts/retain-pages-assets.test.ts`
- `web/src/pwa/update.test.ts`
- `web/src/domain/firmwareBundle.test.ts`
- `web/src/pages/useBundledFirmwareManifest.ts`
- `.github/workflows/release.yml`
- `.github/workflows/pages.yml`
- `web/e2e/app.spec.ts`

## References

- `./SPEC.md`
- `./HISTORY.md`
