async fn validate_catalog(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(catalog): Json<FirmwareCatalog>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    let errors = validate_catalog_shape(&catalog);
    Json(json!({"ok": errors.is_empty(), "errors": errors})).into_response()
}

include!("device_io_retry.rs");

async fn ensure_serial_port_lock(state: &AppState, port_path: &str) -> Arc<Mutex<()>> {
    let mut inner = state.inner.lock().await;
    inner
        .serial_port_locks
        .entry(port_path.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

async fn acquire_serial_port_guard(
    state: &AppState,
    port_path: &str,
    allowed_exclusive_reason: Option<&str>,
) -> anyhow::Result<OwnedMutexGuard<()>> {
    {
        let inner = state.inner.lock().await;
        if let Some(reason) = inner.exclusive_ports.get(port_path)
            && allowed_exclusive_reason != Some(reason.as_str())
        {
            return Err(anyhow!("device busy: {reason}"));
        }
    }
    let guard = ensure_serial_port_lock(state, port_path)
        .await
        .lock_owned()
        .await;
    {
        let inner = state.inner.lock().await;
        if let Some(reason) = inner.exclusive_ports.get(port_path)
            && allowed_exclusive_reason != Some(reason.as_str())
        {
            drop(guard);
            return Err(anyhow!("device busy: {reason}"));
        }
    }
    Ok(guard)
}

fn parse_board_info_features(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn extract_capacity_from_features(features: &[String], needle: &str) -> Option<String> {
    features.iter().find_map(|feature| {
        let lower = feature.to_lowercase();
        if !lower.contains(needle) {
            return None;
        }
        feature.split_whitespace().find_map(|token| {
            let upper = token.to_uppercase();
            if upper.ends_with("MB") || upper.ends_with("KB") {
                Some(upper.replace("MB", " MB").replace("KB", " KB"))
            } else {
                None
            }
        })
    })
}

fn canonical_chip_label(value: &str) -> String {
    let compact = value
        .trim()
        .to_ascii_uppercase()
        .replace([' ', '_'], "")
        .replace("ESP32-", "ESP32");
    match compact.as_str() {
        value if value.starts_with("ESP32S3") => "ESP32-S3".to_string(),
        value if value.starts_with("ESP32S2") => "ESP32-S2".to_string(),
        value if value.starts_with("ESP32C3") => "ESP32-C3".to_string(),
        value if value.starts_with("ESP32C6") => "ESP32-C6".to_string(),
        value if value.starts_with("ESP32H2") => "ESP32-H2".to_string(),
        value if value.starts_with("ESP32P4") => "ESP32-P4".to_string(),
        _ => value.trim().to_ascii_uppercase(),
    }
}

fn infer_ram_size(chip_type: Option<&str>) -> Option<&'static str> {
    let chip_type = canonical_chip_label(chip_type?).replace('-', "");
    if chip_type.contains("ESP32S3") {
        return Some("512 KB");
    }
    if chip_type.contains("ESP32S2") {
        return Some("320 KB");
    }
    None
}

fn normalize_chip_description(value: &str) -> (String, Option<String>, Option<String>) {
    let trimmed = value.trim();
    let mut parts = trimmed.splitn(2, " (revision ");
    let chip_type = parts.next().unwrap_or(trimmed).trim().to_string();
    let chip_revision = parts
        .next()
        .map(|part| part.trim_end_matches(')').trim().to_string())
        .filter(|part| !part.is_empty());
    let mcu_model = chip_type
        .split(|ch: char| ch == ' ' || ch == '(')
        .find(|part| part.to_ascii_uppercase().starts_with("ESP32"))
        .map(canonical_chip_label)
        .or_else(|| (!chip_type.is_empty()).then(|| canonical_chip_label(&chip_type)));
    let chip_type = canonical_chip_label(&chip_type);
    (chip_type, mcu_model, chip_revision)
}

fn parse_espflash_board_info(raw_output: &str) -> Value {
    let mut chip_type: Option<String> = None;
    let mut mcu_model: Option<String> = None;
    let mut chip_revision: Option<String> = None;
    let mut flash_size: Option<String> = None;
    let mut mac_address: Option<String> = None;
    let mut crystal_frequency: Option<String> = None;
    let mut features = Vec::new();

    for line in raw_output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim().to_ascii_lowercase().as_str() {
            "chip type" => {
                let (next_chip_type, next_mcu_model, next_chip_revision) =
                    normalize_chip_description(value);
                chip_type = Some(next_chip_type);
                mcu_model = next_mcu_model;
                chip_revision = next_chip_revision;
            }
            "features" => {
                features = parse_board_info_features(value);
            }
            "crystal frequency" => {
                crystal_frequency = Some(value.to_string());
            }
            "flash size" => {
                flash_size = Some(value.to_uppercase().replace("MB", " MB"));
            }
            "mac address" => {
                mac_address = Some(value.to_string());
            }
            _ => {}
        }
    }

    let psram_size = extract_capacity_from_features(&features, "psram");
    if flash_size.is_none() {
        flash_size = extract_capacity_from_features(&features, "flash");
    }

    json!({
        "source": "espflash",
        "chipType": chip_type,
        "mcuModel": mcu_model,
        "chipRevision": chip_revision,
        "flashSize": flash_size,
        "ramSize": infer_ram_size(chip_type.as_deref()),
        "psramSize": psram_size,
        "macAddress": mac_address,
        "crystalFrequency": crystal_frequency,
        "features": features,
        "rawOutput": raw_output,
    })
}

fn run_espflash_board_info(port_path: &str, args: &[&str]) -> anyhow::Result<std::process::Output> {
    Command::new("espflash")
        .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
        .args(args)
        .output()
        .with_context(|| format!("start espflash board-info for {port_path}"))
}

fn local_usb_board_info_now(port_path: &str) -> anyhow::Result<Value> {
    let candidates = [
        ["board-info", "--port", port_path],
        ["board-info", "-p", port_path],
        ["--port", port_path, "board-info"],
        ["-p", port_path, "board-info"],
    ];
    let mut last_error = String::new();
    for args in candidates {
        let output = run_espflash_board_info(port_path, &args)?;
        let log = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if output.status.success() {
            return Ok(parse_espflash_board_info(&log));
        }
        last_error = log;
    }
    Err(anyhow!("espflash board-info failed: {last_error}"))
}

async fn local_usb_board_info(state: &AppState, port_path: &str) -> anyhow::Result<Value> {
    let _serial_guard = acquire_serial_port_guard(state, port_path, None).await?;
    let port_path = port_path.to_string();
    tokio::task::spawn_blocking(move || local_usb_board_info_now(&port_path))
        .await
        .context("serial board-info worker join")?
}

async fn usb_jsonl_request_with_exclusive(
    state: &AppState,
    device_id: &str,
    method: &str,
    params: Option<Value>,
    allowed_exclusive_reason: Option<&str>,
) -> anyhow::Result<Value> {
    let (port_path, request_id) = {
        let inner = state.inner.lock().await;
        let device = inner
            .devices
            .get(device_id)
            .ok_or_else(|| anyhow!("device not found"))?;
        let usb = device
            .usb
            .as_ref()
            .ok_or_else(|| anyhow!("device has no Local USB target"))?;
        (usb.port_path.clone(), next_id())
    };
    let _serial_guard =
        acquire_serial_port_guard(state, &port_path, allowed_exclusive_reason).await?;

    let request = json!({
        "id": request_id,
        "method": method,
        "params": params.unwrap_or_else(|| json!({})),
    });
    push_trace(state, device_id, "tx", method, &request).await;
    let response = tokio::task::spawn_blocking(move || serial_jsonl_roundtrip(&port_path, request))
        .await
        .context("serial worker join")??;
    push_trace(state, device_id, "rx", method, &response).await;
    Ok(response)
}

async fn usb_wifi_clear_request(state: &AppState, device_id: &str) -> anyhow::Result<Value> {
    let success = json!({
        "ok": true,
        "result": {
            "accepted": true,
            "reboot_required": false,
            "verified_after_serial_timeout": true,
        }
    });
    usb_wifi_credentials_clear_like_request(state, device_id, "wifi.clear", None, success).await
}

async fn usb_settings_reset_request(
    state: &AppState,
    device_id: &str,
    scope: &str,
    owner: Option<u32>,
) -> anyhow::Result<Value> {
    let params = Some(json!({"scope": scope, "owner": owner}));
    if scope == "wifi" {
        let success = json!({
            "ok": true,
            "result": {
                "accepted": true,
                "scope": "wifi",
                "reboot_required": false,
                "verified_after_serial_timeout": true,
            }
        });
        return usb_wifi_credentials_clear_like_request(
            state,
            device_id,
            "settings.reset",
            params,
            success,
        )
        .await;
    }
    let success = json!({
        "ok": true,
        "result": {
            "accepted": true,
            "scope": "other",
            "wifi_preserved": true,
            "verified_after_serial_reconnect": true,
        }
    });
    match usb_jsonl_request(state, device_id, "settings.reset", params).await {
        Ok(value) => Ok(value),
        Err(err) if should_verify_other_settings_reset_after_serial_error(&err) => {
            match verify_other_settings_reset_after_serial_reconnect(state, device_id).await {
                Ok(()) => Ok(success),
                Err(_) => Err(err),
            }
        }
        Err(err) => Err(err),
    }
}

async fn usb_wifi_credentials_clear_like_request(
    state: &AppState,
    device_id: &str,
    method: &str,
    params: Option<Value>,
    success: Value,
) -> anyhow::Result<Value> {
    match usb_jsonl_request(state, device_id, method, params).await {
        Ok(value) => Ok(value),
        Err(err) if err.to_string().contains("serial response timed out") => {
            match verify_wifi_cleared_after_serial_timeout(state, device_id).await {
                Ok(()) => Ok(success),
                Err(_) => Err(err),
            }
        }
        Err(err) => Err(err),
    }
}

async fn verify_wifi_cleared_after_serial_timeout(
    state: &AppState,
    device_id: &str,
) -> anyhow::Result<()> {
    let mut last_error = None;
    for _ in 0..10 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        match usb_jsonl_request(state, device_id, "wifi.get", None).await {
            Ok(value) => {
                if wifi_config_is_cleared(&value) {
                    return Ok(());
                }
                last_error = Some(anyhow!(
                    "Wi-Fi settings did not report cleared credentials yet"
                ));
            }
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("Wi-Fi clear did not verify after serial timeout")))
}

