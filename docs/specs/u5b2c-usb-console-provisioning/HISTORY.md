# History

## Creation

This spec consolidates the long-lived product capability for USB communication, firmware update, Wi-Fi provisioning, Local USB, and Web App control into `docs/specs/**`.

Legacy references remain in `docs/plan/**` until a dedicated cleanup approves deletion or full migration.

## Implementation Shape

The product flow keeps device connection in the existing Add device modal and keeps firmware update on the saved device Hardware page. This replaced the temporary standalone hardware console route so Web Serial and Local USB cannot bypass the device-add flow.

Web Serial firmware update uses the saved device's current USB channel. After flashing, the app restores the authorized serial port without reopening the browser serial picker and republishes the device link so runtime polling can refresh identity, telemetry, and primary-channel state.

Wi-Fi configuration belongs on the saved device Hardware page rather than Add device because it is maintenance for an already identified hub. The UI uses the same active transport fallback model as telemetry and port controls, while PSK values remain write-only and are never rendered back into the page.
