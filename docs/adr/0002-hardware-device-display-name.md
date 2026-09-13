# Hardware-Owned Device Display Name

The hub owns an optional UTF-8 device display name in EEPROM, while the eFuse-derived `device_id` and its mDNS hostname remain immutable. This keeps every transport and client consistent about the name shown to an operator without making a human label part of discovery, routing, or device selection.

## Considered Options

- Rename the mDNS hostname with the user label. This would invalidate saved URLs and make discovery identity mutable.
- Keep the name only in each client profile. This would make different Web, Desktop, and CLI clients disagree.

## Consequences

- New firmware exposes the hardware name through the shared `info` contract and accepts the same setting through HTTP and USB JSONL.
- Client profiles retain a three-state cache for offline and legacy-firmware fallback, but never override a confirmed hardware value.
- A cleared or unavailable hardware name falls back to the stable hostname; it is not coupled to Wi-Fi or other-settings reset.
