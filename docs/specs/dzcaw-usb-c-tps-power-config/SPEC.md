# USB-C TPS Power Config（#dzcaw）

## Background

The `tps-sw` hardware uses `SW2303` for USB-C protocol negotiation and
`TPS55288` for the programmable output stage. Existing firmware applied a fixed
SW2303 full profile and followed the negotiated SW2303 request into the TPS
setpoint. Operators needed a controlled way to persist and immediately apply
USB-C source capability and manual TPS bench settings without relying on
temporary firmware edits.

## Goals

- Persist a SW2303-only power configuration record in EEPROM.
- Apply saved settings immediately through HTTP, Web Serial, and Local USB.
- Keep the API write model as a whole-config transaction.
- Preserve the current full SW2303 profile as the restore-defaults behavior.
- Provide a Web USB-C / Power settings page with host lock protection.
- Provide on-device preset and advanced power pages for the GC9307 settings
  menu.

## Non-Goals

- Runtime support for SW2305, VOOC, or non-SW2303 hardware.
- Per-field query updates for power settings.
- Fine-grained voltage/current editing from the two-button GC9307 UI.
- Bypassing SW2303 protection to make sink-side measurements appear valid.

## Requirements

- `hardware` MUST accept only `sw2303` in this release.
- Defaults MUST restore the full SW2303 profile: PD, PPS, QC2, QC3, FCP, AFC,
  SCP, PE2.0, BC1.2, SFCP, fixed 9/12/15/20 V PDOs, and 100 W cap.
- Manual TPS voltage MUST stay in the 3 V to 21 V range.
- Manual TPS current MUST be capped by both TPS capability and the 100 W product
  ceiling.
- Manual TPS output MUST target the banana / 2 mm output path by default.
- USB-C manual path mode MUST have three values:
  - `default`: force-close when no valid SW2303 request exists, or when manual
    VOUT exceeds the SW2303 request; otherwise clear force bits and return path
    control to SW2303 automatic behavior.
  - `disconnect`: force-close unconditionally.
  - `force`: force-open unconditionally.
- HTTP, Web Serial, and Local USB MUST expose config get, config set, defaults,
  and lock commands.
- Host lock MUST use a TTL heartbeat. A host holding the lock MAY refresh it;
  other hosts MUST be rejected until the lock expires or is released.
- Local advanced controls MUST be blocked while a host lock is active, except
  existing USB-C power on/off behavior.
- Web UI MUST show write/read errors instead of staying in a loading state.
- Storybook coverage MUST include normal, host-locked, failure, save, restore,
  and narrow states for the power panel.

## Acceptance

- Given a missing or invalid EEPROM power record, when firmware boots, then it
  uses the full SW2303 auto-follow defaults and reports `persisted=false`.
- Given a valid saved record, when firmware boots, then it loads the record and
  applies the selected SW2303 capability profile after the SW2303 read gate.
- Given a whole power config write over HTTP, Web Serial, or Local USB, when the
  request validates and the lock allows it, then firmware stores the config to
  EEPROM, updates the API snapshot, and reapplies the SW2303 profile.
- Given `manual.usb_c_path_mode=default`, when manual VOUT is higher than the
  latest valid SW2303 request or no valid request exists, then firmware
  force-closes the SW2303 path.
- Given `manual.usb_c_path_mode=default`, when manual VOUT is less than or
  equal to the SW2303 request, then firmware clears SW2303 force-open and
  force-close bits.
- Given a remote host lock, when another host attempts a config write, then the
  write is rejected as busy and the UI presents the locked state.
- Given the GC9307 settings menu, when the owner opens Power Preset, then the
  screen shows the current preset and a second confirm restores defaults.
- Given the GC9307 settings menu, when the owner opens Power Advanced, then the
  screen shows mode, manual voltage/current, and path policy; a second confirm
  toggles auto-follow/manual TPS through the same pending EEPROM transaction.

## Milestones

- [x] Firmware config model, validation, and path policy helpers.
- [x] EEPROM record load/store and startup default fallback.
- [x] HTTP and JSONL API commands for config, defaults, and host lock.
- [x] Runtime TPS/SW2303 application path for manual mode and path control.
- [x] Web power settings page and runtime transport integration.
- [x] Storybook state coverage and interaction checks.
- [x] GC9307 settings menu preset and advanced power pages.
- [x] Visual evidence.

## Visual Evidence

- source_type: storybook_canvas
  story_id_or_title: `Panels/DevicePowerPanel/Default`
  state: default desktop
  requested_viewport: `1280x900`
  viewport_strategy: `devtools-emulate`
  capture_scope: `element`
  target_program: `mock-only`
  evidence_note: verifies the normal SW2303 manual TPS settings layout, protocol
  badges, path mode choices, guardrails, and actions.

![Device power panel desktop](./assets/device-power-panel-default-desktop.png)

- source_type: storybook_canvas
  story_id_or_title: `Panels/DevicePowerPanel/Narrow`
  state: narrow responsive
  requested_viewport: `390x844`
  viewport_strategy: `devtools-emulate`
  capture_scope: `element`
  target_program: `mock-only`
  evidence_note: verifies the power settings panel stacks without clipping
  labels, power cap, segmented controls, or action buttons.

![Device power panel narrow](./assets/device-power-panel-narrow.png)

## Risks

- SW2303 path forcing is intentionally limited to explicit manual mode policy.
  Production verification still needs sink-side measurement and must not rely on
  TPS front-end telemetry alone.
- Two-button on-device advanced controls are intentionally coarse; exact
  voltage/current editing stays in Web, Web Serial, and Local USB surfaces.
