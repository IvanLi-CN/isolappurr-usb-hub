# Isolapurr USB Hub Web

React SPA (Vite + React + TypeScript) for the mock dual-port dashboard, designed to be deployed on GitHub Pages.

## Quick start

- Install: `bun install`
- Dev server: `bun dev` (default: `http://127.0.0.1:45173`)
- Storybook: `bun run storybook` (default: `http://127.0.0.1:46006`)
- Preview: `bun run preview` (default: `http://127.0.0.1:45175`)

## Review tips

- Storybook includes viewport presets for quick layout checks:
  - `Isolapurr Mobile (390×844)`
  - `Isolapurr Desktop (1440×900)`

## Quality gates

- `bun run check`
- `bun run build`
- `bun run test:unit`
- `bun run build-storybook && bun run test:storybook`
- `bun run build && bun run test:e2e`
