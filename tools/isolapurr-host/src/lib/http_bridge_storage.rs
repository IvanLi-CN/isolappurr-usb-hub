use super::*;

pub(super) async fn create_lease(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LeaseRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    cleanup_expired_leases(&state).await;
    let port_path = {
        let inner = state.inner.lock().await;
        let Some(device) = inner.devices.get(&req.device_id) else {
            return not_found("device not found");
        };
        device.usb.as_ref().map(|usb| usb.port_path.clone())
    };

    let lease_id = next_id();
    let lease = LeaseRecord {
        lease_id: lease_id.clone(),
        device_id: req.device_id.clone(),
        port_path,
        expires_at: Instant::now() + Duration::from_millis(LEASE_TTL_MS),
    };
    state
        .inner
        .lock()
        .await
        .leases
        .insert(lease_id.clone(), lease);
    Json(json!(LeaseResponse {
        lease_id,
        device_id: req.device_id,
        heartbeat_interval_ms: LEASE_HEARTBEAT_INTERVAL_MS,
        lease_ttl_ms: LEASE_TTL_MS,
    }))
    .into_response()
}

pub(super) async fn heartbeat_lease(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(lease_id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let mut inner = state.inner.lock().await;
    let Some(lease) = inner.leases.get_mut(&lease_id) else {
        return not_found("lease not found");
    };
    lease.expires_at = Instant::now() + Duration::from_millis(LEASE_TTL_MS);
    Json(json!({
        "lease_id": lease.lease_id,
        "device_id": lease.device_id,
        "port_path": lease.port_path,
        "lease_ttl_ms": LEASE_TTL_MS,
    }))
    .into_response()
}

pub(super) async fn release_lease(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(lease_id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let removed = state.inner.lock().await.leases.remove(&lease_id).is_some();
    Json(json!({"ok": true, "released": removed})).into_response()
}

pub(super) async fn storage_list(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match read_hardware_registry() {
        Ok(registry) => Json(json!({
            "devices": web_storage_devices(&registry),
            "profiles": registry.devices,
        }))
        .into_response(),
        Err(err) => internal_error(&format!("read storage failed: {err}")),
    }
}

pub(super) async fn storage_save(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Value>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let input = match parse_storage_save_input(input) {
        Ok(input) => input,
        Err(err) => return bad_request(&err.to_string()),
    };
    match save_hardware(input) {
        Ok(device) => {
            let web_device = read_hardware_registry()
                .ok()
                .and_then(|registry| web_storage_device_for_profile(&registry, &device))
                .unwrap_or_else(|| web_storage_device(&device));
            Json(json!({
                "device": web_device,
                "profile": device,
            }))
            .into_response()
        }
        Err(err) => bad_request(&format!("save storage failed: {err}")),
    }
}

pub(super) async fn storage_delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match delete_hardware(&id) {
        Ok(removed) => Json(json!({"removed": removed})).into_response(),
        Err(err) => bad_request(&format!("delete storage failed: {err}")),
    }
}

pub(super) async fn storage_settings_get(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match read_storage_settings() {
        Ok(settings) => Json(json!({"settings": settings})).into_response(),
        Err(err) => internal_error(&format!("read settings failed: {err}")),
    }
}

pub(super) async fn storage_settings_put(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<StorageSettingsRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match write_storage_settings(&req.settings) {
        Ok(()) => Json(json!({"settings": req.settings})).into_response(),
        Err(err) => bad_request(&format!("write settings failed: {err}")),
    }
}

pub(super) async fn storage_migrate_localstorage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Value>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match migrate_localstorage_payload(input) {
        Ok((devices, settings_written)) => Json(json!({
            "migrated": devices > 0 || settings_written,
            "imported": {"devices": devices, "settings": settings_written},
        }))
        .into_response(),
        Err(err) => bad_request(&format!("migration failed: {err}")),
    }
}

