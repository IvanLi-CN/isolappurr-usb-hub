#![allow(dead_code)]

use core::fmt::Write as _;

use alloc::string::String;
use defmt::*;
use embassy_executor::Spawner;
use embassy_net::{
    Config as NetConfig, DhcpConfig, Ipv4Address, Ipv4Cidr, Stack, StackResources, StaticConfigV4,
    tcp::TcpSocket,
};
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, mutex::Mutex};
use embassy_time::{Duration, Timer};
use esp_hal::{peripherals::WIFI, rng::Rng, time::Instant as HalInstant};
use esp_radio::{
    Controller as RadioController, init as radio_init,
    wifi::{self, ClientConfig, ModeConfig, WifiController, WifiDevice, WifiEvent},
};
use heapless::{String as HString, Vec};
use static_cell::StaticCell;

use crate::mdns;
use crate::mdns::MdnsConfig;
use crate::{
    WIFI_DNS, WIFI_GATEWAY, WIFI_HOSTNAME, WIFI_NETMASK, WIFI_PSK, WIFI_SSID, WIFI_STATIC_IP,
};

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
pub enum ApiPortAction {
    Replug,
    Power { enabled: bool },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApiPendingActions {
    pub port_a: Option<ApiPortAction>,
    pub port_c: Option<ApiPortAction>,
}

impl ApiPendingActions {
    pub const fn empty() -> Self {
        Self {
            port_a: None,
            port_c: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ApiSharedState {
    pub ports: ApiPortsSnapshot,
    pub pending: ApiPendingActions,
}

impl ApiSharedState {
    pub const fn new() -> Self {
        Self {
            ports: ApiPortsSnapshot::unknown(),
            pending: ApiPendingActions::empty(),
        }
    }
}

pub type ApiSharedMutex = Mutex<CriticalSectionRawMutex, ApiSharedState>;

pub fn init_http_api_state() -> &'static ApiSharedMutex {
    API_STATE_CELL.init(Mutex::new(ApiSharedState::new()))
}

pub fn spawn_wifi_mdns_http(
    spawner: &Spawner,
    wifi_peripheral: WIFI<'static>,
    api_state: &'static ApiSharedMutex,
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

    let (net_cfg, is_static) = build_net_config_from_env();

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
    is_static_ip: bool,
    mac: [u8; 6],
) {
    info!(
        "Wi-Fi task starting (ssid=\"{}\", hostname={:?}, static_ip={})",
        WIFI_SSID, WIFI_HOSTNAME, is_static_ip,
    );

    let ssid = String::from(WIFI_SSID);
    let password = String::from(WIFI_PSK);

    loop {
        {
            let mut guard = state.lock().await;
            guard.state = WifiConnectionState::Connecting;
            guard.last_error = None;
            guard.mac = Some(mac);
        }

        let client_config = ModeConfig::Client(
            ClientConfig::default()
                .with_ssid(ssid.clone())
                .with_password(password.clone()),
        );

        if !matches!(controller.is_started(), Ok(true)) {
            if let Err(err) = controller.set_config(&client_config) {
                warn!("Wi-Fi set_config error: {:?}", err);
                {
                    let mut guard = state.lock().await;
                    guard.state = WifiConnectionState::Error;
                    guard.last_error = Some(WifiErrorKind::ConnectFailed);
                }
                Timer::after(Duration::from_secs(10)).await;
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
                Timer::after(Duration::from_secs(10)).await;
                continue;
            }
        }

        info!("Connecting to Wi-Fi SSID=\"{}\"", WIFI_SSID);
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
                    Timer::after(Duration::from_millis(500)).await;
                }

                if !stack.is_config_up() {
                    Timer::after(Duration::from_secs(5)).await;
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

                // Wait for disconnect; then loop to reconnect.
                controller.wait_for_event(WifiEvent::StaDisconnected).await;
                warn!("Wi-Fi STA disconnected; will retry");
                {
                    let mut guard = state.lock().await;
                    guard.state = WifiConnectionState::Error;
                    guard.last_error = Some(WifiErrorKind::LinkLost);
                }
                Timer::after(Duration::from_secs(5)).await;
            }
            Err(err) => {
                warn!("Wi-Fi connect_async error: {:?}", err);
                {
                    let mut guard = state.lock().await;
                    guard.state = WifiConnectionState::Error;
                    guard.last_error = Some(WifiErrorKind::ConnectFailed);
                }
                Timer::after(Duration::from_secs(10)).await;
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

    let req = core::str::from_utf8(&buf[..total]).unwrap_or("");
    let mut lines = req.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();

    let method = parts.next().unwrap_or("");
    let path_and_query = parts.next().unwrap_or("");
    let (path, query) = path_and_query
        .split_once('?')
        .unwrap_or((path_and_query, ""));

    let mut origin: Option<&str> = None;
    let mut acr_headers: Option<&str> = None;
    let mut acr_private_network = false;

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
            origin = Some(value);
        } else if key.eq_ignore_ascii_case("Access-Control-Request-Headers") {
            acr_headers = Some(value);
        } else if key.eq_ignore_ascii_case("Access-Control-Request-Private-Network") {
            acr_private_network = value.eq_ignore_ascii_case("true");
        }
    }

    if method == "GET" && path == "/" {
        write_plain_response(socket, "200 OK", "Hello World").await?;
        return Ok(());
    }

    if path.starts_with("/api/v1/") {
        if method == "OPTIONS" {
            write_preflight_response(
                socket,
                origin,
                acr_headers,
                acr_private_network,
                device_names,
            )
            .await?;
            return Ok(());
        }

        handle_api_request(
            socket,
            method,
            path,
            query,
            origin,
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
            let ports = { api_state.lock().await.ports };
            let mut body = String::new();
            let _ = body.push_str("{\"ports\":[");
            write_port_json(&mut body, ApiPortId::PortA, "USB-A", &ports.port_a);
            let _ = body.push(',');
            write_port_json(&mut body, ApiPortId::PortC, "USB-C", &ports.port_c);
            let _ = body.push_str("]}");
            write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ApiActionError {
    Busy,
}

async fn try_set_action(
    api_state: &'static ApiSharedMutex,
    port_id: ApiPortId,
    action: ApiPortAction,
) -> Result<(), ApiActionError> {
    let mut guard = api_state.lock().await;
    let port = match port_id {
        ApiPortId::PortA => guard.ports.port_a,
        ApiPortId::PortC => guard.ports.port_c,
    };

    if port.state.busy {
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
    let hostname = if let Some(override_host) = WIFI_HOSTNAME {
        let sanitized = sanitize_hostname(override_host);
        if sanitized.is_empty() {
            mdns::hostname_from_short_id(short_id.as_str())
        } else {
            sanitized
        }
    } else {
        mdns::hostname_from_short_id(short_id.as_str())
    };
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
        let v = part.parse::<u8>().ok()?;
        parts[idx] = v;
        idx += 1;
    }
    if idx != 4 {
        return None;
    }
    Some(Ipv4Address::new(parts[0], parts[1], parts[2], parts[3]))
}

fn netmask_to_prefix(mask: Ipv4Address) -> Option<u8> {
    let octets = mask.octets();
    let value = u32::from_be_bytes(octets);
    let ones = value.count_ones();
    if ones > 32 {
        return None;
    }
    let prefix = ones as u8;
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

fn build_net_config_from_env() -> (NetConfig, bool) {
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
            } else {
                warn!(
                    "Wi-Fi static netmask invalid (mask={}); falling back to DHCP",
                    mask
                );
            }
        } else {
            warn!(
                "Wi-Fi static config parse failed (ip={:?}, netmask={:?}, gateway={:?}); falling back to DHCP",
                static_ip, netmask, gateway
            );
        }
    }

    info!("Wi-Fi using DHCPv4 for IPv4 configuration");
    (NetConfig::dhcpv4(DhcpConfig::default()), false)
}
