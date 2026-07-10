# History

- Created to align IsolaPurr host operation with the `isolapurr-devd` plus `isolapurr` model while preserving Web Serial as a first-class product path.
- Added initial implementation slice: host-tools package, skills, firmware catalog generator, Web Local USB API migration, and CI packaging workflow.
- Replaced CLI-to-devd localhost HTTP with local IPC as the default daemon transport; localhost HTTP is now an explicit bridge surface.
- Added IPC daemon idle shutdown semantics for on-demand clients.
- Added Local USB firmware guard requirements for project identity, compatibility, non-project firmware, and download-mode confirmation.
- Added official user-machine host-tools installers so `isolapurr-user-operations` can install released CLI/devd tools without requiring a source checkout.
- Tightened the user skill install gate so missing released host tools or unavailable installer assets cannot be answered with raw system USB/serial enumeration.
- Added the standalone `/flash` workbench, moved the Web flash UX away from
  the old inline upload-only panel, and introduced same-origin bundled release
  assets with a 50-version app window plus latest stable/latest prerelease
  recovery images.
- Re-opened recovery flashing for confirmed IsolaPurr hardware and aligned the
  bundled recovery path to accept either `full_image` or `elf` recovery
  artifacts instead of forbidding recovery on ordinary boards.
- Updated the Web firmware bundler so legacy ELF-only recovery releases are
  promoted into merged bundled `full_image` assets with matching local catalog
  metadata, instead of accidentally repackaging the plain app image at `0x0`.
- Fixed the Local USB recovery closeout path so post-flash identity capture no
  longer deadlocks on the serial guard during reboot, and confirmed-target
  recovery no longer falsely requires the non-project strong-confirm path.
- Hardened the Web Serial flash path against the browser's transient
  `SerialPort.open` failure window after probe/reset by retrying the exact
  browser-level open error before surfacing a write failure to the owner.
- Refined the `/flash` probe and authorization workflow: authorized Web USB
  devices can be re-read without reopening the browser picker, explicit
  release delegates to `SerialPort.forget()` when the browser supports it, and
  the active probe view uses a compact loading rail with a seconds-only probe
  window. Added repeatable demo, Playwright, Storybook, and visual evidence
  coverage for these states.
- Replaced the probe window's display-only countdown with an operational Web
  Serial deadline after production behavior showed that stale-port polling and
  serial retries could continue for tens of seconds, accept late results, and
  reset the board after the visible timer reached zero. Expired low-level work
  now skips every reset action and only releases the transport.
- Reduced first-time Web Serial hardware probing to the minimum esptool
  register path, removed packet tracing and duplicate flashing-oriented stub
  initialization, and added a MAC-bound hardware cache so repeat probes stay on
  the firmware API path without resetting a known board.
- Removed the remaining unconditional low-level probe after project firmware
  identity succeeds. Recognized targets now use firmware-reported hardware or
  the VID/PID-bound legacy `tps-sw` profile, while new firmware reports runtime
  PSRAM capacity directly in USB `info`. Added an explicit-path Playwright HIL
  that proved 45 consecutive real-device probes below five seconds without a
  control-line reset.
- Clarified and implemented `isolapurr discover` so LAN results come from live
  mDNS discovery, USB results come from the current local scan, and saved
  device profiles only annotate matching live results instead of standing in for
  discovery.
- Tightened discover annotation rendering so one live result surfaces only one
  canonical saved device profile instead of echoing duplicate saved entries
  from alternate transports of the same device.
- Added `isolapurr power config show|set` as the owner-facing whole-config
  entrypoint for saved TPS power settings, while keeping `power output ...` and
  `power source-capability set` as compatibility wrappers over the same merged
  config write path.
- Extended the aligned power-config transport contract with top-level
  `light_load_mode=pfm|fpwm`, defaulting missing legacy values to `pfm` on the
  host side.
- Tightened the aligned write model so Web power-config saves only send
  writable fields, avoiding accidental echo of read-only `manual.path_policy`
  back into the bridge/device contract.
- Re-aligned repo-managed workflow truth to the released CLI surface by removing stale user-skill command forms and introducing one maintainer workflow truth source plus a repo-private workflow router.
- Bound repo-managed Web verification guidance to the dedicated `kvbq9` policy
  spec and extended repo-contract coverage so page-level Storybook drift,
  extra `/demo/*` pages, and uncontrolled demo-route drift are caught
  automatically.
