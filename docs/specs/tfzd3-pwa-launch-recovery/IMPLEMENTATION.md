# PWA 启动壳与启动恢复 实现状态（#tfzd3）

> 当前有效规范仍以 `./SPEC.md` 为准；这里记录实现覆盖、交付进度与 rollout 相关事实，避免这些细节散落到 PR / Git 历史里。

## Current Status

- Implementation: 已实现
- Lifecycle: active
- Catalog note: installed-PWA startup shell, failure recovery shell, prompt-preserving SW healing, and Pages hashed-asset retention

## Coverage / rollout summary

- `web/index.html` 现在在 React bundle 之前注入独立启动壳，并为 standalone / installed PWA 冷启动提供品牌首屏。
- `web/public/boot-shell.js` 接管启动期错误、挂载超时、`waiting` service worker 激活、自愈 reload 和缓存修复动作。
- `web/src/main.tsx` 与 `web/src/pwa/boot-shell-client.tsx` 已为应用挂载成功和同步启动失败提供桥接信号。
- `web/src/pwa/register.ts` 保留健康会话的 `prompt` 更新策略，只在故障启动路径由启动壳自动接管恢复。
- `.github/workflows/pages.yml` 已在非 PR 发布构建中执行旧 hash 资源 retention，并产出 `asset-retention.json`。
- Storybook 已覆盖 `PWA/StartupShell`；Playwright E2E 已覆盖健康冷启动、自愈成功与修复后保存设备保留。

## Remaining Gaps

- 当前 visual evidence 只覆盖启动壳 launching / failed 两个 owner-facing 状态；如后续需要显式审阅 recovering 态，可在不改 contract 的前提下追加证据。

## Related Changes

- `web/index.html`
- `web/public/boot-shell.js`
- `web/src/main.tsx`
- `web/src/pwa/boot-shell-client.tsx`
- `web/src/pwa/register.ts`
- `web/src/pwa/PwaStartupShell.tsx`
- `web/src/pwa/PwaStartupShell.stories.tsx`
- `web/scripts/retain-pages-assets.ts`
- `web/scripts/retain-pages-assets.test.ts`
- `.github/workflows/pages.yml`
- `web/e2e/app.spec.ts`

## References

- `./SPEC.md`
- `./HISTORY.md`
