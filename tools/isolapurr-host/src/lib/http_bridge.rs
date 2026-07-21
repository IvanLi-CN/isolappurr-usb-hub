#[path = "http_bridge_storage.rs"]
mod http_bridge_storage;
#[cfg(test)]
#[path = "http_bridge_tests.rs"]
mod http_bridge_tests;
#[path = "settings_reset_bridge.rs"]
mod settings_reset_bridge;

#[cfg(test)]
use http_bridge_storage::{parse_import_profiles, web_storage_devices};

pub async fn serve_http_bridge(config: DevdConfig) -> anyhow::Result<()> {
    if !config.bind.ip().is_loopback() {
        return Err(anyhow!(
            "isolapurr-devd refuses non-loopback binds because /api/v1/bootstrap returns a local bearer token"
        ));
    }
    let listener = TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("bind {}", config.bind))?;
    let port = listener.local_addr()?.port();
    let state = AppState::new(format!("http://127.0.0.1:{port}"));

    let router = router(state, config.web_root, config.allow_dev_cors);
    tracing::info!("isolapurr-devd HTTP bridge listening on http://127.0.0.1:{port}");
    axum::serve(listener, router).await?;
    Ok(())
}

fn router(state: AppState, web_root: Option<PathBuf>, allow_dev_cors: bool) -> Router {
    let mut router = Router::new()
        .route("/api/v1/bootstrap", get(bootstrap))
        .route("/api/v1/health", get(health))
        .route("/api/v1/devices", get(list_devices))
        .route("/api/v1/devices/scan", post(scan_devices))
        .route("/api/v1/devices/{id}/status", get(device_status))
        .route("/api/v1/devices/{id}/session", get(device_session))
        .route(
            "/api/v1/devices/{id}/wifi",
            get(wifi_get).post(wifi_set).delete(wifi_clear),
        )
        .route(
            "/api/v1/devices/{id}/settings/reset",
            post(settings_reset_bridge::settings_reset),
        )
        .route("/api/v1/devices/{id}/ports", get(device_ports))
        .route(
            "/api/v1/devices/{id}/ports/{port_id}/power",
            post(port_power),
        )
        .route(
            "/api/v1/devices/{id}/ports/{port_id}/replug",
            post(port_replug),
        )
        .route("/api/v1/devices/{id}/hub/route", post(hub_route_set))
        .route(
            "/api/v1/devices/{id}/power/config",
            get(device_power_config_get).put(device_power_config_set),
        )
        .route(
            "/api/v1/devices/{id}/power/runtime",
            post(device_power_runtime_set).put(device_power_runtime_set),
        )
        .route(
            "/api/v1/devices/{id}/power/idle-bias",
            get(device_power_idle_bias_get).put(device_power_idle_bias_set),
        )
        .route(
            "/api/v1/devices/{id}/power/idle-bias/run",
            post(device_power_idle_bias_run),
        )
        .route(
            "/api/v1/devices/{id}/power/idle-bias/clear",
            post(device_power_idle_bias_clear),
        )
        .route(
            "/api/v1/devices/{id}/power/config/defaults",
            post(device_power_config_defaults),
        )
        .route(
            "/api/v1/devices/{id}/power/config/lock",
            post(device_power_config_lock),
        )
        .route(
            "/api/v1/devices/{id}/power/config/release",
            post(device_power_config_release),
        )
        .route("/api/v1/devices/{id}/flash", post(device_flash))
        .route(
            "/api/v1/devices/{id}/flash-upload",
            post(device_flash_upload),
        )
        .route(
            "/api/v1/devices/{id}/flash-bundled",
            post(device_flash_bundled),
        )
        .route("/api/v1/devices/{id}/reset", post(device_reset))
        .route("/api/v1/devices/{id}/diagnostics", get(device_diagnostics))
        .route(
            "/api/v1/devices/{id}/pd-diagnostics",
            get(device_diagnostics),
        )
        .route(
            "/api/v1/serial/lease",
            post(http_bridge_storage::create_lease),
        )
        .route("/api/v1/serial/ports", get(serial_ports))
        .route("/api/v1/serial/register", post(serial_register))
        .route("/api/v1/serial/request", post(serial_request))
        .route("/api/v1/serial/board-info", post(serial_board_info))
        .route(
            "/api/v1/serial/lease/{lease_id}",
            post(http_bridge_storage::heartbeat_lease).delete(http_bridge_storage::release_lease),
        )
        .route(
            "/api/v1/storage/devices",
            get(http_bridge_storage::storage_list).post(http_bridge_storage::storage_save),
        )
        .route(
            "/api/v1/storage/devices/{id}",
            delete(http_bridge_storage::storage_delete),
        )
        .route(
            "/api/v1/storage/settings",
            get(http_bridge_storage::storage_settings_get)
                .put(http_bridge_storage::storage_settings_put),
        )
        .route(
            "/api/v1/storage/migrate/localstorage",
            post(http_bridge_storage::storage_migrate_localstorage),
        )
        .route(
            "/api/v1/storage/export",
            get(http_bridge_storage::storage_export),
        )
        .route(
            "/api/v1/storage/reset",
            post(http_bridge_storage::storage_reset),
        )
        .route(
            "/api/v1/storage/import",
            post(http_bridge_storage::storage_import),
        )
        .route("/api/v1/firmware/catalog/validate", post(validate_catalog))
        .with_state(state)
        .layer(DefaultBodyLimit::max(16 * 1024 * 1024));

    if let Some(web_root) = web_root {
        let index = web_root.join("index.html");
        router = router.fallback_service(ServeDir::new(web_root).fallback(ServeFile::new(index)));
    }
    if allow_dev_cors {
        router = router.layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::predicate(|origin, _| {
                    is_loopback_origin(origin)
                }))
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]),
        );
    }
    router
}