pub(super) async fn storage_export(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let registry = match read_hardware_registry() {
        Ok(registry) => registry,
        Err(err) => return internal_error(&format!("read storage failed: {err}")),
    };
    let settings = match read_storage_settings() {
        Ok(settings) => settings,
        Err(err) => return internal_error(&format!("read settings failed: {err}")),
    };
    Json(json!({
        "schema_version": STORAGE_SCHEMA_VERSION,
        "devices": web_storage_devices(&registry),
        "profiles": registry.devices,
        "settings": settings,
        "meta": {},
    }))
    .into_response()
}

pub(super) async fn storage_reset(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let registry = HardwareRegistry::default();
    if let Err(err) = write_hardware_registry(&registry) {
        return bad_request(&format!("reset storage failed: {err}"));
    }
    if let Err(err) = write_storage_settings(&default_storage_settings()) {
        return bad_request(&format!("reset settings failed: {err}"));
    }
    Json(json!({"ok": true})).into_response()
}

fn parse_storage_save_input(value: Value) -> anyhow::Result<SavedHardwareInput> {
    if let Some(device) = value.get("device").and_then(Value::as_object) {
        let name = device
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("device.name is required"))?
            .to_string();
        let base_url = device
            .get("baseUrl")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("device.baseUrl is required"))?
            .to_string();
        let device_id = device
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("device.id is required"))
            .and_then(normalize_canonical_device_id)?;
        let transports = parse_storage_transports(device, &base_url);
        return Ok(SavedHardwareInput {
            device_id,
            name,
            transports,
            identity: None,
        });
    }
    #[derive(Deserialize)]
    struct Wire {
        #[serde(rename = "deviceId", alias = "device_id", alias = "id")]
        device_id: String,
        name: String,
        #[serde(default)]
        transports: Option<DeviceProfileTransports>,
        #[serde(default)]
        identity: Option<DeviceIdentity>,
    }
    let wire: Wire = serde_json::from_value(value)?;
    Ok(SavedHardwareInput {
        device_id: normalize_canonical_device_id(&wire.device_id)?,
        name: wire.name,
        transports: wire.transports.unwrap_or_default(),
        identity: wire.identity,
    })
}

fn web_storage_device(profile: &DeviceProfile) -> Value {
    web_storage_group_device(&[profile])
}

pub(super) fn web_storage_devices(registry: &HardwareRegistry) -> Vec<Value> {
    registry.devices.iter().map(web_storage_device).collect()
}

fn web_storage_device_for_profile(
    registry: &HardwareRegistry,
    profile: &DeviceProfile,
) -> Option<Value> {
    registry
        .devices
        .iter()
        .find(|candidate| candidate.id == profile.id)
        .map(web_storage_device)
}

fn web_storage_group_device(profiles: &[&DeviceProfile]) -> Value {
    let primary = profiles
        .first()
        .expect("web storage group must contain at least one profile");
    let transports_value = primary.transports.clone().unwrap_or_default();
    let base_url = transports_value
        .http_base_url
        .clone()
        .unwrap_or_else(|| format!("http://isolapurr-usb-hub-{}.local", primary.id));
    let mut transports = serde_json::Map::new();
    if let Some(value) = transports_value.http_base_url {
        transports.insert("httpBaseUrl".to_string(), json!(value));
    }
    if let Some(value) = transports_value.local_usb_port_path {
        transports.insert("localUsbPortPath".to_string(), json!(value));
    }
    if let Some(value) = transports_value.web_serial_label {
        transports.insert("webSerialLabel".to_string(), json!(value));
    }

    json!({
        "id": primary.id,
        "name": primary.name,
        "baseUrl": base_url,
        "lastSeenAt": primary.last_seen_at.map(|ts| ts.to_string()),
        "transports": Value::Object(transports),
    })
}

fn parse_web_storage_device(value: &Value) -> anyhow::Result<DeviceProfile> {
    let device = value
        .as_object()
        .ok_or_else(|| anyhow!("device must be an object"))?;
    let id = device
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("device.id is required"))
        .and_then(normalize_canonical_device_id)?;
    let name = device
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("device.name is required"))?
        .to_string();
    let base_url = device
        .get("baseUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("device.baseUrl is required"))?;
    Ok(DeviceProfile {
        id,
        name,
        transports: Some(parse_storage_transports(device, base_url)),
        legacy_transport: None,
        identity: None,
        last_seen_at: Some(now_unix_seconds()),
    })
}