fn wifi_config_is_cleared(value: &Value) -> bool {
    let wifi = value.get("result").unwrap_or(value);
    wifi.get("configured").and_then(Value::as_bool) == Some(false)
        && wifi.get("psk_configured").and_then(Value::as_bool) == Some(false)
}

fn should_verify_other_settings_reset_after_serial_error(err: &anyhow::Error) -> bool {
    let message = err.to_string();
    message.contains("serial response timed out") || message.contains("serial read")
}

async fn verify_other_settings_reset_after_serial_reconnect(
    state: &AppState,
    device_id: &str,
) -> anyhow::Result<()> {
    let mut last_error = None;
    for _ in 0..12 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let ports = match usb_jsonl_request(state, device_id, "ports.get", None).await {
            Ok(value) => value,
            Err(err) => {
                last_error = Some(err);
                continue;
            }
        };
        let power = match usb_jsonl_request(state, device_id, "power.config_get", None).await {
            Ok(value) => value,
            Err(err) => {
                last_error = Some(err);
                continue;
            }
        };
        let idle_bias = match usb_jsonl_request(state, device_id, "power.idle_bias_get", None).await
        {
            Ok(value) => value,
            Err(err) => {
                last_error = Some(err);
                continue;
            }
        };
        if other_settings_reset_is_verified(&ports, &power, &idle_bias) {
            return Ok(());
        }
        last_error = Some(anyhow!(
            "other settings reset did not report default route, power config, and idle-bias state yet"
        ));
    }
    Err(last_error
        .unwrap_or_else(|| anyhow!("other settings reset did not verify after serial reconnect")))
}

