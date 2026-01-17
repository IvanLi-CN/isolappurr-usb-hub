use std::{
    collections::HashMap,
    net::{Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use anyhow::{Context as _, anyhow};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use clap::{Parser, Subcommand};
use directories::ProjectDirs;
use futures::{StreamExt as _, stream};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use tokio::{net::TcpListener, sync::RwLock};
use tokio_util::sync::CancellationToken;
use url::Url;

const DEFAULT_PORT_RANGE_START: u16 = 51200;
const DEFAULT_PORT_RANGE_END: u16 = 51299;
const STORAGE_SCHEMA_VERSION: u8 = 1;
const STORAGE_FILE_NAME: &str = "storage.json";

const EXIT_BAD_ARGS: i32 = 2;
const EXIT_SERVER_FAILED: i32 = 10;
const EXIT_DISCOVERY_UNAVAILABLE: i32 = 20;

#[derive(Parser, Debug)]
#[command(name = "isolapurr-desktop", version, about)]
struct Cli {
    #[command(subcommand)]
    cmd: Option<Cmd>,

    #[arg(long)]
    port: Option<u16>,

    #[arg(long)]
    no_open: bool,
}

#[derive(Subcommand, Debug, Clone)]
enum Cmd {
    Gui,
    Tray,
    Open,
    Serve,
    Discover {
        #[arg(long)]
        json: bool,
    },
}

#[derive(Clone, Debug, Serialize)]
struct ErrorEnvelope {
    error: ErrorInfo,
}

#[derive(Clone, Debug, Serialize)]
struct ErrorInfo {
    code: &'static str,
    message: String,
    retryable: bool,
}

#[derive(Clone, Debug, Serialize)]
struct BootstrapResponse {
    token: String,
    #[serde(rename = "agentBaseUrl")]
    agent_base_url: String,
    app: BootstrapApp,
}

#[derive(Clone, Debug, Serialize)]
struct BootstrapApp {
    name: &'static str,
    version: &'static str,
    mode: &'static str,
}

#[derive(Clone, Debug, Serialize, Default)]
struct DiscoverySnapshot {
    mode: DiscoveryMode,
    status: DiscoveryStatus,
    devices: Vec<DiscoveredDevice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scan: Option<ScanState>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DiscoveryMode {
    #[default]
    Service,
    Scan,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DiscoveryStatus {
    Idle,
    Scanning,
    Ready,
    #[default]
    Unavailable,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ScanState {
    cidr: String,
    done: u32,
    total: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct DiscoveredDevice {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fqdn: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ipv4: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    variant: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    firmware: Option<FirmwareInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_seen_at: Option<String>,
}

#[derive(Clone, Debug)]
struct ResolvedService {
    hostname: String,
    port: u16,
    ipv4: Option<Ipv4Addr>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct FirmwareInfo {
    name: String,
    version: String,
}

#[derive(Clone)]
struct AppState {
    token: String,
    agent_base_url: Url,
    mode: &'static str,
    discovery: Arc<DiscoveryController>,
    storage: Arc<StorageManager>,
}

struct DiscoveryController {
    snapshot: RwLock<DiscoverySnapshot>,
    ip_scan_cancel: RwLock<CancellationToken>,
    mdns: Option<ServiceDaemon>,
    mdns_error: Option<String>,
    mdns_unavailable: AtomicBool,
    http: reqwest::Client,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ThemeId {
    Isolapurr,
    IsolapurrDark,
    System,
}

impl ThemeId {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "isolapurr" => Some(Self::Isolapurr),
            "isolapurr-dark" => Some(Self::IsolapurrDark),
            "system" => Some(Self::System),
            _ => None,
        }
    }
}

impl Default for ThemeId {
    fn default() -> Self {
        Self::Isolapurr
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDevice {
    id: String,
    name: String,
    base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_seen_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    theme: Option<ThemeId>,
}

impl DesktopSettings {
    fn resolved_theme(&self) -> ThemeId {
        self.theme.clone().unwrap_or_default()
    }
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            theme: Some(ThemeId::default()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    migrated_from_localstorage_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_corrupt_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_corrupt_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStorage {
    schema_version: u8,
    #[serde(default)]
    devices: Vec<StoredDevice>,
    #[serde(default)]
    settings: DesktopSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    meta: Option<StorageMeta>,
}

impl Default for DesktopStorage {
    fn default() -> Self {
        Self {
            schema_version: STORAGE_SCHEMA_VERSION,
            devices: Vec::new(),
            settings: DesktopSettings {
                theme: Some(ThemeId::default()),
            },
            meta: None,
        }
    }
}

#[derive(Debug)]
struct StorageManager {
    path: PathBuf,
    inner: RwLock<DesktopStorage>,
}

#[derive(Clone, Debug)]
enum StorageError {
    BadRequest(String),
    Conflict(String),
    NotFound(String),
    Internal(String),
}

impl StorageError {
    fn response(self) -> Response {
        match self {
            Self::BadRequest(message) => bad_request(&message),
            Self::Conflict(message) => conflict(&message),
            Self::NotFound(message) => not_found(&message),
            Self::Internal(message) => internal_error(&message),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertDeviceRequest {
    device: UpsertDeviceInput,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpsertDeviceInput {
    id: Option<String>,
    name: String,
    base_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpsertDeviceResponse {
    device: StoredDevice,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevicesResponse {
    devices: Vec<StoredDevice>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSettingsRequest {
    settings: UpdateSettingsInput,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSettingsInput {
    theme: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsResponse {
    settings: ResolvedSettings,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedSettings {
    theme: ThemeId,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MigrateRequest {
    source: String,
    devices: Option<Vec<MigrateDeviceInput>>,
    settings: Option<MigrateSettingsInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MigrateDeviceInput {
    id: Option<String>,
    name: Option<String>,
    base_url: Option<String>,
    last_seen_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MigrateSettingsInput {
    theme: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MigrateResponse {
    migrated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    imported: Option<MigrateImported>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MigrateImported {
    devices: usize,
    settings: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportRequest {
    storage: ImportStorageInput,
    mode: Option<ImportMode>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ImportMode {
    Merge,
    Replace,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportStorageInput {
    schema_version: u8,
    devices: Option<Vec<MigrateDeviceInput>>,
    settings: Option<MigrateSettingsInput>,
    meta: Option<StorageMetaInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageMetaInput {
    migrated_from_localstorage_at: Option<String>,
    last_corrupt_at: Option<String>,
    last_corrupt_reason: Option<String>,
}

#[derive(RustEmbed)]
#[folder = "../dist"]
struct WebDist;

#[tokio::main]
async fn main() {
    if let Err(err) = run().await {
        eprintln!("{err:#}");
        std::process::exit(1);
    }
}

async fn run() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::try_parse().unwrap_or_else(|e| {
        eprintln!("{e}");
        std::process::exit(EXIT_BAD_ARGS);
    });
    let cmd = cli.cmd.clone().unwrap_or(Cmd::Gui);

    match cmd {
        Cmd::Discover { json } => {
            let output = discover_once(json).await;
            match output {
                Ok(()) => Ok(()),
                Err(err) => {
                    eprintln!("{err:#}");
                    std::process::exit(EXIT_DISCOVERY_UNAVAILABLE);
                }
            }
        }
        Cmd::Gui => run_gui(cli).await,
        Cmd::Tray => run_tray(cli).await,
        Cmd::Open => run_open(cli).await,
        Cmd::Serve => run_serve(cli).await,
    }
}

async fn run_open(cli: Cli) -> anyhow::Result<()> {
    let agent = match start_agent_server(cli.port, "open").await {
        Ok(agent) => agent,
        Err(err) => exit_server_failed(err),
    };
    println!("{}/", agent.agent_base_url);
    if !cli.no_open {
        open::that(agent.agent_base_url.as_str()).context("open browser")?;
    }
    tokio::signal::ctrl_c().await?;
    agent.shutdown.cancel();
    Ok(())
}

async fn run_serve(cli: Cli) -> anyhow::Result<()> {
    let agent = match start_agent_server(cli.port, "serve").await {
        Ok(agent) => agent,
        Err(err) => exit_server_failed(err),
    };
    println!("{}/", agent.agent_base_url);
    tokio::signal::ctrl_c().await?;
    agent.shutdown.cancel();
    Ok(())
}

async fn run_gui(cli: Cli) -> anyhow::Result<()> {
    let agent = match start_agent_server(cli.port, "gui").await {
        Ok(agent) => agent,
        Err(err) => exit_server_failed(err),
    };
    let url = agent.agent_base_url.clone();
    tauri::Builder::default()
        .setup(move |app| {
            let url = tauri::WebviewUrl::External(url.clone());
            tauri::WebviewWindowBuilder::new(app, "main", url)
                .title("isolapurr-desktop")
                // Desktop-first defaults: keep a sane viewport and avoid layouts breaking when resized too small.
                .inner_size(1240.0, 820.0)
                .min_inner_size(1100.0, 760.0)
                .build()?;
            Ok(())
        })
        .run(tauri_context())
        .map_err(|e| anyhow!("tauri run: {e:?}"))?;

    agent.shutdown.cancel();
    Ok(())
}

async fn run_tray(cli: Cli) -> anyhow::Result<()> {
    let agent = match start_agent_server(cli.port, "tray").await {
        Ok(agent) => agent,
        Err(err) => exit_server_failed(err),
    };
    let agent_url = agent.agent_base_url.clone();

    tauri::Builder::default()
        .setup(move |app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;

            let handle = app.handle();
            let open_item = MenuItem::new(handle, "Open", true, None::<&str>)?;
            let quit_item = MenuItem::new(handle, "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(handle, &[&open_item, &quit_item])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .title("Iso")
                .tooltip("isolapurr-desktop")
                .on_menu_event(move |_app, event| {
                    if event.id == open_item.id() {
                        let _ = open::that(agent_url.as_str());
                    }
                    if event.id == quit_item.id() {
                        std::process::exit(0);
                    }
                })
                .build(handle)?;

            Ok(())
        })
        .run(tauri_context())
        .map_err(|e| anyhow!("tauri run: {e:?}"))?;

    agent.shutdown.cancel();
    Ok(())
}

async fn discover_once(as_json: bool) -> anyhow::Result<()> {
    let mdns = ServiceDaemon::new().context("mdns daemon")?;
    let receiver = mdns
        .browse("_http._tcp.local.")
        .context("mdns browse _http._tcp.local.")?;
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .context("http client")?;

    let started = std::time::Instant::now();
    let mut devices: HashMap<String, DiscoveredDevice> = HashMap::new();

    while started.elapsed() < std::time::Duration::from_secs(3) {
        let event = receiver.recv_timeout(std::time::Duration::from_millis(200));
        let Ok(event) = event else {
            continue;
        };
        let (host, port, ipv4) = match event {
            ServiceEvent::ServiceResolved(service) => {
                if !service.is_valid() {
                    continue;
                }
                let host = service.get_hostname().trim_end_matches('.').to_string();
                let port = service.get_port();
                let ipv4 = service.get_addresses_v4().into_iter().next();
                (host, port, ipv4)
            }
            _ => continue,
        };

        let now = time::OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());

        let ip = ipv4.map(|v| v.to_string());
        let base = if let Some(ip) = ip.as_deref() {
            if port == 80 {
                format!("http://{ip}")
            } else {
                format!("http://{ip}:{port}")
            }
        } else if port == 80 {
            format!("http://{host}")
        } else {
            format!("http://{host}:{port}")
        };
        let url = format!("{base}/api/v1/info");
        let res = http.get(url).send().await.ok();
        let Some(res) = res else {
            continue;
        };
        if !res.status().is_success() {
            continue;
        }
        let value: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
        let Some(device) = parse_device_from_api_info(&base, value, ip.as_deref(), &now) else {
            continue;
        };
        devices.insert(device_dedup_key(&device), device);
    }

    if as_json {
        println!(
            "{}",
            serde_json::to_string_pretty(
                &serde_json::json!({ "devices": devices.into_values().collect::<Vec<_>>() })
            )
            .unwrap()
        );
    } else {
        for device in devices.into_values() {
            println!("{}", device.base_url);
        }
    }

    Ok(())
}

fn tauri_context() -> tauri::Context<tauri::Wry> {
    // Note: `tauri::generate_context!()` emits a static symbol; invoking it multiple times in the crate
    // causes duplicate symbol errors at link time. Keep it in exactly one place.
    tauri::generate_context!()
}

fn exit_server_failed(err: anyhow::Error) -> ! {
    eprintln!("{err:#}");
    std::process::exit(EXIT_SERVER_FAILED);
}

struct RunningAgent {
    agent_base_url: Url,
    shutdown: CancellationToken,
}

async fn start_agent_server(
    port_override: Option<u16>,
    mode: &'static str,
) -> anyhow::Result<RunningAgent> {
    let token = generate_token();
    let (listener, port) = bind_agent_port(port_override).await?;
    let agent_base_url = Url::parse(&format!("http://127.0.0.1:{port}")).unwrap();

    persist_last_port_if_needed(port_override, port)?;

    let (mdns, mdns_error) = match ServiceDaemon::new() {
        Ok(mdns) => (Some(mdns), None),
        Err(err) => (None, Some(mdns_unavailable_message(&format!("{err}")))),
    };
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .context("http client")?;

    let discovery = Arc::new(DiscoveryController::new(mdns, mdns_error, http));
    let storage = Arc::new(StorageManager::load_or_init()?);

    let state = AppState {
        token: token.clone(),
        agent_base_url: agent_base_url.clone(),
        mode,
        discovery: discovery.clone(),
        storage: storage.clone(),
    };

    discovery.start_mdns_background().await;

    let router = Router::new()
        .route("/api/v1/bootstrap", get(api_bootstrap))
        .route("/api/v1/health", get(api_health))
        .route("/api/v1/discovery/snapshot", get(api_discovery_snapshot))
        .route("/api/v1/discovery/refresh", post(api_discovery_refresh))
        .route("/api/v1/discovery/ip-scan", post(api_discovery_ip_scan))
        .route("/api/v1/discovery/cancel", post(api_discovery_cancel))
        .route(
            "/api/v1/storage/devices",
            get(api_storage_list_devices).post(api_storage_upsert_device),
        )
        .route(
            "/api/v1/storage/devices/:id",
            delete(api_storage_delete_device),
        )
        .route(
            "/api/v1/storage/settings",
            get(api_storage_get_settings).put(api_storage_update_settings),
        )
        .route(
            "/api/v1/storage/migrate/localstorage",
            post(api_storage_migrate_localstorage),
        )
        .route("/api/v1/storage/export", get(api_storage_export))
        .route("/api/v1/storage/import", post(api_storage_import))
        .route("/api/v1/storage/reset", post(api_storage_reset))
        .route("/", get(ui_index))
        .route("/*path", get(ui_asset))
        .with_state(state);

    let shutdown = CancellationToken::new();
    let shutdown_clone = shutdown.clone();
    tokio::spawn(async move {
        let serve = axum::serve(listener, router).with_graceful_shutdown(async move {
            shutdown_clone.cancelled().await;
        });
        if let Err(err) = serve.await {
            tracing::error!("agent server error: {err}");
        }
    });

    Ok(RunningAgent {
        agent_base_url,
        shutdown,
    })
}

fn mdns_unavailable_message(details: &str) -> String {
    let hint = if cfg!(target_os = "windows") {
        "On Windows: ensure your network is set to Private; allow this app through Windows Defender Firewall; disable VPN/virtual adapters."
    } else if cfg!(target_os = "linux") {
        "On Linux: ensure avahi-daemon is running; firewall allows multicast (UDP 5353); disable VPN if needed."
    } else if cfg!(target_os = "macos") {
        "On macOS: ensure local network access is allowed; disable VPN if needed."
    } else {
        "Check firewall/VPN settings."
    };

    let details = details.trim();
    if details.is_empty() {
        format!(
            "mDNS/DNS-SD discovery is unavailable. {hint} You can still use IP scan (advanced) or Manual add."
        )
    } else {
        format!(
            "mDNS/DNS-SD discovery is unavailable ({details}). {hint} You can still use IP scan (advanced) or Manual add."
        )
    }
}

async fn bind_agent_port(port_override: Option<u16>) -> anyhow::Result<(TcpListener, u16)> {
    if let Some(port) = port_override {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let listener = TcpListener::bind(addr)
            .await
            .with_context(|| format!("bind 127.0.0.1:{port}"))?;
        return Ok((listener, port));
    }

    if let Some(saved) = read_last_port().ok().flatten() {
        if let Ok((listener, port)) = try_bind_port(saved).await {
            return Ok((listener, port));
        }
    }

    for port in DEFAULT_PORT_RANGE_START..=DEFAULT_PORT_RANGE_END {
        if let Ok((listener, port)) = try_bind_port(port).await {
            return Ok((listener, port));
        }
    }

    Err(anyhow!(
        "no free port in {DEFAULT_PORT_RANGE_START}-{DEFAULT_PORT_RANGE_END}"
    ))
}

async fn try_bind_port(port: u16) -> anyhow::Result<(TcpListener, u16)> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let listener = TcpListener::bind(addr).await?;
    Ok((listener, port))
}

fn persist_last_port_if_needed(port_override: Option<u16>, port: u16) -> anyhow::Result<()> {
    if port_override.is_some() {
        return Ok(());
    }
    let dirs = project_dirs()?;
    std::fs::create_dir_all(dirs.config_dir()).context("create config dir")?;
    let path = dirs.config_dir().join("last_port");
    std::fs::write(path, port.to_string()).context("write last_port")?;
    Ok(())
}

fn read_last_port() -> anyhow::Result<Option<u16>> {
    let dirs = project_dirs()?;
    let path = dirs.config_dir().join("last_port");
    let raw = std::fs::read_to_string(path);
    let Ok(raw) = raw else {
        return Ok(None);
    };
    let parsed = raw.trim().parse::<u16>().ok();
    Ok(parsed)
}

fn project_dirs() -> anyhow::Result<ProjectDirs> {
    ProjectDirs::from("cc", "isolapurr", "isolapurr-desktop")
        .ok_or_else(|| anyhow!("project dirs unavailable"))
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn storage_path() -> anyhow::Result<PathBuf> {
    let dirs = project_dirs()?;
    std::fs::create_dir_all(dirs.config_dir()).context("create config dir")?;
    Ok(dirs.config_dir().join(STORAGE_FILE_NAME))
}

fn normalize_base_url(raw: &str) -> Result<String, StorageError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(StorageError::BadRequest("Base URL is required".to_string()));
    }
    let url = Url::parse(trimmed)
        .map_err(|_| StorageError::BadRequest("Base URL must be a valid URL".to_string()))?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(StorageError::BadRequest(
            "Base URL must start with http:// or https://".to_string(),
        ));
    }
    Ok(url.origin().ascii_serialization())
}

fn generate_device_id() -> String {
    use rand::{Rng as _, distributions::Alphanumeric};
    let mut rng = rand::thread_rng();
    std::iter::repeat_with(|| rng.sample(Alphanumeric))
        .take(8)
        .map(char::from)
        .collect()
}

impl StorageManager {
    fn load_or_init() -> anyhow::Result<Self> {
        let path = storage_path()?;
        Self::load_at(path)
    }

    fn load_at(path: PathBuf) -> anyhow::Result<Self> {
        let mut storage = DesktopStorage::default();
        let mut should_persist = false;

        match std::fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<DesktopStorage>(&raw) {
                Ok(parsed) => {
                    if parsed.schema_version != STORAGE_SCHEMA_VERSION {
                        let backup =
                            backup_storage_file(&path, "unsupported_schema").unwrap_or(None);
                        storage.meta = Some(StorageMeta {
                            migrated_from_localstorage_at: None,
                            last_corrupt_at: Some(now_rfc3339()),
                            last_corrupt_reason: Some(format!(
                                "unsupported_schema:{}",
                                parsed.schema_version
                            )),
                        });
                        if let Some(backup) = backup {
                            tracing::warn!(
                                path = %path.display(),
                                backup = %backup.display(),
                                "storage schema unsupported; reset to default"
                            );
                        }
                        should_persist = true;
                    } else {
                        storage = parsed;
                    }
                }
                Err(err) => {
                    let backup = backup_storage_file(&path, "corrupt").unwrap_or(None);
                    storage.meta = Some(StorageMeta {
                        migrated_from_localstorage_at: None,
                        last_corrupt_at: Some(now_rfc3339()),
                        last_corrupt_reason: Some("parse_error".to_string()),
                    });
                    if let Some(backup) = backup {
                        tracing::warn!(
                            path = %path.display(),
                            backup = %backup.display(),
                            error = %err,
                            "storage corrupted; reset to default"
                        );
                    } else {
                        tracing::warn!(
                            path = %path.display(),
                            error = %err,
                            "storage corrupted; reset to default"
                        );
                    }
                    should_persist = true;
                }
            },
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => {
                storage.meta = Some(StorageMeta {
                    migrated_from_localstorage_at: None,
                    last_corrupt_at: Some(now_rfc3339()),
                    last_corrupt_reason: Some(format!("io_error:{err}")),
                });
                tracing::warn!(
                    path = %path.display(),
                    error = %err,
                    "storage read failed; using defaults"
                );
                should_persist = true;
            }
        }

        if should_persist {
            if let Err(err) = persist_storage(&path, &storage) {
                tracing::warn!(path = %path.display(), error = %err, "storage init persist failed");
            }
        }

        Ok(Self {
            path,
            inner: RwLock::new(storage),
        })
    }

    async fn list_devices(&self) -> Vec<StoredDevice> {
        let guard = self.inner.read().await;
        guard.devices.clone()
    }

    async fn export(&self) -> DesktopStorage {
        let guard = self.inner.read().await;
        guard.clone()
    }

    async fn get_settings(&self) -> ResolvedSettings {
        let guard = self.inner.read().await;
        ResolvedSettings {
            theme: guard.settings.resolved_theme(),
        }
    }

    async fn upsert_device(&self, input: UpsertDeviceInput) -> Result<StoredDevice, StorageError> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(StorageError::BadRequest("Name is required".to_string()));
        }
        let base_url = normalize_base_url(&input.base_url)?;
        let id = input.id.map(|v| v.trim().to_string());
        if let Some(id) = &id {
            if id.is_empty() {
                return Err(StorageError::BadRequest("ID cannot be blank".to_string()));
            }
        }

        let mut guard = self.inner.write().await;
        let mut conflict = None;
        if let Some(id) = &id {
            let existing_index = guard.devices.iter().position(|d| &d.id == id);
            let base_conflict = guard
                .devices
                .iter()
                .any(|d| d.base_url == base_url && d.id != id.as_str());
            if base_conflict {
                conflict = Some("Base URL already exists".to_string());
            } else if let Some(index) = existing_index {
                guard.devices[index].name = name.to_string();
                guard.devices[index].base_url = base_url.clone();
                let stored = guard.devices[index].clone();
                persist_storage(&self.path, &guard)
                    .map_err(|err| StorageError::Internal(err.to_string()))?;
                return Ok(stored);
            } else if guard.devices.iter().any(|d| d.base_url == base_url) {
                conflict = Some("Base URL already exists".to_string());
            }
        } else if let Some(index) = guard.devices.iter().position(|d| d.base_url == base_url) {
            guard.devices[index].name = name.to_string();
            let stored = guard.devices[index].clone();
            persist_storage(&self.path, &guard)
                .map_err(|err| StorageError::Internal(err.to_string()))?;
            return Ok(stored);
        }

        if let Some(message) = conflict {
            return Err(StorageError::Conflict(message));
        }

        let new_id = id.unwrap_or_else(generate_device_id);
        if guard.devices.iter().any(|d| d.id == new_id) {
            return Err(StorageError::Conflict("ID already exists".to_string()));
        }

        let stored = StoredDevice {
            id: new_id,
            name: name.to_string(),
            base_url,
            last_seen_at: None,
        };
        guard.devices.push(stored.clone());
        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;
        Ok(stored)
    }

    async fn delete_device(&self, device_id: &str) -> Result<(), StorageError> {
        let mut guard = self.inner.write().await;
        let before = guard.devices.len();
        guard.devices.retain(|d| d.id != device_id);
        if guard.devices.len() == before {
            return Err(StorageError::NotFound("device not found".to_string()));
        }
        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;
        Ok(())
    }

    async fn update_settings(&self, theme: ThemeId) -> Result<ResolvedSettings, StorageError> {
        let mut guard = self.inner.write().await;
        guard.settings.theme = Some(theme.clone());
        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;
        Ok(ResolvedSettings { theme })
    }

    async fn migrate_from_localstorage(
        &self,
        request: MigrateRequest,
    ) -> Result<MigrateResponse, StorageError> {
        if request.source != "localStorage" {
            return Err(StorageError::BadRequest(
                "invalid migration source".to_string(),
            ));
        }

        let mut guard = self.inner.write().await;
        let empty = guard.devices.is_empty()
            && guard.settings.resolved_theme() == ThemeId::default()
            && guard
                .meta
                .as_ref()
                .and_then(|meta| meta.migrated_from_localstorage_at.as_ref())
                .is_none();
        if !empty {
            return Ok(MigrateResponse {
                migrated: false,
                imported: None,
                reason: Some("already_initialized".to_string()),
            });
        }

        let mut imported_devices = 0usize;
        if let Some(devices) = request.devices {
            for item in devices {
                let Some(name) = item.name.as_ref() else {
                    continue;
                };
                let Some(base_url_raw) = item.base_url.as_ref() else {
                    continue;
                };
                let id = item.id.as_ref().map(|v| v.trim().to_string());
                let input = UpsertDeviceInput {
                    id,
                    name: name.clone(),
                    base_url: base_url_raw.clone(),
                };
                if self
                    .upsert_device_for_import(&mut guard, input, item.last_seen_at.clone())
                    .is_ok()
                {
                    imported_devices += 1;
                }
            }
        }

        let mut imported_settings = false;
        if let Some(settings) = request.settings {
            if let Some(theme_raw) = settings.theme {
                if let Some(theme) = ThemeId::parse(theme_raw.trim()) {
                    guard.settings.theme = Some(theme);
                    imported_settings = true;
                }
            }
        }

        let last_corrupt_at = guard
            .meta
            .as_ref()
            .and_then(|meta| meta.last_corrupt_at.clone());
        let last_corrupt_reason = guard
            .meta
            .as_ref()
            .and_then(|meta| meta.last_corrupt_reason.clone());

        guard.meta = Some(StorageMeta {
            migrated_from_localstorage_at: Some(now_rfc3339()),
            last_corrupt_at,
            last_corrupt_reason,
        });

        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;

        Ok(MigrateResponse {
            migrated: true,
            imported: Some(MigrateImported {
                devices: imported_devices,
                settings: imported_settings,
            }),
            reason: None,
        })
    }

    async fn reset(&self) -> Result<(), StorageError> {
        let mut guard = self.inner.write().await;
        let last_corrupt_at = guard
            .meta
            .as_ref()
            .and_then(|meta| meta.last_corrupt_at.clone());
        let last_corrupt_reason = guard
            .meta
            .as_ref()
            .and_then(|meta| meta.last_corrupt_reason.clone());
        *guard = DesktopStorage {
            schema_version: STORAGE_SCHEMA_VERSION,
            devices: Vec::new(),
            settings: DesktopSettings::default(),
            meta: if last_corrupt_at.is_some() || last_corrupt_reason.is_some() {
                Some(StorageMeta {
                    migrated_from_localstorage_at: None,
                    last_corrupt_at,
                    last_corrupt_reason,
                })
            } else {
                None
            },
        };
        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;
        Ok(())
    }

    async fn import_storage(
        &self,
        storage: ImportStorageInput,
        mode: ImportMode,
    ) -> Result<(), StorageError> {
        if storage.schema_version != STORAGE_SCHEMA_VERSION {
            return Err(StorageError::BadRequest(
                "unsupported schema_version".to_string(),
            ));
        }

        let mut guard = self.inner.write().await;

        let mut next = if matches!(mode, ImportMode::Replace) {
            DesktopStorage::default()
        } else {
            guard.clone()
        };

        if let Some(devices) = storage.devices {
            for item in devices {
                let Some(name) = item.name.as_ref() else {
                    continue;
                };
                let Some(base_url_raw) = item.base_url.as_ref() else {
                    continue;
                };
                let id = item.id.as_ref().map(|v| v.trim().to_string());
                let input = UpsertDeviceInput {
                    id,
                    name: name.clone(),
                    base_url: base_url_raw.clone(),
                };
                let _ = self.upsert_device_for_import(&mut next, input, None);
            }
        }

        if let Some(settings) = storage.settings {
            if let Some(theme_raw) = settings.theme {
                if let Some(theme) = ThemeId::parse(theme_raw.trim()) {
                    next.settings.theme = Some(theme);
                }
            }
        }

        if let Some(meta) = storage.meta {
            next.meta = Some(StorageMeta {
                migrated_from_localstorage_at: meta.migrated_from_localstorage_at,
                last_corrupt_at: meta.last_corrupt_at,
                last_corrupt_reason: meta.last_corrupt_reason,
            });
        }

        *guard = next;
        persist_storage(&self.path, &guard)
            .map_err(|err| StorageError::Internal(err.to_string()))?;
        Ok(())
    }

    fn upsert_device_for_import(
        &self,
        storage: &mut DesktopStorage,
        input: UpsertDeviceInput,
        last_seen_at: Option<String>,
    ) -> Result<(), StorageError> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(StorageError::BadRequest("Name is required".to_string()));
        }
        let base_url = normalize_base_url(&input.base_url)?;
        let id = input.id.map(|v| v.trim().to_string());
        if let Some(id) = &id {
            if id.is_empty() {
                return Err(StorageError::BadRequest("ID cannot be blank".to_string()));
            }
        }

        if let Some(id) = id {
            let existing_index = storage.devices.iter().position(|d| d.id == id);
            let base_conflict = storage
                .devices
                .iter()
                .any(|d| d.base_url == base_url && d.id != id.as_str());
            if base_conflict {
                return Err(StorageError::Conflict(
                    "Base URL already exists".to_string(),
                ));
            }
            if let Some(index) = existing_index {
                storage.devices[index].name = name.to_string();
                storage.devices[index].base_url = base_url;
                if let Some(last_seen_at) = last_seen_at.clone() {
                    if !last_seen_at.trim().is_empty() {
                        storage.devices[index].last_seen_at = Some(last_seen_at);
                    }
                }
                return Ok(());
            }
            if storage.devices.iter().any(|d| d.base_url == base_url) {
                return Err(StorageError::Conflict(
                    "Base URL already exists".to_string(),
                ));
            }
            storage.devices.push(StoredDevice {
                id,
                name: name.to_string(),
                base_url,
                last_seen_at: last_seen_at.filter(|value| !value.trim().is_empty()),
            });
            return Ok(());
        }

        if let Some(existing) = storage.devices.iter_mut().find(|d| d.base_url == base_url) {
            existing.name = name.to_string();
            if let Some(last_seen_at) = last_seen_at.clone() {
                if !last_seen_at.trim().is_empty() {
                    existing.last_seen_at = Some(last_seen_at);
                }
            }
            return Ok(());
        }

        storage.devices.push(StoredDevice {
            id: generate_device_id(),
            name: name.to_string(),
            base_url,
            last_seen_at: last_seen_at.filter(|value| !value.trim().is_empty()),
        });
        Ok(())
    }
}

fn backup_storage_file(path: &PathBuf, reason: &str) -> anyhow::Result<Option<PathBuf>> {
    if !path.exists() {
        return Ok(None);
    }
    let timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
    let file_name = format!("storage.{reason}.{timestamp}.json");
    let backup = path
        .parent()
        .map(|dir| dir.join(&file_name))
        .unwrap_or_else(|| PathBuf::from(file_name.clone()));
    std::fs::rename(path, &backup).context("backup storage file")?;
    Ok(Some(backup))
}

fn persist_storage(path: &PathBuf, storage: &DesktopStorage) -> anyhow::Result<()> {
    let json = serde_json::to_vec_pretty(storage).context("encode storage")?;
    let tmp_path = PathBuf::from(format!("{}.tmp", path.display()));
    std::fs::write(&tmp_path, json).context("write storage tmp")?;
    if let Err(err) = std::fs::rename(&tmp_path, path) {
        if err.kind() == std::io::ErrorKind::AlreadyExists || cfg!(target_os = "windows") {
            let _ = std::fs::remove_file(path);
            std::fs::rename(&tmp_path, path).context("rename storage tmp")?;
        } else {
            return Err(err).context("rename storage tmp");
        }
    }
    Ok(())
}

fn generate_token() -> String {
    use rand::{Rng as _, distributions::Alphanumeric};
    let mut rng = rand::thread_rng();
    std::iter::repeat_with(|| rng.sample(Alphanumeric))
        .take(32)
        .map(char::from)
        .collect()
}

fn is_authorized(headers: &HeaderMap, state: &AppState) -> bool {
    let Some(auth) = headers.get(header::AUTHORIZATION) else {
        return false;
    };
    let Ok(auth) = auth.to_str() else {
        return false;
    };
    let expected = format!("Bearer {}", state.token);
    auth == expected
}

fn is_origin_allowed(headers: &HeaderMap, port: u16) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let Ok(url) = Url::parse(origin) else {
        return false;
    };
    let host = url.host_str().unwrap_or_default();
    let allowed_host = host == "127.0.0.1" || host == "localhost" || host == "::1";
    allowed_host && url.port() == Some(port)
}

fn unauthorized(message: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "unauthorized",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}

fn forbidden(message: &str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "forbidden",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}

fn bad_request(message: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "bad_request",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}

fn conflict(message: &str) -> Response {
    (
        StatusCode::CONFLICT,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "conflict",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}

fn not_found(message: &str) -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "not_found",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}

fn internal_error(message: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "internal_error",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}

async fn api_bootstrap(State(state): State<AppState>) -> impl IntoResponse {
    let port = state
        .agent_base_url
        .port()
        .unwrap_or(DEFAULT_PORT_RANGE_START);
    let res = BootstrapResponse {
        token: state.token.clone(),
        agent_base_url: format!("http://127.0.0.1:{port}"),
        app: BootstrapApp {
            name: "isolapurr-desktop",
            version: env!("CARGO_PKG_VERSION"),
            mode: state.mode,
        },
    };

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    (headers, Json(res))
}

async fn api_health(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

async fn api_discovery_snapshot(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let snapshot = state.discovery.snapshot().await;
    Json(snapshot).into_response()
}

async fn api_discovery_refresh(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    if let Err(err) = state.discovery.refresh_services().await {
        tracing::warn!("refresh: {err:#}");
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorEnvelope {
                error: ErrorInfo {
                    code: "temporarily_unavailable",
                    message: err.to_string(),
                    retryable: true,
                },
            }),
        )
            .into_response();
    }
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "accepted": true })),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
struct IpScanRequest {
    cidr: String,
}

async fn api_discovery_ip_scan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<IpScanRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    if let Err(err) = state.discovery.start_ip_scan(req.cidr).await {
        tracing::warn!("ip scan: {err:#}");
        return bad_request(&err.to_string());
    }
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "accepted": true })),
    )
        .into_response()
}

async fn api_discovery_cancel(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    state.discovery.cancel_ip_scan().await;
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "accepted": true })),
    )
        .into_response()
}

async fn api_storage_list_devices(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let devices = state.storage.list_devices().await;
    Json(DevicesResponse { devices }).into_response()
}

async fn api_storage_upsert_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UpsertDeviceRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    match state.storage.upsert_device(req.device).await {
        Ok(device) => Json(UpsertDeviceResponse { device }).into_response(),
        Err(err) => err.response(),
    }
}

async fn api_storage_delete_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(device_id): Path<String>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    match state.storage.delete_device(device_id.trim()).await {
        Ok(()) => Json(serde_json::json!({ "deleted": true })).into_response(),
        Err(err) => err.response(),
    }
}

async fn api_storage_get_settings(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let settings = state.storage.get_settings().await;
    Json(SettingsResponse { settings }).into_response()
}

async fn api_storage_update_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UpdateSettingsRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let theme = match ThemeId::parse(req.settings.theme.trim()) {
        Some(theme) => theme,
        None => {
            return bad_request("invalid theme");
        }
    };
    match state.storage.update_settings(theme).await {
        Ok(settings) => Json(SettingsResponse { settings }).into_response(),
        Err(err) => err.response(),
    }
}

async fn api_storage_migrate_localstorage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<MigrateRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    match state.storage.migrate_from_localstorage(req).await {
        Ok(response) => Json(response).into_response(),
        Err(err) => err.response(),
    }
}

async fn api_storage_export(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let storage = state.storage.export().await;
    Json(storage).into_response()
}

async fn api_storage_import(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ImportRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let mode = req.mode.unwrap_or(ImportMode::Merge);
    match state.storage.import_storage(req.storage, mode).await {
        Ok(()) => Json(serde_json::json!({ "imported": true })).into_response(),
        Err(err) => err.response(),
    }
}

async fn api_storage_reset(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    match state.storage.reset().await {
        Ok(()) => Json(serde_json::json!({ "reset": true })).into_response(),
        Err(err) => err.response(),
    }
}

async fn ui_index() -> Response {
    ui_asset(Path("index.html".to_string())).await
}

async fn ui_asset(Path(path): Path<String>) -> Response {
    // Serve SPA assets; fall back to index.html for client-side routing.
    let path = path.trim_start_matches('/').to_string();
    let asset = WebDist::get(&path).or_else(|| WebDist::get("index.html"));
    let Some(asset) = asset else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let body = asset.data;
    let mime = mime_guess::from_path(&path).first_or_octet_stream();
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.essence_str()).unwrap(),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    (headers, body).into_response()
}

impl DiscoveryController {
    fn new(mdns: Option<ServiceDaemon>, mdns_error: Option<String>, http: reqwest::Client) -> Self {
        let mdns_unavailable = mdns.is_none();
        let error = if mdns_unavailable {
            Some(
                mdns_error
                    .clone()
                    .unwrap_or_else(|| mdns_unavailable_message("mdns unavailable")),
            )
        } else {
            mdns_error.clone()
        };

        Self {
            snapshot: RwLock::new(DiscoverySnapshot {
                mode: DiscoveryMode::Service,
                status: if mdns.is_some() {
                    DiscoveryStatus::Scanning
                } else {
                    DiscoveryStatus::Unavailable
                },
                devices: Vec::new(),
                error,
                scan: None,
            }),
            ip_scan_cancel: RwLock::new(CancellationToken::new()),
            mdns,
            mdns_error,
            mdns_unavailable: AtomicBool::new(mdns_unavailable),
            http,
        }
    }

    async fn start_mdns_background(self: &Arc<Self>) {
        let Some(mdns) = self.mdns.as_ref() else {
            return;
        };

        let receiver = match mdns.browse("_http._tcp.local.") {
            Ok(receiver) => receiver,
            Err(err) => {
                let message = mdns_unavailable_message(&format!("browse failed: {err}"));
                let mut snapshot = self.snapshot.write().await;
                snapshot.mode = DiscoveryMode::Service;
                snapshot.status = DiscoveryStatus::Unavailable;
                snapshot.error = Some(message);
                self.mdns_unavailable.store(true, Ordering::Relaxed);
                return;
            }
        };

        let this = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                let event = receiver.recv_async().await;
                let Ok(event) = event else {
                    break;
                };
                if let Err(err) = this.handle_mdns_event(event).await {
                    tracing::debug!("mdns event: {err:#}");
                }
            }
        });
    }

    async fn handle_mdns_event(&self, event: ServiceEvent) -> anyhow::Result<()> {
        let resolved = match event {
            ServiceEvent::ServiceResolved(service) => {
                if !service.is_valid() {
                    return Ok(());
                }
                let host = service.get_hostname().trim_end_matches('.').to_string();
                let port = service.get_port();
                let ipv4 = service.get_addresses_v4().into_iter().next();
                ResolvedService {
                    hostname: host,
                    port,
                    ipv4,
                }
            }
            _ => return Ok(()),
        };

        self.handle_resolved(resolved).await
    }

    async fn handle_resolved(&self, resolved: ResolvedService) -> anyhow::Result<()> {
        let now = time::OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());
        let ip = resolved.ipv4.map(|v| v.to_string());
        // Prefer verifying via IPv4 (works even when the OS resolver can't resolve `.local`).
        let candidate_base = if let Some(ip) = ip.as_deref() {
            if resolved.port == 80 {
                format!("http://{ip}")
            } else {
                format!("http://{ip}:{}", resolved.port)
            }
        } else if resolved.port == 80 {
            format!("http://{}", resolved.hostname.as_str())
        } else {
            format!("http://{}:{}", resolved.hostname.as_str(), resolved.port)
        };

        tracing::debug!(
            hostname = resolved.hostname.as_str(),
            port = resolved.port,
            ipv4 = ?resolved.ipv4,
            base_url = candidate_base.as_str(),
            "discovery candidate resolved"
        );

        if let Some(device) = self
            .validate_device(&candidate_base, ip.as_deref(), &now)
            .await?
        {
            self.merge_device(device).await;
        }

        Ok(())
    }

    async fn validate_device(
        &self,
        base_url: &str,
        scanned_ipv4: Option<&str>,
        now_rfc3339: &str,
    ) -> anyhow::Result<Option<DiscoveredDevice>> {
        let url = format!("{base_url}/api/v1/info");
        let res = match self.http.get(&url).send().await {
            Ok(res) => res,
            Err(err) => {
                tracing::debug!(
                    base_url,
                    error = %err,
                    "discovery candidate request failed"
                );
                return Ok(None);
            }
        };
        if !res.status().is_success() {
            tracing::debug!(
                base_url,
                status = %res.status(),
                "discovery candidate rejected (non-2xx)"
            );
            return Ok(None);
        }
        let value: serde_json::Value = match res.json().await {
            Ok(value) => value,
            Err(err) => {
                tracing::debug!(
                    base_url,
                    error = %err,
                    "discovery candidate rejected (invalid json)"
                );
                return Ok(None);
            }
        };
        let Some(device) = parse_device_from_api_info(base_url, value, scanned_ipv4, now_rfc3339)
        else {
            tracing::debug!(
                base_url,
                "discovery candidate rejected (schema/firmware mismatch)"
            );
            return Ok(None);
        };
        tracing::debug!(
            base_url,
            device_id = ?device.device_id,
            "discovery candidate accepted"
        );
        Ok(Some(device))
    }

    async fn merge_device(&self, device: DiscoveredDevice) {
        let mut snapshot = self.snapshot.write().await;
        snapshot.error = None;

        let key = device_dedup_key(&device);
        let mut map: HashMap<String, DiscoveredDevice> = snapshot
            .devices
            .drain(..)
            .map(|d| (device_dedup_key(&d), d))
            .collect();
        let merged = if let Some(existing) = map.remove(&key) {
            DiscoveredDevice {
                base_url: device.base_url,
                device_id: device.device_id.or(existing.device_id),
                hostname: device.hostname.or(existing.hostname),
                fqdn: device.fqdn.or(existing.fqdn),
                ipv4: device.ipv4.or(existing.ipv4),
                variant: device.variant.or(existing.variant),
                firmware: device.firmware.or(existing.firmware),
                last_seen_at: device.last_seen_at.or(existing.last_seen_at),
            }
        } else {
            device
        };
        map.insert(key, merged);
        snapshot.devices = map.into_values().collect();
        snapshot.status = DiscoveryStatus::Ready;
    }

    async fn snapshot(&self) -> DiscoverySnapshot {
        self.snapshot.read().await.clone()
    }

    async fn refresh_services(&self) -> anyhow::Result<()> {
        if self.mdns.is_none() || self.mdns_unavailable.load(Ordering::Relaxed) {
            let message = self
                .mdns_error
                .clone()
                .unwrap_or_else(|| mdns_unavailable_message("mdns unavailable"));
            let mut snapshot = self.snapshot.write().await;
            snapshot.mode = DiscoveryMode::Service;
            snapshot.status = DiscoveryStatus::Unavailable;
            snapshot.error = Some(message);
            snapshot.scan = None;
            return Err(anyhow!("mdns unavailable"));
        }

        let mut snapshot = self.snapshot.write().await;
        snapshot.mode = DiscoveryMode::Service;
        snapshot.status = DiscoveryStatus::Scanning;
        snapshot.error = None;
        snapshot.scan = None;
        Ok(())
    }

    async fn start_ip_scan(self: &Arc<Self>, cidr: String) -> anyhow::Result<()> {
        let net: ipnet::Ipv4Net = cidr.parse().context("invalid cidr")?;
        let hosts: Vec<Ipv4Addr> = net.hosts().collect();
        if hosts.is_empty() {
            return Err(anyhow!("empty cidr"));
        }

        self.cancel_ip_scan().await;
        let cancel = CancellationToken::new();
        *self.ip_scan_cancel.write().await = cancel.clone();

        {
            let mut snapshot = self.snapshot.write().await;
            snapshot.mode = DiscoveryMode::Scan;
            snapshot.status = DiscoveryStatus::Scanning;
            snapshot.devices.clear();
            snapshot.error = None;
            snapshot.scan = Some(ScanState {
                cidr: cidr.clone(),
                done: 0,
                total: hosts.len().try_into().unwrap_or(u32::MAX),
            });
        }

        let http = self.http.clone();
        let this = Arc::clone(self);
        let now_base = time::OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());

        let max_concurrency = 24usize;
        tokio::spawn(async move {
            let mut done: u32 = 0;
            let stream = stream::iter(hosts.into_iter().map(|ip| ip.to_string()))
                .map(|ip| {
                    let http = http.clone();
                    let cancel = cancel.clone();
                    let now_base = now_base.clone();
                    async move {
                        if cancel.is_cancelled() {
                            return None;
                        }
                        let base = format!("http://{ip}");
                        let url = format!("{base}/api/v1/info");
                        let res = http.get(url).send().await.ok()?;
                        if !res.status().is_success() {
                            return None;
                        }
                        let value: serde_json::Value = res.json().await.ok()?;
                        parse_device_from_api_info(&base, value, Some(&ip), &now_base)
                    }
                })
                .buffer_unordered(max_concurrency);

            tokio::pin!(stream);
            while let Some(item) = stream.next().await {
                if cancel.is_cancelled() {
                    break;
                }
                done += 1;
                {
                    let mut snapshot = this.snapshot.write().await;
                    if let Some(scan) = snapshot.scan.as_mut() {
                        scan.done = done;
                    }
                }
                if let Some(device) = item {
                    this.merge_device(device).await;
                }
            }

            let mut snapshot = this.snapshot.write().await;
            snapshot.status = if cancel.is_cancelled() {
                DiscoveryStatus::Idle
            } else {
                DiscoveryStatus::Ready
            };
        });

        Ok(())
    }

    async fn cancel_ip_scan(&self) {
        self.ip_scan_cancel.read().await.cancel();
        let mut snapshot = self.snapshot.write().await;
        snapshot.status = DiscoveryStatus::Idle;
        snapshot.scan = None;
    }
}

