use std::{
    collections::HashMap,
    net::{Ipv4Addr, SocketAddr},
    sync::Arc,
};

use anyhow::{Context as _, anyhow};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
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
}

struct DiscoveryController {
    snapshot: RwLock<DiscoverySnapshot>,
    ip_scan_cancel: RwLock<CancellationToken>,
    mdns: Option<ServiceDaemon>,
    mdns_error: Option<String>,
    http: reqwest::Client,
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

    let state = AppState {
        token: token.clone(),
        agent_base_url: agent_base_url.clone(),
        mode,
        discovery: discovery.clone(),
    };

    discovery.start_mdns_background().await;

    let router = Router::new()
        .route("/api/v1/bootstrap", get(api_bootstrap))
        .route("/api/v1/health", get(api_health))
        .route("/api/v1/discovery/snapshot", get(api_discovery_snapshot))
        .route("/api/v1/discovery/refresh", post(api_discovery_refresh))
        .route("/api/v1/discovery/ip-scan", post(api_discovery_ip_scan))
        .route("/api/v1/discovery/cancel", post(api_discovery_cancel))
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
        Self {
            snapshot: RwLock::new(DiscoverySnapshot {
                mode: DiscoveryMode::Service,
                status: if mdns.is_some() {
                    DiscoveryStatus::Scanning
                } else {
                    DiscoveryStatus::Idle
                },
                devices: Vec::new(),
                error: mdns_error.clone(),
                scan: None,
            }),
            ip_scan_cancel: RwLock::new(CancellationToken::new()),
            mdns,
            mdns_error,
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
                snapshot.status = DiscoveryStatus::Idle;
                snapshot.error = Some(message);
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
        let (host, port, ipv4) = match event {
            ServiceEvent::ServiceResolved(service) => {
                if !service.is_valid() {
                    return Ok(());
                }
                let host = service.get_hostname().trim_end_matches('.').to_string();
                let port = service.get_port();
                let ipv4 = service.get_addresses_v4().into_iter().next();
                (host, port, ipv4)
            }
            _ => return Ok(()),
        };

        let now = time::OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());

        let ip = ipv4.map(|v| v.to_string());
        // Prefer verifying via IPv4 (works even when the OS resolver can't resolve `.local`).
        let candidate_base = if let Some(ip) = ip.as_deref() {
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
        let res = self.http.get(url).send().await;
        let Ok(res) = res else {
            return Ok(None);
        };
        if !res.status().is_success() {
            return Ok(None);
        }
        let value: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
        let Some(device) = parse_device_from_api_info(base_url, value, scanned_ipv4, now_rfc3339)
        else {
            return Ok(None);
        };
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
        if self.mdns.is_none() {
            let message = self
                .mdns_error
                .clone()
                .unwrap_or_else(|| mdns_unavailable_message("mdns unavailable"));
            let mut snapshot = self.snapshot.write().await;
            snapshot.mode = DiscoveryMode::Service;
            snapshot.status = DiscoveryStatus::Idle;
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