fn other_settings_reset_is_verified(ports: &Value, power: &Value, idle_bias: &Value) -> bool {
    let hub = ports
        .get("result")
        .and_then(|result| result.get("hub"))
        .or_else(|| ports.get("hub"));
    let power = power.get("result").unwrap_or(power);
    let idle_bias = idle_bias.get("result").unwrap_or(idle_bias);
    hub.and_then(Value::as_object).is_some_and(|hub| {
        hub.get("usb_c_downstream_route").and_then(Value::as_str) == Some("mcu")
            && hub
                .get("usb_c_downstream_persisted")
                .and_then(Value::as_bool)
                == Some(false)
    }) && power.get("persisted").and_then(Value::as_bool) == Some(false)
        && power.get("tps_mode").and_then(Value::as_str) == Some("auto_follow")
        && power
            .get("manual")
            .and_then(|manual| manual.get("voltage_mv"))
            .and_then(Value::as_u64)
            == Some(5_000)
        && idle_bias.get("correction_enabled").and_then(Value::as_bool) == Some(false)
        && idle_bias
            .get("dataset")
            .and_then(|dataset| dataset.get("status"))
            .and_then(Value::as_str)
            == Some("missing")
}

async fn device_usb_port_path(state: &AppState, device_id: &str) -> anyhow::Result<String> {
    let inner = state.inner.lock().await;
    Ok(inner
        .devices
        .get(device_id)
        .ok_or_else(|| anyhow!("device not found"))?
        .usb
        .as_ref()
        .ok_or_else(|| anyhow!("device has no Local USB target"))?
        .port_path
        .clone())
}

