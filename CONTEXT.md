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

## Power configuration

- `tps_mode`
  The saved TPS output target source mode.
  `auto_follow` means TPS follows the live USB-C request.
  `manual` means TPS uses the saved manual voltage/current target.
  It does not describe the TPS switching mode.

- `light_load_mode`
  The saved TPS55288 light-load switching mode.
  `pfm` means the board-default PFM behavior.
  `fpwm` means force-PWM behavior through the TPS55288 `MODE` register override.
  It is independent from `tps_mode`.

- `output current limit`
  The applied TPS55288 `IOUT_LIMIT` output-current setpoint exposed by PD diagnostics.
  It is a configured limit value, not the live measured USB-C current.

- `enabled protocol`
  A protocol that remains advertised in the saved SW2303 capability profile.
  It means the source is willing to negotiate that protocol when a matching
  sink attaches. It does not mean the sink is currently using that protocol.

- `active protocol`
  The live protocol currently negotiated on USB-C, exposed by PD diagnostics.
  The Web Power panel uses this term for the visually highlighted protocol
  card. It is distinct from `enabled protocol`, because several protocols may
  stay enabled while only one protocol is active at a time.

- `fast-charge profile`
  The saved per-protocol high-voltage and current-limit toggles that extend the
  basic protocol on/off matrix, including QC2.0/QC3.0/PE2.0 20 V support and
  the shared non-PD 12 V path for FCP/AFC/SFCP.
