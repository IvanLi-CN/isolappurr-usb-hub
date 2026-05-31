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
const MAX_SESSION_ITEMS: usize = 500;

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
}

impl IpcConfig {
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
        }
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
    pub transport: HardwareTransport,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<DeviceIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum HardwareTransport {
    Usb {
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
pub struct DeviceIdentity {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mac: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SavedHardwareInput {
    pub id: String,
    pub name: String,
    pub transport: HardwareTransport,
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

pub async fn serve_ipc(config: IpcConfig) -> anyhow::Result<()> {
    let state = AppState::new("ipc://isolapurr-devd");
    serve_ipc_with_state(config, state).await
}

async fn serve_ipc_with_state(config: IpcConfig, state: AppState) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        serve_ipc_unix(config, state).await
    }
    #[cfg(windows)]
    {
        serve_ipc_windows(config, state).await
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (config, state);
        Err(anyhow!(
            "isolapurr-devd IPC is unsupported on this platform"
        ))
    }
}

#[cfg(unix)]
async fn serve_ipc_unix(config: IpcConfig, state: AppState) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt as _;
    use tokio::net::UnixListener;

    let path = PathBuf::from(&config.endpoint);
    if let Some(parent) = path.parent() {
        let created_parent = !parent.exists();
        fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
        if created_parent {
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .with_context(|| format!("chmod {}", parent.display()))?;
        }
    }
    if path.exists() {
        fs::remove_file(&path).with_context(|| format!("remove stale {}", path.display()))?;
    }
    let listener =
        UnixListener::bind(&path).with_context(|| format!("bind IPC {}", path.display()))?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .with_context(|| format!("chmod {}", path.display()))?;
    tracing::info!("isolapurr-devd IPC listening on {}", path.display());
    loop {
        let (stream, _) = listener.accept().await?;
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(err) = handle_ipc_stream(stream, state).await {
                tracing::warn!("IPC client failed: {err:#}");
            }
        });
    }
}

#[cfg(windows)]
async fn serve_ipc_windows(config: IpcConfig, state: AppState) -> anyhow::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    tracing::info!("isolapurr-devd IPC listening on {}", config.endpoint);
    loop {
        let server = ServerOptions::new()
            .first_pipe_instance(false)
            .create(&config.endpoint)
            .with_context(|| format!("create IPC pipe {}", config.endpoint))?;
        server.connect().await.context("connect IPC pipe client")?;
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(err) = handle_ipc_stream(server, state).await {
                tracing::warn!("IPC client failed: {err:#}");
            }
        });
    }
}

async fn handle_ipc_stream<S>(stream: S, state: AppState) -> anyhow::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (read, mut write) = tokio::io::split(stream);
    let mut lines = BufReader::new(read).lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<IpcRequest>(&line) {
            Ok(request) => handle_ipc_request(&state, request).await,
            Err(err) => IpcResponse {
                id: "invalid".to_string(),
                ok: false,
                result: None,
                error: Some(format!("invalid IPC request: {err}")),
            },
        };
        let mut encoded = serde_json::to_vec(&response)?;
        encoded.push(b'\n');
        write.write_all(&encoded).await?;
        write.flush().await?;
    }
    Ok(())
}

