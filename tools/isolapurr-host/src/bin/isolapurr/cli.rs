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
    Settings {
        #[command(subcommand)]
        command: SettingsCommand,
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
    #[arg(long = "device-id")]
    device_id: Option<String>,
    #[arg(long)]
    url: Option<String>,
}

impl ApiSelectorArgs {
    fn selection_count(&self) -> u8 {
        self.device_id.is_some() as u8 + self.url.is_some() as u8
    }

    fn is_empty(&self) -> bool {
        self.selection_count() == 0
    }
}

#[derive(Debug, clap::Args, Clone, Default)]
struct PowerSelectorArgs {
    #[arg(long = "device-id")]
    device_id: Option<String>,
    #[arg(long)]
    url: Option<String>,
}

impl PowerSelectorArgs {
    fn is_empty(&self) -> bool {
        self.device_id.is_none() && self.url.is_none()
    }

    fn selection_count(&self) -> u8 {
        self.device_id.is_some() as u8 + self.url.is_some() as u8
    }
}

#[derive(Debug, clap::Args, Clone)]
struct UsbSelectorArgs {
    #[arg(long = "device-id")]
    device_id: Option<String>,
    #[arg(long = "port-path")]
    port_path: Option<String>,
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
        #[arg(long = "device-id")]
        device_id: String,
        #[arg(long)]
        name: String,
        #[arg(long = "port-path")]
        port_path: Option<String>,
        #[arg(long)]
        url: Option<String>,
        #[arg(long = "web-serial-label")]
        web_serial_label: Option<String>,
    },
    Forget {
        device_id: String,
    },
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
enum SettingsCommand {
    Reset {
        #[command(flatten)]
        selector: ApiSelectorArgs,
        #[arg(value_enum)]
        scope: SettingsResetScopeArg,
        #[arg(long)]
        yes: bool,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum SettingsResetScopeArg {
    Wifi,
    Other,
}

impl SettingsResetScopeArg {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Wifi => "wifi",
            Self::Other => "other",
        }
    }
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
    #[command(name = "config", about = "Show or edit the full saved power config")]
    Config {
        #[command(subcommand)]
        command: PowerConfigCommand,
    },
    #[command(
        name = "idle-bias",
        about = "Inspect or calibrate USB-C empty-load idle-bias correction"
    )]
    IdleBias {
        #[command(subcommand)]
        command: IdleBiasCommand,
    },
    #[command(about = "Restore the default USB-C source capability profile")]
    Defaults {
        #[command(flatten)]
        selector: PowerSelectorArgs,
    },
    #[command(about = "Toggle runtime 2mm output power or TPS discharge")]
    Runtime {
        #[command(subcommand)]
        command: RuntimeCommand,
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
enum IdleBiasCommand {
    #[command(about = "Show the saved USB-C idle-bias dataset and correction state")]
    Show {
        #[command(flatten)]
        selector: PowerSelectorArgs,
    },
    #[command(about = "Run a 3.0V to 21.0V USB-C empty-load calibration sweep")]
    Run {
        #[command(flatten)]
        selector: PowerSelectorArgs,
        #[arg(long)]
        yes: bool,
    },
    #[command(about = "Clear the saved USB-C idle-bias dataset")]
    Clear {
        #[command(flatten)]
        selector: PowerSelectorArgs,
        #[arg(long)]
        yes: bool,
    },
    #[command(about = "Enable or disable applying USB-C idle-bias correction")]
    Set {
        #[command(flatten)]
        selector: PowerSelectorArgs,
        #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
        enabled: bool,
        #[arg(long)]
        yes: bool,
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

#[derive(Debug, Subcommand)]
enum RuntimeCommand {
    #[command(about = "Enable or disable the runtime 2mm output gate")]
    Output {
        #[command(flatten)]
        selector: PowerSelectorArgs,
        #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
        enabled: bool,
    },
    #[command(about = "Enable or disable TPS55288 output discharge while off")]
    Discharge {
        #[command(flatten)]
        selector: PowerSelectorArgs,
        #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
        enabled: bool,
    },
}

#[derive(Debug, Subcommand)]
enum PowerConfigCommand {
    #[command(about = "Show the saved power config")]
    Show {
        #[command(flatten)]
        selector: PowerSelectorArgs,
    },
    #[command(
        about = "Update the saved power config",
        after_help = "When a flag is omitted, the existing saved value is kept."
    )]
    Set {
        #[command(flatten)]
        selector: PowerSelectorArgs,
        #[command(flatten)]
        args: PowerConfigSetArgs,
    },
}

#[derive(Debug, clap::Args, Clone, Default)]
struct PowerConfigSetArgs {
    #[arg(long, value_enum)]
    light_load_mode: Option<LightLoadModeArg>,
    #[arg(long, value_enum)]
    tps_mode: Option<TpsModeArg>,
    #[arg(long, value_enum)]
    sw2303_line_comp: Option<Sw2303LineCompArg>,
    #[command(flatten)]
    manual: ManualOutputArgs,
    #[command(flatten)]
    source: SourceCapabilitySetArgs,
}

#[derive(Debug, clap::Args, Clone, Default)]
struct ManualOutputArgs {
    #[arg(long, value_parser = clap::value_parser!(u16).range(3000..=21000))]
    voltage_mv: Option<u16>,
    #[arg(long, value_parser = clap::value_parser!(u16).range(1..=6350))]
    current_limit_ma: Option<u16>,
    #[arg(
        long,
        value_parser = parse_tps_cdc_rise_mv,
        conflicts_with = "cable_resistance_mohm"
    )]
    tps_cdc_rise_mv: Option<u16>,
    #[arg(
        long,
        value_parser = parse_cable_resistance_mohm,
        conflicts_with = "tps_cdc_rise_mv"
    )]
    cable_resistance_mohm: Option<u16>,
    #[arg(long, value_enum)]
    usb_c_path: Option<OutputUsbCPathArg>,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum OutputUsbCPathArg {
    Automatic,
    Disconnected,
    ForcedOn,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum LightLoadModeArg {
    Pfm,
    Fpwm,
}

impl LightLoadModeArg {
    const fn as_config_value(self) -> &'static str {
        match self {
            Self::Pfm => "pfm",
            Self::Fpwm => "fpwm",
        }
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum TpsModeArg {
    AutoFollow,
    Manual,
}

impl TpsModeArg {
    const fn as_config_value(self) -> &'static str {
        match self {
            Self::AutoFollow => "auto_follow",
            Self::Manual => "manual",
        }
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum Sw2303LineCompArg {
    Off,
    #[value(name = "0")]
    Zero,
    #[value(name = "50")]
    Fifty,
    #[value(name = "100")]
    OneHundred,
    #[value(name = "150")]
    OneHundredFifty,
}

impl Sw2303LineCompArg {
    const fn as_config_value(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Zero => "0mohm",
            Self::Fifty => "50mohm",
            Self::OneHundred => "100mohm",
            Self::OneHundredFifty => "150mohm",
        }
    }
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
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    qc20_20v_enabled: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    qc30_20v_enabled: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    pe20_20v_enabled: Option<bool>,
    #[arg(long, value_parser = clap::value_parser!(bool), action = ArgAction::Set)]
    non_pd_12v_enabled: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct CliPowerConfig {
    hardware: String,
    persisted: bool,
    tps_mode: String,
    #[serde(default = "default_light_load_mode")]
    light_load_mode: String,
    #[serde(default = "default_sw2303_line_compensation")]
    sw2303_line_compensation: String,
    #[serde(default)]
    runtime: CliPowerRuntime,
    capability: CliPowerCapability,
    manual: CliPowerManual,
    lock: Option<CliPowerLock>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct CliPowerRuntime {
    #[serde(default = "default_runtime_output_enabled")]
    output_enabled: bool,
    #[serde(default)]
    discharge_enabled: bool,
}

impl Default for CliPowerRuntime {
    fn default() -> Self {
        Self {
            output_enabled: default_runtime_output_enabled(),
            discharge_enabled: false,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct CliPowerCapability {
    profile: String,
    power_watts: u8,
    protocols: Value,
    pd: CliPowerPd,
    #[serde(default)]
    current: CliPowerCurrentProfile,
    #[serde(default)]
    fast_charge: CliPowerFastChargeProfile,
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
struct CliPowerFastChargeProfile {
    qc20_20v_enabled: bool,
    qc30_20v_enabled: bool,
    pe20_20v_enabled: bool,
    non_pd_12v_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
struct CliPowerManual {
    voltage_mv: u16,
    current_limit_ma: u16,
    usb_c_path_mode: String,
    #[serde(default)]
    tps_cdc_rise_mv: u16,
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
    #[serde(default)]
    sw2303_vbus_mv: Option<u32>,
    sw2303_last_valid_request: CliPowerRequest,
    #[serde(default)]
    display: Option<CliUsbCDisplay>,
    #[serde(default)]
    usb_c_actual: Option<CliPortTelemetry>,
    #[serde(default)]
    active_protocol: Option<String>,
    tps_setpoint: CliPowerSetpoint,
    #[serde(default)]
    tps_iout_limit_readback: Option<CliTpsIoutLimitReadback>,
    thermal: CliPowerThermal,
    #[serde(default)]
    idle_bias: CliIdleBias,
    runtime_recovery_count: u32,
    sample_uptime_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPowerThermal {
    sensors: CliPowerThermalSensors,
    hottest_temperature_deci_c: Option<i32>,
    state: String,
    reason: String,
    effective_power_watts: u8,
    sample_uptime_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPowerThermalSensors {
    mcu: CliPowerThermalSensor,
    tmp112: CliPowerThermalSensor,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPowerThermalSensor {
    temperature_deci_c: Option<i32>,
    status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliTpsIoutLimitReadback {
    enabled: Option<bool>,
    ma: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliUsbCDisplay {
    mode: Value,
    measurements_visible: bool,
    badge: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct CliIdleBias {
    correction_enabled: bool,
    #[serde(default)]
    dataset: CliIdleBiasDataset,
    current_applied_offset_ma: Option<u32>,
    #[serde(default)]
    run: CliIdleBiasRun,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliIdleBiasDataset {
    status: String,
    min_voltage_mv: u16,
    max_voltage_mv: u16,
    step_mv: u16,
    point_count: u8,
    offsets_ma: Option<Vec<u16>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct CliIdleBiasRun {
    state: String,
    completed_points: u8,
    point_count: u8,
    target_voltage_mv: Option<u32>,
    error: Option<CliIdleBiasError>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliIdleBiasError {
    code: String,
    message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPortsResponse {
    ports: Vec<CliPort>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPort {
    #[serde(rename = "portId")]
    port_id: String,
    label: String,
    telemetry: CliPortTelemetry,
    #[serde(default)]
    telemetry_raw: Option<CliPortTelemetry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPortTelemetry {
    status: String,
    voltage_mv: Option<u32>,
    current_ma: Option<u32>,
    power_mw: Option<u32>,
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
    #[serde(default)]
    fast_charge: CliPowerFastChargeReadback,
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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct CliPowerFastChargeReadback {
    qc20_20v_enabled: Option<bool>,
    qc30_20v_enabled: Option<bool>,
    pe20_20v_enabled: Option<bool>,
    non_pd_12v_enabled: Option<bool>,
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

impl Default for CliPowerFastChargeProfile {
    fn default() -> Self {
        Self {
            qc20_20v_enabled: true,
            qc30_20v_enabled: true,
            pe20_20v_enabled: true,
            non_pd_12v_enabled: true,
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

impl Default for CliIdleBiasDataset {
    fn default() -> Self {
        Self {
            status: "missing".to_string(),
            min_voltage_mv: 3000,
            max_voltage_mv: 21000,
            step_mv: 500,
            point_count: 37,
            offsets_ma: None,
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

fn confirm_settings_reset(scope: &str) -> anyhow::Result<()> {
    use std::io::IsTerminal;

    if !std::io::stdin().is_terminal() {
        return Err(anyhow!(
            "settings reset requires an interactive terminal or --yes"
        ));
    }
    eprintln!("Reset {scope} settings on the selected IsolaPurr hub.");
    if scope == "wifi" {
        eprintln!("This clears stored Wi-Fi credentials and can disconnect the hub from LAN.");
    } else {
        eprintln!("This clears non-Wi-Fi device settings; stored Wi-Fi credentials are preserved.");
    }
    eprintln!("Type 'reset {scope}' to continue:");
    let mut line = String::new();
    std::io::stdin().read_line(&mut line)?;
    if line.trim() != format!("reset {scope}") {
        return Err(UserCancelled.into());
    }
    Ok(())
}

fn confirm_idle_bias_action(action: &str) -> anyhow::Result<()> {
    use std::io::IsTerminal;

    if !std::io::stdin().is_terminal() {
        return Err(anyhow!(
            "idle-bias mutation requires an interactive terminal or --yes"
        ));
    }
    eprintln!("USB-C idle-bias action: {action}");
    eprintln!("Disconnect any USB-C device before continuing.");
    eprintln!(
        "Calibration sweeps 3.0V to 21.0V and restores the pre-calibration runtime output afterward."
    );
    eprintln!("Type 'idle-bias {action}' to continue:");
    let mut line = String::new();
    std::io::stdin().read_line(&mut line)?;
    if line.trim() != format!("idle-bias {action}") {
        return Err(UserCancelled.into());
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CliPowerRequest {
    mv: Option<u32>,
    ma: Option<u32>,
}

#[derive(Debug, Clone)]
struct CliPowerSetpoint {
    output_enabled: Option<bool>,
    discharge_enabled: Option<bool>,
    mv: Option<u32>,
    iout_limit_ma: Option<u32>,
}

impl Serialize for CliPowerSetpoint {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeMap;

        let mut map = serializer.serialize_map(Some(5))?;
        map.serialize_entry("output_enabled", &self.output_enabled)?;
        map.serialize_entry("discharge_enabled", &self.discharge_enabled)?;
        map.serialize_entry("mv", &self.mv)?;
        map.serialize_entry("iout_limit_ma", &self.iout_limit_ma)?;
        map.serialize_entry("ilim_ma", &self.iout_limit_ma)?;
        map.end()
    }
}

impl<'de> Deserialize<'de> for CliPowerSetpoint {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct RawCliPowerSetpoint {
            output_enabled: Option<bool>,
            discharge_enabled: Option<bool>,
            mv: Option<u32>,
            iout_limit_ma: Option<u32>,
            ilim_ma: Option<u32>,
        }

        let raw = RawCliPowerSetpoint::deserialize(deserializer)?;
        Ok(Self {
            output_enabled: raw.output_enabled,
            discharge_enabled: raw.discharge_enabled,
            mv: raw.mv,
            iout_limit_ma: raw.iout_limit_ma.or(raw.ilim_ma),
        })
    }
}

const MANUAL_OUTPUT_DEFAULT_VOLTAGE_MV: u16 = 5_000;
const MANUAL_OUTPUT_DEFAULT_CURRENT_MA: u16 = 1_000;

fn default_light_load_mode() -> String {
    "pfm".to_string()
}

fn default_sw2303_line_compensation() -> String {
    "50mohm".to_string()
}

fn default_runtime_output_enabled() -> bool {
    true
}

fn parse_tps_cdc_rise_mv(raw: &str) -> Result<u16, String> {
    match raw {
        "0" | "100" | "200" | "300" | "400" | "500" | "600" | "700" => raw
            .parse::<u16>()
            .map_err(|_| String::from("expected 0, 100, 200, 300, 400, 500, 600, or 700")),
        _ => Err(String::from(
            "expected 0, 100, 200, 300, 400, 500, 600, or 700",
        )),
    }
}

fn parse_cable_resistance_mohm(raw: &str) -> Result<u16, String> {
    match raw {
        "0" | "20" | "40" | "60" | "80" | "100" | "120" | "140" => raw
            .parse::<u16>()
            .map_err(|_| String::from("expected 0, 20, 40, 60, 80, 100, 120, or 140")),
        _ => Err(String::from("expected 0, 20, 40, 60, 80, 100, 120, or 140")),
    }
}

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
            || self.qc20_20v_enabled.is_some()
            || self.qc30_20v_enabled.is_some()
            || self.pe20_20v_enabled.is_some()
            || self.non_pd_12v_enabled.is_some()
    }
}

impl PowerConfigSetArgs {
    fn has_updates(&self) -> bool {
        self.light_load_mode.is_some()
            || self.tps_mode.is_some()
            || self.sw2303_line_comp.is_some()
            || self.manual.voltage_mv.is_some()
            || self.manual.current_limit_ma.is_some()
            || self.manual.tps_cdc_rise_mv.is_some()
            || self.manual.cable_resistance_mohm.is_some()
            || self.manual.usb_c_path.is_some()
            || self.source.has_updates()
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
