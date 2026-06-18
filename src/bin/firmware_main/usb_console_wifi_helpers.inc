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
