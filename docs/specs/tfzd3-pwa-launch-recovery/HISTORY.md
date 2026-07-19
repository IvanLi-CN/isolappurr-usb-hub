# PWA 启动壳与启动恢复 演进历史（#tfzd3）

> 这里记录会影响 Agent 理解“为什么一步步变成现在这样”的关键演进；单次任务流水账不放这里，规范正文仍以 `./SPEC.md` 为准。

## Decision Trace

- 2026-07-19: 为已安装 PWA 新增独立于 React bundle 的启动壳，正式消除“冷启动先白屏”的空窗。
- 2026-07-19: 把启动故障恢复拆成两层：健康会话继续 `prompt` 更新，故障启动路径自动激活 `waiting` worker 并在必要时落入失败壳。
- 2026-07-19: 为 GitHub Pages 增加旧 hash 静态资源 retention 窗口，避免 stale `index.html` 立刻命中被删除 bundle。
- 2026-07-19: 追加 Storybook visual evidence 与 Playwright 回归，把白屏恢复做成可持续验证的合同。

## Key Reasons / Replacements

- 新增本 spec，是因为这次修复已经形成长期稳定的 PWA 启动恢复主题；继续只靠 `docs/web-ui-interaction-spec.md` 的概述条目无法承载启动壳、自愈状态机和发布 retention 的细粒度 contract。

## References

- `./SPEC.md`
- `./IMPLEMENTATION.md`