async fn handle_ipc_request(state: &AppState, request: IpcRequest) -> IpcResponse {
    let id = request.id;
    let result = dispatch_ipc_request(state, &request.method, request.params).await;
    match result {
        Ok(result) => IpcResponse {
            id,
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(err) => IpcResponse {
            id,
            ok: false,
            result: None,
            error: Some(err.to_string()),
        },
    }
}

async fn dispatch_ipc_request(
    state: &AppState,
    method: &str,
    params: Value,
) -> anyhow::Result<Value> {
    match method {
        "devd.health" => Ok(json!({"ok": true})),
        "devices.list" => ipc_list_devices(state).await,
        "devices.scan" => ipc_scan_devices(state).await,
        "device.status" => {
            let req: DeviceIdRequest = serde_json::from_value(params)?;
            Ok(redact_sensitive(
                &usb_jsonl_request(state, &req.device_id, "info", None).await?,
            ))
        }
        "device.session" => {
            let req: DeviceSessionRequest = serde_json::from_value(params)?;
            ipc_device_session(state, &req.device_id, req.tail, req.lease_id).await
        }
        "device.wifi.get" => {
            let req: DeviceIdRequest = serde_json::from_value(params)?;
            Ok(redact_sensitive(
                &usb_jsonl_request(state, &req.device_id, "wifi.get", None).await?,
            ))
        }
        "device.wifi.set" => {
            let req: DeviceWifiSetRequest = serde_json::from_value(params)?;
            Ok(redact_sensitive(
                &usb_jsonl_request(
                    state,
                    &req.device_id,
                    "wifi.set",
                    Some(json!({"ssid": req.ssid, "psk": req.psk})),
                )
                .await?,
            ))
        }
        "device.wifi.clear" => {
            let req: DeviceIdRequest = serde_json::from_value(params)?;
            Ok(redact_sensitive(
                &usb_jsonl_request(state, &req.device_id, "wifi.clear", None).await?,
            ))
        }
        "device.ports.get" => {
            let req: DeviceIdRequest = serde_json::from_value(params)?;
            Ok(redact_sensitive(
                &usb_jsonl_request(state, &req.device_id, "ports.get", None).await?,
            ))
        }
        "device.port.power" => {
            let req: DevicePortPowerRequest = serde_json::from_value(params)?;
            Ok(redact_sensitive(
                &usb_jsonl_request(
                    state,
                    &req.device_id,
                    "port.power_set",
                    Some(json!({"port": req.port, "enabled": req.enabled})),
                )
                .await?,
            ))
        }
        "device.port.replug" => {
            let req: DevicePortRequest = serde_json::from_value(params)?;
            Ok(redact_sensitive(
                &usb_jsonl_request(
                    state,
                    &req.device_id,
                    "port.replug",
                    Some(json!({"port": req.port})),
                )
                .await?,
            ))
        }
        "device.hub.route_set" => {
            let req: DeviceHubRouteRequest = serde_json::from_value(params)?;
            match usb_jsonl_request(
                state,
                &req.device_id,
                "hub.route_set",
                Some(json!({"route": req.route})),
            )
            .await
            {
                Ok(value) => Ok(redact_sensitive(&value)),
                Err(err) => {
                    match verify_hub_route_after_disconnect(state, &req.device_id, &req.route).await
                    {
                        Ok(value) => Ok(redact_sensitive(&value)),
                        Err(_) => Err(err),
                    }
                }
            }
        }
        "serial.lease.create" => {
            let req: LeaseRequest = serde_json::from_value(params)?;
            ipc_create_lease(state, req).await
        }
        "serial.lease.release" => {
            let req: LeaseIdRequest = serde_json::from_value(params)?;
            ipc_release_lease(state, &req.lease_id).await
        }
        "device.flash" => {
            let req: DeviceFlashRequest = serde_json::from_value(params)?;
            require_lease_value(state, &req.device_id, req.flash.lease_id.as_deref()).await?;
            Ok(redact_sensitive(
                &run_flash_request(state, &req.device_id, req.flash).await?,
            ))
        }
        "device.reset" => {
            let req: DeviceResetRequest = serde_json::from_value(params)?;
            ipc_device_reset(state, &req.device_id, req.lease_id.as_deref()).await
        }
        "device.diagnostics" => {
            let req: DeviceIdRequest = serde_json::from_value(params)?;
            Ok(redact_sensitive(
                &usb_jsonl_request(state, &req.device_id, "pd.diagnostics", None).await?,
            ))
        }
        "firmware.catalog.validate" => {
            let catalog: FirmwareCatalog = serde_json::from_value(params)?;
            let errors = validate_catalog_shape(&catalog);
            Ok(json!({"ok": errors.is_empty(), "errors": errors}))
        }
        _ => Err(anyhow!("unknown IPC method: {method}")),
    }
}

#[derive(Debug, Deserialize)]
struct DeviceIdRequest {
    device_id: String,
}

#[derive(Debug, Deserialize)]
struct DeviceSessionRequest {
    device_id: String,
    lease_id: Option<String>,
    tail: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct DeviceWifiSetRequest {
    device_id: String,
    ssid: String,
    psk: String,
}

#[derive(Debug, Deserialize)]
struct DevicePortRequest {
    device_id: String,
    port: String,
}

#[derive(Debug, Deserialize)]
struct DevicePortPowerRequest {
    device_id: String,
    port: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
struct DeviceHubRouteRequest {
    device_id: String,
    route: String,
}

#[derive(Debug, Deserialize)]
struct LeaseIdRequest {
    lease_id: String,
}

#[derive(Debug, Deserialize)]
struct DeviceFlashRequest {
    device_id: String,
    #[serde(flatten)]
    flash: FlashRequest,
}

#[derive(Debug, Deserialize)]
struct DeviceResetRequest {
    device_id: String,
    lease_id: Option<String>,
}

async fn ipc_list_devices(state: &AppState) -> anyhow::Result<Value> {
    cleanup_expired_leases(state).await;
    let devices = state
        .inner
        .lock()
        .await
        .devices
        .values()
        .cloned()
        .collect::<Vec<_>>();
    Ok(json!({"devices": devices}))
}

async fn ipc_scan_devices(state: &AppState) -> anyhow::Result<Value> {
    let ports = list_serial_ports().context("serial enumeration failed")?;
    let mut inner = state.inner.lock().await;
    reconcile_scanned_usb_devices(&mut inner, ports);
    let devices = inner.devices.values().cloned().collect::<Vec<_>>();
    Ok(json!({"devices": devices}))
}

async fn ipc_device_session(
    state: &AppState,
    device_id: &str,
    tail: Option<usize>,
    lease_id: Option<String>,
) -> anyhow::Result<Value> {
    let tail = tail.unwrap_or(200).min(MAX_SESSION_ITEMS);
    let inner = state.inner.lock().await;
    let device = inner
        .devices
        .get(device_id)
        .ok_or_else(|| anyhow!("device not found"))?;
    if let Some(lease_id) = lease_id.as_deref()
        && !inner.leases.contains_key(lease_id)
    {
        return Err(anyhow!("lease not found or expired"));
    }
    Ok(json!({
        "logs": tail_items(&device.session.logs, tail),
        "traces": tail_items(&device.session.traces, tail),
    }))
}

async fn ipc_create_lease(state: &AppState, req: LeaseRequest) -> anyhow::Result<Value> {
    cleanup_expired_leases(state).await;
    let port_path = {
        let inner = state.inner.lock().await;
        let device = inner
            .devices
            .get(&req.device_id)
            .ok_or_else(|| anyhow!("device not found"))?;
        device.usb.as_ref().map(|usb| usb.port_path.clone())
    };

    let lease_id = next_id();
    let lease = LeaseRecord {
        lease_id: lease_id.clone(),
        device_id: req.device_id.clone(),
        port_path,
        expires_at: Instant::now() + Duration::from_millis(LEASE_TTL_MS),
    };
    state
        .inner
        .lock()
        .await
        .leases
        .insert(lease_id.clone(), lease);
    Ok(json!(LeaseResponse {
        lease_id,
        device_id: req.device_id,
        heartbeat_interval_ms: LEASE_HEARTBEAT_INTERVAL_MS,
        lease_ttl_ms: LEASE_TTL_MS,
    }))
}

async fn ipc_release_lease(state: &AppState, lease_id: &str) -> anyhow::Result<Value> {
    let removed = state.inner.lock().await.leases.remove(lease_id).is_some();
    Ok(json!({"ok": true, "released": removed}))
}

async fn require_lease_value(
    state: &AppState,
    device_id: &str,
    lease_id: Option<&str>,
) -> anyhow::Result<()> {
    cleanup_expired_leases(state).await;
    let lease_id = lease_id.ok_or_else(|| anyhow!("lease_id is required"))?;
    let inner = state.inner.lock().await;
    let lease = inner
        .leases
        .get(lease_id)
        .ok_or_else(|| anyhow!("lease not found or expired"))?;
    if lease.device_id != device_id {
        return Err(anyhow!("lease does not belong to device"));
    }
    Ok(())
}

async fn ipc_device_reset(
    state: &AppState,
    device_id: &str,
    lease_id: Option<&str>,
) -> anyhow::Result<Value> {
    require_lease_value(state, device_id, lease_id).await?;
    let port_path = device_usb_port_path(state, device_id).await?;
    {
        let mut inner = state.inner.lock().await;
        if inner.exclusive_ports.contains_key(&port_path) {
            return Err(anyhow!("device busy"));
        }
        inner
            .exclusive_ports
            .insert(port_path.clone(), "reset".to_string());
    }
    let guard = ExclusiveGuard {
        state: state.clone(),
        port_path,
    };
    let result =
        usb_jsonl_request_with_exclusive(state, device_id, "reboot", None, Some("reset")).await;
    drop(guard);
    Ok(redact_sensitive(&result?))
}

pub async fn ipc_call(endpoint: &str, method: &str, params: Value) -> anyhow::Result<Value> {
    let request = IpcRequest {
        id: next_id(),
        method: method.to_string(),
        params,
    };
    #[cfg(unix)]
    {
        let stream = tokio::net::UnixStream::connect(endpoint)
            .await
            .with_context(|| format!("connect IPC socket {endpoint}"))?;
        send_ipc_request(stream, request).await
    }
    #[cfg(windows)]
    {
        let stream = tokio::net::windows::named_pipe::ClientOptions::new()
            .open(endpoint)
            .with_context(|| format!("connect IPC pipe {endpoint}"))?;
        send_ipc_request(stream, request).await
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (endpoint, request);
        Err(anyhow!("isolapurr IPC is unsupported on this platform"))
    }
}

async fn send_ipc_request<S>(mut stream: S, request: IpcRequest) -> anyhow::Result<Value>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut encoded = serde_json::to_vec(&request)?;
    encoded.push(b'\n');
    stream.write_all(&encoded).await?;
    stream.flush().await?;
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).await?;
    let response: IpcResponse = serde_json::from_str(line.trim()).context("decode IPC response")?;
    if response.ok {
        Ok(response.result.unwrap_or_else(|| json!({})))
    } else {
        Err(anyhow!(
            "{}",
            response
                .error
                .unwrap_or_else(|| "IPC request failed".to_string())
        ))
    }
}

pub async fn serve_http_bridge(config: DevdConfig) -> anyhow::Result<()> {
    if !config.bind.ip().is_loopback() {
        return Err(anyhow!(
            "isolapurr-devd refuses non-loopback binds because /api/v1/bootstrap returns a local bearer token"
        ));
    }
    let listener = TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("bind {}", config.bind))?;
    let port = listener.local_addr()?.port();
    let state = AppState::new(format!("http://127.0.0.1:{port}"));

    let router = router(state, config.web_root, config.allow_dev_cors);
    tracing::info!("isolapurr-devd HTTP bridge listening on http://127.0.0.1:{port}");
    axum::serve(listener, router).await?;
    Ok(())
}