#[cfg(test)]
mod device_io_tests {
    use super::*;

    #[test]
    fn settings_reset_uses_extended_serial_timeout() {
        assert_eq!(
            serial_timeout_ms_for_method("settings.reset"),
            SERIAL_SETTINGS_RESET_TIMEOUT_MS
        );
        assert_eq!(
            serial_timeout_ms_for_method("power.idle_bias_set"),
            SERIAL_POWER_CONFIG_EARLY_VERIFY_TIMEOUT_MS
        );
        assert_eq!(
            serial_timeout_ms_for_method("power.idle_bias_clear"),
            SERIAL_POWER_CONFIG_EARLY_VERIFY_TIMEOUT_MS
        );
        assert_eq!(serial_timeout_ms_for_method("power.idle_bias_run"), 178_000);
        assert_eq!(
            serial_timeout_ms_for_method("power.config_get"),
            SERIAL_READ_TIMEOUT_MS
        );
    }

    #[test]
    fn retries_only_transient_read_errors_for_read_only_methods() {
        let timeout = anyhow!("serial response timed out");
        let read_error = anyhow!("serial read: device disconnected");

        assert!(should_retry_read_only_serial_request(
            "power.config_get",
            &timeout
        ));
        assert!(should_retry_read_only_serial_request(
            "pd.diagnostics",
            &read_error
        ));
        assert!(!should_retry_read_only_serial_request(
            "power.runtime_set",
            &timeout
        ));
        assert!(!should_retry_read_only_serial_request(
            "ports.get",
            &anyhow!("device busy")
        ));
    }

    #[test]
    fn wifi_clear_verification_detects_cleared_credentials() {
        assert!(wifi_config_is_cleared(&json!({
            "ok": true,
            "result": {
                "configured": false,
                "psk_configured": false,
                "state": "idle",
                "ipv4": null
            }
        })));
        assert!(!wifi_config_is_cleared(&json!({
            "ok": true,
            "result": {
                "configured": true,
                "psk_configured": true,
                "state": "connected",
                "ipv4": "192.168.31.122"
            }
        })));
    }

    #[test]
    fn other_settings_reset_verification_detects_default_runtime() {
        assert!(other_settings_reset_is_verified(
            &json!({
                "ok": true,
                "result": {
                    "hub": {
                        "usb_c_downstream_route": "mcu",
                        "usb_c_downstream_persisted": false
                    }
                }
            }),
            &json!({
                "ok": true,
                "result": {
                    "persisted": false,
                    "tps_mode": "auto_follow",
                    "manual": {
                        "voltage_mv": 5000
                    }
                }
            }),
            &json!({
                "ok": true,
                "result": {
                    "correction_enabled": false,
                    "dataset": {
                        "status": "missing"
                    }
                }
            })
        ));
        assert!(!other_settings_reset_is_verified(
            &json!({
                "ok": true,
                "result": {
                    "hub": {
                        "usb_c_downstream_route": "mcu",
                        "usb_c_downstream_persisted": true
                    }
                }
            }),
            &json!({
                "ok": true,
                "result": {
                    "persisted": true,
                    "tps_mode": "manual",
                    "manual": {
                        "voltage_mv": 9000
                    }
                }
            }),
            &json!({
                "ok": true,
                "result": {
                    "correction_enabled": true,
                    "dataset": {
                        "status": "valid"
                    }
                }
            })
        ));
    }

    #[tokio::test]
    async fn serial_port_lock_is_reused_per_port() {
        let state = AppState::new("test://devd");
        let first = ensure_serial_port_lock(&state, "/dev/test-port").await;
        let second = ensure_serial_port_lock(&state, "/dev/test-port").await;
        let third = ensure_serial_port_lock(&state, "/dev/other-port").await;
        assert!(Arc::ptr_eq(&first, &second));
        assert!(!Arc::ptr_eq(&first, &third));
    }