pub(super) fn parse_import_profiles(
    req: &StorageImportRequest,
) -> anyhow::Result<Vec<DeviceProfile>> {
    if !req.profiles.is_empty() {
        return Ok(req
            .profiles
            .iter()
            .cloned()
            .filter_map(sanitize_profile)
            .collect());
    }
    req.devices
        .iter()
        .cloned()
        .map(|device| parse_web_storage_device(&device))
        .collect()
}

fn migrate_localstorage_payload(value: Value) -> anyhow::Result<(usize, bool)> {
    let mut imported_devices = 0;
    if let Some(devices) = value.get("devices").and_then(Value::as_array) {
        let mut registry = read_hardware_registry()?;
        for device in devices {
            upsert_profile(&mut registry, parse_web_storage_device(device)?);
            imported_devices += 1;
        }
        write_hardware_registry(&registry)?;
    }

    let mut settings_written = false;
    if let Some(theme) = value
        .get("settings")
        .and_then(|settings| settings.get("theme"))
        .and_then(Value::as_str)
    {
        write_storage_settings(&StorageSettings {
            theme: theme.to_string(),
        })?;
        settings_written = true;
    }
    Ok((imported_devices, settings_written))
}

fn parse_storage_transports(
    device: &serde_json::Map<String, Value>,
    base_url: &str,
) -> DeviceProfileTransports {
    let transports = device.get("transports").and_then(Value::as_object);
    if transports.is_none() {
        return parse_legacy_storage_base_url(base_url);
    }
    let http_base_url = transports
        .and_then(|transports| transports.get("httpBaseUrl"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| http_storage_base_url(base_url));
    let local_usb_port_path = transports
        .and_then(|transports| transports.get("localUsbPortPath"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let web_serial_label = transports
        .and_then(|transports| transports.get("webSerialLabel"))
        .and_then(Value::as_str)
        .map(str::to_string);

    DeviceProfileTransports {
        http_base_url,
        local_usb_port_path,
        web_serial_label,
    }
}

fn http_storage_base_url(base_url: &str) -> Option<String> {
    let trimmed = base_url.trim();
    (trimmed.starts_with("http://") || trimmed.starts_with("https://")).then(|| trimmed.to_string())
}

fn parse_legacy_storage_base_url(base_url: &str) -> DeviceProfileTransports {
    if let Some(value) = base_url.strip_prefix("isolapurr-devd://") {
        return DeviceProfileTransports {
            http_base_url: None,
            local_usb_port_path: legacy_local_usb_port_path(value),
            web_serial_label: None,
        };
    }
    if let Some(value) = base_url.strip_prefix("webserial://") {
        return DeviceProfileTransports {
            http_base_url: None,
            local_usb_port_path: None,
            web_serial_label: Some(value.trim().to_string()),
        };
    }
    DeviceProfileTransports {
        http_base_url: Some(base_url.to_string()),
        local_usb_port_path: None,
        web_serial_label: None,
    }
}

fn normalize_canonical_device_id(value: &str) -> anyhow::Result<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.len() == 12 && normalized.chars().all(|ch| ch.is_ascii_hexdigit()) {
        Ok(normalized)
    } else {
        Err(anyhow!(
            "device.id must be a 12-character lowercase hex device_id"
        ))
    }
}

pub(super) async fn storage_import(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<StorageImportRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let profiles = match parse_import_profiles(&req) {
        Ok(profiles) => profiles,
        Err(err) => return bad_request(&format!("import failed: {err}")),
    };
    let settings = req.settings;
    match import_profiles(profiles) {
        Ok(count) => {
            let settings_written = if let Some(settings) = settings {
                if let Err(err) = write_storage_settings(&settings) {
                    return bad_request(&format!("import settings failed: {err}"));
                }
                true
            } else {
                false
            };
            Json(json!({"imported": {"devices": count, "settings": settings_written}}))
                .into_response()
        }
        Err(err) => bad_request(&format!("import failed: {err}")),
    }
}