fn router(state: AppState, web_root: Option<PathBuf>, allow_dev_cors: bool) -> Router {
    let mut router = Router::new()
        .route("/api/v1/bootstrap", get(bootstrap))
        .route("/api/v1/health", get(health))
        .route("/api/v1/devices", get(list_devices))
        .route("/api/v1/devices/scan", post(scan_devices))
        .route("/api/v1/devices/{id}/status", get(device_status))
        .route("/api/v1/devices/{id}/session", get(device_session))
        .route(
            "/api/v1/devices/{id}/wifi",
            get(wifi_get).post(wifi_set).delete(wifi_clear),
        )
        .route("/api/v1/devices/{id}/ports", get(device_ports))
        .route(
            "/api/v1/devices/{id}/ports/{port_id}/power",
            post(port_power),
        )
        .route(
            "/api/v1/devices/{id}/ports/{port_id}/replug",
            post(port_replug),
        )
        .route("/api/v1/devices/{id}/hub/route", post(hub_route_set))
        .route("/api/v1/devices/{id}/flash", post(device_flash))
        .route(
            "/api/v1/devices/{id}/flash-upload",
            post(device_flash_upload),
        )
        .route("/api/v1/devices/{id}/reset", post(device_reset))
        .route("/api/v1/devices/{id}/diagnostics", get(device_diagnostics))
        .route("/api/v1/serial/lease", post(create_lease))
        .route(
            "/api/v1/serial/lease/{lease_id}",
            post(heartbeat_lease).delete(release_lease),
        )
        .route(
            "/api/v1/storage/devices",
            get(storage_list).post(storage_save),
        )
        .route("/api/v1/storage/devices/{id}", delete(storage_delete))
        .route(
            "/api/v1/storage/settings",
            get(storage_settings_get).put(storage_settings_put),
        )
        .route(
            "/api/v1/storage/migrate/localstorage",
            post(storage_migrate_localstorage),
        )
        .route("/api/v1/storage/export", get(storage_export))
        .route("/api/v1/storage/reset", post(storage_reset))
        .route("/api/v1/storage/import", post(storage_import))
        .route("/api/v1/firmware/catalog/validate", post(validate_catalog))
        .with_state(state)
        .layer(DefaultBodyLimit::max(16 * 1024 * 1024));

    if let Some(web_root) = web_root {
        router = router.fallback_service(ServeDir::new(web_root));
    }
    if allow_dev_cors {
        router = router.layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::predicate(|origin, _| {
                    is_loopback_origin(origin)
                }))
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]),
        );
    }
    router
}

async fn bootstrap(State(state): State<AppState>) -> Json<Value> {
    Json(json!(BootstrapResponse {
        token: state.token,
        agent_base_url: state.base_url,
        app: BootstrapApp {
            name: "isolapurr-devd",
            version: env!("CARGO_PKG_VERSION"),
            mode: "devd",
        },
    }))
}

async fn health(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    Json(json!({"ok": true})).into_response()
}

async fn list_devices(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    cleanup_expired_leases(&state).await;
    let devices = state
        .inner
        .lock()
        .await
        .devices
        .values()
        .cloned()
        .collect::<Vec<_>>();
    Json(json!({"devices": devices})).into_response()
}

async fn scan_devices(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let ports = match list_serial_ports() {
        Ok(ports) => ports,
        Err(err) => return internal_error(&format!("serial enumeration failed: {err}")),
    };
    let mut inner = state.inner.lock().await;
    reconcile_scanned_usb_devices(&mut inner, ports);
    let devices = inner.devices.values().cloned().collect::<Vec<_>>();
    Json(json!({"devices": devices})).into_response()
}

fn reconcile_scanned_usb_devices(inner: &mut DevdState, ports: Vec<UsbTarget>) {
    let mut scanned_ids = HashSet::new();
    for port in ports {
        let id = stable_usb_device_id(&port.port_path);
        scanned_ids.insert(id.clone());
        inner
            .devices
            .entry(id.clone())
            .and_modify(|device| {
                device.display_name = port.label.clone();
                device.connection = "available".to_string();
                device.usb = Some(port.clone());
            })
            .or_insert(DeviceRecord {
                id,
                display_name: port.label.clone(),
                connection: "available".to_string(),
                usb: Some(port),
                http: None,
                identity: None,
                session: DeviceSession::default(),
            });
    }
    inner.devices.retain(|id, device| {
        if device.usb.is_some() && !scanned_ids.contains(id) {
            device.usb = None;
            if device.http.is_some() {
                device.connection = "unavailable".to_string();
                true
            } else {
                false
            }
        } else {
            true
        }
    });
}

async fn device_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match usb_jsonl_request(&state, &id, "info", None).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<DeviceQuery>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let tail = query.tail.unwrap_or(200).min(MAX_SESSION_ITEMS);
    let inner = state.inner.lock().await;
    let Some(device) = inner.devices.get(&id) else {
        return not_found("device not found");
    };
    if let Some(lease_id) = query.lease_id.as_deref()
        && !inner.leases.contains_key(lease_id)
    {
        return unauthorized("lease not found or expired");
    }
    Json(json!({
        "logs": tail_items(&device.session.logs, tail),
        "traces": tail_items(&device.session.traces, tail),
    }))
    .into_response()
}

