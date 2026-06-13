#[derive(Clone)]
struct ResolvedUsb {
    device: String,
    devd: String,
    identity: Option<DeviceIdentity>,
}

enum ResolvedTarget {
    Usb(ResolvedUsb),
    Http(String),
}

fn resolve_api_selector(
    selector: ApiSelectorArgs,
    default_devd: &str,
) -> anyhow::Result<ResolvedTarget> {
    let count = selector.selection_count();
    if count != 1 {
        return Err(anyhow!("select exactly one of --device-id or --url"));
    }
    if let Some(url) = selector.url {
        return Ok(ResolvedTarget::Http(url));
    }
    let device_id = selector.device_id.expect("count checked");
    let saved_device = find_saved_device(&device_id).ok();
    if let Some(base_url) = saved_device
        .as_ref()
        .and_then(|device| device.http_base_url().map(str::to_string))
    {
        return Ok(ResolvedTarget::Http(base_url));
    }
    let resolved = resolve_saved_or_live_usb(&device_id, saved_device, default_devd)?;
    Ok(ResolvedTarget::Usb(resolved))
}

fn resolve_usb_device(
    selector: &UsbSelectorArgs,
    default_devd: &str,
) -> anyhow::Result<ResolvedUsb> {
    if selector.device_id.is_some() == selector.port_path.is_some() {
        return Err(anyhow!(
            "select exactly one of --device-id or --port-path for Local USB"
        ));
    }
    if let Some(port_path) = selector.port_path.clone() {
        return Ok(ResolvedUsb {
            device: stable_usb_device_id(&port_path),
            devd: default_devd.to_string(),
            identity: None,
        });
    }
    let device_id = selector.device_id.clone().expect("checked");
    let saved_device = find_saved_device(&device_id).ok();
    resolve_saved_or_live_usb(&device_id, saved_device, default_devd)
}

fn find_saved_device(id: &str) -> anyhow::Result<DeviceProfile> {
    read_hardware_registry()?
        .devices
        .into_iter()
        .find(|device| device.id == id)
        .ok_or_else(|| anyhow!("saved device not found: {id}"))
}

fn resolve_saved_or_live_usb(
    device_id: &str,
    saved_device: Option<DeviceProfile>,
    default_devd: &str,
) -> anyhow::Result<ResolvedUsb> {
    let identity = saved_device
        .as_ref()
        .and_then(|device| device.identity.clone());
    let port_path = saved_device
        .as_ref()
        .and_then(|device| device.local_usb_port_path().map(str::to_string));
    let Some(live_target) = port_path
        .as_deref()
        .map(stable_usb_device_id)
        .or_else(|| canonical_device_id_candidate(device_id))
    else {
        return Err(anyhow!(
            "saved device {device_id} has no Local USB port_path; use --port-path for Local USB operations"
        ));
    };
    Ok(ResolvedUsb {
        device: live_target,
        devd: default_devd.to_string(),
        identity,
    })
}

