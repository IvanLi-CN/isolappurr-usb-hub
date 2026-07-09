# Web Serial Real-Hardware Validation Notes

Target hardware for this run was the owner-specified serial path:

- `/dev/cu.usbmodem21231401`

Browser surface for this run:

- `http://127.0.0.1:13423/flash?v=9`

## Evidence map

- Recovery UI proof:
  - `web-serial-post-recovery.png`
  - This screenshot shows the same `/flash` page after a real Web Serial recovery write and same-page refresh, with the target rendered as `isolapurr-usb-hub 0.5.1`.
- Normal-update UI proof:
  - `web-serial-post-normal-reprobe.png`
  - This screenshot shows the same `/flash` page after the subsequent Web Serial normal update and same-page refresh, with the target rendered as `isolapurr-usb-hub 0.5.0`.
- Hardware truth after recovery:
  - `web-serial-board-info-post-recovery.json`
  - `web-serial-status-post-recovery.json`
  - These confirm `MCU=ESP32-S3`, `Flash=4 MB`, `RAM=512 KB`, `PSRAM=null`, `MAC=9c:13:9e:f2:93:cc`, `device_id=f293cc9c139e`, and `firmware.version=0.5.1`.
- Hardware truth after the final normal update:
  - `web-serial-board-info-post-normal.json`
  - `web-serial-status-post-normal.json`
  - These confirm the same board identity and show the firmware returned to `0.5.0`.
- Bridge trace evidence around the final normal update:
  - `web-serial-devd-session-after-normal.json`
  - This preserves repeated successful `info` responses after the board came back from the Web Serial write.

## Capture caveat

- Both Web Serial writes have a short reboot window where `GET /api/v1/devices/usb--dev-cu-usbmodem21231401/status` can return:
  - `device did not respond to IsolaPurr info`
- That transient response happened only during the immediate post-write restart window.
- The saved `web-serial-status-post-recovery.json` and `web-serial-status-post-normal.json` files were refreshed again after the board returned to the application and therefore are the stable truth sources for this audit run.