    #[tokio::test]
    async fn serial_port_guard_rechecks_exclusive_state_after_wait() {
        let state = AppState::new("test://devd");
        let port_path = "/dev/test-port";
        let held = ensure_serial_port_lock(&state, port_path)
            .await
            .lock_owned()
            .await;
        let state_for_task = state.clone();
        let task = tokio::spawn(async move {
            acquire_serial_port_guard(&state_for_task, port_path, None)
                .await
                .map(|_| ())
        });
        tokio::time::sleep(Duration::from_millis(25)).await;
        {
            let mut inner = state.inner.lock().await;
            inner
                .exclusive_ports
                .insert(port_path.to_string(), "firmware flash".to_string());
        }
        drop(held);
        let err = task
            .await
            .expect("serial guard task should join")
            .expect_err("exclusive port should reject waiting request");
        assert!(err.to_string().contains("device busy"));
    }
}

fn serial_jsonl_roundtrip(port_path: &str, request: Value) -> anyhow::Result<Value> {
    serial_jsonl_roundtrip_with_timeout(port_path, request, None)
}

fn serial_jsonl_roundtrip_with_timeout(
    port_path: &str,
    request: Value,
    timeout_ms_override: Option<u64>,
) -> anyhow::Result<Value> {
    let mut port = serialport::new(port_path, SERIAL_BAUD)
        .timeout(Duration::from_millis(50))
        .open()
        .with_context(|| format!("open serial port {port_path}"))?;
    let mut line = serde_json::to_string(&request)?;
    line.push('\n');
    use std::io::{Read as _, Write as _};
    port.write_all(line.as_bytes()).context("serial write")?;
    port.flush().context("serial flush")?;

    let expected_id = request.get("id").cloned();
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let deadline = Instant::now()
        + Duration::from_millis(
            timeout_ms_override.unwrap_or_else(|| serial_timeout_ms_for_method(method)),
        );
    let mut raw = Vec::<u8>::new();
    let mut buf = [0_u8; 256];
    while Instant::now() < deadline {
        match port.read(&mut buf) {
            Ok(0) => {}
            Ok(n) => {
                raw.extend_from_slice(&buf[..n]);
                while let Some(pos) = raw.iter().position(|byte| *byte == b'\n') {
                    let frame = raw.drain(..=pos).collect::<Vec<_>>();
                    let text = String::from_utf8_lossy(&frame);
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
                        continue;
                    };
                    if expected_id.is_none() || value.get("id") == expected_id.as_ref() {
                        return Ok(value);
                    }
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::TimedOut => {}
            Err(err) => return Err(err).context("serial read"),
        }
    }
    Err(anyhow!("serial response timed out"))
}

async fn run_flash_request(
    state: &AppState,
    device_id: &str,
    req: FlashRequest,
) -> anyhow::Result<Value> {
    let catalog: FirmwareCatalog = serde_json::from_slice(&fs::read(&req.catalog_path)?)?;
    let errors = validate_catalog_shape(&catalog);
    if !errors.is_empty() {
        return Err(anyhow!("invalid firmware catalog: {}", errors.join(", ")));
    }
    let artifact = catalog
        .artifacts
        .iter()
        .find(|artifact| artifact.artifact_id == req.artifact_id)
        .ok_or_else(|| anyhow!("artifact not found: {}", req.artifact_id))?;
    let app_file = if req.first_time {
        artifact
            .files
            .iter()
            .find(|file| file.kind == "elf" || file.kind == "full_image")
            .ok_or_else(|| anyhow!("first-time flash requires an elf or full_image artifact"))?
    } else {
        artifact
            .files
            .iter()
            .find(|file| file.kind == "app_bin")
            .ok_or_else(|| anyhow!("normal flash requires an app_bin artifact"))?
    };
    verify_artifact_file(&req.catalog_path, app_file)?;

    if !req.real {
        return Ok(json!({
            "ok": true,
            "dry_run": true,
            "artifact_id": artifact.artifact_id,
            "target": artifact.target,
            "file": app_file.path,
        }));
    }

    let port_path = {
        let inner = state.inner.lock().await;
        inner
            .devices
            .get(device_id)
            .ok_or_else(|| anyhow!("device not found"))?
            .usb
            .as_ref()
            .ok_or_else(|| anyhow!("device has no Local USB target"))?
            .port_path
            .clone()
    };

    if req.first_time {
        if !req.confirm_non_project_firmware {
            let identity = require_project_firmware_for_upgrade(state, device_id)
                .await
                .context(
                    "recovery flash without explicit non-project confirmation requires a confirmed IsolaPurr target",
                )?;
            if let Some(expected_identity) = req.expected_identity.as_ref() {
                validate_device_identity(&identity, expected_identity)?;
            }
        }
    } else {
        let expected_identity = req
            .expected_identity
            .as_ref()
            .ok_or_else(|| anyhow!("normal flash requires expectedIdentity"))?;
        let identity = require_project_firmware_for_upgrade(state, device_id).await?;
        validate_device_identity(&identity, expected_identity)?;
    }

    let mut guard = acquire_flash_guard(state, &port_path).await?;

    let file_path = resolve_catalog_file_path(&req.catalog_path, &app_file.path);
    let output = if req.first_time && app_file.kind == "elf" {
        Command::new("espflash")
            .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
            .arg("flash")
            .arg("--chip")
            .arg("esp32s3")
            .arg("--port")
            .arg(&port_path)
            .arg(&file_path)
            .output()
            .context("start espflash flash")?
    } else {
        let address = app_file
            .flash_address
            .unwrap_or(if app_file.kind == "full_image" {
                0
            } else {
                DEFAULT_FLASH_ADDRESS
            });
        Command::new("espflash")
            .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
            .arg("write-bin")
            .arg("--chip")
            .arg("esp32s3")
            .arg("--port")
            .arg(&port_path)
            .arg(format!("0x{address:x}"))
            .arg(&file_path)
            .output()
            .context("start espflash write-bin")?
    };
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        drop(guard);
        return Err(anyhow!("espflash failed: {log}"));
    }
    guard.release_serial_lock();
    let captured_identity = if req.first_time {
        Some(capture_first_time_identity_after_flash(state, device_id).await?)
    } else {
        None
    };
    drop(guard);
    Ok(json!({
        "ok": true,
        "exit_code": output.status.code(),
        "artifact_id": artifact.artifact_id,
        "identity": captured_identity,
        "log": log,
    }))
}

