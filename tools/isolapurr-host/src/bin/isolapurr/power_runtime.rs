async fn fetch_power_config(
    client: &Client,
    devd: &DevdClient,
    selector: &ApiSelectorArgs,
) -> anyhow::Result<CliPowerConfig> {
    let current = request_selected(
        client,
        devd,
        selector.clone(),
        Method::GET,
        "/power/config",
        None,
    )
    .await?;
    Ok(serde_json::from_value(unwrap_device_success_result(
        current,
    )?)?)
}

async fn fetch_power_diagnostics(
    client: &Client,
    devd: &DevdClient,
    selector: &ApiSelectorArgs,
) -> anyhow::Result<CliPowerDiagnostics> {
    let current = request_selected(
        client,
        devd,
        selector.clone(),
        Method::GET,
        "/diagnostics",
        None,
    )
    .await?;
    Ok(serde_json::from_value(unwrap_device_success_result(
        current,
    )?)?)
}

async fn fetch_power_idle_bias(
    client: &Client,
    devd: &DevdClient,
    selector: &ApiSelectorArgs,
) -> anyhow::Result<CliIdleBias> {
    let current = request_selected(
        client,
        devd,
        selector.clone(),
        Method::GET,
        "/power/idle-bias",
        None,
    )
    .await?;
    Ok(serde_json::from_value(unwrap_device_success_result(
        current,
    )?)?)
}

async fn fetch_ports_snapshot(
    client: &Client,
    devd: &DevdClient,
    selector: &ApiSelectorArgs,
) -> anyhow::Result<CliPortsResponse> {
    let current =
        request_selected(client, devd, selector.clone(), Method::GET, "/ports", None).await?;
    Ok(serde_json::from_value(unwrap_device_success_result(
        current,
    )?)?)
}

async fn set_power_runtime_command(
    client: &Client,
    devd: &DevdClient,
    selector: &ApiSelectorArgs,
    owner: u32,
    action: &str,
    enabled: bool,
) -> anyhow::Result<Value> {
    unwrap_device_success_result(
        request_selected(
            client,
            devd,
            selector.clone(),
            Method::PUT,
            &format!("/power/runtime?owner={owner}"),
            Some(json!({
                "action": action,
                "enabled": enabled,
            })),
        )
        .await?,
    )
}