async fn wifi_get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match usb_jsonl_request(&state, &id, "wifi.get", None).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn wifi_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<WifiRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match usb_jsonl_request(
        &state,
        &id,
        "wifi.set",
        Some(json!({"ssid": req.ssid, "psk": req.psk})),
    )
    .await
    {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn wifi_clear(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match usb_jsonl_request(&state, &id, "wifi.clear", None).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_ports(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match usb_jsonl_request(&state, &id, "ports.get", None).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn port_power(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, port_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let enabled = matches!(query.get("enabled").map(String::as_str), Some("1" | "true"));
    match usb_jsonl_request(
        &state,
        &id,
        "port.power_set",
        Some(json!({"port": port_id, "enabled": enabled})),
    )
    .await
    {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn port_replug(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, port_id)): Path<(String, String)>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match usb_jsonl_request(&state, &id, "port.replug", Some(json!({"port": port_id}))).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn hub_route_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<HubRouteRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let route = req.route;
    match usb_jsonl_request(&state, &id, "hub.route_set", Some(json!({"route": route}))).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => match verify_hub_route_after_disconnect(&state, &id, &route).await {
            Ok(value) => Json(redact_sensitive(&value)).into_response(),
            Err(_) => error_from_anyhow(err),
        },
    }
}

async fn verify_hub_route_after_disconnect(
    state: &AppState,
    id: &str,
    route: &str,
) -> anyhow::Result<Value> {
    let mut last_error = None;
    for _ in 0..5 {
        tokio::time::sleep(Duration::from_millis(300)).await;
        match usb_jsonl_request(state, id, "ports.get", None).await {
            Ok(value) => {
                if let Some((actual_route, persisted)) = extract_hub_route(&value)
                    && actual_route == route
                {
                    return Ok(json!({
                        "ok": true,
                        "result": {
                            "accepted": true,
                            "usb_c_downstream_route": actual_route,
                            "persisted": persisted.unwrap_or(false),
                            "verified_after_serial_reconnect": true
                        }
                    }));
                }
            }
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("USB-C route did not verify after reconnect")))
}

fn extract_hub_route(value: &Value) -> Option<(String, Option<bool>)> {
    let hub = value
        .get("result")
        .and_then(|result| result.get("hub"))
        .or_else(|| value.get("hub"))?;
    let route = hub
        .get("usb_c_downstream_route")
        .and_then(Value::as_str)?
        .to_string();
    let persisted = hub
        .get("usb_c_downstream_persisted")
        .and_then(Value::as_bool);
    Some((route, persisted))
}

async fn device_flash(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<FlashRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(response) = require_lease(&state, &id, req.lease_id.as_deref()).await {
        return *response;
    }
    let result = run_flash_request(&state, &id, req).await;
    match result {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_flash_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<FirmwareUploadFlashRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(response) = require_lease(&state, &id, Some(&req.lease_id)).await {
        return *response;
    }
    let result = run_uploaded_flash_request(&state, &id, req).await;
    match result {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_reset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let lease_id = body.get("lease_id").and_then(Value::as_str);
    if let Err(response) = require_lease(&state, &id, lease_id).await {
        return *response;
    }
    let port_path = match device_usb_port_path(&state, &id).await {
        Ok(port_path) => port_path,
        Err(err) => return error_from_anyhow(err),
    };
    {
        let mut inner = state.inner.lock().await;
        if inner.exclusive_ports.contains_key(&port_path) {
            return conflict("device busy");
        }
        inner
            .exclusive_ports
            .insert(port_path.clone(), "reset".to_string());
    }
    let guard = ExclusiveGuard {
        state: state.clone(),
        port_path,
    };
    let result = usb_jsonl_request_with_exclusive(&state, &id, "reboot", None, Some("reset")).await;
    drop(guard);
    match result {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_diagnostics(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match usb_jsonl_request(&state, &id, "pd.diagnostics", None).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn create_lease(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LeaseRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    cleanup_expired_leases(&state).await;
    let port_path = {
        let inner = state.inner.lock().await;
        let Some(device) = inner.devices.get(&req.device_id) else {
            return not_found("device not found");
        };
        device.usb.as_ref().map(|usb| usb.port_path.clone())
    };

    let lease_id = next_id();
    let lease = LeaseRecord {
        lease_id: lease_id.clone(),
        device_id: req.device_id.clone(),
        port_path,
        expires_at: Instant::now() + Duration::from_millis(LEASE_TTL_MS),
    };
    state
        .inner
        .lock()
        .await
        .leases
        .insert(lease_id.clone(), lease);
    Json(json!(LeaseResponse {
        lease_id,
        device_id: req.device_id,
        heartbeat_interval_ms: LEASE_HEARTBEAT_INTERVAL_MS,
        lease_ttl_ms: LEASE_TTL_MS,
    }))
    .into_response()
}

async fn heartbeat_lease(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(lease_id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let mut inner = state.inner.lock().await;
    let Some(lease) = inner.leases.get_mut(&lease_id) else {
        return not_found("lease not found");
    };
    lease.expires_at = Instant::now() + Duration::from_millis(LEASE_TTL_MS);
    Json(json!({
        "lease_id": lease.lease_id,
        "device_id": lease.device_id,
        "port_path": lease.port_path,
        "lease_ttl_ms": LEASE_TTL_MS,
    }))
    .into_response()
}

async fn release_lease(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(lease_id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let removed = state.inner.lock().await.leases.remove(&lease_id).is_some();
    Json(json!({"ok": true, "released": removed})).into_response()
}

async fn storage_list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match read_hardware_registry() {
        Ok(registry) => Json(json!({
            "devices": registry.devices.iter().map(web_storage_device).collect::<Vec<_>>(),
            "profiles": registry.devices,
        }))
        .into_response(),
        Err(err) => internal_error(&format!("read storage failed: {err}")),
    }
}

async fn storage_save(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Value>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let input = match parse_storage_save_input(input) {
        Ok(input) => input,
        Err(err) => return bad_request(&err.to_string()),
    };
    match save_hardware(input) {
        Ok(device) => Json(json!({
            "device": web_storage_device(&device),
            "profile": device,
        }))
        .into_response(),
        Err(err) => bad_request(&format!("save storage failed: {err}")),
    }
}

async fn storage_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match delete_hardware(&id) {
        Ok(removed) => Json(json!({"removed": removed})).into_response(),
        Err(err) => bad_request(&format!("delete storage failed: {err}")),
    }
}

async fn storage_settings_get(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match read_storage_settings() {
        Ok(settings) => Json(json!({"settings": settings})).into_response(),
        Err(err) => internal_error(&format!("read settings failed: {err}")),
    }
}

async fn storage_settings_put(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<StorageSettingsRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match write_storage_settings(&req.settings) {
        Ok(()) => Json(json!({"settings": req.settings})).into_response(),
        Err(err) => bad_request(&format!("write settings failed: {err}")),
    }
}

async fn storage_migrate_localstorage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Value>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match migrate_localstorage_payload(input) {
        Ok((devices, settings_written)) => Json(json!({
            "migrated": devices > 0 || settings_written,
            "imported": {"devices": devices, "settings": settings_written},
        }))
        .into_response(),
        Err(err) => bad_request(&format!("migration failed: {err}")),
    }
}

async fn storage_export(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let registry = match read_hardware_registry() {
        Ok(registry) => registry,
        Err(err) => return internal_error(&format!("read storage failed: {err}")),
    };
    let settings = match read_storage_settings() {
        Ok(settings) => settings,
        Err(err) => return internal_error(&format!("read settings failed: {err}")),
    };
    Json(json!({
        "schema_version": STORAGE_SCHEMA_VERSION,
        "devices": registry.devices.iter().map(web_storage_device).collect::<Vec<_>>(),
        "profiles": registry.devices,
        "settings": settings,
        "meta": {},
    }))
    .into_response()
}

async fn storage_reset(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let registry = HardwareRegistry::default();
    if let Err(err) = write_hardware_registry(&registry) {
        return bad_request(&format!("reset storage failed: {err}"));
    }
    if let Err(err) = write_storage_settings(&default_storage_settings()) {
        return bad_request(&format!("reset settings failed: {err}"));
    }
    Json(json!({"ok": true})).into_response()
}

fn parse_storage_save_input(value: Value) -> anyhow::Result<SavedHardwareInput> {
    if let Some(device) = value.get("device").and_then(Value::as_object) {
        let name = device
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("device.name is required"))?
            .to_string();
        let base_url = device
            .get("baseUrl")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("device.baseUrl is required"))?
            .to_string();
        let id = device
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| stable_http_device_id(&base_url));
        return Ok(SavedHardwareInput {
            id,
            name,
            transport: hardware_transport_from_storage_url(&base_url),
        });
    }
    #[derive(Deserialize)]
    struct Wire {
        id: String,
        name: String,
        transport: HardwareTransport,
    }
    let wire: Wire = serde_json::from_value(value)?;
    Ok(SavedHardwareInput {
        id: wire.id,
        name: wire.name,
        transport: wire.transport,
    })
}

fn web_storage_device(profile: &DeviceProfile) -> Value {
    let base_url = match &profile.transport {
        HardwareTransport::Http { base_url } => base_url.clone(),
        HardwareTransport::Usb { device_id, .. } => format!("isolapurr-devd://{device_id}"),
        HardwareTransport::WebSerial { label } => {
            format!("webserial://{}", label.as_deref().unwrap_or(&profile.id))
        }
    };
    json!({
        "id": profile.id,
        "name": profile.name,
        "baseUrl": base_url,
        "lastSeenAt": profile.last_seen_at.map(|ts| ts.to_string()),
    })
}

fn hardware_transport_from_storage_url(base_url: &str) -> HardwareTransport {
    if let Some(device_id) = base_url.strip_prefix("isolapurr-devd://") {
        HardwareTransport::Usb {
            device_id: device_id.to_string(),
            devd_url: None,
        }
    } else if let Some(label) = base_url.strip_prefix("webserial://") {
        HardwareTransport::WebSerial {
            label: Some(label.to_string()),
        }
    } else {
        HardwareTransport::Http {
            base_url: base_url.to_string(),
        }
    }
}

fn parse_web_storage_device(value: &Value) -> anyhow::Result<DeviceProfile> {
    let device = value
        .as_object()
        .ok_or_else(|| anyhow!("device must be an object"))?;
    let id = device
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("device.id is required"))?
        .to_string();
    let name = device
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("device.name is required"))?
        .to_string();
    let base_url = device
        .get("baseUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("device.baseUrl is required"))?;
    Ok(DeviceProfile {
        id,
        name,
        transport: hardware_transport_from_storage_url(base_url),
        identity: None,
        last_seen_at: Some(now_unix_seconds()),
    })
}

fn parse_import_profiles(req: &StorageImportRequest) -> anyhow::Result<Vec<DeviceProfile>> {
    if !req.profiles.is_empty() {
        return Ok(req.profiles.clone());
    }
    req.devices
        .iter()
        .cloned()
        .map(|device| {
            if device.get("transport").is_some() {
                serde_json::from_value(device).context("parse device profile")
            } else {
                parse_web_storage_device(&device)
            }
        })
        .collect()
}

fn migrate_localstorage_payload(value: Value) -> anyhow::Result<(usize, bool)> {
    let mut imported_devices = 0;
    if let Some(devices) = value.get("devices").and_then(Value::as_array) {
        let mut registry = read_hardware_registry()?;
        for device in devices {
            upsert_profile(&mut registry, parse_web_storage_device(device)?);
            imported_devices += 1;
        }
        write_hardware_registry(&registry)?;
    }

    let mut settings_written = false;
    if let Some(theme) = value
        .get("settings")
        .and_then(|settings| settings.get("theme"))
        .and_then(Value::as_str)
    {
        write_storage_settings(&StorageSettings {
            theme: theme.to_string(),
        })?;
        settings_written = true;
    }
    Ok((imported_devices, settings_written))
}

async fn storage_import(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<StorageImportRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let profiles = match parse_import_profiles(&req) {
        Ok(profiles) => profiles,
        Err(err) => return bad_request(&format!("import failed: {err}")),
    };
    let settings = req.settings;
    match import_profiles(profiles) {
        Ok(count) => {
            let settings_written = if let Some(settings) = settings {
                if let Err(err) = write_storage_settings(&settings) {
                    return bad_request(&format!("import settings failed: {err}"));
                }
                true
            } else {
                false
            };
            Json(json!({"imported": {"devices": count, "settings": settings_written}}))
                .into_response()
        }
        Err(err) => bad_request(&format!("import failed: {err}")),
    }
}

async fn validate_catalog(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(catalog): Json<FirmwareCatalog>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let errors = validate_catalog_shape(&catalog);
    Json(json!({"ok": errors.is_empty(), "errors": errors})).into_response()
}

async fn usb_jsonl_request(
    state: &AppState,
    device_id: &str,
    method: &str,
    params: Option<Value>,
) -> anyhow::Result<Value> {
    usb_jsonl_request_with_exclusive(state, device_id, method, params, None).await
}

async fn usb_jsonl_request_with_exclusive(
    state: &AppState,
    device_id: &str,
    method: &str,
    params: Option<Value>,
    allowed_exclusive_reason: Option<&str>,
) -> anyhow::Result<Value> {
    let (port_path, request_id) = {
        let inner = state.inner.lock().await;
        let device = inner
            .devices
            .get(device_id)
            .ok_or_else(|| anyhow!("device not found"))?;
        let usb = device
            .usb
            .as_ref()
            .ok_or_else(|| anyhow!("device has no Local USB target"))?;
        if let Some(reason) = inner.exclusive_ports.get(&usb.port_path)
            && allowed_exclusive_reason != Some(reason.as_str())
        {
            return Err(anyhow!("device busy: {reason}"));
        }
        (usb.port_path.clone(), next_id())
    };

    let request = json!({
        "id": request_id,
        "method": method,
        "params": params.unwrap_or_else(|| json!({})),
    });
    push_trace(state, device_id, "tx", method, &request).await;
    let response = tokio::task::spawn_blocking(move || serial_jsonl_roundtrip(&port_path, request))
        .await
        .context("serial worker join")??;
    push_trace(state, device_id, "rx", method, &response).await;
    Ok(response)
}

async fn device_usb_port_path(state: &AppState, device_id: &str) -> anyhow::Result<String> {
    let inner = state.inner.lock().await;
    Ok(inner
        .devices
        .get(device_id)
        .ok_or_else(|| anyhow!("device not found"))?
        .usb
        .as_ref()
        .ok_or_else(|| anyhow!("device has no Local USB target"))?
        .port_path
        .clone())
}

fn serial_jsonl_roundtrip(port_path: &str, request: Value) -> anyhow::Result<Value> {
    let mut port = serialport::new(port_path, SERIAL_BAUD)
        .timeout(Duration::from_millis(50))
        .open()
        .with_context(|| format!("open serial port {port_path}"))?;
    let mut line = serde_json::to_string(&request)?;
    line.push('\n');
    use std::io::{Read as _, Write as _};
    port.write_all(line.as_bytes()).context("serial write")?;
    port.flush().context("serial flush")?;

    let expected_id = request.get("id").cloned();
    let deadline = Instant::now() + Duration::from_millis(SERIAL_TIMEOUT_MS);
    let mut raw = Vec::<u8>::new();
    let mut buf = [0_u8; 256];
    while Instant::now() < deadline {
        match port.read(&mut buf) {
            Ok(0) => {}
            Ok(n) => {
                raw.extend_from_slice(&buf[..n]);
                while let Some(pos) = raw.iter().position(|byte| *byte == b'\n') {
                    let frame = raw.drain(..=pos).collect::<Vec<_>>();
                    let text = String::from_utf8_lossy(&frame);
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
                        continue;
                    };
                    if expected_id.is_none() || value.get("id") == expected_id.as_ref() {
                        return Ok(value);
                    }
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::TimedOut => {}
            Err(err) => return Err(err).context("serial read"),
        }
    }
    Err(anyhow!("serial response timed out"))
}

async fn run_flash_request(
    state: &AppState,
    device_id: &str,
    req: FlashRequest,
) -> anyhow::Result<Value> {
    let catalog: FirmwareCatalog = serde_json::from_slice(&fs::read(&req.catalog_path)?)?;
    let errors = validate_catalog_shape(&catalog);
    if !errors.is_empty() {
        return Err(anyhow!("invalid firmware catalog: {}", errors.join(", ")));
    }
    let artifact = catalog
        .artifacts
        .iter()
        .find(|artifact| artifact.artifact_id == req.artifact_id)
        .ok_or_else(|| anyhow!("artifact not found: {}", req.artifact_id))?;
    let app_file = if req.first_time {
        artifact
            .files
            .iter()
            .find(|file| file.kind == "elf" || file.kind == "full_image")
            .ok_or_else(|| anyhow!("first-time flash requires an elf or full_image artifact"))?
    } else {
        artifact
            .files
            .iter()
            .find(|file| file.kind == "app_bin")
            .ok_or_else(|| anyhow!("normal flash requires an app_bin artifact"))?
    };
    verify_artifact_file(&req.catalog_path, app_file)?;

    if !req.real {
        return Ok(json!({
            "ok": true,
            "dry_run": true,
            "artifact_id": artifact.artifact_id,
            "target": artifact.target,
            "file": app_file.path,
        }));
    }

    let port_path = {
        let inner = state.inner.lock().await;
        inner
            .devices
            .get(device_id)
            .ok_or_else(|| anyhow!("device not found"))?
            .usb
            .as_ref()
            .ok_or_else(|| anyhow!("device has no Local USB target"))?
            .port_path
            .clone()
    };

    if !req.first_time {
        let expected_identity = req
            .expected_identity
            .as_ref()
            .ok_or_else(|| anyhow!("normal flash requires expectedIdentity"))?;
        let identity = usb_jsonl_request(state, device_id, "info", None).await?;
        validate_device_identity(&identity, expected_identity)?;
    }

    {
        let mut inner = state.inner.lock().await;
        if inner.exclusive_ports.contains_key(&port_path) {
            return Err(anyhow!("device busy"));
        }
        inner
            .exclusive_ports
            .insert(port_path.clone(), "firmware flash".to_string());
    }
    let guard = ExclusiveGuard {
        state: state.clone(),
        port_path: port_path.clone(),
    };

    let file_path = resolve_catalog_file_path(&req.catalog_path, &app_file.path);
    let output = if req.first_time && app_file.kind == "elf" {
        Command::new("espflash")
            .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
            .arg("flash")
            .arg("--chip")
            .arg("esp32s3")
            .arg("--port")
            .arg(&port_path)
            .arg(&file_path)
            .output()
            .context("start espflash flash")?
    } else {
        let address = app_file
            .flash_address
            .unwrap_or(if app_file.kind == "full_image" {
                0
            } else {
                DEFAULT_FLASH_ADDRESS
            });
        Command::new("espflash")
            .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
            .arg("write-bin")
            .arg("--chip")
            .arg("esp32s3")
            .arg("--port")
            .arg(&port_path)
            .arg(format!("0x{address:x}"))
            .arg(&file_path)
            .output()
            .context("start espflash write-bin")?
    };
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        drop(guard);
        return Err(anyhow!("espflash failed: {log}"));
    }
    let captured_identity = if req.first_time {
        Some(capture_first_time_identity_after_flash(state, device_id).await?)
    } else {
        None
    };
    drop(guard);
    Ok(json!({
        "ok": true,
        "exit_code": output.status.code(),
        "artifact_id": artifact.artifact_id,
        "identity": captured_identity,
        "log": log,
    }))
}

async fn run_uploaded_flash_request(
    state: &AppState,
    device_id: &str,
    req: FirmwareUploadFlashRequest,
) -> anyhow::Result<Value> {
    if req.address != DEFAULT_FLASH_ADDRESS {
        return Err(anyhow!(
            "Local USB firmware flashing writes the app image at 0x10000"
        ));
    }
    let port_path = {
        let inner = state.inner.lock().await;
        inner
            .devices
            .get(device_id)
            .ok_or_else(|| anyhow!("device not found"))?
            .usb
            .as_ref()
            .ok_or_else(|| anyhow!("device has no Local USB target"))?
            .port_path
            .clone()
    };
    let identity = usb_jsonl_request(state, device_id, "info", None).await?;
    validate_device_identity(&identity, &req.expected_identity)?;

    let bytes = {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD
            .decode(req.file_base64.trim())
            .context("firmware payload was not valid base64")?
    };
    let file_name = FsPath::new(req.file_name.trim())
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("firmware.bin");
    let temp_path = std::env::temp_dir().join(format!("isolapurr-flash-{}-{file_name}", next_id()));
    fs::write(&temp_path, bytes).with_context(|| format!("write {}", temp_path.display()))?;
    struct TempFirmwareFile(PathBuf);
    impl Drop for TempFirmwareFile {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    let _temp_file = TempFirmwareFile(temp_path.clone());

    {
        let mut inner = state.inner.lock().await;
        if inner.exclusive_ports.contains_key(&port_path) {
            return Err(anyhow!("device busy"));
        }
        inner
            .exclusive_ports
            .insert(port_path.clone(), "firmware flash".to_string());
    }
    let guard = ExclusiveGuard {
        state: state.clone(),
        port_path: port_path.clone(),
    };
    let output = Command::new("espflash")
        .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
        .arg("write-bin")
        .arg("--chip")
        .arg("esp32s3")
        .arg("--port")
        .arg(&port_path)
        .arg(format!("0x{:x}", req.address))
        .arg(&temp_path)
        .output()
        .context("start espflash write-bin")?;
    drop(guard);
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(anyhow!("espflash failed: {log}"));
    }
    Ok(json!({
        "ok": true,
        "exit_code": output.status.code(),
        "log": log,
    }))
}

#[derive(Clone)]
struct ExclusiveGuard {
    state: AppState,
    port_path: String,
}

impl Drop for ExclusiveGuard {
    fn drop(&mut self) {
        let state = self.state.clone();
        let port_path = self.port_path.clone();
        tokio::spawn(async move {
            state.inner.lock().await.exclusive_ports.remove(&port_path);
        });
    }
}

async fn require_lease(
    state: &AppState,
    device_id: &str,
    lease_id: Option<&str>,
) -> Result<(), Box<Response>> {
    cleanup_expired_leases(state).await;
    let Some(lease_id) = lease_id else {
        return Err(Box::new(unauthorized("lease_id is required")));
    };
    let inner = state.inner.lock().await;
    let Some(lease) = inner.leases.get(lease_id) else {
        return Err(Box::new(unauthorized("lease not found or expired")));
    };
    if lease.device_id != device_id {
        return Err(Box::new(unauthorized("lease does not belong to device")));
    }
    Ok(())
}

async fn cleanup_expired_leases(state: &AppState) {
    let now = Instant::now();
    state
        .inner
        .lock()
        .await
        .leases
        .retain(|_, lease| lease.expires_at > now);
}

fn list_serial_ports() -> anyhow::Result<Vec<UsbTarget>> {
    let targets = serialport::available_ports()?
        .into_iter()
        .filter_map(|port| {
            let (vendor_id, product_id, serial_number, manufacturer, product) = match port.port_type
            {
                serialport::SerialPortType::UsbPort(info) => (
                    Some(info.vid),
                    Some(info.pid),
                    info.serial_number,
                    info.manufacturer,
                    info.product,
                ),
                _ => (None, None, None, None, None),
            };
            let label = product
                .clone()
                .or(manufacturer)
                .unwrap_or_else(|| port.port_name.clone());
            let target = UsbTarget {
                port_path: port.port_name,
                label,
                vendor_id,
                product_id,
                serial_number,
            };
            is_esp32_serial_port(&target).then_some(target)
        })
        .collect();
    Ok(dedupe_usb_serial_device_pairs(targets))
}

fn is_esp32_serial_port(port: &UsbTarget) -> bool {
    let path = port.port_path.to_lowercase();
    if path.contains("bluetooth") || path.contains("debug-console") {
        return false;
    }
    if port.vendor_id == Some(0x303a) {
        return true;
    }
    let label = port.label.to_lowercase();
    let path_looks_serial = path.contains("usbmodem")
        || path.contains("usbserial")
        || path.contains("ttyacm")
        || (path.starts_with("com") && path[3..].chars().all(|c| c.is_ascii_digit()));
    path_looks_serial
        && (label.contains("esp32") || label.contains("espressif") || label.contains("usb jtag"))
}

fn dedupe_usb_serial_device_pairs(mut targets: Vec<UsbTarget>) -> Vec<UsbTarget> {
    targets.sort_by(|a, b| {
        let a_cu = if is_cu_port(&a.port_path) { 0 } else { 1 };
        let b_cu = if is_cu_port(&b.port_path) { 0 } else { 1 };
        a_cu.cmp(&b_cu).then_with(|| a.port_path.cmp(&b.port_path))
    });

    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for target in targets {
        let key = target
            .serial_number
            .clone()
            .unwrap_or_else(|| paired_serial_device_key(&target.port_path));
        if seen.insert(key) {
            deduped.push(target);
        }
    }
    deduped
}

fn is_cu_port(path: &str) -> bool {
    path.starts_with("/dev/cu.")
}

fn paired_serial_device_key(path: &str) -> String {
    path.replacen("/dev/tty.", "/dev/cu.", 1)
}

fn stable_usb_device_id(port_path: &str) -> String {
    let sanitized = port_path
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    format!("usb-{sanitized}")
}

fn stable_http_device_id(base_url: &str) -> String {
    let sanitized = base_url
        .trim()
        .trim_end_matches('/')
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    format!("http-{sanitized}")
}

pub fn registry_path() -> anyhow::Result<PathBuf> {
    let dirs = ProjectDirs::from("cc", "isolapurr", "isolapurr")
        .ok_or_else(|| anyhow!("cannot resolve user config directory"))?;
    Ok(dirs.config_dir().join(STORAGE_FILE_NAME))
}

pub fn read_hardware_registry() -> anyhow::Result<HardwareRegistry> {
    let path = registry_path()?;
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(HardwareRegistry {
                schema_version: STORAGE_SCHEMA_VERSION,
                devices: Vec::new(),
            });
        }
        Err(err) => return Err(err).context("read hardware registry"),
    };
    let mut registry: HardwareRegistry = serde_json::from_slice(&raw)?;
    if registry.schema_version == 0 {
        registry.schema_version = STORAGE_SCHEMA_VERSION;
    }
    Ok(registry)
}