async fn devd_request(
    _client: &Client,
    devd: &DevdClient,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> anyhow::Result<Value> {
    let (ipc_method, params) = map_devd_ipc_endpoint(method, path, body)?;
    devd_ipc_call(devd, &ipc_method, params).await
}

async fn devd_ipc_call(devd: &DevdClient, method: &str, params: Value) -> anyhow::Result<Value> {
    match ipc_call(&devd.endpoint, method, params.clone()).await {
        Ok(value) => Ok(value),
        Err(err) if devd.auto_start && looks_like_ipc_connect_error(&err) => {
            start_devd(&devd.endpoint)?;
            wait_for_devd(&devd.endpoint, method, params).await
        }
        Err(err) => Err(err),
    }
}

fn looks_like_ipc_connect_error(err: &anyhow::Error) -> bool {
    err.to_string().contains("connect IPC")
}

fn start_devd(endpoint: &str) -> anyhow::Result<()> {
    let devd_bin = std::env::var_os("ISOLAPURR_DEVD_BIN")
        .map(PathBuf::from)
        .or_else(|| {
            let mut path = std::env::current_exe().ok()?;
            let suffix = std::env::consts::EXE_SUFFIX;
            path.set_file_name(format!("isolapurr-devd{suffix}"));
            Some(path)
        })
        .ok_or_else(|| anyhow!("cannot resolve isolapurr-devd path"))?;
    if !devd_bin.is_file() {
        return Err(anyhow!(
            "isolapurr-devd was not found next to isolapurr; run `just host-tools-build` or set ISOLAPURR_DEVD_BIN"
        ));
    }
    ProcessCommand::new(devd_bin)
        .arg("serve")
        .arg("--endpoint")
        .arg(endpoint)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("start isolapurr-devd IPC daemon")?;
    Ok(())
}

async fn wait_for_devd(endpoint: &str, method: &str, params: Value) -> anyhow::Result<Value> {
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut last_error = None;
    while Instant::now() < deadline {
        match ipc_call(endpoint, method, params.clone()).await {
            Ok(value) => return Ok(value),
            Err(err) => {
                last_error = Some(err);
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("isolapurr-devd IPC daemon did not start")))
}

fn map_devd_ipc_endpoint(
    method: Method,
    path: &str,
    body: Option<Value>,
) -> anyhow::Result<(String, Value)> {
    let (path_only, query) = path.split_once('?').unwrap_or((path, ""));
    if method == Method::GET && path_only == "/api/v1/devices" {
        return Ok(("devices.list".to_string(), json!({})));
    }
    if method == Method::POST && path_only == "/api/v1/devices/scan" {
        return Ok(("devices.scan".to_string(), json!({})));
    }
    if method == Method::POST && path_only == "/api/v1/serial/lease" {
        return Ok((
            "serial.lease.create".to_string(),
            body.unwrap_or_else(|| json!({})),
        ));
    }
    if method == Method::DELETE
        && let Some(lease_id) = path_only.strip_prefix("/api/v1/serial/lease/")
    {
        return Ok((
            "serial.lease.release".to_string(),
            json!({"lease_id": lease_id}),
        ));
    }
    let Some(rest) = path_only.strip_prefix("/api/v1/devices/") else {
        return Err(anyhow!("unsupported devd IPC endpoint: {method} {path}"));
    };
    let (device_id, suffix) = rest
        .split_once('/')
        .ok_or_else(|| anyhow!("invalid devd device path: {path}"))?;
    let mut params = json!({"device_id": device_id});
    let params_map = params.as_object_mut().expect("object");

    let ipc_method = match (method.as_str(), suffix) {
        ("GET", "status") => "device.status",
        ("GET", "wifi") => "device.wifi.get",
        ("POST", "wifi") => {
            merge_body(params_map, body);
            "device.wifi.set"
        }
        ("DELETE", "wifi") => "device.wifi.clear",
        ("POST", "settings/reset") => {
            merge_body(params_map, body);
            "device.settings.reset"
        }
        ("GET", "ports") => "device.ports.get",
        ("GET", "power/config") => "device.power.config_get",
        ("PUT", "power/config") => {
            let config = body.ok_or_else(|| anyhow!("power config body is required"))?;
            params_map.insert("config".to_string(), config);
            if let Some(owner) = query
                .split('&')
                .find_map(|part| part.strip_prefix("owner="))
                .and_then(|owner| owner.parse::<u32>().ok())
            {
                params_map.insert("owner".to_string(), json!(owner));
            }
            "device.power.config_set"
        }
        ("POST", "power/config/defaults") => {
            if let Some(owner) = query
                .split('&')
                .find_map(|part| part.strip_prefix("owner="))
                .and_then(|owner| owner.parse::<u32>().ok())
            {
                params_map.insert("owner".to_string(), json!(owner));
            }
            "device.power.config_defaults"
        }
        ("POST", "power/config/lock") => {
            let owner = query
                .split('&')
                .find_map(|part| part.strip_prefix("owner="))
                .ok_or_else(|| anyhow!("owner query is required"))?
                .parse::<u32>()
                .context("owner must be a non-zero integer")?;
            params_map.insert("owner".to_string(), json!(owner));
            params_map.insert("acquire".to_string(), json!(true));
            "device.power.lock"
        }
        ("POST", "power/config/release") => {
            let owner = query
                .split('&')
                .find_map(|part| part.strip_prefix("owner="))
                .ok_or_else(|| anyhow!("owner query is required"))?
                .parse::<u32>()
                .context("owner must be a non-zero integer")?;
            params_map.insert("owner".to_string(), json!(owner));
            params_map.insert("acquire".to_string(), json!(false));
            "device.power.lock"
        }
        ("GET", "session") => {
            if let Some(tail) = query
                .split('&')
                .find_map(|part| part.strip_prefix("tail="))
                .and_then(|tail| tail.parse::<usize>().ok())
            {
                params_map.insert("tail".to_string(), json!(tail));
            }
            "device.session"
        }
        ("POST", "hub/route") => {
            merge_body(params_map, body);
            "device.hub.route_set"
        }
        ("POST", "flash") => {
            merge_body(params_map, body);
            "device.flash"
        }
        ("POST", "reset") => {
            merge_body(params_map, body);
            "device.reset"
        }
        ("GET", "diagnostics") => "device.diagnostics",
        ("POST", _) if suffix.starts_with("ports/") && suffix.ends_with("/replug") => {
            let port = suffix
                .trim_start_matches("ports/")
                .trim_end_matches("/replug");
            params_map.insert("port".to_string(), json!(port));
            "device.port.replug"
        }
        ("POST", _) if suffix.starts_with("ports/") && suffix.contains("/power") => {
            let port = suffix
                .trim_start_matches("ports/")
                .trim_end_matches("/power");
            let enabled = query
                .split('&')
                .find_map(|part| part.strip_prefix("enabled="))
                .ok_or_else(|| anyhow!("enabled query is required"))?
                .parse::<bool>()
                .context("enabled must be a boolean")?;
            params_map.insert("port".to_string(), json!(port));
            params_map.insert("enabled".to_string(), json!(enabled));
            "device.port.power"
        }
        _ => return Err(anyhow!("unsupported devd IPC endpoint: {method} {path}")),
    };
    Ok((ipc_method.to_string(), params))
}

fn merge_body(target: &mut serde_json::Map<String, Value>, body: Option<Value>) {
    if let Some(Value::Object(map)) = body {
        target.extend(map);
    }
}

async fn request_selected(
    client: &Client,
    devd: &DevdClient,
    selector: ApiSelectorArgs,
    method: Method,
    suffix: &str,
    body: Option<Value>,
) -> anyhow::Result<Value> {
    let selected = resolve_api_selector(selector, &devd.endpoint)?;
    match selected {
        ResolvedTarget::Usb(usb) => {
            let usb_devd = devd.with_endpoint(usb.devd.clone());
            let usb = materialize_live_usb_device(client, &usb_devd, usb).await?;
            devd_request(
                client,
                &usb_devd,
                method,
                &format!("/api/v1/devices/{}{}", usb.device, suffix),
                body,
            )
            .await
        }
        ResolvedTarget::Http(url) => {
            let (http_method, path, http_body) = map_http_endpoint(method, suffix, body)?;
            let mut request = client.request(http_method, api_url(&url, &path)?);
            if let Some(body) = http_body {
                request = request.json(&body);
            }
            Ok(request
                .send()
                .await?
                .error_for_status()?
                .json::<Value>()
                .await?)
        }
    }
}

fn map_http_endpoint(
    method: Method,
    suffix: &str,
    body: Option<Value>,
) -> anyhow::Result<(Method, String, Option<Value>)> {
    let mapped = match (method.as_str(), suffix) {
        ("GET", "/status") => (method, "/api/v1/info".to_string(), body),
        ("GET", "/wifi") => (method, "/api/v1/wifi".to_string(), body),
        ("POST", "/wifi") => (Method::POST, "/api/v1/wifi/set".to_string(), body),
        ("DELETE", "/wifi") => (Method::POST, "/api/v1/wifi/clear".to_string(), body),
        ("POST", "/settings/reset") => {
            let scope = body
                .as_ref()
                .and_then(|body| body.get("scope"))
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("scope is required"))?;
            let owner = body
                .as_ref()
                .and_then(|body| body.get("owner"))
                .and_then(Value::as_u64)
                .filter(|owner| *owner != 0);
            let path = match owner {
                Some(owner) => format!("/api/v1/settings/reset?scope={scope}&owner={owner}"),
                None => format!("/api/v1/settings/reset?scope={scope}"),
            };
            (Method::POST, path, None)
        }
        ("GET", "/ports") => (method, "/api/v1/ports".to_string(), body),
        ("GET", "/diagnostics") => (method, "/api/v1/pd-diagnostics".to_string(), body),
        ("GET", "/power/config") => (method, "/api/v1/power/config".to_string(), body),
        ("PUT", _) if suffix.starts_with("/power/config?owner=") => {
            (Method::PUT, format!("/api/v1{suffix}"), body)
        }
        ("POST", _) if suffix.starts_with("/power/config/defaults?owner=") => {
            (Method::POST, format!("/api/v1{suffix}"), body)
        }
        ("POST", _) if suffix.starts_with("/power/config/lock?owner=") => {
            (Method::POST, format!("/api/v1{suffix}"), body)
        }
        ("POST", _) if suffix.starts_with("/power/config/release?owner=") => {
            (Method::POST, format!("/api/v1{suffix}"), body)
        }
        ("POST", "/hub/route") => {
            let route = body
                .as_ref()
                .and_then(|body| body.get("route"))
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("route is required"))?;
            (
                Method::POST,
                format!("/api/v1/hub/usb-c-downstream-route?route={route}"),
                None,
            )
        }
        ("POST", _) if suffix.starts_with("/ports/") && suffix.ends_with("/replug") => {
            let port = suffix
                .trim_start_matches("/ports/")
                .trim_end_matches("/replug");
            (
                Method::POST,
                format!("/api/v1/ports/{port}/actions/replug"),
                None,
            )
        }
        ("POST", _) if suffix.starts_with("/ports/") && suffix.contains("/power?enabled=") => {
            let rest = suffix.trim_start_matches("/ports/");
            let (port, query) = rest
                .split_once("/power?")
                .ok_or_else(|| anyhow!("invalid port power path"))?;
            (
                Method::POST,
                format!("/api/v1/ports/{port}/power?{query}"),
                None,
            )
        }
        _ => (method, suffix.to_string(), body),
    };
    Ok(mapped)
}

