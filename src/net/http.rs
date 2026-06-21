const HTTP_PORT: u16 = 80;
const HTTP_CONNECTION_TIMEOUT: Duration = Duration::from_secs(2);
const HTTP_LISTENER_POOL_SIZE: usize = 3;

#[embassy_executor::task(pool_size = 3)]
async fn http_task(
    stack: Stack<'static>,
    device_names: &'static DeviceNames,
    wifi_state: &'static WifiStateMutex,
    api_state: &'static ApiSharedMutex,
    listener_slot: u8,
) {
    let mut rx_buf = [0u8; 1024];
    let mut tx_buf = [0u8; 1024];

    info!(
        "HTTP server listener starting (port={}, slot={})",
        HTTP_PORT, listener_slot
    );

    loop {
        stack.wait_config_up().await;

        let mut socket = TcpSocket::new(stack, &mut rx_buf, &mut tx_buf);
        // Each listener owns one TCP socket. Keep the idle connection timeout short so
        // speculative browser sockets or half-open clients cannot monopolize one slot.
        socket.set_timeout(Some(HTTP_CONNECTION_TIMEOUT));

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
                warn!("HTTP accept error (slot={}): {:?}", listener_slot, err);
                Timer::after(Duration::from_millis(200)).await;
            }
        }
    }
}

