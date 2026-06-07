use anyhow::{Context as _, anyhow};
use clap::{ArgAction, Parser, Subcommand, ValueEnum};
use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use isolapurr_host::{
    DeviceIdentity, DeviceProfile, DeviceRecord, FirmwareCatalog, HardwareTransport,
    SavedHardwareInput, api_url, default_ipc_endpoint, ipc_call, read_hardware_registry,
    redact_sensitive, registry_path, save_hardware,
};
use ratatui::{
    DefaultTerminal, Frame,
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, List, ListItem, ListState, Paragraph, Wrap},
};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    io::{self, IsTerminal as _},
    path::PathBuf,
    process::{Command as ProcessCommand, Stdio},
    time::{Duration, Instant},
};

#[derive(Debug, Parser)]
#[command(
    name = "isolapurr",
    version = isolapurr_host::release_version(),
    about = "IsolaPurr CLI"
)]
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
    Power {
        #[command(subcommand)]
        command: PowerCommand,
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

impl ApiSelectorArgs {
    fn selection_count(&self) -> u8 {
        self.hardware.is_some() as u8 + self.device.is_some() as u8 + self.url.is_some() as u8
    }

    fn is_empty(&self) -> bool {
        self.selection_count() == 0
    }
}

#[derive(Debug, clap::Args, Clone, Default)]
struct PowerSelectorArgs {
    #[arg(long)]
    hardware: Option<String>,
}

impl PowerSelectorArgs {
    fn is_empty(&self) -> bool {
        self.hardware.is_none()
    }
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

#[derive(Debug, Subcommand)]
enum PowerCommand {
    #[command(about = "Show saved power settings and live USB-C source status")]
    Show(PowerSelectorArgs),
    #[command(about = "Restore the default USB-C source capability profile")]
    Defaults {
        #[command(flatten)]
        selector: PowerSelectorArgs,
    },
    #[command(about = "Switch output mode or update the saved manual output target")]
    Output {
        #[command(subcommand)]
        command: OutputCommand,
    },
    #[command(
        name = "source-capability",
        about = "Inspect or update advertised fast-charge protocols and source limits"
    )]
    SourceCapability {
        #[command(subcommand)]
        command: SourceCapabilityCommand,
    },
}

#[derive(Debug, Subcommand)]
enum SourceCapabilityCommand {
    #[command(
        about = "Update advertised fast-charge protocols, PD options, and source limits",
        after_help = "Run without any update flags to open the interactive source-capability editor.\nUse Up/Down to choose a field, Left/Right to change it, Enter or Space to toggle the focused chip, and Esc to cancel."
    )]
    Set {
        #[command(flatten)]
        selector: PowerSelectorArgs,
        #[command(flatten)]
        args: SourceCapabilitySetArgs,
    },
}

#[derive(Debug, Subcommand)]
enum OutputCommand {
    #[command(
        about = "Switch to manual output mode and optionally update the saved target",
        after_help = "When voltage, current limit, or USB-C path flags are omitted, the existing saved manual target is kept."
    )]
    Manual {
        #[command(flatten)]
        selector: PowerSelectorArgs,
        #[command(flatten)]
        args: ManualOutputArgs,
    },
    #[command(about = "Return to automatic USB-C request tracking")]
    Auto {
        #[command(flatten)]
        selector: PowerSelectorArgs,
    },
}