async fn handle_ports(
    client: &Client,
    devd: &DevdClient,
    selector: ApiSelectorArgs,
    command: Option<PortsCommand>,
) -> anyhow::Result<Value> {
    match command {
        None => request_selected(client, devd, selector, Method::GET, "/ports", None).await,
        Some(PortsCommand::Power { port, enabled }) => {
            request_selected(
                client,
                devd,
                selector,
                Method::POST,
                &format!("/ports/{port}/power?enabled={enabled}"),
                None,
            )
            .await
        }
        Some(PortsCommand::Replug { port }) => {
            request_selected(
                client,
                devd,
                selector,
                Method::POST,
                &format!("/ports/{port}/replug"),
                None,
            )
            .await
        }
        Some(PortsCommand::Route { route }) => {
            request_selected(
                client,
                devd,
                selector,
                Method::POST,
                "/hub/route",
                Some(json!({"route": route})),
            )
            .await
        }
    }
}

async fn handle_hardware(
    client: &Client,
    devd: &DevdClient,
    command: HardwareCommand,
) -> anyhow::Result<Value> {
    let path = registry_path()?;
    match command {
        HardwareCommand::Path => Ok(json!({"path": path})),
        HardwareCommand::List | HardwareCommand::Recent => {
            let mut registry = read_hardware_registry()?;
            registry
                .devices
                .sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));
            Ok(json!({"path": path, "devices": registry.devices}))
        }
        HardwareCommand::Available { scan } => {
            let registry = read_hardware_registry()?;
            let devd_devices = if scan {
                devd_request(client, devd, Method::POST, "/api/v1/devices/scan", None).await
            } else {
                devd_request(client, devd, Method::GET, "/api/v1/devices", None).await
            };
            Ok(json!({
                "path": path,
                "saved": registry.devices,
                "devd": devd_devices.unwrap_or_else(|err| json!({"error": err.to_string()})),
            }))
        }
        HardwareCommand::Save {
            device_id,
            name,
            port_path,
            url,
            web_serial_label,
        } => {
            if port_path.is_none() && url.is_none() && web_serial_label.is_none() {
                return Err(anyhow!(
                    "save requires at least one of --port-path, --url, or --web-serial-label"
                ));
            }
            let saved = save_hardware(SavedHardwareInput {
                device_id: device_id.clone(),
                name,
                transports: DeviceProfileTransports {
                    http_base_url: url,
                    local_usb_port_path: port_path,
                    web_serial_label,
                },
                identity: Some(DeviceIdentity {
                    device_id: Some(device_id),
                    mac: None,
                }),
            })?;
            Ok(json!({"path": path, "device": saved}))
        }
        HardwareCommand::Forget { device_id } => {
            let mut registry = read_hardware_registry()?;
            let before = registry.devices.len();
            registry.devices.retain(|device| device.id != device_id);
            isolapurr_host::write_hardware_registry(&registry)?;
            Ok(json!({
                "path": path,
                "device_id": device_id,
                "removed": before != registry.devices.len()
            }))
        }
    }
}

