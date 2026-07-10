# History

## Creation

This spec consolidates the long-lived product capability for USB communication, firmware update, Wi-Fi provisioning, Local USB, and Web App control into `docs/specs/**`.

Legacy references remain in `docs/plan/**` until a dedicated cleanup approves deletion or full migration.

## Implementation Shape

The product flow keeps device connection in the existing Add device modal and keeps firmware update on the saved device Hardware page. This replaced the temporary standalone hardware console route so Web Serial and Local USB cannot bypass the device-add flow.

Web Serial firmware update uses the saved device's current USB channel. After flashing, the app restores the authorized serial port without reopening the browser serial picker and republishes the device link so runtime polling can refresh identity, telemetry, and primary-channel state.

Wi-Fi configuration belongs on the saved device Hardware page rather than Add device because it is maintenance for an already identified hub. The UI uses the same active transport failover model as telemetry and port controls, while PSK values remain write-only and are never rendered back into the page.

Development-stage hardware work now uses the project-local `isolapurr-desktop` Local USB CLI as the default path. `mcu-agentd` remains legacy/emergency only so the repository's development loop and product Local USB semantics share the same serial, identity, flash address, reset, and monitor contract.

The communication model was clarified so Wi-Fi / LAN, Web Serial, and Local USB are documented as equal delivery paths with distinct capability boundaries. The spec now records why multiple schemes exist, each path's immediate availability prerequisites, intended use, and non-overlapping limitations. Default preference has an explicit product meaning: it only applies when multiple paths are immediately available, and it is selection logic rather than a quality ranking.

On 2026-07-10, the device list selection contract moved from a subtle panel-fill difference to a dedicated selected surface, high-contrast full-card boundary, check marker, and `aria-current="page"`. The change keeps connection badges independent from navigation selection and makes the current saved device recognizable in dark mode without relying on color alone.