async fn bootstrap(State(state): State<AppState>) -> Json<Value> {
    Json(json!(BootstrapResponse {
        token: state.token,
        agent_base_url: state.base_url,
        app: BootstrapApp {
            name: "isolapurr-devd",
            version: release_version(),
            mode: "devd",
        },
    }))
}

async fn health(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    Json(json!({"ok": true})).into_response()
}

async fn list_devices(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    cleanup_expired_leases(&state).await;
    let devices = state
        .inner
        .lock()
        .await
        .devices
        .values()
        .cloned()
        .collect::<Vec<_>>();
    Json(json!({"devices": devices})).into_response()
}

async fn scan_devices(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let ports = match list_serial_ports() {
        Ok(ports) => ports,
        Err(err) => return internal_error(&format!("serial enumeration failed: {err}")),
    };
    let mut inner = state.inner.lock().await;
    reconcile_scanned_usb_devices(&mut inner, ports);
    let devices = inner.devices.values().cloned().collect::<Vec<_>>();
    Json(json!({"devices": devices})).into_response()
}

async fn serial_ports(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match list_serial_ports() {
        Ok(ports) => Json(json!({ "ports": ports })).into_response(),
        Err(err) => internal_error(&format!("serial enumeration failed: {err}")),
    }
}

async fn serial_register(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SerialRegisterRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let port = match find_serial_port_by_path(&req.port_path) {
        Ok(Some(port)) => port,
        Ok(None) => return not_found("serial port not found"),
        Err(err) => return internal_error(&format!("serial enumeration failed: {err}")),
    };
    let device = {
        let mut inner = state.inner.lock().await;
        upsert_usb_device(&mut inner, port)
    };
    Json(json!({ "ok": true, "device": device })).into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SerialBoardInfoRequest {
    port_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SerialRegisterRequest {
    port_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SerialRequestBody {
    port_path: String,
    request: Value,
    timeout_ms: Option<u64>,
}

async fn serial_board_info(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SerialBoardInfoRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = register_requested_usb_device(&state, &req.port_path).await {
        return error_from_anyhow(err);
    }
    match local_usb_board_info(&state, &req.port_path).await {
        Ok(result) => Json(json!({ "ok": true, "result": result })).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn serial_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SerialRequestBody>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = register_requested_usb_device(&state, &req.port_path).await {
        return error_from_anyhow(err);
    }
    let device_id = stable_usb_device_id(&req.port_path);
    let request = req.request.clone();
    let request_method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("request")
        .to_string();
    push_trace(&state, &device_id, "tx", &request_method, &request).await;
    let port_path = req.port_path.clone();
    let timeout_ms = req.timeout_ms;
    let response_method = request_method.clone();
    let result = async {
        let _guard = acquire_serial_port_guard(&state, &port_path, None).await?;
        tokio::task::spawn_blocking(move || {
            serial_jsonl_roundtrip_with_timeout(&port_path, request, timeout_ms)
        })
        .await
        .context("serial worker join")?
    }
    .await;
    match result {
        Ok(response) => {
            push_trace(&state, &device_id, "rx", &response_method, &response).await;
            Json(json!({ "response": response })).into_response()
        }
        Err(err) => error_from_anyhow(err),
    }
}

fn reconcile_scanned_usb_devices(inner: &mut DevdState, ports: Vec<UsbTarget>) {
    let mut scanned_ids = HashSet::new();
    for port in ports {
        scanned_ids.insert(stable_usb_device_id(&port.port_path));
        upsert_usb_device(inner, port);
    }
    inner.devices.retain(|id, device| {
        if device.usb.is_some() && !scanned_ids.contains(id) {
            device.usb = None;
            if device.http.is_some() {
                device.connection = "unavailable".to_string();
                true
            } else {
                false
            }
        } else {
            true
        }
    });
}

fn find_serial_port_by_path(port_path: &str) -> anyhow::Result<Option<UsbTarget>> {
    Ok(list_serial_ports()?
        .into_iter()
        .find(|port| port.port_path == port_path))
}

fn upsert_usb_device(inner: &mut DevdState, port: UsbTarget) -> DeviceRecord {
    let id = stable_usb_device_id(&port.port_path);
    inner
        .devices
        .entry(id.clone())
        .and_modify(|device| {
            device.display_name = port.label.clone();
            device.connection = "available".to_string();
            device.usb = Some(port.clone());
        })
        .or_insert(DeviceRecord {
            id,
            display_name: port.label.clone(),
            connection: "available".to_string(),
            usb: Some(port),
            http: None,
            identity: None,
            session: DeviceSession::default(),
        })
        .clone()
}

async fn register_requested_usb_device(state: &AppState, port_path: &str) -> anyhow::Result<()> {
    let port = find_serial_port_by_path(port_path)?
        .ok_or_else(|| anyhow!("serial port not found: {port_path}"))?;
    let mut inner = state.inner.lock().await;
    upsert_usb_device(&mut inner, port);
    Ok(())
}

async fn device_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match require_compatible_project_firmware(&state, &id).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<DeviceQuery>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let tail = query.tail.unwrap_or(200).min(MAX_SESSION_ITEMS);
    let inner = state.inner.lock().await;
    let Some(device) = inner.devices.get(&id) else {
        return not_found("device not found");
    };
    if let Some(lease_id) = query.lease_id.as_deref()
        && !inner.leases.contains_key(lease_id)
    {
        return unauthorized("lease not found or expired");
    }
    Json(json!({
        "logs": tail_items(&device.session.logs, tail),
        "traces": tail_items(&device.session.traces, tail),
    }))
    .into_response()
}

async fn wifi_get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(&state, &id, "wifi.get", None).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn wifi_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<WifiRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(
        &state,
        &id,
        "wifi.set",
        Some(json!({"ssid": req.ssid, "psk": req.psk})),
    )
    .await
    {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn wifi_clear(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_wifi_clear_request(&state, &id).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_ports(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(&state, &id, "ports.get", None).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn port_power(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, port_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    let enabled = matches!(query.get("enabled").map(String::as_str), Some("1" | "true"));
    match usb_jsonl_request(
        &state,
        &id,
        "port.power_set",
        Some(json!({"port": port_id, "enabled": enabled})),
    )
    .await
    {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn port_replug(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, port_id)): Path<(String, String)>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(&state, &id, "port.replug", Some(json!({"port": port_id}))).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn hub_route_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<HubRouteRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    let route = req.route;
    match usb_jsonl_request(&state, &id, "hub.route_set", Some(json!({"route": route}))).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => match verify_hub_route_after_disconnect(&state, &id, &route).await {
            Ok(value) => Json(redact_sensitive(&value)).into_response(),
            Err(_) => error_from_anyhow(err),
        },
    }
}

async fn verify_hub_route_after_disconnect(
    state: &AppState,
    id: &str,
    route: &str,
) -> anyhow::Result<Value> {
    let mut last_error = None;
    for _ in 0..5 {
        tokio::time::sleep(Duration::from_millis(300)).await;
        match usb_jsonl_request(state, id, "ports.get", None).await {
            Ok(value) => {
                if let Some((actual_route, persisted)) = extract_hub_route(&value)
                    && actual_route == route
                {
                    return Ok(json!({
                        "ok": true,
                        "result": {
                            "accepted": true,
                            "usb_c_downstream_route": actual_route,
                            "persisted": persisted.unwrap_or(false),
                            "verified_after_serial_reconnect": true
                        }
                    }));
                }
            }
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("USB-C route did not verify after reconnect")))
}

fn extract_hub_route(value: &Value) -> Option<(String, Option<bool>)> {
    let hub = value
        .get("result")
        .and_then(|result| result.get("hub"))
        .or_else(|| value.get("hub"))?;
    let route = hub
        .get("usb_c_downstream_route")
        .and_then(Value::as_str)?
        .to_string();
    let persisted = hub
        .get("usb_c_downstream_persisted")
        .and_then(Value::as_bool);
    Some((route, persisted))
}

async fn verify_wifi_after_set_timeout(
    state: &AppState,
    id: &str,
    expected_ssid: &str,
) -> anyhow::Result<Value> {
    let mut last_error = None;
    for _ in 0..10 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        match usb_jsonl_request(state, id, "wifi.get", None).await {
            Ok(mut value) => {
                if wifi_matches_expected_ssid(&value, expected_ssid) {
                    if let Some(result) = value.get_mut("result").and_then(Value::as_object_mut) {
                        result.insert("verified_after_serial_timeout".to_string(), json!(true));
                    }
                    return Ok(value);
                }
                last_error = Some(anyhow!("Wi-Fi settings did not report expected SSID yet"));
            }
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("Wi-Fi set did not verify after serial timeout")))
}

fn wifi_matches_expected_ssid(value: &Value, expected_ssid: &str) -> bool {
    let wifi = value.get("result").unwrap_or(value);
    wifi.get("configured").and_then(Value::as_bool) == Some(true)
        && wifi.get("ssid").and_then(Value::as_str) == Some(expected_ssid)
}

fn should_verify_power_config_after_serial_error(err: &anyhow::Error) -> bool {
    let message = err.to_string();
    message.contains("serial response timed out") || message.contains("serial read")
}

async fn power_config_saved_after_serial_timeout(
    state: &AppState,
    id: &str,
    expected: &Value,
) -> anyhow::Result<Value> {
    let mut last_error = None;
    for _ in 0..6 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        match usb_jsonl_request(state, id, "power.config_get", None).await {
            Ok(mut value) => {
                if power_config_matches_expected(&value, expected) {
                    if let Some(result) = value.get_mut("result").and_then(Value::as_object_mut) {
                        result.insert("verified_after_serial_timeout".to_string(), json!(true));
                    }
                    return Ok(value);
                }
                last_error = Some(anyhow!(
                    "power config did not report the requested values yet"
                ));
            }
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("power config did not verify after serial timeout")))
}

async fn power_defaults_saved_after_serial_timeout(
    state: &AppState,
    id: &str,
) -> anyhow::Result<Value> {
    let mut last_error = None;
    for _ in 0..6 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        match usb_jsonl_request(state, id, "power.config_get", None).await {
            Ok(mut value) => {
                if power_config_matches_defaults(&value) {
                    if let Some(result) = value.get_mut("result").and_then(Value::as_object_mut) {
                        result.insert("verified_after_serial_timeout".to_string(), json!(true));
                    }
                    return Ok(value);
                }
                last_error = Some(anyhow!(
                    "power defaults did not report the expected values yet"
                ));
            }
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("power defaults did not verify after serial timeout")))
}

fn power_config_matches_expected(value: &Value, expected: &Value) -> bool {
    let observed = value.get("result").unwrap_or(value);
    observed.get("persisted").and_then(Value::as_bool) == Some(true)
        && observed.get("hardware") == expected.get("hardware")
        && observed.get("tps_mode") == expected.get("tps_mode")
        && observed.get("light_load_mode") == expected.get("light_load_mode")
        && observed.get("capability") == expected.get("capability")
        && observed.pointer("/manual/voltage_mv") == expected.pointer("/manual/voltage_mv")
        && observed.pointer("/manual/current_limit_ma")
            == expected.pointer("/manual/current_limit_ma")
        && observed.pointer("/manual/usb_c_path_mode")
            == expected.pointer("/manual/usb_c_path_mode")
}

fn power_runtime_matches_expected(value: &Value, action: &str, enabled: bool) -> bool {
    let observed = value.get("result").unwrap_or(value);
    (match action {
        "output" => observed
            .pointer("/runtime/output_enabled")
            .and_then(Value::as_bool),
        "discharge" => observed
            .pointer("/runtime/discharge_enabled")
            .and_then(Value::as_bool),
        _ => None,
    }) == Some(enabled)
}

async fn power_runtime_applied_after_serial_timeout(
    state: &AppState,
    id: &str,
    action: &str,
    enabled: bool,
) -> anyhow::Result<Value> {
    let mut last_error = None;
    for _ in 0..6 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        match usb_jsonl_request(state, id, "power.config_get", None).await {
            Ok(mut value) if power_runtime_matches_expected(&value, action, enabled) => {
                if let Some(result) = value.get_mut("result").and_then(Value::as_object_mut) {
                    result.insert("verified_after_serial_timeout".to_string(), json!(true));
                }
                return Ok(value);
            }
            Ok(_) => {
                last_error = Some(anyhow!(
                    "power runtime did not report the requested state yet"
                ))
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("power runtime did not verify after serial timeout")))
}

fn power_config_matches_defaults(value: &Value) -> bool {
    let observed = value.get("result").unwrap_or(value);
    observed.get("persisted").and_then(Value::as_bool) == Some(true)
        && observed.get("hardware").and_then(Value::as_str) == Some("sw2303")
        && observed.get("tps_mode").and_then(Value::as_str) == Some("auto_follow")
        && observed.get("light_load_mode").and_then(Value::as_str) == Some("pfm")
        && observed
            .pointer("/capability/profile")
            .and_then(Value::as_str)
            == Some("full")
        && observed
            .pointer("/capability/power_watts")
            .and_then(Value::as_u64)
            == Some(100)
        && observed
            .pointer("/capability/protocols/pd")
            .and_then(Value::as_bool)
            == Some(true)
        && observed
            .pointer("/capability/protocols/qc20")
            .and_then(Value::as_bool)
            == Some(true)
        && observed
            .pointer("/capability/protocols/qc30")
            .and_then(Value::as_bool)
            == Some(true)
        && observed
            .pointer("/capability/protocols/fcp")
            .and_then(Value::as_bool)
            == Some(true)
        && observed
            .pointer("/capability/protocols/afc")
            .and_then(Value::as_bool)
            == Some(true)
        && observed
            .pointer("/capability/protocols/scp")
            .and_then(Value::as_bool)
            == Some(true)
        && observed
            .pointer("/capability/protocols/pe20")
            .and_then(Value::as_bool)
            == Some(true)
        && observed
            .pointer("/capability/protocols/bc12")
            .and_then(Value::as_bool)
            == Some(true)
        && observed
            .pointer("/capability/protocols/sfcp")
            .and_then(Value::as_bool)
            == Some(true)
        && observed
            .pointer("/capability/pd/pps")
            .and_then(Value::as_bool)
            == Some(true)
        && observed
            .pointer("/capability/pd/fixed_voltages_mv")
            .and_then(Value::as_array)
            .is_some_and(|voltages| {
                voltages.len() == 4
                    && voltages[0].as_u64() == Some(9_000)
                    && voltages[1].as_u64() == Some(12_000)
                    && voltages[2].as_u64() == Some(15_000)
                    && voltages[3].as_u64() == Some(20_000)
            })
        && observed
            .pointer("/manual/voltage_mv")
            .and_then(Value::as_u64)
            == Some(5_000)
        && observed
            .pointer("/manual/current_limit_ma")
            .and_then(Value::as_u64)
            == Some(1_000)
        && observed
            .pointer("/manual/usb_c_path_mode")
            .and_then(Value::as_str)
            == Some("default")
}

async fn device_flash(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<FlashRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(response) = require_lease(&state, &id, req.lease_id.as_deref()).await {
        return *response;
    }
    let result = run_flash_request(&state, &id, req).await;
    match result {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_flash_upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<FirmwareUploadFlashRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(response) = require_lease(&state, &id, Some(&req.lease_id)).await {
        return *response;
    }
    let result = run_uploaded_flash_request(&state, &id, req).await;
    match result {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_flash_bundled(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<BundledFirmwareFlashRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(response) = require_lease(&state, &id, Some(&req.lease_id)).await {
        return *response;
    }
    let result = run_bundled_flash_request(&state, &id, req).await;
    match result {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_reset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let lease_id = body.get("lease_id").and_then(Value::as_str);
    if let Err(response) = require_lease(&state, &id, lease_id).await {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    let port_path = match device_usb_port_path(&state, &id).await {
        Ok(port_path) => port_path,
        Err(err) => return error_from_anyhow(err),
    };
    let serial_guard = match acquire_serial_port_guard(&state, &port_path, None).await {
        Ok(guard) => guard,
        Err(err) => return error_from_anyhow(err),
    };
    {
        let mut inner = state.inner.lock().await;
        if inner.exclusive_ports.contains_key(&port_path) {
            return conflict("device busy");
        }
        inner
            .exclusive_ports
            .insert(port_path.clone(), "reset".to_string());
    }
    let guard = ExclusiveGuard {
        state: state.clone(),
        port_path,
        serial_guard: Some(serial_guard),
    };
    let result = usb_jsonl_request_with_exclusive(&state, &id, "reboot", None, Some("reset")).await;
    drop(guard);
    match result {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_diagnostics(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(&state, &id, "pd.diagnostics", None).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_power_config_get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(&state, &id, "power.config_get", None).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_power_idle_bias_get(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(&state, &id, "power.idle_bias_get", None).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_power_config_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<PowerOwnerQuery>,
    Json(config): Json<Value>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    let params = json!({"config": config, "owner": query.owner});
    match usb_jsonl_request(&state, &id, "power.config_set", Some(params)).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) if should_verify_power_config_after_serial_error(&err) => {
            match power_config_saved_after_serial_timeout(&state, &id, &config).await {
                Ok(value) => Json(redact_sensitive(&value)).into_response(),
                Err(_) => error_from_anyhow(err),
            }
        }
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_power_runtime_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<PowerOwnerQuery>,
    Json(body): Json<Value>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    let params = json!({
        "action": body.get("action").cloned().unwrap_or(Value::Null),
        "enabled": body.get("enabled").cloned().unwrap_or(Value::Null),
        "owner": query.owner,
    });
    match usb_jsonl_request(&state, &id, "power.runtime_set", Some(params)).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) if should_verify_power_config_after_serial_error(&err) => {
            let action = body
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let enabled = body
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            match power_runtime_applied_after_serial_timeout(&state, &id, action, enabled).await {
                Ok(value) => Json(redact_sensitive(&value)).into_response(),
                Err(_) => error_from_anyhow(err),
            }
        }
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_power_idle_bias_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<PowerOwnerQuery>,
    Json(body): Json<Value>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    let params = json!({
        "correction_enabled": body.get("correction_enabled").cloned().unwrap_or(Value::Null),
        "owner": query.owner,
    });
    match usb_jsonl_request(&state, &id, "power.idle_bias_set", Some(params)).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_power_config_defaults(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<PowerOwnerQuery>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(
        &state,
        &id,
        "power.config_defaults",
        Some(json!({"owner": query.owner})),
    )
    .await
    {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) if should_verify_power_config_after_serial_error(&err) => {
            match power_defaults_saved_after_serial_timeout(&state, &id).await {
                Ok(value) => Json(redact_sensitive(&value)).into_response(),
                Err(_) => error_from_anyhow(err),
            }
        }
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_power_idle_bias_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<PowerOwnerQuery>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(
        &state,
        &id,
        "power.idle_bias_run",
        Some(json!({"owner": query.owner})),
    )
    .await
    {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_power_idle_bias_clear(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<PowerOwnerQuery>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(
        &state,
        &id,
        "power.idle_bias_clear",
        Some(json!({"owner": query.owner})),
    )
    .await
    {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_power_config_lock(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<PowerOwnerQuery>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(
        &state,
        &id,
        "power.lock",
        Some(json!({"owner": query.owner, "acquire": true})),
    )
    .await
    {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_power_config_release(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<PowerOwnerQuery>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_jsonl_request(
        &state,
        &id,
        "power.lock",
        Some(json!({"owner": query.owner, "acquire": false})),
    )
    .await
    {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}
