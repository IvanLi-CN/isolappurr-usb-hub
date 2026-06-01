use anyhow::{Context as _, anyhow};
use clap::{ArgAction, Parser, Subcommand, ValueEnum};
use isolapurr_host::{
    DeviceIdentity, DeviceProfile, FirmwareCatalog, HardwareTransport, SavedHardwareInput, api_url,
    default_ipc_endpoint, ipc_call, read_hardware_registry, redact_sensitive, registry_path,
    save_hardware,
};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    io::IsTerminal as _,
    path::PathBuf,
    process::{Command as ProcessCommand, Stdio},
    time::{Duration, Instant},
};

#[derive(Debug, Parser)]
#[command(name = "isolapurr", version, about = "IsolaPurr CLI")]
struct Cli {
    #[arg(long, global = true, default_value_t = default_ipc_endpoint())]
    ipc: String,
    #[arg(long, global = true)]
    no_auto_start: bool,
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Discover {
        #[arg(long)]
        scan: bool,
    },
    Devices,
    Status(ApiSelectorArgs),
    Hardware {
        #[command(subcommand)]
        command: HardwareCommand,
    },
    Wifi {
        #[command(subcommand)]
        command: WifiCommand,
    },
    Ports {
        #[command(flatten)]
        selector: ApiSelectorArgs,
        #[command(subcommand)]
        command: Option<PortsCommand>,
    },
    Flash(FlashArgs),
    Reset(UsbSelectorArgs),
    Monitor {
        #[command(flatten)]
        selector: UsbSelectorArgs,
        #[arg(long, default_value_t = 200)]
        tail: usize,
    },
    Diagnostics {
        #[command(subcommand)]
        command: DiagnosticsCommand,
    },
}

#[derive(Debug, clap::Args, Clone)]
struct ApiSelectorArgs {
    #[arg(long)]
    hardware: Option<String>,
    #[arg(long)]
    device: Option<String>,
    #[arg(long)]
    url: Option<String>,
}

#[derive(Debug, clap::Args, Clone)]
struct UsbSelectorArgs {
    #[arg(long)]
    hardware: Option<String>,
    #[arg(long)]
    device: Option<String>,
}

#[derive(Debug, Subcommand)]
enum HardwareCommand {
    Available {
        #[arg(long)]
        scan: bool,
    },
    Recent,
    List,
    Path,
    Save {
        #[arg(long)]
        id: String,
        #[arg(long)]
        name: String,
        #[arg(long, value_enum)]
        transport: TransportArg,
        #[arg(long)]
        device: Option<String>,
        #[arg(long)]
        url: Option<String>,
    },
    Forget {
        id: String,
    },
}

#[derive(Debug, Clone, ValueEnum)]
enum TransportArg {
    Usb,
    Http,
    WebSerial,
}

#[derive(Debug, Subcommand)]
enum WifiCommand {
    Show(ApiSelectorArgs),
    Set {
        #[command(flatten)]
        selector: ApiSelectorArgs,
        #[arg(long)]
        ssid: String,
        #[arg(long)]
        psk: String,
    },
    Clear(ApiSelectorArgs),
}

#[derive(Debug, Subcommand)]
enum PortsCommand {
    Power {
        #[arg(long)]
        port: String,
        #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
        enabled: bool,
    },
    Replug {
        #[arg(long)]
        port: String,
    },
    Route {
        #[arg(long)]
        route: String,
    },
}

#[derive(Debug, clap::Args)]
struct FlashArgs {
    #[command(flatten)]
    selector: UsbSelectorArgs,
    #[arg(long)]
    catalog: PathBuf,
    #[arg(long)]
    artifact: String,
    #[arg(long)]
    real: bool,
    #[arg(long, action = ArgAction::SetTrue)]
    first_time: bool,
    #[arg(long)]
    confirm_non_project_firmware: bool,
    #[arg(long)]
    expected_device_id: Option<String>,
    #[arg(long)]
    expected_mac: Option<String>,
}

