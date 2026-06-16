use anyhow::{Context as _, anyhow};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use directories::ProjectDirs;
use rand::{Rng as _, distributions::Alphanumeric};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    net::SocketAddr,
    path::{Path as FsPath, PathBuf},
    process::Command,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader},
    net::TcpListener,
    sync::Mutex,
};
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    services::ServeDir,
};

pub const DEFAULT_BIND: &str = "127.0.0.1:51200";
pub const DEFAULT_IPC_FILE_NAME: &str = "devd.sock";
pub const DEFAULT_WINDOWS_PIPE_NAME: &str = r"\\.\pipe\isolapurr-devd";
const STORAGE_FILE_NAME: &str = "devices.json";
const STORAGE_SETTINGS_FILE_NAME: &str = "settings.json";
const STORAGE_SCHEMA_VERSION: u8 = 1;
const DEFAULT_FLASH_ADDRESS: u64 = 0x10000;
const LEASE_TTL_MS: u64 = 8_000;
const LEASE_HEARTBEAT_INTERVAL_MS: u64 = 2_000;
const SERIAL_BAUD: u32 = 115_200;
const SERIAL_TIMEOUT_MS: u64 = 1_500;
const SERIAL_POWER_CONFIG_EARLY_VERIFY_TIMEOUT_MS: u64 = 1_500;
const SERIAL_SETTINGS_RESET_TIMEOUT_MS: u64 = 5_000;
const MAX_SESSION_ITEMS: usize = 500;
pub const DEFAULT_IPC_IDLE_TIMEOUT_SECS: u64 = 30;
const PROJECT_FIRMWARE_NAME: &str = "isolapurr-usb-hub";
const MIN_COMPATIBLE_FIRMWARE_VERSION: &str = "0.1.0";

pub fn release_version() -> &'static str {
    option_env!("ISOLAPURR_RELEASE_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}

#[derive(Debug, Clone)]
pub struct DevdConfig {
    pub bind: SocketAddr,
    pub web_root: Option<PathBuf>,
    pub allow_dev_cors: bool,
}

impl DevdConfig {
    pub fn new(bind: SocketAddr, web_root: Option<PathBuf>, allow_dev_cors: bool) -> Self {
        Self {
            bind,
            web_root,
            allow_dev_cors,
        }
    }
}

#[derive(Debug, Clone)]
pub struct IpcConfig {
    pub endpoint: String,
    pub idle_timeout: Option<Duration>,
}

impl IpcConfig {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            idle_timeout: Some(Duration::from_secs(DEFAULT_IPC_IDLE_TIMEOUT_SECS)),
        }
    }

    pub fn with_idle_timeout(mut self, idle_timeout: Option<Duration>) -> Self {
        self.idle_timeout = idle_timeout;
        self
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IpcRequest {
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IpcResponse {
    pub id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn default_ipc_endpoint() -> String {
    #[cfg(windows)]
    {
        DEFAULT_WINDOWS_PIPE_NAME.to_string()
    }
    #[cfg(not(windows))]
    {
        let base = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join(format!("isolapurr-{}", user_id_hint())));
        base.join("isolapurr")
            .join(DEFAULT_IPC_FILE_NAME)
            .to_string_lossy()
            .to_string()
    }
}

#[cfg(not(windows))]
fn user_id_hint() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string())
}

#[derive(Clone)]
struct AppState {
    token: String,
    base_url: String,
    inner: Arc<Mutex<DevdState>>,
}

impl AppState {
    fn new(base_url: impl Into<String>) -> Self {
        Self {
            token: generate_token(),
            base_url: base_url.into(),
            inner: Arc::new(Mutex::new(DevdState::default())),
        }
    }
}

#[derive(Clone)]
struct IpcRuntime {
    app: AppState,
    lifecycle: Arc<Mutex<IpcLifecycle>>,
}

impl IpcRuntime {
    fn new(app: AppState) -> Self {
        Self {
            app,
            lifecycle: Arc::new(Mutex::new(IpcLifecycle::default())),
        }
    }
}

struct IpcLifecycle {
    active_clients: usize,
    last_activity: Instant,
}

