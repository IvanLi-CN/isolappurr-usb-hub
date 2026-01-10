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
use esp_hal::{peripherals::WIFI, rng::Rng};
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

pub fn spawn_wifi_mdns_http(
    spawner: &Spawner,
    wifi_peripheral: WIFI<'static>,
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

    spawner.spawn(http_task(stack)).ok()?;

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

pub fn format_network_toast_lines(hostname: &str, ip: Option<Ipv4Address>) -> [[u8; 13]; 3] {
    let mut lines = [[b' '; 13]; 3];

    // Hostname split across line 0/1 (no `.local`, to fit).
    let hostname = hostname.trim();
    let bytes = hostname.as_bytes();
    let first = bytes.len().min(13);
    lines[0][..first].copy_from_slice(&bytes[..first]);
    if bytes.len() > 13 {
        let second = (bytes.len() - 13).min(13);
        lines[1][..second].copy_from_slice(&bytes[13..13 + second]);
    }

    // IP or NO IP in line 2.
    match ip {
        Some(ip) => {
            let o = ip.octets();
            let mut s: HString<15> = HString::new();
            let _ = core::write!(s, "{}.{}.{}.{}", o[0], o[1], o[2], o[3]);
            let b = s.as_bytes();
            let n = b.len().min(13);
            lines[2][..n].copy_from_slice(&b[..n]);
        }
        None => {
            let b = b"NO IP";
            lines[2][..b.len()].copy_from_slice(b);
        }
    }

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
async fn http_task(stack: Stack<'static>) {
    let mut rx_buf = [0u8; 1024];
    let mut tx_buf = [0u8; 1024];

    info!("HTTP server starting (port={})", HTTP_PORT);

    loop {
        stack.wait_config_up().await;

        let mut socket = TcpSocket::new(stack, &mut rx_buf, &mut tx_buf);
        socket.set_timeout(Some(Duration::from_secs(10)));

        match socket.accept(HTTP_PORT).await {
            Ok(()) => {
                if let Err(err) = handle_http_connection(&mut socket).await {
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

async fn handle_http_connection(socket: &mut TcpSocket<'_>) -> Result<(), embassy_net::tcp::Error> {
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
    let path = parts.next().unwrap_or("");

    if method == "GET" && path == "/" {
        write_http_response(socket, "200 OK", "Hello World").await?;
    } else {
        write_http_response(socket, "404 Not Found", "Not Found").await?;
    }

    Ok(())
}

async fn write_http_response(
    socket: &mut TcpSocket<'_>,
    status: &str,
    body: &str,
) -> Result<(), embassy_net::tcp::Error> {
    let mut header: HString<192> = HString::new();
    let _ = core::write!(
        header,
        "HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n",
        status = status,
        len = body.as_bytes().len(),
    );

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