fn device_dedup_key(device: &DiscoveredDevice) -> String {
    if let Some(id) = device.device_id.as_deref() {
        let id = id.trim();
        if !id.is_empty() {
            return format!("id:{id}");
        }
    }
    format!("url:{}", device.base_url.trim())
}

#[derive(Debug, Deserialize)]
struct ApiInfoEnvelope {
    device: ApiDeviceInfo,
}

#[derive(Debug, Deserialize)]
struct ApiDeviceInfo {
    device_id: Option<String>,
    hostname: Option<String>,
    fqdn: Option<String>,
    variant: Option<String>,
    firmware: Option<ApiFirmware>,
    wifi: Option<ApiWifi>,
}

#[derive(Debug, Deserialize)]
struct ApiFirmware {
    name: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ApiWifi {
    ipv4: Option<String>,
}

fn parse_device_from_api_info(
    base_url_by_ip_or_host: &str,
    value: serde_json::Value,
    scanned_ipv4: Option<&str>,
    now_rfc3339: &str,
) -> Option<DiscoveredDevice> {
    let env: ApiInfoEnvelope = serde_json::from_value(value).ok()?;

    let fw_name = env
        .device
        .firmware
        .as_ref()?
        .name
        .as_ref()?
        .trim()
        .to_string();
    if fw_name != "isolapurr-usb-hub" {
        return None;
    }
    let fw_version = env
        .device
        .firmware
        .as_ref()?
        .version
        .clone()
        .unwrap_or_else(|| "unknown".to_string());

    let fqdn = env.device.fqdn.as_ref().and_then(|s| {
        let s = s.trim();
        if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        }
    });