pub fn write_hardware_registry(registry: &HardwareRegistry) -> anyhow::Result<()> {
    let path = registry_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(registry)?)?;
    fs::rename(tmp, path)?;
    Ok(())
}

fn settings_path() -> anyhow::Result<PathBuf> {
    let dirs = ProjectDirs::from("cc", "isolapurr", "isolapurr")
        .ok_or_else(|| anyhow!("cannot resolve user config directory"))?;
    Ok(dirs.config_dir().join(STORAGE_SETTINGS_FILE_NAME))
}

fn default_storage_settings() -> StorageSettings {
    StorageSettings {
        theme: "isolapurr".to_string(),
    }
}

fn read_storage_settings() -> anyhow::Result<StorageSettings> {
    let path = settings_path()?;
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(default_storage_settings());
        }
        Err(err) => return Err(err).context("read storage settings"),
    };
    Ok(serde_json::from_slice(&raw)?)
}

fn write_storage_settings(settings: &StorageSettings) -> anyhow::Result<()> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(settings)?)?;
    fs::rename(tmp, path)?;
    Ok(())
}

pub fn save_hardware(input: SavedHardwareInput) -> anyhow::Result<DeviceProfile> {
    let mut registry = read_hardware_registry()?;
    let profile = DeviceProfile {
        id: input.id,
        name: input.name,
        transport: input.transport,
        identity: None,
        last_seen_at: Some(now_unix_seconds()),
    };
    upsert_profile(&mut registry, profile.clone());
    write_hardware_registry(&registry)?;
    Ok(profile)
}

