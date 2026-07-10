# devd Real-Hardware Validation Notes

Target hardware for this run was the owner-specified serial path:

- `/dev/cu.usbmodem21231401`

Bridge surface for this run:

- `http://127.0.0.1:64400/flash?v=devd-local`

## Evidence map

- Pre-normal-update UI proof:
  - `devd-pre-normal-update.png`
  - This screenshot shows the same-page state after recovery re-probe and before the normal update, with the target firmware rendered as `isolapurr-usb-hub 0.5.1`.
- Post-normal-update UI proof:
  - `devd-post-normal-reprobe.png`
  - This screenshot shows the same page after the normal update re-probe, with the target firmware rendered as `isolapurr-usb-hub 0.5.0`.
- Hardware truth before/after the normal update:
  - `devd-board-info-pre-normal.json`
  - `devd-board-info-post-normal.json`
  - These confirm `MCU=ESP32-S3`, `Flash=4 MB`, `RAM=512 KB`, `PSRAM=null`, and `MAC=9c:13:9e:f2:93:cc` before and after the write.
- Firmware/status truth after the normal update:
  - `devd-status-post-normal-success.json`
  - This confirms `device_id=f293cc9c139e`, `firmware.version=0.5.0`, `hostname=isolapurr-usb-hub-f293cc9c139e`, and `mac=9c:13:9e:f2:93:cc`.
- Bridge/session trace after the normal update:
  - `devd-session-post-normal-success.json`
  - This captures repeated successful `info` responses from the bridged Local USB device after the normal update.

## Capture caveat

- `devd-status-pre-normal.json` and `devd-status-pre-normal-capture-error.json` are preserved as process evidence only.
- That capture happened during a transient device/bridge window and returned:
  - `device did not respond to IsolaPurr info`
- Those files must not be treated as the successful pre-normal truth source.
- The successful pre-normal firmware truth for this audit run is the UI evidence in `devd-pre-normal-update.png`, which was captured on the same page after recovery had already re-probed the target and rendered `isolapurr-usb-hub 0.5.1`.
