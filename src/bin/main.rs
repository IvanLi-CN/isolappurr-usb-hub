#![no_std]
#![no_main]
#![deny(
    clippy::mem_forget,
    reason = "mem::forget is generally not safe to do with esp_hal types, especially those \
    holding buffers for the duration of a data transfer."
)]

#[path = "../spi_device.rs"]
mod spi_device;

// Enable heap allocations (String, Vec, etc.) only when the experimental
// net_http feature is used for Wi‑Fi + mDNS + HTTP (Plan #0003).
#[cfg(feature = "net_http")]
extern crate alloc;

// Optional Wi‑Fi + mDNS + HTTP support; compiled only when `net_http` feature is set.
#[cfg(feature = "net_http")]
#[path = "../mdns.rs"]
mod mdns;
#[cfg(feature = "net_http")]
#[path = "../net.rs"]
mod net;

const BUILD_GIT_SHA: &str = env!("USB_HUB_BUILD_GIT_SHA");
const BUILD_GIT_REF: &str = env!("USB_HUB_BUILD_GIT_REF");
const BUILD_GIT_DIRTY: &str = env!("USB_HUB_BUILD_GIT_DIRTY");
const BUILD_PROFILE: &str = env!("USB_HUB_BUILD_PROFILE");

use core::cell::RefCell;
#[cfg(feature = "net_http")]
use core::fmt::Write as _;
use core::sync::atomic::{AtomicBool, Ordering};
use critical_section::Mutex;
#[cfg(feature = "net_http")]
use defmt::debug;
use defmt::info;
use embassy_executor::Spawner;
#[cfg(feature = "net_http")]
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, signal::Signal};
use embassy_time::Timer;
use esp_hal::clock::CpuClock;
use esp_hal::dma::{DmaRxBuf, DmaTxBuf};
use esp_hal::gpio::{
    AnyPin, DriveMode, Event, Flex, Input, InputConfig, Io, Level, Output, OutputConfig, Pull,
};
use esp_hal::i2c::master::{Config as I2cConfig, I2c, SoftwareTimeout};
use esp_hal::spi::Mode;
use esp_hal::spi::master::{Config as SpiConfig, Spi};
use esp_hal::time::{Duration, Instant, Rate};
use esp_hal::timer::timg::TimerGroup;
#[cfg(feature = "net_http")]
use esp_hal::usb_serial_jtag::UsbSerialJtag;
use esp_hal::{dma_buffers, handler, ram};
use isolapurr_usb_hub::buzzer::ledc::LedcBuzzer;
use isolapurr_usb_hub::display_ui::{
    ActiveLowBacklight, DASHBOARD_BG_RGB8, DisplayUi, EspHalSpinTimer, NormalUiField, NormalUiPort,
    NormalUiPortMode, NormalUiSnapshot, WORKBUF_SIZE, normal_ui_usb_c_mode,
    normal_ui_usb_c_present,
};
use isolapurr_usb_hub::pd_i2c::I2cAllowlist;
use isolapurr_usb_hub::pd_i2c::PowerRequest;
use isolapurr_usb_hub::pd_i2c::TPS55288_ADDR_7BIT;
use isolapurr_usb_hub::pd_i2c::sw2303::{
    EnableProfileStatus, apply_enable_profile_full, read_power_request,
};
use isolapurr_usb_hub::pd_i2c::tps55288::{
    TpsApplyState, apply_setpoint, apply_setpoint_before_enable, boot_supply_setpoint,
    power_request_to_setpoint, stop_output_and_enable_discharge,
};
use isolapurr_usb_hub::prompt_tone::{
    DEFAULT_DUTY_PCT, DEFAULT_FREQ_HZ, ErrorKind, InitWarnReason, PromptToneManager, SafetyKind,
    SoundEvent,
};
#[cfg(feature = "net_http")]
use isolapurr_usb_hub::provisioning;
use isolapurr_usb_hub::telemetry::{Field, NormalUiTelemetrySampler, TelemetryI2cAllowlist};

#[cfg(feature = "net_http")]
use isolapurr_usb_hub::telemetry::PortMetrics;
use {esp_backtrace as _, esp_println as _};

use spi_device::CsSpiDevice;

// This creates a default app-descriptor required by the esp-idf bootloader.
// For more information see: <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/app_image_format.html#application-description>
esp_bootloader_esp_idf::esp_app_desc!();

static mut DISPLAY_WORKBUF: [u8; WORKBUF_SIZE] = [0; WORKBUF_SIZE];

static TPS_INT: Mutex<RefCell<Option<Input>>> = Mutex::new(RefCell::new(None));
static TPS_INT_DIRTY: AtomicBool = AtomicBool::new(false);

#[cfg(feature = "net_http")]
#[derive(Clone, Copy)]
enum WifiProvisioningCommand {
    Store(provisioning::WifiCredentials),
    Clear,
}

#[cfg(feature = "net_http")]
static WIFI_PROVISIONING_PENDING: Mutex<RefCell<Option<WifiProvisioningCommand>>> =
    Mutex::new(RefCell::new(None));

#[cfg(feature = "net_http")]
static WIFI_PROVISIONING_RESULT: Signal<CriticalSectionRawMutex, bool> = Signal::new();

#[cfg(feature = "net_http")]
static USB_C_ROUTE_RESULT: Signal<CriticalSectionRawMutex, bool> = Signal::new();

#[cfg(feature = "net_http")]
static WIFI_CREDENTIALS_CACHE: Mutex<RefCell<Option<provisioning::WifiCredentials>>> =
    Mutex::new(RefCell::new(None));

#[cfg(feature = "net_http")]
static REBOOT_PENDING: AtomicBool = AtomicBool::new(false);

#[cfg(feature = "net_http")]
#[embassy_executor::task]
async fn usb_console_task(
    mut usb: UsbSerialJtag<'static, esp_hal::Async>,
    api_state: &'static net::ApiSharedMutex,
    device_names: Option<&'static net::DeviceNames>,
    wifi_state: Option<&'static net::WifiStateMutex>,
) {
    use embedded_io_async::Read as _;

    let mut rx = [0u8; 64];
    let mut line = [0u8; 512];
    let mut len = 0usize;

    loop {
        let n = usb.read(&mut rx).await.ok().unwrap_or(0);
        for byte in &rx[..n] {
            if *byte == b'\n' {
                if len > 0 {
                    let request = core::str::from_utf8(&line[..len]).unwrap_or("");
                    let response =
                        handle_usb_jsonl_request(request, api_state, device_names, wifi_state)
                            .await;
                    usb_console_write_line(&mut usb, response.as_bytes()).await;
                    len = 0;
                }
            } else if *byte != b'\r' && len < line.len() {
                line[len] = *byte;
                len += 1;
            } else if len >= line.len() {
                len = 0;
                usb_console_write_line(
                    &mut usb,
                    b"{\"id\":null,\"ok\":false,\"error\":{\"code\":\"frame_too_large\",\"message\":\"JSONL frame too large\",\"retryable\":false}}",
                )
                .await;
            }
        }
    }
}

#[cfg(feature = "net_http")]
async fn usb_console_write_line(
    usb: &mut UsbSerialJtag<'static, esp_hal::Async>,
    mut bytes: &[u8],
) {
    while !bytes.is_empty() {
        let end = bytes.len().min(32);
        match embedded_io_async::Write::write(usb, &bytes[..end]).await {
            Ok(0) => Timer::after_millis(1).await,
            Ok(n) => bytes = &bytes[n.min(end)..],
            Err(_) => return,
        }
    }
    let _ = embedded_io_async::Write::write(usb, b"\n").await;
    let _ = embedded_io_async::Write::flush(usb).await;
}

#[cfg(feature = "net_http")]
async fn handle_usb_jsonl_request(
    request: &str,
    api_state: &'static net::ApiSharedMutex,
    device_names: Option<&'static net::DeviceNames>,
    wifi_state: Option<&'static net::WifiStateMutex>,
) -> alloc::string::String {
    let id = parse_jsonl_id(request);
    let mut body = alloc::string::String::new();

    if request.contains("\"method\":\"info\"") || request.contains("\"method\": \"info\"") {
        let wifi = match wifi_state {
            Some(state) => Some(*state.lock().await),
            None => None,
        };
        write_usb_info_json(&mut body, id.as_str(), device_names, wifi);
        return body;
    }

    if request.contains("\"method\":\"ports.get\"") || request.contains("\"method\": \"ports.get\"")
    {
        let state = { *api_state.lock().await };
        let _ = write!(
            body,
            "{{\"id\":{},\"ok\":true,\"result\":{{\"hub\":{{\"upstream_connected\":{},\"isolated_usb_fault\":{},\"isolated_downstream_connected\":{},\"isolated_usb_ready\":{},\"usb_c_downstream_route\":\"{}\",\"usb_c_downstream_persisted\":{}}},\"ports\":[",
            id.as_str(),
            state.hub.upstream_connected,
            state.hub.isolated_usb_fault,
            state.hub.isolated_downstream_connected,
            state.hub.isolated_usb_ready,
            state.hub.usb_c_downstream_route.as_str(),
            state.hub.usb_c_downstream_persisted
        );
        write_usb_port_json(&mut body, "port_a", "USB-A", &state.ports.port_a);
        let _ = body.push(',');
        write_usb_port_json(&mut body, "port_c", "USB-C", &state.ports.port_c);
        let _ = body.push_str("]}}");
        return body;
    }

    if request.contains("\"method\":\"hub.route_set\"")
        || request.contains("\"method\": \"hub.route_set\"")
    {
        let Some(route) =
            extract_json_string(request, "route").and_then(|route| match route.as_str() {
                "mcu" => Some(provisioning::UsbCDownstreamRoute::Mcu),
                "usb_c" => Some(provisioning::UsbCDownstreamRoute::UsbC),
                _ => None,
            })
        else {
            write_jsonl_error(
                &mut body,
                id.as_str(),
                "bad_request",
                "missing or invalid route",
                false,
            );
            return body;
        };

        match net::try_set_usb_c_downstream_route(api_state, route).await {
            Ok(()) => {
                if wait_usb_c_route_result().await {
                    let _ = write!(
                        body,
                        "{{\"id\":{},\"ok\":true,\"result\":{{\"accepted\":true,\"usb_c_downstream_route\":\"{}\",\"persisted\":true}}}}",
                        id.as_str(),
                        route.as_str()
                    );
                } else {
                    write_jsonl_error(
                        &mut body,
                        id.as_str(),
                        "eeprom_failed",
                        "USB-C downstream route could not be saved to EEPROM U21",
                        true,
                    );
                }
            }
            Err(net::ApiActionError::Busy) => {
                write_jsonl_error(
                    &mut body,
                    id.as_str(),
                    "busy",
                    "USB-C downstream route switch is busy",
                    true,
                );
            }
        }
        return body;
    }

    if request.contains("\"method\":\"port.replug\"")
        || request.contains("\"method\": \"port.replug\"")
        || request.contains("\"method\":\"port.power_set\"")
        || request.contains("\"method\": \"port.power_set\"")
    {
        let Some(port_id) =
            extract_json_string(request, "port").and_then(|port| match port.as_str() {
                "port_a" => Some(net::ApiPortId::PortA),
                "port_c" => Some(net::ApiPortId::PortC),
                _ => None,
            })
        else {
            write_jsonl_error(
                &mut body,
                id.as_str(),
                "bad_request",
                "missing or invalid port",
                false,
            );
            return body;
        };

        let action = if request.contains("power_set") {
            let Some(enabled) = extract_json_bool(request, "enabled") else {
                write_jsonl_error(
                    &mut body,
                    id.as_str(),
                    "bad_request",
                    "missing enabled",
                    false,
                );
                return body;
            };
            net::ApiPortAction::Power { enabled }
        } else {
            net::ApiPortAction::Replug
        };

        match net::try_set_action(api_state, port_id, action).await {
            Ok(()) => {
                let _ = write!(
                    body,
                    "{{\"id\":{},\"ok\":true,\"result\":{{\"accepted\":true}}}}",
                    id.as_str()
                );
            }
            Err(net::ApiActionError::Busy) => {
                write_jsonl_error(&mut body, id.as_str(), "busy", "port is busy", true)
            }
        }
        return body;
    }

    if request.contains("\"method\":\"wifi.get\"") || request.contains("\"method\": \"wifi.get\"") {
        let wifi = match wifi_state {
            Some(state) => Some(*state.lock().await),
            None => None,
        };
        if let Some(credentials) = wifi_credentials_cache() {
            let _ = write!(
                body,
                "{{\"id\":{},\"ok\":true,\"result\":{{\"configured\":true,\"storage\":\"eeprom\",\"address\":\"0x50\",\"ssid\":",
                id.as_str()
            );
            write_json_string(&mut body, credentials.ssid());
            let _ = write!(body, ",\"psk_configured\":{}", credentials.psk_configured());
        } else {
            let _ = write!(
                body,
                "{{\"id\":{},\"ok\":true,\"result\":{{\"configured\":false,\"storage\":\"eeprom\",\"address\":\"0x50\",\"psk_configured\":false",
                id.as_str()
            );
        }
        write_usb_wifi_runtime_fields(&mut body, wifi);
        let _ = body.push_str("}}");
        return body;
    }

    if request.contains("\"method\":\"wifi.set\"") || request.contains("\"method\": \"wifi.set\"") {
        let Some(ssid) = extract_json_string(request, "ssid") else {
            write_jsonl_error(&mut body, id.as_str(), "bad_request", "missing ssid", false);
            return body;
        };
        let psk = extract_json_string(request, "psk").unwrap_or_default();
        match provisioning::WifiCredentials::new(ssid.as_str(), psk.as_str()) {
            Ok(credentials) => {
                if enqueue_wifi_provisioning(WifiProvisioningCommand::Store(credentials)).is_ok() {
                    if wait_wifi_provisioning_result().await {
                        let _ = write!(
                            body,
                            "{{\"id\":{},\"ok\":true,\"result\":{{\"accepted\":true,\"reboot_required\":false}}}}",
                            id.as_str()
                        );
                    } else {
                        write_jsonl_error(
                            &mut body,
                            id.as_str(),
                            "provisioning_failed",
                            "wifi credentials could not be saved to EEPROM U21",
                            true,
                        );
                    }
                } else {
                    write_jsonl_error(
                        &mut body,
                        id.as_str(),
                        "busy",
                        "wifi provisioning command is already pending",
                        true,
                    );
                }
            }
            Err(_) => write_jsonl_error(
                &mut body,
                id.as_str(),
                "bad_request",
                "ssid or psk length is invalid",
                false,
            ),
        }
        return body;
    }

    if request.contains("\"method\":\"wifi.clear\"")
        || request.contains("\"method\": \"wifi.clear\"")
    {
        if enqueue_wifi_provisioning(WifiProvisioningCommand::Clear).is_ok() {
            if wait_wifi_provisioning_result().await {
                let _ = write!(
                    body,
                    "{{\"id\":{},\"ok\":true,\"result\":{{\"accepted\":true,\"reboot_required\":false}}}}",
                    id.as_str()
                );
            } else {
                write_jsonl_error(
                    &mut body,
                    id.as_str(),
                    "provisioning_failed",
                    "wifi credentials could not be cleared from EEPROM U21",
                    true,
                );
            }
        } else {
            write_jsonl_error(
                &mut body,
                id.as_str(),
                "busy",
                "wifi provisioning command is already pending",
                true,
            );
        }
        return body;
    }

    if request.contains("\"method\":\"reboot\"") || request.contains("\"method\": \"reboot\"") {
        REBOOT_PENDING.store(true, Ordering::Release);
        let _ = write!(
            body,
            "{{\"id\":{},\"ok\":true,\"result\":{{\"accepted\":true}}}}",
            id.as_str()
        );
        return body;
    }

    write_jsonl_error(
        &mut body,
        id.as_str(),
        "unknown_method",
        "unknown method",
        false,
    );
    body
}