async fn wait_for_idle_bias_completion(
    client: &Client,
    devd: &DevdClient,
    selector: &ApiSelectorArgs,
) -> anyhow::Result<CliIdleBias> {
    const IDLE_BIAS_PROGRESS_TIMEOUT: Duration = Duration::from_secs(30);

    let started_at = Instant::now();
    let mut progress_deadline = started_at + IDLE_BIAS_PROGRESS_TIMEOUT;
    let mut last_completed_points = None;
    let mut last_target_voltage_mv = None;

    loop {
        let snapshot = fetch_power_idle_bias(client, devd, selector).await?;
        let point_count = snapshot.run.point_count;
        if finalize_idle_bias_snapshot(&snapshot)? {
            return Ok(snapshot);
        }
        let progress_changed = last_completed_points != Some(snapshot.run.completed_points)
            || last_target_voltage_mv != snapshot.run.target_voltage_mv;
        if progress_changed {
            last_completed_points = Some(snapshot.run.completed_points);
            last_target_voltage_mv = snapshot.run.target_voltage_mv;
            progress_deadline = Instant::now() + IDLE_BIAS_PROGRESS_TIMEOUT;
        }

        let now = Instant::now();
        if now >= progress_deadline
            || now.duration_since(started_at) >= idle_bias_total_timeout(point_count)
        {
            return Err(anyhow!("idle-bias calibration timed out"));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

fn idle_bias_total_timeout(point_count: u8) -> Duration {
    const IDLE_BIAS_POINT_BUDGET: Duration = Duration::from_secs(4);
    const IDLE_BIAS_TOTAL_TIMEOUT_PADDING: Duration = Duration::from_secs(30);

    IDLE_BIAS_POINT_BUDGET
        .saturating_mul(u32::from(point_count.max(1)))
        .saturating_add(IDLE_BIAS_TOTAL_TIMEOUT_PADDING)
}

fn finalize_idle_bias_snapshot(snapshot: &CliIdleBias) -> anyhow::Result<bool> {
    match snapshot.run.state.as_str() {
        "running" => Ok(false),
        "failed" => {
            let detail = snapshot
                .run
                .error
                .as_ref()
                .map(|error| format!("{}: {}", error.code, error.message))
                .unwrap_or_else(|| "unknown error".to_string());
            Err(anyhow!("idle-bias calibration failed: {detail}"))
        }
        _ => Ok(true),
    }
}

fn saved_hardware_target_label(device: &DeviceProfile) -> String {
    let target = if let Some(base_url) = device.http_base_url() {
        format!("http {base_url}")
    } else if let Some(port_path) = device.local_usb_port_path() {
        format!("usb {port_path}")
    } else if let Some(label) = device.web_serial_label() {
        format!("web-serial {label}")
    } else {
        "unlinked".to_string()
    };
    format!("{} ({}) - {}", device.name, device.id, target)
}

fn power_selector_to_api_selector(selector: PowerSelectorArgs) -> ApiSelectorArgs {
    ApiSelectorArgs {
        device_id: selector.device_id,
        url: selector.url,
    }
}

fn canonical_device_id_from_status(value: &Value) -> Option<String> {
    value
        .get("device")
        .or_else(|| value.get("result").and_then(|result| result.get("device")))
        .and_then(|device| device.get("device_id").or_else(|| device.get("deviceId")))
        .and_then(Value::as_str)
        .and_then(canonical_device_id_candidate)
}

async fn request_live_usb_status(
    client: &Client,
    devd: &DevdClient,
    live_device_id: &str,
) -> anyhow::Result<Value> {
    devd_request(
        client,
        devd,
        Method::GET,
        &format!("/api/v1/devices/{live_device_id}/status"),
        None,
    )
    .await
}

#[derive(Clone)]
struct PowerTargetCandidate {
    hardware: DeviceProfile,
    verify_http_after_select: bool,
}

async fn finalize_power_target_candidate(
    client: &Client,
    devd: &DevdClient,
    candidate: PowerTargetCandidate,
) -> anyhow::Result<ApiSelectorArgs> {
    let selector = ApiSelectorArgs {
        device_id: Some(candidate.hardware.id.clone()),
        url: None,
    };
    if candidate.verify_http_after_select {
        request_selected(client, devd, selector.clone(), Method::GET, "/status", None)
            .await
            .with_context(|| {
                format!(
                    "saved LAN device {} is not reachable right now",
                    candidate.hardware.id
                )
            })?;
    }
    Ok(selector)
}

async fn collect_scanned_saved_usb_power_targets(
    client: &Client,
    devd: &DevdClient,
    saved: &[DeviceProfile],
) -> anyhow::Result<Vec<DeviceProfile>> {
    let scanned = devd_request(client, devd, Method::POST, "/api/v1/devices/scan", None).await?;
    let devices = scanned
        .get("devices")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("device scan returned no device list"))?
        .iter()
        .cloned()
        .map(serde_json::from_value::<DeviceRecord>)
        .collect::<Result<Vec<_>, _>>()?;

    let mut matched = Vec::new();
    for device in devices {
        let Some(_usb) = &device.usb else {
            continue;
        };
        if request_live_usb_status(client, devd, &device.id)
            .await
            .is_err()
        {
            continue;
        }
        if let Some(saved_device) = saved.iter().find(|saved_device| {
            saved_device
                .local_usb_port_path()
                .zip(device.usb.as_ref().map(|usb| usb.port_path.as_str()))
                .is_some_and(|(saved_path, live_path)| saved_path == live_path)
        }) {
            matched.push(saved_device.clone());
        }
    }
    Ok(matched)
}

async fn select_saved_power_target_interactively(
    client: &Client,
    devd: &DevdClient,
    selector: PowerSelectorArgs,
) -> anyhow::Result<ApiSelectorArgs> {
    if !selector.is_empty() {
        return Ok(power_selector_to_api_selector(selector));
    }
    if !io::stdin().is_terminal() {
        return Err(anyhow!(
            "select --device-id; interactive power target selection requires a terminal"
        ));
    }

    let mut saved = read_hardware_registry()?.devices;
    saved.retain(|device| {
        device.http_base_url().is_some() || device.local_usb_port_path().is_some()
    });
    saved.sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));

    if saved.is_empty() {
        return Err(anyhow!(
            "no saved device is available; save a device first with `isolapurr hardware save --device-id ...`"
        ));
    }

    let lan_candidates = saved
        .iter()
        .filter(|device| device.http_base_url().is_some())
        .cloned()
        .map(|hardware| PowerTargetCandidate {
            hardware,
            verify_http_after_select: true,
        });
    let usb_candidates = collect_scanned_saved_usb_power_targets(client, devd, &saved)
        .await?
        .into_iter()
        .map(|hardware| PowerTargetCandidate {
            hardware,
            verify_http_after_select: false,
        });
    let mut candidates = lan_candidates.chain(usb_candidates).collect::<Vec<_>>();

    if candidates.is_empty() {
        return Err(anyhow!(
            "no power-control target is available; save a LAN target or connect a saved USB target so it appears in the current scan"
        ));
    }

    if candidates.len() == 1 {
        return finalize_power_target_candidate(client, devd, candidates.remove(0)).await;
    }

    let items = candidates
        .iter()
        .map(|candidate| saved_hardware_target_label(&candidate.hardware))
        .collect::<Vec<_>>();
    let selected = run_tui_list_menu(
        "Select saved device for power control",
        Some(
            "Saved LAN devices are listed first. Saved USB devices appear only after the current scan sees the saved port_path online. Use Up/Down to move, Enter to select, Esc to cancel.",
        ),
        &items,
        &[],
    )?;
    let Some(selected) = selected else {
        return Err(UserCancelled.into());
    };
    finalize_power_target_candidate(client, devd, candidates.swap_remove(selected)).await
}