fn delete_hardware(id: &str) -> anyhow::Result<bool> {
    let mut registry = read_hardware_registry()?;
    let before = registry.devices.len();
    registry.devices.retain(|device| device.id != id);
    write_hardware_registry(&registry)?;
    Ok(before != registry.devices.len())
}

fn import_profiles(profiles: Vec<DeviceProfile>) -> anyhow::Result<usize> {
    let mut registry = read_hardware_registry()?;
    let mut count = 0;
    for mut profile in profiles {
        if profile.last_seen_at.is_none() {
            profile.last_seen_at = Some(now_unix_seconds());
        }
        upsert_profile(&mut registry, profile);
        count += 1;
    }
    write_hardware_registry(&registry)?;
    Ok(count)
}

fn upsert_profile(registry: &mut HardwareRegistry, profile: DeviceProfile) {
    if let Some(existing) = registry
        .devices
        .iter_mut()
        .find(|device| device.id == profile.id)
    {
        let mut profile = profile;
        if profile.identity.is_none() {
            profile.identity = existing.identity.clone();
        }
        *existing = profile;
    } else {
        registry.devices.push(profile);
    }
}

fn now_unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn api_url(base: &str, path: &str) -> anyhow::Result<reqwest::Url> {
    let base = reqwest::Url::parse(base)?;
    Ok(base.join(path.trim_start_matches('/'))?)
}