#[derive(Debug, clap::Args, Clone, Default)]
struct ManualOutputArgs {
    #[arg(long, value_parser = clap::value_parser!(u16).range(3000..=21000))]
    voltage_mv: Option<u16>,
    #[arg(long, value_parser = clap::value_parser!(u16).range(1..=6350))]
    current_limit_ma: Option<u16>,
    #[arg(long, value_enum)]
    usb_c_path: Option<OutputUsbCPathArg>,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum OutputUsbCPathArg {
    Automatic,
    Disconnected,
    ForcedOn,
}

#[derive(Debug, clap::Args, Clone, Default)]
struct SourceCapabilitySetArgs {
    #[arg(long, value_parser = clap::value_parser!(u8).range(1..=100))]
    power_watts: Option<u8>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    pd: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    pps: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    qc20: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    qc30: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    fcp: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    afc: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    scp: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    pe20: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    bc12: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    sfcp: Option<bool>,
    #[arg(long)]
    fixed_pd_voltages: Option<String>,
    #[arg(long, value_parser = parse_pps3_limit_ma)]
    pps3_limit_ma: Option<u16>,
    #[arg(long, value_parser = clap::value_parser!(bool))]
    pd_pps_5a: Option<bool>,
    #[arg(long, value_parser = parse_type_c_broadcast_ma)]
    type_c_broadcast_ma: Option<u16>,
    #[arg(long, value_parser = parse_scp_limit_ma)]
    scp_limit_ma: Option<u16>,
    #[arg(long, value_parser = parse_fcp_afc_sfcp_limit_ma)]
    fcp_afc_sfcp_limit_ma: Option<u16>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct CliPowerConfig {
    hardware: String,
    persisted: bool,
    tps_mode: String,
    capability: CliPowerCapability,
    manual: CliPowerManual,
    lock: Option<CliPowerLock>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct CliPowerCapability {
    profile: String,
    power_watts: u8,
    protocols: Value,
    pd: CliPowerPd,
    #[serde(default)]
    current: CliPowerCurrentProfile,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct CliPowerPd {
    pps: bool,
    fixed_voltages_mv: Vec<u16>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct CliPowerCurrentProfile {
    pps3_limit_ma: u16,
    pd_pps_5a: bool,
    type_c_broadcast_ma: u16,
    scp_limit_ma: u16,
    fcp_afc_sfcp_limit_ma: u16,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct CliPowerManual {
    voltage_mv: u16,
    current_limit_ma: u16,
    usb_c_path_mode: String,
    path_policy: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct CliPowerLock {
    owner: u32,
    expires_at_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPowerDiagnostics {
    usb_c_power_enabled: bool,
    sw2303_i2c_allowed: bool,
    sw2303_profile_applied: bool,
    sw2303_stable_reads: u32,
    sw2303_error_latched: bool,
    tps_error_latched: bool,
    sw2303_readback_config: CliPowerCapabilityReadback,
    sw2303_request: CliPowerRequest,
    sw2303_last_valid_request: CliPowerRequest,
    tps_setpoint: CliPowerSetpoint,
    runtime_recovery_count: u32,
    sample_uptime_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPowerCapabilityReadback {
    available: bool,
    matches_config: bool,
    power_watts: Option<u8>,
    protocols: CliPowerProtocolReadback,
    pd: CliPowerPdReadback,
    #[serde(default)]
    current: CliPowerCurrentReadback,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPowerProtocolReadback {
    pd: Option<bool>,
    qc20: Option<bool>,
    qc30: Option<bool>,
    fcp: Option<bool>,
    afc: Option<bool>,
    scp: Option<bool>,
    pe20: Option<bool>,
    bc12: Option<bool>,
    sfcp: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPowerPdReadback {
    pps: Option<bool>,
    fixed_voltages_mv: Vec<u16>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPowerCurrentReadback {
    #[serde(alias = "pps3_current_limit_ma")]
    pps3_limit_ma: Option<u16>,
    pd_pps_5a: Option<bool>,
    type_c_broadcast_ma: Option<u16>,
    #[serde(alias = "scp_current_limit_ma")]
    scp_limit_ma: Option<u16>,
    fcp_afc_sfcp_limit_ma: Option<u16>,
}

impl Default for CliPowerCurrentProfile {
    fn default() -> Self {
        Self {
            pps3_limit_ma: 5000,
            pd_pps_5a: false,
            type_c_broadcast_ma: 500,
            scp_limit_ma: 5000,
            fcp_afc_sfcp_limit_ma: 3250,
        }
    }
}

impl Default for CliPowerCurrentReadback {
    fn default() -> Self {
        Self {
            pps3_limit_ma: None,
            pd_pps_5a: None,
            type_c_broadcast_ma: None,
            scp_limit_ma: None,
            fcp_afc_sfcp_limit_ma: None,
        }
    }
}

#[derive(Debug)]
struct UserCancelled;

impl std::fmt::Display for UserCancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("cancelled")
    }
}

impl std::error::Error for UserCancelled {}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPowerRequest {
    mv: Option<u32>,
    ma: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPowerSetpoint {
    output_enabled: Option<bool>,
    mv: Option<u32>,
    ilim_ma: Option<u32>,
}

const MANUAL_OUTPUT_DEFAULT_VOLTAGE_MV: u16 = 5_000;
const MANUAL_OUTPUT_DEFAULT_CURRENT_MA: u16 = 1_000;

impl SourceCapabilitySetArgs {
    fn has_updates(&self) -> bool {
        self.power_watts.is_some()
            || self.pd.is_some()
            || self.pps.is_some()
            || self.qc20.is_some()
            || self.qc30.is_some()
            || self.fcp.is_some()
            || self.afc.is_some()
            || self.scp.is_some()
            || self.pe20.is_some()
            || self.bc12.is_some()
            || self.sfcp.is_some()
            || self.fixed_pd_voltages.is_some()
            || self.pps3_limit_ma.is_some()
            || self.pd_pps_5a.is_some()
            || self.type_c_broadcast_ma.is_some()
            || self.scp_limit_ma.is_some()
            || self.fcp_afc_sfcp_limit_ma.is_some()
    }
}

impl OutputUsbCPathArg {
    fn as_config_value(self) -> &'static str {
        match self {
            Self::Automatic => "default",
            Self::Disconnected => "disconnect",
            Self::ForcedOn => "force",
        }
    }
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
    let value_result: anyhow::Result<Value> = async {
        Ok(match cli.command {
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
                    request_selected(&client, &devd, selector, Method::DELETE, "/wifi", None)
                        .await?
                }
            },
            Command::Ports { selector, command } => {
                handle_ports(&client, &devd, selector, command).await?
            }
            Command::Flash(args) => handle_flash(&client, &devd, args).await?,
            Command::Reset(selector) => {
                let device = resolve_usb_device(&selector, &devd.endpoint)?;
                let device_devd = devd.with_endpoint(device.devd.clone());
                devd_device_post_with_lease(
                    &client,
                    &device_devd,
                    &device.device,
                    "/reset",
                    json!({}),
                )
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
            Command::Power { command } => handle_power(&client, &devd, command, !cli.json).await?,
        })
    }
    .await;
    let value = match value_result {
        Ok(value) => value,
        Err(err) if err.downcast_ref::<UserCancelled>().is_some() => return Ok(()),
        Err(err) => return Err(err),
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
    print!("{}", format_human_output(output));
}

fn unwrap_device_success_result(value: Value) -> anyhow::Result<Value> {
    if value.get("ok").and_then(Value::as_bool) == Some(false) {
        let message = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .or_else(|| value.get("error").and_then(Value::as_str))
            .unwrap_or("device returned ok=false");
        return Err(anyhow!("device request failed: {message}"));
    }

    if value.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(value.get("result").cloned().unwrap_or_else(|| json!({})));
    }

    Ok(value)
}

fn format_human_output(output: &Value) -> String {
    if output.get("config").is_some() && output.get("diagnostics").is_some() {
        return format_power_show_output(output);
    }

    if output.get("capability").is_some() && output.get("manual").is_some() {
        return format_power_config_output(output);
    }

    if output.get("saved").is_some() || output.get("devd").is_some() {
        return format_hardware_available(output);
    }

    if let Some(devices) = output.get("devices").and_then(Value::as_array) {
        if devices.is_empty() {
            return "No devices found.\n".to_string();
        }
        let mut lines = Vec::new();
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
            lines.push(format!("{name} ({id}) - {connection}"));
        }
        return format!("{}\n", lines.join("\n"));
    }

    if let Some(path) = output.get("path").and_then(Value::as_str) {
        return format!("{path}\n");
    }

    if let Some(ok) = output.get("ok").and_then(Value::as_bool) {
        return format!("{}\n", if ok { "ok" } else { "failed" });
    }

    format!(
        "{}\n",
        serde_json::to_string_pretty(output).unwrap_or_else(|_| output.to_string())
    )
}

fn format_hardware_available(output: &Value) -> String {
    let mut lines = Vec::new();
    if let Some(path) = output.get("path").and_then(Value::as_str) {
        lines.push(format!("Registry: {path}"));
    }

    lines.push("Saved hardware:".to_string());
    match output.get("saved").and_then(Value::as_array) {
        Some(saved) if !saved.is_empty() => {
            for device in saved {
                let id = device
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown-hardware");
                let name = device.get("name").and_then(Value::as_str).unwrap_or(id);
                lines.push(format!("- {name} ({id}) {}", transport_label(device)));
            }
        }
        _ => lines.push("- none".to_string()),
    }

    lines.push("Local devd devices:".to_string());
    if let Some(error) = output
        .get("devd")
        .and_then(|devd| devd.get("error"))
        .and_then(Value::as_str)
    {
        lines.push(format!("- unavailable: {error}"));
    } else {
        match output
            .get("devd")
            .and_then(|devd| devd.get("devices"))
            .and_then(Value::as_array)
        {
            Some(devices) if !devices.is_empty() => {
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
                    lines.push(format!("- {name} ({id}) - {connection}"));
                }
            }
            _ => lines.push("- none".to_string()),
        }
    }

    format!("{}\n", lines.join("\n"))
}

fn format_power_show_output(output: &Value) -> String {
    let mut rendered = String::new();
    if let Some(config) = output.get("config") {
        rendered.push_str("Power config\n");
        rendered.push_str(&format_power_config_output(config));
    }
    if let Some(diagnostics) = output.get("diagnostics") {
        rendered.push('\n');
        rendered.push_str("Live USB-C status\n");
        rendered.push_str(&format_live_power_output(diagnostics));
    }
    rendered
}

fn format_power_config_output(output: &Value) -> String {
    let Ok(config) = serde_json::from_value::<CliPowerConfig>(output.clone()) else {
        return format!(
            "{}\n",
            serde_json::to_string_pretty(output).unwrap_or_else(|_| output.to_string())
        );
    };

    let mut lines = Vec::new();
    lines.push(format!(
        "Saved profile: {}",
        if config.persisted { "yes" } else { "no" }
    ));
    lines.push(format!(
        "Output mode: {}",
        format_power_mode(&config.tps_mode)
    ));
    lines.push(format!("Power cap: {} W", config.capability.power_watts));
    lines.push(format!(
        "Advertised protocols: {}",
        format_config_protocols(&config.capability)
    ));
    lines.push(format!(
        "Fixed PD voltages: {}",
        format_fixed_voltages(&config.capability.pd.fixed_voltages_mv)
    ));
    lines.push(format!(
        "Current profile: {}",
        format_current_profile(
            config.capability.current.pps3_limit_ma,
            config.capability.current.pd_pps_5a,
            config.capability.current.type_c_broadcast_ma,
            config.capability.current.scp_limit_ma,
            config.capability.current.fcp_afc_sfcp_limit_ma,
        )
    ));
    lines.push(format!(
        "Manual output: {} mV, {} mA, USB-C path {}",
        config.manual.voltage_mv,
        config.manual.current_limit_ma,
        format_usb_c_path_mode(&config.manual.usb_c_path_mode)
    ));
    if let Some(lock) = &config.lock {
        if lock.expires_at_ms == 0 {
            lines.push("Host lock: idle".to_string());
        } else {
            lines.push(format!(
                "Host lock: owner={}, expires_at_ms={}",
                lock.owner, lock.expires_at_ms
            ));
        }
    } else {
        lines.push("Host lock: idle".to_string());
    }
    format!("{}\n", lines.join("\n"))
}

fn format_live_power_output(output: &Value) -> String {
    let Ok(diagnostics) = serde_json::from_value::<CliPowerDiagnostics>(output.clone()) else {
        return format!(
            "{}\n",
            serde_json::to_string_pretty(output).unwrap_or_else(|_| output.to_string())
        );
    };

    let mut lines = Vec::new();
    lines.push(format!(
        "USB-C source: {}",
        if diagnostics.usb_c_power_enabled {
            "enabled"
        } else {
            "disabled"
        }
    ));
    lines.push(format!(
        "Capability state: {}",
        format_capability_state(&diagnostics)
    ));
    lines.push(format!(
        "Advertised source: {}",
        format_readback_summary(&diagnostics.sw2303_readback_config)
    ));
    lines.push(format!(
        "Negotiated request: {}",
        format_power_request(&diagnostics.sw2303_request)
    ));
    lines.push(format!(
        "Last valid request: {}",
        format_power_request(&diagnostics.sw2303_last_valid_request)
    ));
    lines.push(format!(
        "Output target: {}",
        format_output_target(&diagnostics.tps_setpoint)
    ));
    lines.push(format!(
        "Runtime recoveries: {}",
        diagnostics.runtime_recovery_count
    ));
    lines.push(format!("Faults: {}", format_faults(&diagnostics)));
    lines.push(format!(
        "Status sample age: {} ms",
        diagnostics.sample_uptime_ms
    ));
    format!("{}\n", lines.join("\n"))
}

fn format_power_mode(mode: &str) -> &'static str {
    match mode {
        "auto_follow" => "Auto follow USB-C request",
        "manual" => "Manual bench output",
        _ => "Unknown",
    }
}

fn format_usb_c_path_mode(mode: &str) -> &'static str {
    match mode {
        "default" => "automatic",
        "disconnect" => "disconnected",
        "force" => "forced on",
        _ => "unknown",
    }
}

fn format_config_protocols(capability: &CliPowerCapability) -> String {
    let mut labels = Vec::new();
    append_protocol(
        &mut labels,
        capability.protocols.get("pd").and_then(Value::as_bool),
        "PD",
    );
    append_protocol(&mut labels, Some(capability.pd.pps), "PPS");
    append_protocol(
        &mut labels,
        capability.protocols.get("qc20").and_then(Value::as_bool),
        "QC2.0",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("qc30").and_then(Value::as_bool),
        "QC3.0",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("fcp").and_then(Value::as_bool),
        "FCP",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("afc").and_then(Value::as_bool),
        "AFC",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("scp").and_then(Value::as_bool),
        "SCP",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("pe20").and_then(Value::as_bool),
        "PE2.0",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("bc12").and_then(Value::as_bool),
        "BC1.2",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("sfcp").and_then(Value::as_bool),
        "SFCP",
    );
    if labels.is_empty() {
        "none".to_string()
    } else {
        labels.join(", ")
    }
}

fn append_protocol(labels: &mut Vec<&'static str>, enabled: Option<bool>, label: &'static str) {
    if enabled == Some(true) {
        labels.push(label);
    }
}

fn format_fixed_voltages(fixed_voltages_mv: &[u16]) -> String {
    if fixed_voltages_mv.is_empty() {
        return "none".to_string();
    }
    fixed_voltages_mv
        .iter()
        .map(|mv| format!("{} V", mv / 1000))
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_current_profile(
    pps3_limit_ma: u16,
    pd_pps_5a: bool,
    type_c_broadcast_ma: u16,
    scp_limit_ma: u16,
    fcp_afc_sfcp_limit_ma: u16,
) -> String {
    format!(
        "PPS3 {} mA, PD/PPS 5 A {}, Type-C {} mA, SCP {} mA, FCP/AFC/SFCP {} mA",
        pps3_limit_ma,
        if pd_pps_5a { "enabled" } else { "disabled" },
        type_c_broadcast_ma,
        scp_limit_ma,
        fcp_afc_sfcp_limit_ma,
    )
}

fn format_capability_state(diagnostics: &CliPowerDiagnostics) -> &'static str {
    let readback = &diagnostics.sw2303_readback_config;
    if !diagnostics.usb_c_power_enabled {
        "idle"
    } else if readback.available && readback.matches_config {
        "applied"
    } else if readback.available {
        "readback mismatch"
    } else if !diagnostics.sw2303_i2c_allowed {
        "controller not ready"
    } else if diagnostics.sw2303_profile_applied {
        "applied"
    } else {
        "pending readback"
    }
}

fn format_readback_summary(readback: &CliPowerCapabilityReadback) -> String {
    if !readback.available {
        return "unavailable".to_string();
    }

    let mut parts = Vec::new();
    if let Some(power_watts) = readback.power_watts {
        parts.push(format!("{power_watts} W"));
    }
    let protocols = format_readback_protocols(readback);
    if protocols != "none" {
        parts.push(protocols);
    }
    let fixed_voltages = format_fixed_voltages(&readback.pd.fixed_voltages_mv);
    if fixed_voltages != "none" {
        parts.push(format!("fixed {fixed_voltages}"));
    }
    parts.push(format!(
        "current {}",
        format_readback_current_profile(&readback.current)
    ));
    parts.join("; ")
}

fn format_readback_protocols(readback: &CliPowerCapabilityReadback) -> String {
    let mut labels = Vec::new();
    append_protocol(&mut labels, readback.protocols.pd, "PD");
    append_protocol(&mut labels, readback.pd.pps, "PPS");
    append_protocol(&mut labels, readback.protocols.qc20, "QC2.0");
    append_protocol(&mut labels, readback.protocols.qc30, "QC3.0");
    append_protocol(&mut labels, readback.protocols.fcp, "FCP");
    append_protocol(&mut labels, readback.protocols.afc, "AFC");
    append_protocol(&mut labels, readback.protocols.scp, "SCP");
    append_protocol(&mut labels, readback.protocols.pe20, "PE2.0");
    append_protocol(&mut labels, readback.protocols.bc12, "BC1.2");
    append_protocol(&mut labels, readback.protocols.sfcp, "SFCP");
    if labels.is_empty() {
        "none".to_string()
    } else {
        labels.join(", ")
    }
}

fn format_readback_current_profile(current: &CliPowerCurrentReadback) -> String {
    let pps3 = current
        .pps3_limit_ma
        .map(|value| format!("{value} mA"))
        .unwrap_or_else(|| "unknown".to_string());
    let pd_pps_5a = match current.pd_pps_5a {
        Some(true) => "enabled",
        Some(false) => "disabled",
        None => "unknown",
    };
    let type_c = current
        .type_c_broadcast_ma
        .map(|value| format!("{value} mA"))
        .unwrap_or_else(|| "unknown".to_string());
    let scp = current
        .scp_limit_ma
        .map(|value| format!("{value} mA"))
        .unwrap_or_else(|| "unknown".to_string());
    let fcp = current
        .fcp_afc_sfcp_limit_ma
        .map(|value| format!("{value} mA"))
        .unwrap_or_else(|| "unknown".to_string());
    format!("PPS3 {pps3}, PD/PPS 5 A {pd_pps_5a}, Type-C {type_c}, SCP {scp}, FCP/AFC/SFCP {fcp}")
}

fn format_power_request(request: &CliPowerRequest) -> String {
    match (request.mv, request.ma) {
        (Some(mv), Some(ma)) => format!("{mv} mV @ {ma} mA"),
        (Some(mv), None) => format!("{mv} mV"),
        (None, Some(ma)) => format!("{ma} mA"),
        (None, None) => "none".to_string(),
    }
}

fn format_output_target(setpoint: &CliPowerSetpoint) -> String {
    match (setpoint.output_enabled, setpoint.mv, setpoint.ilim_ma) {
        (Some(false), _, _) => "disabled".to_string(),
        (Some(true), Some(mv), Some(ilim_ma)) => format!("{mv} mV @ {ilim_ma} mA"),
        (Some(true), Some(mv), None) => format!("{mv} mV"),
        (Some(true), None, Some(ilim_ma)) => format!("{ilim_ma} mA current limit"),
        (Some(true), None, None) => "enabled".to_string(),
        (None, _, _) => "unavailable".to_string(),
    }
}

fn format_faults(diagnostics: &CliPowerDiagnostics) -> String {
    let mut faults = Vec::new();
    if diagnostics.sw2303_error_latched {
        faults.push("USB-C controller fault latched");
    }
    if diagnostics.tps_error_latched {
        faults.push("power-stage fault latched");
    }
    if faults.is_empty() {
        "none".to_string()
    } else {
        faults.join(", ")
    }
}

fn transport_label(device: &Value) -> String {
    let Some(transport) = device.get("transport") else {
        return "(unknown transport)".to_string();
    };
    let kind = transport
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    match kind {
        "usb" => transport
            .get("deviceId")
            .or_else(|| transport.get("device_id"))
            .and_then(Value::as_str)
            .map(|device_id| format!("usb:{device_id}"))
            .unwrap_or_else(|| "usb".to_string()),
        "http" => transport
            .get("baseUrl")
            .or_else(|| transport.get("base_url"))
            .and_then(Value::as_str)
            .map(|base_url| format!("http:{base_url}"))
            .unwrap_or_else(|| "http".to_string()),
        "webSerial" | "web_serial" => "web_serial".to_string(),
        other => other.to_string(),
    }
}

fn parse_one_of(raw: &str, allowed: &[u16], label: &str) -> Result<u16, String> {
    let parsed = raw
        .parse::<u16>()
        .map_err(|_| format!("expected {label}"))?;
    if allowed.contains(&parsed) {
        Ok(parsed)
    } else {
        Err(format!("expected {label}"))
    }
}

fn parse_pps3_limit_ma(raw: &str) -> Result<u16, String> {
    parse_one_of(raw, &[3000, 5000], "3000 or 5000")
}

fn parse_type_c_broadcast_ma(raw: &str) -> Result<u16, String> {
    parse_one_of(raw, &[500, 1500], "500 or 1500")
}

fn parse_fixed_pd_voltages(raw: &str) -> Result<Vec<u16>, String> {
    if raw.trim().is_empty() || raw.trim() == "none" {
        return Ok(Vec::new());
    }

    let mut values = Vec::new();
    for part in raw.split(',') {
        let mv = parse_one_of(
            part.trim(),
            &[9000, 12000, 15000, 20000],
            "9000,12000,15000,20000 or none",
        )?;
        if !values.contains(&mv) {
            values.push(mv);
        }
    }
    values.sort_unstable();
    Ok(values)
}

fn parse_scp_limit_ma(raw: &str) -> Result<u16, String> {
    parse_one_of(raw, &[2000, 4000, 5000], "2000, 4000, or 5000")
}

fn parse_fcp_afc_sfcp_limit_ma(raw: &str) -> Result<u16, String> {
    parse_one_of(raw, &[2250, 3250], "2250 or 3250")
}

fn next_power_owner() -> u32 {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(1);
    let mixed = millis ^ ((std::process::id() as u64) << 16);
    let owner = (mixed as u32) & 0x7fff_ffff;
    owner.max(1)
}

fn set_protocol_flag(protocols: &mut Value, key: &str, enabled: bool) -> anyhow::Result<()> {
    let map = protocols
        .as_object_mut()
        .ok_or_else(|| anyhow!("power config protocols payload is not an object"))?;
    map.insert(key.to_string(), json!(enabled));
    Ok(())
}

fn apply_source_capability_args(
    config: &mut CliPowerConfig,
    args: &SourceCapabilitySetArgs,
) -> anyhow::Result<()> {
    if let Some(power_watts) = args.power_watts {
        config.capability.power_watts = power_watts;
    }
    if let Some(pd) = args.pd {
        set_protocol_flag(&mut config.capability.protocols, "pd", pd)?;
    }
    if let Some(pps) = args.pps {
        config.capability.pd.pps = pps;
    }
    if let Some(qc20) = args.qc20 {
        set_protocol_flag(&mut config.capability.protocols, "qc20", qc20)?;
    }
    if let Some(qc30) = args.qc30 {
        set_protocol_flag(&mut config.capability.protocols, "qc30", qc30)?;
    }
    if let Some(fcp) = args.fcp {
        set_protocol_flag(&mut config.capability.protocols, "fcp", fcp)?;
    }
    if let Some(afc) = args.afc {
        set_protocol_flag(&mut config.capability.protocols, "afc", afc)?;
    }
    if let Some(scp) = args.scp {
        set_protocol_flag(&mut config.capability.protocols, "scp", scp)?;
    }
    if let Some(pe20) = args.pe20 {
        set_protocol_flag(&mut config.capability.protocols, "pe20", pe20)?;
    }
    if let Some(bc12) = args.bc12 {
        set_protocol_flag(&mut config.capability.protocols, "bc12", bc12)?;
    }
    if let Some(sfcp) = args.sfcp {
        set_protocol_flag(&mut config.capability.protocols, "sfcp", sfcp)?;
    }
    if let Some(fixed_pd_voltages) = &args.fixed_pd_voltages {
        config.capability.pd.fixed_voltages_mv =
            parse_fixed_pd_voltages(fixed_pd_voltages).map_err(|err| anyhow!(err))?;
    }
    if let Some(pps3_limit_ma) = args.pps3_limit_ma {
        config.capability.current.pps3_limit_ma = pps3_limit_ma;
    }
    if let Some(pd_pps_5a) = args.pd_pps_5a {
        config.capability.current.pd_pps_5a = pd_pps_5a;
    }
    if let Some(type_c_broadcast_ma) = args.type_c_broadcast_ma {
        config.capability.current.type_c_broadcast_ma = type_c_broadcast_ma;
    }
    if let Some(scp_limit_ma) = args.scp_limit_ma {
        config.capability.current.scp_limit_ma = scp_limit_ma;
    }
    if let Some(fcp_afc_sfcp_limit_ma) = args.fcp_afc_sfcp_limit_ma {
        config.capability.current.fcp_afc_sfcp_limit_ma = fcp_afc_sfcp_limit_ma;
    }
    Ok(())
}

fn apply_manual_output_args(config: &mut CliPowerConfig, args: &ManualOutputArgs) {
    if let Some(voltage_mv) = args.voltage_mv {
        config.manual.voltage_mv = voltage_mv;
    }
    if let Some(current_limit_ma) = args.current_limit_ma {
        config.manual.current_limit_ma = current_limit_ma;
    }
    if let Some(usb_c_path) = args.usb_c_path {
        config.manual.usb_c_path_mode = usb_c_path.as_config_value().to_string();
    }
}

fn power_config_update_payload(config: &CliPowerConfig) -> Value {
    json!({
        "hardware": config.hardware,
        "tps_mode": config.tps_mode,
        "voltage_mv": config.manual.voltage_mv,
        "current_limit_ma": config.manual.current_limit_ma,
        "usb_c_path_mode": config.manual.usb_c_path_mode,
        "power_watts": config.capability.power_watts,
        "pd": protocol_enabled(&config.capability.protocols, "pd"),
        "qc20": protocol_enabled(&config.capability.protocols, "qc20"),
        "qc30": protocol_enabled(&config.capability.protocols, "qc30"),
        "fcp": protocol_enabled(&config.capability.protocols, "fcp"),
        "afc": protocol_enabled(&config.capability.protocols, "afc"),
        "scp": protocol_enabled(&config.capability.protocols, "scp"),
        "pe20": protocol_enabled(&config.capability.protocols, "pe20"),
        "bc12": protocol_enabled(&config.capability.protocols, "bc12"),
        "sfcp": protocol_enabled(&config.capability.protocols, "sfcp"),
        "pps": config.capability.pd.pps,
        "fixed_voltages_mv": config.capability.pd.fixed_voltages_mv,
        "pps3_limit_ma": config.capability.current.pps3_limit_ma,
        "pd_pps_5a": config.capability.current.pd_pps_5a,
        "type_c_broadcast_ma": config.capability.current.type_c_broadcast_ma,
        "scp_limit_ma": config.capability.current.scp_limit_ma,
        "fcp_afc_sfcp_limit_ma": config.capability.current.fcp_afc_sfcp_limit_ma,
    })
}

fn same_power_config_contents(left: &CliPowerConfig, right: &CliPowerConfig) -> bool {
    left.hardware == right.hardware
        && left.tps_mode == right.tps_mode
        && left.capability == right.capability
        && left.manual == right.manual
}

fn full_power_capability_defaults() -> CliPowerCapability {
    CliPowerCapability {
        profile: "full".to_string(),
        power_watts: 100,
        protocols: json!({
            "pd": true,
            "qc20": true,
            "qc30": true,
            "fcp": true,
            "afc": true,
            "scp": true,
            "pe20": true,
            "bc12": true,
            "sfcp": true,
        }),
        pd: CliPowerPd {
            pps: true,
            fixed_voltages_mv: vec![9000, 12000, 15000, 20000],
        },
        current: CliPowerCurrentProfile::default(),
    }
}

fn expected_default_power_config(current: &CliPowerConfig) -> CliPowerConfig {
    let mut expected = current.clone();
    expected.tps_mode = "auto_follow".to_string();
    expected.capability = full_power_capability_defaults();
    expected.manual = CliPowerManual {
        voltage_mv: MANUAL_OUTPUT_DEFAULT_VOLTAGE_MV,
        current_limit_ma: MANUAL_OUTPUT_DEFAULT_CURRENT_MA,
        usb_c_path_mode: "default".to_string(),
        path_policy: current
            .manual
            .path_policy
            .clone()
            .or_else(|| Some("auto".to_string())),
    };
    expected
}

async fn save_power_config_with_timeout_recovery(
    client: &Client,
    devd: &DevdClient,
    selector: &ApiSelectorArgs,
    owner: u32,
    config: &CliPowerConfig,
) -> anyhow::Result<Value> {
    let request = request_selected(
        client,
        devd,
        selector.clone(),
        Method::PUT,
        &format!("/power/config?owner={owner}"),
        Some(power_config_update_payload(config)),
    )
    .await;

    match request {
        Ok(value) => Ok(value),
        Err(err) if err.to_string().contains("serial response timed out") => {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let observed = fetch_power_config(client, devd, selector).await?;
            if same_power_config_contents(&observed, config) {
                Ok(serde_json::to_value(observed)?)
            } else {
                Err(err)
            }
        }
        Err(err) => Err(err),
    }
}

async fn restore_power_defaults_with_timeout_recovery(
    client: &Client,
    devd: &DevdClient,
    selector: &ApiSelectorArgs,
    owner: u32,
) -> anyhow::Result<Value> {
    let expected =
        expected_default_power_config(&fetch_power_config(client, devd, selector).await?);
    let request = request_selected(
        client,
        devd,
        selector.clone(),
        Method::POST,
        &format!("/power/config/defaults?owner={owner}"),
        None,
    )
    .await;

    match request {
        Ok(value) => Ok(value),
        Err(err) if err.to_string().contains("serial response timed out") => {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let observed = fetch_power_config(client, devd, selector).await?;
            if same_power_config_contents(&observed, &expected) {
                Ok(serde_json::to_value(observed)?)
            } else {
                Err(err)
            }
        }
        Err(err) => Err(err),
    }
}

fn protocol_enabled(protocols: &Value, key: &str) -> bool {
    protocols.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn on_off(value: bool) -> &'static str {
    if value { "on" } else { "off" }
}

fn toggle_fixed_pd_voltage(config: &mut CliPowerConfig, mv: u16) {
    if let Some(index) = config
        .capability
        .pd
        .fixed_voltages_mv
        .iter()
        .position(|value| *value == mv)
    {
        config.capability.pd.fixed_voltages_mv.remove(index);
    } else {
        config.capability.pd.fixed_voltages_mv.push(mv);
        config.capability.pd.fixed_voltages_mv.sort_unstable();
    }
}

const POWER_WATT_PRESETS: [u8; 6] = [15, 27, 45, 60, 65, 100];
const FIXED_PD_OPTIONS: [u16; 4] = [9000, 12000, 15000, 20000];
const ACTION_OPTIONS: [&str; 3] = ["Save and apply", "Reload from hardware", "Cancel"];

#[derive(Clone, Copy)]
enum SourceCapabilityEditorRow {
    PowerWatts,
    Pd,
    Pps,
    Qc20,
    Qc30,
    Fcp,
    Afc,
    Scp,
    Pe20,
    Bc12,
    Sfcp,
    FixedPd,
    Pps3Limit,
    PdPps5a,
    TypeCBroadcast,
    ScpLimit,
    FcpAfcSfcpLimit,
    Actions,
}

const SOURCE_CAPABILITY_EDITOR_ROWS: [SourceCapabilityEditorRow; 18] = [
    SourceCapabilityEditorRow::PowerWatts,
    SourceCapabilityEditorRow::Pd,
    SourceCapabilityEditorRow::Pps,
    SourceCapabilityEditorRow::Qc20,
    SourceCapabilityEditorRow::Qc30,
    SourceCapabilityEditorRow::Fcp,
    SourceCapabilityEditorRow::Afc,
    SourceCapabilityEditorRow::Scp,
    SourceCapabilityEditorRow::Pe20,
    SourceCapabilityEditorRow::Bc12,
    SourceCapabilityEditorRow::Sfcp,
    SourceCapabilityEditorRow::FixedPd,
    SourceCapabilityEditorRow::Pps3Limit,
    SourceCapabilityEditorRow::PdPps5a,
    SourceCapabilityEditorRow::TypeCBroadcast,
    SourceCapabilityEditorRow::ScpLimit,
    SourceCapabilityEditorRow::FcpAfcSfcpLimit,
    SourceCapabilityEditorRow::Actions,
];

struct SourceCapabilityEditorState {
    selected_row: usize,
    fixed_pd_focus: usize,
    action_focus: usize,
}

impl Default for SourceCapabilityEditorState {
    fn default() -> Self {
        Self {
            selected_row: 0,
            fixed_pd_focus: 0,
            action_focus: 0,
        }
    }
}

fn power_watt_choices(current: u8) -> Vec<u8> {
    let mut choices = POWER_WATT_PRESETS.to_vec();
    if !choices.contains(&current) {
        choices.push(current);
        choices.sort_unstable();
    }
    choices
}

fn cycle_choice<T: Copy + PartialEq>(current: T, choices: &[T], direction: i8) -> T {
    let len = choices.len();
    if len == 0 {
        return current;
    }
    let current_index = choices
        .iter()
        .position(|choice| *choice == current)
        .unwrap_or(0);
    let next_index = match direction.cmp(&0) {
        std::cmp::Ordering::Less => current_index.checked_sub(1).unwrap_or(len - 1),
        std::cmp::Ordering::Equal => current_index,
        std::cmp::Ordering::Greater => (current_index + 1) % len,
    };
    choices[next_index]
}

fn cycle_index(current: usize, len: usize, direction: i8) -> usize {
    if len == 0 {
        return current;
    }
    match direction.cmp(&0) {
        std::cmp::Ordering::Less => current.checked_sub(1).unwrap_or(len - 1),
        std::cmp::Ordering::Equal => current,
        std::cmp::Ordering::Greater => (current + 1) % len,
    }
}

fn with_tui_terminal<T>(
    run: impl FnOnce(&mut DefaultTerminal) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let mut terminal = ratatui::init();
    let result = run(&mut terminal);
    ratatui::restore();
    result
}

fn draw_tui_list_menu(
    frame: &mut Frame<'_>,
    title: &str,
    subtitle: Option<&str>,
    items: &[String],
    footer: &[&str],
    selected: usize,
) {
    let outer = Block::bordered().title(title);
    let inner = outer.inner(frame.area());
    frame.render_widget(outer, frame.area());

    let subtitle_height = subtitle
        .map(|text| text.lines().count().max(1) as u16 + 1)
        .unwrap_or(0);
    let footer_height = if footer.is_empty() {
        0
    } else {
        footer.len() as u16 + 1
    };
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(subtitle_height),
            Constraint::Min(1),
            Constraint::Length(footer_height),
        ])
        .split(inner);

    if let Some(subtitle) = subtitle {
        frame.render_widget(
            Paragraph::new(subtitle).wrap(Wrap { trim: false }),
            sections[0],
        );
    }

    let list_items = items
        .iter()
        .map(|item| ListItem::new(item.as_str()))
        .collect::<Vec<_>>();
    let list = List::new(list_items).highlight_symbol("› ");
    let mut state = ListState::default();
    state.select(Some(selected.min(items.len().saturating_sub(1))));
    frame.render_stateful_widget(list, sections[1], &mut state);

    if !footer.is_empty() {
        let footer_text = Text::from(
            footer
                .iter()
                .map(|line| {
                    Line::from(Span::styled(
                        (*line).to_string(),
                        Style::default().fg(Color::DarkGray),
                    ))
                })
                .collect::<Vec<_>>(),
        );
        frame.render_widget(Paragraph::new(footer_text), sections[2]);
    }
}

fn run_tui_list_menu(
    title: &str,
    subtitle: Option<&str>,
    items: &[String],
    footer: &[&str],
) -> anyhow::Result<Option<usize>> {
    with_tui_terminal(|terminal| {
        let mut selected = 0usize;
        loop {
            terminal.draw(|frame| {
                draw_tui_list_menu(frame, title, subtitle, items, footer, selected)
            })?;
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => match key.code {
                    KeyCode::Up => {
                        selected = cycle_index(selected, items.len(), -1);
                    }
                    KeyCode::Down => {
                        selected = cycle_index(selected, items.len(), 1);
                    }
                    KeyCode::Enter => return Ok(Some(selected)),
                    KeyCode::Esc => return Ok(None),
                    _ => {}
                },
                _ => {}
            }
        }
    })
}

fn field_label(label: &str, selected: bool) -> Span<'static> {
    Span::styled(
        format!("{label}: "),
        if selected {
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().add_modifier(Modifier::BOLD)
        },
    )
}

fn choice_chip(label: impl Into<String>, active: bool, focused: bool) -> Span<'static> {
    let label = label.into();
    let text = if active {
        format!("[{label}]")
    } else {
        format!(" {label} ")
    };
    let style = match (active, focused) {
        (true, true) => Style::default()
            .fg(Color::Black)
            .bg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
        (false, true) => Style::default()
            .fg(Color::Black)
            .bg(Color::DarkGray)
            .add_modifier(Modifier::BOLD),
        (true, false) => Style::default()
            .fg(Color::Green)
            .add_modifier(Modifier::BOLD),
        (false, false) => Style::default().fg(Color::DarkGray),
    };
    Span::styled(text, style)
}

