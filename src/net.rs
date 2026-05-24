#![allow(dead_code)]

use alloc::string::String;
use core::fmt::Write as _;
use defmt::*;
use embassy_executor::Spawner;
use embassy_futures::select::{Either, select};
use embassy_net::{
    Config as NetConfig, DhcpConfig, Ipv4Address, Ipv4Cidr, Stack, StackResources, StaticConfigV4,
    tcp::TcpSocket,
};
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex, signal::Signal};
use embassy_time::{Duration, Timer};
use esp_hal::{peripherals::WIFI, rng::Rng, time::Instant as HalInstant};
use esp_radio::{
    Controller as RadioController, init as radio_init,
    wifi::{self, ClientConfig, ModeConfig, WifiController, WifiDevice, WifiEvent},
};
use heapless::{String as HString, Vec};
use isolapurr_usb_hub::provisioning::{
    DEFAULT_USB_C_DOWNSTREAM_ROUTE, UsbCDownstreamRoute, WifiCredentials,
};
use static_cell::StaticCell;

use crate::mdns;
use crate::mdns::MdnsConfig;
#[cfg(feature = "net_http")]
const WIFI_HOSTNAME: Option<&str> = option_env!("USB_HUB_WIFI_HOSTNAME");
#[cfg(feature = "net_http")]
const WIFI_STATIC_IP: Option<&str> = option_env!("USB_HUB_WIFI_STATIC_IP");
#[cfg(feature = "net_http")]
const WIFI_NETMASK: Option<&str> = option_env!("USB_HUB_WIFI_NETMASK");
#[cfg(feature = "net_http")]
const WIFI_GATEWAY: Option<&str> = option_env!("USB_HUB_WIFI_GATEWAY");
#[cfg(feature = "net_http")]
const WIFI_DNS: Option<&str> = option_env!("USB_HUB_WIFI_DNS");

pub struct NetHandles {
    pub device_names: &'static DeviceNames,
    pub wifi_state: &'static WifiStateMutex,
}

#[derive(Clone)]
pub struct DeviceNames {
    pub mac: [u8; 6],
    pub short_id: HString<6>,
    pub hostname: HString<32>,
    pub hostname_fqdn: HString<48>,
}

/// Shared Wi‑Fi/IPv4 state for UI + HTTP APIs.
#[derive(Clone, Copy, Debug)]
pub enum WifiConnectionState {
    Idle,
    Connecting,
    Connected,
    Error,
}

#[derive(Clone, Copy, Debug)]
pub enum WifiErrorKind {
    ConnectFailed,
    DhcpTimeout,
    LinkLost,
}

#[derive(Clone, Copy, Debug)]
pub struct WifiState {
    pub state: WifiConnectionState,
    pub ipv4: Option<Ipv4Address>,
    pub gateway: Option<Ipv4Address>,
    pub is_static: bool,
    pub last_error: Option<WifiErrorKind>,
    pub mac: Option<[u8; 6]>,
}

impl WifiState {
    const fn new() -> Self {
        Self {
            state: WifiConnectionState::Idle,
            ipv4: None,
            gateway: None,
            is_static: false,
            last_error: None,
            mac: None,
        }
    }
}

pub type WifiStateMutex = Mutex<CriticalSectionRawMutex, WifiState>;

static WIFI_STATE_CELL: StaticCell<WifiStateMutex> = StaticCell::new();
static DEVICE_NAMES_CELL: StaticCell<DeviceNames> = StaticCell::new();
static RADIO_CONTROLLER: StaticCell<RadioController<'static>> = StaticCell::new();
static NET_RESOURCES: StaticCell<StackResources<8>> = StaticCell::new();
static API_STATE_CELL: StaticCell<ApiSharedMutex> = StaticCell::new();
static WIFI_APPLY_SIGNAL: Signal<CriticalSectionRawMutex, ()> = Signal::new();

// --- HTTP API (Plan #0005) -------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApiPortId {
    PortA,
    PortC,
}