async fn handle_discover(client: &Client, devd: &DevdClient, _scan: bool) -> anyhow::Result<Value> {
    let registry = read_hardware_registry()?;
    let usb_devices = discover_usb_devices(client, devd, &registry.devices).await?;
    let (lan_devices, warnings) = discover_lan_devices(client, &registry.devices).await;

    let mut devices = Vec::with_capacity(lan_devices.len() + usb_devices.len());
    devices.extend(lan_devices);
    devices.extend(usb_devices);

    if warnings.is_empty() {
        Ok(json!({ "devices": devices }))
    } else {
        Ok(json!({
            "devices": devices,
            "warnings": warnings,
        }))
    }
}

async fn handle_flash(
    client: &Client,
    devd: &DevdClient,
    args: FlashArgs,
) -> anyhow::Result<Value> {
    let device = materialize_live_usb_device(
        client,
        devd,
        resolve_usb_device(&args.selector, &devd.endpoint)?,
    )
    .await?;
    let device_devd = devd.with_endpoint(device.devd.clone());
    let expected_identity = DeviceIdentity {
        device_id: args.expected_device_id.clone().or_else(|| {
            device
                .identity
                .as_ref()
                .and_then(|identity| identity.device_id.clone())
        }),
        mac: args.expected_mac.clone().or_else(|| {
            device
                .identity
                .as_ref()
                .and_then(|identity| identity.mac.clone())
        }),
    };
    if args.real
        && !args.first_time
        && expected_identity.device_id.is_none()
        && expected_identity.mac.is_none()
    {
        return Err(anyhow!(
            "normal flash requires --expected-device-id/--expected-mac or saved device identity"
        ));
    }
    let catalog: FirmwareCatalog =
        serde_json::from_slice(&fs::read(&args.catalog).context("read firmware catalog")?)?;
    let artifact = catalog
        .artifacts
        .iter()
        .find(|artifact| artifact.artifact_id == args.artifact)
        .ok_or_else(|| anyhow!("artifact not found in catalog: {}", args.artifact))?;

    let mut confirm_non_project_firmware = args.confirm_non_project_firmware;
    if args.first_time && args.real && !confirm_non_project_firmware {
        if !std::io::stdin().is_terminal() {
            return Err(anyhow!(
                "first-time flash may target download-mode or non-IsolaPurr firmware; rerun interactively or pass --confirm-non-project-firmware after external target confirmation"
            ));
        }
        eprintln!("First-time full flash requested.");
        eprintln!("device={}", device.device);
        eprintln!("artifact={}", artifact.artifact_id);
        eprintln!("target={}", artifact.target);
        eprintln!("Type 'flash {}' to continue:", artifact.artifact_id);
        let mut line = String::new();
        std::io::stdin().read_line(&mut line)?;
        if line.trim() != format!("flash {}", artifact.artifact_id) {
            return Err(anyhow!("first-time flash confirmation did not match"));
        }
        confirm_non_project_firmware = true;
    }

    devd_device_post_with_lease(
        client,
        &device_devd,
        &device.device,
        "/flash",
        json!({
            "catalog_path": args.catalog,
            "artifact_id": args.artifact,
            "real": args.real,
            "first_time": args.first_time,
            "confirm_non_project_firmware": confirm_non_project_firmware,
            "expected_identity": expected_identity,
        }),
    )
    .await
}