    // Always prefer the base URL we actually used to validate the device (IP or resolvable hostname).
    // `.local` name resolution can be broken on some systems; using IPv4 keeps the UX reliable.
    let preferred_base_url = base_url_by_ip_or_host.to_string();

    Some(DiscoveredDevice {
        base_url: preferred_base_url,
        device_id: env.device.device_id,
        hostname: env.device.hostname,
        fqdn,
        ipv4: env
            .device
            .wifi
            .and_then(|w| w.ipv4)
            .or_else(|| scanned_ipv4.map(|s| s.to_string())),
        variant: env.device.variant,
        firmware: Some(FirmwareInfo {
            name: fw_name,
            version: fw_version,
        }),
        last_seen_at: Some(now_rfc3339.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Json, Router,
        response::{IntoResponse, Response},
        routing::get,
    };
    use http_body_util::BodyExt;
    use std::{
        env, fs,
        path::PathBuf,
        sync::{Arc, Once},
        time::Duration,
    };
    use tokio::net::TcpListener;

    #[derive(Clone, Debug)]
    enum InfoResponse {
        Valid { device_id: Option<String> },
        WrongFirmware,
        InvalidJson,
        Status(StatusCode),
    }

    struct TestServer {
        base_url: String,
        ipv4: Ipv4Addr,
        port: u16,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for TestServer {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    fn init_tracing() {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            let _ = tracing_subscriber::fmt()
                .with_env_filter(tracing_subscriber::EnvFilter::new("debug"))
                .with_test_writer()
                .try_init();
        });
    }

    async fn spawn_info_server(response: InfoResponse) -> TestServer {
        let response = Arc::new(response);
        let app = Router::new().route(
            "/api/v1/info",
            get({
                let response = Arc::clone(&response);
                move || async move { info_response(&response).into_response() }
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test listener");
        let addr = listener.local_addr().expect("listener addr");
        let task = tokio::spawn(async move {
            if let Err(err) = axum::serve(listener, app).await {
                eprintln!("test server error: {err}");
            }
        });

        TestServer {
            base_url: format!("http://127.0.0.1:{}", addr.port()),
            ipv4: Ipv4Addr::LOCALHOST,
            port: addr.port(),
            task,
        }
    }

    fn info_response(response: &InfoResponse) -> Response {
        match response {
            InfoResponse::Valid { device_id } => {
                let body = serde_json::json!({
                    "device": {
                        "device_id": device_id,
                        "hostname": "isolapurr-test",
                        "fqdn": "isolapurr-test.local",
                        "variant": "test",
                        "firmware": {
                            "name": "isolapurr-usb-hub",
                            "version": "0.0.0-test"
                        },
                        "wifi": { "ipv4": "127.0.0.1" }
                    }
                });
                (StatusCode::OK, Json(body)).into_response()
            }
            InfoResponse::WrongFirmware => {
                let body = serde_json::json!({
                    "device": {
                        "firmware": { "name": "not-isolapurr", "version": "0.0.0-test" }
                    }
                });
                (StatusCode::OK, Json(body)).into_response()
            }
            InfoResponse::InvalidJson => (StatusCode::OK, "not-json").into_response(),
            InfoResponse::Status(code) => (*code, "error").into_response(),
        }
    }

    fn make_controller(timeout_ms: u64, mdns_error: Option<String>) -> DiscoveryController {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .build()
            .expect("http client");
        DiscoveryController::new(None, mdns_error, http)
    }

    fn resolved_for(server: &TestServer) -> ResolvedService {
        ResolvedService {
            hostname: "isolapurr-test".to_string(),
            port: server.port,
            ipv4: Some(server.ipv4),
        }
    }

    #[tokio::test]
    async fn discovery_accepts_valid_device() {
        init_tracing();
        let server = spawn_info_server(InfoResponse::Valid {
            device_id: Some("dev-1".to_string()),
        })
        .await;
        let controller = make_controller(400, Some("mdns unavailable".to_string()));
        controller
            .handle_resolved(resolved_for(&server))
            .await
            .expect("handle resolved");

        let snapshot = controller.snapshot().await;
        assert_eq!(
            snapshot.devices.len(),
            1,
            "expected 1 device, got {:?}",
            snapshot.devices
        );
        let device = snapshot.devices.first().expect("device entry");
        assert_eq!(device.device_id.as_deref(), Some("dev-1"));
        assert_eq!(device.base_url, server.base_url);
        assert_eq!(snapshot.status, DiscoveryStatus::Ready);
    }

    #[tokio::test]
    async fn discovery_filters_non_device() {
        init_tracing();
        let server = spawn_info_server(InfoResponse::WrongFirmware).await;
        let controller = make_controller(300, Some("mdns unavailable".to_string()));
        controller
            .handle_resolved(resolved_for(&server))
            .await
            .expect("handle resolved");

        let snapshot = controller.snapshot().await;
        assert!(
            snapshot.devices.is_empty(),
            "expected filtered device, got {:?}",
            snapshot.devices
        );
    }

    #[tokio::test]
    async fn discovery_filters_invalid_json_and_non_2xx() {
        init_tracing();
        let controller = make_controller(300, Some("mdns unavailable".to_string()));

        let bad_json = spawn_info_server(InfoResponse::InvalidJson).await;
        controller
            .handle_resolved(resolved_for(&bad_json))
            .await
            .expect("handle resolved bad json");

        let bad_status = spawn_info_server(InfoResponse::Status(StatusCode::BAD_GATEWAY)).await;
        controller
            .handle_resolved(resolved_for(&bad_status))
            .await
            .expect("handle resolved bad status");

        let snapshot = controller.snapshot().await;
        assert!(
            snapshot.devices.is_empty(),
            "expected no devices after invalid responses, got {:?}",
            snapshot.devices
        );
    }

    #[tokio::test]
    async fn discovery_dedups_by_device_id() {
        init_tracing();
        let server_a = spawn_info_server(InfoResponse::Valid {
            device_id: Some("dev-1".to_string()),
        })
        .await;
        let server_b = spawn_info_server(InfoResponse::Valid {
            device_id: Some("dev-1".to_string()),
        })
        .await;
        let controller = make_controller(400, Some("mdns unavailable".to_string()));

        controller
            .handle_resolved(resolved_for(&server_a))
            .await
            .expect("handle resolved a");
        controller
            .handle_resolved(resolved_for(&server_b))
            .await
            .expect("handle resolved b");

        let snapshot = controller.snapshot().await;
        assert_eq!(
            snapshot.devices.len(),
            1,
            "expected 1 device after dedup, got {:?}",
            snapshot.devices
        );
        let device = snapshot.devices.first().expect("device entry");
        assert_eq!(device.device_id.as_deref(), Some("dev-1"));
        assert_eq!(
            device.base_url, server_b.base_url,
            "expected latest base_url to win"
        );
        assert!(
            device
                .last_seen_at
                .as_ref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false),
            "expected last_seen_at to be set"
        );
    }

    #[tokio::test]
    async fn discovery_unreachable_candidate_times_out() {
        init_tracing();
        let controller = make_controller(200, Some("mdns unavailable".to_string()));
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind unused port");
            let port = listener.local_addr().expect("listener addr").port();
            drop(listener);
            port
        };
        let resolved = ResolvedService {
            hostname: "isolapurr-unused".to_string(),
            port,
            ipv4: Some(Ipv4Addr::LOCALHOST),
        };

        let result = tokio::time::timeout(
            Duration::from_millis(600),
            controller.handle_resolved(resolved),
        )
        .await;
        assert!(result.is_ok(), "handle_resolved timed out");

        let snapshot = controller.snapshot().await;
        assert!(
            snapshot.devices.is_empty(),
            "expected no devices after timeout, got {:?}",
            snapshot.devices
        );
    }

    #[tokio::test]
    async fn discovery_reports_mdns_unavailable() {
        init_tracing();
        let controller = make_controller(200, Some("mdns unavailable".to_string()));
        let snapshot = controller.snapshot().await;
        assert_eq!(snapshot.status, DiscoveryStatus::Unavailable);
        assert!(
            snapshot
                .error
                .as_ref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false),
            "expected non-empty error message"
        );

        let result = controller.refresh_services().await;
        assert!(result.is_err(), "expected refresh to fail");
        let snapshot = controller.snapshot().await;
        assert_eq!(snapshot.status, DiscoveryStatus::Unavailable);
    }

    fn temp_storage_path(label: &str) -> PathBuf {
        let mut dir = env::temp_dir();
        let suffix = generate_device_id();
        dir.push(format!("isolapurr-storage-{label}-{suffix}"));
        let _ = fs::create_dir_all(&dir);
        dir.join("storage.json")
    }

    #[tokio::test]
    async fn storage_roundtrip_devices() {
        let path = temp_storage_path("roundtrip");
        let manager = StorageManager::load_at(path.clone()).expect("load storage");
        let device = manager
            .upsert_device(UpsertDeviceInput {
                id: Some("dev-1".to_string()),
                name: "Desk Hub".to_string(),
                base_url: "http://127.0.0.1:1234".to_string(),
            })
            .await
            .expect("upsert");
        let list = manager.list_devices().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, device.id);

        let manager = StorageManager::load_at(path).expect("reload storage");
        let list = manager.list_devices().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].base_url, "http://127.0.0.1:1234");
    }

    #[tokio::test]
    async fn storage_recovers_from_corrupt_file() {
        let path = temp_storage_path("corrupt");
        fs::write(&path, "not-json").expect("write corrupt");
        let manager = StorageManager::load_at(path.clone()).expect("load storage");
        let exported = manager.export().await;
        assert!(exported.devices.is_empty());
        assert!(
            exported
                .meta
                .as_ref()
                .and_then(|meta| meta.last_corrupt_at.as_ref())
                .is_some(),
            "expected last_corrupt_at metadata"
        );
        assert!(path.exists(), "storage should be recreated");
        let parent = path.parent().expect("parent dir");
        let mut found_backup = false;
        for entry in fs::read_dir(parent).expect("read dir") {
            let entry = entry.expect("dir entry");
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with("storage.corrupt.") {
                    found_backup = true;
                    break;
                }
            }
        }
        assert!(found_backup, "expected corrupt backup file");
    }

    #[tokio::test]
    async fn storage_migrates_once() {
        let path = temp_storage_path("migrate");
        let manager = StorageManager::load_at(path).expect("load storage");
        let res = manager
            .migrate_from_localstorage(MigrateRequest {
                source: "localStorage".to_string(),
                devices: Some(vec![MigrateDeviceInput {
                    id: Some("demo".to_string()),
                    name: Some("Demo".to_string()),
                    base_url: Some("http://127.0.0.1:8080".to_string()),
                    last_seen_at: None,
                }]),
                settings: Some(MigrateSettingsInput {
                    theme: Some("system".to_string()),
                }),
            })
            .await
            .expect("migrate");
        assert!(res.migrated);

        let res = manager
            .migrate_from_localstorage(MigrateRequest {
                source: "localStorage".to_string(),
                devices: None,
                settings: None,
            })
            .await
            .expect("migrate");
        assert!(!res.migrated);
        assert_eq!(res.reason.as_deref(), Some("already_initialized"));
    }

    #[tokio::test]
    async fn storage_handler_lists_devices() {
        let path = temp_storage_path("handler");
        let manager = StorageManager::load_at(path).expect("load storage");
        manager
            .upsert_device(UpsertDeviceInput {
                id: Some("dev-1".to_string()),
                name: "Desk Hub".to_string(),
                base_url: "http://127.0.0.1:1234".to_string(),
            })
            .await
            .expect("upsert");
        let state = AppState {
            token: "token".to_string(),
            agent_base_url: Url::parse("http://127.0.0.1:1234").unwrap(),
            mode: "test",
            discovery: Arc::new(make_controller(200, None)),
            storage: Arc::new(manager),
        };

        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str("Bearer token").unwrap(),
        );
        let response = api_storage_list_devices(State(state), headers).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let parsed: DevicesResponse = serde_json::from_slice(&body).expect("parse response");
        assert_eq!(parsed.devices.len(), 1);
        assert_eq!(parsed.devices[0].id, "dev-1");
    }
}