impl Default for IpcLifecycle {
    fn default() -> Self {
        Self {
            active_clients: 0,
            last_activity: Instant::now(),
        }
    }
}

#[derive(Default)]
struct DevdState {
    devices: HashMap<String, DeviceRecord>,
    leases: HashMap<String, LeaseRecord>,
    exclusive_ports: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRecord {
    pub id: String,
    pub display_name: String,
    pub connection: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usb: Option<UsbTarget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http: Option<HttpTarget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<Value>,
    #[serde(default)]
    pub session: DeviceSession,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbTarget {
    pub port_path: String,
    pub label: String,
    pub vendor_id: Option<u16>,
    pub product_id: Option<u16>,
    pub serial_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpTarget {
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DeviceSession {
    #[serde(default)]
    pub logs: VecDeque<SessionItem>,
    #[serde(default)]
    pub traces: VecDeque<SessionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionItem {
    pub id: String,
    pub timestamp_unix_ms: u128,
    pub level: String,
    pub message: String,
    pub payload: Value,
}

#[derive(Debug, Clone)]
struct LeaseRecord {
    lease_id: String,
    device_id: String,
    port_path: Option<String>,
    expires_at: Instant,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapResponse {
    token: String,
    agent_base_url: String,
    app: BootstrapApp,
}

#[derive(Debug, Serialize)]
struct BootstrapApp {
    name: &'static str,
    version: &'static str,
    mode: &'static str,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct HardwareRegistry {
    pub schema_version: u8,
    #[serde(default)]
    pub devices: Vec<DeviceProfile>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StorageSettings {
    theme: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceProfile {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transports: Option<DeviceProfileTransports>,
    #[serde(
        default,
        rename = "transport",
        skip_serializing,
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) legacy_transport: Option<LegacyHardwareTransport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<DeviceIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum LegacyHardwareTransport {
    Usb {
        #[serde(alias = "deviceId")]
        device_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        devd_url: Option<String>,
    },
    Http {
        base_url: String,
    },
    WebSerial {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceProfileTransports {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_usb_port_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_serial_label: Option<String>,
}

impl DeviceProfile {
    pub fn http_base_url(&self) -> Option<&str> {
        self.transports
            .as_ref()
            .and_then(|transports| transports.http_base_url.as_deref())
    }

    pub fn local_usb_port_path(&self) -> Option<&str> {
        self.transports
            .as_ref()
            .and_then(|transports| transports.local_usb_port_path.as_deref())
    }

    pub fn web_serial_label(&self) -> Option<&str> {
        self.transports
            .as_ref()
            .and_then(|transports| transports.web_serial_label.as_deref())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mac: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SavedHardwareInput {
    pub device_id: String,
    pub name: String,
    pub transports: DeviceProfileTransports,
    pub identity: Option<DeviceIdentity>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FirmwareCatalog {
    #[serde(rename = "schemaVersion", alias = "schema_version")]
    pub schema_version: String,
    #[serde(default)]
    pub artifacts: Vec<FirmwareArtifact>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareArtifact {
    pub artifact_id: String,
    pub target: String,
    pub version: String,
    #[serde(default)]
    pub git_sha: Option<String>,
    #[serde(default)]
    pub build_id: Option<String>,
    #[serde(default)]
    pub files: Vec<FirmwareFile>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareFile {
    pub kind: String,
    pub path: String,
    pub sha256: String,
    pub size: u64,
    #[serde(default)]
    pub flash_address: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LeaseRequest {
    device_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct LeaseResponse {
    lease_id: String,
    device_id: String,
    heartbeat_interval_ms: u64,
    lease_ttl_ms: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceQuery {
    lease_id: Option<String>,
    tail: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct PowerOwnerQuery {
    owner: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WifiRequest {
    ssid: String,
    psk: String,
}

#[derive(Debug, Deserialize)]
struct HubRouteRequest {
    route: String,
}

#[derive(Debug, Deserialize)]
struct FlashRequest {
    catalog_path: PathBuf,
    artifact_id: String,
    #[serde(default)]
    real: bool,
    #[serde(default)]
    first_time: bool,
    #[serde(default)]
    confirm_non_project_firmware: bool,
    #[serde(default)]
    expected_identity: Option<DeviceIdentity>,
    lease_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FirmwareUploadFlashRequest {
    address: u64,
    file_name: String,
    file_base64: String,
    expected_identity: DeviceIdentity,
    lease_id: String,
}

#[derive(Debug, Deserialize)]
struct StorageImportRequest {
    #[serde(default)]
    devices: Vec<Value>,
    #[serde(default)]
    profiles: Vec<DeviceProfile>,
    #[serde(default)]
    settings: Option<StorageSettings>,
}

#[derive(Debug, Deserialize)]
struct StorageSettingsRequest {
    settings: StorageSettings,
}

#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    error: ErrorInfo,
}

#[derive(Debug, Serialize)]
struct ErrorInfo {
    code: &'static str,
    message: String,
    retryable: bool,
}

include!("lib/ipc.rs");
include!("lib/http_bridge.rs");

include!("lib/device_io.rs");

include!("lib/storage_catalog.rs");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_nested_sensitive_fields() {
        let value = json!({
            "ssid": "bench",
            "psk": "secret",
            "nested": {"token": "abc", "ok": true},
        });
        let redacted = redact_sensitive(&value);
        assert_eq!(redacted["psk"], "<redacted>");
        assert_eq!(redacted["nested"]["token"], "<redacted>");
        assert_eq!(redacted["nested"]["ok"], true);
    }

    #[test]
    fn prunes_stale_usb_devices_after_scan() {
        let mut inner = DevdState::default();
        reconcile_scanned_usb_devices(
            &mut inner,
            vec![UsbTarget {
                port_path: "/dev/cu.usbmodem101".to_string(),
                label: "ESP32-S3 USB JTAG".to_string(),
                vendor_id: Some(0x303a),
                product_id: Some(0x1001),
                serial_number: None,
            }],
        );
        assert!(inner.devices.contains_key("usb--dev-cu-usbmodem101"));

        reconcile_scanned_usb_devices(&mut inner, Vec::new());
        assert!(!inner.devices.contains_key("usb--dev-cu-usbmodem101"));
    }

    #[test]
    fn scan_keeps_http_profile_when_usb_channel_disappears() {
        let mut inner = DevdState::default();
        inner.devices.insert(
            "combo".to_string(),
            DeviceRecord {
                id: "combo".to_string(),
                display_name: "Bench Hub".to_string(),
                connection: "available".to_string(),
                usb: Some(UsbTarget {
                    port_path: "/dev/cu.usbmodem101".to_string(),
                    label: "ESP32-S3 USB JTAG".to_string(),
                    vendor_id: Some(0x303a),
                    product_id: Some(0x1001),
                    serial_number: None,
                }),
                http: Some(HttpTarget {
                    base_url: "http://isolapurr.local".to_string(),
                }),
                identity: None,
                session: DeviceSession::default(),
            },
        );

        reconcile_scanned_usb_devices(&mut inner, Vec::new());
        let device = inner.devices.get("combo").expect("profile remains");
        assert!(device.usb.is_none());
        assert_eq!(device.connection, "unavailable");
    }

    #[test]
    fn dedupes_macos_tty_cu_pairs_and_prefers_cu() {
        let targets = dedupe_usb_serial_device_pairs(vec![
            UsbTarget {
                port_path: "/dev/tty.usbmodem101".to_string(),
                label: "ESP32-S3 USB JTAG".to_string(),
                vendor_id: Some(0x303a),
                product_id: Some(0x1001),
                serial_number: None,
            },
            UsbTarget {
                port_path: "/dev/cu.usbmodem101".to_string(),
                label: "ESP32-S3 USB JTAG".to_string(),
                vendor_id: Some(0x303a),
                product_id: Some(0x1001),
                serial_number: None,
            },
        ]);

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].port_path, "/dev/cu.usbmodem101");
    }

    #[test]
    fn upsert_profile_preserves_existing_identity_when_incoming_omits_it() {
        let mut registry = HardwareRegistry {
            schema_version: STORAGE_SCHEMA_VERSION,
            devices: vec![DeviceProfile {
                id: "aabbcc001122".to_string(),
                name: "Bench".to_string(),
                transports: Some(DeviceProfileTransports {
                    http_base_url: None,
                    local_usb_port_path: Some("/dev/cu.usbmodem101".to_string()),
                    web_serial_label: None,
                }),
                legacy_transport: None,
                identity: Some(DeviceIdentity {
                    device_id: Some("aabbcc001122".to_string()),
                    mac: Some("AA:BB:CC:DD:EE:FF".to_string()),
                }),
                last_seen_at: Some(1),
            }],
        };

        upsert_profile(
            &mut registry,
            DeviceProfile {
                id: "aabbcc001122".to_string(),
                name: "Bench renamed".to_string(),
                transports: Some(DeviceProfileTransports {
                    http_base_url: None,
                    local_usb_port_path: Some("/dev/cu.usbmodem101".to_string()),
                    web_serial_label: None,
                }),
                legacy_transport: None,
                identity: None,
                last_seen_at: Some(2),
            },
        );

        assert_eq!(registry.devices[0].name, "Bench renamed");
        assert_eq!(
            registry.devices[0]
                .identity
                .as_ref()
                .and_then(|identity| identity.device_id.as_deref()),
            Some("aabbcc001122")
        );
    }

    #[test]
    fn web_storage_exports_canonical_transports() {
        let registry = HardwareRegistry {
            schema_version: STORAGE_SCHEMA_VERSION,
            devices: vec![DeviceProfile {
                id: "f293cc9c139e".to_string(),
                name: "Bench Hub".to_string(),
                transports: Some(DeviceProfileTransports {
                    http_base_url: Some("http://isolapurr-usb-hub-f293cc9c139e.local".to_string()),
                    local_usb_port_path: Some("/dev/cu.usbmodem21221401".to_string()),
                    web_serial_label: None,
                }),
                legacy_transport: None,
                identity: Some(DeviceIdentity {
                    device_id: Some("f293cc9c139e".to_string()),
                    mac: Some("1c:db:d4:85:6a:14".to_string()),
                }),
                last_seen_at: Some(11),
            }],
        };

        let devices = web_storage_devices(&registry);

        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0]["id"], "f293cc9c139e");
        assert_eq!(devices[0]["name"], "Bench Hub");
        assert_eq!(
            devices[0]["baseUrl"],
            "http://isolapurr-usb-hub-f293cc9c139e.local"
        );
        assert_eq!(
            devices[0]["transports"]["httpBaseUrl"],
            "http://isolapurr-usb-hub-f293cc9c139e.local"
        );
        assert_eq!(
            devices[0]["transports"]["localUsbPortPath"],
            "/dev/cu.usbmodem21221401"
        );
    }

    #[test]
    fn legacy_transport_profiles_migrate_to_transports_shape() {
        let mut registry: HardwareRegistry = serde_json::from_value(json!({
            "schema_version": 1,
            "devices": [
                {
                    "id": "aabbcc001122",
                    "name": "Legacy USB",
                    "transport": {
                        "kind": "usb",
                        "device_id": "usb--dev-cu-usbmodem101"
                    },
                    "identity": {
                        "deviceId": "aabbcc001122"
                    }
                }
            ]
        }))
        .expect("legacy registry should deserialize");

        let changed = sanitize_registry(&mut registry);

        assert!(changed);
        assert_eq!(registry.devices.len(), 1);
        let migrated = &registry.devices[0];
        assert_eq!(migrated.id, "aabbcc001122");
        assert_eq!(
            migrated
                .transports
                .as_ref()
                .and_then(|transports| transports.local_usb_port_path.as_deref()),
            Some("/dev/cu.usbmodem101")
        );
    }

    #[test]
    fn legacy_profiles_rekey_from_identity_or_canonical_hostname() {
        let mut registry: HardwareRegistry = serde_json::from_value(json!({
            "schema_version": 1,
            "devices": [
                {
                    "id": "bench-hub",
                    "name": "Legacy Identity",
                    "transport": {
                        "kind": "usb",
                        "device_id": "usb--dev-cu-usbmodem101"
                    },
                    "identity": {
                        "deviceId": "aabbcc001122"
                    }
                },
                {
                    "id": "bench-lan",
                    "name": "Legacy LAN",
                    "transport": {
                        "kind": "http",
                        "base_url": "http://isolapurr-usb-hub-ddeeffaabbcc.local"
                    }
                }
            ]
        }))
        .expect("legacy registry should deserialize");

        let changed = sanitize_registry(&mut registry);

        assert!(changed);
        assert_eq!(registry.devices.len(), 2);
        assert!(
            registry
                .devices
                .iter()
                .any(|device| device.id == "aabbcc001122")
        );
        assert!(
            registry
                .devices
                .iter()
                .any(|device| device.id == "ddeeffaabbcc")
        );
    }

    #[test]
    fn validates_catalog_shape() {
        let catalog = FirmwareCatalog {
            schema_version: "1".to_string(),
            artifacts: vec![FirmwareArtifact {
                artifact_id: "app".to_string(),
                target: "esp32s3_app".to_string(),
                version: "v1".to_string(),
                git_sha: None,
                build_id: None,
                files: vec![FirmwareFile {
                    kind: "app_bin".to_string(),
                    path: "app.bin".to_string(),
                    sha256: "a".repeat(64),
                    size: 1,
                    flash_address: Some(DEFAULT_FLASH_ADDRESS),
                }],
            }],
        };
        assert!(validate_catalog_shape(&catalog).is_empty());
    }

    #[test]
    fn rejects_wrong_app_address() {
        let catalog = FirmwareCatalog {
            schema_version: "1".to_string(),
            artifacts: vec![FirmwareArtifact {
                artifact_id: "app".to_string(),
                target: "esp32s3_app".to_string(),
                version: "v1".to_string(),
                git_sha: None,
                build_id: None,
                files: vec![FirmwareFile {
                    kind: "app_bin".to_string(),
                    path: "app.bin".to_string(),
                    sha256: "a".repeat(64),
                    size: 1,
                    flash_address: Some(0),
                }],
            }],
        };
        assert!(!validate_catalog_shape(&catalog).is_empty());
    }

    #[test]
    fn rejects_wrong_full_image_address() {
        let catalog = FirmwareCatalog {
            schema_version: "1".to_string(),
            artifacts: vec![FirmwareArtifact {
                artifact_id: "full".to_string(),
                target: "esp32s3_full".to_string(),
                version: "v1".to_string(),
                git_sha: None,
                build_id: None,
                files: vec![FirmwareFile {
                    kind: "full_image".to_string(),
                    path: "full.bin".to_string(),
                    sha256: "a".repeat(64),
                    size: 1,
                    flash_address: Some(DEFAULT_FLASH_ADDRESS),
                }],
            }],
        };
        assert!(!validate_catalog_shape(&catalog).is_empty());
    }

    #[test]
    fn validates_expected_device_identity() {
        let info = json!({
            "ok": true,
            "result": {
                "device": {
                    "device_id": "aabbcc001122",
                    "mac": "AA:BB:CC:DD:EE:FF"
                }
            }
        });
        validate_device_identity(
            &info,
            &DeviceIdentity {
                device_id: Some("aabbcc001122".to_string()),
                mac: Some("aa:bb:cc:dd:ee:ff".to_string()),
            },
        )
        .expect("identity should match");
    }

    #[test]
    fn validates_project_firmware_name_and_version() {
        let info = json!({
            "ok": true,
            "result": {
                "device": {
                    "firmware": {
                        "name": "isolapurr-usb-hub",
                        "version": "0.1.0"
                    }
                }
            }
        });
        validate_project_firmware(&info).expect("project firmware should pass");
    }

    #[test]
    fn rejects_non_project_or_incompatible_firmware() {
        let wrong_name = json!({
            "result": {
                "device": {
                    "firmware": {
                        "name": "other",
                        "version": "0.1.0"
                    }
                }
            }
        });
        assert!(validate_project_firmware(&wrong_name).is_err());

        let old_version = json!({
            "result": {
                "device": {
                    "firmware": {
                        "name": "isolapurr-usb-hub",
                        "version": "0.0.1"
                    }
                }
            }
        });
        assert!(validate_project_firmware(&old_version).is_err());

        let firmware = project_firmware_metadata(&old_version).expect("firmware metadata");
        validate_project_firmware_name(firmware)
            .expect("upgrade path accepts old project firmware");
    }

    #[test]
    fn rejects_mismatched_device_identity() {
        let info = json!({"result": {"device": {"device_id": "aabbcc001122"}}});
        assert!(
            validate_device_identity(
                &info,
                &DeviceIdentity {
                    device_id: Some("ddeeffaabbcc".to_string()),
                    mac: None,
                },
            )
            .is_err()
        );
    }

    #[test]
    fn matches_wifi_set_verification_shape() {
        let value = json!({
            "ok": true,
            "result": {
                "configured": true,
                "ssid": "Ivan",
                "state": "connected"
            }
        });
        assert!(wifi_matches_expected_ssid(&value, "Ivan"));
        assert!(!wifi_matches_expected_ssid(&value, "Other"));
    }

    #[test]
    fn import_accepts_exported_profiles_shape() {
        let req = StorageImportRequest {
            devices: vec![json!({
                "id": "f293cc9c139e",
                "name": "Web device",
                "baseUrl": "http://192.168.1.42",
                "transports": {
                    "localUsbPortPath": "/dev/cu.usbmodem101"
                }
            })],
            profiles: vec![DeviceProfile {
                id: "f293cc9c139e".to_string(),
                name: "CLI device".to_string(),
                transports: Some(DeviceProfileTransports {
                    http_base_url: None,
                    local_usb_port_path: Some("/dev/cu.usbmodem101".to_string()),
                    web_serial_label: None,
                }),
                legacy_transport: None,
                identity: None,
                last_seen_at: Some(1),
            }],
            settings: Some(StorageSettings {
                theme: "isolapurr-dark".to_string(),
            }),
        };
        let profiles =
            parse_import_profiles(&req).expect("profiles should be preferred when exported");

        assert_eq!(
            req.settings
                .as_ref()
                .map(|settings| settings.theme.as_str()),
            Some("isolapurr-dark")
        );
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, "f293cc9c139e");

        let devices = parse_import_profiles(&StorageImportRequest {
            devices: vec![json!({
                "id": "f293cc9c139e",
                "name": "Web device",
                "baseUrl": "http://192.168.1.42",
                "transports": {
                    "localUsbPortPath": "/dev/cu.usbmodem101"
                }
            })],
            profiles: vec![],
            settings: None,
        })
        .expect("web devices should import");

        assert_eq!(devices[0].id, "f293cc9c139e");
        assert_eq!(
            devices[0]
                .transports
                .as_ref()
                .and_then(|transports| transports.local_usb_port_path.as_deref()),
            Some("/dev/cu.usbmodem101")
        );
        assert_eq!(devices[0].http_base_url(), Some("http://192.168.1.42"));
    }

    #[test]
    fn api_url_accepts_bare_host_and_joins_paths() {
        let url = api_url("192.168.31.224", "/api/v1/pd-diagnostics").expect("url should parse");
        assert_eq!(url.as_str(), "http://192.168.31.224/api/v1/pd-diagnostics");
    }

    #[test]
    fn import_canonicalizes_bare_http_host_urls() {
        let devices = parse_import_profiles(&StorageImportRequest {
            devices: vec![json!({
                "id": "f293cc9c139e",
                "name": "Bare host",
                "baseUrl": "192.168.31.224"
            })],
            profiles: vec![],
            settings: None,
        })
        .expect("bare host import should normalize");

        assert_eq!(devices[0].http_base_url(), Some("http://192.168.31.224"));
    }

    #[test]
    fn import_blank_http_base_url_falls_back_to_default_local_target() {
        let devices = parse_import_profiles(&StorageImportRequest {
            devices: vec![json!({
                "id": "f293cc9c139e",
                "name": "Blank host",
                "baseUrl": "   "
            })],
            profiles: vec![],
            settings: None,
        })
        .expect("blank host import should still normalize");

        assert_eq!(
            devices[0].http_base_url(),
            Some("http://isolapurr-usb-hub-f293cc9c139e.local")
        );
    }

    #[test]
    fn import_migrates_legacy_profile_transports() {
        let req: StorageImportRequest = serde_json::from_value(json!({
            "profiles": [
                {
                    "id": "aabbcc001122",
                    "name": "Legacy USB",
                    "transport": {
                        "kind": "usb",
                        "device_id": "usb--dev-cu-usbmodem101"
                    }
                }
            ]
        }))
        .expect("legacy import request should deserialize");

        let profiles = parse_import_profiles(&req).expect("legacy profiles should import");

        assert_eq!(profiles.len(), 1);
        assert_eq!(
            profiles[0]
                .transports
                .as_ref()
                .and_then(|transports| transports.local_usb_port_path.as_deref()),
            Some("/dev/cu.usbmodem101")
        );
        assert!(profiles[0].legacy_transport.is_none());
    }

    #[test]
    fn import_migrates_legacy_localstorage_pseudo_urls() {
        let devices = parse_import_profiles(&StorageImportRequest {
            devices: vec![
                json!({
                    "id": "aabbcc001122",
                    "name": "Legacy Local USB",
                    "baseUrl": "isolapurr-devd://usb--dev-cu-usbmodem21221401"
                }),
                json!({
                    "id": "bbccdd001122",
                    "name": "Legacy Web Serial",
                    "baseUrl": "webserial://ESP32-S3 USB JTAG"
                }),
            ],
            profiles: vec![],
            settings: None,
        })
        .expect("legacy web devices should import");

        assert_eq!(
            devices[0]
                .transports
                .as_ref()
                .and_then(|transports| transports.local_usb_port_path.as_deref()),
            Some("/dev/cu.usbmodem21221401")
        );
        assert_eq!(
            devices[1]
                .transports
                .as_ref()
                .and_then(|transports| transports.web_serial_label.as_deref()),
            Some("ESP32-S3 USB JTAG")
        );
        assert!(
            devices
                .iter()
                .all(|device| device.http_base_url().is_none())
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn ipc_serves_jsonl_requests_over_unix_socket() {
        let temp = tempfile::tempdir().expect("temp dir");
        let endpoint = temp.path().join("devd.sock");
        let endpoint_string = endpoint.to_string_lossy().to_string();
        let task = tokio::spawn({
            let endpoint = endpoint_string.clone();
            async move { serve_ipc(IpcConfig::new(endpoint)).await }
        });

        let deadline = Instant::now() + Duration::from_secs(2);
        let mut last_error = None;
        let result = loop {
            match ipc_call(&endpoint_string, "devd.health", json!({})).await {
                Ok(value) => break value,
                Err(err) if Instant::now() < deadline => {
                    last_error = Some(err);
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                Err(err) => panic!(
                    "IPC health failed: {err}; last={}",
                    last_error
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "none".to_string())
                ),
            }
        };
        task.abort();
        assert_eq!(result["ok"], true);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn ipc_daemon_exits_after_idle_timeout() {
        let temp = tempfile::tempdir().expect("temp dir");
        let endpoint = temp.path().join("devd.sock");
        let endpoint_string = endpoint.to_string_lossy().to_string();
        let task = tokio::spawn({
            let endpoint = endpoint_string.clone();
            async move {
                serve_ipc(
                    IpcConfig::new(endpoint).with_idle_timeout(Some(Duration::from_millis(100))),
                )
                .await
            }
        });

        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if endpoint.exists() {
                break;
            }
            if Instant::now() >= deadline {
                panic!("IPC socket was not created");
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }

        let result = ipc_call(&endpoint_string, "devd.health", json!({}))
            .await
            .expect("health should pass");
        assert_eq!(result["ok"], true);

        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("daemon should stop after idle timeout")
            .expect("join should pass")
            .expect("serve should exit cleanly");
        assert!(!endpoint.exists());
    }
}