async fn devd_device_post_with_lease(
    client: &Client,
    devd: &DevdClient,
    device: &str,
    suffix: &str,
    mut body: Value,
) -> anyhow::Result<Value> {
    ensure_devd_device_registered(client, devd, device).await?;
    let lease = create_lease(client, devd, device).await?;
    if let Some(map) = body.as_object_mut() {
        map.insert(
            "lease_id".to_string(),
            Value::String(lease.lease_id.clone()),
        );
    }
    let result = devd_request(
        client,
        devd,
        Method::POST,
        &format!("/api/v1/devices/{device}{suffix}"),
        Some(body),
    )
    .await;
    let _ = devd_request(
        client,
        devd,
        Method::DELETE,
        &format!("/api/v1/serial/lease/{}", lease.lease_id),
        None,
    )
    .await;
    result
}

async fn ensure_devd_device_registered(
    client: &Client,
    devd: &DevdClient,
    device: &str,
) -> anyhow::Result<()> {
    let value = devd_request(client, devd, Method::POST, "/api/v1/devices/scan", None).await?;
    let found = value
        .get("devices")
        .and_then(Value::as_array)
        .is_some_and(|devices| {
            devices
                .iter()
                .any(|entry| entry.get("id").and_then(Value::as_str) == Some(device))
        });
    if !found {
        return Err(anyhow!("device not found after scan: {device}"));
    }
    Ok(())
}

