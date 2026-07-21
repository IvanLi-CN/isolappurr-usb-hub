# PWA 启动壳与启动恢复 实现状态（#tfzd3）

> 当前有效规范仍以 `./SPEC.md` 为准；这里记录实现覆盖、交付进度与 rollout 相关事实，避免这些细节散落到 PR / Git 历史里。

## Current Status

- Implementation: 已实现
- Lifecycle: active
- Catalog note: installed-PWA startup shell, failure recovery shell, proactive prompt-preserving update discovery, and Pages hashed-asset retention

## Coverage / rollout summary

- `web/index.html` 现在在 React bundle 之前注入独立启动壳，并为 standalone / installed PWA 冷启动提供品牌首屏。
- `web/public/boot-shell.js` 接管启动期错误、挂载超时、`waiting` service worker 激活、自愈 reload 和缓存修复动作。
- `web/src/main.tsx` 与 `web/src/pwa/boot-shell-client.tsx` 已为应用挂载成功和同步启动失败提供桥接信号。
- `web/src/pwa/register.ts` 与 `web/src/pwa/update.ts` 现在保留健康会话的 `prompt` 更新策略，同时在启动、回前台、重新联网和 60 分钟轮询时主动检查 `sw.js` / `registration.update()`。
- 健康会话的更新 toast 现在支持按候选更新指纹做标签页级 `Later` 去重，同一候选更新在同一标签页会话内只提示一次。
- `.github/workflows/release.yml` 现在在 stable public deploy 构建里执行旧 hash 资源 retention，并产出 `asset-retention.json`；`.github/workflows/pages.yml` 只承担 PR build 与 `release_tag` backfill。
- Storybook 已覆盖 `PWA/StartupShell` 与 `PWA/UpdateToast`；Playwright E2E 已覆盖健康冷启动、自愈成功与修复后保存设备保留。
- 2026-07-20 已完成一轮 same-machine Chrome acceptance：基于本地 `web/dist` preview 验证了候选更新 toast 的 `Later` 同候选去重，以及 `Update` 触发 reload 后重新进入应用。

## Remaining Gaps

- 当前没有已知实现缺口；后续若调整更新 toast 的 copy、按钮语义或提示节奏，需要同步刷新本 spec 的 `## Visual Evidence` 与对应 Storybook / E2E 证据。

## Related Changes

- `web/index.html`
- `web/public/boot-shell.js`
- `web/src/main.tsx`
- `web/src/pwa/boot-shell-client.tsx`
- `web/src/pwa/register.ts`
- `web/src/pwa/update.ts`
- `web/src/pwa/PwaStartupShell.tsx`
- `web/src/pwa/PwaStartupShell.stories.tsx`
- `web/src/pwa/PwaUpdateToastDemo.stories.tsx`
- `web/scripts/retain-pages-assets.ts`
- `web/scripts/retain-pages-assets.test.ts`
- `web/src/pwa/update.test.ts`
- `.github/workflows/release.yml`
- `.github/workflows/pages.yml`
- `web/e2e/app.spec.ts`

## References

- `./SPEC.md`
- `./HISTORY.md`