impl ApiPortId {
    pub const fn as_str(self) -> &'static str {
        match self {
            ApiPortId::PortA => "port_a",
            ApiPortId::PortC => "port_c",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApiTelemetryStatus {
    Ok,
    NotInserted,
    Error,
    Overrange,
}

impl ApiTelemetryStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            ApiTelemetryStatus::Ok => "ok",
            ApiTelemetryStatus::NotInserted => "not_inserted",
            ApiTelemetryStatus::Error => "error",
            ApiTelemetryStatus::Overrange => "overrange",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApiPortTelemetry {
    pub status: ApiTelemetryStatus,
    pub voltage_mv: Option<u32>,
    pub current_ma: Option<u32>,
    pub power_mw: Option<u32>,
    pub sample_uptime_ms: u64,
}

impl ApiPortTelemetry {
    pub const fn unknown() -> Self {
        Self {
            status: ApiTelemetryStatus::Error,
            voltage_mv: None,
            current_ma: None,
            power_mw: None,
            sample_uptime_ms: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApiPortState {
    pub power_enabled: bool,
    pub data_connected: bool,
    pub replugging: bool,
    pub busy: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApiHubSnapshot {
    pub upstream_connected: bool,
    pub isolated_usb_fault: bool,
    pub isolated_downstream_connected: bool,
    pub isolated_usb_ready: bool,
    pub usb_c_downstream_route: UsbCDownstreamRoute,
    pub usb_c_downstream_persisted: bool,
}

impl ApiHubSnapshot {
    pub const fn unknown() -> Self {
        Self {
            upstream_connected: false,
            isolated_usb_fault: false,
            isolated_downstream_connected: false,
            isolated_usb_ready: false,
            usb_c_downstream_route: DEFAULT_USB_C_DOWNSTREAM_ROUTE,
            usb_c_downstream_persisted: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApiPortSnapshot {
    pub telemetry: ApiPortTelemetry,
    pub state: ApiPortState,
}

impl ApiPortSnapshot {
    pub const fn unknown() -> Self {
        Self {
            telemetry: ApiPortTelemetry::unknown(),
            state: ApiPortState {
                power_enabled: false,
                data_connected: false,
                replugging: false,
                busy: false,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApiPortsSnapshot {
    pub port_a: ApiPortSnapshot,
    pub port_c: ApiPortSnapshot,
}

impl ApiPortsSnapshot {
    pub const fn unknown() -> Self {
        Self {
            port_a: ApiPortSnapshot::unknown(),
            port_c: ApiPortSnapshot::unknown(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApiPdSnapshot {
    pub usb_c_power_enabled: bool,
    pub sw2303_i2c_allowed: bool,
    pub sw2303_profile_applied: bool,
    pub sw2303_stable_reads: u32,
    pub sw2303_error_latched: bool,
    pub tps_error_latched: bool,
    pub sw2303_request_mv: Option<u32>,
    pub sw2303_request_ma: Option<u32>,
    pub sw2303_last_valid_mv: Option<u32>,
    pub sw2303_last_valid_ma: Option<u32>,
    pub tps_setpoint_output_enabled: Option<bool>,
    pub tps_setpoint_mv: Option<u32>,
    pub tps_setpoint_ilim_ma: Option<u32>,
    pub runtime_recovery_count: u32,
    pub sample_uptime_ms: u64,
}

impl ApiPdSnapshot {
    pub const fn unknown() -> Self {
        Self {
            usb_c_power_enabled: false,
            sw2303_i2c_allowed: false,
            sw2303_profile_applied: false,
            sw2303_stable_reads: 0,
            sw2303_error_latched: false,
            tps_error_latched: false,
            sw2303_request_mv: None,
            sw2303_request_ma: None,
            sw2303_last_valid_mv: None,
            sw2303_last_valid_ma: None,
            tps_setpoint_output_enabled: None,
            tps_setpoint_mv: None,
            tps_setpoint_ilim_ma: None,
            runtime_recovery_count: 0,
            sample_uptime_ms: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApiPortAction {
    Replug,
    Power { enabled: bool },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApiPendingActions {
    pub port_a: Option<ApiPortAction>,
    pub port_c: Option<ApiPortAction>,
    pub usb_c_downstream_route: Option<UsbCDownstreamRoute>,
}

impl ApiPendingActions {
    pub const fn empty() -> Self {
        Self {
            port_a: None,
            port_c: None,
            usb_c_downstream_route: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApiSharedState {
    pub hub: ApiHubSnapshot,
    pub ports: ApiPortsSnapshot,
    pub pd: ApiPdSnapshot,
    pub pending: ApiPendingActions,
}

impl ApiSharedState {
    pub const fn new() -> Self {
        Self {
            hub: ApiHubSnapshot::unknown(),
            ports: ApiPortsSnapshot::unknown(),
            pd: ApiPdSnapshot::unknown(),
            pending: ApiPendingActions::empty(),
        }
    }
}

pub type ApiSharedMutex = Mutex<CriticalSectionRawMutex, ApiSharedState>;

pub fn init_http_api_state() -> &'static ApiSharedMutex {
    API_STATE_CELL.init(Mutex::new(ApiSharedState::new()))
}

pub(crate) fn request_wifi_runtime_apply() {
    WIFI_APPLY_SIGNAL.signal(());
}

pub fn spawn_wifi_mdns_http(
    spawner: &Spawner,
    wifi_peripheral: WIFI<'static>,
    api_state: &'static ApiSharedMutex,
    credentials: Option<WifiCredentials>,
) -> Option<NetHandles> {
    let wifi_state = WIFI_STATE_CELL.init(Mutex::new(WifiState::new()));

    // Init radio driver (requires esp-rtos scheduler already started).
    let radio = match radio_init() {
        Ok(ctrl) => ctrl,
        Err(err) => {
            warn!(
                "Wi-Fi radio init failed; skipping Wi-Fi/mDNS/HTTP: {:?}",
                err
            );
            return None;
        }
    };
    let radio_ctrl = RADIO_CONTROLLER.init(radio);

    let (wifi_controller, wifi_interfaces) =
        match wifi::new(radio_ctrl, wifi_peripheral, Default::default()) {
            Ok(v) => v,
            Err(err) => {
                warn!(
                    "Wi-Fi driver init failed; skipping Wi-Fi/mDNS/HTTP: {:?}",
                    err
                );
                return None;
            }
        };

    let wifi_device: WifiDevice<'static> = wifi_interfaces.sta;
    let wifi_mac = wifi_device.mac_address();
    let device_names = DEVICE_NAMES_CELL.init(derive_device_names(wifi_mac));

    if credentials.is_none() {
        info!("Wi-Fi credentials not configured in EEPROM; network services idle until configured");
    }

    let (net_cfg, is_static) = build_net_config_from_env(credentials.as_ref());

    let rng = Rng::new();
    let seed = (rng.random() as u64) << 32 | rng.random() as u64;

    let resources = NET_RESOURCES.init(StackResources::<8>::new());
    let (stack, runner) = embassy_net::new(wifi_device, net_cfg, resources, seed);

    spawner
        .spawn(wifi_task(
            wifi_controller,
            stack,
            wifi_state,
            is_static,
            wifi_mac,
            credentials,
        ))
        .ok()?;

    spawner
        .spawn(http_task(stack, device_names, wifi_state, api_state))
        .ok()?;

    let mdns_cfg = MdnsConfig {
        hostname: device_names.hostname.clone(),
        hostname_fqdn: device_names.hostname_fqdn.clone(),
        instance_name: mdns::service_instance_name(device_names.hostname.as_str()),
        port: HTTP_PORT,
    };
    spawner.spawn(mdns::mdns_task(stack, mdns_cfg)).ok()?;

    spawner.spawn(net_task(runner)).ok()?;

    Some(NetHandles {
        device_names,
        wifi_state,
    })
}

pub fn format_network_toast_lines(
    short_id: Option<&str>,
    ip: Option<Ipv4Address>,
) -> [[u8; 20]; 3] {
    let mut lines = [[b' '; 20]; 3];

    // IMPORTANT: the toast UI uses a tiny fixed font that only supports:
    // digits, '.', '-', space, and a subset of uppercase letters.
    // Do NOT render arbitrary hostnames here (will show '?' for missing glyphs).

    // Line 0: device hint ("ID <short_id>") or a fallback.
    if let Some(id) = short_id.and_then(|v| {
        let s = v.trim();
        if s.is_empty() { None } else { Some(s) }
    }) {
        let mut out: HString<20> = HString::new();
        let _ = out.push_str("ID ");
        for ch in id.chars() {
            if out.len() >= 20 {
                break;
            }
            if ch.is_ascii_hexdigit() {
                let _ = out.push(ch.to_ascii_uppercase());
            }
        }
        let b = out.as_bytes();
        lines[0][..b.len()].copy_from_slice(b);
    } else {
        let b = b"NO WIFI";
        lines[0][..b.len()].copy_from_slice(b);
    }

    // Line 1: IP (full).
    match ip {
        None => {
            let b = b"NO IP";
            lines[1][..b.len()].copy_from_slice(b);
        }
        Some(ip) => {
            let o = ip.octets();
            let mut line1: HString<20> = HString::new();
            let _ = core::write!(line1, "IP {}.{}.{}.{}", o[0], o[1], o[2], o[3]);
            let b = line1.as_bytes();
            lines[1][..b.len()].copy_from_slice(b);
        }
    };

    lines
}

#[embassy_executor::task]
async fn net_task(mut runner: embassy_net::Runner<'static, WifiDevice<'static>>) {
    runner.run().await;
}

#[embassy_executor::task]
async fn wifi_task(
    mut controller: WifiController<'static>,
    stack: Stack<'static>,
    state: &'static WifiStateMutex,
    initial_is_static_ip: bool,
    mac: [u8; 6],
    initial_credentials: Option<WifiCredentials>,
) {
    info!("Wi-Fi task starting (static_ip={})", initial_is_static_ip);
    let mut active_credentials = initial_credentials;

    'wifi: loop {
        let Some(credentials) = active_credentials else {
            if matches!(controller.is_started(), Ok(true)) {
                if let Err(err) = controller.stop_async().await {
                    warn!("Wi-Fi stop_async while unconfigured failed: {:?}", err);
                }
            }
            {
                let mut guard = state.lock().await;
                guard.state = WifiConnectionState::Idle;
                guard.ipv4 = None;
                guard.gateway = None;
                guard.is_static = false;
                guard.last_error = None;
                guard.mac = Some(mac);
            }
            WIFI_APPLY_SIGNAL.wait().await;
            active_credentials = crate::wifi_credentials_cache();
            continue;
        };

        let ssid = String::from(credentials.ssid());
        let password = String::from(credentials.psk());
        let (net_cfg, is_static_ip) = build_net_config_from_env(Some(&credentials));
        stack.set_config_v4(net_cfg.ipv4);

        {
            let mut guard = state.lock().await;
            guard.state = WifiConnectionState::Connecting;
            guard.ipv4 = None;
            guard.gateway = None;
            guard.last_error = None;
            guard.mac = Some(mac);
        }

        if matches!(controller.is_started(), Ok(true)) {
            if let Err(err) = controller.stop_async().await {
                warn!("Wi-Fi stop_async before reconfigure failed: {:?}", err);
                match select(
                    Timer::after(Duration::from_secs(2)),
                    WIFI_APPLY_SIGNAL.wait(),
                )
                .await
                {
                    Either::First(()) => {}
                    Either::Second(()) => active_credentials = crate::wifi_credentials_cache(),
                }
                continue;
            }
        }

        let client_config = ModeConfig::Client(
            ClientConfig::default()
                .with_ssid(ssid.clone())
                .with_password(password.clone()),
        );

        if let Err(err) = controller.set_config(&client_config) {
            warn!("Wi-Fi set_config error: {:?}", err);
            {
                let mut guard = state.lock().await;
                guard.state = WifiConnectionState::Error;
                guard.last_error = Some(WifiErrorKind::ConnectFailed);
            }
            match select(
                Timer::after(Duration::from_secs(10)),
                WIFI_APPLY_SIGNAL.wait(),
            )
            .await
            {
                Either::First(()) => {}
                Either::Second(()) => active_credentials = crate::wifi_credentials_cache(),
            }
            continue;
        }

        info!("Starting Wi-Fi STA");
        if let Err(err) = controller.start_async().await {
            warn!("Wi-Fi start_async error: {:?}", err);
            {
                let mut guard = state.lock().await;
                guard.state = WifiConnectionState::Error;
                guard.last_error = Some(WifiErrorKind::ConnectFailed);
            }
            match select(
                Timer::after(Duration::from_secs(10)),
                WIFI_APPLY_SIGNAL.wait(),
            )
            .await
            {
                Either::First(()) => {}
                Either::Second(()) => active_credentials = crate::wifi_credentials_cache(),
            }
            continue;
        }

        info!("Connecting to Wi-Fi SSID=\"{}\"", ssid.as_str());
        match controller.connect_async().await {
            Ok(()) => {
                info!("Wi-Fi connect_async returned Ok; waiting for IPv4 config");

                let mut retries: u8 = 0;
                loop {
                    if stack.is_config_up() {
                        break;
                    }
                    if retries >= 30 {
                        warn!("Wi-Fi DHCP/static config not ready within timeout");
                        {
                            let mut guard = state.lock().await;
                            guard.state = WifiConnectionState::Error;
                            guard.last_error = Some(WifiErrorKind::DhcpTimeout);
                        }
                        break;
                    }
                    retries = retries.saturating_add(1);
                    match select(
                        Timer::after(Duration::from_millis(500)),
                        WIFI_APPLY_SIGNAL.wait(),
                    )
                    .await
                    {
                        Either::First(()) => {}
                        Either::Second(()) => {
                            active_credentials = crate::wifi_credentials_cache();
                            let _ = controller.disconnect_async().await;
                            continue 'wifi;
                        }
                    }
                }

                if !stack.is_config_up() {
                    match select(
                        Timer::after(Duration::from_secs(5)),
                        WIFI_APPLY_SIGNAL.wait(),
                    )
                    .await
                    {
                        Either::First(()) => {}
                        Either::Second(()) => {
                            active_credentials = crate::wifi_credentials_cache();
                            let _ = controller.disconnect_async().await;
                            continue 'wifi;
                        }
                    }
                    continue;
                }

                if let Some(cfg) = stack.config_v4() {
                    let ip = cfg.address.address();
                    let gw = cfg.gateway.unwrap_or(Ipv4Address::UNSPECIFIED);
                    info!("Wi-Fi link up: ip={} gw={}", ip, gw);
                    {
                        let mut guard = state.lock().await;
                        guard.state = WifiConnectionState::Connected;
                        guard.ipv4 = Some(ip);
                        guard.gateway = Some(gw);
                        guard.is_static = is_static_ip;
                        guard.last_error = None;
                        guard.mac = Some(mac);
                    }
                }

                match select(
                    controller.wait_for_event(WifiEvent::StaDisconnected),
                    WIFI_APPLY_SIGNAL.wait(),
                )
                .await
                {
                    Either::First(()) => {
                        warn!("Wi-Fi STA disconnected; will retry");
                        {
                            let mut guard = state.lock().await;
                            guard.state = WifiConnectionState::Error;
                            guard.last_error = Some(WifiErrorKind::LinkLost);
                        }
                        active_credentials = crate::wifi_credentials_cache();
                        match select(
                            Timer::after(Duration::from_secs(5)),
                            WIFI_APPLY_SIGNAL.wait(),
                        )
                        .await
                        {
                            Either::First(()) => {}
                            Either::Second(()) => {
                                active_credentials = crate::wifi_credentials_cache();
                                continue 'wifi;
                            }
                        }
                    }
                    Either::Second(()) => {
                        info!("Wi-Fi runtime configuration changed; reconnecting");
                        active_credentials = crate::wifi_credentials_cache();
                        if let Err(err) = controller.disconnect_async().await {
                            warn!(
                                "Wi-Fi disconnect_async during reconfigure failed: {:?}",
                                err
                            );
                        }
                    }
                }
            }
            Err(err) => {
                warn!("Wi-Fi connect_async error: {:?}", err);
                {
                    let mut guard = state.lock().await;
                    guard.state = WifiConnectionState::Error;
                    guard.last_error = Some(WifiErrorKind::ConnectFailed);
                }
                match select(
                    Timer::after(Duration::from_secs(10)),
                    WIFI_APPLY_SIGNAL.wait(),
                )
                .await
                {
                    Either::First(()) => active_credentials = crate::wifi_credentials_cache(),
                    Either::Second(()) => active_credentials = crate::wifi_credentials_cache(),
                }
            }
        }

        Timer::after(Duration::from_millis(100)).await;
    }
}

const HTTP_PORT: u16 = 80;

#[embassy_executor::task]
async fn http_task(
    stack: Stack<'static>,
    device_names: &'static DeviceNames,
    wifi_state: &'static WifiStateMutex,
    api_state: &'static ApiSharedMutex,
) {
    let mut rx_buf = [0u8; 1024];
    let mut tx_buf = [0u8; 1024];

    info!("HTTP server starting (port={})", HTTP_PORT);

    loop {
        stack.wait_config_up().await;

        let mut socket = TcpSocket::new(stack, &mut rx_buf, &mut tx_buf);
        socket.set_timeout(Some(Duration::from_secs(10)));

        match socket.accept(HTTP_PORT).await {
            Ok(()) => {
                if let Err(err) =
                    handle_http_connection(&mut socket, device_names, wifi_state, api_state).await
                {
                    warn!("HTTP connection handling error: {:?}", err);
                }
                socket.close();
                let _ = socket.flush().await;
            }
            Err(err) => {
                warn!("HTTP accept error: {:?}", err);
                Timer::after(Duration::from_millis(200)).await;
            }
        }
    }
}

async fn handle_http_connection(
    socket: &mut TcpSocket<'_>,
    device_names: &'static DeviceNames,
    wifi_state: &'static WifiStateMutex,
    api_state: &'static ApiSharedMutex,
) -> Result<(), embassy_net::tcp::Error> {
    const MAX_REQUEST_SIZE: usize = 1024;

    let mut buf = [0u8; MAX_REQUEST_SIZE];
    let mut total = 0usize;

    // Read until we see the end of headers or the buffer is full.
    loop {
        let n = socket.read(&mut buf[total..]).await?;
        if n == 0 {
            if total == 0 {
                return Ok(());
            }
            break;
        }
        total += n;
        if total >= MAX_REQUEST_SIZE {
            break;
        }
        if buf[..total].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }

    let header_end = buf[..total]
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|idx| idx + 4)
        .unwrap_or(total);
    let header_text = core::str::from_utf8(&buf[..header_end]).unwrap_or("");
    let mut lines = header_text.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();

    let method: String = String::from(parts.next().unwrap_or(""));
    let path_and_query: String = String::from(parts.next().unwrap_or(""));
    let (path, query): (String, String) = path_and_query
        .split_once('?')
        .map(|(path, query)| (String::from(path), String::from(query)))
        .unwrap_or_else(|| (path_and_query.clone(), String::new()));

    let mut origin: Option<String> = None;
    let mut acr_headers: Option<String> = None;
    let mut acr_private_network = false;
    let mut content_length = 0usize;

    for line in lines {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            break;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();

        if key.eq_ignore_ascii_case("Origin") {
            origin = Some(String::from(value));
        } else if key.eq_ignore_ascii_case("Access-Control-Request-Headers") {
            acr_headers = Some(String::from(value));
        } else if key.eq_ignore_ascii_case("Access-Control-Request-Private-Network") {
            acr_private_network = value.eq_ignore_ascii_case("true");
        } else if key.eq_ignore_ascii_case("Content-Length") {
            content_length = value.parse::<usize>().unwrap_or(0);
        }
    }

    let mut body_len = total.saturating_sub(header_end);
    while body_len < content_length && total < MAX_REQUEST_SIZE {
        let n = socket.read(&mut buf[total..]).await?;
        if n == 0 {
            break;
        }
        total += n;
        body_len = total.saturating_sub(header_end);
    }
    let body = if content_length == 0 || header_end >= total {
        ""
    } else {
        let end = (header_end + content_length).min(total);
        core::str::from_utf8(&buf[header_end..end]).unwrap_or("")
    };

    if method == "GET" && path == "/" {
        write_plain_response(socket, "200 OK", "Hello World").await?;
        return Ok(());
    }

    if path.starts_with("/api/v1/") {
        if method == "OPTIONS" {
            write_preflight_response(
                socket,
                origin.as_deref(),
                acr_headers.as_deref(),
                acr_private_network,
                device_names,
            )
            .await?;
            return Ok(());
        }

        handle_api_request(
            socket,
            method.as_str(),
            path.as_str(),
            query.as_str(),
            body,
            origin.as_deref(),
            device_names,
            wifi_state,
            api_state,
        )
        .await?;
        return Ok(());
    }

    write_plain_response(socket, "404 Not Found", "Not Found").await?;
    Ok(())
}

const PROD_ALLOWED_ORIGIN: &str = "https://isolapurr.ivanli.cc";

fn is_allowed_origin(origin: &str) -> bool {
    if origin == PROD_ALLOWED_ORIGIN {
        return true;
    }

    origin == "http://localhost"
        || origin.starts_with("http://localhost:")
        || origin == "http://127.0.0.1"
        || origin.starts_with("http://127.0.0.1:")
}

fn cors_allow_origin(origin: Option<&str>) -> Option<&str> {
    let origin = origin?.trim();
    if is_allowed_origin(origin) {
        Some(origin)
    } else {
        None
    }
}

fn uptime_ms() -> u64 {
    let now_us = HalInstant::now().duration_since_epoch().as_micros();
    (now_us / 1_000) as u64
}

async fn handle_api_request(
    socket: &mut TcpSocket<'_>,
    method: &str,
    path: &str,
    query: &str,
    _body: &str,
    origin: Option<&str>,
    device_names: &'static DeviceNames,
    wifi_state: &'static WifiStateMutex,
    api_state: &'static ApiSharedMutex,
) -> Result<(), embassy_net::tcp::Error> {
    let allow_origin = cors_allow_origin(origin);

    match (method, path) {
        ("GET", "/api/v1/health") => {
            write_json_response(socket, "200 OK", allow_origin, "{\"ok\":true}").await?;
            return Ok(());
        }
        ("GET", "/api/v1/info") => {
            let wifi = { *wifi_state.lock().await };
            let mut body = String::new();

            let mac = format_mac_lower(device_names.mac);
            let ipv4 = wifi.ipv4.map(format_ipv4);
            let wifi_state_s = wifi_state_str(wifi.state);

            let _ = core::write!(
                body,
                "{{\"device\":{{\"device_id\":\"{}\",\"hostname\":\"{}\",\"fqdn\":\"{}\",\"mac\":\"{}\",\"variant\":\"tps-sw\",\"firmware\":{{\"name\":\"{}\",\"version\":\"{}\"}},\"uptime_ms\":{},\"wifi\":{{\"state\":\"{}\",\"ipv4\":",
                device_names.short_id.as_str(),
                device_names.hostname.as_str(),
                device_names.hostname_fqdn.as_str(),
                mac.as_str(),
                env!("CARGO_PKG_NAME"),
                env!("CARGO_PKG_VERSION"),
                uptime_ms(),
                wifi_state_s,
            );

            match ipv4 {
                None => {
                    let _ = body.push_str("null");
                }
                Some(ip) => {
                    let _ = core::write!(body, "\"{}\"", ip.as_str());
                }
            }

            let _ = core::write!(body, ",\"is_static\":{}}}}}}}", wifi.is_static);

            write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
            return Ok(());
        }
        ("GET", "/api/v1/ports") => {
            let state = { *api_state.lock().await };
            let mut body = String::new();
            let _ = body.push_str("{\"hub\":{\"upstream_connected\":");
            let _ = body.push_str(if state.hub.upstream_connected {
                "true"
            } else {
                "false"
            });
            let _ = body.push_str(",\"isolated_usb_fault\":");
            let _ = body.push_str(if state.hub.isolated_usb_fault {
                "true"
            } else {
                "false"
            });
            let _ = body.push_str(",\"isolated_downstream_connected\":");
            let _ = body.push_str(if state.hub.isolated_downstream_connected {
                "true"
            } else {
                "false"
            });
            let _ = body.push_str(",\"isolated_usb_ready\":");
            let _ = body.push_str(if state.hub.isolated_usb_ready {
                "true"
            } else {
                "false"
            });
            let _ = body.push_str(",\"usb_c_downstream_route\":\"");
            let _ = body.push_str(state.hub.usb_c_downstream_route.as_str());
            let _ = body.push_str("\",\"usb_c_downstream_persisted\":");
            let _ = body.push_str(if state.hub.usb_c_downstream_persisted {
                "true"
            } else {
                "false"
            });
            let _ = body.push_str("},\"ports\":[");
            write_port_json(&mut body, ApiPortId::PortA, "USB-A", &state.ports.port_a);
            let _ = body.push(',');
            write_port_json(&mut body, ApiPortId::PortC, "USB-C", &state.ports.port_c);
            let _ = body.push_str("]}");
            write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
            return Ok(());
        }
        ("GET", "/api/v1/pd-diagnostics") => {
            let state = { *api_state.lock().await };
            let mut body = String::new();
            write_pd_diagnostics_json(&mut body, &state.pd);
            write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
            return Ok(());
        }
        ("POST", "/api/v1/hub/usb-c-downstream-route") => {
            let Some(route) = parse_usb_c_downstream_route(query) else {
                write_api_error(
                    socket,
                    "400 Bad Request",
                    allow_origin,
                    "bad_request",
                    "missing or invalid route",
                    false,
                )
                .await?;
                return Ok(());
            };

            match try_set_usb_c_downstream_route(api_state, route).await {
                Ok(()) => {
                    if crate::wait_usb_c_route_result().await {
                        let mut body = String::new();
                        let _ = core::write!(
                            body,
                            "{{\"accepted\":true,\"usb_c_downstream_route\":\"{}\",\"persisted\":true}}",
                            route.as_str()
                        );
                        write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
                    } else {
                        write_api_error(
                            socket,
                            "500 Internal Server Error",
                            allow_origin,
                            "eeprom_failed",
                            "USB-C downstream route could not be saved to EEPROM U21",
                            true,
                        )
                        .await?;
                    }
                }
                Err(ApiActionError::Busy) => {
                    write_api_error(
                        socket,
                        "409 Conflict",
                        allow_origin,
                        "busy",
                        "USB-C downstream route switch is busy",
                        true,
                    )
                    .await?;
                }
            }
            return Ok(());
        }
        _ => {}
    }

    if let Some(rest) = path.strip_prefix("/api/v1/ports/") {
        let (port_id_s, tail) = rest.split_once('/').unwrap_or((rest, ""));
        let Some(port_id) = parse_port_id(port_id_s) else {
            write_api_error(
                socket,
                "404 Not Found",
                allow_origin,
                "invalid_port",
                "invalid port",
                false,
            )
            .await?;
            return Ok(());
        };

        if method == "GET" && tail.is_empty() {
            let ports = { api_state.lock().await.ports };
            let port = match port_id {
                ApiPortId::PortA => ports.port_a,
                ApiPortId::PortC => ports.port_c,
            };

            let mut body = String::new();
            write_port_json(
                &mut body,
                port_id,
                match port_id {
                    ApiPortId::PortA => "USB-A",
                    ApiPortId::PortC => "USB-C",
                },
                &port,
            );
            write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
            return Ok(());
        }

        if method == "POST" && tail == "actions/replug" {
            let accepted = try_set_action(api_state, port_id, ApiPortAction::Replug).await;
            match accepted {
                Ok(()) => {
                    write_json_response(
                        socket,
                        "202 Accepted",
                        allow_origin,
                        "{\"accepted\":true}",
                    )
                    .await?;
                }
                Err(ApiActionError::Busy) => {
                    write_api_error(
                        socket,
                        "409 Conflict",
                        allow_origin,
                        "busy",
                        "port is busy",
                        true,
                    )
                    .await?;
                }
            }
            return Ok(());
        }

        if method == "POST" && tail == "power" {
            let Some(enabled) = parse_enabled_query(query) else {
                write_api_error(
                    socket,
                    "400 Bad Request",
                    allow_origin,
                    "bad_request",
                    "missing or invalid enabled",
                    false,
                )
                .await?;
                return Ok(());
            };

            let accepted =
                try_set_action(api_state, port_id, ApiPortAction::Power { enabled }).await;
            match accepted {
                Ok(()) => {
                    let mut body = String::new();
                    let _ = core::write!(
                        body,
                        "{{\"accepted\":true,\"power_enabled\":{}}}",
                        if enabled { "true" } else { "false" }
                    );
                    write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
                }
                Err(ApiActionError::Busy) => {
                    write_api_error(
                        socket,
                        "409 Conflict",
                        allow_origin,
                        "busy",
                        "port is busy",
                        true,
                    )
                    .await?;
                }
            }
            return Ok(());
        }
    }

    if method == "GET" && path == "/api/v1/wifi" {
        let wifi = { *wifi_state.lock().await };
        let credentials = crate::wifi_credentials_cache();
        let mut body = String::new();
        let _ = core::write!(
            body,
            "{{\"storage\":\"eeprom\",\"address\":\"0x50\",\"configured\":{}",
            if credentials.is_some() {
                "true"
            } else {
                "false"
            },
        );
        if let Some(credentials) = credentials {
            let _ = body.push_str(",\"ssid\":");
            write_json_string(&mut body, credentials.ssid());
            let _ = core::write!(body, ",\"psk_configured\":{}", credentials.psk_configured(),);
        } else {
            let _ = body.push_str(",\"psk_configured\":false");
        }
        let _ = core::write!(
            body,
            ",\"state\":\"{}\",\"ipv4\":",
            wifi_state_str(wifi.state),
        );
        match wifi.ipv4 {
            Some(ip) => {
                let _ = core::write!(body, "\"{}\"", format_ipv4(ip).as_str());
            }
            None => {
                let _ = body.push_str("null");
            }
        }
        let _ = core::write!(body, ",\"is_static\":{}}}", wifi.is_static);
        write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
        return Ok(());
    }

    if method == "POST" && path == "/api/v1/wifi/set" {
        write_api_error(
            socket,
            "403 Forbidden",
            allow_origin,
            "unsafe_transport",
            "Wi-Fi configuration changes require Web Serial or Local USB",
            false,
        )
        .await?;
        return Ok(());
    }

    if method == "POST" && path == "/api/v1/wifi/clear" {
        write_api_error(
            socket,
            "403 Forbidden",
            allow_origin,
            "unsafe_transport",
            "Wi-Fi configuration changes require Web Serial or Local USB",
            false,
        )
        .await?;
        return Ok(());
    }

    if method == "POST" && path == "/api/v1/reboot" {
        write_api_error(
            socket,
            "403 Forbidden",
            allow_origin,
            "unsafe_transport",
            "Reboot to apply Wi-Fi changes requires Web Serial or Local USB",
            false,
        )
        .await?;
        return Ok(());
    }

    write_api_error(
        socket,
        "400 Bad Request",
        allow_origin,
        "bad_request",
        "unknown endpoint",
        false,
    )
    .await?;
    Ok(())
}

fn parse_port_id(s: &str) -> Option<ApiPortId> {
    match s {
        "port_a" => Some(ApiPortId::PortA),
        "port_c" => Some(ApiPortId::PortC),
        _ => None,
    }
}

fn parse_enabled_query(query: &str) -> Option<bool> {
    // enabled={0|1}
    for part in query.split('&') {
        let (k, v) = part.split_once('=')?;
        if k == "enabled" {
            return match v {
                "0" => Some(false),
                "1" => Some(true),
                _ => None,
            };
        }
    }
    None
}

fn parse_usb_c_downstream_route(query: &str) -> Option<UsbCDownstreamRoute> {
    for part in query.split('&') {
        let (key, value) = part.split_once('=')?;
        if key != "route" {
            continue;
        }
        return match value {
            "mcu" => Some(UsbCDownstreamRoute::Mcu),
            "usb_c" => Some(UsbCDownstreamRoute::UsbC),
            _ => None,
        };
    }
    None
}

fn parse_query_value(query: &str, key: &str) -> Option<String> {
    for part in query.split('&') {
        let (k, v) = part.split_once('=')?;
        if k == key {
            return percent_decode(v);
        }
    }
    None
}

fn percent_decode(value: &str) -> Option<String> {
    let mut out = String::new();
    let bytes = value.as_bytes();
    let mut idx = 0;
    while idx < bytes.len() {
        match bytes[idx] {
            b'+' => {
                let _ = out.push(' ');
                idx += 1;
            }
            b'%' if idx + 2 < bytes.len() => {
                let hi = hex_value(bytes[idx + 1])?;
                let lo = hex_value(bytes[idx + 2])?;
                let _ = out.push((hi << 4 | lo) as char);
                idx += 3;
            }
            byte => {
                let _ = out.push(byte as char);
                idx += 1;
            }
        }
    }
    Some(out)
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn write_port_json(body: &mut String, port_id: ApiPortId, label: &str, port: &ApiPortSnapshot) {
    let _ = core::write!(
        body,
        "{{\"portId\":\"{}\",\"label\":\"{}\",\"telemetry\":{{\"status\":\"{}\",\"voltage_mv\":",
        port_id.as_str(),
        label,
        port.telemetry.status.as_str(),
    );

    write_json_u32_or_null(body, port.telemetry.voltage_mv);
    let _ = body.push_str(",\"current_ma\":");
    write_json_u32_or_null(body, port.telemetry.current_ma);
    let _ = body.push_str(",\"power_mw\":");
    write_json_u32_or_null(body, port.telemetry.power_mw);
    let _ = core::write!(
        body,
        ",\"sample_uptime_ms\":{}}},\"state\":{{\"power_enabled\":{},\"data_connected\":{},\"replugging\":{},\"busy\":{}}},\"capabilities\":{{\"data_replug\":true,\"power_set\":true}}}}",
        port.telemetry.sample_uptime_ms,
        if port.state.power_enabled {
            "true"
        } else {
            "false"
        },
        if port.state.data_connected {
            "true"
        } else {
            "false"
        },
        if port.state.replugging {
            "true"
        } else {
            "false"
        },
        if port.state.busy { "true" } else { "false" },
    );
}

pub fn write_pd_diagnostics_json(body: &mut String, pd: &ApiPdSnapshot) {
    let _ = core::write!(
        body,
        "{{\"usb_c_power_enabled\":{},\"sw2303_i2c_allowed\":{},\"sw2303_profile_applied\":{},\"sw2303_stable_reads\":{},\"sw2303_error_latched\":{},\"tps_error_latched\":{},\"sw2303_request\":{{\"mv\":",
        if pd.usb_c_power_enabled {
            "true"
        } else {
            "false"
        },
        if pd.sw2303_i2c_allowed {
            "true"
        } else {
            "false"
        },
        if pd.sw2303_profile_applied {
            "true"
        } else {
            "false"
        },
        pd.sw2303_stable_reads,
        if pd.sw2303_error_latched {
            "true"
        } else {
            "false"
        },
        if pd.tps_error_latched {
            "true"
        } else {
            "false"
        },
    );
    write_json_u32_or_null(body, pd.sw2303_request_mv);
    let _ = body.push_str(",\"ma\":");
    write_json_u32_or_null(body, pd.sw2303_request_ma);
    let _ = body.push_str("},\"sw2303_last_valid_request\":{\"mv\":");
    write_json_u32_or_null(body, pd.sw2303_last_valid_mv);
    let _ = body.push_str(",\"ma\":");
    write_json_u32_or_null(body, pd.sw2303_last_valid_ma);
    let _ = body.push_str("},\"tps_setpoint\":{\"output_enabled\":");
    write_json_bool_or_null(body, pd.tps_setpoint_output_enabled);
    let _ = body.push_str(",\"mv\":");
    write_json_u32_or_null(body, pd.tps_setpoint_mv);
    let _ = body.push_str(",\"ilim_ma\":");
    write_json_u32_or_null(body, pd.tps_setpoint_ilim_ma);
    let _ = core::write!(
        body,
        "}},\"runtime_recovery_count\":{},\"sample_uptime_ms\":{}}}",
        pd.runtime_recovery_count,
        pd.sample_uptime_ms
    );
}

fn write_json_bool_or_null(body: &mut String, v: Option<bool>) {
    match v {
        None => {
            let _ = body.push_str("null");
        }
        Some(true) => {
            let _ = body.push_str("true");
        }
        Some(false) => {
            let _ = body.push_str("false");
        }
    }
}

fn write_json_u32_or_null(body: &mut String, v: Option<u32>) {
    match v {
        None => {
            let _ = body.push_str("null");
        }
        Some(v) => {
            let _ = core::write!(body, "{}", v);
        }
    }
}

fn write_json_string(body: &mut String, value: &str) {
    let _ = body.push('"');
    for ch in value.chars() {
        match ch {
            '"' => {
                let _ = body.push_str("\\\"");
            }
            '\\' => {
                let _ = body.push_str("\\\\");
            }
            '\n' => {
                let _ = body.push_str("\\n");
            }
            '\r' => {
                let _ = body.push_str("\\r");
            }
            '\t' => {
                let _ = body.push_str("\\t");
            }
            ch if ch < ' ' => {
                let _ = core::write!(body, "\\u{:04x}", ch as u32);
            }
            ch => {
                let _ = body.push(ch);
            }
        }
    }
    let _ = body.push('"');
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApiActionError {
    Busy,
}

pub async fn try_set_action(
    api_state: &'static ApiSharedMutex,
    port_id: ApiPortId,
    action: ApiPortAction,
) -> Result<(), ApiActionError> {
    let mut guard = api_state.lock().await;
    let port = match port_id {
        ApiPortId::PortA => guard.ports.port_a,
        ApiPortId::PortC => guard.ports.port_c,
    };

    if port.state.busy
        || (port_id == ApiPortId::PortC && guard.pending.usb_c_downstream_route.is_some())
    {
        return Err(ApiActionError::Busy);
    }

    let slot = match port_id {
        ApiPortId::PortA => &mut guard.pending.port_a,
        ApiPortId::PortC => &mut guard.pending.port_c,
    };
    // If a previous action is still pending, treat as busy.
    if slot.is_some() {
        return Err(ApiActionError::Busy);
    }
    *slot = Some(action);
    Ok(())
}

pub async fn try_set_usb_c_downstream_route(
    api_state: &'static ApiSharedMutex,
    route: UsbCDownstreamRoute,
) -> Result<(), ApiActionError> {
    let mut guard = api_state.lock().await;
    if guard.ports.port_c.state.busy || guard.pending.usb_c_downstream_route.is_some() {
        return Err(ApiActionError::Busy);
    }
    crate::reset_usb_c_route_result();
    guard.pending.usb_c_downstream_route = Some(route);
    Ok(())
}

async fn write_preflight_response(
    socket: &mut TcpSocket<'_>,
    origin: Option<&str>,
    requested_headers: Option<&str>,
    request_private_network: bool,
    device_names: &'static DeviceNames,
) -> Result<(), embassy_net::tcp::Error> {
    let allow_origin = cors_allow_origin(origin);

    let mut headers = String::new();
    if let Some(origin) = allow_origin {
        let _ = core::write!(
            headers,
            "Access-Control-Allow-Origin: {}\r\nVary: Origin\r\n",
            origin,
        );
    }

    let _ = headers.push_str("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
    let _ = core::write!(
        headers,
        "Access-Control-Allow-Headers: {}\r\n",
        requested_headers.unwrap_or("Content-Type")
    );

    if request_private_network {
        let mac = format_mac_lower(device_names.mac);
        let _ = headers.push_str("Access-Control-Allow-Private-Network: true\r\n");
        let _ = core::write!(
            headers,
            "Private-Network-Access-ID: {}\r\nPrivate-Network-Access-Name: {}\r\n",
            mac.as_str(),
            device_names.hostname.as_str(),
        );
    }

    write_http_response(socket, "204 No Content", None, headers.as_str(), "").await?;
    Ok(())
}

async fn write_api_error(
    socket: &mut TcpSocket<'_>,
    status: &str,
    allow_origin: Option<&str>,
    code: &str,
    message: &str,
    retryable: bool,
) -> Result<(), embassy_net::tcp::Error> {
    let mut body = String::new();
    let _ = core::write!(
        body,
        "{{\"error\":{{\"code\":\"{}\",\"message\":\"{}\",\"retryable\":{}}}}}",
        code,
        message,
        if retryable { "true" } else { "false" }
    );
    write_json_response(socket, status, allow_origin, body.as_str()).await
}

async fn write_json_response(
    socket: &mut TcpSocket<'_>,
    status: &str,
    allow_origin: Option<&str>,
    body: &str,
) -> Result<(), embassy_net::tcp::Error> {
    let mut extra_headers = String::new();
    let _ = extra_headers.push_str("Cache-Control: no-store\r\n");
    if let Some(origin) = allow_origin {
        let _ = core::write!(
            extra_headers,
            "Access-Control-Allow-Origin: {}\r\nVary: Origin\r\n",
            origin,
        );
    }
    write_http_response(
        socket,
        status,
        Some("application/json; charset=utf-8"),
        extra_headers.as_str(),
        body,
    )
    .await
}

async fn write_plain_response(
    socket: &mut TcpSocket<'_>,
    status: &str,
    body: &str,
) -> Result<(), embassy_net::tcp::Error> {
    write_http_response(socket, status, Some("text/plain"), "", body).await
}

async fn write_http_response(
    socket: &mut TcpSocket<'_>,
    status: &str,
    content_type: Option<&str>,
    extra_headers: &str,
    body: &str,
) -> Result<(), embassy_net::tcp::Error> {
    let mut header = String::new();
    let _ = core::write!(header, "HTTP/1.1 {}\r\n", status);
    if let Some(ct) = content_type {
        let _ = core::write!(header, "Content-Type: {}\r\n", ct);
    }
    let _ = core::write!(header, "Content-Length: {}\r\n", body.as_bytes().len());
    let _ = header.push_str("Connection: close\r\n");
    let _ = header.push_str(extra_headers);
    let _ = header.push_str("\r\n");

    socket_write_all(socket, header.as_bytes()).await?;
    socket_write_all(socket, body.as_bytes()).await?;
    Ok(())
}

async fn socket_write_all(
    socket: &mut TcpSocket<'_>,
    mut buf: &[u8],
) -> Result<(), embassy_net::tcp::Error> {
    while !buf.is_empty() {
        let written = socket.write(buf).await?;
        if written == 0 {
            return Err(embassy_net::tcp::Error::ConnectionReset);
        }
        buf = &buf[written..];
    }
    Ok(())
}

fn wifi_state_str(state: WifiConnectionState) -> &'static str {
    match state {
        WifiConnectionState::Idle => "idle",
        WifiConnectionState::Connecting => "connecting",
        WifiConnectionState::Connected => "connected",
        WifiConnectionState::Error => "error",
    }
}

fn format_ipv4(ip: Ipv4Address) -> HString<16> {
    let o = ip.octets();
    let mut out: HString<16> = HString::new();
    let _ = core::write!(out, "{}.{}.{}.{}", o[0], o[1], o[2], o[3]);
    out
}

fn format_mac_lower(mac: [u8; 6]) -> HString<17> {
    let mut out: HString<17> = HString::new();
    let _ = core::write!(
        out,
        "{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
        mac[0],
        mac[1],
        mac[2],
        mac[3],
        mac[4],
        mac[5]
    );
    out
}

fn derive_device_names(mac: [u8; 6]) -> DeviceNames {
    let short_id = mdns::short_id_from_mac(mac);
    let hostname = WIFI_HOSTNAME
        .map(sanitize_hostname)
        .filter(|hostname| !hostname.is_empty())
        .unwrap_or_else(|| mdns::hostname_from_short_id(short_id.as_str()));
    let hostname_fqdn = mdns::fqdn_from_hostname(hostname.as_str());

    DeviceNames {
        mac,
        short_id,
        hostname,
        hostname_fqdn,
    }
}

fn sanitize_hostname(raw: &str) -> HString<32> {
    let mut out: HString<32> = HString::new();
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' {
            if out.push(ch.to_ascii_lowercase()).is_err() {
                break;
            }
        }
    }
    out
}

fn parse_ipv4(s: &str) -> Option<Ipv4Address> {
    let mut parts = [0u8; 4];
    let mut idx = 0;
    for part in s.split('.') {
        if idx >= 4 {
            return None;
        }
        parts[idx] = part.parse::<u8>().ok()?;
        idx += 1;
    }
    if idx != 4 {
        return None;
    }
    Some(Ipv4Address::new(parts[0], parts[1], parts[2], parts[3]))
}

fn netmask_to_prefix(mask: Ipv4Address) -> Option<u8> {
    let value = u32::from_be_bytes(mask.octets());
    let prefix = value.count_ones() as u8;
    let reconstructed = if prefix == 0 {
        0
    } else {
        u32::MAX.checked_shl((32 - prefix as u32) as u32)?
    };
    if reconstructed == value {
        Some(prefix)
    } else {
        None
    }
}

fn build_net_config_from_env(credentials: Option<&WifiCredentials>) -> (NetConfig, bool) {
    if let Some(static_ipv4) = credentials.and_then(|credentials| credentials.static_ipv4()) {
        let address = Ipv4Address::new(
            static_ipv4.address[0],
            static_ipv4.address[1],
            static_ipv4.address[2],
            static_ipv4.address[3],
        );
        let netmask = Ipv4Address::new(
            static_ipv4.netmask[0],
            static_ipv4.netmask[1],
            static_ipv4.netmask[2],
            static_ipv4.netmask[3],
        );
        let gateway = Ipv4Address::new(
            static_ipv4.gateway[0],
            static_ipv4.gateway[1],
            static_ipv4.gateway[2],
            static_ipv4.gateway[3],
        );
        if let Some(prefix) = netmask_to_prefix(netmask) {
            let mut dns_servers: Vec<Ipv4Address, 3> = Vec::new();
            if let Some(dns) = static_ipv4.dns {
                let dns_ip = Ipv4Address::new(dns[0], dns[1], dns[2], dns[3]);
                let _ = dns_servers.push(dns_ip);
            }
            let static_cfg = StaticConfigV4 {
                address: Ipv4Cidr::new(address, prefix),
                gateway: Some(gateway),
                dns_servers,
            };
            info!(
                "Wi-Fi using EEPROM static IPv4: addr={} prefix={} gw={}",
                address, prefix, gateway
            );
            return (NetConfig::ipv4_static(static_cfg), true);
        }
    }

    let static_ip = WIFI_STATIC_IP;
    let netmask = WIFI_NETMASK;
    let gateway = WIFI_GATEWAY;

    if let (Some(ip_s), Some(mask_s), Some(gw_s)) = (static_ip, netmask, gateway) {
        if let (Some(ip), Some(mask), Some(gw)) =
            (parse_ipv4(ip_s), parse_ipv4(mask_s), parse_ipv4(gw_s))
        {
            if let Some(prefix) = netmask_to_prefix(mask) {
                let cidr = Ipv4Cidr::new(ip, prefix);
                let mut dns_servers: Vec<Ipv4Address, 3> = Vec::new();

                if let Some(dns_s) = WIFI_DNS {
                    if let Some(dns_ip) = parse_ipv4(dns_s) {
                        let _ = dns_servers.push(dns_ip);
                    }
                }

                let static_cfg = StaticConfigV4 {
                    address: cidr,
                    gateway: Some(gw),
                    dns_servers,
                };

                info!(
                    "Wi-Fi using static IPv4: addr={} prefix={} gw={}",
                    ip, prefix, gw
                );
                return (NetConfig::ipv4_static(static_cfg), true);
            }
        }
    }

    build_net_config_dhcp()
}

fn build_net_config_dhcp() -> (NetConfig, bool) {
    info!("Wi-Fi using DHCPv4 for IPv4 configuration");
    (NetConfig::dhcpv4(DhcpConfig::default()), false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_hub_snapshot_defaults_to_upgrade_route() {
        assert_eq!(
            ApiHubSnapshot::unknown().usb_c_downstream_route,
            UsbCDownstreamRoute::Mcu
        );
    }
}