async fn run_bundled_flash_request(
    state: &AppState,
    device_id: &str,
    req: BundledFirmwareFlashRequest,
) -> anyhow::Result<Value> {
    let errors = validate_catalog_shape(&req.catalog);
    if !errors.is_empty() {
        return Err(anyhow!("invalid firmware catalog: {}", errors.join(", ")));
    }
    let artifact = req
        .catalog
        .artifacts
        .iter()
        .find(|artifact| artifact.artifact_id == req.artifact_id)
        .ok_or_else(|| anyhow!("artifact not found: {}", req.artifact_id))?;
    let file = artifact
        .files
        .iter()
        .find(|file| file.kind == req.file_kind)
        .ok_or_else(|| anyhow!("artifact file not found: {}", req.file_kind))?;

    if req.first_time {
        let valid_recovery_asset = (artifact.target == "esp32s3_full" && file.kind == "full_image")
            || (artifact.target == "esp32s3_app" && file.kind == "elf");
        if !valid_recovery_asset {
            return Err(anyhow!(
                "recovery flash requires esp32s3_full/full_image or esp32s3_app/elf assets"
            ));
        }
    } else if artifact.target != "esp32s3_app" || file.kind != "app_bin" {
        return Err(anyhow!("normal flash requires esp32s3_app/app_bin assets"));
    }

    let bytes = decode_flash_payload(&req.file_base64)?;
    if bytes.len() as u64 != file.size {
        return Err(anyhow!(
            "artifact size mismatch for {}: expected {}, got {}",
            file.path,
            file.size,
            bytes.len()
        ));
    }
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != file.sha256.to_lowercase() {
        return Err(anyhow!(
            "artifact hash mismatch for {}: expected {}, got {actual}",
            file.path,
            file.sha256
        ));
    }

    let port_path = {
        let inner = state.inner.lock().await;
        inner
            .devices
            .get(device_id)
            .ok_or_else(|| anyhow!("device not found"))?
            .usb
            .as_ref()
            .ok_or_else(|| anyhow!("device has no Local USB target"))?
            .port_path
            .clone()
    };

    if req.first_time {
        if !req.confirm_non_project_firmware {
            let identity = require_project_firmware_for_upgrade(state, device_id)
                .await
                .context(
                    "recovery flash without explicit non-project confirmation requires a confirmed IsolaPurr target",
                )?;
            if let Some(expected_identity) = req.expected_identity.as_ref() {
                validate_device_identity(&identity, expected_identity)?;
            }
        }
    } else {
        let expected_identity = req
            .expected_identity
            .as_ref()
            .ok_or_else(|| anyhow!("normal flash requires expectedIdentity"))?;
        let identity = require_project_firmware_for_upgrade(state, device_id).await?;
        validate_device_identity(&identity, expected_identity)?;
    }

    let temp_file = write_temp_firmware_file(&req.file_name, bytes)?;
    let mut guard = acquire_flash_guard(state, &port_path).await?;
    let output = if req.first_time && file.kind == "elf" {
        Command::new("espflash")
            .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
            .arg("flash")
            .arg("--chip")
            .arg("esp32s3")
            .arg("--port")
            .arg(&port_path)
            .arg(&temp_file.0)
            .output()
            .context("start espflash flash")?
    } else {
        let address = file.flash_address.unwrap_or(if req.first_time {
            0
        } else {
            DEFAULT_FLASH_ADDRESS
        });
        Command::new("espflash")
            .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
            .arg("write-bin")
            .arg("--chip")
            .arg("esp32s3")
            .arg("--port")
            .arg(&port_path)
            .arg(format!("0x{address:x}"))
            .arg(&temp_file.0)
            .output()
            .context("start espflash write-bin")?
    };
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        drop(guard);
        return Err(anyhow!("espflash failed: {log}"));
    }
    guard.release_serial_lock();
    let captured_identity = if req.first_time {
        Some(capture_first_time_identity_after_flash(state, device_id).await?)
    } else {
        None
    };
    drop(guard);
    Ok(json!({
        "ok": true,
        "exit_code": output.status.code(),
        "artifact_id": artifact.artifact_id,
        "target": artifact.target,
        "identity": captured_identity,
        "log": log,
    }))
}