async fn select_api_target_interactively(
    client: &Client,
    devd: &DevdClient,
    selector: ApiSelectorArgs,
) -> anyhow::Result<ApiSelectorArgs> {
    if !selector.is_empty() {
        return Ok(selector);
    }
    if !io::stdin().is_terminal() {
        return Err(anyhow!(
            "select one of --device-id or --url; interactive device selection requires a terminal"
        ));
    }

    let scanned = devd_request(client, devd, Method::POST, "/api/v1/devices/scan", None).await?;
    let devices = scanned
        .get("devices")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("device scan returned no device list"))?
        .iter()
        .cloned()
        .map(serde_json::from_value::<DeviceRecord>)
        .collect::<Result<Vec<_>, _>>()?;

    if devices.is_empty() {
        return Err(anyhow!(
            "no devd devices found; connect hardware or pass --device-id/--url explicitly"
        ));
    }

    let mut compatible = Vec::new();
    let mut rejected = Vec::new();
    for device in devices {
        match request_live_usb_status(client, devd, &device.id).await {
            Ok(status) => {
                if let Some(device_id) = canonical_device_id_from_status(&status) {
                    compatible.push((
                        device,
                        ApiSelectorArgs {
                            device_id: Some(device_id),
                            url: None,
                        },
                    ));
                } else {
                    rejected.push(format!(
                        "{} ({}) - status did not include canonical device_id",
                        device.display_name, device.id
                    ));
                }
            }
            Err(err) => rejected.push(format!("{} ({}) - {}", device.display_name, device.id, err)),
        }
    }

    if compatible.is_empty() {
        let mut message =
            String::from("no compatible IsolaPurr devices were found in the current scan");
        if !rejected.is_empty() {
            message.push_str(":\n");
            message.push_str(&rejected.join("\n"));
        }
        return Err(anyhow!(message));
    }

    if compatible.len() == 1 {
        return Ok(compatible.remove(0).1);
    }

    let items = compatible
        .iter()
        .map(|(device, _selector)| {
            let target = if let Some(usb) = &device.usb {
                format!("usb {}", usb.port_path)
            } else if let Some(http) = &device.http {
                format!("http {}", http.base_url)
            } else {
                device.connection.clone()
            };
            format!("{} ({}) - {}", device.display_name, device.id, target)
        })
        .collect::<Vec<_>>();
    let selected = run_tui_list_menu(
        "Select a device for source-capability editing",
        Some(
            "Only compatible IsolaPurr devices are shown. Use Up/Down to move, Enter to select, Esc to cancel.",
        ),
        &items,
        &[],
    )?;
    let Some(selected) = selected else {
        return Err(UserCancelled.into());
    };
    Ok(compatible.swap_remove(selected).1)
}

