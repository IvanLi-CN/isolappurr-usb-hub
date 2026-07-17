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

## Action System

The Web App action vocabulary is centralized around semantic primary, secondary, quiet, warning, and danger treatments. This replaces page-local button classes while keeping selection cards, tabs, and segmented controls separate because they describe current state rather than submit a command.

The destructive confirmation path is shared so saved-device deletion, recovery flashing, and power-calibration confirmation have consistent focus behavior, cancel affordances, final-action emphasis, and keyboard dismissal. Reset and clear actions use warning rather than the same visual weight as normal task completion.

Theme-owned input surfaces are explicit as well: disabled form controls retain the active panel token in dark and system-dark mode rather than inheriting a light framework fill. This keeps the action hierarchy legible across all supported theme choices.

## 2026-07-17

The browser runtime moved from per-tab autonomous polling to a same-origin
single-writer model. One leader tab now owns discovery, transport bootstrap,
snapshot polling, and hardware writes; follower tabs consume the shared
snapshot, stay read-only, and must use explicit takeover to become leader.

This same update also introduced a browser-persistent per-device power-lock
owner store so refresh and short reopen flows can resume the same lock owner
within the existing device TTL window instead of self-blocking on a fresh
random owner after reload.