async fn run_uploaded_flash_request(
    state: &AppState,
    device_id: &str,
    req: FirmwareUploadFlashRequest,
) -> anyhow::Result<Value> {
    if req.address != DEFAULT_FLASH_ADDRESS {
        return Err(anyhow!(
            "Local USB firmware flashing writes the app image at 0x10000"
        ));
    }
    let port_path = {
        let inner = state.inner.lock().await;
        inner
            .devices
            .get(device_id)
            .ok_or_else(|| anyhow!("device not found"))?
            .usb
            .as_ref()
            .ok_or_else(|| anyhow!("device has no Local USB target"))?
            .port_path
            .clone()
    };
    let identity = require_project_firmware_for_upgrade(state, device_id).await?;
    validate_device_identity(&identity, &req.expected_identity)?;

    let bytes = decode_flash_payload(&req.file_base64)?;
    let temp_file = write_temp_firmware_file(&req.file_name, bytes)?;
    let guard = acquire_flash_guard(state, &port_path).await?;
    let output = Command::new("espflash")
        .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
        .arg("write-bin")
        .arg("--chip")
        .arg("esp32s3")
        .arg("--port")
        .arg(&port_path)
        .arg(format!("0x{:x}", req.address))
        .arg(&temp_file.0)
        .output()
        .context("start espflash write-bin")?;
    drop(guard);
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(anyhow!("espflash failed: {log}"));
    }
    Ok(json!({
        "ok": true,
        "exit_code": output.status.code(),
        "log": log,
    }))
}

struct TempFirmwareFile(PathBuf);

impl Drop for TempFirmwareFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn decode_flash_payload(file_base64: &str) -> anyhow::Result<Vec<u8>> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(file_base64.trim())
        .context("firmware payload was not valid base64")
}

fn write_temp_firmware_file(file_name: &str, bytes: Vec<u8>) -> anyhow::Result<TempFirmwareFile> {
    let file_name = FsPath::new(file_name.trim())
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("firmware.bin");
    let temp_path = std::env::temp_dir().join(format!("isolapurr-flash-{}-{file_name}", next_id()));
    fs::write(&temp_path, bytes).with_context(|| format!("write {}", temp_path.display()))?;
    Ok(TempFirmwareFile(temp_path))
}

async fn acquire_flash_guard(state: &AppState, port_path: &str) -> anyhow::Result<ExclusiveGuard> {
    let serial_guard = acquire_serial_port_guard(state, port_path, None).await?;
    {
        let mut inner = state.inner.lock().await;
        if inner.exclusive_ports.contains_key(port_path) {
            return Err(anyhow!("device busy"));
        }
        inner
            .exclusive_ports
            .insert(port_path.to_string(), "firmware flash".to_string());
    }
    Ok(ExclusiveGuard {
        state: state.clone(),
        port_path: port_path.to_string(),
        serial_guard: Some(serial_guard),
    })
}