async fn run_source_capability_interactive(
    client: &Client,
    devd: &DevdClient,
    selector: ApiSelectorArgs,
) -> anyhow::Result<Value> {
    if !io::stdin().is_terminal() {
        return Err(anyhow!(
            "interactive source-capability editing requires a terminal; pass flags for non-interactive use"
        ));
    }

    let selector = select_api_target_interactively(client, devd, selector).await?;
    let mut config = fetch_power_config(client, devd, &selector).await?;
    let mut diagnostics = fetch_power_diagnostics(client, devd, &selector).await?;

    loop {
        let status = format_live_power_output(&serde_json::to_value(&diagnostics)?);
        match run_source_capability_editor_tui(&mut config, status.trim_end())? {
            EditorSubmit::Continue => continue,
            EditorSubmit::Save => {
                let owner = next_power_owner();
                return save_power_config_with_timeout_recovery(
                    client, devd, &selector, owner, &config,
                )
                .await;
            }
            EditorSubmit::Reload => {
                config = fetch_power_config(client, devd, &selector).await?;
                diagnostics = fetch_power_diagnostics(client, devd, &selector).await?;
            }
            EditorSubmit::Cancel => return Err(UserCancelled.into()),
        }
    }
}

async fn handle_power(
    client: &Client,
    devd: &DevdClient,
    command: PowerCommand,
    allow_interactive: bool,
) -> anyhow::Result<Value> {
    match command {
        PowerCommand::Show(selector) => {
            let selector =
                maybe_select_power_target(client, devd, selector, allow_interactive).await?;
            let config = serde_json::to_value(fetch_power_config(client, devd, &selector).await?)?;
            let diagnostics =
                serde_json::to_value(fetch_power_diagnostics(client, devd, &selector).await?)?;
            let ports = serde_json::to_value(fetch_ports_snapshot(client, devd, &selector).await?)?;
            Ok(json!({
                "config": config,
                "diagnostics": diagnostics,
                "ports": ports,
            }))
        }
        PowerCommand::Config { command } => match command {
            PowerConfigCommand::Show { selector } => {
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                Ok(serde_json::to_value(
                    fetch_power_config(client, devd, &selector).await?,
                )?)
            }
            PowerConfigCommand::Set { selector, args } => {
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                if !args.has_updates() {
                    return Err(anyhow!(
                        "power config set requires at least one update flag"
                    ));
                }
                let owner = next_power_owner();
                let mut config = fetch_power_config(client, devd, &selector).await?;
                apply_power_config_set_args(&mut config, &args)?;
                unwrap_device_success_result(
                    save_power_config_with_timeout_recovery(
                        client, devd, &selector, owner, &config,
                    )
                    .await?,
                )
            }
        },
        PowerCommand::IdleBias { command } => match command {
            IdleBiasCommand::Show { selector } => {
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                Ok(serde_json::to_value(
                    fetch_power_idle_bias(client, devd, &selector).await?,
                )?)
            }
            IdleBiasCommand::Run { selector, yes } => {
                if !allow_interactive && !yes {
                    return Err(anyhow!(
                        "idle-bias calibration requires --yes when --json is set"
                    ));
                }
                if allow_interactive && !yes {
                    confirm_idle_bias_action("run")?;
                }
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                let owner = next_power_owner();
                let started = request_selected(
                    client,
                    devd,
                    selector.clone(),
                    Method::POST,
                    &format!("/power/idle-bias/run?owner={owner}"),
                    None,
                )
                .await?;
                let _ = unwrap_device_success_result(started)?;
                Ok(serde_json::to_value(
                    wait_for_idle_bias_completion(client, devd, &selector).await?,
                )?)
            }
            IdleBiasCommand::Clear { selector, yes } => {
                if !allow_interactive && !yes {
                    return Err(anyhow!("idle-bias clear requires --yes when --json is set"));
                }
                if allow_interactive && !yes {
                    confirm_idle_bias_action("clear")?;
                }
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                let owner = next_power_owner();
                unwrap_device_success_result(
                    request_selected(
                        client,
                        devd,
                        selector,
                        Method::POST,
                        &format!("/power/idle-bias/clear?owner={owner}"),
                        None,
                    )
                    .await?,
                )
            }
            IdleBiasCommand::Set {
                selector,
                enabled,
                yes,
            } => {
                if !allow_interactive && !yes {
                    return Err(anyhow!(
                        "idle-bias correction changes require --yes when --json is set"
                    ));
                }
                if allow_interactive && !yes {
                    confirm_idle_bias_action(if enabled {
                        "set-enabled"
                    } else {
                        "set-disabled"
                    })?;
                }
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                let owner = next_power_owner();
                unwrap_device_success_result(
                    request_selected(
                        client,
                        devd,
                        selector,
                        Method::PUT,
                        &format!("/power/idle-bias?owner={owner}"),
                        Some(json!({"correction_enabled": enabled})),
                    )
                    .await?,
                )
            }
        },
        PowerCommand::Defaults { selector } => {
            let selector =
                maybe_select_power_target(client, devd, selector, allow_interactive).await?;
            let owner = next_power_owner();
            unwrap_device_success_result(
                restore_power_defaults_with_timeout_recovery(client, devd, &selector, owner)
                    .await?,
            )
        }
        PowerCommand::Runtime { command } => match command {
            RuntimeCommand::Output { selector, enabled } => {
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                let owner = next_power_owner();
                set_power_runtime_command(client, devd, &selector, owner, "output", enabled).await
            }
            RuntimeCommand::Discharge { selector, enabled } => {
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                let owner = next_power_owner();
                set_power_runtime_command(client, devd, &selector, owner, "discharge", enabled)
                    .await
            }
        },
        PowerCommand::Output { command } => match command {
            OutputCommand::Manual { selector, args } => {
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                let owner = next_power_owner();
                let mut config = fetch_power_config(client, devd, &selector).await?;
                config.tps_mode = "manual".to_string();
                apply_manual_output_args(&mut config, &args);
                unwrap_device_success_result(
                    save_power_config_with_timeout_recovery(
                        client, devd, &selector, owner, &config,
                    )
                    .await?,
                )
            }
            OutputCommand::Auto { selector } => {
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                let owner = next_power_owner();
                let mut config = fetch_power_config(client, devd, &selector).await?;
                config.tps_mode = "auto_follow".to_string();
                unwrap_device_success_result(
                    save_power_config_with_timeout_recovery(
                        client, devd, &selector, owner, &config,
                    )
                    .await?,
                )
            }
        },
        PowerCommand::SourceCapability { command } => match command {
            SourceCapabilityCommand::Set { selector, args } => {
                let selector =
                    maybe_select_power_target(client, devd, selector, allow_interactive).await?;
                if !args.has_updates() {
                    if !allow_interactive {
                        return Err(anyhow!(
                            "interactive source-capability editing is unavailable with --json; pass one or more update flags"
                        ));
                    }
                    return run_source_capability_interactive(client, devd, selector).await;
                }
                let owner = next_power_owner();
                let mut config = fetch_power_config(client, devd, &selector).await?;
                apply_source_capability_args(&mut config, &args)?;
                unwrap_device_success_result(
                    save_power_config_with_timeout_recovery(
                        client, devd, &selector, owner, &config,
                    )
                    .await?,
                )
            }
        },
    }
}

async fn maybe_select_power_target(
    client: &Client,
    devd: &DevdClient,
    selector: PowerSelectorArgs,
    allow_interactive: bool,
) -> anyhow::Result<ApiSelectorArgs> {
    if selector.selection_count() > 1 {
        return Err(anyhow!("select exactly one of --device-id or --url"));
    }
    if allow_interactive {
        select_saved_power_target_interactively(client, devd, selector).await
    } else {
        Ok(power_selector_to_api_selector(selector))
    }
}
