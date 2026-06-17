# Repository Guidelines

## Start Here

- Project overview and public navigation: [README.md](README.md)
- Maintainer workflow truth source: [docs/maintainer-workflow.md](docs/maintainer-workflow.md)
- Released CLI/devd contract: [docs/specs/r7m2q-cli-devd-alignment/SPEC.md](docs/specs/r7m2q-cli-devd-alignment/SPEC.md)
- Repo-managed user workflow skill: [skills/isolapurr-user-operations/SKILL.md](skills/isolapurr-user-operations/SKILL.md)
- Repo-managed developer workflow skill: [skills/isolapurr-developer-operations/SKILL.md](skills/isolapurr-developer-operations/SKILL.md)
- Repo-private maintainer router: [skills/isolapurr-maintainer-workflow/SKILL.md](skills/isolapurr-maintainer-workflow/SKILL.md)

## Repository Shape

- Firmware: `src/`, `Cargo.toml`, `.cargo/config.toml`
- Shared firmware core: `crates/isolapurr-firmware-core/`
- Web UI: `web/`
- Host tools: `tools/isolapurr-host/`
- Skills: `skills/`
- Docs/specs: `docs/`, `docs/specs/`
- Hardware artifacts: `hardware/`

## Workflow Rules

- Treat the current released CLI surface as the truth source for repo-managed user docs and skills.
- Do not reintroduce stale released selector variants or legacy hardware-save forms.
- `README.md` is for human navigation, `AGENTS.md` is the concise entry contract, and `docs/maintainer-workflow.md` is the detailed maintainer process source.
- When released CLI/devd behavior, repo-managed skills, or maintainer workflow truth changes, update the owning spec companion docs under `docs/specs/`.
- When a process or doc drift could recur, add or update automated repo contract tests.
- Web verification surfaces follow
  [`docs/specs/kvbq9-web-demo-surface-policy/SPEC.md`](docs/specs/kvbq9-web-demo-surface-policy/SPEC.md):
  production SPA routes are the only app-level Web pages, Storybook is for
  reusable components and composite surfaces, and ad hoc demo routes plus
  `web/src/pages/*.stories.*` are forbidden unless a spec explicitly approves
  an exception first.

## Core Commands

- `just firmware-check`
- `just firmware-core-test`
- `just host-tools-test`
- `just web-check`
- `just desktop-agent-build`

Use [README.md](README.md) for broader command context and [docs/maintainer-workflow.md](docs/maintainer-workflow.md) for routing.

## Hard Safety Rules

- Never auto-select a serial port.
- Do not set `PORT=...` unless the owner explicitly provided the exact device path.
- Treat missing released host tools as an install gate for owner-facing hardware work.
- `mcu-agentd` is legacy/emergency only and must not be recommended as the default development path.
- Never commit secrets.

## Delivery Rules

- Use Conventional Commits in English.
- Sign off commits with `git commit --signoff`.
- Keep validation proportional to the changed surface, but repo truth-source and released CLI boundary changes must include relevant docs/spec/test updates together.

## License

Unless noted otherwise, this repository is dual-licensed under `MIT OR Apache-2.0` (see `LICENSE-MIT` and `LICENSE-APACHE`).