#[derive(Debug, Subcommand)]
enum DiagnosticsCommand {
    Export(ApiSelectorArgs),
}

#[derive(Debug, Clone)]
struct DevdClient {
    endpoint: String,
    auto_start: bool,
}

impl DevdClient {
    fn with_endpoint(&self, endpoint: String) -> Self {
        Self {
            endpoint,
            auto_start: self.auto_start,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliLease {
    lease_id: String,
    heartbeat_interval_ms: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let client = Client::new();
    let devd = DevdClient {
        endpoint: cli.ipc.clone(),
        auto_start: !cli.no_auto_start,
    };
    let value = match cli.command {
        Command::Discover { scan } => {
            if scan {
                devd_request(&client, &devd, Method::POST, "/api/v1/devices/scan", None).await?
            } else {
                devd_request(&client, &devd, Method::GET, "/api/v1/devices", None).await?
            }
        }
        Command::Devices => {
            devd_request(&client, &devd, Method::POST, "/api/v1/devices/scan", None).await?
        }
        Command::Status(selector) => {
            request_selected(&client, &devd, selector, Method::GET, "/status", None).await?
        }
        Command::Hardware { command } => handle_hardware(&client, &devd, command).await?,
        Command::Wifi { command } => match command {
            WifiCommand::Show(selector) => {
                request_selected(&client, &devd, selector, Method::GET, "/wifi", None).await?
            }
            WifiCommand::Set {
                selector,
                ssid,
                psk,
            } => {
                request_selected(
                    &client,
                    &devd,
                    selector,
                    Method::POST,
                    "/wifi",
                    Some(json!({"ssid": ssid, "psk": psk})),
                )
                .await?
            }
            WifiCommand::Clear(selector) => {
                request_selected(&client, &devd, selector, Method::DELETE, "/wifi", None).await?
            }
        },
        Command::Ports { selector, command } => {
            handle_ports(&client, &devd, selector, command).await?
        }
        Command::Flash(args) => handle_flash(&client, &devd, args).await?,
        Command::Reset(selector) => {
            let device = resolve_usb_device(&selector, &devd.endpoint)?;
            let device_devd = devd.with_endpoint(device.devd.clone());
            devd_device_post_with_lease(&client, &device_devd, &device.device, "/reset", json!({}))
                .await?
        }
        Command::Monitor { selector, tail } => {
            let device = resolve_usb_device(&selector, &devd.endpoint)?;
            let device_devd = devd.with_endpoint(device.devd.clone());
            devd_request(
                &client,
                &device_devd,
                Method::GET,
                &format!("/api/v1/devices/{}/session?tail={tail}", device.device),
                None,
            )
            .await?
        }
        Command::Diagnostics { command } => match command {
            DiagnosticsCommand::Export(selector) => {
                request_selected(&client, &devd, selector, Method::GET, "/diagnostics", None)
                    .await?
            }
        },
    };

    ensure_success_envelope(&value)?;
    let output = redact_sensitive(&value);
    if cli.json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        print_human(&output);
    }
    Ok(())
}

fn print_human(output: &Value) {
    if let Some(devices) = output.get("devices").and_then(Value::as_array) {
        if devices.is_empty() {
            println!("No devices found.");
            return;
        }
        for device in devices {
            let id = device
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("unknown-device");
            let name = device
                .get("displayName")
                .or_else(|| device.get("display_name"))
                .or_else(|| device.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(id);
            let connection = device
                .get("connection")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            println!("{name} ({id}) - {connection}");
        }
        return;
    }

    if let Some(path) = output.get("path").and_then(Value::as_str) {
        println!("{path}");
        return;
    }

    if let Some(ok) = output.get("ok").and_then(Value::as_bool) {
        println!("{}", if ok { "ok" } else { "failed" });
        return;
    }

    println!(
        "{}",
        serde_json::to_string_pretty(output).unwrap_or_else(|_| output.to_string())
    );
}

async fn devd_request(
    _client: &Client,
    devd: &DevdClient,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> anyhow::Result<Value> {
    let (ipc_method, params) = map_devd_ipc_endpoint(method, path, body)?;
    devd_ipc_call(devd, &ipc_method, params).await
}

async fn devd_ipc_call(devd: &DevdClient, method: &str, params: Value) -> anyhow::Result<Value> {
    match ipc_call(&devd.endpoint, method, params.clone()).await {
        Ok(value) => Ok(value),
        Err(err) if devd.auto_start && looks_like_ipc_connect_error(&err) => {
            start_devd(&devd.endpoint)?;
            wait_for_devd(&devd.endpoint, method, params).await
        }
        Err(err) => Err(err),
    }
}

fn looks_like_ipc_connect_error(err: &anyhow::Error) -> bool {
    err.to_string().contains("connect IPC")
}

fn start_devd(endpoint: &str) -> anyhow::Result<()> {
    let devd_bin = std::env::var_os("ISOLAPURR_DEVD_BIN")
        .map(PathBuf::from)
        .or_else(|| {
            let mut path = std::env::current_exe().ok()?;
            let suffix = std::env::consts::EXE_SUFFIX;
            path.set_file_name(format!("isolapurr-devd{suffix}"));
            Some(path)
        })
        .ok_or_else(|| anyhow!("cannot resolve isolapurr-devd path"))?;
    if !devd_bin.is_file() {
        return Err(anyhow!(
            "isolapurr-devd was not found next to isolapurr; run `just host-tools-build` or set ISOLAPURR_DEVD_BIN"
        ));
    }
    ProcessCommand::new(devd_bin)
        .arg("serve")
        .arg("--endpoint")
        .arg(endpoint)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("start isolapurr-devd IPC daemon")?;
    Ok(())
}

async fn wait_for_devd(endpoint: &str, method: &str, params: Value) -> anyhow::Result<Value> {
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut last_error = None;
    while Instant::now() < deadline {
        match ipc_call(endpoint, method, params.clone()).await {
            Ok(value) => return Ok(value),
            Err(err) => {
                last_error = Some(err);
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("isolapurr-devd IPC daemon did not start")))
}

fn map_devd_ipc_endpoint(
    method: Method,
    path: &str,
    body: Option<Value>,
) -> anyhow::Result<(String, Value)> {
    let (path_only, query) = path.split_once('?').unwrap_or((path, ""));
    if method == Method::GET && path_only == "/api/v1/devices" {
        return Ok(("devices.list".to_string(), json!({})));
    }
    if method == Method::POST && path_only == "/api/v1/devices/scan" {
        return Ok(("devices.scan".to_string(), json!({})));
    }
    if method == Method::POST && path_only == "/api/v1/serial/lease" {
        return Ok((
            "serial.lease.create".to_string(),
            body.unwrap_or_else(|| json!({})),
        ));
    }
    if method == Method::DELETE
        && let Some(lease_id) = path_only.strip_prefix("/api/v1/serial/lease/")
    {
        return Ok((
            "serial.lease.release".to_string(),
            json!({"lease_id": lease_id}),
        ));
    }
    let Some(rest) = path_only.strip_prefix("/api/v1/devices/") else {
        return Err(anyhow!("unsupported devd IPC endpoint: {method} {path}"));
    };
    let (device_id, suffix) = rest
        .split_once('/')
        .ok_or_else(|| anyhow!("invalid devd device path: {path}"))?;
    let mut params = json!({"device_id": device_id});
    let params_map = params.as_object_mut().expect("object");

    let ipc_method = match (method.as_str(), suffix) {
        ("GET", "status") => "device.status",
        ("GET", "wifi") => "device.wifi.get",
        ("POST", "wifi") => {
            merge_body(params_map, body);
            "device.wifi.set"
        }
        ("DELETE", "wifi") => "device.wifi.clear",
        ("GET", "ports") => "device.ports.get",
        ("GET", "session") => {
            if let Some(tail) = query
                .split('&')
                .find_map(|part| part.strip_prefix("tail="))
                .and_then(|tail| tail.parse::<usize>().ok())
            {
                params_map.insert("tail".to_string(), json!(tail));
            }
            "device.session"
        }
        ("POST", "hub/route") => {
            merge_body(params_map, body);
            "device.hub.route_set"
        }
        ("POST", "flash") => {
            merge_body(params_map, body);
            "device.flash"
        }
        ("POST", "reset") => {
            merge_body(params_map, body);
            "device.reset"
        }
        ("GET", "diagnostics") => "device.diagnostics",
        ("POST", _) if suffix.starts_with("ports/") && suffix.ends_with("/replug") => {
            let port = suffix
                .trim_start_matches("ports/")
                .trim_end_matches("/replug");
            params_map.insert("port".to_string(), json!(port));
            "device.port.replug"
        }
        ("POST", _) if suffix.starts_with("ports/") && suffix.contains("/power") => {
            let port = suffix
                .trim_start_matches("ports/")
                .trim_end_matches("/power");
            let enabled = query
                .split('&')
                .find_map(|part| part.strip_prefix("enabled="))
                .ok_or_else(|| anyhow!("enabled query is required"))?
                .parse::<bool>()
                .context("enabled must be a boolean")?;
            params_map.insert("port".to_string(), json!(port));
            params_map.insert("enabled".to_string(), json!(enabled));
            "device.port.power"
        }
        _ => return Err(anyhow!("unsupported devd IPC endpoint: {method} {path}")),
    };
    Ok((ipc_method.to_string(), params))
}

fn merge_body(target: &mut serde_json::Map<String, Value>, body: Option<Value>) {
    if let Some(Value::Object(map)) = body {
        target.extend(map);
    }
}

async fn request_selected(
    client: &Client,
    devd: &DevdClient,
    selector: ApiSelectorArgs,
    method: Method,
    suffix: &str,
    body: Option<Value>,
) -> anyhow::Result<Value> {
    let selected = resolve_api_selector(selector, &devd.endpoint)?;
    match selected {
        ResolvedTarget::Usb(usb) => {
            let usb_devd = devd.with_endpoint(usb.devd.clone());
            ensure_devd_device_registered(client, &usb_devd, &usb.device).await?;
            devd_request(
                client,
                &usb_devd,
                method,
                &format!("/api/v1/devices/{}{}", usb.device, suffix),
                body,
            )
            .await
        }
        ResolvedTarget::Http(url) => {
            let (http_method, path, http_body) = map_http_endpoint(method, suffix, body)?;
            let mut request = client.request(http_method, api_url(&url, &path)?);
            if let Some(body) = http_body {
                request = request.json(&body);
            }
            Ok(request
                .send()
                .await?
                .error_for_status()?
                .json::<Value>()
                .await?)
        }
    }
}

fn map_http_endpoint(
    method: Method,
    suffix: &str,
    body: Option<Value>,
) -> anyhow::Result<(Method, String, Option<Value>)> {
    let mapped = match (method.as_str(), suffix) {
        ("GET", "/status") => (method, "/api/v1/info".to_string(), body),
        ("GET", "/wifi") => (method, "/api/v1/wifi".to_string(), body),
        ("POST", "/wifi") => (Method::POST, "/api/v1/wifi/set".to_string(), body),
        ("DELETE", "/wifi") => (Method::POST, "/api/v1/wifi/clear".to_string(), body),
        ("GET", "/ports") => (method, "/api/v1/ports".to_string(), body),
        ("GET", "/diagnostics") => (method, "/api/v1/pd-diagnostics".to_string(), body),
        ("POST", "/hub/route") => {
            let route = body
                .as_ref()
                .and_then(|body| body.get("route"))
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("route is required"))?;
            (
                Method::POST,
                format!("/api/v1/hub/usb-c-downstream-route?route={route}"),
                None,
            )
        }
        ("POST", _) if suffix.starts_with("/ports/") && suffix.ends_with("/replug") => {
            let port = suffix
                .trim_start_matches("/ports/")
                .trim_end_matches("/replug");
            (
                Method::POST,
                format!("/api/v1/ports/{port}/actions/replug"),
                None,
            )
        }
        ("POST", _) if suffix.starts_with("/ports/") && suffix.contains("/power?enabled=") => {
            let rest = suffix.trim_start_matches("/ports/");
            let (port, query) = rest
                .split_once("/power?")
                .ok_or_else(|| anyhow!("invalid port power path"))?;
            (
                Method::POST,
                format!("/api/v1/ports/{port}/power?{query}"),
                None,
            )
        }
        _ => (method, suffix.to_string(), body),
    };
    Ok(mapped)
}

async fn handle_ports(
    client: &Client,
    devd: &DevdClient,
    selector: ApiSelectorArgs,
    command: Option<PortsCommand>,
) -> anyhow::Result<Value> {
    match command {
        None => request_selected(client, devd, selector, Method::GET, "/ports", None).await,
        Some(PortsCommand::Power { port, enabled }) => {
            request_selected(
                client,
                devd,
                selector,
                Method::POST,
                &format!("/ports/{port}/power?enabled={enabled}"),
                None,
            )
            .await
        }
        Some(PortsCommand::Replug { port }) => {
            request_selected(
                client,
                devd,
                selector,
                Method::POST,
                &format!("/ports/{port}/replug"),
                None,
            )
            .await
        }
        Some(PortsCommand::Route { route }) => {
            request_selected(
                client,
                devd,
                selector,
                Method::POST,
                "/hub/route",
                Some(json!({"route": route})),
            )
            .await
        }
    }
}

async fn handle_hardware(
    client: &Client,
    devd: &DevdClient,
    command: HardwareCommand,
) -> anyhow::Result<Value> {
    let path = registry_path()?;
    match command {
        HardwareCommand::Path => Ok(json!({"path": path})),
        HardwareCommand::List | HardwareCommand::Recent => {
            let mut registry = read_hardware_registry()?;
            registry
                .devices
                .sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));
            Ok(json!({"path": path, "devices": registry.devices}))
        }
        HardwareCommand::Available { scan } => {
            let registry = read_hardware_registry()?;
            let devd_devices = if scan {
                devd_request(client, devd, Method::POST, "/api/v1/devices/scan", None).await
            } else {
                devd_request(client, devd, Method::GET, "/api/v1/devices", None).await
            };
            Ok(json!({
                "path": path,
                "saved": registry.devices,
                "devd": devd_devices.unwrap_or_else(|err| json!({"error": err.to_string()})),
            }))
        }
        HardwareCommand::Save {
            id,
            name,
            transport,
            device,
            url,
        } => {
            let transport = match transport {
                TransportArg::Usb => HardwareTransport::Usb {
                    device_id: device
                        .ok_or_else(|| anyhow!("--device is required for usb hardware"))?,
                    devd_url: None,
                },
                TransportArg::Http => HardwareTransport::Http {
                    base_url: url.ok_or_else(|| anyhow!("--url is required for http hardware"))?,
                },
                TransportArg::WebSerial => HardwareTransport::WebSerial { label: device },
            };
            let saved = save_hardware(SavedHardwareInput {
                id,
                name,
                transport,
            })?;
            Ok(json!({"path": path, "device": saved}))
        }
        HardwareCommand::Forget { id } => {
            let mut registry = read_hardware_registry()?;
            let before = registry.devices.len();
            registry.devices.retain(|device| device.id != id);
            isolapurr_host::write_hardware_registry(&registry)?;
            Ok(json!({"path": path, "id": id, "removed": before != registry.devices.len()}))
        }
    }
}

async fn handle_flash(
    client: &Client,
    devd: &DevdClient,
    args: FlashArgs,
) -> anyhow::Result<Value> {
    let device = resolve_usb_device(&args.selector, &devd.endpoint)?;
    let device_devd = devd.with_endpoint(device.devd.clone());
    let expected_identity = DeviceIdentity {
        device_id: args.expected_device_id.clone().or_else(|| {
            device
                .identity
                .as_ref()
                .and_then(|identity| identity.device_id.clone())
        }),
        mac: args.expected_mac.clone().or_else(|| {
            device
                .identity
                .as_ref()
                .and_then(|identity| identity.mac.clone())
        }),
    };
    if args.real
        && !args.first_time
        && expected_identity.device_id.is_none()
        && expected_identity.mac.is_none()
    {
        return Err(anyhow!(
            "normal flash requires --expected-device-id/--expected-mac or saved hardware identity"
        ));
    }
    let catalog: FirmwareCatalog =
        serde_json::from_slice(&fs::read(&args.catalog).context("read firmware catalog")?)?;
    let artifact = catalog
        .artifacts
        .iter()
        .find(|artifact| artifact.artifact_id == args.artifact)
        .ok_or_else(|| anyhow!("artifact not found in catalog: {}", args.artifact))?;

    let mut confirm_non_project_firmware = args.confirm_non_project_firmware;
    if args.first_time && args.real && !confirm_non_project_firmware {
        if !std::io::stdin().is_terminal() {
            return Err(anyhow!(
                "first-time flash may target download-mode or non-IsolaPurr firmware; rerun interactively or pass --confirm-non-project-firmware after external target confirmation"
            ));
        }
        eprintln!("First-time full flash requested.");
        eprintln!("device={}", device.device);
        eprintln!("artifact={}", artifact.artifact_id);
        eprintln!("target={}", artifact.target);
        eprintln!("Type 'flash {}' to continue:", artifact.artifact_id);
        let mut line = String::new();
        std::io::stdin().read_line(&mut line)?;
        if line.trim() != format!("flash {}", artifact.artifact_id) {
            return Err(anyhow!("first-time flash confirmation did not match"));
        }
        confirm_non_project_firmware = true;
    }

    devd_device_post_with_lease(
        client,
        &device_devd,
        &device.device,
        "/flash",
        json!({
            "catalog_path": args.catalog,
            "artifact_id": args.artifact,
            "real": args.real,
            "first_time": args.first_time,
            "confirm_non_project_firmware": confirm_non_project_firmware,
            "expected_identity": expected_identity,
        }),
    )
    .await
}

async fn devd_device_post_with_lease(
    client: &Client,
    devd: &DevdClient,
    device: &str,
    suffix: &str,
    mut body: Value,
) -> anyhow::Result<Value> {
    ensure_devd_device_registered(client, devd, device).await?;
    let lease = create_lease(client, devd, device).await?;
    if let Some(map) = body.as_object_mut() {
        map.insert(
            "lease_id".to_string(),
            Value::String(lease.lease_id.clone()),
        );
    }
    let result = devd_request(
        client,
        devd,
        Method::POST,
        &format!("/api/v1/devices/{device}{suffix}"),
        Some(body),
    )
    .await;
    let _ = devd_request(
        client,
        devd,
        Method::DELETE,
        &format!("/api/v1/serial/lease/{}", lease.lease_id),
        None,
    )
    .await;
    result
}

async fn ensure_devd_device_registered(
    client: &Client,
    devd: &DevdClient,
    device: &str,
) -> anyhow::Result<()> {
    let value = devd_request(client, devd, Method::POST, "/api/v1/devices/scan", None).await?;
    let found = value
        .get("devices")
        .and_then(Value::as_array)
        .is_some_and(|devices| {
            devices
                .iter()
                .any(|entry| entry.get("id").and_then(Value::as_str) == Some(device))
        });
    if !found {
        return Err(anyhow!("device not found after scan: {device}"));
    }
    Ok(())
}

async fn create_lease(
    client: &Client,
    devd: &DevdClient,
    device: &str,
) -> anyhow::Result<CliLease> {
    let value = devd_request(
        client,
        devd,
        Method::POST,
        "/api/v1/serial/lease",
        Some(json!({"device_id": device})),
    )
    .await?;
    Ok(serde_json::from_value(value)?)
}

fn ensure_success_envelope(value: &Value) -> anyhow::Result<()> {
    if value.get("ok").and_then(Value::as_bool) == Some(false) {
        let message = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .or_else(|| value.get("error").and_then(Value::as_str))
            .unwrap_or("device returned ok=false");
        return Err(anyhow!("device request failed: {message}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_success_envelope_rejects_jsonl_ok_false() {
        let value = json!({
            "ok": false,
            "error": {"message": "port is locked"}
        });
        let err = ensure_success_envelope(&value).expect_err("ok=false should fail");
        assert!(err.to_string().contains("port is locked"));
    }

    #[test]
    fn ensure_success_envelope_ignores_non_envelope_output() {
        ensure_success_envelope(&json!({"devices": []})).expect("list output should pass");
        ensure_success_envelope(&json!({"ok": true})).expect("ok=true should pass");
    }

    #[test]
    fn maps_http_port_mutation_endpoints() {
        let (_, path, body) =
            map_http_endpoint(Method::POST, "/ports/port_a/power?enabled=false", None)
                .expect("power endpoint should map");
        assert_eq!(path, "/api/v1/ports/port_a/power?enabled=false");
        assert!(body.is_none());

        let (_, path, _) = map_http_endpoint(Method::POST, "/ports/port_c/replug", None)
            .expect("replug endpoint should map");
        assert_eq!(path, "/api/v1/ports/port_c/actions/replug");

        let (_, path, body) =
            map_http_endpoint(Method::POST, "/hub/route", Some(json!({"route": "mcu"})))
                .expect("route endpoint should map");
        assert_eq!(path, "/api/v1/hub/usb-c-downstream-route?route=mcu");
        assert!(body.is_none());
    }

    #[test]
    fn maps_devd_device_endpoints_to_ipc_methods() {
        let (method, params) = map_devd_ipc_endpoint(
            Method::POST,
            "/api/v1/devices/usb--dev-cu-usbmodem21221401/ports/port_a/power?enabled=false",
            None,
        )
        .expect("power endpoint should map");
        assert_eq!(method, "device.port.power");
        assert_eq!(params["device_id"], "usb--dev-cu-usbmodem21221401");
        assert_eq!(params["port"], "port_a");
        assert_eq!(params["enabled"], false);

        let (method, params) = map_devd_ipc_endpoint(
            Method::POST,
            "/api/v1/devices/usb--dev-cu-usbmodem21221401/hub/route",
            Some(json!({"route": "mcu"})),
        )
        .expect("route endpoint should map");
        assert_eq!(method, "device.hub.route_set");
        assert_eq!(params["route"], "mcu");
    }

    #[test]
    fn cli_uses_ipc_instead_of_devd_http_flag() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "--ipc",
            "/tmp/isolapurr-test.sock",
            "--no-auto-start",
            "devices",
        ])
        .expect("ipc flags should parse");
        assert_eq!(cli.ipc, "/tmp/isolapurr-test.sock");
        assert!(cli.no_auto_start);

        let err = Cli::try_parse_from(["isolapurr", "--devd", "http://127.0.0.1:51200", "devices"])
            .expect_err("legacy devd HTTP flag must not parse");
        assert!(err.to_string().contains("unexpected argument"));
    }

    #[test]
    fn ports_power_accepts_explicit_boolean_value() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "ports",
            "--device",
            "usb--dev-cu-usbmodem21221401",
            "power",
            "--port",
            "port_a",
            "--enabled",
            "false",
        ])
        .expect("explicit boolean value should parse");

        let Command::Ports {
            command: Some(PortsCommand::Power { enabled, .. }),
            ..
        } = cli.command
        else {
            panic!("expected ports power command");
        };
        assert!(!enabled);
    }

    #[test]
    fn flash_accepts_non_project_confirmation_flag() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "flash",
            "--device",
            "usb--dev-cu-usbmodem21221401",
            "--catalog",
            "catalog.json",
            "--artifact",
            "app",
            "--real",
            "--first-time",
            "--confirm-non-project-firmware",
        ])
        .expect("confirmation flag should parse");

        let Command::Flash(args) = cli.command else {
            panic!("expected flash command");
        };
        assert!(args.confirm_non_project_firmware);
    }
}