async fn materialize_live_usb_device(
    client: &Client,
    devd: &DevdClient,
    usb: ResolvedUsb,
) -> anyhow::Result<ResolvedUsb> {
    if ensure_devd_device_registered(client, devd, &usb.device)
        .await
        .is_ok()
    {
        return Ok(usb);
    }
    let canonical_device_id = usb
        .identity
        .as_ref()
        .and_then(|identity| identity.device_id.clone())
        .or_else(|| canonical_device_id_candidate(&usb.device));
    let Some(canonical_device_id) = canonical_device_id else {
        return Err(anyhow!("device not found after scan: {}", usb.device));
    };
    let live_device = find_live_usb_target_by_device_id(client, devd, &canonical_device_id)
        .await?
        .ok_or_else(|| {
            anyhow!("connected Local USB target not found for device_id {canonical_device_id}")
        })?;
    Ok(ResolvedUsb {
        device: live_device,
        ..usb
    })
}

async fn find_live_usb_target_by_device_id(
    client: &Client,
    devd: &DevdClient,
    canonical_device_id: &str,
) -> anyhow::Result<Option<String>> {
    let value = devd_request(client, devd, Method::POST, "/api/v1/devices/scan", None).await?;
    let devices = value
        .get("devices")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("device scan returned no device list"))?
        .iter()
        .cloned()
        .map(serde_json::from_value::<DeviceRecord>)
        .collect::<Result<Vec<_>, _>>()?;

    for device in devices {
        let Some(_usb) = &device.usb else {
            continue;
        };
        let info = devd_request(
            client,
            devd,
            Method::GET,
            &format!("/api/v1/devices/{}/status", device.id),
            None,
        )
        .await;
        let Ok(info) = info else {
            continue;
        };
        let reported = info
            .get("device")
            .or_else(|| info.get("result").and_then(|result| result.get("device")))
            .and_then(|device| device.get("device_id").or_else(|| device.get("deviceId")))
            .and_then(Value::as_str);
        if reported == Some(canonical_device_id) {
            return Ok(Some(device.id));
        }
    }
    Ok(None)
}

fn canonical_device_id_candidate(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    (normalized.len() == 12 && normalized.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then_some(normalized)
}

fn stable_usb_device_id(port_path: &str) -> String {
    let sanitized = port_path
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    format!("usb-{sanitized}")
}

async fn create_lease(
    client: &Client,
    devd: &DevdClient,
    device: &str,
) -> anyhow::Result<CliLease> {
    let value = devd_request(
        client,
        devd,
        Method::POST,
        "/api/v1/serial/lease",
        Some(json!({"device_id": device})),
    )
    .await?;
    Ok(serde_json::from_value(value)?)
}

fn ensure_success_envelope(value: &Value) -> anyhow::Result<()> {
    if value.get("ok").and_then(Value::as_bool) == Some(false) {
        let message = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .or_else(|| value.get("error").and_then(Value::as_str))
            .unwrap_or("device returned ok=false");
        return Err(anyhow!("device request failed: {message}"));
    }
    Ok(())
}