#[cfg(feature = "net_http")]
fn enqueue_wifi_provisioning(command: WifiProvisioningCommand) -> Result<(), ()> {
    critical_section::with(|cs| {
        let mut slot = WIFI_PROVISIONING_PENDING.borrow_ref_mut(cs);
        if slot.is_some() {
            return Err(());
        }
        *slot = Some(command);
        Ok(())
    })
}

#[cfg(feature = "net_http")]
async fn wait_wifi_provisioning_result() -> bool {
    WIFI_PROVISIONING_RESULT.wait().await
}

#[cfg(feature = "net_http")]
fn take_wifi_provisioning() -> Option<WifiProvisioningCommand> {
    critical_section::with(|cs| WIFI_PROVISIONING_PENDING.borrow_ref_mut(cs).take())
}

#[cfg(feature = "net_http")]
fn has_wifi_provisioning_pending() -> bool {
    critical_section::with(|cs| WIFI_PROVISIONING_PENDING.borrow_ref(cs).is_some())
}

#[cfg(feature = "net_http")]
fn set_wifi_credentials_cache(credentials: Option<provisioning::WifiCredentials>) {
    critical_section::with(|cs| {
        *WIFI_CREDENTIALS_CACHE.borrow_ref_mut(cs) = credentials;
    });
}

#[cfg(feature = "net_http")]
pub(crate) fn wifi_credentials_cache() -> Option<provisioning::WifiCredentials> {
    critical_section::with(|cs| *WIFI_CREDENTIALS_CACHE.borrow_ref(cs))
}

#[cfg(feature = "net_http")]
pub(crate) async fn wait_usb_c_route_result() -> bool {
    USB_C_ROUTE_RESULT.wait().await
}

#[cfg(feature = "net_http")]
pub(crate) fn reset_usb_c_route_result() {
    USB_C_ROUTE_RESULT.reset();
}

#[cfg(feature = "net_http")]
fn extract_json_string(request: &str, key: &str) -> Option<alloc::string::String> {
    let rest = json_value_after_key(request, key)?;
    parse_json_string_value(rest).map(|(value, _)| value)
}

#[cfg(feature = "net_http")]
fn extract_json_bool(request: &str, key: &str) -> Option<bool> {
    let rest = json_value_after_key(request, key)?;
    if rest.starts_with("true") {
        Some(true)
    } else if rest.starts_with("false") {
        Some(false)
    } else {
        None
    }
}

#[cfg(feature = "net_http")]
fn json_value_after_key<'a>(request: &'a str, key: &str) -> Option<&'a str> {
    let needle = {
        let mut s = alloc::string::String::new();
        let _ = write!(s, "\"{}\"", key);
        s
    };
    let start = request.find(needle.as_str())?;
    let colon = request[start..].find(':')?;
    Some(request[start + colon + 1..].trim_start())
}

#[cfg(feature = "net_http")]
fn parse_json_string_value(rest: &str) -> Option<(alloc::string::String, usize)> {
    let mut chars = rest.char_indices();
    let (_, first) = chars.next()?;
    if first != '"' {
        return None;
    }

    let mut out = alloc::string::String::new();
    while let Some((idx, ch)) = chars.next() {
        match ch {
            '"' => return Some((out, idx + ch.len_utf8())),
            '\\' => {
                let (_, escaped) = chars.next()?;
                match escaped {
                    '"' | '\\' | '/' => {
                        let _ = out.push(escaped);
                    }
                    'b' => {
                        let _ = out.push('\u{0008}');
                    }
                    'f' => {
                        let _ = out.push('\u{000c}');
                    }
                    'n' => {
                        let _ = out.push('\n');
                    }
                    'r' => {
                        let _ = out.push('\r');
                    }
                    't' => {
                        let _ = out.push('\t');
                    }
                    'u' => {
                        let mut code = 0u32;
                        for _ in 0..4 {
                            let (_, hex) = chars.next()?;
                            code = (code << 4) | hex.to_digit(16)?;
                        }
                        let decoded = char::from_u32(code)?;
                        let _ = out.push(decoded);
                    }
                    _ => return None,
                }
            }
            _ => {
                let _ = out.push(ch);
            }
        }
    }
    None
}

#[cfg(feature = "net_http")]
fn write_usb_port_json(
    body: &mut alloc::string::String,
    id: &str,
    label: &str,
    port: &net::ApiPortSnapshot,
) {
    let _ = write!(
        body,
        "{{\"portId\":\"{}\",\"label\":\"{}\",\"telemetry\":{{\"status\":\"{}\",\"voltage_mv\":",
        id,
        label,
        port.telemetry.status.as_str()
    );
    write_usb_u32_or_null(body, port.telemetry.voltage_mv);
    let _ = body.push_str(",\"current_ma\":");
    write_usb_u32_or_null(body, port.telemetry.current_ma);
    let _ = body.push_str(",\"power_mw\":");
    write_usb_u32_or_null(body, port.telemetry.power_mw);
    let _ = write!(
        body,
        ",\"sample_uptime_ms\":{}}},\"state\":{{\"power_enabled\":{},\"data_connected\":{},\"replugging\":{},\"busy\":{}}}}}",
        port.telemetry.sample_uptime_ms,
        port.state.power_enabled,
        port.state.data_connected,
        port.state.replugging,
        port.state.busy
    );
}

#[cfg(feature = "net_http")]
fn write_usb_u32_or_null(body: &mut alloc::string::String, value: Option<u32>) {
    match value {
        Some(value) => {
            let _ = write!(body, "{}", value);
        }
        None => {
            let _ = body.push_str("null");
        }
    }
}

#[cfg(feature = "net_http")]
fn write_usb_info_json(
    body: &mut alloc::string::String,
    id: &str,
    device_names: Option<&net::DeviceNames>,
    wifi: Option<net::WifiState>,
) {
    let _ = write!(
        body,
        "{{\"id\":{},\"ok\":true,\"result\":{{\"device\":{{",
        id
    );

    if let Some(names) = device_names {
        let mac = format_usb_mac_lower(names.mac);
        let _ = write!(body, "\"device_id\":");
        write_json_string(body, names.short_id.as_str());
        let _ = write!(body, ",\"hostname\":");
        write_json_string(body, names.hostname.as_str());
        let _ = write!(body, ",\"fqdn\":");
        write_json_string(body, names.hostname_fqdn.as_str());
        let _ = write!(body, ",\"mac\":");
        write_json_string(body, mac.as_str());
        let _ = body.push(',');
    }

    let _ = write!(
        body,
        "\"variant\":\"tps-sw\",\"firmware\":{{\"name\":\"{}\",\"version\":\"{}\"}},\"uptime_ms\":{},",
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
        firmware_uptime_ms()
    );
    write_usb_wifi_object(body, wifi);
    let _ = body.push_str("}}}");
}

#[cfg(feature = "net_http")]
fn format_usb_mac_lower(mac: [u8; 6]) -> heapless::String<17> {
    let mut out = heapless::String::<17>::new();
    let _ = write!(
        out,
        "{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]
    );
    out
}

#[cfg(feature = "net_http")]
fn firmware_uptime_ms() -> u64 {
    let now_us = Instant::now().duration_since_epoch().as_micros();
    (now_us / 1_000) as u64
}

#[cfg(feature = "net_http")]
fn usb_wifi_state_str(state: net::WifiConnectionState) -> &'static str {
    match state {
        net::WifiConnectionState::Idle => "idle",
        net::WifiConnectionState::Connecting => "connecting",
        net::WifiConnectionState::Connected => "connected",
        net::WifiConnectionState::Error => "error",
    }
}

#[cfg(feature = "net_http")]
fn write_usb_ipv4_json(body: &mut alloc::string::String, ip: Option<embassy_net::Ipv4Address>) {
    match ip {
        Some(ip) => {
            let octets = ip.octets();
            let _ = write!(
                body,
                "\"{}.{}.{}.{}\"",
                octets[0], octets[1], octets[2], octets[3]
            );
        }
        None => {
            let _ = body.push_str("null");
        }
    }
}

#[cfg(feature = "net_http")]
fn write_usb_wifi_object(body: &mut alloc::string::String, wifi: Option<net::WifiState>) {
    let state = wifi
        .map(|wifi| usb_wifi_state_str(wifi.state))
        .unwrap_or("idle");
    let _ = write!(body, "\"wifi\":{{\"state\":\"{}\",\"ipv4\":", state);
    write_usb_ipv4_json(body, wifi.and_then(|wifi| wifi.ipv4));
    let _ = write!(
        body,
        ",\"is_static\":{}}}",
        wifi.map(|wifi| wifi.is_static).unwrap_or(false)
    );
}

#[cfg(feature = "net_http")]
fn write_usb_wifi_runtime_fields(body: &mut alloc::string::String, wifi: Option<net::WifiState>) {
    let state = wifi
        .map(|wifi| usb_wifi_state_str(wifi.state))
        .unwrap_or("idle");
    let _ = write!(body, ",\"state\":\"{}\",\"ipv4\":", state);
    write_usb_ipv4_json(body, wifi.and_then(|wifi| wifi.ipv4));
    let _ = write!(
        body,
        ",\"is_static\":{}",
        wifi.map(|wifi| wifi.is_static).unwrap_or(false)
    );
}

#[cfg(feature = "net_http")]
fn write_json_string(body: &mut alloc::string::String, value: &str) {
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
                let _ = write!(body, "\\u{:04x}", ch as u32);
            }
            ch => {
                let _ = body.push(ch);
            }
        }
    }
    let _ = body.push('"');
}

#[cfg(feature = "net_http")]
fn write_jsonl_error(
    body: &mut alloc::string::String,
    id: &str,
    code: &str,
    message: &str,
    retryable: bool,
) {
    let _ = write!(
        body,
        "{{\"id\":{},\"ok\":false,\"error\":{{\"code\":\"{}\",\"message\":\"{}\",\"retryable\":{}}}}}",
        id, code, message, retryable
    );
}

#[cfg(feature = "net_http")]
fn parse_jsonl_id(request: &str) -> alloc::string::String {
    let Some(rest) = json_value_after_key(request, "id") else {
        return alloc::string::String::from("null");
    };
    if rest.starts_with('"') {
        return copy_json_string_token(rest).unwrap_or_else(|| alloc::string::String::from("null"));
    }

    let mut out = alloc::string::String::new();
    for ch in rest.chars() {
        if ch.is_ascii_digit() || (out.is_empty() && ch == '-') {
            let _ = out.push(ch);
        } else {
            break;
        }
    }
    if out.is_empty() || out == "-" {
        alloc::string::String::from("null")
    } else {
        out
    }
}

#[cfg(feature = "net_http")]
fn copy_json_string_token(rest: &str) -> Option<alloc::string::String> {
    let mut out = alloc::string::String::new();
    let mut escaped = false;
    for ch in rest.chars() {
        let _ = out.push(ch);
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '"' if out.len() > 1 => return Some(out),
            '"' => {}
            _ => {}
        }
    }
    None
}