pub fn spawn_http_tasks(
    spawner: &embassy_executor::Spawner,
    stack: Stack<'static>,
    device_names: &'static DeviceNames,
    wifi_state: &'static WifiStateMutex,
    api_state: &'static ApiSharedMutex,
) -> Option<()> {
    for slot in 0..HTTP_LISTENER_POOL_SIZE {
        spawner
            .spawn(http_task(
                stack,
                device_names,
                wifi_state,
                api_state,
                slot as u8,
            ))
            .ok()?;
    }
    Some(())
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
                device_names.device_id.as_str(),
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
            write_pd_diagnostics_json(&mut body, &state.pd, &state.idle_bias);
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
        ("GET", "/api/v1/power/idle-bias") => {
            let state = { *api_state.lock().await };
            let mut body = String::new();
            write_idle_bias_json(&mut body, &state.idle_bias);
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
        ("POST", "/api/v1/power/runtime") | ("PUT", "/api/v1/power/runtime") => {
            let Some(command) = parse_power_runtime_body(body) else {
                write_api_error(
                    socket,
                    "400 Bad Request",
                    allow_origin,
                    "bad_request",
                    "missing or invalid power runtime command",
                    false,
                )
                .await?;
                return Ok(());
            };
            let owner = parse_owner_query(query);
            match try_set_power_runtime(api_state, command, owner).await {
                Ok(()) => {
                    if crate::wait_power_runtime_result().await {
                        let state = { *api_state.lock().await };
                        let mut body = String::new();
                        write_power_config_json(&mut body, &state.power);
                        write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
                    } else {
                        write_api_error(
                            socket,
                            "500 Internal Server Error",
                            allow_origin,
                            "runtime_apply_failed",
                            "Power runtime command could not be applied",
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
                        "power runtime control is busy or locked",
                        true,
                    )
                    .await?;
                }
            }
            return Ok(());
        }
        ("PUT", "/api/v1/power/idle-bias") => {
            let Some(enabled) = parse_idle_bias_body(body) else {
                write_api_error(
                    socket,
                    "400 Bad Request",
                    allow_origin,
                    "bad_request",
                    "missing or invalid correction_enabled",
                    false,
                )
                .await?;
                return Ok(());
            };
            let owner = parse_owner_query(query);
            match try_set_idle_bias(
                api_state,
                ApiIdleBiasCommand::SetCorrection { enabled },
                owner,
            )
            .await
            {
                Ok(()) => {
                    if crate::wait_idle_bias_result().await {
                        let state = { *api_state.lock().await };
                        let mut body = String::new();
                        write_idle_bias_json(&mut body, &state.idle_bias);
                        write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
                    } else {
                        write_api_error(
                            socket,
                            "500 Internal Server Error",
                            allow_origin,
                            "eeprom_failed",
                            "Idle-bias correction could not be saved to EEPROM U21",
                            true,
                        )
                        .await?;
                    }
                }
                Err(ApiIdleBiasActionError::Busy) => {
                    write_api_error(
                        socket,
                        "409 Conflict",
                        allow_origin,
                        "busy",
                        "idle-bias settings are busy or locked",
                        true,
                    )
                    .await?;
                }
                Err(ApiIdleBiasActionError::DatasetMissing) => {
                    write_api_error(
                        socket,
                        "409 Conflict",
                        allow_origin,
                        "dataset_missing",
                        "Run USB-C idle-bias calibration before enabling correction",
                        false,
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
        ("POST", "/api/v1/power/idle-bias/run") => {
            let owner = parse_owner_query(query);
            match try_run_idle_bias(api_state, owner).await {
                Ok(()) => {
                    let state = { *api_state.lock().await };
                    let mut body = String::new();
                    write_idle_bias_json(&mut body, &state.idle_bias);
                    write_json_response(socket, "202 Accepted", allow_origin, body.as_str())
                        .await?;
                }
                Err(ApiActionError::Busy) => {
                    write_api_error(
                        socket,
                        "409 Conflict",
                        allow_origin,
                        "busy",
                        "idle-bias calibration is busy or locked",
                        true,
                    )
                    .await?;
                }
            }
            return Ok(());
        }
        ("POST", "/api/v1/power/idle-bias/clear") => {
            let owner = parse_owner_query(query);
            match try_set_idle_bias(api_state, ApiIdleBiasCommand::Clear, owner).await {
                Ok(()) => {
                    if crate::wait_idle_bias_result().await {
                        let state = { *api_state.lock().await };
                        let mut body = String::new();
                        write_idle_bias_json(&mut body, &state.idle_bias);
                        write_json_response(socket, "200 OK", allow_origin, body.as_str()).await?;
                    } else {
                        write_api_error(
                            socket,
                            "500 Internal Server Error",
                            allow_origin,
                            "eeprom_failed",
                            "Idle-bias dataset could not be cleared from EEPROM U21",
                            true,
                        )
                        .await?;
                    }
                }
                Err(ApiIdleBiasActionError::Busy) => {
                    write_api_error(
                        socket,
                        "409 Conflict",
                        allow_origin,
                        "busy",
                        "idle-bias settings are busy or locked",
                        true,
                    )
                    .await?;
                }
                Err(ApiIdleBiasActionError::DatasetMissing) => core::unreachable!(),
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

    if method == "POST" && path == "/api/v1/settings/reset" {
        let Some(scope) = parse_settings_reset_scope(query) else {
            write_api_error(
                socket,
                "400 Bad Request",
                allow_origin,
                "bad_request",
                "missing or invalid scope",
                false,
            )
            .await?;
            return Ok(());
        };
        if scope == "wifi" {
            write_api_error(
                socket,
                "403 Forbidden",
                allow_origin,
                "unsafe_transport",
                "Wi-Fi settings reset requires Web Serial or Local USB",
                false,
            )
            .await?;
            return Ok(());
        }

        let owner = parse_owner_query(query);
        match try_reset_settings(api_state, ApiSettingsResetScope::Other, owner).await {
            Ok(()) => match crate::wait_settings_reset_result().await {
                crate::SettingsResetResult::Complete => {
                    write_json_response(
                        socket,
                        "200 OK",
                        allow_origin,
                        "{\"accepted\":true,\"scope\":\"other\",\"wifi_preserved\":true}",
                    )
                    .await?;
                }
                crate::SettingsResetResult::Partial => {
                    write_api_error(
                            socket,
                            "500 Internal Server Error",
                            allow_origin,
                            "eeprom_failed",
                            "Non-Wi-Fi settings were partially cleared; refresh settings before retrying",
                            true,
                        )
                        .await?;
                }
                crate::SettingsResetResult::Failed => {
                    write_api_error(
                        socket,
                        "500 Internal Server Error",
                        allow_origin,
                        "eeprom_failed",
                        "Non-Wi-Fi settings could not be cleared from EEPROM U21",
                        true,
                    )
                    .await?;
                }
            },
            Err(ApiActionError::Busy) => {
                write_api_error(
                    socket,
                    "409 Conflict",
                    allow_origin,
                    "busy",
                    "settings reset is busy or locked",
                    true,
                )
                .await?;
            }
        }
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

fn parse_settings_reset_scope(query: &str) -> Option<&str> {
    for part in query.split('&') {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        if key != "scope" {
            continue;
        }
        return match value {
            "wifi" | "other" => Some(value),
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
    let light_load_mode = match extract_body_string(body, "light_load_mode")
        .unwrap_or_else(|| String::from("pfm"))
        .as_str()
    {
        "pfm" => LightLoadMode::Pfm,
        "fpwm" => LightLoadMode::Fpwm,
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
    config.light_load_mode = light_load_mode;
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
    if let Some(pps3_limit_ma) = extract_body_u16(body, "pps3_limit_ma") {
        config.capability.current.pps3_limit_ma = pps3_limit_ma;
    }
    set_bool_if_present(body, "pd_pps_5a", &mut config.capability.current.pd_pps_5a);
    if let Some(type_c_broadcast_ma) = extract_body_u16(body, "type_c_broadcast_ma") {
        config.capability.current.type_c_broadcast_ma = type_c_broadcast_ma;
    }
    if let Some(scp_limit_ma) = extract_body_u16(body, "scp_limit_ma") {
        config.capability.current.scp_limit_ma = scp_limit_ma;
    }
    if let Some(fcp_afc_sfcp_limit_ma) = extract_body_u16(body, "fcp_afc_sfcp_limit_ma") {
        config.capability.current.fcp_afc_sfcp_limit_ma = fcp_afc_sfcp_limit_ma;
    }
    set_bool_if_present(
        body,
        "qc20_20v_enabled",
        &mut config.capability.fast_charge.qc20_20v_enabled,
    );
    set_bool_if_present(
        body,
        "qc30_20v_enabled",
        &mut config.capability.fast_charge.qc30_20v_enabled,
    );
    set_bool_if_present(
        body,
        "pe20_20v_enabled",
        &mut config.capability.fast_charge.pe20_20v_enabled,
    );
    set_bool_if_present(
        body,
        "non_pd_12v_enabled",
        &mut config.capability.fast_charge.non_pd_12v_enabled,
    );
    apply_fixed_voltages_if_present(body, &mut config.capability)?;
    config.validated().ok()
}

pub fn parse_idle_bias_body(body: &str) -> Option<bool> {
    extract_body_bool(body, "correction_enabled")
}

pub fn parse_power_runtime_body(body: &str) -> Option<ApiPowerRuntimeCommand> {
    let action = extract_body_string(body, "action")?;
    let enabled = extract_body_bool(body, "enabled")?;
    match action.as_str() {
        "output" => Some(ApiPowerRuntimeCommand::SetOutputEnabled { enabled }),
        "discharge" => Some(ApiPowerRuntimeCommand::SetDischargeEnabled { enabled }),
        _ => None,
    }
}

include!("http_body_parse.inc");
include!("http_response.rs");
