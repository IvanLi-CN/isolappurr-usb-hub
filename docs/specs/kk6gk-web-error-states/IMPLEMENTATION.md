# Web error states 实现状态（#kk6gk）

> 当前有效规范仍以 `./SPEC.md` 为准；这里记录实现覆盖、交付进度与 rollout 相关事实，避免这些细节散落到 PR / Git 历史里。

## Current Status

- Implementation: 已实现
- Lifecycle: active
- Catalog note: standalone page-level 404 plus missing saved-device error state

## Coverage / rollout summary

- 页面级 `404` 已从 `AppLayout` 分离，未知路由直接进入独立错误页。
- `devices/:deviceId`、`devices/:deviceId/info`、`devices/:deviceId/power` 在缺失保存设备时已统一回退到 `MissingDeviceState`。
- Storybook 已覆盖 `Pages/NotFoundPage` 与 `Errors/MissingDeviceState`。
- Owner-facing visual evidence 已绑定到本 spec 的 `## Visual Evidence`。

## Remaining Gaps

- `401/403` 仍未纳入本主题实现范围。

## Related Changes

- `web/src/pages/NotFoundPage.tsx`
- `web/src/ui/errors/ErrorState.tsx`
- `web/src/ui/errors/MissingDeviceState.tsx`
- `web/src/ui/errors/NotFoundPage.stories.tsx`
- `web/src/ui/errors/MissingDeviceState.stories.tsx`
- `web/e2e/app.spec.ts`

## References

- `./SPEC.md`
- `./HISTORY.md`
