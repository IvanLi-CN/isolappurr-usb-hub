fn release_version() -> &'static str {
    option_env!("ISOLAPURR_RELEASE_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}

const EXIT_SERVER_FAILED: i32 = 10;
const EXIT_DISCOVERY_UNAVAILABLE: i32 = 20;

#[derive(Parser, Debug)]
#[command(name = "isolapurr-desktop", version = release_version(), about)]
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
    Serial {
        #[command(subcommand)]
        cmd: SerialCmd,
    },
    Firmware {
        #[command(subcommand)]
        cmd: FirmwareCmd,
    },
}

#[derive(Subcommand, Debug, Clone)]
enum SerialCmd {
    Ports {
        #[arg(long)]
        json: bool,
    },
    Request {
        #[arg(long)]
        port: String,
        #[arg(long)]
        method: String,
        #[arg(long)]
        params: Option<String>,
        #[arg(long, default_value_t = default_serial_timeout_ms())]
        timeout_ms: u64,
        #[arg(long)]
        json: bool,
    },
    Identify {
        #[arg(long)]
        port: String,
        #[arg(long)]
        write_cache: bool,
        #[arg(long)]
        allow_unconfirmed_cache: bool,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand, Debug, Clone)]
enum FirmwareCmd {
    MakeBin {
        #[arg(long)]
        elf: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long)]
        json: bool,
    },
    Flash {
        #[arg(long)]
        port: String,
        #[arg(long)]
        bin: PathBuf,
        #[arg(long)]
        elf: Option<PathBuf>,
        #[arg(long, default_value = "0x10000")]
        address: String,
        #[arg(long)]
        allow_unconfirmed_port: bool,
        #[arg(long)]
        json: bool,
    },
    Reset {
        #[arg(long)]
        port: String,
        #[arg(long)]
        json: bool,
    },
    Monitor {
        #[arg(long)]
        port: String,
        #[arg(long)]
        elf: Option<PathBuf>,
        #[arg(long)]
        reset: bool,
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
    #[serde(rename = "ipScan")]
    ip_scan: IpScanSnapshot,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct IpScanSnapshot {
    expanded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    expanded_by: Option<IpScanExpandedBy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_expand_after_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_cidr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    candidates: Option<Vec<LanCandidate>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
enum IpScanExpandedBy {
    User,
    Auto,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LanCandidate {
    cidr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    r#interface: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ipv4: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    primary: Option<bool>,
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
    serial_lock: Arc<TokioMutex<()>>,
}

#[derive(Clone, Debug, Serialize)]
struct SerialPortInfo {
    path: String,
    label: String,
    #[serde(rename = "vendorId")]
    vendor_id: Option<u16>,
    #[serde(rename = "productId")]
    product_id: Option<u16>,
    #[serde(rename = "serialNumber")]
    serial_number: Option<String>,
    manufacturer: Option<String>,
    product: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct SerialPortsResponse {
    ports: Vec<SerialPortInfo>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SerialJsonlRequest {
    port_path: String,
    #[serde(default = "default_serial_baud_rate")]
    baud_rate: u32,
    #[serde(default = "default_serial_timeout_ms")]
    timeout_ms: u64,
    request: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SerialJsonlResponse {
    response: serde_json::Value,
    raw: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FirmwareFlashRequest {
    port_path: String,
    address: u32,
    file_name: String,
    file_base64: String,
    #[serde(default)]
    expected_identity: Option<DeviceIdentityExpectation>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FirmwareFlashResponse {
    ok: bool,
    exit_code: Option<i32>,
    log: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DeviceIdentityExpectation {
    #[serde(skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mac: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PortIdentityCache {
    port: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    identity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mac: Option<String>,
    confirmed_at: String,
    source: String,
}

impl PortIdentityCache {
    fn has_identity(&self) -> bool {
        self.device_id.is_some() || self.mac.is_some()
    }

    fn is_unconfirmed(&self) -> bool {
        self.identity.as_deref() == Some(PORT_IDENTITY_UNCONFIRMED)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FirmwareMakeBinResponse {
    ok: bool,
    exit_code: Option<i32>,
    elf: String,
    out: String,
    log: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FirmwareResetResponse {
    ok: bool,
    port: String,
    method: &'static str,
    port_available: bool,
    evidence: Vec<String>,
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
        if cli_error_as_json() {
            let _ = print_json(&serde_json::json!({
                "ok": false,
                "error": {
                    "code": "cli_error",
                    "message": err.to_string(),
                    "retryable": false
                }
            }));
        } else {
            eprintln!("{err:#}");
        }
        std::process::exit(1);
    }
}

fn cli_error_as_json() -> bool {
    env::args_os().any(|arg| arg == "--json")
}

async fn run() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::try_parse().unwrap_or_else(|e| e.exit());
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
        Cmd::Serial { cmd } => run_serial_cli(cmd).await,
        Cmd::Firmware { cmd } => run_firmware_cli(cmd).await,
        Cmd::Gui => run_gui(cli).await,
        Cmd::Tray => run_tray(cli).await,
        Cmd::Open => run_open(cli).await,
        Cmd::Serve => run_serve(cli).await,
    }
}

async fn run_serial_cli(cmd: SerialCmd) -> anyhow::Result<()> {
    match cmd {
        SerialCmd::Ports { json } => {
            let ports = list_serial_ports()
                .map_err(|err| anyhow!("serial port enumeration failed: {err}"))?;
            let ports = filter_esp32_serial_ports(ports);
            if json {
                print_json(&SerialPortsResponse { ports })?;
            } else if ports.is_empty() {
                println!("No ESP32-S3 USB Serial/JTAG candidates found.");
            } else {
                for port in ports {
                    println!(
                        "{}\t{}\tserial={}\tvid={}\tpid={}",
                        port.path,
                        port.label,
                        port.serial_number.as_deref().unwrap_or("unknown"),
                        format_optional_hex(port.vendor_id),
                        format_optional_hex(port.product_id)
                    );
                }
            }
            Ok(())
        }
        SerialCmd::Request {
            port,
            method,
            params,
            timeout_ms,
            json,
        } => {
            let params = parse_json_params(params.as_deref())?;
            let request = serde_json::json!({
                "id": 1,
                "method": method,
                "params": params,
            });
            let response = run_serial_jsonl_request(SerialJsonlRequest {
                port_path: port,
                baud_rate: default_serial_baud_rate(),
                timeout_ms,
                request,
            })
            .map_err(anyhow::Error::msg)?;
            if json {
                print_json(&response)?;
            } else {
                println!("{}", response.raw.trim_end());
            }
            Ok(())
        }
        SerialCmd::Identify {
            port,
            write_cache,
            allow_unconfirmed_cache,
            json,
        } => {
            let identity = match identify_port(&port) {
                Ok(identity) => identity,
                Err(err)
                    if write_cache
                        && allow_unconfirmed_cache
                        && is_unconfirmed_identity_error(&err) =>
                {
                    let cache = unconfirmed_port_cache(&port);
                    write_port_preference_cache(&cache)?;
                    if json {
                        print_json(&cache)?;
                    } else {
                        eprintln!(
                            "warning: selected port did not answer project JSONL info: {err}"
                        );
                        println!("port: {}", cache.port);
                        println!("identity: {PORT_IDENTITY_UNCONFIRMED}");
                        println!("cached: {PORT_CACHE_FILE_NAME}");
                        println!("Next: run just flash to write the project app image.");
                    }
                    return Ok(());
                }
                Err(err) => return Err(anyhow::Error::msg(err)),
            };
            if write_cache {
                write_port_preference_cache(&identity)?;
            }
            if json {
                print_json(&identity)?;
            } else {
                println!("port: {}", identity.port);
                println!(
                    "device_id: {}",
                    identity.device_id.as_deref().unwrap_or("unknown")
                );
                println!("mac: {}", identity.mac.as_deref().unwrap_or("unknown"));
                if identity.is_unconfirmed() {
                    println!("identity: {PORT_IDENTITY_UNCONFIRMED}");
                }
                if write_cache {
                    println!("cached: {PORT_CACHE_FILE_NAME}");
                }
            }
            Ok(())
        }
    }
}

async fn run_firmware_cli(cmd: FirmwareCmd) -> anyhow::Result<()> {
    match cmd {
        FirmwareCmd::MakeBin { elf, out, json } => {
            let response = run_firmware_make_bin(&elf, &out).map_err(anyhow::Error::msg)?;
            if json {
                print_json(&response)?;
            } else {
                print!("{}", response.log);
                if response.ok {
                    println!("Wrote app image: {}", response.out);
                }
            }
            if response.ok {
                Ok(())
            } else {
                Err(anyhow!("espflash save-image failed"))
            }
        }
        FirmwareCmd::Flash {
            port,
            bin,
            elf,
            address,
            allow_unconfirmed_port,
            json,
        } => {
            let address = parse_flash_address(&address)?;
            let cache = read_port_preference_cache()?;
            let expected_identity = if let Some(cache) = cache {
                if cache.port != port {
                    return Err(anyhow!(
                        "selected port does not match confirmed identity cache: expected {}, got {}",
                        cache.port,
                        port
                    ));
                }
                if cache.has_identity() {
                    Some(DeviceIdentityExpectation {
                        device_id: cache.device_id.clone(),
                        mac: cache.mac.clone(),
                    })
                } else if cache.is_unconfirmed() {
                    if json {
                        return Err(anyhow!(
                            "unconfirmed first flash requires interactive confirmation"
                        ));
                    }
                    confirm_unverified_flash(&port, &bin, address)?;
                    None
                } else {
                    return Err(anyhow!(
                        "{PORT_CACHE_FILE_NAME} must include device_id/mac or identity=unconfirmed"
                    ));
                }
            } else if allow_unconfirmed_port {
                if json {
                    return Err(anyhow!(
                        "unconfirmed first flash requires interactive confirmation"
                    ));
                }
                confirm_unverified_flash(&port, &bin, address)?;
                None
            } else {
                return Err(anyhow!(
                    "no selected port found in {PORT_CACHE_FILE_NAME}; run just select-port or pass PORT=/dev/cu.xxx to just flash"
                ));
            };
            let unverified_first_flash = expected_identity.is_none();
            let response = if unverified_first_flash {
                let elf = elf.as_deref().ok_or_else(|| {
                    anyhow!("unconfirmed first flash requires --elf for full bootstrap flashing")
                })?;
                run_firmware_full_flash_elf(&port, elf).map_err(anyhow::Error::msg)?
            } else {
                run_firmware_flash_file(&port, &bin, address, expected_identity)
                    .map_err(anyhow::Error::msg)?
            };
            if json {
                print_json(&response)?;
            } else {
                print!("{}", response.log);
            }
            if response.ok {
                if unverified_first_flash {
                    wait_for_serial_port(&port, StdDuration::from_secs(5));
                    let identity = identify_port_with_retries(&port, 3, StdDuration::from_secs(2))
                        .map_err(|err| {
                            anyhow!(
                                "unverified bootstrap flash succeeded, but post-flash identity confirmation failed: {err}. Run PORT={} just identify after the device boots.",
                                port
                            )
                        })?;
                    write_port_preference_cache(&identity)?;
                    if !json {
                        println!("post-flash identity confirmed: {PORT_CACHE_FILE_NAME}");
                    }
                }
                Ok(())
            } else {
                Err(anyhow!("espflash write-bin failed"))
            }
        }
        FirmwareCmd::Reset { port, json } => {
            let response = run_firmware_reset(&port).map_err(anyhow::Error::msg)?;
            if json {
                print_json(&response)?;
            } else {
                for line in &response.evidence {
                    println!("{line}");
                }
            }
            if response.ok {
                Ok(())
            } else {
                Err(anyhow!("firmware reset failed"))
            }
        }
        FirmwareCmd::Monitor {
            port,
            elf,
            reset,
            json,
        } => {
            if json {
                println!(
                    "{}",
                    serde_json::to_string(&serde_json::json!({
                    "port": port,
                    "elf": elf.as_ref().map(|path| path.display().to_string()),
                    "reset": reset,
                    "status": "starting"
                    }))?
                );
            }
            run_firmware_monitor(&port, elf.as_deref(), reset, json).map_err(anyhow::Error::msg)
        }
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
    let state = agent.state.clone();
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![discovery_snapshot])
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
    let state = agent.state.clone();

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![discovery_snapshot])
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
