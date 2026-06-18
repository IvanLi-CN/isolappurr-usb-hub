# Web error states 演进历史（#kk6gk）

> 这里记录会影响 Agent 理解“为什么一步步变成现在这样”的关键演进；单次任务流水账不放这里，规范正文仍以 `./SPEC.md` 为准。

## Decision Trace

- 2026-06-18: 将未知路由 fallback 从 `AppLayout` 中拆出，收敛为独立页面级 `404`。
- 2026-06-18: 将缺失保存设备状态与页面级 `404` 统一到同一错误页骨架下。
- 2026-06-18: 追加整页浏览器视口视觉证据，并允许同一证据直接复用到 PR 正文。

## Key Reasons / Replacements

- 新增本 spec，是因为这次任务已经形成稳定的 Web 错误态主题；继续保持 `Specs: -` 会让视觉证据和行为 contract 没有规范落点。

## References

- `./SPEC.md`
- `./IMPLEMENTATION.md`