pub fn validate_catalog_shape(catalog: &FirmwareCatalog) -> Vec<String> {
    let mut errors = Vec::new();
    if catalog.schema_version.trim().is_empty() {
        errors.push("schemaVersion is required".to_string());
    }
    if catalog.artifacts.is_empty() {
        errors.push("at least one artifact is required".to_string());
    }
    for artifact in &catalog.artifacts {
        if artifact.artifact_id.trim().is_empty() {
            errors.push("artifactId is required".to_string());
        }
        if artifact.target != "esp32s3_app" && artifact.target != "esp32s3_full" {
            errors.push(format!("unsupported target {}", artifact.target));
        }
        for file in &artifact.files {
            if file.kind == "app_bin" && file.flash_address != Some(DEFAULT_FLASH_ADDRESS) {
                errors.push(format!(
                    "app_bin {} must use flashAddress 0x10000",
                    file.path
                ));
            }
            if file.kind == "full_image" && file.flash_address.is_some_and(|address| address != 0) {
                errors.push(format!(
                    "full_image {} must use flashAddress 0x0",
                    file.path
                ));
            }
            if file.sha256.len() != 64 || !file.sha256.chars().all(|ch| ch.is_ascii_hexdigit()) {
                errors.push(format!("file {} has invalid sha256", file.path));
            }
        }
    }
    errors
}

fn verify_artifact_file(catalog_path: &FsPath, file: &FirmwareFile) -> anyhow::Result<()> {
    let file_path = resolve_catalog_file_path(catalog_path, &file.path);
    let bytes = fs::read(&file_path).with_context(|| format!("read {}", file_path.display()))?;
    if bytes.len() as u64 != file.size {
        return Err(anyhow!(
            "artifact size mismatch for {}: expected {}, got {}",
            file.path,
            file.size,
            bytes.len()
        ));
    }
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != file.sha256.to_lowercase() {
        return Err(anyhow!(
            "artifact hash mismatch for {}: expected {}, got {actual}",
            file.path,
            file.sha256
        ));
    }
    Ok(())
}

fn resolve_catalog_file_path(catalog_path: &FsPath, relative: &str) -> PathBuf {
    let path = FsPath::new(relative);
    if path.is_absolute() {
        return path.to_path_buf();
    }
    catalog_path
        .parent()
        .unwrap_or_else(|| FsPath::new("."))
        .join(path)
}

fn validate_device_identity(info: &Value, expected: &DeviceIdentity) -> anyhow::Result<()> {
    if expected.device_id.is_none() && expected.mac.is_none() {
        return Err(anyhow!("expectedIdentity must include deviceId or mac"));
    }
    let device = info
        .get("result")
        .and_then(|value| value.get("device"))
        .or_else(|| info.get("device"))
        .ok_or_else(|| anyhow!("info response did not include device identity"))?;
    if let Some(expected_id) = expected.device_id.as_deref() {
        let actual_id = device
            .get("device_id")
            .or_else(|| device.get("deviceId"))
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("info response did not include device_id"))?;
        if actual_id != expected_id {
            return Err(anyhow!(
                "device identity mismatch: expected device_id {expected_id}, got {actual_id}"
            ));
        }
    }
    if let Some(expected_mac) = expected.mac.as_deref() {
        let actual_mac = device
            .get("mac")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("info response did not include mac"))?;
        if !actual_mac.eq_ignore_ascii_case(expected_mac) {
            return Err(anyhow!(
                "device identity mismatch: expected mac {expected_mac}, got {actual_mac}"
            ));
        }
    }
    Ok(())
}

