# History

## 2026-06-03

- Added the SW2303-only power configuration topic.
- Chose whole-config transactions to avoid partial protocol/current/path state.
- Kept SW2305 and VOOC as reserved future schema space, not runtime support.
- Bound manual USB-C path control to explicit mode and SW2303 request checks.
- Added Web, USB JSONL, Local USB, and on-device GC9307 control surfaces.
- Captured Storybook canvas visual evidence for desktop and narrow layouts.

## 2026-06-10

- Added `CC` and `DPDM` negotiation badges to the Web power protocol cards.
- Hid negotiation badges on narrow cards with card-level container queries to
  preserve responsive readability.
- Extended Storybook/spec evidence to cover badge visibility on wide, narrow,
  and constrained medium-width protocol cards.
