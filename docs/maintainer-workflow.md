# IsolaPurr Maintainer Workflow

This document is the maintainer-facing workflow truth source for the IsolaPurr repository. It explains which repo skill, doc, and validation path owns each class of task.

## Entry Points

- Public user workflow truth: [`skills/isolapurr-user-operations/SKILL.md`](../skills/isolapurr-user-operations/SKILL.md)
- Source/developer workflow truth: [`skills/isolapurr-developer-operations/SKILL.md`](../skills/isolapurr-developer-operations/SKILL.md)
- Repo-private maintainer router: [`skills/isolapurr-maintainer-workflow/SKILL.md`](../skills/isolapurr-maintainer-workflow/SKILL.md)
- Released CLI/devd contract spec: [`docs/specs/r7m2q-cli-devd-alignment/SPEC.md`](./specs/r7m2q-cli-devd-alignment/SPEC.md)
- Human project navigation: [`README.md`](../README.md)
- Repo entry contract: [`AGENTS.md`](../AGENTS.md)

## Routing Rules

### Released user workflows

Use `isolapurr-user-operations` when the task is about:

- Installing released `isolapurr` / `isolapurr-devd`
- Operating hardware through the released CLI surface
- Saved-device memory, LAN status, Wi-Fi, ports, power, flash, reset, monitor, and diagnostics
- Official Web Serial as a human browser path

Hard boundary:

- Do not require a source checkout or repo-local build for ordinary user-machine operation.
- Do not bypass missing released tools with local serial enumeration, project-local commands, browser automation, or localhost bridge shortcuts.

### Source and maintenance workflows

Use `isolapurr-developer-operations` when the task requires:

- `just` recipes, source builds, or local test runs
- Firmware, Web, Desktop, host-tools, release assets, or CI maintenance
- HIL, calibration, flashing/debugging from source, or implementation work

Hard boundary:

- Developer workflow inherits user-facing safety rules, but is allowed to use source commands and repo-local validation gates.

### Repo truth-source maintenance

Use `isolapurr-maintainer-workflow` when the task changes:

- Repo-managed skills
- README usage examples
- `AGENTS.md` entry rules
- Maintainer workflow docs
- Release-boundary contract tests
- CLI/devd public command examples or selector semantics

The owning product contract is `r7m2q-cli-devd-alignment`. If the task changes released CLI/devd wording, command examples, or public selector classes, update that spec in the same round.

## Released CLI Truth Source

The current user-facing truth source is the released CLI surface, not stale docs and not hypothetical compatibility aliases.

### Stable command families

- `status` by the released `device-id` or `url` selectors
- `hardware save` by the released `device-id` selector plus a name and one transport binding
- `isolapurr wifi show|set|clear`
- `isolapurr ports`, `ports power`, `ports replug`, `ports route`
- `isolapurr power show|config show|config set|output manual|output auto|source-capability set|defaults`
- `isolapurr diagnostics export`
- `isolapurr settings reset wifi|other`
- `isolapurr flash`, `reset`, `monitor`

### Banned legacy command fragments

These are no longer part of the repo truth source and must not be reintroduced in repo-managed docs or skills:

- Deprecated status selector variants that are no longer part of the released user contract
- Deprecated hardware-save selector variants that are no longer part of the released user contract
- Any workflow that treats temporary devd IDs as owner-facing selectors

## Documentation Responsibilities

- `README.md` explains what the project is, where the major surfaces live, and how humans should navigate the repo.
- `AGENTS.md` is the concise repository contract for contributors and agents. It should link outward instead of repeating full process prose.
- `docs/maintainer-workflow.md` is the detailed maintainer process truth source.
- `docs/specs/**` hold normative topic contracts and their implementation/history companions.
- `docs/solutions/**` hold reusable engineering lessons when the task hits existing solution knowledge or creates a new stable reusable lesson.

## Required Gates Before Close-Out

### Spec gate

- If the task changes released host-tools behavior, repo-managed workflow docs, user skill contract, or CLI wording, update the owning spec companion docs.
- For this boundary, the default owner is [`docs/specs/r7m2q-cli-devd-alignment/SPEC.md`](./specs/r7m2q-cli-devd-alignment/SPEC.md).

### Project-doc gate

- If the task changes current human-facing project truth, update `README.md`, `AGENTS.md`, or other project docs before claiming merge-ready.
- For this repository, changes to maintainer routing and repo skill boundaries normally require `README.md`, `AGENTS.md`, and this workflow doc to stay aligned.

### Contract-test gate

- If the task repairs a documentation or process drift that could recur, add or update automated contract tests in `.github/scripts/` and any owning CI workflow.
- If the task changes a command example quoted in docs, add or update host-tools parser tests so the documented form is explicitly accepted and the deprecated form is explicitly rejected.

## Stop and Ask

Stop and ask for a human decision when:

- A hardware-changing action lacks target identity evidence
- A destructive operation lacks explicit confirmation
- A release artifact, installer asset, or public command is missing and the intended user workflow would otherwise be fabricated
- The requested change would alter remote Git communication, release ownership, or cross-repo scope

## Cross-Repo Follow-Up

Do not patch other repositories opportunistically from this repo branch. Once the IsolaPurr repo reaches merge-ready, generate a handoff artifact that names the external follow-up, links back to the relevant local spec/doc evidence, and leaves cross-repo implementation for the owning repository.
