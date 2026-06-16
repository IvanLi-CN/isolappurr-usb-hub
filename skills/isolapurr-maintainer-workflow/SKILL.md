---
name: isolapurr-maintainer-workflow
description: "Repo-private entrypoint for IsolaPurr maintainers: route between released user workflows, source maintenance workflows, docs/spec/project-doc sync, release-boundary checks, and handoff obligations without inventing a parallel truth source."
---

# IsolaPurr Maintainer Workflow

Use this repo-private skill when working inside the IsolaPurr source checkout as a maintainer, contributor, or release engineer.

## Purpose

- Route the task to the right repo truth source before touching hardware, docs, specs, release assets, or project workflows.
- Keep repo-managed skills, README, `AGENTS.md`, specs, and human project docs aligned with the current released CLI/devd surface.
- Prevent fallback to stale command examples, browser automation, localhost bridge shortcuts, or ad-hoc process lore when a released or documented path already exists.

## Routing

- Use `isolapurr-user-operations` when the task is owner-facing hardware operation on a normal machine through released `isolapurr` / `isolapurr-devd`, release installers, saved hardware memory, or official Web Serial.
- Use `isolapurr-developer-operations` when the task requires source checkout commands, Just recipes, release engineering, firmware/Web/Desktop builds, HIL, or debugging missing user-facing capabilities.
- Use `docs/specs/r7m2q-cli-devd-alignment` when the task changes the released CLI/devd boundary, repo-managed skills, installer contract, README command examples, or AGENTS/process entrypoints.
- Use `docs/maintainer-workflow.md` as the detailed workflow truth source for maintainer-facing process decisions.
- Use `README.md` for human project navigation and current public entrypoints.
- Use `AGENTS.md` only as the concise repository contract and entry document; do not let it drift into a second full workflow manual.

## Hard Rules

- Do not restore deprecated released selector variants or legacy hardware-save forms just to satisfy stale documentation.
- Do not document a workflow as user-supported until the released CLI exposes it and the release assets needed by the workflow actually exist.
- Do not use localhost HTTP as the default control path for CLI/devd work. CLI talks to devd over local IPC; bridge HTTP exists only for browser/debug clients.
- Do not bypass missing released tools with repo-local commands unless the task explicitly switches into developer workflow.
- When a change alters behavior, public commands, or maintainer expectations, update the owning spec companion docs and relevant project docs in the same round.
- Cross-repo issues are follow-up work, not opportunistic edits. Capture them as handoff material after this repo is clean.

## Maintainer Checklist

- Confirm whether the task is a released user workflow issue, a source/developer issue, or a repo truth-source/documentation drift issue.
- Check the current released CLI surface before editing repo-managed user docs or skills.
- Decide `spec_disposition` against `docs/specs/**` before implementation when the released contract or workflow truth changes.
- Decide `project_doc_disposition` before close-out when stable maintainer or user-facing project truth changed.
- Add or update repo contract tests when the task repairs a process/documentation contract that could drift again.
- Produce a handoff artifact for external follow-ups instead of mutating another repository from this branch.
