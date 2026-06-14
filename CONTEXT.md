# Context

## Device identity

- `device_id`
  The only owner-facing device identity for an IsolaPurr USB Hub.
  It is a 12-character lowercase hex string derived from the base eFuse MAC with byte order `mac[3..6] + mac[0..3]`.
  All normal product flows, saved-device records, discovery dedupe, Wi-Fi/LAN binding, and runtime routing must resolve to the full `device_id`.

- `device_id` short display / prefix
  The first 6 characters of the full `device_id`.
  It is only a display or owner-input convenience. The system must resolve it back to one full `device_id` before continuing.
  Ambiguous prefixes must be rejected.

- `USB port ID`
  The OS-visible Local USB `port_path`, such as `/dev/cu.usbmodem21221401`.
  It is only valid for advanced Local USB flows such as first flash, firmware upgrade, add-device bootstrap, and development maintenance.
  It is not a second device identity.

## Hardware interfaces

- `USB-A`
  The fixed downstream USB-A interface.

- `USB-C`
  The downstream USB-C interface on the TPS/SW2303 power channel.

- `2 mm banana jack`
  The bench-output interface on the same TPS/SW2303 power channel as `USB-C`.
  It is not an independent power rail.
  _Avoid_: banana output, 2mm output

- `shared TPS/SW2303 power channel`
  The power channel shared by `USB-C` and the `2 mm banana jack`.

- `SW2303 VBUS path`
  The connector-side VBUS path controlled through SW2303 for `USB-C`.

## Excluded terms

- `hardware_id`
  Not a valid project term.

- `saved hardware id`
  Not an owner-facing identity contract.

- `temporary devd target id`
  Not an owner-facing identity contract.

## Legacy boundary

- Legacy 6-character firmware `device_id` values are upgrade-only.
- Normal runtime, storage, and owner-facing control must reject them and require firmware upgrade first.
- Existing local records that do not use the canonical 12-character `device_id` are cleared instead of migrated by guesswork.