fn append_choice(
    spans: &mut Vec<Span<'static>>,
    label: impl Into<String>,
    active: bool,
    focused: bool,
) {
    spans.push(choice_chip(label, active, focused));
    spans.push(Span::raw(" "));
}

fn make_choice_row(
    label: &str,
    choices: impl IntoIterator<Item = (String, bool, bool)>,
    selected: bool,
) -> ListItem<'static> {
    let mut spans = vec![field_label(label, selected)];
    for (choice_label, active, focused) in choices {
        append_choice(&mut spans, choice_label, active, focused);
    }
    if spans
        .last()
        .is_some_and(|span| span.content.as_ref() == " ")
    {
        spans.pop();
    }
    ListItem::new(Line::from(spans))
}

fn render_source_capability_row(
    config: &CliPowerConfig,
    state: &SourceCapabilityEditorState,
    row_index: usize,
) -> ListItem<'static> {
    let row = SOURCE_CAPABILITY_EDITOR_ROWS[row_index];
    let selected = state.selected_row == row_index;
    match row {
        SourceCapabilityEditorRow::PowerWatts => {
            let current = config.capability.power_watts;
            let choices = power_watt_choices(current).into_iter().map(|value| {
                (
                    format!("{value} W"),
                    value == current,
                    selected && value == current,
                )
            });
            make_choice_row("Power cap", choices, selected)
        }
        SourceCapabilityEditorRow::Pd => make_choice_row(
            "PD",
            [false, true].into_iter().map(|value| {
                let active = protocol_enabled(&config.capability.protocols, "pd") == value;
                (on_off(value).to_string(), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::Pps => make_choice_row(
            "PPS",
            [false, true].into_iter().map(|value| {
                let active = config.capability.pd.pps == value;
                (on_off(value).to_string(), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::Qc20 => make_choice_row(
            "QC2.0",
            [false, true].into_iter().map(|value| {
                let active = protocol_enabled(&config.capability.protocols, "qc20") == value;
                (on_off(value).to_string(), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::Qc30 => make_choice_row(
            "QC3.0",
            [false, true].into_iter().map(|value| {
                let active = protocol_enabled(&config.capability.protocols, "qc30") == value;
                (on_off(value).to_string(), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::Fcp => make_choice_row(
            "FCP",
            [false, true].into_iter().map(|value| {
                let active = protocol_enabled(&config.capability.protocols, "fcp") == value;
                (on_off(value).to_string(), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::Afc => make_choice_row(
            "AFC",
            [false, true].into_iter().map(|value| {
                let active = protocol_enabled(&config.capability.protocols, "afc") == value;
                (on_off(value).to_string(), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::Scp => make_choice_row(
            "SCP",
            [false, true].into_iter().map(|value| {
                let active = protocol_enabled(&config.capability.protocols, "scp") == value;
                (on_off(value).to_string(), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::Pe20 => make_choice_row(
            "PE2.0",
            [false, true].into_iter().map(|value| {
                let active = protocol_enabled(&config.capability.protocols, "pe20") == value;
                (on_off(value).to_string(), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::Bc12 => make_choice_row(
            "BC1.2",
            [false, true].into_iter().map(|value| {
                let active = protocol_enabled(&config.capability.protocols, "bc12") == value;
                (on_off(value).to_string(), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::Sfcp => make_choice_row(
            "SFCP",
            [false, true].into_iter().map(|value| {
                let active = protocol_enabled(&config.capability.protocols, "sfcp") == value;
                (on_off(value).to_string(), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::FixedPd => make_choice_row(
            "Fixed PD",
            FIXED_PD_OPTIONS.iter().enumerate().map(|(index, value)| {
                (
                    format!("{}V", value / 1000),
                    config.capability.pd.fixed_voltages_mv.contains(value),
                    selected && state.fixed_pd_focus == index,
                )
            }),
            selected,
        ),
        SourceCapabilityEditorRow::Pps3Limit => make_choice_row(
            "PPS3 limit",
            [3000_u16, 5000].into_iter().map(|value| {
                let active = config.capability.current.pps3_limit_ma == value;
                (format!("{value} mA"), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::PdPps5a => make_choice_row(
            "PD/PPS 5 A",
            [false, true].into_iter().map(|value| {
                let active = config.capability.current.pd_pps_5a == value;
                (on_off(value).to_string(), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::TypeCBroadcast => make_choice_row(
            "Type-C current",
            [500_u16, 1500].into_iter().map(|value| {
                let active = config.capability.current.type_c_broadcast_ma == value;
                (format!("{value} mA"), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::ScpLimit => make_choice_row(
            "SCP current",
            [2000_u16, 4000, 5000].into_iter().map(|value| {
                let active = config.capability.current.scp_limit_ma == value;
                (format!("{value} mA"), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::FcpAfcSfcpLimit => make_choice_row(
            "FCP/AFC/SFCP current",
            [2250_u16, 3250].into_iter().map(|value| {
                let active = config.capability.current.fcp_afc_sfcp_limit_ma == value;
                (format!("{value} mA"), active, selected && active)
            }),
            selected,
        ),
        SourceCapabilityEditorRow::Actions => make_choice_row(
            "Action",
            ACTION_OPTIONS.iter().enumerate().map(|(index, label)| {
                (
                    (*label).to_string(),
                    false,
                    selected && state.action_focus == index,
                )
            }),
            selected,
        ),
    }
}

fn draw_source_capability_editor(
    frame: &mut Frame<'_>,
    diagnostics: &str,
    config: &CliPowerConfig,
    state: &SourceCapabilityEditorState,
) {
    let outer = Block::bordered().title("Source capability editor");
    let inner = outer.inner(frame.area());
    frame.render_widget(outer, frame.area());

    let status_lines = diagnostics.lines().count().max(1) as u16;
    let footer_lines = 2_u16;
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(status_lines + 1),
            Constraint::Min(10),
            Constraint::Length(footer_lines),
        ])
        .split(inner);

    frame.render_widget(
        Paragraph::new(diagnostics.to_string()).wrap(Wrap { trim: false }),
        sections[0],
    );

    let items = SOURCE_CAPABILITY_EDITOR_ROWS
        .iter()
        .enumerate()
        .map(|(index, _)| render_source_capability_row(config, state, index))
        .collect::<Vec<_>>();
    let list = List::new(items).highlight_symbol("› ");
    let mut list_state = ListState::default();
    list_state.select(Some(state.selected_row));
    frame.render_stateful_widget(list, sections[1], &mut list_state);

    let footer = Text::from(vec![
        Line::from("Use Up/Down to choose a field. Use Left/Right to change the current field."),
        Line::from(
            "Press Enter/Space to toggle the focused chip. Use the Action row to save, reload, or cancel.",
        ),
    ]);
    frame.render_widget(
        Paragraph::new(footer).style(Style::default().fg(Color::DarkGray)),
        sections[2],
    );
}

fn apply_row_direction(
    config: &mut CliPowerConfig,
    state: &mut SourceCapabilityEditorState,
    direction: i8,
) -> anyhow::Result<()> {
    match SOURCE_CAPABILITY_EDITOR_ROWS[state.selected_row] {
        SourceCapabilityEditorRow::PowerWatts => {
            let choices = power_watt_choices(config.capability.power_watts);
            config.capability.power_watts =
                cycle_choice(config.capability.power_watts, &choices, direction);
        }
        SourceCapabilityEditorRow::Pd => {
            let next = cycle_choice(
                protocol_enabled(&config.capability.protocols, "pd"),
                &[false, true],
                direction,
            );
            set_protocol_flag(&mut config.capability.protocols, "pd", next)?;
        }
        SourceCapabilityEditorRow::Pps => {
            config.capability.pd.pps =
                cycle_choice(config.capability.pd.pps, &[false, true], direction);
        }
        SourceCapabilityEditorRow::Qc20 => {
            let next = cycle_choice(
                protocol_enabled(&config.capability.protocols, "qc20"),
                &[false, true],
                direction,
            );
            set_protocol_flag(&mut config.capability.protocols, "qc20", next)?;
        }
        SourceCapabilityEditorRow::Qc30 => {
            let next = cycle_choice(
                protocol_enabled(&config.capability.protocols, "qc30"),
                &[false, true],
                direction,
            );
            set_protocol_flag(&mut config.capability.protocols, "qc30", next)?;
        }
        SourceCapabilityEditorRow::Fcp => {
            let next = cycle_choice(
                protocol_enabled(&config.capability.protocols, "fcp"),
                &[false, true],
                direction,
            );
            set_protocol_flag(&mut config.capability.protocols, "fcp", next)?;
        }
        SourceCapabilityEditorRow::Afc => {
            let next = cycle_choice(
                protocol_enabled(&config.capability.protocols, "afc"),
                &[false, true],
                direction,
            );
            set_protocol_flag(&mut config.capability.protocols, "afc", next)?;
        }
        SourceCapabilityEditorRow::Scp => {
            let next = cycle_choice(
                protocol_enabled(&config.capability.protocols, "scp"),
                &[false, true],
                direction,
            );
            set_protocol_flag(&mut config.capability.protocols, "scp", next)?;
        }
        SourceCapabilityEditorRow::Pe20 => {
            let next = cycle_choice(
                protocol_enabled(&config.capability.protocols, "pe20"),
                &[false, true],
                direction,
            );
            set_protocol_flag(&mut config.capability.protocols, "pe20", next)?;
        }
        SourceCapabilityEditorRow::Bc12 => {
            let next = cycle_choice(
                protocol_enabled(&config.capability.protocols, "bc12"),
                &[false, true],
                direction,
            );
            set_protocol_flag(&mut config.capability.protocols, "bc12", next)?;
        }
        SourceCapabilityEditorRow::Sfcp => {
            let next = cycle_choice(
                protocol_enabled(&config.capability.protocols, "sfcp"),
                &[false, true],
                direction,
            );
            set_protocol_flag(&mut config.capability.protocols, "sfcp", next)?;
        }
        SourceCapabilityEditorRow::FixedPd => {
            state.fixed_pd_focus =
                cycle_index(state.fixed_pd_focus, FIXED_PD_OPTIONS.len(), direction);
        }
        SourceCapabilityEditorRow::Pps3Limit => {
            config.capability.current.pps3_limit_ma = cycle_choice(
                config.capability.current.pps3_limit_ma,
                &[3000, 5000],
                direction,
            );
        }
        SourceCapabilityEditorRow::PdPps5a => {
            config.capability.current.pd_pps_5a = cycle_choice(
                config.capability.current.pd_pps_5a,
                &[false, true],
                direction,
            );
        }
        SourceCapabilityEditorRow::TypeCBroadcast => {
            config.capability.current.type_c_broadcast_ma = cycle_choice(
                config.capability.current.type_c_broadcast_ma,
                &[500, 1500],
                direction,
            );
        }
        SourceCapabilityEditorRow::ScpLimit => {
            config.capability.current.scp_limit_ma = cycle_choice(
                config.capability.current.scp_limit_ma,
                &[2000, 4000, 5000],
                direction,
            );
        }
        SourceCapabilityEditorRow::FcpAfcSfcpLimit => {
            config.capability.current.fcp_afc_sfcp_limit_ma = cycle_choice(
                config.capability.current.fcp_afc_sfcp_limit_ma,
                &[2250, 3250],
                direction,
            );
        }
        SourceCapabilityEditorRow::Actions => {
            state.action_focus = cycle_index(state.action_focus, ACTION_OPTIONS.len(), direction);
        }
    }
    Ok(())
}

enum EditorSubmit {
    Continue,
    Save,
    Reload,
    Cancel,
}

fn submit_editor_row(
    config: &mut CliPowerConfig,
    state: &mut SourceCapabilityEditorState,
) -> anyhow::Result<EditorSubmit> {
    Ok(match SOURCE_CAPABILITY_EDITOR_ROWS[state.selected_row] {
        SourceCapabilityEditorRow::FixedPd => {
            toggle_fixed_pd_voltage(config, FIXED_PD_OPTIONS[state.fixed_pd_focus]);
            EditorSubmit::Continue
        }
        SourceCapabilityEditorRow::Actions => match state.action_focus {
            0 => EditorSubmit::Save,
            1 => EditorSubmit::Reload,
            _ => EditorSubmit::Cancel,
        },
        _ => {
            apply_row_direction(config, state, 1)?;
            EditorSubmit::Continue
        }
    })
}

fn run_source_capability_editor_tui(
    config: &mut CliPowerConfig,
    diagnostics: &str,
) -> anyhow::Result<EditorSubmit> {
    let mut state = SourceCapabilityEditorState::default();
    with_tui_terminal(|terminal| {
        loop {
            terminal
                .draw(|frame| draw_source_capability_editor(frame, diagnostics, config, &state))?;
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => match key.code {
                    KeyCode::Up => {
                        state.selected_row = cycle_index(
                            state.selected_row,
                            SOURCE_CAPABILITY_EDITOR_ROWS.len(),
                            -1,
                        );
                    }
                    KeyCode::Down => {
                        state.selected_row =
                            cycle_index(state.selected_row, SOURCE_CAPABILITY_EDITOR_ROWS.len(), 1);
                    }
                    KeyCode::Left => apply_row_direction(config, &mut state, -1)?,
                    KeyCode::Right => apply_row_direction(config, &mut state, 1)?,
                    KeyCode::Enter | KeyCode::Char(' ') => {
                        let submit = submit_editor_row(config, &mut state)?;
                        if !matches!(submit, EditorSubmit::Continue) {
                            return Ok(submit);
                        }
                    }
                    KeyCode::Esc => return Ok(EditorSubmit::Cancel),
                    _ => {}
                },
                _ => {}
            }
        }
    })
}

async fn fetch_power_config(
    client: &Client,
    devd: &DevdClient,
    selector: &ApiSelectorArgs,
) -> anyhow::Result<CliPowerConfig> {
    let current = request_selected(
        client,
        devd,
        selector.clone(),
        Method::GET,
        "/power/config",
        None,
    )
    .await?;
    Ok(serde_json::from_value(unwrap_device_success_result(
        current,
    )?)?)
}

async fn fetch_power_diagnostics(
    client: &Client,
    devd: &DevdClient,
    selector: &ApiSelectorArgs,
) -> anyhow::Result<CliPowerDiagnostics> {
    let current = request_selected(
        client,
        devd,
        selector.clone(),
        Method::GET,
        "/diagnostics",
        None,
    )
    .await?;
    Ok(serde_json::from_value(unwrap_device_success_result(
        current,
    )?)?)
}

fn saved_hardware_target_label(device: &DeviceProfile) -> String {
    let target = match &device.transport {
        HardwareTransport::Usb { device_id, .. } => format!("usb {device_id}"),
        HardwareTransport::Http { base_url } => format!("http {base_url}"),
        HardwareTransport::WebSerial { label } => label
            .as_ref()
            .map(|value| format!("web-serial {value}"))
            .unwrap_or_else(|| "web-serial".to_string()),
    };
    format!("{} ({}) - {}", device.name, device.id, target)
}

fn power_selector_to_api_selector(selector: PowerSelectorArgs) -> ApiSelectorArgs {
    ApiSelectorArgs {
        hardware: selector.hardware,
        device: None,
        url: None,
    }
}

async fn select_saved_power_target_interactively(
    selector: PowerSelectorArgs,
) -> anyhow::Result<ApiSelectorArgs> {
    if !selector.is_empty() {
        return Ok(power_selector_to_api_selector(selector));
    }
    if !io::stdin().is_terminal() {
        return Err(anyhow!(
            "select --hardware; interactive power target selection requires a terminal"
        ));
    }

    let mut saved = read_hardware_registry()?.devices;
    saved.retain(|device| !matches!(device.transport, HardwareTransport::WebSerial { .. }));
    saved.sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));

    if saved.is_empty() {
        return Err(anyhow!(
            "no saved hardware is available; bind hardware first with `isolapurr hardware save`"
        ));
    }

    if saved.len() == 1 {
        return Ok(ApiSelectorArgs {
            hardware: Some(saved.remove(0).id),
            device: None,
            url: None,
        });
    }

    let items = saved
        .iter()
        .map(saved_hardware_target_label)
        .collect::<Vec<_>>();
    let selected = run_tui_list_menu(
        "Select saved hardware for power control",
        Some("Only saved hardware is shown. Use Up/Down to move, Enter to select, Esc to cancel."),
        &items,
        &[],
    )?;
    let Some(selected) = selected else {
        return Err(UserCancelled.into());
    };
    Ok(ApiSelectorArgs {
        hardware: Some(saved.swap_remove(selected).id),
        device: None,
        url: None,
    })
}

async fn select_api_target_interactively(
    client: &Client,
    devd: &DevdClient,
    selector: ApiSelectorArgs,
) -> anyhow::Result<ApiSelectorArgs> {
    if !selector.is_empty() {
        return Ok(selector);
    }
    if !io::stdin().is_terminal() {
        return Err(anyhow!(
            "select one of --hardware, --device, or --url; interactive device selection requires a terminal"
        ));
    }

    let scanned = devd_request(client, devd, Method::POST, "/api/v1/devices/scan", None).await?;
    let devices = scanned
        .get("devices")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("device scan returned no device list"))?
        .iter()
        .cloned()
        .map(serde_json::from_value::<DeviceRecord>)
        .collect::<Result<Vec<_>, _>>()?;

    if devices.is_empty() {
        return Err(anyhow!(
            "no devd devices found; connect hardware or pass --hardware/--device/--url explicitly"
        ));
    }

    let mut compatible = Vec::new();
    let mut rejected = Vec::new();
    for device in devices {
        let selector = ApiSelectorArgs {
            hardware: None,
            device: Some(device.id.clone()),
            url: None,
        };
        match request_selected(client, devd, selector.clone(), Method::GET, "/status", None).await {
            Ok(_) => compatible.push((device, selector)),
            Err(err) => rejected.push(format!("{} ({}) - {}", device.display_name, device.id, err)),
        }
    }

    if compatible.is_empty() {
        let mut message =
            String::from("no compatible IsolaPurr devices were found in the current scan");
        if !rejected.is_empty() {
            message.push_str(":\n");
            message.push_str(&rejected.join("\n"));
        }
        return Err(anyhow!(message));
    }

    if compatible.len() == 1 {
        return Ok(compatible.remove(0).1);
    }

    let items = compatible
        .iter()
        .map(|(device, _selector)| {
            let target = if let Some(usb) = &device.usb {
                format!("usb {}", usb.port_path)
            } else if let Some(http) = &device.http {
                format!("http {}", http.base_url)
            } else {
                device.connection.clone()
            };
            format!("{} ({}) - {}", device.display_name, device.id, target)
        })
        .collect::<Vec<_>>();
    let selected = run_tui_list_menu(
        "Select a device for source-capability editing",
        Some(
            "Only compatible IsolaPurr devices are shown. Use Up/Down to move, Enter to select, Esc to cancel.",
        ),
        &items,
        &[],
    )?;
    let Some(selected) = selected else {
        return Err(UserCancelled.into());
    };
    Ok(compatible.swap_remove(selected).1)
}

async fn run_source_capability_interactive(
    client: &Client,
    devd: &DevdClient,
    selector: ApiSelectorArgs,
) -> anyhow::Result<Value> {
    if !io::stdin().is_terminal() {
        return Err(anyhow!(
            "interactive source-capability editing requires a terminal; pass flags for non-interactive use"
        ));
    }

    let selector = select_api_target_interactively(client, devd, selector).await?;
    let mut config = fetch_power_config(client, devd, &selector).await?;
    let mut diagnostics = fetch_power_diagnostics(client, devd, &selector).await?;

    loop {
        let status = format_live_power_output(&serde_json::to_value(&diagnostics)?);
        match run_source_capability_editor_tui(&mut config, status.trim_end())? {
            EditorSubmit::Continue => continue,
            EditorSubmit::Save => {
                let owner = next_power_owner();
                return save_power_config_with_timeout_recovery(
                    client, devd, &selector, owner, &config,
                )
                .await;
            }
            EditorSubmit::Reload => {
                config = fetch_power_config(client, devd, &selector).await?;
                diagnostics = fetch_power_diagnostics(client, devd, &selector).await?;
            }
            EditorSubmit::Cancel => return Err(UserCancelled.into()),
        }
    }
}

async fn handle_power(
    client: &Client,
    devd: &DevdClient,
    command: PowerCommand,
    allow_interactive: bool,
) -> anyhow::Result<Value> {
    match command {
        PowerCommand::Show(selector) => {
            let selector =
                maybe_select_power_target(client, devd, selector, allow_interactive).await?;
            let config = unwrap_device_success_result(
                request_selected(
                    client,
                    devd,
                    selector.clone(),
                    Method::GET,
                    "/power/config",
                    None,
                )
                .await?,
            )?;
            let diagnostics = unwrap_device_success_result(
                request_selected(client, devd, selector, Method::GET, "/diagnostics", None).await?,
            )?;
            Ok(json!({
                "config": config,
                "diagnostics": diagnostics,
            }))
        }
        PowerCommand::Defaults { selector } => {
            let selector =
                maybe_select_power_target(client, devd, selector, allow_interactive).await?;
            let owner = next_power_owner();
            unwrap_device_success_result(
                restore_power_defaults_with_timeout_recovery(client, devd, &selector, owner)
                    .await?,
            )
        }
        PowerCommand::Output { command } => match command {
            OutputCommand::Manual { selector, args } => {
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                let owner = next_power_owner();
                let mut config = fetch_power_config(client, devd, &selector).await?;
                config.tps_mode = "manual".to_string();
                apply_manual_output_args(&mut config, &args);
                unwrap_device_success_result(
                    save_power_config_with_timeout_recovery(
                        client, devd, &selector, owner, &config,
                    )
                    .await?,
                )
            }
            OutputCommand::Auto { selector } => {
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                let owner = next_power_owner();
                let mut config = fetch_power_config(client, devd, &selector).await?;
                config.tps_mode = "auto_follow".to_string();
                unwrap_device_success_result(
                    save_power_config_with_timeout_recovery(
                        client, devd, &selector, owner, &config,
                    )
                    .await?,
                )
            }
        },
        PowerCommand::SourceCapability { command } => match command {
            SourceCapabilityCommand::Set { selector, args } => {
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                if !args.has_updates() {
                    if !allow_interactive {
                        return Err(anyhow!(
                            "interactive source-capability editing is unavailable with --json; pass one or more update flags"
                        ));
                    }
                    return run_source_capability_interactive(client, devd, selector).await;
                }
                let owner = next_power_owner();
                let mut config = fetch_power_config(client, devd, &selector).await?;
                apply_source_capability_args(&mut config, &args)?;
                unwrap_device_success_result(
                    save_power_config_with_timeout_recovery(
                        client, devd, &selector, owner, &config,
                    )
                    .await?,
                )
            }
        },
    }
}

async fn maybe_select_power_target(
    _client: &Client,
    _devd: &DevdClient,
    selector: PowerSelectorArgs,
    allow_interactive: bool,
) -> anyhow::Result<ApiSelectorArgs> {
    if allow_interactive {
        select_saved_power_target_interactively(selector).await
    } else {
        Ok(power_selector_to_api_selector(selector))
    }
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
        ("GET", "power/config") => "device.power.config_get",
        ("PUT", "power/config") => {
            let config = body.ok_or_else(|| anyhow!("power config body is required"))?;
            params_map.insert("config".to_string(), config);
            if let Some(owner) = query
                .split('&')
                .find_map(|part| part.strip_prefix("owner="))
                .and_then(|owner| owner.parse::<u32>().ok())
            {
                params_map.insert("owner".to_string(), json!(owner));
            }
            "device.power.config_set"
        }
        ("POST", "power/config/defaults") => {
            if let Some(owner) = query
                .split('&')
                .find_map(|part| part.strip_prefix("owner="))
                .and_then(|owner| owner.parse::<u32>().ok())
            {
                params_map.insert("owner".to_string(), json!(owner));
            }
            "device.power.config_defaults"
        }
        ("POST", "power/config/lock") => {
            let owner = query
                .split('&')
                .find_map(|part| part.strip_prefix("owner="))
                .ok_or_else(|| anyhow!("owner query is required"))?
                .parse::<u32>()
                .context("owner must be a non-zero integer")?;
            params_map.insert("owner".to_string(), json!(owner));
            params_map.insert("acquire".to_string(), json!(true));
            "device.power.lock"
        }
        ("POST", "power/config/release") => {
            let owner = query
                .split('&')
                .find_map(|part| part.strip_prefix("owner="))
                .ok_or_else(|| anyhow!("owner query is required"))?
                .parse::<u32>()
                .context("owner must be a non-zero integer")?;
            params_map.insert("owner".to_string(), json!(owner));
            params_map.insert("acquire".to_string(), json!(false));
            "device.power.lock"
        }
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
        ("GET", "/power/config") => (method, "/api/v1/power/config".to_string(), body),
        ("PUT", _) if suffix.starts_with("/power/config?owner=") => {
            (Method::PUT, format!("/api/v1{suffix}"), body)
        }
        ("POST", _) if suffix.starts_with("/power/config/defaults?owner=") => {
            (Method::POST, format!("/api/v1{suffix}"), body)
        }
        ("POST", _) if suffix.starts_with("/power/config/lock?owner=") => {
            (Method::POST, format!("/api/v1{suffix}"), body)
        }
        ("POST", _) if suffix.starts_with("/power/config/release?owner=") => {
            (Method::POST, format!("/api/v1{suffix}"), body)
        }
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
mod power_output_tests {
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
    fn human_output_renders_hardware_available_sections() {
        let output = json!({
            "path": "/tmp/devices.json",
            "saved": [{
                "id": "isolapurr-01",
                "name": "Bench Hub",
                "transport": {
                    "kind": "usb",
                    "deviceId": "usb--dev-cu-usbmodem101"
                }
            }],
            "devd": {
                "devices": [{
                    "id": "usb--dev-cu-usbmodem101",
                    "displayName": "ESP32-S3 USB JTAG",
                    "connection": "available"
                }]
            }
        });

        let rendered = format_human_output(&output);
        assert!(rendered.contains("Registry: /tmp/devices.json"));
        assert!(rendered.contains("Saved hardware:"));
        assert!(rendered.contains("- Bench Hub (isolapurr-01) usb:usb--dev-cu-usbmodem101"));
        assert!(rendered.contains("Local devd devices:"));
        assert!(rendered.contains("- ESP32-S3 USB JTAG (usb--dev-cu-usbmodem101) - available"));
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

        let (method, params) = map_devd_ipc_endpoint(
            Method::PUT,
            "/api/v1/devices/usb--dev-cu-usbmodem21221401/power/config?owner=7",
            Some(json!({"hardware": "legacy-hardware", "capability": {"power_watts": 100}})),
        )
        .expect("power config set endpoint should map");
        assert_eq!(method, "device.power.config_set");
        assert_eq!(params["device_id"], "usb--dev-cu-usbmodem21221401");
        assert_eq!(params["owner"], 7);
        assert_eq!(params["config"]["hardware"], "legacy-hardware");
        assert_eq!(params["config"]["capability"]["power_watts"], 100);
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

    #[test]
    fn source_capability_accepts_protocol_and_pd_voltage_flags() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "power",
            "source-capability",
            "set",
            "--hardware",
            "f293cc",
            "--power-watts",
            "65",
            "--pd",
            "true",
            "--pps",
            "true",
            "--qc20",
            "false",
            "--qc30",
            "true",
            "--fcp",
            "true",
            "--afc",
            "false",
            "--scp",
            "true",
            "--pe20",
            "false",
            "--bc12",
            "true",
            "--sfcp",
            "false",
            "--fixed-pd-voltages",
            "9000,15000,20000",
            "--pps3-limit-ma",
            "5000",
            "--pd-pps-5a",
            "false",
            "--type-c-broadcast-ma",
            "1500",
            "--scp-limit-ma",
            "5000",
            "--fcp-afc-sfcp-limit-ma",
            "3250",
        ])
        .expect("source capability command should parse");

        let Command::Power {
            command:
                PowerCommand::SourceCapability {
                    command:
                        SourceCapabilityCommand::Set {
                            args:
                                SourceCapabilitySetArgs {
                                    power_watts,
                                    pd,
                                    pps,
                                    qc20,
                                    qc30,
                                    fcp,
                                    afc,
                                    scp,
                                    pe20,
                                    bc12,
                                    sfcp,
                                    fixed_pd_voltages,
                                    pps3_limit_ma,
                                    pd_pps_5a,
                                    type_c_broadcast_ma,
                                    scp_limit_ma,
                                    fcp_afc_sfcp_limit_ma,
                                },
                            ..
                        },
                },
        } = cli.command
        else {
            panic!("expected power source-capability set command");
        };

        assert_eq!(power_watts, Some(65));
        assert_eq!(pd, Some(true));
        assert_eq!(pps, Some(true));
        assert_eq!(qc20, Some(false));
        assert_eq!(qc30, Some(true));
        assert_eq!(fcp, Some(true));
        assert_eq!(afc, Some(false));
        assert_eq!(scp, Some(true));
        assert_eq!(pe20, Some(false));
        assert_eq!(bc12, Some(true));
        assert_eq!(sfcp, Some(false));
        assert_eq!(fixed_pd_voltages.as_deref(), Some("9000,15000,20000"));
        assert_eq!(pps3_limit_ma, Some(5000));
        assert_eq!(pd_pps_5a, Some(false));
        assert_eq!(type_c_broadcast_ma, Some(1500));
        assert_eq!(scp_limit_ma, Some(5000));
        assert_eq!(fcp_afc_sfcp_limit_ma, Some(3250));
    }

    #[test]
    fn power_output_manual_accepts_owner_facing_flags() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "power",
            "output",
            "manual",
            "--hardware",
            "f293cc",
            "--voltage-mv",
            "9000",
            "--current-limit-ma",
            "3000",
            "--usb-c-path",
            "forced-on",
        ])
        .expect("power output manual command should parse");

        let Command::Power {
            command:
                PowerCommand::Output {
                    command:
                        OutputCommand::Manual {
                            args:
                                ManualOutputArgs {
                                    voltage_mv,
                                    current_limit_ma,
                                    usb_c_path,
                                },
                            ..
                        },
                },
        } = cli.command
        else {
            panic!("expected power output manual command");
        };

        assert_eq!(voltage_mv, Some(9000));
        assert_eq!(current_limit_ma, Some(3000));
        assert!(matches!(usb_c_path, Some(OutputUsbCPathArg::ForcedOn)));
    }

    #[test]
    fn power_output_auto_parses_without_manual_flags() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "power",
            "output",
            "auto",
            "--hardware",
            "f293cc",
        ])
        .expect("power output auto command should parse");

        let Command::Power {
            command:
                PowerCommand::Output {
                    command: OutputCommand::Auto { .. },
                },
        } = cli.command
        else {
            panic!("expected power output auto command");
        };
    }

    #[test]
    fn power_commands_reject_temporary_device_selector() {
        let err = Cli::try_parse_from([
            "isolapurr",
            "power",
            "show",
            "--device",
            "usb--dev-cu-usbmodem21221401",
        ])
        .expect_err("power show should reject devd temporary device selector");

        assert!(err.to_string().contains("unexpected argument '--device'"));
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
    let count = selector.selection_count();
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

#[cfg(test)]
mod tests {
    use super::{
        CliPowerConfig, CliPowerDiagnostics, ManualOutputArgs, OutputUsbCPathArg,
        apply_manual_output_args, format_power_config_output, format_power_show_output,
    };
    use serde_json::json;

    #[test]
    fn power_config_human_output_avoids_chip_names() {
        let rendered = format_power_config_output(&json!({
            "hardware": "sw2303",
            "persisted": true,
            "tps_mode": "manual",
            "capability": {
                "profile": "full",
                "power_watts": 65,
                "protocols": {
                    "pd": true,
                    "qc20": true,
                    "qc30": true,
                    "fcp": true,
                    "afc": true,
                    "scp": true,
                    "pe20": true,
                    "bc12": true,
                    "sfcp": true
                },
                "pd": {
                    "pps": true,
                    "fixed_voltages_mv": [9000, 12000, 15000, 20000]
                },
                "current": {
                    "pps3_limit_ma": 5000,
                    "pd_pps_5a": false,
                    "type_c_broadcast_ma": 500,
                    "scp_limit_ma": 5000,
                    "fcp_afc_sfcp_limit_ma": 3250
                }
            },
            "manual": {
                "voltage_mv": 12000,
                "current_limit_ma": 3000,
                "usb_c_path_mode": "default",
                "path_policy": "auto"
            },
            "lock": null
        }));

        assert!(rendered.contains("Output mode: Manual bench output"));
        assert!(rendered.contains("Current profile: PPS3 5000 mA"));
        assert!(!rendered.to_ascii_lowercase().contains("sw2303"));
        assert!(!rendered.contains("TPS"));
    }

    #[test]
    fn power_show_human_output_summarizes_live_status_without_chip_names() {
        let rendered = format_power_show_output(&json!({
            "config": {
                "hardware": "sw2303",
                "persisted": true,
                "tps_mode": "auto_follow",
                "capability": {
                    "profile": "full",
                    "power_watts": 100,
                    "protocols": {
                        "pd": true,
                        "qc20": true,
                        "qc30": true,
                        "fcp": true,
                        "afc": true,
                        "scp": true,
                        "pe20": true,
                        "bc12": true,
                        "sfcp": true
                    },
                    "pd": {
                        "pps": true,
                        "fixed_voltages_mv": [9000, 12000, 15000, 20000]
                    },
                    "current": {
                        "pps3_limit_ma": 5000,
                        "pd_pps_5a": false,
                        "type_c_broadcast_ma": 500,
                        "scp_limit_ma": 5000,
                        "fcp_afc_sfcp_limit_ma": 3250
                    }
                },
                "manual": {
                    "voltage_mv": 5000,
                    "current_limit_ma": 5000,
                    "usb_c_path_mode": "default",
                    "path_policy": "auto"
                },
                "lock": null
            },
            "diagnostics": {
                "usb_c_power_enabled": true,
                "sw2303_i2c_allowed": true,
                "sw2303_profile_applied": true,
                "sw2303_stable_reads": 3,
                "sw2303_error_latched": false,
                "tps_error_latched": false,
                "sw2303_readback_config": {
                    "available": true,
                    "matches_config": true,
                    "power_watts": 100,
                    "protocols": {
                        "pd": true,
                        "qc20": true,
                        "qc30": true,
                        "fcp": true,
                        "afc": true,
                        "scp": true,
                        "pe20": true,
                        "bc12": true,
                        "sfcp": true
                    },
                    "pd": {
                        "pps": true,
                        "fixed_voltages_mv": [9000, 12000, 15000, 20000]
                    },
                    "current": {
                        "pps3_current_limit_ma": 5000,
                        "pd_pps_5a": false,
                        "type_c_broadcast_ma": 500,
                        "scp_current_limit_ma": 5000,
                        "fcp_afc_sfcp_limit_ma": 3250
                    }
                },
                "sw2303_request": {
                    "mv": 20000,
                    "ma": 3250
                },
                "sw2303_last_valid_request": {
                    "mv": 20000,
                    "ma": 3250
                },
                "tps_setpoint": {
                    "output_enabled": true,
                    "mv": 20000,
                    "ilim_ma": 3250
                },
                "runtime_recovery_count": 0,
                "sample_uptime_ms": 1500
            }
        }));

        assert!(rendered.contains("Live USB-C status"));
        assert!(rendered.contains("Capability state: applied"));
        assert!(rendered.contains("Advertised source: 100 W"));
        assert!(rendered.contains("Negotiated request: 20000 mV @ 3250 mA"));
        assert!(!rendered.to_ascii_lowercase().contains("sw2303"));
        assert!(!rendered.contains("TPS"));
    }

    #[test]
    fn power_config_deserializes_when_current_profile_is_missing() {
        let parsed: CliPowerConfig = serde_json::from_value(json!({
            "hardware": "legacy-hardware",
            "persisted": true,
            "tps_mode": "auto_follow",
            "capability": {
                "profile": "full",
                "power_watts": 100,
                "protocols": {
                    "pd": true,
                    "qc20": false,
                    "qc30": false,
                    "fcp": false,
                    "afc": false,
                    "scp": false,
                    "pe20": false,
                    "bc12": false,
                    "sfcp": false
                },
                "pd": {
                    "pps": true,
                    "fixed_voltages_mv": [9000, 12000, 15000, 20000]
                }
            },
            "manual": {
                "voltage_mv": 5000,
                "current_limit_ma": 5000,
                "usb_c_path_mode": "default",
                "path_policy": "auto"
            },
            "lock": null
        }))
        .expect("legacy config without current profile should deserialize");

        assert_eq!(parsed.capability.current.pps3_limit_ma, 5000);
        assert!(!parsed.capability.current.pd_pps_5a);
        assert_eq!(parsed.capability.current.type_c_broadcast_ma, 500);
        assert_eq!(parsed.capability.current.scp_limit_ma, 5000);
        assert_eq!(parsed.capability.current.fcp_afc_sfcp_limit_ma, 3250);
    }

    #[test]
    fn power_diagnostics_deserializes_when_readback_current_is_missing() {
        let parsed: CliPowerDiagnostics = serde_json::from_value(json!({
            "usb_c_power_enabled": true,
            "sw2303_i2c_allowed": true,
            "sw2303_profile_applied": true,
            "sw2303_stable_reads": 3,
            "sw2303_error_latched": false,
            "tps_error_latched": false,
            "sw2303_readback_config": {
                "available": true,
                "matches_config": true,
                "power_watts": 100,
                "protocols": {
                    "pd": true,
                    "qc20": false,
                    "qc30": false,
                    "fcp": false,
                    "afc": false,
                    "scp": false,
                    "pe20": false,
                    "bc12": false,
                    "sfcp": false
                },
                "pd": {
                    "pps": true,
                    "fixed_voltages_mv": [9000, 12000, 15000, 20000]
                }
            },
            "sw2303_request": {
                "mv": 12000,
                "ma": 5000
            },
            "sw2303_last_valid_request": {
                "mv": 12000,
                "ma": 5000
            },
            "tps_setpoint": {
                "output_enabled": true,
                "mv": 12000,
                "ilim_ma": 4950
            },
            "runtime_recovery_count": 0,
            "sample_uptime_ms": 1500
        }))
        .expect("legacy diagnostics without current readback should deserialize");

        assert_eq!(parsed.sw2303_readback_config.current.pps3_limit_ma, None);
        assert_eq!(parsed.sw2303_readback_config.current.pd_pps_5a, None);
        assert_eq!(
            parsed.sw2303_readback_config.current.type_c_broadcast_ma,
            None
        );
        assert_eq!(parsed.sw2303_readback_config.current.scp_limit_ma, None);
        assert_eq!(
            parsed.sw2303_readback_config.current.fcp_afc_sfcp_limit_ma,
            None
        );
    }

    #[test]
    fn manual_output_updates_only_manual_section() {
        let original: CliPowerConfig = serde_json::from_value(json!({
            "hardware": "legacy-hardware",
            "persisted": true,
            "tps_mode": "auto_follow",
            "capability": {
                "profile": "full",
                "power_watts": 65,
                "protocols": {
                    "pd": true,
                    "qc20": false,
                    "qc30": true,
                    "fcp": false,
                    "afc": false,
                    "scp": false,
                    "pe20": false,
                    "bc12": true,
                    "sfcp": false
                },
                "pd": {
                    "pps": true,
                    "fixed_voltages_mv": [9000, 15000]
                },
                "current": {
                    "pps3_limit_ma": 5000,
                    "pd_pps_5a": false,
                    "type_c_broadcast_ma": 1500,
                    "scp_limit_ma": 5000,
                    "fcp_afc_sfcp_limit_ma": 3250
                }
            },
            "manual": {
                "voltage_mv": 5000,
                "current_limit_ma": 1000,
                "usb_c_path_mode": "default",
                "path_policy": "auto"
            },
            "lock": null
        }))
        .expect("power config should deserialize");
        let capability_before = original.capability.clone();
        let mut updated = original.clone();

        apply_manual_output_args(
            &mut updated,
            &ManualOutputArgs {
                voltage_mv: Some(21_000),
                current_limit_ma: Some(6_350),
                usb_c_path: Some(OutputUsbCPathArg::Disconnected),
            },
        );

        assert_eq!(updated.capability, capability_before);
        assert_eq!(updated.manual.voltage_mv, 21_000);
        assert_eq!(updated.manual.current_limit_ma, 6_350);
        assert_eq!(updated.manual.usb_c_path_mode, "disconnect");
        assert!(updated.manual.voltage_mv >= 3_000);
    }
}
