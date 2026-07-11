# Design

## Overview

IsolaPurr USB Hub uses a restrained product UI system for a hardware control console. The interface should feel reliable under bench-debugging conditions: clear status bands, compact panels, stable measurements, and familiar controls.

## Color

Use a restrained palette with tinted neutrals and one primary accent for actionable selections and active connection state. Semantic colors are reserved for success, warning, error, busy, and disabled states.

Current token direction:

- Background: softly tinted near-neutral surface, currently `--bg`.
- Panels: layered neutrals, currently `--panel` and `--panel-2`.
- Borders: low-contrast structural lines, currently `--border`.
- Primary: muted green accent, currently `--primary`.
- Success, warning, error: semantic status tokens only.

Prefer OKLCH for new or revised tokens. Avoid pure black or pure white in new colors; tint neutrals subtly toward the system hue.

## Typography

Use system UI fonts for interface text and a monospace face only for telemetry values, firmware identifiers, serial paths, hashes, and logs. Headings should be compact and task-oriented, not hero-scale. Numeric telemetry should use stable widths where possible to prevent layout shift.

## Layout

The product uses an app shell with a top bar, device/sidebar area, and a main work surface. For hardware control surfaces, prioritize:

- a connection/setup strip near the top;
- primary telemetry and port controls in the main column;
- logs, flash progress, and advanced configuration in secondary areas;
- responsive stacking that preserves action order on narrow screens.

Cards are allowed for distinct repeated hardware units such as ports, devices, or workflow stages. Avoid nested cards and decorative panel stacking.

## Components

Core components should share the same visual vocabulary:

- a shared action hierarchy: `primary` for normal completion, `secondary` for cancellation and safe alternatives, `quiet` for low-emphasis disclosure, `warning` for reset/clear, and `danger` for deletion or irreversible confirmation;
- fixed-size icon buttons with accessible labels and native tooltips;
- confirmation dialogs that restore focus, keep focus within the decision while open, and make the final destructive action more prominent than cancellation;
- status badges with text labels;
- segmented or tab-like transport selection;
- forms with visible labels, helper text, validation states, and token-driven disabled/loading states in every supported theme;
- inline confirmations before disruptive port power or flash actions;
- log/output panes with monospace text and clear empty/error states.

## Motion

Motion should communicate state changes only: connection established, flash progress update, panel reveal, validation feedback. Keep transitions around 150-250 ms with ease-out timing. Avoid page-load choreography and layout-property animations.

## Content

Copy should be concise and operational. Prefer exact labels such as `Flash firmware`, `Connect via Web Serial`, `Configure Wi-Fi`, `Power off USB-A`, and `Replug data`. Error messages should say what failed and what the user can do next.