#[derive(Clone)]
struct ResolvedUsb {
    device: String,
    devd: String,
    identity: Option<DeviceIdentity>,
}

enum ResolvedTarget {
    Usb(ResolvedUsb),
    Http(String),
}

fn resolve_api_selector(
    selector: ApiSelectorArgs,
    default_devd: &str,
) -> anyhow::Result<ResolvedTarget> {
    let count = selector.hardware.is_some() as u8
        + selector.device.is_some() as u8
        + selector.url.is_some() as u8;
    if count != 1 {
        return Err(anyhow!(
            "select exactly one of --hardware, --device, or --url"
        ));
    }
    if let Some(url) = selector.url {
        return Ok(ResolvedTarget::Http(url));
    }
    if let Some(device) = selector.device {
        return Ok(ResolvedTarget::Usb(ResolvedUsb {
            device,
            devd: default_devd.to_string(),
            identity: None,
        }));
    }
    let hardware_id = selector.hardware.expect("count checked");
    let hardware = find_hardware(&hardware_id)?;
    let identity = hardware.identity.clone();
    match hardware.transport {
        HardwareTransport::Usb {
            device_id,
            devd_url,
        } => {
            let _ = devd_url;
            Ok(ResolvedTarget::Usb(ResolvedUsb {
                device: device_id,
                devd: default_devd.to_string(),
                identity,
            }))
        }
        HardwareTransport::Http { base_url } => Ok(ResolvedTarget::Http(base_url)),
        HardwareTransport::WebSerial { .. } => Err(anyhow!(
            "saved hardware {hardware_id} uses Web Serial; CLI automation requires devd USB or HTTP"
        )),
    }
}

fn resolve_usb_device(
    selector: &UsbSelectorArgs,
    default_devd: &str,
) -> anyhow::Result<ResolvedUsb> {
    if selector.hardware.is_some() == selector.device.is_some() {
        return Err(anyhow!("select exactly one of --hardware or --device"));
    }
    if let Some(device) = selector.device.clone() {
        return Ok(ResolvedUsb {
            device,
            devd: default_devd.to_string(),
            identity: None,
        });
    }
    let hardware_id = selector.hardware.as_ref().expect("checked");
    let hardware = find_hardware(hardware_id)?;
    let identity = hardware.identity.clone();
    match hardware.transport {
        HardwareTransport::Usb {
            device_id,
            devd_url,
        } => {
            let _ = devd_url;
            Ok(ResolvedUsb {
                device: device_id,
                devd: default_devd.to_string(),
                identity,
            })
        }
        _ => Err(anyhow!(
            "saved hardware {hardware_id} is not devd USB hardware"
        )),
    }
}

fn find_hardware(id: &str) -> anyhow::Result<DeviceProfile> {
    read_hardware_registry()?
        .devices
        .into_iter()
        .find(|device| device.id == id)
        .ok_or_else(|| anyhow!("saved hardware not found: {id}"))
}
