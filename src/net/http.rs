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
    body: &str,
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
                release_version(),
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
        ("GET", "/api/v1/power/config") => {
            let state = { *api_state.lock().await };
            let mut body = String::new();
            write_power_config_json(&mut body, &state.power);
            write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
            return Ok(());
        }
        ("PUT", "/api/v1/power/config") => {
            let Some(config) = parse_power_config_body(body) else {
                write_api_error(
                    socket,
                    "400 Bad Request",
                    allow_origin,
                    "bad_request",
                    "missing or invalid power config",
                    false,
                )
                .await?;
                return Ok(());
            };
            let owner = parse_owner_query(query);
            match try_set_power_config(api_state, ApiPowerConfigCommand::Set { config }, owner)
                .await
            {
                Ok(()) => {
                    if crate::wait_power_config_result().await {
                        let mut body = String::new();
                        let state = { *api_state.lock().await };
                        write_power_config_json(&mut body, &state.power);
                        write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
                    } else {
                        write_api_error(
                            socket,
                            "500 Internal Server Error",
                            allow_origin,
                            "eeprom_failed",
                            "Power configuration could not be saved to EEPROM U21",
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
                        "power configuration is busy or locked",
                        true,
                    )
                    .await?;
                }
            }
            return Ok(());
        }
        ("POST", "/api/v1/power/config/defaults") => {
            let owner = parse_owner_query(query);
            match try_set_power_config(api_state, ApiPowerConfigCommand::Defaults, owner).await {
                Ok(()) => {
                    if crate::wait_power_config_result().await {
                        let mut body = String::new();
                        let state = { *api_state.lock().await };
                        write_power_config_json(&mut body, &state.power);
                        write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
                    } else {
                        write_api_error(
                            socket,
                            "500 Internal Server Error",
                            allow_origin,
                            "eeprom_failed",
                            "Power defaults could not be saved to EEPROM U21",
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
                        "power configuration is busy or locked",
                        true,
                    )
                    .await?;
                }
            }
            return Ok(());
        }
        ("POST", "/api/v1/power/config/lock") => {
            let Some(owner) = parse_owner_query(query) else {
                write_api_error(
                    socket,
                    "400 Bad Request",
                    allow_origin,
                    "bad_request",
                    "missing owner",
                    false,
                )
                .await?;
                return Ok(());
            };
            match try_set_power_lock(api_state, owner, true).await {
                Ok(()) => {
                    let state = { *api_state.lock().await };
                    let mut body = String::new();
                    write_power_config_json(&mut body, &state.power);
                    write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
                }
                Err(ApiActionError::Busy) => {
                    write_api_error(
                        socket,
                        "409 Conflict",
                        allow_origin,
                        "busy",
                        "power configuration lock is owned by another host",
                        true,
                    )
                    .await?;
                }
            }
            return Ok(());
        }
        ("POST", "/api/v1/power/config/release") => {
            let Some(owner) = parse_owner_query(query) else {
                write_api_error(
                    socket,
                    "400 Bad Request",
                    allow_origin,
                    "bad_request",
                    "missing owner",
                    false,
                )
                .await?;
                return Ok(());
            };
            let _ = try_set_power_lock(api_state, owner, false).await;
            let state = { *api_state.lock().await };
            let mut body = String::new();
            write_power_config_json(&mut body, &state.power);
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

fn parse_owner_query(query: &str) -> Option<u32> {
    for part in query.split('&') {
        let (k, v) = part.split_once('=')?;
        if k == "owner" {
            return v.parse::<u32>().ok().filter(|v| *v != 0);
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

pub fn parse_power_config_body(body: &str) -> Option<PowerConfig> {
    let hardware = extract_body_string(body, "hardware").unwrap_or_else(|| String::from("sw2303"));
    if hardware.as_str() != "sw2303" {
        return None;
    }
    let tps_mode = match extract_body_string(body, "tps_mode")?.as_str() {
        "auto_follow" => TpsMode::AutoFollow,
        "manual" => TpsMode::Manual,
        _ => return None,
    };
    let manual_path = match extract_body_string(body, "usb_c_path_mode")
        .unwrap_or_else(|| String::from("default"))
        .as_str()
    {
        "default" => ManualUsbCPathMode::Default,
        "disconnect" => ManualUsbCPathMode::Disconnect,
        "force" => ManualUsbCPathMode::Force,
        _ => return None,
    };
    let mut config = PowerConfig::defaults();
    config.tps_mode = tps_mode;
    config.manual = ManualTpsConfig {
        voltage_mv: extract_body_u16(body, "voltage_mv").unwrap_or(config.manual.voltage_mv),
        current_limit_ma: extract_body_u16(body, "current_limit_ma")
            .unwrap_or(config.manual.current_limit_ma),
        usb_c_path_mode: manual_path,
    };
    if let Some(power_watts) = extract_body_u8(body, "power_watts") {
        config.capability.power_watts = power_watts;
    }
    set_bool_if_present(body, "pd", &mut config.capability.pd_enabled);
    set_bool_if_present(body, "qc20", &mut config.capability.qc20_enabled);
    set_bool_if_present(body, "qc30", &mut config.capability.qc30_enabled);
    set_bool_if_present(body, "fcp", &mut config.capability.fcp_enabled);
    set_bool_if_present(body, "afc", &mut config.capability.afc_enabled);
    set_bool_if_present(body, "scp", &mut config.capability.scp_enabled);
    set_bool_if_present(body, "pe20", &mut config.capability.pe20_enabled);
    set_bool_if_present(body, "bc12", &mut config.capability.bc12_enabled);
    set_bool_if_present(body, "sfcp", &mut config.capability.sfcp_enabled);
    set_bool_if_present(body, "pps", &mut config.capability.pps_enabled);
    apply_fixed_voltages_if_present(body, &mut config.capability)?;
    config.validated().ok()
}

fn set_bool_if_present(body: &str, key: &str, target: &mut bool) {
    if let Some(v) = extract_body_bool(body, key) {
        *target = v;
    }
}

fn extract_body_string(body: &str, key: &str) -> Option<String> {
    let rest = json_value_after_key_body(body, key)?;
    parse_json_string_value_body(rest).map(|(value, _)| value)
}

fn extract_body_bool(body: &str, key: &str) -> Option<bool> {
    let rest = json_value_after_key_body(body, key)?;
    if rest.starts_with("true") {
        Some(true)
    } else if rest.starts_with("false") {
        Some(false)
    } else {
        None
    }
}

fn extract_body_u16(body: &str, key: &str) -> Option<u16> {
    extract_body_u32(body, key).and_then(|v| u16::try_from(v).ok())
}

fn extract_body_u8(body: &str, key: &str) -> Option<u8> {
    extract_body_u32(body, key).and_then(|v| u8::try_from(v).ok())
}

fn extract_body_u32(body: &str, key: &str) -> Option<u32> {
    let rest = json_value_after_key_body(body, key)?;
    let mut out = 0u32;
    let mut seen = false;
    for ch in rest.chars() {
        if let Some(digit) = ch.to_digit(10) {
            seen = true;
            out = out.checked_mul(10)?.checked_add(digit)?;
        } else {
            break;
        }
    }
    seen.then_some(out)
}

fn apply_fixed_voltages_if_present(
    body: &str,
    capability: &mut UsbCCapabilityConfig,
) -> Option<()> {
    let Some(rest) = json_value_after_key_body(body, "fixed_voltages_mv") else {
        return Some(());
    };
    let mut rest = rest.strip_prefix('[')?.trim_start();
    let mut fixed_9v = false;
    let mut fixed_12v = false;
    let mut fixed_15v = false;
    let mut fixed_20v = false;

    loop {
        if rest.strip_prefix(']').is_some() {
            capability.fixed_9v = fixed_9v;
            capability.fixed_12v = fixed_12v;
            capability.fixed_15v = fixed_15v;
            capability.fixed_20v = fixed_20v;
            return Some(());
        }

        let (voltage_mv, consumed) = parse_json_u32_prefix(rest)?;
        match voltage_mv {
            9000 => fixed_9v = true,
            12000 => fixed_12v = true,
            15000 => fixed_15v = true,
            20000 => fixed_20v = true,
            _ => return None,
        }

        rest = rest[consumed..].trim_start();
        if let Some(after) = rest.strip_prefix(',') {
            rest = after.trim_start();
        } else if !rest.starts_with(']') {
            return None;
        }
    }
}

fn parse_json_u32_prefix(value: &str) -> Option<(u32, usize)> {
    let mut out = 0u32;
    let mut seen = false;
    let mut consumed = 0usize;
    for (idx, ch) in value.char_indices() {
        if let Some(digit) = ch.to_digit(10) {
            seen = true;
            out = out.checked_mul(10)?.checked_add(digit)?;
            consumed = idx + ch.len_utf8();
        } else {
            break;
        }
    }
    seen.then_some((out, consumed))
}

fn json_value_after_key_body<'a>(body: &'a str, key: &str) -> Option<&'a str> {
    let mut needle = String::new();
    let _ = core::write!(needle, "\"{}\"", key);
    let start = body.find(needle.as_str())?;
    let colon = body[start..].find(':')?;
    Some(body[start + colon + 1..].trim_start())
}

fn parse_json_string_value_body(rest: &str) -> Option<(String, usize)> {
    let mut chars = rest.char_indices();
    let (_, first) = chars.next()?;
    if first != '"' {
        return None;
    }

    let mut out = String::new();
    while let Some((idx, ch)) = chars.next() {
        match ch {
            '"' => return Some((out, idx + ch.len_utf8())),
            '\\' => {
                let (_, escaped) = chars.next()?;
                match escaped {
                    '"' | '\\' | '/' => {
                        let _ = out.push(escaped);
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
        "{{\"usb_c_power_enabled\":{},\"sw2303_i2c_allowed\":{},\"sw2303_profile_applied\":{},\"sw2303_stable_reads\":{},\"sw2303_error_latched\":{},\"tps_error_latched\":{},\"sw2303_readback_config\":",
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
    write_sw2303_readback_json(
        body,
        pd.sw2303_readback_config,
        pd.sw2303_readback_matches_config,
    );
    let _ = body.push_str(",\"sw2303_request\":{\"mv\":");
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

fn write_sw2303_readback_json(
    body: &mut String,
    readback: isolapurr_usb_hub::power_config::Sw2303CapabilityReadback,
    matches_config: bool,
) {
    let _ = core::write!(
        body,
        "{{\"available\":{},\"matches_config\":{},\"power_watts\":",
        if readback.available { "true" } else { "false" },
        if matches_config { "true" } else { "false" },
    );
    write_json_u32_or_null(body, readback.power_watts.map(|v| v as u32));
    let _ = body.push_str(",\"protocols\":{\"pd\":");
    write_json_bool_or_null(body, readback.pd_enabled);
    let _ = body.push_str(",\"qc20\":");
    write_json_bool_or_null(body, readback.qc20_enabled);
    let _ = body.push_str(",\"qc30\":");
    write_json_bool_or_null(body, readback.qc30_enabled);
    let _ = body.push_str(",\"fcp\":");
    write_json_bool_or_null(body, readback.fcp_enabled);
    let _ = body.push_str(",\"afc\":");
    write_json_bool_or_null(body, readback.afc_enabled);
    let _ = body.push_str(",\"scp\":");
    write_json_bool_or_null(body, readback.scp_enabled);
    let _ = body.push_str(",\"pe20\":");
    write_json_bool_or_null(body, readback.pe20_enabled);
    let _ = body.push_str(",\"bc12\":");
    write_json_bool_or_null(body, readback.bc12_enabled);
    let _ = body.push_str(",\"sfcp\":");
    write_json_bool_or_null(body, readback.sfcp_enabled);
    let _ = body.push_str("},\"pd\":{\"pps\":");
    write_json_bool_or_null(body, readback.pps_enabled);
    let _ = body.push_str(",\"fixed_voltages_mv\":[");
    write_fixed_voltage_json(body, readback.fixed_9v.unwrap_or(false), 9000);
    write_fixed_voltage_json(body, readback.fixed_12v.unwrap_or(false), 12000);
    write_fixed_voltage_json(body, readback.fixed_15v.unwrap_or(false), 15000);
    write_fixed_voltage_json(body, readback.fixed_20v.unwrap_or(false), 20000);
    let _ = body.push_str("]}}");
}

pub fn write_power_config_json(body: &mut String, power: &ApiPowerSnapshot) {
    let cfg = power.config;
    let _ = core::write!(
        body,
        "{{\"hardware\":\"{}\",\"persisted\":{},\"tps_mode\":\"{}\",\"capability\":{{\"profile\":\"full\",\"power_watts\":{},\"protocols\":{{\"pd\":{},\"qc20\":{},\"qc30\":{},\"fcp\":{},\"afc\":{},\"scp\":{},\"pe20\":{},\"bc12\":{},\"sfcp\":{}}},\"pd\":{{\"pps\":{},\"fixed_voltages_mv\":[",
        cfg.hardware.as_str(),
        if power.persisted { "true" } else { "false" },
        cfg.tps_mode.as_str(),
        cfg.capability.power_watts,
        cfg.capability.pd_enabled,
        cfg.capability.qc20_enabled,
        cfg.capability.qc30_enabled,
        cfg.capability.fcp_enabled,
        cfg.capability.afc_enabled,
        cfg.capability.scp_enabled,
        cfg.capability.pe20_enabled,
        cfg.capability.bc12_enabled,
        cfg.capability.sfcp_enabled,
        cfg.capability.pps_enabled,
    );
    write_fixed_voltage_json(body, cfg.capability.fixed_9v, 9000);
    write_fixed_voltage_json(body, cfg.capability.fixed_12v, 12000);
    write_fixed_voltage_json(body, cfg.capability.fixed_15v, 15000);
    write_fixed_voltage_json(body, cfg.capability.fixed_20v, 20000);
    let _ = core::write!(
        body,
        "]}}}},\"manual\":{{\"voltage_mv\":{},\"current_limit_ma\":{},\"usb_c_path_mode\":\"{}\",\"path_policy\":\"{}\"}},\"lock\":",
        cfg.manual.voltage_mv,
        cfg.manual.current_limit_ma,
        cfg.manual.usb_c_path_mode.as_str(),
        power
            .last_path_control
            .map(|control| control.as_str())
            .unwrap_or("unknown"),
    );
    match power.lock {
        Some(lock) => {
            let _ = core::write!(
                body,
                "{{\"owner\":{},\"expires_at_ms\":{}}}",
                lock.owner,
                lock.expires_at_ms
            );
        }
        None => {
            let _ = body.push_str("null");
        }
    }
    let _ = body.push_str("}");
}

fn write_fixed_voltage_json(body: &mut String, enabled: bool, mv: u32) {
    if !enabled {
        return;
    }
    if !body.ends_with('[') {
        let _ = body.push(',');
    }
    let _ = core::write!(body, "{}", mv);
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

const POWER_LOCK_TTL_MS: u64 = 15_000;

pub async fn try_set_power_lock(
    api_state: &'static ApiSharedMutex,
    owner: u32,
    acquire: bool,
) -> Result<(), ApiActionError> {
    let mut guard = api_state.lock().await;
    let now = uptime_ms();
    if let Some(lock) = guard.power.lock {
        if lock.expires_at_ms <= now {
            guard.power.lock = None;
        }
    }
    if acquire {
        if guard
            .power
            .lock
            .is_some_and(|lock| lock.owner != owner && lock.expires_at_ms > now)
        {
            return Err(ApiActionError::Busy);
        }
        guard.power.lock = Some(ApiPowerLock {
            owner,
            expires_at_ms: now + POWER_LOCK_TTL_MS,
        });
    } else if guard.power.lock.is_some_and(|lock| lock.owner == owner) {
        guard.power.lock = None;
    }
    Ok(())
}

pub async fn try_set_power_config(
    api_state: &'static ApiSharedMutex,
    command: ApiPowerConfigCommand,
    owner: Option<u32>,
) -> Result<(), ApiActionError> {
    let mut guard = api_state.lock().await;
    let now = uptime_ms();
    if let Some(lock) = guard.power.lock {
        if lock.expires_at_ms <= now {
            guard.power.lock = None;
        } else if owner != Some(lock.owner) {
            return Err(ApiActionError::Busy);
        }
    }
    if guard.pending.power_config.is_some() {
        return Err(ApiActionError::Busy);
    }
    crate::reset_power_config_result();
    guard.pending.power_config = Some(command);
    Ok(())
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

    let _ = headers.push_str("Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS\r\n");
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