#[handler]
#[ram]
fn gpio_interrupt_handler() {
    critical_section::with(|cs| {
        let mut pin = TPS_INT.borrow_ref_mut(cs);
        if let Some(pin) = pin.as_mut() {
            if pin.is_interrupt_set() {
                TPS_INT_DIRTY.store(true, Ordering::Release);
                pin.clear_interrupt();
            }
        }
    });
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ButtonId {
    Left,  // USB-A
    Right, // USB-C
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ButtonEdge {
    Pressed,
    Released,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PressClass {
    Short,
    Long,
    Invalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PowerState {
    On,
    Off,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DataState {
    Connected,
    Disconnected,
    Pulsing { until: Instant },
}

#[derive(Clone, Copy, Debug)]
struct PortState {
    power: PowerState,
    data: DataState,
    busy_until: Option<Instant>,
}

impl PortState {
    const fn new(power: PowerState) -> Self {
        let data = match power {
            PowerState::On => DataState::Connected,
            PowerState::Off => DataState::Disconnected,
        };
        Self {
            power,
            data,
            busy_until: None,
        }
    }

    fn is_busy(&self, now: Instant) -> bool {
        self.busy_until.is_some_and(|until| now < until)
            || matches!(self.data, DataState::Pulsing { .. })
    }
}

const DATA_DISCONNECT_MS: u64 = 250;
const TOAST_MS: u64 = 1500;
const POWER_SWITCH_GUARD_MS: u64 = 350;
#[cfg(feature = "net_http")]
const USB_C_ROUTE_SETTLE_MS: u64 = 30;
#[cfg(feature = "net_http")]
const LEDD_SAMPLE_MS: u64 = 1_000;
#[cfg(feature = "net_http")]
const UP0_PG_SAMPLE_MS: u64 = 1_000;

const PRESS_SHORT_MIN: Duration = Duration::from_millis(100);
const PRESS_SHORT_MAX: Duration = Duration::from_millis(500);
const PRESS_LONG_MIN: Duration = Duration::from_millis(1000);
const PRESS_LONG_MAX: Duration = Duration::from_millis(5000);
const SETTINGS_MENU_MS: u64 = 5_000;
const SW2303_POR_RELEASE_MS: u64 = 100;
const PD_I2C_KHZ: u32 = 400;
const PD_I2C_TIMEOUT_MS: u64 = 10;
const SW2303_POLL_MS: u64 = 20;
const SW2303_ERROR_RETRY_MS: u64 = 100;
const SW2303_READ_RETRIES: u8 = 20;
const SW2303_READ_RETRY_DELAY_MS: u64 = 5;
const SW2303_STABLE_READS_BEFORE_TPS: u16 = 1;
const SW2303_STABLE_READS_BEFORE_TPS_STATUS: u16 = 500;
const SW2303_STABLE_READS_BEFORE_PROFILE: u16 = 50;
const PD_RUNTIME_RECOVERY_ERROR_LIMIT: u8 = 3;
const PD_RUNTIME_RECOVERY_MIN_INTERVAL_MS: u64 = 1_000;
const PD_RUNTIME_RECOVERY_TPS_RETRIES: u8 = 4;
const BOOT_PD_DISCHARGE_SETTLE_MS: u64 = 50;
const BOOT_PD_RELEASE_SETTLE_MS: u64 = 10;
const BOOT_CE_RECOVERY_HOLD_MS: u64 = 5;
const BOOT_CE_RECOVERY_POLL_MS: u64 = 5;
const BOOT_CE_RELEASE_SETTLE_MS: u64 = 10;
const BOOT_TPS_RETRY_DELAY_MS: u64 = 10;
const TPS55288_MODE_REG: u8 = 0x06;

// Toast colors (RGB565 raw).
const TOAST_OK_RAW: u16 = 0x1407; // dark green (same as UI OK power)
const TOAST_INFO_RAW: u16 = 0x1A7B; // blue for white-background info toasts
const TOAST_WARN_RAW: u16 = 0xC201; // dark orange warning
const TOAST_ERR_RAW: u16 = 0x98C3; // dark red error

const TOAST_USB_A_DATA_OFF: [[u8; 13]; 3] =
    [*b"USB-A DATAOFF", *b"250MS        ", *b"             "];
const TOAST_USB_A_DATA_ON: [[u8; 13]; 3] =
    [*b"USB-A DATAON ", *b"DONE         ", *b"             "];
const TOAST_USB_A_PWR_OFF: [[u8; 13]; 3] =
    [*b"USB-A PWROFF ", *b"DONE         ", *b"             "];
const TOAST_USB_A_PWR_ON: [[u8; 13]; 3] = [*b"USB-A PWRON  ", *b"DONE         ", *b"             "];
const TOAST_USB_A_BUSY: [[u8; 13]; 3] = [*b"USB-A BUSY   ", *b"REJECT       ", *b"             "];
const TOAST_USB_A_BADTIME: [[u8; 13]; 3] =
    [*b"USB-A BADTIME", *b"REJECT       ", *b"             "];

const TOAST_USB_C_DATA_OFF: [[u8; 13]; 3] =
    [*b"USB-C DATAOFF", *b"250MS        ", *b"             "];
const TOAST_USB_C_DATA_ON: [[u8; 13]; 3] =
    [*b"USB-C DATAON ", *b"DONE         ", *b"             "];
const TOAST_USB_C_PWR_OFF: [[u8; 13]; 3] =
    [*b"USB-C PWROFF ", *b"DONE         ", *b"             "];
const TOAST_USB_C_PWR_ON: [[u8; 13]; 3] = [*b"USB-C PWRON  ", *b"DONE         ", *b"             "];
const TOAST_USB_C_BUSY: [[u8; 13]; 3] = [*b"USB-C BUSY   ", *b"REJECT       ", *b"             "];
const TOAST_USB_C_BADTIME: [[u8; 13]; 3] =
    [*b"USB-C BADTIME", *b"REJECT       ", *b"             "];
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SettingsMenuItem {
    Mode,
    Wifi,
    About,
}

#[cfg(feature = "net_http")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SettingsMenuView {
    Main,
    ModeDetail,
}

impl SettingsMenuItem {
    fn prev(self) -> Self {
        match self {
            Self::Mode => Self::About,
            Self::Wifi => Self::Mode,
            Self::About => Self::Wifi,
        }
    }

    fn next(self) -> Self {
        match self {
            Self::Mode => Self::Wifi,
            Self::Wifi => Self::About,
            Self::About => Self::Mode,
        }
    }

    fn index(self) -> usize {
        match self {
            Self::Mode => 0,
            Self::Wifi => 1,
            Self::About => 2,
        }
    }
}

#[cfg(feature = "net_http")]
fn copy_compact_line(line: &mut [u8; 20], text: &str) {
    for (dst, src) in line.iter_mut().zip(text.as_bytes().iter().copied()) {
        *dst = src;
    }
}

#[cfg(feature = "net_http")]
fn about_toast_lines() -> [[u8; 20]; 3] {
    let mut lines = [*b"                    "; 3];
    copy_compact_line(&mut lines[0], "ISOLAPURR USB HUB");
    copy_compact_line(&mut lines[1], env!("CARGO_PKG_VERSION"));
    copy_compact_line(&mut lines[2], BUILD_GIT_SHA);
    lines
}

#[cfg(feature = "net_http")]
fn route_mode_label(route: provisioning::UsbCDownstreamRoute) -> &'static str {
    match route {
        provisioning::UsbCDownstreamRoute::Mcu => "UPGRADE",
        provisioning::UsbCDownstreamRoute::UsbC => "NORMAL",
    }
}

#[cfg(feature = "net_http")]
fn route_transition_label(
    previous: provisioning::UsbCDownstreamRoute,
    next: provisioning::UsbCDownstreamRoute,
) -> &'static str {
    match (previous, next) {
        (provisioning::UsbCDownstreamRoute::UsbC, provisioning::UsbCDownstreamRoute::Mcu) => {
            "NORMAL TO UPGRADE"
        }
        (provisioning::UsbCDownstreamRoute::Mcu, provisioning::UsbCDownstreamRoute::UsbC) => {
            "UPGRADE TO NORMAL"
        }
        (_, next) => route_mode_label(next),
    }
}

#[cfg(feature = "net_http")]
fn route_detail_title(route: provisioning::UsbCDownstreamRoute) -> &'static str {
    match route {
        provisioning::UsbCDownstreamRoute::Mcu => "USB-C MODE",
        provisioning::UsbCDownstreamRoute::UsbC => "USB-C MODE",
    }
}

#[cfg(feature = "net_http")]
fn route_current_label(route: provisioning::UsbCDownstreamRoute) -> &'static str {
    match route {
        provisioning::UsbCDownstreamRoute::Mcu => "CURRENT: UPGRADE",
        provisioning::UsbCDownstreamRoute::UsbC => "CURRENT: NORMAL",
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ToastId {
    DataOff,
    DataOn,
    PwrOff,
    PwrOn,
    Busy,
    BadTime,
}

fn toast_spec(button: ButtonId, toast: ToastId) -> (&'static [[u8; 13]; 3], u16) {
    let fg_raw = match toast {
        ToastId::DataOff => TOAST_INFO_RAW,
        ToastId::DataOn => TOAST_OK_RAW,
        ToastId::PwrOff => TOAST_WARN_RAW,
        ToastId::PwrOn => TOAST_OK_RAW,
        ToastId::Busy | ToastId::BadTime => TOAST_ERR_RAW,
    };

    let lines = match (button, toast) {
        (ButtonId::Left, ToastId::DataOff) => &TOAST_USB_A_DATA_OFF,
        (ButtonId::Left, ToastId::DataOn) => &TOAST_USB_A_DATA_ON,
        (ButtonId::Left, ToastId::PwrOff) => &TOAST_USB_A_PWR_OFF,
        (ButtonId::Left, ToastId::PwrOn) => &TOAST_USB_A_PWR_ON,
        (ButtonId::Left, ToastId::Busy) => &TOAST_USB_A_BUSY,
        (ButtonId::Left, ToastId::BadTime) => &TOAST_USB_A_BADTIME,
        (ButtonId::Right, ToastId::DataOff) => &TOAST_USB_C_DATA_OFF,
        (ButtonId::Right, ToastId::DataOn) => &TOAST_USB_C_DATA_ON,
        (ButtonId::Right, ToastId::PwrOff) => &TOAST_USB_C_PWR_OFF,
        (ButtonId::Right, ToastId::PwrOn) => &TOAST_USB_C_PWR_ON,
        (ButtonId::Right, ToastId::Busy) => &TOAST_USB_C_BUSY,
        (ButtonId::Right, ToastId::BadTime) => &TOAST_USB_C_BADTIME,
    };

    (lines, fg_raw)
}

#[derive(Debug)]
struct DebouncedButton {
    stable_pressed: bool,
    candidate_pressed: bool,
    candidate_since: Option<Instant>,
}

impl DebouncedButton {
    fn new() -> Self {
        Self {
            stable_pressed: false,
            candidate_pressed: false,
            candidate_since: None,
        }
    }

    #[cfg(feature = "net_http")]
    fn is_pressed(&self) -> bool {
        self.stable_pressed
    }

    fn update(&mut self, now: Instant, is_pressed: bool, debounce: Duration) -> Option<ButtonEdge> {
        if is_pressed == self.stable_pressed {
            self.candidate_pressed = is_pressed;
            self.candidate_since = None;
            return None;
        }

        let Some(since) = self.candidate_since else {
            self.candidate_pressed = is_pressed;
            self.candidate_since = Some(now);
            return None;
        };

        if self.candidate_pressed != is_pressed {
            self.candidate_pressed = is_pressed;
            self.candidate_since = Some(now);
            return None;
        }

        if now - since < debounce {
            return None;
        }

        self.stable_pressed = is_pressed;
        self.candidate_since = None;

        Some(if is_pressed {
            ButtonEdge::Pressed
        } else {
            ButtonEdge::Released
        })
    }
}

fn classify_press(duration: Duration) -> PressClass {
    if duration < PRESS_SHORT_MIN {
        return PressClass::Invalid;
    }
    if duration <= PRESS_SHORT_MAX {
        return PressClass::Short;
    }
    if duration < PRESS_LONG_MIN {
        return PressClass::Invalid;
    }
    if duration <= PRESS_LONG_MAX {
        return PressClass::Long;
    }
    PressClass::Invalid
}

fn telemetry_field_to_ui(field: Field<u32>) -> NormalUiField {
    match field {
        Field::Ok(v) => NormalUiField::Ok(v.saturating_mul(1_000)),
        Field::Err => NormalUiField::Err,
    }
}

fn normal_ui_badge_mv(
    request: Option<PowerRequest>,
    fallback_voltage_mv: Field<u32>,
) -> Option<u16> {
    if let Some(request) = request {
        if request.v_req_mv >= 1_000 {
            return Some(request.v_req_mv);
        }
    }

    match fallback_voltage_mv {
        Field::Ok(voltage_mv) if voltage_mv >= 1_000 => {
            Some(voltage_mv.min(u16::MAX as u32) as u16)
        }
        _ => None,
    }
}

fn log_sw2303_profile_status(context: &'static str, status: &EnableProfileStatus) {
    let pps_max_mv = status
        .pd_capabilities
        .and_then(|pd_capabilities| pd_capabilities.max_pps_voltage_mv());
    let pps_above_11v = status
        .pd_capabilities
        .map(|pd_capabilities| pd_capabilities.supports_pps_above_11v());

    info!(
        "sw2303 profile: {} power_register_mode={} cap_w={}W protocols={:?} pd_caps={:?} fast={:?} type_c={:?} vin_mv={:?} vbus_mv={:?} sys0={:?} sys1={:?} sys2={:?} pps_max_mv={:?} pps_above_11v={:?}",
        context,
        status.power_config_register_mode,
        status.power_watts,
        defmt::Debug2Format(&status.protocols),
        defmt::Debug2Format(&status.pd_capabilities),
        defmt::Debug2Format(&status.fast_charge),
        defmt::Debug2Format(&status.type_c),
        defmt::Debug2Format(&status.vin_mv),
        defmt::Debug2Format(&status.vbus_mv),
        defmt::Debug2Format(&status.system_status0),
        defmt::Debug2Format(&status.system_status1),
        defmt::Debug2Format(&status.system_status2),
        defmt::Debug2Format(&pps_max_mv),
        defmt::Debug2Format(&pps_above_11v)
    );

    if let Some(pd_capabilities) = status.pd_capabilities {
        if pd_capabilities.pps_enabled && !pd_capabilities.supports_pps_above_11v() {
            defmt::warn!(
                "sw2303 pps diag: PPS is enabled but >11V ranges are absent; pps_mode={:?} pps_ranges={:?}",
                defmt::Debug2Format(&pd_capabilities.pps_config_mode),
                defmt::Debug2Format(&pd_capabilities.pps_ranges)
            );
        }
    } else {
        defmt::warn!(
            "sw2303 pps diag: PD/PPS capability readback unavailable after profile apply; keeping configuration success"
        );
    }
}

async fn bitbang_i2c_delay() {
    Timer::after_micros(5).await;
}

async fn bitbang_i2c_write_byte(sda: &mut Flex<'_>, scl: &mut Flex<'_>, byte: u8) -> bool {
    for bit in (0..8).rev() {
        if ((byte >> bit) & 1) == 0 {
            sda.set_low();
            sda.set_output_enable(true);
        } else {
            sda.set_high();
            sda.set_output_enable(false);
        }
        bitbang_i2c_delay().await;
        scl.set_high();
        scl.set_output_enable(false);
        bitbang_i2c_delay().await;
        scl.set_low();
        scl.set_output_enable(true);
        bitbang_i2c_delay().await;
    }

    sda.set_high();
    sda.set_output_enable(false);
    bitbang_i2c_delay().await;
    scl.set_high();
    scl.set_output_enable(false);
    bitbang_i2c_delay().await;
    let ack = sda.is_low();
    scl.set_low();
    scl.set_output_enable(true);
    bitbang_i2c_delay().await;
    ack
}

async fn bitbang_tps55288_mode_write(sda: &mut Flex<'_>, scl: &mut Flex<'_>, mode: u8) -> bool {
    sda.set_high();
    scl.set_high();
    sda.set_output_enable(false);
    scl.set_output_enable(false);
    bitbang_i2c_delay().await;

    sda.set_low();
    sda.set_output_enable(true);
    bitbang_i2c_delay().await;
    scl.set_low();
    scl.set_output_enable(true);
    bitbang_i2c_delay().await;

    let address_ack = bitbang_i2c_write_byte(sda, scl, TPS55288_ADDR_7BIT << 1).await;
    let register_ack = bitbang_i2c_write_byte(sda, scl, TPS55288_MODE_REG).await;
    let data_ack = bitbang_i2c_write_byte(sda, scl, mode).await;

    sda.set_low();
    sda.set_output_enable(true);
    bitbang_i2c_delay().await;
    scl.set_high();
    scl.set_output_enable(false);
    bitbang_i2c_delay().await;
    sda.set_high();
    sda.set_output_enable(false);
    bitbang_i2c_delay().await;

    address_ack && register_ack && data_ack
}

#[cfg(feature = "net_http")]
fn uptime_ms_from_instant(now: Instant) -> u64 {
    (now.duration_since_epoch().as_micros() / 1_000) as u64
}

fn elapsed_ms_since(start: Instant) -> u64 {
    (start.elapsed().as_micros() / 1_000) as u64
}

#[cfg(feature = "net_http")]
fn port_metrics_to_api_telemetry(
    present: bool,
    metrics: PortMetrics,
    sample_uptime_ms: u64,
) -> net::ApiPortTelemetry {
    if !present {
        return net::ApiPortTelemetry {
            status: net::ApiTelemetryStatus::NotInserted,
            voltage_mv: None,
            current_ma: None,
            power_mw: None,
            sample_uptime_ms,
        };
    }

    let (Field::Ok(voltage_mv), Field::Ok(current_ma), Field::Ok(power_mw)) =
        (metrics.voltage_mv, metrics.current_ma, metrics.power_mw)
    else {
        return net::ApiPortTelemetry {
            status: net::ApiTelemetryStatus::Error,
            voltage_mv: None,
            current_ma: None,
            power_mw: None,
            sample_uptime_ms,
        };
    };

    // Keep the v1 "overrange" semantics aligned with Spec #j9twf's `>= 1000.0` threshold:
    // `1000.0 V/A/W` == `1_000_000 mV/mA/mW`.
    if voltage_mv >= 1_000_000 || current_ma >= 1_000_000 || power_mw >= 1_000_000 {
        return net::ApiPortTelemetry {
            status: net::ApiTelemetryStatus::Overrange,
            voltage_mv: None,
            current_ma: None,
            power_mw: None,
            sample_uptime_ms,
        };
    }

    net::ApiPortTelemetry {
        status: net::ApiTelemetryStatus::Ok,
        voltage_mv: Some(voltage_mv),
        current_ma: Some(current_ma),
        power_mw: Some(power_mw),
        sample_uptime_ms,
    }
}

#[esp_rtos::main]
async fn main(_spawner: Spawner) {
    let config = esp_hal::Config::default()
        .with_cpu_clock(CpuClock::max())
        .with_psram(esp_hal::psram::PsramConfig::default());
    let peripherals = esp_hal::init(config);

    // Internal heap for firmware/runtime allocations; display framebuffers are explicitly placed
    // in PSRAM via `esp_alloc::ExternalMemory`.
    esp_alloc::heap_allocator!(#[esp_hal::ram(reclaimed)] size: 64 * 1024);
    esp_alloc::psram_allocator!(peripherals.PSRAM, esp_hal::psram);

    // Initialize the preemptive scheduler used by esp-radio (+ embassy integrations).
    let timg0 = TimerGroup::new(peripherals.TIMG0);
    esp_rtos::start(timg0.timer0);

    info!("boot: isolapurr-usb-hub starting (pd i2c coordinator)");
    info!(
        "firmware: version={} profile={} git={} ref={} dirty={} dashboard_bg_rgb=({},{},{})",
        env!("CARGO_PKG_VERSION"),
        BUILD_PROFILE,
        BUILD_GIT_SHA,
        BUILD_GIT_REF,
        BUILD_GIT_DIRTY,
        DASHBOARD_BG_RGB8.0,
        DASHBOARD_BG_RGB8.1,
        DASHBOARD_BG_RGB8.2
    );

    // Optional HTTP API state is shared by Wi-Fi and USB/native transports.
    #[cfg(feature = "net_http")]
    let api_state = net::init_http_api_state();

    let buzzer = LedcBuzzer::new(peripherals.LEDC, peripherals.GPIO21).expect("buzzer LEDC init");
    let mut prompt_tone = PromptToneManager::new(buzzer);
    info!(
        "buzzer: prompt_tone default freq={}Hz duty={}%",
        DEFAULT_FREQ_HZ, DEFAULT_DUTY_PCT
    );

    // Physical buttons:
    // - BTNR = GPIO0 (active-low, requires internal pull-up)
    // - BTNL = GPIO1 (active-low, requires internal pull-up)
    let btn_cfg = InputConfig::default().with_pull(Pull::Up);
    let btn_left = Input::new(peripherals.GPIO1, btn_cfg);
    let btn_right = Input::new(peripherals.GPIO0, btn_cfg);
    let mut btn_left_state = DebouncedButton::new();
    let mut btn_right_state = DebouncedButton::new();
    let btn_debounce = Duration::from_millis(30);
    let mut btn_raw_left_pressed = btn_left.is_low();
    let mut btn_raw_right_pressed = btn_right.is_low();
    info!(
        "buttons: initial raw left_pressed={} right_pressed={}",
        btn_raw_left_pressed, btn_raw_right_pressed
    );

    // Isolated-side USB indicators:
    // - HUSB305-01 STAT/UP0_PG → MCU GPIO18, external 100k pull-up, active-high fault indication.
    // - U2 pin13 LED/MODE = LEDD → MCU GPIO6, active-low isolated USB ready/link indicator.
    // Both signals are status inputs only; keep MCU pins hi-Z with no internal pulls.
    #[cfg(feature = "net_http")]
    let up0_pg_cfg = InputConfig::default().with_pull(Pull::None);
    #[cfg(feature = "net_http")]
    let up0_pg = Input::new(peripherals.GPIO18, up0_pg_cfg);
    #[cfg(feature = "net_http")]
    let mut api_isolated_usb_fault = up0_pg.is_high();
    #[cfg(feature = "net_http")]
    let mut up0_pg_last_sample = Instant::now();
    #[cfg(feature = "net_http")]
    info!(
        "isolated usb fault io1: GPIO18 initial raw_high={} (active-high, hi-z input; no pull)",
        up0_pg.is_high()
    );

    #[cfg(feature = "net_http")]
    let ledd_cfg = InputConfig::default().with_pull(Pull::None);
    #[cfg(feature = "net_http")]
    let isolated_usb_ready = Input::new(peripherals.GPIO6, ledd_cfg);
    #[cfg(feature = "net_http")]
    let mut api_isolated_usb_ready = isolated_usb_ready.is_low();
    #[cfg(feature = "net_http")]
    let mut ledd_last_sample = Instant::now();
    #[cfg(feature = "net_http")]
    info!(
        "isolated usb ready ledd: GPIO6 initial raw_low={} (active-low, hi-z input; no pull)",
        isolated_usb_ready.is_low()
    );

    let mut btn_left_pressed_at: Option<Instant> = None;
    let mut btn_right_pressed_at: Option<Instant> = None;
    #[cfg(feature = "net_http")]
    let mut combo_active = false;
    #[cfg(not(feature = "net_http"))]
    let combo_active = false;
    #[cfg(feature = "net_http")]
    let mut combo_pressed_at: Option<Instant> = None;
    #[cfg(feature = "net_http")]
    let mut combo_done = false;
    #[cfg(feature = "net_http")]
    let mut combo_expired = false;
    let mut settings_menu_selected = SettingsMenuItem::Mode;
    #[cfg(feature = "net_http")]
    let mut settings_menu_view = SettingsMenuView::Main;
    let mut settings_menu_until: Option<Instant> = None;

    // Port controls (tps-sw netlist):
    // - P1_CED/P2_CED drive CH442E EN#: low=enable/connect, high=disable/disconnect.
    // - U8 IN is P1_ESP: low=MCU D+/D-, high=USB-C/TPS D+/D-.
    // - P1_EN# drives CH217K enable: low=enable (power on), high=disable (power off).
    // - CE_TPS drives Q9, pulling TPS EN/UVLO low when CE_TPS is high (power off).
    //
    // Keep data paths connected at boot, but hold TPS output off before the
    // SW2303 POR window is explicitly controlled below.
    let mut p2_ced = Output::new(peripherals.GPIO2, Level::Low, OutputConfig::default());
    let mut p1_ced = Output::new(peripherals.GPIO4, Level::Low, OutputConfig::default());
    #[allow(unused_mut, unused_variables)]
    let mut p1_esp = Output::new(peripherals.GPIO5, Level::High, OutputConfig::default());
    let mut p1_en_n = Output::new(peripherals.GPIO16, Level::Low, OutputConfig::default());
    let mut ce_tps = Output::new(peripherals.GPIO37, Level::High, OutputConfig::default());
    info!(
        "ports: boot state p1_en#=low(on) p1_ced=low(connect) p2_ced=low(connect) p1_esp=high(route=usb_c) ce_tps=high(off)"
    );

    let mut port_usb_a = PortState::new(PowerState::On);
    let mut port_usb_c = PortState::new(PowerState::On);

    // TPS55288 FB/INT fault indication (tps-sw netlist):
    // - shared INT = GPIO7
    // - active-low, external 4.7k pull-up to 3V3
    // - keep hi-Z (no internal pull)
    let mut io = Io::new(peripherals.IO_MUX);
    io.set_interrupt_handler(gpio_interrupt_handler);
    let tps_int_cfg = InputConfig::default().with_pull(Pull::None);
    let mut tps_int = Input::new(peripherals.GPIO7, tps_int_cfg);
    let mut last_tps_int_low = tps_int.is_low();
    info!(
        "tps int: GPIO7 initial raw_low={} (active-low, hi-z input; no pull)",
        last_tps_int_low
    );
    critical_section::with(|cs| {
        tps_int.listen(Event::AnyEdge);
        TPS_INT.borrow_ref_mut(cs).replace(tps_int);
    });
    if last_tps_int_low {
        TPS_INT_DIRTY.store(true, Ordering::Release);
    }

    let tps_i2c = I2c::new(
        peripherals.I2C1,
        I2cConfig::default()
            .with_frequency(Rate::from_khz(400))
            .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(20))),
    )
    .unwrap()
    .with_sda(peripherals.GPIO8)
    .with_scl(peripherals.GPIO9)
    .into_async();
    let mut telemetry_i2c = TelemetryI2cAllowlist::new(tps_i2c);
    info!(
        "tps i2c: I2C1@400kHz async SDA=GPIO8 SCL=GPIO9 allowlist=[0x40/0x44,0x41/0x45,0x50,0x74]"
    );

    let sw2303_i2c = I2c::new(
        peripherals.I2C0,
        I2cConfig::default()
            .with_frequency(Rate::from_khz(PD_I2C_KHZ))
            .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(
                PD_I2C_TIMEOUT_MS,
            ))),
    )
    .unwrap()
    .with_sda(peripherals.GPIO39)
    .with_scl(peripherals.GPIO40)
    .into_async();
    let mut sw2303_i2c = I2cAllowlist::new(sw2303_i2c);
    info!(
        "sw2303 i2c: I2C0@{}kHz async SDA=GPIO39 SCL=GPIO40 allowlist=[0x3C]",
        PD_I2C_KHZ
    );
    let sw2303_i2c_release_input_cfg = InputConfig::default().with_pull(Pull::Up);
    let sw2303_i2c_release_output_cfg = OutputConfig::default()
        .with_drive_mode(DriveMode::OpenDrain)
        .with_pull(Pull::Up);

    let mut tps_state = TpsApplyState::new();
    let mut last_request: Option<PowerRequest> = None;
    let mut last_valid_sw2303_request: Option<PowerRequest> = None;
    let mut last_fast_protocol: Option<bool> = None;

    let mut sw2303_error_latched = false;
    let mut tps_error_latched = false;
    let mut ui_error_latched = false;
    let mut sw2303_profile_applied = false;
    let mut last_sw2303_profile_attempt: Option<Instant> = None;
    let mut last_sw2303_read_attempt: Option<Instant> = None;
    let mut sw2303_stable_reads: u16 = 0;
    let mut sw2303_consecutive_errors: u8 = 0;
    let mut tps_consecutive_errors: u8 = 0;
    let mut last_pd_runtime_recovery: Option<Instant> = None;
    let mut pd_runtime_recovery_count: u32 = 0;
    let mut tps_5v_setpoint_since: Option<Instant> = None;
    let mut last_tps_status: Option<(
        tps55288::data_types::OperatingStatus,
        tps55288::data_types::FaultStatus,
    )> = None;
    let mut button_fast_loop_until: Option<Instant> = None;

    let pd_boot_started = Instant::now();
    let mut boot_recovery_cycled = false;
    let boot_sp = boot_supply_setpoint();
    // CE_TPS has held TPS/SW2303 off since GPIO init. Release TPS only after
    // SDA/SCL have been held high, then program TPS; SW2303 POR starts after
    // the final TPS OE write completes.
    let _ = ce_tps.set_low();
    Timer::after_millis(BOOT_CE_RELEASE_SETTLE_MS).await;
    match stop_output_and_enable_discharge(&mut telemetry_i2c).await {
        Ok(()) => {
            info!("tps55288 boot discharge: OE off and active discharge enabled");
        }
        Err(err) => {
            defmt::warn!(
                "tps55288 boot discharge failed; continuing with boot setpoint: {:?}",
                defmt::Debug2Format(&err)
            );
            tps_state.last = None;
        }
    }
    Timer::after_millis(BOOT_PD_DISCHARGE_SETTLE_MS).await;

    let mut tps_boot_ready = false;
    let mut sw2303_i2c_allowed = false;
    let mut boot_retry_recovery_cycled = false;
    for attempt in 1..=4 {
        match apply_setpoint(&mut telemetry_i2c, &mut tps_state, boot_sp).await {
            Ok(()) => {
                tps_error_latched = false;
                tps_boot_ready = true;
                tps_5v_setpoint_since = Some(Instant::now());
                info!(
                    "tps55288 boot supply applied (attempt {}/4): v={}mV ilim={}mA elapsed_ms={}",
                    attempt,
                    boot_sp.v_out_mv,
                    boot_sp.i_lim_ma,
                    elapsed_ms_since(pd_boot_started)
                );
                info!(
                    "sw2303 power gate: holding SW2303 POR for {}ms after TPS boot setpoint",
                    SW2303_POR_RELEASE_MS
                );
                Timer::after_millis(SW2303_POR_RELEASE_MS).await;
                sw2303_i2c_allowed = true;
                info!(
                    "sw2303 power gate: SW2303 POR delay elapsed elapsed_ms={}",
                    elapsed_ms_since(pd_boot_started)
                );
                break;
            }
            Err(err) => {
                if attempt == 4 {
                    defmt::warn!(
                        "tps55288 boot supply apply failed (attempt {}/4): {:?}",
                        attempt,
                        defmt::Debug2Format(&err)
                    );
                } else {
                    if !boot_retry_recovery_cycled {
                        defmt::warn!(
                            "tps55288 boot I2C failed; hard-cycling CE_TPS before retry: {:?}",
                            defmt::Debug2Format(&err)
                        );
                        let _ = ce_tps.set_high();
                        Timer::after_millis(BOOT_CE_RECOVERY_HOLD_MS).await;
                        let _ = ce_tps.set_low();
                        boot_retry_recovery_cycled = true;
                        boot_recovery_cycled = true;
                    } else {
                        info!(
                            "tps55288 boot supply retrying after transient I2C error (attempt {}/4): {:?}",
                            attempt,
                            defmt::Debug2Format(&err)
                        );
                    }
                    tps_state.last = None;
                    tps_error_latched = true;
                    if attempt < 4 {
                        Timer::after_millis(BOOT_TPS_RETRY_DELAY_MS).await;
                    }
                }
            }
        }
    }
    if !tps_boot_ready {
        defmt::warn!("tps55288 boot supply not ready; skipping boot-time SW2303 profile");
        prompt_tone.notify(SoundEvent::EnterSafety(SafetyKind::TpsApply));
    }

    if tps_boot_ready {
        info!("sw2303 profile: deferred until first successful SW2303 read");
    }

    #[allow(unused_mut)]
    let mut telemetry_i2c = telemetry_i2c;
    #[cfg(feature = "net_http")]
    let wifi_credentials = match provisioning::load_wifi_credentials(&mut telemetry_i2c).await {
        Ok(value) => {
            set_wifi_credentials_cache(value);
            if value.is_some() {
                info!("provisioning: Wi-Fi credentials loaded from EEPROM U21");
            } else {
                info!("provisioning: Wi-Fi EEPROM U21 has no configured credentials");
            }
            value
        }
        Err(err) => {
            defmt::warn!(
                "provisioning: failed to load Wi-Fi credentials from EEPROM U21: {:?}",
                defmt::Debug2Format(&err)
            );
            None
        }
    };
    #[cfg(feature = "net_http")]
    let (mut usb_c_downstream_route, mut usb_c_downstream_persisted) =
        match provisioning::load_usb_c_downstream_route(&mut telemetry_i2c).await {
            Ok(Some(route)) => {
                info!(
                    "provisioning: USB-C downstream route loaded from EEPROM U21 route={}",
                    route.as_str()
                );
                (route, true)
            }
            Ok(None) => {
                info!(
                    "provisioning: USB-C downstream route EEPROM record empty; defaulting to mcu"
                );
                (provisioning::DEFAULT_USB_C_DOWNSTREAM_ROUTE, false)
            }
            Err(err) => {
                defmt::warn!(
                    "provisioning: failed to load USB-C downstream route from EEPROM U21: {:?}; defaulting to mcu",
                    defmt::Debug2Format(&err)
                );
                (provisioning::DEFAULT_USB_C_DOWNSTREAM_ROUTE, false)
            }
        };
    #[cfg(feature = "net_http")]
    match usb_c_downstream_route {
        provisioning::UsbCDownstreamRoute::Mcu => {
            let _ = p2_ced.set_high();
            let _ = p1_esp.set_low();
            Timer::after_millis(USB_C_ROUTE_SETTLE_MS).await;
            let _ = p2_ced.set_low();
        }
        provisioning::UsbCDownstreamRoute::UsbC => {
            let _ = p2_ced.set_high();
            let _ = p1_esp.set_high();
            Timer::after_millis(USB_C_ROUTE_SETTLE_MS).await;
            let _ = p2_ced.set_low();
        }
    }
    #[cfg(feature = "net_http")]
    let net_handles =
        net::spawn_wifi_mdns_http(&_spawner, peripherals.WIFI, api_state, wifi_credentials);
    #[cfg(feature = "net_http")]
    {
        let usb_serial = UsbSerialJtag::new(peripherals.USB_DEVICE).into_async();
        let device_names = net_handles.as_ref().map(|handles| handles.device_names);
        let wifi_state = net_handles.as_ref().map(|handles| handles.wifi_state);
        if _spawner
            .spawn(usb_console_task(
                usb_serial,
                api_state,
                device_names,
                wifi_state,
            ))
            .is_err()
        {
            defmt::warn!("usb console: failed to spawn USB Serial/JTAG JSONL task");
        } else {
            info!("usb console: USB Serial/JTAG JSONL task started");
        }
    }

    let mut telemetry_sampler = NormalUiTelemetrySampler::new_with_allowlist(telemetry_i2c);
    match telemetry_sampler.init().await {
        Ok(()) => {
            info!(
                "telemetry: INA226 init ok usb_a_addr={:?} usb_c_addr={:?}",
                defmt::Debug2Format(&telemetry_sampler.usb_a_address()),
                defmt::Debug2Format(&telemetry_sampler.usb_c_address())
            );
        }
        Err(err) => {
            defmt::warn!(
                "telemetry: INA226 init error (PD loop continues; fields may show ERR): {:?}; usb_a_addr={:?} usb_c_addr={:?}",
                defmt::Debug2Format(&err),
                defmt::Debug2Format(&telemetry_sampler.usb_a_address()),
                defmt::Debug2Format(&telemetry_sampler.usb_c_address())
            );
            prompt_tone.notify(SoundEvent::InitWarn(InitWarnReason::Ina226Init));
        }
    }

    // GC9307 display (landscape) + backlight control.
    // SPI: MOSI=GPIO11, SCLK=GPIO12. CS=GPIO13, DC=GPIO10, RES=GPIO14.
    // Backlight gate BLK=GPIO15 (active-low).
    let dc = Output::new(peripherals.GPIO10, Level::Low, OutputConfig::default());
    let rst = Output::new(peripherals.GPIO14, Level::High, OutputConfig::default());
    let cs = Output::new(peripherals.GPIO13, Level::High, OutputConfig::default());
    // Backlight gate BLK is active-low. Force it ON immediately so backlight is not
    // coupled to display init success.
    let blk = Output::new(peripherals.GPIO15, Level::Low, OutputConfig::default());

    let spi_bus = Spi::new(
        peripherals.SPI2,
        SpiConfig::default()
            .with_frequency(Rate::from_mhz(40))
            .with_mode(Mode::_0),
    )
    .unwrap()
    .with_sck(peripherals.GPIO12)
    .with_mosi(peripherals.GPIO11);

    let (rx_buffer, rx_descriptors, tx_buffer, tx_descriptors) = dma_buffers!(4096);
    let dma_rx_buf = DmaRxBuf::new(rx_descriptors, rx_buffer).unwrap();
    let dma_tx_buf = DmaTxBuf::new(tx_descriptors, tx_buffer).unwrap();
    let spi_bus = spi_bus
        .with_dma(peripherals.DMA_CH0)
        .with_buffers(dma_rx_buf, dma_tx_buf)
        .into_async();

    let spi = CsSpiDevice::new(spi_bus, cs);

    let workbuf = unsafe { &mut *core::ptr::addr_of_mut!(DISPLAY_WORKBUF) };
    let backlight = ActiveLowBacklight(blk);
    let mut ui: DisplayUi<'_, _, _, _, EspHalSpinTimer, _> =
        DisplayUi::new(spi, dc, rst, workbuf, backlight).expect("display ui psram framebuffers");
    info!(
        "display: GC9307 landscape SPI2@40MHz async DMA MOSI=GPIO11 SCLK=GPIO12 CS=GPIO13 DC=GPIO10 RES=GPIO14 BLK=GPIO15(active-low)"
    );
    info!(
        "pd boot summary: tps_ready={} path={} sw2303_i2c_allowed={} elapsed_ms={}",
        tps_boot_ready,
        if boot_retry_recovery_cycled {
            "ce_recovered_before_tps_and_retry"
        } else if boot_recovery_cycled {
            "ce_recovered_before_tps"
        } else {
            "direct"
        },
        sw2303_i2c_allowed,
        elapsed_ms_since(pd_boot_started)
    );

    if let Err(err) = ui.init().await {
        defmt::warn!(
            "display: init error (PD loop continues): {:?}",
            defmt::Debug2Format(&err)
        );
        prompt_tone.notify(SoundEvent::InitWarn(InitWarnReason::DisplayInit));
    } else if let Err(err) = ui.draw_frame().await {
        defmt::warn!(
            "display: draw_frame error (PD loop continues): {:?}",
            defmt::Debug2Format(&err)
        );
        prompt_tone.notify(SoundEvent::InitWarn(InitWarnReason::DisplayInit));
    }

    let mut last_tick = Instant::now();

    #[cfg(feature = "net_http")]
    let mut api_usb_a_present = false;
    #[cfg(feature = "net_http")]
    let mut api_usb_c_present = false;
    #[cfg(feature = "net_http")]
    let mut api_sample_uptime_ms: u64 = 0;
    #[cfg(feature = "net_http")]
    let mut api_usb_a_metrics = PortMetrics::err();
    #[cfg(feature = "net_http")]
    let mut api_usb_c_metrics = PortMetrics::err();

    prompt_tone.notify(SoundEvent::InitDone);
    {
        let now_us = esp_hal::time::Instant::now()
            .duration_since_epoch()
            .as_micros();
        let now = core::time::Duration::from_micros(now_us);
        prompt_tone.tick(now);
    }

    loop {
        let sw2303_was_in_error = sw2303_error_latched;
        let tps_was_in_error = tps_error_latched;
        let ui_was_in_error = ui_error_latched;

        #[cfg(feature = "net_http")]
        if let Some(command) = take_wifi_provisioning() {
            match command {
                WifiProvisioningCommand::Store(credentials) => {
                    match provisioning::store_wifi_credentials(
                        telemetry_sampler.i2c_mut(),
                        &credentials,
                    )
                    .await
                    {
                        Ok(()) => {
                            set_wifi_credentials_cache(Some(credentials));
                            net::request_wifi_runtime_apply();
                            WIFI_PROVISIONING_RESULT.signal(true);
                            info!("provisioning: Wi-Fi credentials saved to EEPROM U21")
                        }
                        Err(err) => {
                            WIFI_PROVISIONING_RESULT.signal(false);
                            defmt::warn!(
                                "provisioning: failed to save Wi-Fi credentials to EEPROM U21: {:?}",
                                defmt::Debug2Format(&err)
                            );
                        }
                    }
                }
                WifiProvisioningCommand::Clear => {
                    match provisioning::clear_wifi_credentials(telemetry_sampler.i2c_mut()).await {
                        Ok(()) => {
                            set_wifi_credentials_cache(None);
                            net::request_wifi_runtime_apply();
                            WIFI_PROVISIONING_RESULT.signal(true);
                            info!("provisioning: Wi-Fi credentials cleared from EEPROM U21")
                        }
                        Err(err) => {
                            WIFI_PROVISIONING_RESULT.signal(false);
                            defmt::warn!(
                                "provisioning: failed to clear Wi-Fi credentials from EEPROM U21: {:?}",
                                defmt::Debug2Format(&err)
                            );
                        }
                    }
                }
            }
        }
        #[cfg(feature = "net_http")]
        {
            let route_now = Instant::now();
            let mut pending_route = None;
            {
                let mut guard = api_state.lock().await;
                if guard.pending.usb_c_downstream_route.is_some() && !port_usb_c.is_busy(route_now)
                {
                    pending_route = guard.pending.usb_c_downstream_route.take();
                }
            }

            if let Some(route) = pending_route {
                let previous_route = usb_c_downstream_route;
                port_usb_c.busy_until =
                    Some(route_now + Duration::from_millis(USB_C_ROUTE_SETTLE_MS));
                let _ = p2_ced.set_high();
                match route {
                    provisioning::UsbCDownstreamRoute::Mcu => {
                        let _ = p1_esp.set_low();
                    }
                    provisioning::UsbCDownstreamRoute::UsbC => {
                        let _ = p1_esp.set_high();
                    }
                }
                Timer::after_millis(USB_C_ROUTE_SETTLE_MS).await;
                usb_c_downstream_route = route;
                usb_c_downstream_persisted = false;

                if matches!(port_usb_c.power, PowerState::On)
                    && matches!(port_usb_c.data, DataState::Connected)
                {
                    let _ = p2_ced.set_low();
                }

                match provisioning::store_usb_c_downstream_route(telemetry_sampler.i2c_mut(), route)
                    .await
                {
                    Ok(()) => {
                        usb_c_downstream_persisted = true;
                        let route_label =
                            route_transition_label(previous_route, usb_c_downstream_route);
                        let _ = ui
                            .show_message_card(
                                route_now,
                                "USB-C MODE",
                                route_label,
                                "EEPROM SAVED",
                                TOAST_OK_RAW,
                                Duration::from_millis(TOAST_MS),
                            )
                            .await;
                        prompt_tone.notify(SoundEvent::ActionOk);
                        USB_C_ROUTE_RESULT.signal(true);
                        info!(
                            "provisioning: USB-C downstream route saved to EEPROM U21 route={}",
                            route.as_str()
                        );
                    }
                    Err(err) => {
                        let _ = ui
                            .show_message_card(
                                route_now,
                                "USB-C MODE",
                                "EEPROM FAIL",
                                "NOT SAVED",
                                TOAST_ERR_RAW,
                                Duration::from_millis(TOAST_MS),
                            )
                            .await;
                        prompt_tone.notify(SoundEvent::ActionFail);
                        USB_C_ROUTE_RESULT.signal(false);
                        defmt::warn!(
                            "provisioning: failed to save USB-C downstream route to EEPROM U21: {:?}",
                            defmt::Debug2Format(&err)
                        );
                    }
                }
                button_fast_loop_until =
                    Some(Instant::now() + Duration::from_millis(POWER_SWITCH_GUARD_MS));
            }
        }
        #[cfg(feature = "net_http")]
        if REBOOT_PENDING.load(Ordering::Acquire) && !has_wifi_provisioning_pending() {
            REBOOT_PENDING.store(false, Ordering::Release);
            Timer::after_millis(100).await;
            esp_hal::system::software_reset();
        }

        #[cfg(feature = "net_http")]
        if ledd_last_sample.elapsed() >= Duration::from_millis(LEDD_SAMPLE_MS) {
            ledd_last_sample = Instant::now();
            let raw_low = isolated_usb_ready.is_low();
            let ready = raw_low;
            if ready != api_isolated_usb_ready {
                debug!(
                    "isolated usb ready ledd: sampled_ready={} raw_low={} sample_ms={}",
                    ready, raw_low, LEDD_SAMPLE_MS
                );
            }
            api_isolated_usb_ready = ready;
        }

        #[cfg(feature = "net_http")]
        if up0_pg_last_sample.elapsed() >= Duration::from_millis(UP0_PG_SAMPLE_MS) {
            up0_pg_last_sample = Instant::now();
            let raw_high = up0_pg.is_high();
            let fault = raw_high;
            if fault != api_isolated_usb_fault {
                debug!(
                    "isolated usb fault io1: sampled_fault={} raw_high={} sample_ms={}",
                    fault, raw_high, UP0_PG_SAMPLE_MS
                );
            }
            api_isolated_usb_fault = fault;
        }

        let allow_sw2303_probe = !sw2303_error_latched
            || last_sw2303_read_attempt
                .map(|attempt| attempt.elapsed() >= Duration::from_millis(SW2303_ERROR_RETRY_MS))
                .unwrap_or(true);
        if !sw2303_i2c_allowed && allow_sw2303_probe {
            last_sw2303_read_attempt = Some(Instant::now());
            let i2c_inner = sw2303_i2c.into_inner();
            let mut pd_sda = Flex::new(unsafe { AnyPin::steal(39) });
            let mut pd_scl = Flex::new(unsafe { AnyPin::steal(40) });
            pd_sda.set_input_enable(true);
            pd_scl.set_input_enable(true);
            pd_sda.apply_input_config(&sw2303_i2c_release_input_cfg);
            pd_scl.apply_input_config(&sw2303_i2c_release_input_cfg);
            pd_sda.apply_output_config(&sw2303_i2c_release_output_cfg);
            pd_scl.apply_output_config(&sw2303_i2c_release_output_cfg);
            pd_sda.set_high();
            pd_scl.set_high();
            pd_sda.set_output_enable(false);
            pd_scl.set_output_enable(false);
            Timer::after_millis(10).await;
            let bus_released = pd_sda.is_high() && pd_scl.is_high();
            if bus_released {
                info!("sw2303 power gate: PD I2C released after runtime line check");
                sw2303_i2c_allowed = true;
                sw2303_error_latched = false;
            }
            let i2c_inner = i2c_inner.with_sda(pd_sda).with_scl(pd_scl);
            sw2303_i2c = I2cAllowlist::new(i2c_inner);
        }
        let sw2303_power_gate_ready = tps_5v_setpoint_since
            .map(|since| since.elapsed() >= Duration::from_millis(SW2303_POR_RELEASE_MS))
            .unwrap_or(false);
        let allow_sw2303_read = sw2303_i2c_allowed && allow_sw2303_probe && sw2303_power_gate_ready;
        let (request, setpoint) = if allow_sw2303_read {
            last_sw2303_read_attempt = Some(Instant::now());
            let mut retry = 0;
            let request_result = loop {
                match read_power_request(&mut sw2303_i2c).await {
                    Ok(request) => break Ok(request),
                    Err(err) if retry < SW2303_READ_RETRIES => {
                        retry += 1;
                        Timer::after_millis(SW2303_READ_RETRY_DELAY_MS).await;
                        let _ = err;
                    }
                    Err(err) => break Err(err),
                }
            };
            match request_result {
                Ok(request) => {
                    let _ = sw2303_i2c.inner_mut().apply_config(
                        &I2cConfig::default()
                            .with_frequency(Rate::from_khz(PD_I2C_KHZ))
                            .with_software_timeout(SoftwareTimeout::Transaction(
                                Duration::from_millis(PD_I2C_TIMEOUT_MS),
                            )),
                    );
                    if retry > 0 {
                        info!("sw2303 read recovered after {} retries", retry);
                    }
                    sw2303_error_latched = false;
                    sw2303_consecutive_errors = 0;
                    last_valid_sw2303_request = Some(request);
                    sw2303_stable_reads = sw2303_stable_reads.saturating_add(1);
                    if matches!(sw2303_stable_reads, 1 | 10 | 50 | 100)
                        || sw2303_stable_reads % 500 == 0
                    {
                        info!(
                            "sw2303 stable reads={} v_req_mv={} i_req_ma={}",
                            sw2303_stable_reads, request.v_req_mv, request.i_req_ma
                        );
                    }
                    let sp = if sw2303_stable_reads >= SW2303_STABLE_READS_BEFORE_TPS {
                        power_request_to_setpoint(request)
                    } else {
                        boot_sp
                    };
                    (Some(request), sp)
                }
                Err(err) => {
                    let _ = sw2303_i2c.inner_mut().apply_config(
                        &I2cConfig::default()
                            .with_frequency(Rate::from_khz(PD_I2C_KHZ))
                            .with_software_timeout(SoftwareTimeout::Transaction(
                                Duration::from_millis(PD_I2C_TIMEOUT_MS),
                            )),
                    );
                    if !sw2303_error_latched {
                        defmt::warn!(
                            "sw2303 read error; keeping last valid target if available: {:?}",
                            defmt::Debug2Format(&err)
                        );
                        sw2303_error_latched = true;
                    }
                    sw2303_consecutive_errors = sw2303_consecutive_errors.saturating_add(1);
                    let sp = last_valid_sw2303_request
                        .map(power_request_to_setpoint)
                        .unwrap_or(boot_sp);
                    (last_valid_sw2303_request, sp)
                }
            }
        } else {
            let sp = last_valid_sw2303_request
                .map(power_request_to_setpoint)
                .unwrap_or(boot_sp);
            (last_valid_sw2303_request, sp)
        };

        if !sw2303_was_in_error && sw2303_error_latched {
            prompt_tone.notify(SoundEvent::EnterError(ErrorKind::Sw2303I2c));
        } else if sw2303_was_in_error && !sw2303_error_latched {
            prompt_tone.notify(SoundEvent::ExitError(ErrorKind::Sw2303I2c));
        }

        // Apply the SW2303 profile after target-register polling is stable.
        if !sw2303_profile_applied
            && request.is_some()
            && sw2303_stable_reads >= SW2303_STABLE_READS_BEFORE_PROFILE
        {
            let allow_retry = last_sw2303_profile_attempt
                .map(|t| t.elapsed() >= Duration::from_secs(60))
                .unwrap_or(true);
            if allow_retry {
                last_sw2303_profile_attempt = Some(Instant::now());
                match apply_enable_profile_full(&mut sw2303_i2c).await {
                    Ok(status) => {
                        sw2303_profile_applied = true;
                        log_sw2303_profile_status("applied after stable target reads", &status);
                    }
                    Err(err) => {
                        defmt::warn!(
                            "sw2303 profile: apply failed after stable target reads: {:?}",
                            defmt::Debug2Format(&err)
                        );
                    }
                }
            }
        }

        if let Some(request) = request {
            if last_request != Some(request) {
                info!(
                    "pd request: fast_proto={} fast_v={} proto={:?} v_req_mv={} i_req_ma={}",
                    request.fast_protocol,
                    request.fast_voltage,
                    defmt::Debug2Format(&request.negotiated_protocol),
                    request.v_req_mv,
                    request.i_req_ma
                );
                last_request = Some(request);
            }

            if last_fast_protocol != Some(request.fast_protocol) {
                if request.fast_protocol {
                    info!("pd state: fast protocol active");
                } else {
                    info!("pd state: inactive");
                }
                last_fast_protocol = Some(request.fast_protocol);
            }
        } else {
            last_request = None;
            last_fast_protocol = None;
        }

        let mut loop_delay_ms = SW2303_POLL_MS;

        let tps_apply_needed = tps_state.last != Some(setpoint);
        let tps_voltage_update_needed = setpoint.v_out_mv > boot_sp.v_out_mv;
        if sw2303_stable_reads < SW2303_STABLE_READS_BEFORE_TPS
            || (!tps_voltage_update_needed && !tps_apply_needed)
        {
            loop_delay_ms = SW2303_POLL_MS;
        } else if let Err(err) =
            apply_setpoint(telemetry_sampler.i2c_mut(), &mut tps_state, setpoint).await
        {
            if !tps_error_latched {
                defmt::warn!(
                    "tps55288 apply error (keeping output as-is): {:?}",
                    defmt::Debug2Format(&err)
                );
                tps_error_latched = true;
            }
            tps_consecutive_errors = tps_consecutive_errors.saturating_add(1);

            tps_state.last = None;
            loop_delay_ms = SW2303_ERROR_RETRY_MS;
        } else {
            tps_error_latched = false;
            tps_consecutive_errors = 0;
            tps_5v_setpoint_since.get_or_insert_with(Instant::now);
        }

        if !tps_was_in_error && tps_error_latched {
            prompt_tone.notify(SoundEvent::EnterSafety(SafetyKind::TpsApply));
        } else if tps_was_in_error && !tps_error_latched {
            prompt_tone.notify(SoundEvent::ExitSafety(SafetyKind::TpsApply));
        }

        let runtime_recovery_due = sw2303_consecutive_errors >= PD_RUNTIME_RECOVERY_ERROR_LIMIT
            || tps_consecutive_errors >= PD_RUNTIME_RECOVERY_ERROR_LIMIT;
        let runtime_recovery_allowed = last_pd_runtime_recovery
            .map(|last| {
                last.elapsed() >= Duration::from_millis(PD_RUNTIME_RECOVERY_MIN_INTERVAL_MS)
            })
            .unwrap_or(true);
        if runtime_recovery_due && runtime_recovery_allowed {
            pd_runtime_recovery_count = pd_runtime_recovery_count.saturating_add(1);
            last_pd_runtime_recovery = Some(Instant::now());
            defmt::warn!(
                "pd i2c runtime recovery #{}: sw_errors={} tps_errors={} sw_allowed={} stable_reads={}",
                pd_runtime_recovery_count,
                sw2303_consecutive_errors,
                tps_consecutive_errors,
                sw2303_i2c_allowed,
                sw2303_stable_reads
            );

            match stop_output_and_enable_discharge(telemetry_sampler.i2c_mut()).await {
                Ok(()) => info!("pd i2c runtime recovery: TPS OE off and discharge enabled"),
                Err(err) => {
                    defmt::warn!(
                        "pd i2c runtime recovery: TPS discharge failed before CE recovery: {:?}",
                        defmt::Debug2Format(&err)
                    );
                    tps_state.last = None;
                }
            }
            Timer::after_millis(BOOT_PD_DISCHARGE_SETTLE_MS).await;

            let i2c_inner = sw2303_i2c.into_inner();
            let mut pd_sda = Flex::new(unsafe { AnyPin::steal(39) });
            let mut pd_scl = Flex::new(unsafe { AnyPin::steal(40) });
            pd_sda.set_input_enable(true);
            pd_scl.set_input_enable(true);
            pd_sda.apply_input_config(&sw2303_i2c_release_input_cfg);
            pd_scl.apply_input_config(&sw2303_i2c_release_input_cfg);
            pd_sda.apply_output_config(&sw2303_i2c_release_output_cfg);
            pd_scl.apply_output_config(&sw2303_i2c_release_output_cfg);
            pd_sda.set_high();
            pd_scl.set_high();
            pd_sda.set_output_enable(false);
            pd_scl.set_output_enable(false);

            let mut recovered_after_ms = 0;
            let mut recovery_cycles = 0;
            for cycle in 1..=3 {
                recovery_cycles = cycle;
                let _ = ce_tps.set_high();
                Timer::after_millis(BOOT_CE_RECOVERY_HOLD_MS).await;
                let _ = ce_tps.set_low();
                for step in 1..=100 {
                    Timer::after_millis(BOOT_CE_RECOVERY_POLL_MS).await;
                    if pd_sda.is_high() && pd_scl.is_high() {
                        recovered_after_ms = BOOT_CE_RECOVERY_HOLD_MS as u32
                            + step * BOOT_CE_RECOVERY_POLL_MS as u32;
                        break;
                    }
                }
                if pd_sda.is_high() && pd_scl.is_high() {
                    break;
                }
            }
            info!(
                "pd i2c runtime recovery: after CE sda_high={} scl_high={} cycles={} recovered_after_ms={}",
                pd_sda.is_high(),
                pd_scl.is_high(),
                recovery_cycles,
                recovered_after_ms
            );

            let i2c_inner = i2c_inner.with_sda(pd_sda).with_scl(pd_scl);
            sw2303_i2c = I2cAllowlist::new(i2c_inner);
            let _ = sw2303_i2c.inner_mut().apply_config(
                &I2cConfig::default()
                    .with_frequency(Rate::from_khz(PD_I2C_KHZ))
                    .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(
                        PD_I2C_TIMEOUT_MS,
                    ))),
            );

            let mut runtime_boot_ready = false;
            let mut runtime_sw2303_allowed = false;
            for attempt in 1..=PD_RUNTIME_RECOVERY_TPS_RETRIES {
                match apply_setpoint_before_enable(
                    telemetry_sampler.i2c_mut(),
                    &mut tps_state,
                    boot_sp,
                )
                .await
                {
                    Ok(mode_with_oe) => {
                        let i2c_inner = sw2303_i2c.into_inner();
                        let mut pd_sda = Flex::new(unsafe { AnyPin::steal(39) });
                        let mut pd_scl = Flex::new(unsafe { AnyPin::steal(40) });
                        pd_sda.set_input_enable(true);
                        pd_scl.set_input_enable(true);
                        pd_sda.apply_input_config(&sw2303_i2c_release_input_cfg);
                        pd_scl.apply_input_config(&sw2303_i2c_release_input_cfg);
                        pd_sda.apply_output_config(&sw2303_i2c_release_output_cfg);
                        pd_scl.apply_output_config(&sw2303_i2c_release_output_cfg);
                        pd_sda.set_high();
                        pd_scl.set_high();
                        pd_sda.set_output_enable(false);
                        pd_scl.set_output_enable(false);

                        let mode_ack =
                            bitbang_tps55288_mode_write(&mut pd_sda, &mut pd_scl, mode_with_oe)
                                .await;
                        pd_sda.apply_output_config(&sw2303_i2c_release_output_cfg);
                        pd_scl.apply_output_config(&sw2303_i2c_release_output_cfg);
                        pd_sda.set_high();
                        pd_scl.set_high();
                        pd_sda.set_output_enable(false);
                        pd_scl.set_output_enable(false);
                        tps_5v_setpoint_since = Some(Instant::now());
                        tps_state.last = Some(boot_sp);
                        if !mode_ack {
                            defmt::warn!(
                                "pd i2c runtime recovery: TPS OE bitbang write had missing ACK"
                            );
                        }
                        info!(
                            "pd i2c runtime recovery: TPS boot 5V applied (attempt {}/{}); holding SW2303 POR",
                            attempt, PD_RUNTIME_RECOVERY_TPS_RETRIES
                        );
                        Timer::after_millis(SW2303_POR_RELEASE_MS).await;
                        pd_sda.apply_input_config(&sw2303_i2c_release_input_cfg);
                        pd_scl.apply_input_config(&sw2303_i2c_release_input_cfg);
                        pd_sda.apply_output_config(&sw2303_i2c_release_output_cfg);
                        pd_scl.apply_output_config(&sw2303_i2c_release_output_cfg);
                        pd_sda.set_high();
                        pd_scl.set_high();
                        pd_sda.set_output_enable(false);
                        pd_scl.set_output_enable(false);
                        Timer::after_millis(BOOT_PD_RELEASE_SETTLE_MS).await;
                        runtime_sw2303_allowed = pd_sda.is_high() && pd_scl.is_high();
                        info!(
                            "pd i2c runtime recovery: SW2303 POR elapsed sda_high={} scl_high={}",
                            pd_sda.is_high(),
                            pd_scl.is_high()
                        );
                        sw2303_i2c = I2cAllowlist::new(i2c_inner.with_sda(pd_sda).with_scl(pd_scl));
                        runtime_boot_ready = true;
                        break;
                    }
                    Err(err) => {
                        if attempt == PD_RUNTIME_RECOVERY_TPS_RETRIES {
                            defmt::warn!(
                                "pd i2c runtime recovery: TPS boot 5V failed (attempt {}/{}): {:?}",
                                attempt,
                                PD_RUNTIME_RECOVERY_TPS_RETRIES,
                                defmt::Debug2Format(&err)
                            );
                        } else {
                            defmt::warn!(
                                "pd i2c runtime recovery: TPS boot I2C retry after error (attempt {}/{}): {:?}",
                                attempt,
                                PD_RUNTIME_RECOVERY_TPS_RETRIES,
                                defmt::Debug2Format(&err)
                            );
                            let i2c_inner = sw2303_i2c.into_inner();
                            let mut pd_sda = Flex::new(unsafe { AnyPin::steal(39) });
                            let mut pd_scl = Flex::new(unsafe { AnyPin::steal(40) });
                            pd_sda.set_input_enable(true);
                            pd_scl.set_input_enable(true);
                            pd_sda.apply_input_config(&sw2303_i2c_release_input_cfg);
                            pd_scl.apply_input_config(&sw2303_i2c_release_input_cfg);
                            pd_sda.apply_output_config(&sw2303_i2c_release_output_cfg);
                            pd_scl.apply_output_config(&sw2303_i2c_release_output_cfg);
                            pd_sda.set_high();
                            pd_scl.set_high();
                            pd_sda.set_output_enable(false);
                            pd_scl.set_output_enable(false);
                            let _ = ce_tps.set_high();
                            Timer::after_millis(BOOT_CE_RECOVERY_HOLD_MS).await;
                            let _ = ce_tps.set_low();
                            Timer::after_millis(BOOT_TPS_RETRY_DELAY_MS).await;
                            sw2303_i2c =
                                I2cAllowlist::new(i2c_inner.with_sda(pd_sda).with_scl(pd_scl));
                            let _ = sw2303_i2c.inner_mut().apply_config(
                                &I2cConfig::default()
                                    .with_frequency(Rate::from_khz(PD_I2C_KHZ))
                                    .with_software_timeout(SoftwareTimeout::Transaction(
                                        Duration::from_millis(PD_I2C_TIMEOUT_MS),
                                    )),
                            );
                        }
                        tps_state.last = None;
                    }
                }
            }

            sw2303_i2c_allowed = runtime_sw2303_allowed;
            if runtime_boot_ready {
                sw2303_consecutive_errors = 0;
                tps_consecutive_errors = 0;
                sw2303_error_latched = false;
                tps_error_latched = false;
                sw2303_stable_reads = 0;
                sw2303_profile_applied = false;
                last_sw2303_read_attempt = None;
                last_sw2303_profile_attempt = None;
                last_valid_sw2303_request = None;
                last_request = None;
                last_fast_protocol = None;
                last_tps_status = None;
                info!(
                    "pd i2c runtime recovery #{} complete: sw2303_i2c_allowed={}",
                    pd_runtime_recovery_count, sw2303_i2c_allowed
                );
                Timer::after_millis(SW2303_POLL_MS).await;
                continue;
            }

            defmt::warn!(
                "pd i2c runtime recovery #{} failed; keeping safety state",
                pd_runtime_recovery_count
            );
        }

        // TPS55288 fault change logging via shared INT (GPIO7).
        // Note: `STATUS` is read-to-clear, so only read/print on interrupt-driven changes.
        if sw2303_stable_reads >= SW2303_STABLE_READS_BEFORE_TPS_STATUS
            && TPS_INT_DIRTY.swap(false, Ordering::AcqRel)
        {
            let int_tps_low = critical_section::with(|cs| {
                TPS_INT
                    .borrow_ref_mut(cs)
                    .as_ref()
                    .map(|pin| pin.is_low())
                    .unwrap_or(false)
            });

            let status = {
                let mut dev = tps55288::Tps55288::with_address(
                    telemetry_sampler.i2c_mut(),
                    TPS55288_ADDR_7BIT,
                );
                dev.read_status().await
            };

            match status {
                Ok((operating, faults)) => {
                    if faults.short_circuit || faults.over_current || faults.over_voltage {
                        tps_5v_setpoint_since = None;
                    }
                    let changed = int_tps_low != last_tps_int_low
                        || last_tps_status != Some((operating, faults));
                    if changed {
                        info!(
                            "tps fault: int_low={} tps={:?} faults={:?}",
                            int_tps_low,
                            defmt::Debug2Format(&operating),
                            defmt::Debug2Format(&faults),
                        );
                        last_tps_int_low = int_tps_low;
                        last_tps_status = Some((operating, faults));
                    } else {
                        last_tps_int_low = int_tps_low;
                    }
                }
                Err(err) => {
                    if int_tps_low != last_tps_int_low || last_tps_status.is_some() {
                        defmt::warn!(
                            "tps fault: int_low={} read_status error: {:?}",
                            int_tps_low,
                            defmt::Debug2Format(&err)
                        );
                        last_tps_int_low = int_tps_low;
                        last_tps_status = None;
                    } else {
                        last_tps_int_low = int_tps_low;
                    }
                }
            }
        }

        // 2 Hz (500ms) UI tick. Keep PD loop behavior intact outside this path.
        if last_tick.elapsed() >= Duration::from_millis(500) {
            let ui_tick_now = Instant::now();
            last_tick = ui_tick_now;

            if ui.toast_active(ui_tick_now) {
                // Pause normal UI updates while an action toast is active.
                // Telemetry/PD loop continues unaffected.
            } else {
                let telemetry = telemetry_sampler.sample().await;

                // Presence rules (frozen spec):
                // - USB-A: if voltage is Ok(v_mv) and v_mv < 1000 => NotPresent; else Present (incl. read error).
                // - USB-C/PD: present when U17 has real voltage/current or SW2303 reports a real protocol.
                let usb_a_present = match telemetry.usb_a.voltage_mv {
                    Field::Ok(v_mv) if v_mv < 1_000 => false,
                    _ => true,
                };
                let usb_c_present = normal_ui_usb_c_present(
                    request,
                    telemetry.usb_c.voltage_mv,
                    telemetry.usb_c.current_ma,
                );
                let usb_c_mode = normal_ui_usb_c_mode(
                    request,
                    telemetry.usb_c.voltage_mv,
                    telemetry.usb_c.current_ma,
                );

                #[cfg(feature = "net_http")]
                {
                    api_usb_a_present = usb_a_present;
                    api_usb_c_present = usb_c_present;
                    api_usb_a_metrics = telemetry.usb_a;
                    api_usb_c_metrics = telemetry.usb_c;
                    api_sample_uptime_ms = uptime_ms_from_instant(ui_tick_now);
                }

                let snapshot = NormalUiSnapshot {
                    usb_a: NormalUiPort {
                        present: usb_a_present,
                        mode: NormalUiPortMode::UsbA,
                        badge_mv: if usb_a_present { Some(5_000) } else { None },
                        voltage_uv: telemetry_field_to_ui(telemetry.usb_a.voltage_mv),
                        current_ua: telemetry_field_to_ui(telemetry.usb_a.current_ma),
                        power_uw: telemetry_field_to_ui(telemetry.usb_a.power_mw),
                    },
                    usb_c: NormalUiPort {
                        present: usb_c_present,
                        mode: usb_c_mode,
                        badge_mv: if usb_c_present {
                            normal_ui_badge_mv(request, telemetry.usb_c.voltage_mv)
                        } else {
                            None
                        },
                        voltage_uv: telemetry_field_to_ui(telemetry.usb_c.voltage_mv),
                        current_ua: telemetry_field_to_ui(telemetry.usb_c.current_ma),
                        power_uw: telemetry_field_to_ui(telemetry.usb_c.power_mw),
                    },
                };

                if let Err(err) = ui.render_normal_ui(&snapshot).await {
                    if !ui_error_latched {
                        defmt::warn!(
                            "display: render error (continuing): {:?}",
                            defmt::Debug2Format(&err)
                        );
                        ui_error_latched = true;
                    }
                } else {
                    ui_error_latched = false;
                }

                if !ui_was_in_error && ui_error_latched {
                    prompt_tone.notify(SoundEvent::EnterError(ErrorKind::UiRender));
                } else if ui_was_in_error && !ui_error_latched {
                    prompt_tone.notify(SoundEvent::ExitError(ErrorKind::UiRender));
                }
            }
        }

        // Port state machine tick (data replug completion, busy windows, power/data invariants).
        let ports_now = Instant::now();
        if port_usb_a
            .busy_until
            .is_some_and(|until| ports_now >= until)
        {
            port_usb_a.busy_until = None;
        }
        if port_usb_c
            .busy_until
            .is_some_and(|until| ports_now >= until)
        {
            port_usb_c.busy_until = None;
        }

        #[cfg(feature = "net_http")]
        {
            let mut exec_a: Option<net::ApiPortAction> = None;
            let mut exec_c: Option<net::ApiPortAction> = None;

            {
                let mut guard = api_state.lock().await;

                if let Some(action) = guard.pending.port_a {
                    if !port_usb_a.is_busy(ports_now) {
                        guard.pending.port_a = None;
                        exec_a = Some(action);
                    }
                }

                if let Some(action) = guard.pending.port_c {
                    if !port_usb_c.is_busy(ports_now) {
                        guard.pending.port_c = None;
                        exec_c = Some(action);
                    }
                }
            }

            if let Some(action) = exec_a {
                match action {
                    net::ApiPortAction::Replug => {
                        port_usb_a.power = PowerState::On;
                        port_usb_a.data = DataState::Pulsing {
                            until: ports_now + Duration::from_millis(DATA_DISCONNECT_MS),
                        };
                        port_usb_a.busy_until =
                            Some(ports_now + Duration::from_millis(DATA_DISCONNECT_MS));
                        let _ = p1_en_n.set_low();
                        let _ = p1_ced.set_high();
                        let (lines, fg_raw) = toast_spec(ButtonId::Left, ToastId::DataOff);
                        let _ = ui
                            .show_toast(ports_now, lines, fg_raw, Duration::from_millis(TOAST_MS))
                            .await;
                        prompt_tone.notify(SoundEvent::ActionOk);
                    }
                    net::ApiPortAction::Power { enabled } => match (enabled, port_usb_a.power) {
                        (true, PowerState::On) | (false, PowerState::Off) => {}
                        (true, PowerState::Off) => {
                            port_usb_a.power = PowerState::On;
                            port_usb_a.data = DataState::Connected;
                            port_usb_a.busy_until =
                                Some(ports_now + Duration::from_millis(POWER_SWITCH_GUARD_MS));
                            let _ = p1_en_n.set_low();
                            let _ = p1_ced.set_low();
                            let (lines, fg_raw) = toast_spec(ButtonId::Left, ToastId::PwrOn);
                            let _ = ui
                                .show_toast(
                                    ports_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            prompt_tone.notify(SoundEvent::ActionOk);
                        }
                        (false, PowerState::On) => {
                            port_usb_a.power = PowerState::Off;
                            port_usb_a.data = DataState::Disconnected;
                            port_usb_a.busy_until =
                                Some(ports_now + Duration::from_millis(POWER_SWITCH_GUARD_MS));
                            let _ = p1_en_n.set_high();
                            let _ = p1_ced.set_high();
                            let (lines, fg_raw) = toast_spec(ButtonId::Left, ToastId::PwrOff);
                            let _ = ui
                                .show_toast(
                                    ports_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            prompt_tone.notify(SoundEvent::ActionOk);
                        }
                    },
                }
            }

            if let Some(action) = exec_c {
                match action {
                    net::ApiPortAction::Replug => {
                        port_usb_c.power = PowerState::On;
                        port_usb_c.data = DataState::Pulsing {
                            until: ports_now + Duration::from_millis(DATA_DISCONNECT_MS),
                        };
                        port_usb_c.busy_until =
                            Some(ports_now + Duration::from_millis(DATA_DISCONNECT_MS));
                        let _ = ce_tps.set_low();
                        let _ = p2_ced.set_high();
                        let (lines, fg_raw) = toast_spec(ButtonId::Right, ToastId::DataOff);
                        let _ = ui
                            .show_toast(ports_now, lines, fg_raw, Duration::from_millis(TOAST_MS))
                            .await;
                        prompt_tone.notify(SoundEvent::ActionOk);
                    }
                    net::ApiPortAction::Power { enabled } => match (enabled, port_usb_c.power) {
                        (true, PowerState::On) | (false, PowerState::Off) => {}
                        (true, PowerState::Off) => {
                            port_usb_c.power = PowerState::On;
                            port_usb_c.data = DataState::Connected;
                            port_usb_c.busy_until =
                                Some(ports_now + Duration::from_millis(POWER_SWITCH_GUARD_MS));
                            let _ = ce_tps.set_low();
                            let _ = p2_ced.set_low();
                            let (lines, fg_raw) = toast_spec(ButtonId::Right, ToastId::PwrOn);
                            let _ = ui
                                .show_toast(
                                    ports_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            prompt_tone.notify(SoundEvent::ActionOk);
                        }
                        (false, PowerState::On) => {
                            port_usb_c.power = PowerState::Off;
                            port_usb_c.data = DataState::Disconnected;
                            port_usb_c.busy_until =
                                Some(ports_now + Duration::from_millis(POWER_SWITCH_GUARD_MS));
                            let _ = ce_tps.set_high();
                            let _ = p2_ced.set_high();
                            let (lines, fg_raw) = toast_spec(ButtonId::Right, ToastId::PwrOff);
                            let _ = ui
                                .show_toast(
                                    ports_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            prompt_tone.notify(SoundEvent::ActionOk);
                        }
                    },
                }
            }
        }

        // USB-A invariants: P1_CED drives CH442E EN# (low=connected, high=disconnected).
        match port_usb_a.power {
            PowerState::On => {
                let _ = p1_en_n.set_low();
                match port_usb_a.data {
                    DataState::Connected => {
                        let _ = p1_ced.set_low();
                    }
                    DataState::Disconnected => {
                        let _ = p1_ced.set_high();
                    }
                    DataState::Pulsing { until } => {
                        if ports_now >= until {
                            port_usb_a.data = DataState::Connected;
                            port_usb_a.busy_until = None;
                            let _ = p1_ced.set_low();
                            let (lines, fg_raw) = toast_spec(ButtonId::Left, ToastId::DataOn);
                            let _ = ui
                                .show_toast(
                                    ports_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                        } else {
                            let _ = p1_ced.set_high();
                        }
                    }
                }
            }
            PowerState::Off => {
                port_usb_a.data = DataState::Disconnected;
                let _ = p1_en_n.set_high();
                let _ = p1_ced.set_high();
            }
        }

        // USB-C invariants: P2_CED drives CH442E EN# (low=connected, high=disconnected).
        match port_usb_c.power {
            PowerState::On => {
                let _ = ce_tps.set_low();
                match port_usb_c.data {
                    DataState::Connected => {
                        let _ = p2_ced.set_low();
                    }
                    DataState::Disconnected => {
                        let _ = p2_ced.set_high();
                    }
                    DataState::Pulsing { until } => {
                        if ports_now >= until {
                            port_usb_c.data = DataState::Connected;
                            port_usb_c.busy_until = None;
                            let _ = p2_ced.set_low();
                            let (lines, fg_raw) = toast_spec(ButtonId::Right, ToastId::DataOn);
                            let _ = ui
                                .show_toast(
                                    ports_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                        } else {
                            let _ = p2_ced.set_high();
                        }
                    }
                }
            }
            PowerState::Off => {
                port_usb_c.data = DataState::Disconnected;
                let _ = ce_tps.set_high();
                let _ = p2_ced.set_high();
            }
        }

        // Button handling: stable press/release with duration classification.
        let buttons_now = Instant::now();
        let raw_left_pressed = btn_left.is_low();
        let raw_right_pressed = btn_right.is_low();
        if raw_left_pressed != btn_raw_left_pressed || raw_right_pressed != btn_raw_right_pressed {
            btn_raw_left_pressed = raw_left_pressed;
            btn_raw_right_pressed = raw_right_pressed;
            info!(
                "buttons: raw left_pressed={} right_pressed={}",
                raw_left_pressed, raw_right_pressed
            );
        }

        let left_edge = btn_left_state.update(buttons_now, raw_left_pressed, btn_debounce);
        let right_edge = btn_right_state.update(buttons_now, raw_right_pressed, btn_debounce);

        #[cfg(feature = "net_http")]
        let left_pressed = btn_left_state.is_pressed();
        #[cfg(feature = "net_http")]
        let right_pressed = btn_right_state.is_pressed();
        #[cfg(feature = "net_http")]
        if settings_menu_until.is_some_and(|until| buttons_now >= until) {
            settings_menu_until = None;
            settings_menu_view = SettingsMenuView::Main;
            ui.clear_toast();
        }

        #[cfg(feature = "net_http")]
        let settings_menu_active = settings_menu_until.is_some_and(|until| buttons_now < until);

        // Combo: long press opens the settings menu; in-menu short combo selects.
        // Holding >5s is invalid ("expired") and does nothing.
        #[cfg(feature = "net_http")]
        if !combo_active && left_pressed && right_pressed {
            combo_active = true;
            combo_pressed_at = Some(buttons_now);
            combo_done = false;
            combo_expired = false;
        }

        #[cfg(feature = "net_http")]
        if combo_active && left_pressed && right_pressed {
            if let Some(since) = combo_pressed_at {
                if buttons_now - since > PRESS_LONG_MAX {
                    combo_expired = true;
                } else if !settings_menu_active
                    && !combo_done
                    && buttons_now - since >= PRESS_LONG_MIN
                {
                    settings_menu_selected = SettingsMenuItem::Mode;
                    settings_menu_until =
                        Some(buttons_now + Duration::from_millis(SETTINGS_MENU_MS));
                    let _ = ui
                        .show_settings_menu(
                            buttons_now,
                            settings_menu_selected.index(),
                            Duration::from_millis(SETTINGS_MENU_MS),
                        )
                        .await;
                    prompt_tone.notify(SoundEvent::MenuConfirm);
                    combo_done = true;
                }
            }
        }

        #[cfg(feature = "net_http")]
        if combo_active && (!left_pressed || !right_pressed) && !combo_done {
            if let Some(since) = combo_pressed_at {
                let duration = buttons_now - since;
                if !combo_expired && settings_menu_active {
                    if duration >= PRESS_SHORT_MIN && duration <= PRESS_SHORT_MAX {
                        match settings_menu_selected {
                            SettingsMenuItem::Mode => match settings_menu_view {
                                SettingsMenuView::Main => {
                                    settings_menu_view = SettingsMenuView::ModeDetail;
                                    settings_menu_until =
                                        Some(buttons_now + Duration::from_millis(SETTINGS_MENU_MS));
                                    let mut lines = [*b"                    "; 3];
                                    copy_compact_line(
                                        &mut lines[0],
                                        route_current_label(usb_c_downstream_route),
                                    );
                                    copy_compact_line(
                                        &mut lines[1],
                                        route_mode_label(usb_c_downstream_route),
                                    );
                                    copy_compact_line(&mut lines[2], "PRESS AGAIN TO SET");
                                    let _ = ui
                                        .show_lines_card(
                                            buttons_now,
                                            route_detail_title(usb_c_downstream_route),
                                            &lines,
                                            TOAST_INFO_RAW,
                                            Duration::from_millis(SETTINGS_MENU_MS),
                                        )
                                        .await;
                                    prompt_tone.notify(SoundEvent::MenuConfirm);
                                }
                                SettingsMenuView::ModeDetail => {
                                    let pending_busy = {
                                        let guard = api_state.lock().await;
                                        guard.pending.usb_c_downstream_route.is_some()
                                    };
                                    if port_usb_c.is_busy(buttons_now) || pending_busy {
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::Busy);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionFail);
                                    } else {
                                        let next_route = match usb_c_downstream_route {
                                            provisioning::UsbCDownstreamRoute::Mcu => {
                                                provisioning::UsbCDownstreamRoute::UsbC
                                            }
                                            provisioning::UsbCDownstreamRoute::UsbC => {
                                                provisioning::UsbCDownstreamRoute::Mcu
                                            }
                                        };
                                        {
                                            let mut guard = api_state.lock().await;
                                            guard.pending.usb_c_downstream_route = Some(next_route);
                                        }
                                        prompt_tone.notify(SoundEvent::MenuConfirm);
                                        settings_menu_until = None;
                                        settings_menu_view = SettingsMenuView::Main;
                                        button_fast_loop_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                    }
                                }
                            },
                            SettingsMenuItem::Wifi => {
                                let (short_id, ip) = if let Some(handles) = net_handles.as_ref() {
                                    let ip = {
                                        let state = handles.wifi_state.lock().await;
                                        state.ipv4
                                    };
                                    (Some(handles.device_names.short_id.as_str()), ip)
                                } else {
                                    (None, None)
                                };

                                let lines = net::format_network_toast_lines(short_id, ip);
                                let _ = ui
                                    .show_lines_card(
                                        buttons_now,
                                        "WIFI",
                                        &lines,
                                        TOAST_INFO_RAW,
                                        Duration::from_millis(SETTINGS_MENU_MS),
                                    )
                                    .await;
                                prompt_tone.notify(SoundEvent::MenuConfirm);
                                settings_menu_until = None;
                            }
                            SettingsMenuItem::About => {
                                let lines = about_toast_lines();
                                let _ = ui
                                    .show_lines_card(
                                        buttons_now,
                                        "ABOUT",
                                        &lines,
                                        TOAST_INFO_RAW,
                                        Duration::from_millis(SETTINGS_MENU_MS),
                                    )
                                    .await;
                                prompt_tone.notify(SoundEvent::MenuConfirm);
                                settings_menu_until = None;
                            }
                        };
                    }
                } else if !combo_expired && duration >= PRESS_LONG_MIN && duration <= PRESS_LONG_MAX
                {
                    settings_menu_selected = SettingsMenuItem::Mode;
                    settings_menu_until =
                        Some(buttons_now + Duration::from_millis(SETTINGS_MENU_MS));
                    let _ = ui
                        .show_settings_menu(
                            buttons_now,
                            settings_menu_selected.index(),
                            Duration::from_millis(SETTINGS_MENU_MS),
                        )
                        .await;
                    prompt_tone.notify(SoundEvent::MenuConfirm);
                } else if !combo_expired
                    && duration >= PRESS_SHORT_MIN
                    && duration <= PRESS_SHORT_MAX
                {
                    // Short combo is only meaningful inside the settings menu.
                } else if !combo_expired {
                    // Preserve invalid timing as a no-op for combo actions.
                }
            }
            combo_done = true;
        }

        let settings_menu_active = settings_menu_until.is_some_and(|until| buttons_now < until);

        if let Some(edge) = left_edge {
            match edge {
                ButtonEdge::Pressed => {
                    info!("button: left pressed");
                    btn_left_pressed_at = Some(buttons_now);
                    button_fast_loop_until = Some(buttons_now + PRESS_LONG_MAX);
                }
                ButtonEdge::Released => {
                    info!("button: left released");

                    if combo_active {
                        btn_left_pressed_at = None;
                    } else if settings_menu_active {
                        if let Some(pressed_at) = btn_left_pressed_at.take() {
                            if matches!(classify_press(buttons_now - pressed_at), PressClass::Short)
                            {
                                match settings_menu_view {
                                    SettingsMenuView::Main => {
                                        settings_menu_selected = settings_menu_selected.prev();
                                        settings_menu_until = Some(
                                            buttons_now + Duration::from_millis(SETTINGS_MENU_MS),
                                        );
                                        let _ = ui
                                            .show_settings_menu(
                                                buttons_now,
                                                settings_menu_selected.index(),
                                                Duration::from_millis(SETTINGS_MENU_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::MenuNavigate);
                                    }
                                    SettingsMenuView::ModeDetail => {
                                        settings_menu_until = Some(
                                            buttons_now + Duration::from_millis(SETTINGS_MENU_MS),
                                        );
                                    }
                                }
                            }
                        }
                    } else {
                        let Some(pressed_at) = btn_left_pressed_at.take() else {
                            // Ignore unmatched releases.
                            continue;
                        };
                        let class = classify_press(buttons_now - pressed_at);

                        let rejected = match class {
                            PressClass::Invalid => Some(ToastId::BadTime),
                            _ if port_usb_a.is_busy(buttons_now) => Some(ToastId::Busy),
                            _ => None,
                        };

                        if let Some(reject_toast) = rejected {
                            let (lines, fg_raw) = toast_spec(ButtonId::Left, reject_toast);
                            let _ = ui
                                .show_toast(
                                    buttons_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            prompt_tone.notify(SoundEvent::ActionFail);
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(250));
                        } else {
                            match class {
                                PressClass::Short => match port_usb_a.power {
                                    PowerState::Off => {
                                        port_usb_a.power = PowerState::On;
                                        port_usb_a.data = DataState::Connected;
                                        port_usb_a.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = p1_en_n.set_low();
                                        let _ = p1_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::PwrOn);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_a.data = DataState::Pulsing {
                                            until: buttons_now
                                                + Duration::from_millis(DATA_DISCONNECT_MS),
                                        };
                                        port_usb_a.busy_until = Some(
                                            buttons_now + Duration::from_millis(DATA_DISCONNECT_MS),
                                        );
                                        let _ = p1_ced.set_high();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::DataOff);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                },
                                PressClass::Long => match port_usb_a.power {
                                    PowerState::Off => {
                                        port_usb_a.power = PowerState::On;
                                        port_usb_a.data = DataState::Connected;
                                        port_usb_a.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = p1_en_n.set_low();
                                        let _ = p1_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::PwrOn);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_a.power = PowerState::Off;
                                        port_usb_a.data = DataState::Disconnected;
                                        port_usb_a.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = p1_en_n.set_high();
                                        let _ = p1_ced.set_high();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::PwrOff);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                },
                                PressClass::Invalid => unreachable!("handled above"),
                            }
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(350));
                        }
                    }
                }
            }
        }

        if let Some(edge) = right_edge {
            match edge {
                ButtonEdge::Pressed => {
                    info!("button: right pressed");
                    btn_right_pressed_at = Some(buttons_now);
                    button_fast_loop_until = Some(buttons_now + PRESS_LONG_MAX);
                }
                ButtonEdge::Released => {
                    info!("button: right released");

                    if combo_active {
                        btn_right_pressed_at = None;
                    } else if settings_menu_active {
                        if let Some(pressed_at) = btn_right_pressed_at.take() {
                            if matches!(classify_press(buttons_now - pressed_at), PressClass::Short)
                            {
                                match settings_menu_view {
                                    SettingsMenuView::Main => {
                                        settings_menu_selected = settings_menu_selected.next();
                                        settings_menu_until = Some(
                                            buttons_now + Duration::from_millis(SETTINGS_MENU_MS),
                                        );
                                        let _ = ui
                                            .show_settings_menu(
                                                buttons_now,
                                                settings_menu_selected.index(),
                                                Duration::from_millis(SETTINGS_MENU_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::MenuNavigate);
                                    }
                                    SettingsMenuView::ModeDetail => {
                                        settings_menu_until = Some(
                                            buttons_now + Duration::from_millis(SETTINGS_MENU_MS),
                                        );
                                    }
                                }
                            }
                        }
                    } else {
                        let Some(pressed_at) = btn_right_pressed_at.take() else {
                            continue;
                        };
                        let class = classify_press(buttons_now - pressed_at);

                        let rejected = match class {
                            PressClass::Invalid => Some(ToastId::BadTime),
                            _ if port_usb_c.is_busy(buttons_now) => Some(ToastId::Busy),
                            _ => None,
                        };

                        if let Some(reject_toast) = rejected {
                            let (lines, fg_raw) = toast_spec(ButtonId::Right, reject_toast);
                            let _ = ui
                                .show_toast(
                                    buttons_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            prompt_tone.notify(SoundEvent::ActionFail);
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(250));
                        } else {
                            match class {
                                PressClass::Short => match port_usb_c.power {
                                    PowerState::Off => {
                                        port_usb_c.power = PowerState::On;
                                        port_usb_c.data = DataState::Connected;
                                        port_usb_c.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = ce_tps.set_low();
                                        let _ = p2_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::PwrOn);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_c.data = DataState::Pulsing {
                                            until: buttons_now
                                                + Duration::from_millis(DATA_DISCONNECT_MS),
                                        };
                                        port_usb_c.busy_until = Some(
                                            buttons_now + Duration::from_millis(DATA_DISCONNECT_MS),
                                        );
                                        let _ = p2_ced.set_high();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::DataOff);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                },
                                PressClass::Long => match port_usb_c.power {
                                    PowerState::Off => {
                                        port_usb_c.power = PowerState::On;
                                        port_usb_c.data = DataState::Connected;
                                        port_usb_c.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = ce_tps.set_low();
                                        let _ = p2_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::PwrOn);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_c.power = PowerState::Off;
                                        port_usb_c.data = DataState::Disconnected;
                                        port_usb_c.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = ce_tps.set_high();
                                        let _ = p2_ced.set_high();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::PwrOff);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                },
                                PressClass::Invalid => unreachable!("handled above"),
                            }
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(350));
                        }
                    }
                }
            }
        }

        #[cfg(feature = "net_http")]
        if combo_active && !left_pressed && !right_pressed {
            combo_active = false;
            combo_pressed_at = None;
            combo_done = false;
            combo_expired = false;
        }

        #[cfg(feature = "net_http")]
        {
            let now = Instant::now();

            let ports = net::ApiPortsSnapshot {
                port_a: net::ApiPortSnapshot {
                    telemetry: port_metrics_to_api_telemetry(
                        api_usb_a_present,
                        api_usb_a_metrics,
                        api_sample_uptime_ms,
                    ),
                    state: net::ApiPortState {
                        power_enabled: port_usb_a.power == PowerState::On,
                        data_connected: matches!(port_usb_a.data, DataState::Connected),
                        replugging: matches!(port_usb_a.data, DataState::Pulsing { .. }),
                        busy: port_usb_a.is_busy(now),
                    },
                },
                port_c: net::ApiPortSnapshot {
                    telemetry: port_metrics_to_api_telemetry(
                        api_usb_c_present,
                        api_usb_c_metrics,
                        api_sample_uptime_ms,
                    ),
                    state: net::ApiPortState {
                        power_enabled: port_usb_c.power == PowerState::On,
                        data_connected: matches!(port_usb_c.data, DataState::Connected),
                        replugging: matches!(port_usb_c.data, DataState::Pulsing { .. }),
                        busy: port_usb_c.is_busy(now),
                    },
                },
            };

            let mut guard = api_state.lock().await;
            guard.hub = net::ApiHubSnapshot {
                upstream_connected: api_isolated_usb_ready,
                isolated_usb_fault: api_isolated_usb_fault,
                isolated_downstream_connected: !api_isolated_usb_fault,
                isolated_usb_ready: api_isolated_usb_ready,
                usb_c_downstream_route,
                usb_c_downstream_persisted,
            };
            guard.ports = ports;
        }

        let now_us = esp_hal::time::Instant::now()
            .duration_since_epoch()
            .as_micros();
        let now = core::time::Duration::from_micros(now_us);
        prompt_tone.tick(now);

        if button_fast_loop_until.is_some_and(|until| Instant::now() < until) {
            loop_delay_ms = loop_delay_ms.min(10);
        } else {
            button_fast_loop_until = None;
        }

        Timer::after_millis(loop_delay_ms).await;
    }
}