struct ExclusiveGuard {
    state: AppState,
    port_path: String,
    serial_guard: Option<OwnedMutexGuard<()>>,
}

impl ExclusiveGuard {
    fn release_serial_lock(&mut self) {
        self.serial_guard.take();
    }
}

impl Drop for ExclusiveGuard {
    fn drop(&mut self) {
        self.serial_guard.take();
        let state = self.state.clone();
        let port_path = self.port_path.clone();
        tokio::spawn(async move {
            state.inner.lock().await.exclusive_ports.remove(&port_path);
        });
    }
}

async fn require_lease(
    state: &AppState,
    device_id: &str,
    lease_id: Option<&str>,
) -> Result<(), Box<Response>> {
    cleanup_expired_leases(state).await;
    let Some(lease_id) = lease_id else {
        return Err(Box::new(unauthorized("lease_id is required")));
    };
    let inner = state.inner.lock().await;
    let Some(lease) = inner.leases.get(lease_id) else {
        return Err(Box::new(unauthorized("lease not found or expired")));
    };
    if lease.device_id != device_id {
        return Err(Box::new(unauthorized("lease does not belong to device")));
    }
    Ok(())
}

async fn cleanup_expired_leases(state: &AppState) {
    let now = Instant::now();
    state
        .inner
        .lock()
        .await
        .leases
        .retain(|_, lease| lease.expires_at > now);
}

fn list_serial_ports() -> anyhow::Result<Vec<UsbTarget>> {
    let targets = serialport::available_ports()?
        .into_iter()
        .filter_map(|port| {
            let (vendor_id, product_id, serial_number, manufacturer, product) = match port.port_type
            {
                serialport::SerialPortType::UsbPort(info) => (
                    Some(info.vid),
                    Some(info.pid),
                    info.serial_number,
                    info.manufacturer,
                    info.product,
                ),
                _ => (None, None, None, None, None),
            };
            let label = product
                .clone()
                .or(manufacturer)
                .unwrap_or_else(|| port.port_name.clone());
            let target = UsbTarget {
                port_path: port.port_name,
                label,
                vendor_id,
                product_id,
                serial_number,
            };
            is_esp32_serial_port(&target).then_some(target)
        })
        .collect();
    Ok(dedupe_usb_serial_device_pairs(targets))
}

fn is_esp32_serial_port(port: &UsbTarget) -> bool {
    let path = port.port_path.to_lowercase();
    if path.contains("bluetooth") || path.contains("debug-console") {
        return false;
    }
    if port.vendor_id == Some(0x303a) {
        return true;
    }
    let label = port.label.to_lowercase();
    let path_looks_serial = path.contains("usbmodem")
        || path.contains("usbserial")
        || path.contains("ttyacm")
        || (path.starts_with("com") && path[3..].chars().all(|c| c.is_ascii_digit()));
    path_looks_serial
        && (label.contains("esp32") || label.contains("espressif") || label.contains("usb jtag"))
}

fn dedupe_usb_serial_device_pairs(mut targets: Vec<UsbTarget>) -> Vec<UsbTarget> {
    targets.sort_by(|a, b| {
        let a_cu = if is_cu_port(&a.port_path) { 0 } else { 1 };
        let b_cu = if is_cu_port(&b.port_path) { 0 } else { 1 };
        a_cu.cmp(&b_cu).then_with(|| a.port_path.cmp(&b.port_path))
    });

    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for target in targets {
        let key = target
            .serial_number
            .clone()
            .unwrap_or_else(|| paired_serial_device_key(&target.port_path));
        if seen.insert(key) {
            deduped.push(target);
        }
    }
    deduped
}

fn is_cu_port(path: &str) -> bool {
    path.starts_with("/dev/cu.")
}

fn paired_serial_device_key(path: &str) -> String {
    path.replacen("/dev/tty.", "/dev/cu.", 1)
}

fn stable_usb_device_id(port_path: &str) -> String {
    let sanitized = port_path
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    format!("usb-{sanitized}")
}

fn stable_http_device_id(base_url: &str) -> String {
    let sanitized = base_url
        .trim()
        .trim_end_matches('/')
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    format!("http-{sanitized}")
}
