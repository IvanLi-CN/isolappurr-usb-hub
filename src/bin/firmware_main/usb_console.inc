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

    if request.contains("\"method\":\"pd.diagnostics\"")
        || request.contains("\"method\": \"pd.diagnostics\"")
        || request.contains("\"method\":\"pd.diagnostics_get\"")
        || request.contains("\"method\": \"pd.diagnostics_get\"")
    {
        let state = { *api_state.lock().await };
        let _ = write!(body, "{{\"id\":{},\"ok\":true,\"result\":", id.as_str());
        net::write_pd_diagnostics_json(&mut body, &state.pd);
        let _ = body.push('}');
        return body;
    }

    if request.contains("\"method\":\"power.config_get\"")
        || request.contains("\"method\": \"power.config_get\"")
    {
        let state = { *api_state.lock().await };
        let _ = write!(body, "{{\"id\":{},\"ok\":true,\"result\":", id.as_str());
        net::write_power_config_json(&mut body, &state.power);
        let _ = body.push('}');
        return body;
    }

    if request.contains("\"method\":\"power.config_set\"")
        || request.contains("\"method\": \"power.config_set\"")
    {
        let Some(config) = net::parse_power_config_body(request) else {
            write_jsonl_error(
                &mut body,
                id.as_str(),
                "bad_request",
                "missing or invalid power config",
                false,
            );
            return body;
        };
        let owner = extract_json_u32(request, "owner");
        match net::try_set_power_config(
            api_state,
            net::ApiPowerConfigCommand::Set { config },
            owner,
        )
        .await
        {
            Ok(()) => {
                if wait_power_config_result().await {
                    let state = { *api_state.lock().await };
                    let _ = write!(body, "{{\"id\":{},\"ok\":true,\"result\":", id.as_str());
                    net::write_power_config_json(&mut body, &state.power);
                    let _ = body.push('}');
                } else {
                    write_jsonl_error(
                        &mut body,
                        id.as_str(),
                        "eeprom_failed",
                        "Power configuration could not be saved to EEPROM U21",
                        true,
                    );
                }
            }
            Err(net::ApiActionError::Busy) => {
                write_jsonl_error(
                    &mut body,
                    id.as_str(),
                    "busy",
                    "power configuration is busy or locked",
                    true,
                );
            }
        }
        return body;
    }

    if request.contains("\"method\":\"power.config_defaults\"")
        || request.contains("\"method\": \"power.config_defaults\"")
    {
        let owner = extract_json_u32(request, "owner");
        match net::try_set_power_config(api_state, net::ApiPowerConfigCommand::Defaults, owner)
            .await
        {
            Ok(()) => {
                if wait_power_config_result().await {
                    let state = { *api_state.lock().await };
                    let _ = write!(body, "{{\"id\":{},\"ok\":true,\"result\":", id.as_str());
                    net::write_power_config_json(&mut body, &state.power);
                    let _ = body.push('}');
                } else {
                    write_jsonl_error(
                        &mut body,
                        id.as_str(),
                        "eeprom_failed",
                        "Power defaults could not be saved to EEPROM U21",
                        true,
                    );
                }
            }
            Err(net::ApiActionError::Busy) => {
                write_jsonl_error(
                    &mut body,
                    id.as_str(),
                    "busy",
                    "power configuration is busy or locked",
                    true,
                );
            }
        }
        return body;
    }

    if request.contains("\"method\":\"power.lock\"")
        || request.contains("\"method\": \"power.lock\"")
    {
        let Some(owner) = extract_json_u32(request, "owner") else {
            write_jsonl_error(&mut body, id.as_str(), "bad_request", "missing owner", false);
            return body;
        };
        let acquire = extract_json_bool(request, "acquire").unwrap_or(true);
        match net::try_set_power_lock(api_state, owner, acquire).await {
            Ok(()) => {
                let state = { *api_state.lock().await };
                let _ = write!(body, "{{\"id\":{},\"ok\":true,\"result\":", id.as_str());
                net::write_power_config_json(&mut body, &state.power);
                let _ = body.push('}');
            }
            Err(net::ApiActionError::Busy) => {
                write_jsonl_error(
                    &mut body,
                    id.as_str(),
                    "busy",
                    "power configuration lock is owned by another host",
                    true,
                );
            }
        }
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

    if request.contains("\"method\":\"settings.reset\"")
        || request.contains("\"method\": \"settings.reset\"")
    {
        let Some(scope) = extract_json_string(request, "scope") else {
            write_jsonl_error(&mut body, id.as_str(), "bad_request", "missing scope", false);
            return body;
        };

        match scope.as_str() {
            "wifi" => {
                if enqueue_wifi_provisioning(WifiProvisioningCommand::Clear).is_ok() {
                    if wait_wifi_provisioning_result().await {
                        let _ = write!(
                            body,
                            "{{\"id\":{},\"ok\":true,\"result\":{{\"accepted\":true,\"scope\":\"wifi\",\"reboot_required\":false}}}}",
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
            }
            "other" => {
                let owner = extract_json_u32(request, "owner");
                match net::try_reset_settings(api_state, net::ApiSettingsResetScope::Other, owner)
                    .await
                {
                    Ok(()) => {
                        match wait_settings_reset_result().await {
                            SettingsResetResult::Complete => {
                                let _ = write!(
                                    body,
                                    "{{\"id\":{},\"ok\":true,\"result\":{{\"accepted\":true,\"scope\":\"other\",\"wifi_preserved\":true}}}}",
                                    id.as_str()
                                );
                            }
                            SettingsResetResult::Partial => {
                                write_jsonl_error(
                                    &mut body,
                                    id.as_str(),
                                    "eeprom_failed",
                                    "non-Wi-Fi settings were partially cleared; refresh settings before retrying",
                                    true,
                                );
                            }
                            SettingsResetResult::Failed => {
                                write_jsonl_error(
                                    &mut body,
                                    id.as_str(),
                                    "eeprom_failed",
                                    "non-Wi-Fi settings could not be cleared from EEPROM U21",
                                    true,
                                );
                            }
                        }
                    }
                    Err(net::ApiActionError::Busy) => {
                        write_jsonl_error(
                            &mut body,
                            id.as_str(),
                            "busy",
                            "settings reset is busy or locked",
                            true,
                        );
                    }
                }
            }
            _ => write_jsonl_error(
                &mut body,
                id.as_str(),
                "bad_request",
                "scope must be wifi or other",
                false,
            ),
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
pub(crate) async fn wait_power_config_result() -> bool {
    POWER_CONFIG_RESULT.wait().await
}

#[cfg(feature = "net_http")]
pub(crate) fn reset_power_config_result() {
    POWER_CONFIG_RESULT.reset();
}

#[cfg(feature = "net_http")]
pub(crate) async fn wait_settings_reset_result() -> SettingsResetResult {
    SETTINGS_RESET_RESULT.wait().await
}

#[cfg(feature = "net_http")]
pub(crate) fn reset_settings_reset_result() {
    SETTINGS_RESET_RESULT.reset();
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
fn extract_json_u32(request: &str, key: &str) -> Option<u32> {
    let rest = json_value_after_key(request, key)?;
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
        release_version(),
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
