use anyhow::{Context as _, anyhow};
use clap::{ArgAction, Parser, Subcommand, ValueEnum};
use isolapurr_host::{
    DEFAULT_DEVD_URL, DeviceIdentity, DeviceProfile, FirmwareCatalog, HardwareTransport,
    SavedHardwareInput, api_url, read_hardware_registry, redact_sensitive, registry_path,
    save_hardware,
};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};

#[derive(Debug, Parser)]
#[command(name = "isolapurr", version, about = "IsolaPurr CLI")]
struct Cli {
    #[arg(long, default_value = DEFAULT_DEVD_URL)]
    devd: String,
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
        #[arg(long)]
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
    expected_device_id: Option<String>,
    #[arg(long)]
    expected_mac: Option<String>,
}

#[derive(Debug, Subcommand)]
enum DiagnosticsCommand {
    Export(ApiSelectorArgs),
}

#[derive(Debug, Deserialize)]
struct Bootstrap {
    token: String,
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
    let value = match cli.command {
        Command::Discover { scan } => {
            if scan {
                devd_request(
                    &client,
                    &cli.devd,
                    Method::POST,
                    "/api/v1/devices/scan",
                    None,
                )
                .await?
            } else {
                devd_request(&client, &cli.devd, Method::GET, "/api/v1/devices", None).await?
            }
        }
        Command::Devices => {
            devd_request(
                &client,
                &cli.devd,
                Method::POST,
                "/api/v1/devices/scan",
                None,
            )
            .await?
        }
        Command::Status(selector) => {
            request_selected(&client, &cli.devd, selector, Method::GET, "/status", None).await?
        }
        Command::Hardware { command } => handle_hardware(&client, &cli.devd, command).await?,
        Command::Wifi { command } => match command {
            WifiCommand::Show(selector) => {
                request_selected(&client, &cli.devd, selector, Method::GET, "/wifi", None).await?
            }
            WifiCommand::Set {
                selector,
                ssid,
                psk,
            } => {
                request_selected(
                    &client,
                    &cli.devd,
                    selector,
                    Method::POST,
                    "/wifi",
                    Some(json!({"ssid": ssid, "psk": psk})),
                )
                .await?
            }
            WifiCommand::Clear(selector) => {
                request_selected(&client, &cli.devd, selector, Method::DELETE, "/wifi", None)
                    .await?
            }
        },
        Command::Ports { selector, command } => {
            handle_ports(&client, &cli.devd, selector, command).await?
        }
        Command::Flash(args) => handle_flash(&client, &cli.devd, args).await?,
        Command::Reset(selector) => {
            let device = resolve_usb_device(&selector, &cli.devd)?;
            devd_device_post_with_lease(&client, &device.devd, &device.device, "/reset", json!({}))
                .await?
        }
        Command::Monitor { selector, tail } => {
            let device = resolve_usb_device(&selector, &cli.devd)?;
            devd_request(
                &client,
                &device.devd,
                Method::GET,
                &format!("/api/v1/devices/{}/session?tail={tail}", device.device),
                None,
            )
            .await?
        }
        Command::Diagnostics { command } => match command {
            DiagnosticsCommand::Export(selector) => {
                request_selected(
                    &client,
                    &cli.devd,
                    selector,
                    Method::GET,
                    "/diagnostics",
                    None,
                )
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

async fn bootstrap(client: &Client, devd: &str) -> anyhow::Result<Bootstrap> {
    Ok(client
        .get(api_url(devd, "/api/v1/bootstrap")?)
        .send()
        .await?
        .error_for_status()?
        .json::<Bootstrap>()
        .await?)
}

async fn devd_request(
    client: &Client,
    devd: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> anyhow::Result<Value> {
    let bootstrap = bootstrap(client, devd).await?;
    let mut request = client
        .request(method, api_url(devd, path)?)
        .bearer_auth(bootstrap.token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    Ok(request
        .send()
        .await?
        .error_for_status()?
        .json::<Value>()
        .await?)
}

async fn request_selected(
    client: &Client,
    devd: &str,
    selector: ApiSelectorArgs,
    method: Method,
    suffix: &str,
    body: Option<Value>,
) -> anyhow::Result<Value> {
    let selected = resolve_api_selector(selector, devd)?;
    match selected {
        ResolvedTarget::Usb(usb) => {
            ensure_devd_device_registered(client, &usb.devd, &usb.device).await?;
            devd_request(
                client,
                &usb.devd,
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
    devd: &str,
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
    devd: &str,
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
                    devd_url: Some(devd.to_string()),
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

async fn handle_flash(client: &Client, devd: &str, args: FlashArgs) -> anyhow::Result<Value> {
    let device = resolve_usb_device(&args.selector, devd)?;
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

    if args.first_time && args.real {
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
    }

    devd_device_post_with_lease(
        client,
        &device.devd,
        &device.device,
        "/flash",
        json!({
            "catalog_path": args.catalog,
            "artifact_id": args.artifact,
            "real": args.real,
            "first_time": args.first_time,
            "expected_identity": expected_identity,
        }),
    )
    .await
}

async fn devd_device_post_with_lease(
    client: &Client,
    devd: &str,
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
    devd: &str,
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

async fn create_lease(client: &Client, devd: &str, device: &str) -> anyhow::Result<CliLease> {
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
        } => Ok(ResolvedTarget::Usb(ResolvedUsb {
            device: device_id,
            devd: devd_url.unwrap_or_else(|| default_devd.to_string()),
            identity,
        })),
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
        } => Ok(ResolvedUsb {
            device: device_id,
            devd: devd_url.unwrap_or_else(|| default_devd.to_string()),
            identity,
        }),
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
