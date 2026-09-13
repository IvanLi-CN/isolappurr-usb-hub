#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(5))
        .build()
        .context("build host HTTP client")?;
    let devd = DevdClient {
        endpoint: cli.ipc.clone(),
        auto_start: !cli.no_auto_start,
    };
    let value_result: anyhow::Result<Value> = async {
        Ok(match cli.command {
            Command::Discover { scan } => handle_discover(&client, &devd, scan).await?,
            Command::Devices => {
                devd_request(&client, &devd, Method::POST, "/api/v1/devices/scan", None).await?
            }
            Command::Status(selector) => {
                request_selected(&client, &devd, selector, Method::GET, "/status", None).await?
            }
            Command::Identify(selector) => {
                request_selected(&client, &devd, selector, Method::POST, "/identify", None).await?
            }
            Command::Hardware { command } => handle_hardware(&client, &devd, command).await?,
            Command::Wifi { command } => match command {
                WifiCommand::Show(selector) => {
                    request_selected(&client, &devd, selector, Method::GET, "/wifi", None).await?
                }
                WifiCommand::Set {
                    selector,
                    ssid,
                    psk,
                } => {
                    request_selected(
                        &client,
                        &devd,
                        selector,
                        Method::POST,
                        "/wifi",
                        Some(json!({"ssid": ssid, "psk": psk})),
                    )
                    .await?
                }
                WifiCommand::Clear(selector) => {
                    request_selected(&client, &devd, selector, Method::DELETE, "/wifi", None)
                        .await?
                }
            },
            Command::Settings { command } => match command {
                SettingsCommand::Name { command } => match command {
                    SettingsNameCommand::Show(selector) => {
                        let selected_device_id =
                            selected_device_id_for_name_command(&client, &devd, &selector).await?;
                        let value = request_selected(
                            &client,
                            &devd,
                            selector,
                            Method::GET,
                            "/settings/name",
                            None,
                        )
                        .await?;
                        if let (Some(device_id), Some(cache)) =
                            (selected_device_id, device_name_cache_from_mutation(&value))
                        {
                            update_device_name_cache(&device_id, cache)?;
                        }
                        value
                    }
                    SettingsNameCommand::Set { selector, name } => {
                        let selected_device_id =
                            selected_device_id_for_name_command(&client, &devd, &selector).await?;
                        let name = isolapurr_host::normalize_device_display_name(&name)?;
                        let value = request_selected(
                            &client,
                            &devd,
                            selector,
                            Method::PUT,
                            "/settings/name",
                            Some(json!({"name": name})),
                        )
                        .await?;
                        if let (Some(device_id), Some(cache)) =
                            (selected_device_id, device_name_cache_from_mutation(&value))
                        {
                            update_device_name_cache(&device_id, cache)?;
                        }
                        value
                    }
                    SettingsNameCommand::Clear(selector) => {
                        let selected_device_id =
                            selected_device_id_for_name_command(&client, &devd, &selector).await?;
                        let value = request_selected(
                            &client,
                            &devd,
                            selector,
                            Method::DELETE,
                            "/settings/name",
                            None,
                        )
                        .await?;
                        if let (Some(device_id), Some(cache)) =
                            (selected_device_id, device_name_cache_from_mutation(&value))
                        {
                            update_device_name_cache(&device_id, cache)?;
                        }
                        value
                    }
                },
                SettingsCommand::Reset {
                    selector,
                    scope,
                    yes,
                } => {
                    if !cli.json && !yes {
                        confirm_settings_reset(scope.as_str())?;
                    }
                    request_selected(
                        &client,
                        &devd,
                        selector,
                        Method::POST,
                        "/settings/reset",
                        Some(json!({"scope": scope.as_str()})),
                    )
                    .await?
                }
            },
            Command::Ports { selector, command } => {
                handle_ports(&client, &devd, selector, command).await?
            }
            Command::Flash(args) => handle_flash(&client, &devd, args).await?,
            Command::Reset(selector) => {
                let device = materialize_live_usb_device(
                    &client,
                    &devd,
                    resolve_usb_device(&selector, &devd.endpoint)?,
                )
                .await?;
                let device_devd = devd.with_endpoint(device.devd.clone());
                devd_device_post_with_lease(
                    &client,
                    &device_devd,
                    &device.device,
                    "/reset",
                    json!({}),
                )
                .await?
            }
            Command::Monitor { selector, tail } => {
                let device = materialize_live_usb_device(
                    &client,
                    &devd,
                    resolve_usb_device(&selector, &devd.endpoint)?,
                )
                .await?;
                let device_devd = devd.with_endpoint(device.devd.clone());
                devd_request(
                    &client,
                    &device_devd,
                    Method::GET,
                    &format!("/api/v1/devices/{}/session?tail={tail}", device.device),
                    None,
                )
                .await?
            }
            Command::Diagnostics { command } => match command {
                DiagnosticsCommand::Export(selector) => {
                    request_selected(&client, &devd, selector, Method::GET, "/diagnostics", None)
                        .await?
                }
            },
            Command::Power { command } => handle_power(&client, &devd, command, !cli.json).await?,
        })
    }
    .await;
    let value = match value_result {
        Ok(value) => value,
        Err(err) if err.downcast_ref::<UserCancelled>().is_some() => return Ok(()),
        Err(err) => return Err(err),
    };

    ensure_success_envelope(&value)?;
    let output = redact_sensitive(&value);
    if cli.json {
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        print_human(&output);
    }
    Ok(())
}

fn device_name_cache_from_mutation(value: &Value) -> Option<DeviceNameCache> {
    let result = value.get("result").unwrap_or(value);
    let display_name = result.get("display_name").or_else(|| {
        result
            .get("device")
            .and_then(|device| device.get("display_name"))
    })?;
    if let Some(name) = display_name.as_str() {
        return Some(DeviceNameCache::Value(name.to_string()));
    }
    display_name.is_null().then_some(DeviceNameCache::Unset)
}

fn device_id_from_info(value: &Value) -> Option<String> {
    let result = value.get("result").unwrap_or(value);
    result
        .get("device_id")
        .or_else(|| {
            result
                .get("device")
                .and_then(|device| device.get("device_id"))
        })
        .and_then(Value::as_str)
        .map(str::to_string)
}

async fn selected_device_id_for_name_command(
    client: &Client,
    devd: &DevdClient,
    selector: &ApiSelectorArgs,
) -> anyhow::Result<Option<String>> {
    if selector.device_id.is_some() {
        return Ok(selector.device_id.clone());
    }
    let info =
        request_selected(client, devd, selector.clone(), Method::GET, "/status", None).await?;
    Ok(device_id_from_info(&info))
}
