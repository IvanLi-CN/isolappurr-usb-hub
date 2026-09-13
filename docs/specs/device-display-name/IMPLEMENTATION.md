# Device Display Name 实现状态

## Current Status

- Implementation: verified
- Lifecycle: active
- Catalog note: EEPROM-backed UTF-8 label across firmware, host tools, and Web Settings.

## Implementation Coverage

- Requirement coverage: `REQ-DNAME-001..006` are implemented across firmware provisioning/API, host control-plane adapters, local profile storage, and Web Settings.
- Verification commands: `just firmware-core-test`, `just firmware-check`, `just host-tools-test`, `just web-check`, and `just desktop-agent-build`.
- Rollout facts: New fields are additive; legacy firmware continues to report stable identity and uses client fallback when name capability is absent.

## Coverage / rollout summary

- Firmware-core record, endpoint, host-tools, Web, Storybook, and Desktop checks pass.
- Desktop cache refreshes use a field-level devd storage endpoint so a stale browser tab cannot overwrite a newer local profile name or transport binding.
- Browser-only cache refreshes merge against the latest localStorage profile before persisting, preserving a newer alias or transport binding from another tab.
- Browser-only cache refreshes also derive an omitted hostname from that latest snapshot, preserving a newer stable hostname during concurrent tab updates.
- Browser-to-Desktop migration records the migrated payload fingerprint in localStorage and does not reapply an unchanged browser snapshot on later launches; existing Desktop identity, name cache, hostname, and transports win field conflicts while missing fields may be filled.
- USB clear responses without a returned hostname no longer synthesize an owner-facing name from the internal devd target id; the existing display state is left unchanged until a later info response supplies a stable hostname.
- The production demo Settings surface was checked at desktop, `393x852`, and dark-theme viewports; the confirmed screenshots are linked from `SPEC.md`.
- Owner-authorized HIL on `/dev/cu.usbmodem21141401` completed with the source-built ESP32-S3 app image after updating the confirmed port cache to the device actually connected. Post-flash USB JSONL `info` returned `device_id=856a141cdbd4`, `display_name=null`, and `capabilities.device_name=true`; hostname/FQDN remained `isolapurr-usb-hub-856a141cdbd4[.local]` and MAC remained `1c:db:d4:85:6a:14`.
- The source target does not provide a Rust test harness for `cargo test --features net_http --lib`; shared firmware-core tests and the supported firmware build/check commands are the applicable evidence.

## Remaining Gaps

- Real-device naming mutation remains intentionally owner-operated through the CLI/Web control plane; no mutation was issued during HIL.

## Related Changes

- [ADR-0002: Hardware-Owned Device Display Name](../../adr/0002-hardware-device-display-name.md)
- `docs/specs/device-display-name/assets/` contains the owner-confirmed production and Storybook evidence set.

## References

- `./SPEC.md`
- `./HISTORY.md`