async fn capture_first_time_identity_after_flash(
    state: &AppState,
    device_id: &str,
) -> anyhow::Result<DeviceIdentity> {
    let mut last_error: Option<anyhow::Error> = None;
    for _ in 0..15 {
        tokio::time::sleep(Duration::from_millis(1_000)).await;
        match usb_jsonl_request_with_exclusive(
            state,
            device_id,
            "info",
            None,
            Some("firmware flash"),
        )
        .await
        {
            Ok(info) => {
                let identity = extract_device_identity(&info)?;
                persist_captured_identity(state, device_id, &identity).await?;
                return Ok(identity);
            }
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("first-time identity capture failed")))
}

fn extract_device_identity(info: &Value) -> anyhow::Result<DeviceIdentity> {
    let device = info
        .get("result")
        .and_then(|value| value.get("device"))
        .or_else(|| info.get("device"))
        .ok_or_else(|| anyhow!("info response did not include device identity"))?;
    let identity = DeviceIdentity {
        device_id: device
            .get("device_id")
            .or_else(|| device.get("deviceId"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        mac: device
            .get("mac")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    };
    if identity.device_id.is_none() && identity.mac.is_none() {
        return Err(anyhow!("info response did not include device_id or mac"));
    }
    Ok(identity)
}

async fn persist_captured_identity(
    state: &AppState,
    device_id: &str,
    identity: &DeviceIdentity,
) -> anyhow::Result<()> {
    {
        let mut inner = state.inner.lock().await;
        if let Some(device) = inner.devices.get_mut(device_id) {
            device.identity = Some(serde_json::to_value(identity)?);
        }
    }

    let mut registry = read_hardware_registry()?;
    let mut changed = false;
    for profile in &mut registry.devices {
        if let HardwareTransport::Usb {
            device_id: saved_device_id,
            ..
        } = &profile.transport
            && saved_device_id == device_id
        {
            profile.identity = Some(identity.clone());
            profile.last_seen_at = Some(now_unix_seconds());
            changed = true;
        }
    }
    if changed {
        write_hardware_registry(&registry)?;
    }
    Ok(())
}

pub fn redact_sensitive(value: &Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, value)| {
                    let lower = key.to_lowercase();
                    if matches!(
                        lower.as_str(),
                        "psk" | "password" | "passphrase" | "secret" | "token"
                    ) {
                        (key.clone(), Value::String("<redacted>".to_string()))
                    } else {
                        (key.clone(), redact_sensitive(value))
                    }
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(redact_sensitive).collect()),
        other => other.clone(),
    }
}

async fn push_trace(
    state: &AppState,
    device_id: &str,
    level: &str,
    message: &str,
    payload: &Value,
) {
    let mut inner = state.inner.lock().await;
    if let Some(device) = inner.devices.get_mut(device_id) {
        bounded_push(
            &mut device.session.traces,
            SessionItem {
                id: next_id(),
                timestamp_unix_ms: now_unix_millis(),
                level: level.to_string(),
                message: message.to_string(),
                payload: redact_sensitive(payload),
            },
        );
    }
}

fn bounded_push(items: &mut VecDeque<SessionItem>, item: SessionItem) {
    while items.len() >= MAX_SESSION_ITEMS {
        items.pop_front();
    }
    items.push_back(item);
}

fn tail_items(items: &VecDeque<SessionItem>, tail: usize) -> Vec<SessionItem> {
    items
        .iter()
        .skip(items.len().saturating_sub(tail))
        .cloned()
        .collect()
}

fn now_unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn next_id() -> String {
    format!("{:x}", now_unix_millis()) + "-" + &generate_token()[..8]
}

fn generate_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn require_auth(headers: &HeaderMap, state: &AppState) -> Result<(), Box<Response>> {
    let Some(auth) = headers.get(header::AUTHORIZATION) else {
        return Err(Box::new(unauthorized("missing bearer token")));
    };
    let Ok(auth) = auth.to_str() else {
        return Err(Box::new(unauthorized("invalid bearer token")));
    };
    if auth != format!("Bearer {}", state.token) {
        return Err(Box::new(unauthorized("invalid bearer token")));
    }
    Ok(())
}

fn is_loopback_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let Ok(url) = reqwest::Url::parse(origin) else {
        return false;
    };
    matches!(url.scheme(), "http" | "https" | "tauri")
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
}

fn error_from_anyhow(err: anyhow::Error) -> Response {
    if err.to_string().contains("busy") {
        conflict(&err.to_string())
    } else {
        internal_error(&err.to_string())
    }
}

fn unauthorized(message: &str) -> Response {
    error_response(StatusCode::UNAUTHORIZED, "unauthorized", message, false)
}

fn bad_request(message: &str) -> Response {
    error_response(StatusCode::BAD_REQUEST, "bad_request", message, false)
}

fn not_found(message: &str) -> Response {
    error_response(StatusCode::NOT_FOUND, "not_found", message, false)
}

fn conflict(message: &str) -> Response {
    error_response(StatusCode::CONFLICT, "busy", message, true)
}

fn internal_error(message: &str) -> Response {
    error_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal_error",
        message,
        false,
    )
}

fn error_response(
    status: StatusCode,
    code: &'static str,
    message: &str,
    retryable: bool,
) -> Response {
    (
        status,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code,
                message: message.to_string(),
                retryable,
            },
        }),
    )
        .into_response()
}

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
                id: "bench".to_string(),
                name: "Bench".to_string(),
                transport: HardwareTransport::Usb {
                    device_id: "usb--dev-cu-usbmodem101".to_string(),
                    devd_url: None,
                },
                identity: Some(DeviceIdentity {
                    device_id: Some("isolapurr-abc".to_string()),
                    mac: Some("AA:BB:CC:DD:EE:FF".to_string()),
                }),
                last_seen_at: Some(1),
            }],
        };

        upsert_profile(
            &mut registry,
            DeviceProfile {
                id: "bench".to_string(),
                name: "Bench renamed".to_string(),
                transport: HardwareTransport::Usb {
                    device_id: "usb--dev-cu-usbmodem101".to_string(),
                    devd_url: None,
                },
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
            Some("isolapurr-abc")
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
                    "device_id": "abc123",
                    "mac": "AA:BB:CC:DD:EE:FF"
                }
            }
        });
        validate_device_identity(
            &info,
            &DeviceIdentity {
                device_id: Some("abc123".to_string()),
                mac: Some("aa:bb:cc:dd:ee:ff".to_string()),
            },
        )
        .expect("identity should match");
    }

    #[test]
    fn rejects_mismatched_device_identity() {
        let info = json!({"result": {"device": {"device_id": "abc123"}}});
        assert!(
            validate_device_identity(
                &info,
                &DeviceIdentity {
                    device_id: Some("other".to_string()),
                    mac: None,
                },
            )
            .is_err()
        );
    }

    #[test]
    fn import_accepts_exported_profiles_shape() {
        let req = StorageImportRequest {
            devices: vec![json!({
                "id": "web",
                "name": "Web device",
                "baseUrl": "isolapurr-devd://usb--dev-cu-usbmodem101"
            })],
            profiles: vec![DeviceProfile {
                id: "cli".to_string(),
                name: "CLI device".to_string(),
                transport: HardwareTransport::Usb {
                    device_id: "usb--dev-cu-usbmodem101".to_string(),
                    devd_url: None,
                },
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
        assert_eq!(profiles[0].id, "cli");

        let devices = parse_import_profiles(&StorageImportRequest {
            devices: vec![json!({
                "id": "web",
                "name": "Web device",
                "baseUrl": "isolapurr-devd://usb--dev-cu-usbmodem101"
            })],
            profiles: vec![],
            settings: None,
        })
        .expect("web devices should import");

        assert!(matches!(
            devices[0].transport,
            HardwareTransport::Usb { ref device_id, .. }
                if device_id == "usb--dev-cu-usbmodem101"
        ));
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
}
