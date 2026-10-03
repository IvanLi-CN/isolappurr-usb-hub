fn default_serial_baud_rate() -> u32 {
    115_200
}

fn default_serial_timeout_ms() -> u64 {
    1_500
}

fn print_json<T: Serialize>(value: &T) -> anyhow::Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn format_optional_hex(value: Option<u16>) -> String {
    value
        .map(|value| format!("0x{value:04x}"))
        .unwrap_or_else(|| "unknown".to_string())
}

fn parse_json_params(value: Option<&str>) -> anyhow::Result<serde_json::Value> {
    match value {
        Some(value) if !value.trim().is_empty() => {
            serde_json::from_str(value).context("--params must be valid JSON")
        }
        _ => Ok(serde_json::Value::Object(Default::default())),
    }
}

fn parse_flash_address(value: &str) -> anyhow::Result<u32> {
    let value = value.trim();
    let parsed = if let Some(hex) = value.strip_prefix("0x") {
        u32::from_str_radix(hex, 16)
    } else {
        value.parse()
    }
    .with_context(|| format!("invalid flash address: {value}"))?;
    if parsed != DEFAULT_FLASH_ADDRESS {
        return Err(anyhow!(
            "only the ESP32-S3 app partition address 0x10000 is supported by default"
        ));
    }
    Ok(parsed)
}

fn list_serial_ports() -> serialport::Result<Vec<SerialPortInfo>> {
    serialport::available_ports().map(|ports| {
        ports
            .into_iter()
            .map(|port| {
                let (vendor_id, product_id, serial_number, manufacturer, product) =
                    match port.port_type {
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
                    .or_else(|| manufacturer.clone())
                    .unwrap_or_else(|| port.port_name.clone());
                SerialPortInfo {
                    path: port.port_name,
                    label,
                    vendor_id,
                    product_id,
                    serial_number,
                    manufacturer,
                    product,
                }
            })
            .collect::<Vec<_>>()
    })
}

fn filter_esp32_serial_ports(mut ports: Vec<SerialPortInfo>) -> Vec<SerialPortInfo> {
    ports.retain(is_esp32_serial_port);
    ports.sort_by(|a, b| {
        let a_cu = if a.path.starts_with("/dev/cu.") { 0 } else { 1 };
        let b_cu = if b.path.starts_with("/dev/cu.") { 0 } else { 1 };
        a_cu.cmp(&b_cu).then_with(|| a.path.cmp(&b.path))
    });
    let mut seen = std::collections::HashSet::new();
    ports
        .into_iter()
        .filter(|port| {
            let key = port
                .serial_number
                .clone()
                .unwrap_or_else(|| port.path.replace("/dev/tty.", "/dev/cu."));
            seen.insert(key)
        })
        .collect()
}

fn is_esp32_serial_port(port: &SerialPortInfo) -> bool {
    let path = port.path.to_lowercase();
    if path.contains("bluetooth") || path.contains("debug-console") {
        return false;
    }
    let manufacturer = port.manufacturer.as_deref().unwrap_or("").to_lowercase();
    let product = port
        .product
        .as_deref()
        .unwrap_or(&port.label)
        .to_lowercase();
    let vendor_matches = port.vendor_id == Some(0x303a);
    if vendor_matches && port.product_id == Some(0x1001) {
        return true;
    }
    let path_looks_like_usb_serial = path.contains("usbmodem")
        || path.contains("usbserial")
        || path.contains("ttyacm")
        || (path.len() > 3
            && path.starts_with("com")
            && path[3..].chars().all(|c| c.is_ascii_digit()));
    let espressif_text_matches = manufacturer.contains("espressif")
        || product.contains("esp32")
        || product.contains("jtag/serial")
        || product.contains("usb jtag");
    path_looks_like_usb_serial && espressif_text_matches
}

async fn api_serial_ports(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }

    let result = tokio::task::spawn_blocking(list_serial_ports).await;

    match result {
        Ok(Ok(ports)) => Json(SerialPortsResponse { ports }).into_response(),
        Ok(Err(err)) => internal_error(&format!("serial port enumeration failed: {err}")),
        Err(err) => internal_error(&format!("serial port task failed: {err}")),
    }
}

async fn api_serial_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SerialJsonlRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    if req.port_path.trim().is_empty() {
        return bad_request("portPath is required");
    }

    let _guard = state.serial_lock.lock().await;

    let result = tokio::task::spawn_blocking(move || run_serial_jsonl_request(req)).await;
    match result {
        Ok(Ok(response)) => Json(response).into_response(),
        Ok(Err(err)) => internal_error(&err),
        Err(err) => internal_error(&format!("serial request task failed: {err}")),
    }
}

fn run_serial_jsonl_request(req: SerialJsonlRequest) -> Result<SerialJsonlResponse, String> {
    let timeout = StdDuration::from_millis(req.timeout_ms.clamp(250, 10_000));
    let expected_id = req.request.get("id").cloned();
    let mut port = serialport::new(&req.port_path, req.baud_rate)
        .timeout(StdDuration::from_millis(50))
        .open()
        .map_err(|err| format!("open {} failed: {err}", req.port_path))?;
    port.write_data_terminal_ready(true)
        .map_err(|err| format!("serial DTR setup failed: {err}"))?;
    std::thread::sleep(StdDuration::from_millis(150));
    let _ = port.clear(ClearBuffer::Input);

    let mut line = serde_json::to_string(&req.request).map_err(|err| err.to_string())?;
    line.push('\n');
    port.write_all(line.as_bytes())
        .map_err(|err| format!("serial write failed: {err}"))?;
    port.flush()
        .map_err(|err| format!("serial flush failed: {err}"))?;

    let mut raw = String::new();
    let mut pending = Vec::<u8>::new();
    let mut buf = [0u8; 64];
    let deadline = StdInstant::now() + timeout;
    while StdInstant::now() < deadline {
        match port.read(&mut buf) {
            Ok(0) => continue,
            Ok(n) => {
                let chunk = &buf[..n];
                pending.extend_from_slice(chunk);
                while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
                    let line: Vec<u8> = pending.drain(..=newline).collect();
                    let line = String::from_utf8_lossy(&line);
                    raw.push_str(&line);
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    match serde_json::from_str(trimmed) {
                        Ok(response) if jsonl_response_matches(&response, expected_id.as_ref()) => {
                            return Ok(SerialJsonlResponse { response, raw });
                        }
                        Ok(_) => continue,
                        Err(_) => continue,
                    }
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(err) => return Err(format!("serial read failed: {err}")),
        }
    }
    Err("serial response timed out".to_string())
}

fn jsonl_response_matches(
    response: &serde_json::Value,
    expected_id: Option<&serde_json::Value>,
) -> bool {
    let Some(expected_id) = expected_id else {
        return true;
    };
    match response.get("id") {
        Some(actual) if actual == expected_id => true,
        Some(actual) => {
            actual.to_string().trim_matches('"') == expected_id.to_string().trim_matches('"')
        }
        None => false,
    }
}

fn identify_port(port_path: &str) -> Result<PortIdentityCache, String> {
    let response = run_serial_jsonl_request(SerialJsonlRequest {
        port_path: port_path.to_string(),
        baud_rate: default_serial_baud_rate(),
        timeout_ms: 2_500,
        request: serde_json::json!({
            "id": 1,
            "method": "info",
            "params": {},
        }),
    })?;
    let identity = extract_device_identity(&response.response)
        .ok_or_else(|| "info response did not include device_id or mac".to_string())?;
    Ok(PortIdentityCache {
        port: port_path.to_string(),
        identity: None,
        device_id: identity.device_id,
        mac: identity.mac,
        confirmed_at: time::OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "unknown".to_string()),
        source: "isolapurr-desktop serial identify".to_string(),
    })
}

fn identify_port_with_retries(
    port_path: &str,
    attempts: usize,
    delay: StdDuration,
) -> Result<PortIdentityCache, String> {
    let attempts = attempts.max(1);
    let mut last_err = String::new();
    for attempt in 0..attempts {
        match identify_port(port_path) {
            Ok(identity) => return Ok(identity),
            Err(err) => {
                last_err = err;
                if attempt + 1 < attempts {
                    std::thread::sleep(delay);
                }
            }
        }
    }
    Err(last_err)
}

fn unconfirmed_port_cache(port_path: &str) -> PortIdentityCache {
    PortIdentityCache {
        port: port_path.to_string(),
        identity: Some(PORT_IDENTITY_UNCONFIRMED.to_string()),
        device_id: None,
        mac: None,
        confirmed_at: time::OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_else(|_| "unknown".to_string()),
        source: "isolapurr-desktop select-port".to_string(),
    }
}

fn is_unconfirmed_identity_error(err: &str) -> bool {
    err.contains("serial response timed out")
        || err.contains("info response did not include device_id or mac")
}

fn extract_device_identity(value: &serde_json::Value) -> Option<DeviceIdentityExpectation> {
    let candidates = [
        value.pointer("/result/device"),
        value.pointer("/device"),
        value.pointer("/result"),
        Some(value),
    ];
    for candidate in candidates.into_iter().flatten() {
        let device_id = candidate
            .get("device_id")
            .or_else(|| candidate.get("deviceId"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let mac = candidate
            .get("mac")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        if device_id.is_some() || mac.is_some() {
            return Some(DeviceIdentityExpectation { device_id, mac });
        }
    }
    None
}

fn write_port_preference_cache(identity: &PortIdentityCache) -> anyhow::Result<()> {
    let mut body = format!("{}\n", identity.port.trim());
    if let Some(identity_state) = identity.identity.as_deref() {
        body.push_str(&format!("identity={}\n", identity_state.trim()));
    }
    if let Some(device_id) = identity.device_id.as_deref() {
        body.push_str(&format!("device_id={}\n", device_id.trim()));
    }
    if let Some(mac) = identity.mac.as_deref() {
        body.push_str(&format!("mac={}\n", mac.trim()));
    }
    body.push_str(&format!("confirmed_at={}\n", identity.confirmed_at.trim()));
    body.push_str(&format!("source={}\n", identity.source.trim()));
    std::fs::write(local_project_file(PORT_CACHE_FILE_NAME), body).context("write .esp32-port")
}

fn read_port_preference_cache() -> anyhow::Result<Option<PortIdentityCache>> {
    let path = local_project_file(PORT_CACHE_FILE_NAME);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err).context("read .esp32-port"),
    };
    parse_port_preference_cache(&raw)
}

fn parse_port_preference_cache(raw: &str) -> anyhow::Result<Option<PortIdentityCache>> {
    let mut lines = raw.lines().map(str::trim).filter(|line| !line.is_empty());
    let Some(port) = lines.next() else {
        return Ok(None);
    };
    let mut cache = PortIdentityCache {
        port: port.to_string(),
        identity: None,
        device_id: None,
        mac: None,
        confirmed_at: "unknown".to_string(),
        source: "isolapurr .esp32-port".to_string(),
    };
    for line in lines {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match key.trim() {
            "identity" => cache.identity = Some(value.to_string()),
            "device_id" | "deviceId" => cache.device_id = Some(value.to_string()),
            "mac" => cache.mac = Some(value.to_string()),
            "confirmed_at" | "confirmedAt" => cache.confirmed_at = value.to_string(),
            "source" => cache.source = value.to_string(),
            _ => {}
        }
    }
    validate_port_identity_cache(&cache, PORT_CACHE_FILE_NAME)?;
    Ok(Some(cache))
}

fn validate_port_identity_cache(cache: &PortIdentityCache, label: &str) -> anyhow::Result<()> {
    if cache.port.trim().is_empty() {
        return Err(anyhow!("{label} must include port"));
    }
    if cache.has_identity() {
        return Ok(());
    }
    if cache.is_unconfirmed() {
        return Ok(());
    }
    if cache.identity.is_some() {
        return Err(anyhow!("{label} has unsupported identity state"));
    }
    Err(anyhow!(
        "{label} must include device_id/mac or identity=unconfirmed"
    ))
}

fn confirm_unverified_flash(port_path: &str, bin_path: &Path, address: u32) -> anyhow::Result<()> {
    eprintln!(
        "warning: {PORT_CACHE_FILE_NAME} has identity=unconfirmed; this is only for first-time hardware or download mode."
    );
    eprintln!(
        "This will bootstrap flash {} to {} without pre-flash device identity verification.",
        bin_path.display(),
        port_path
    );
    eprintln!(
        "For first-time hardware this writes bootloader, partition table, and app; repeated confirmed flashing still writes only the app at 0x{:x}.",
        address
    );
    eprint!("Type 'yes' to continue: ");
    std::io::stderr().flush().ok();
    let mut confirm = String::new();
    std::io::stdin()
        .read_line(&mut confirm)
        .context("read confirmation")?;
    if confirm.trim() != "yes" {
        return Err(anyhow!(
            "aborted unconfirmed first flash; run just select-port to reselect or PORT=/dev/cu.xxx just identify when firmware is running"
        ));
    }
    Ok(())
}

fn local_project_file(name: &str) -> PathBuf {
    std::env::var_os("ISOLAPURR_REPO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(name)
}

fn validate_flash_identity(
    port_path: &str,
    expected: &DeviceIdentityExpectation,
) -> Result<PortIdentityCache, String> {
    if expected.device_id.is_none() && expected.mac.is_none() {
        return Err("firmware flash requires an expected device_id or mac".to_string());
    }
    let actual = identify_port_for_confirmed_flash(port_path)?;
    ensure_identity_matches(&actual, expected)?;
    Ok(actual)
}

fn identify_port_for_confirmed_flash(port_path: &str) -> Result<PortIdentityCache, String> {
    match identify_port_with_retries(port_path, 2, StdDuration::from_millis(400)) {
        Ok(identity) => Ok(identity),
        Err(first_err) if first_err.contains("serial response timed out") => {
            let _ = run_firmware_reset(port_path);
            identify_port_with_retries(port_path, 3, StdDuration::from_secs(1))
        }
        Err(err) => Err(err),
    }
}

fn ensure_identity_matches(
    actual: &PortIdentityCache,
    expected: &DeviceIdentityExpectation,
) -> Result<(), String> {
    if let Some(expected_device_id) = expected.device_id.as_deref() {
        if actual.device_id.as_deref() != Some(expected_device_id) {
            return Err(format!(
                "device identity mismatch: expected device_id {expected_device_id}, got {}",
                actual.device_id.as_deref().unwrap_or("unknown")
            ));
        }
    }
    if let Some(expected_mac) = expected.mac.as_deref() {
        let actual_mac = actual.mac.as_deref().unwrap_or("unknown");
        if !actual_mac.eq_ignore_ascii_case(expected_mac) {
            return Err(format!(
                "device identity mismatch: expected mac {expected_mac}, got {actual_mac}"
            ));
        }
    }
    Ok(())
}

async fn api_firmware_flash(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<FirmwareFlashRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    if req.port_path.trim().is_empty() {
        return bad_request("portPath is required");
    }
    if req.address != DEFAULT_FLASH_ADDRESS {
        return bad_request("only the ESP32-S3 app partition address 0x10000 is supported");
    }
    if req.expected_identity.is_none() {
        return bad_request("firmware flash requires expectedIdentity");
    }

    let _guard = state.serial_lock.lock().await;

    let result = tokio::task::spawn_blocking(move || run_firmware_flash(req)).await;
    match result {
        Ok(Ok(response)) => Json(response).into_response(),
        Ok(Err(err)) => internal_error(&err),
        Err(err) => internal_error(&format!("firmware flash task failed: {err}")),
    }
}

fn run_firmware_flash(req: FirmwareFlashRequest) -> Result<FirmwareFlashResponse, String> {
    if req.address != DEFAULT_FLASH_ADDRESS {
        return Err("only the ESP32-S3 app partition address 0x10000 is supported".to_string());
    }
    if let Some(expected_identity) = req.expected_identity.as_ref() {
        validate_flash_identity(&req.port_path, expected_identity)?;
    }

    let firmware = base64::engine::general_purpose::STANDARD
        .decode(req.file_base64.trim())
        .map_err(|err| format!("firmware payload was not valid base64: {err}"))?;
    struct TempFirmwareFile(PathBuf);
    impl Drop for TempFirmwareFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let temp_path = {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|err| format!("clock error: {err}"))?
            .as_nanos();
        let file_name = Path::new(req.file_name.trim())
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("firmware.bin");
        std::env::temp_dir().join(format!("isolapurr-flash-{stamp}-{file_name}"))
    };
    let _temp_file = TempFirmwareFile(temp_path.clone());
    std::fs::write(&temp_path, firmware)
        .map_err(|err| format!("failed to write temp firmware image: {err}"))?;

    let output = Command::new("espflash")
        .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
        .arg("write-bin")
        .arg("--chip")
        .arg("esp32s3")
        .arg("--port")
        .arg(&req.port_path)
        .arg(format!("0x{:x}", req.address))
        .arg(&temp_path)
        .output()
        .map_err(|err| format!("failed to start espflash: {err}"))?;

    let mut log = String::new();
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok(FirmwareFlashResponse {
        ok: output.status.success(),
        exit_code: output.status.code(),
        log,
    })
}

fn run_firmware_flash_file(
    port_path: &str,
    bin_path: &Path,
    address: u32,
    expected_identity: Option<DeviceIdentityExpectation>,
) -> Result<FirmwareFlashResponse, String> {
    if bin_path.extension().and_then(|value| value.to_str()) != Some("bin") {
        return Err("firmware flash only accepts app .bin images".to_string());
    }
    let bytes = std::fs::read(bin_path).map_err(|err| {
        format!(
            "failed to read firmware image {}: {err}",
            bin_path.display()
        )
    })?;
    run_firmware_flash(FirmwareFlashRequest {
        port_path: port_path.to_string(),
        address,
        file_name: bin_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("firmware.bin")
            .to_string(),
        file_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        expected_identity,
    })
}

fn run_firmware_full_flash_elf(
    port_path: &str,
    elf_path: &Path,
) -> Result<FirmwareFlashResponse, String> {
    if !elf_path.exists() {
        return Err(format!("ELF does not exist: {}", elf_path.display()));
    }
    let output = Command::new("espflash")
        .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
        .arg("flash")
        .arg("--chip")
        .arg("esp32s3")
        .arg("--port")
        .arg(port_path)
        .arg(elf_path)
        .output()
        .map_err(|err| format!("failed to start espflash: {err}"))?;
    let mut log = String::new();
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok(FirmwareFlashResponse {
        ok: output.status.success(),
        exit_code: output.status.code(),
        log,
    })
}

fn wait_for_serial_port(port_path: &str, timeout: StdDuration) -> bool {
    let deadline = StdInstant::now() + timeout;
    while StdInstant::now() < deadline {
        if serial_port_is_available(port_path) {
            return true;
        }
        std::thread::sleep(StdDuration::from_millis(100));
    }
    serial_port_is_available(port_path)
}

fn run_firmware_make_bin(
    elf_path: &Path,
    out_path: &Path,
) -> Result<FirmwareMakeBinResponse, String> {
    if !elf_path.exists() {
        return Err(format!("ELF does not exist: {}", elf_path.display()));
    }
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create {}: {err}", parent.display()))?;
    }
    let output = Command::new("espflash")
        .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
        .arg("save-image")
        .arg("--chip")
        .arg("esp32s3")
        .arg(elf_path)
        .arg(out_path)
        .output()
        .map_err(|err| format!("failed to start espflash: {err}"))?;
    let mut log = String::new();
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok(FirmwareMakeBinResponse {
        ok: output.status.success(),
        exit_code: output.status.code(),
        elf: elf_path.display().to_string(),
        out: out_path.display().to_string(),
        log,
    })
}

fn run_firmware_reset(port_path: &str) -> Result<FirmwareResetResponse, String> {
    let mut evidence = Vec::new();
    evidence.push(format!("opening serial port {port_path}"));
    {
        let mut port = serialport::new(port_path, default_serial_baud_rate())
            .timeout(StdDuration::from_millis(100))
            .open()
            .map_err(|err| format!("open {port_path} failed: {err}"))?;
        evidence.push("using ESP32-S3 USB Serial/JTAG DTR/RTS hard reset sequence".to_string());
        reset_esp32s3_usb_jtag(&mut *port)
            .map_err(|err| format!("reset control line sequence failed: {err}"))?;
    }
    let deadline = StdInstant::now() + StdDuration::from_secs(3);
    let mut port_available = serial_port_is_available(port_path);
    while !port_available && StdInstant::now() < deadline {
        std::thread::sleep(StdDuration::from_millis(100));
        port_available = serial_port_is_available(port_path);
    }
    if port_available {
        evidence.push(format!("port available after reset: {port_path}"));
    } else {
        evidence.push(format!(
            "port did not reappear within reset window: {port_path}"
        ));
    }
    Ok(FirmwareResetResponse {
        ok: port_available,
        port: port_path.to_string(),
        method: "esp32s3-usb-jtag-dtr-rts-hard-reset",
        port_available,
        evidence,
    })
}

fn serial_port_is_available(port_path: &str) -> bool {
    if Path::new(port_path).exists() {
        return true;
    }
    serialport::available_ports()
        .map(|ports| {
            ports
                .into_iter()
                .any(|port| serial_port_name_matches(&port.port_name, port_path))
        })
        .unwrap_or(false)
}

fn serial_port_name_matches(actual: &str, expected: &str) -> bool {
    actual == expected || actual.eq_ignore_ascii_case(expected)
}

fn reset_esp32s3_usb_jtag(port: &mut dyn serialport::SerialPort) -> serialport::Result<()> {
    port.write_data_terminal_ready(false)?;
    port.write_request_to_send(false)?;
    std::thread::sleep(StdDuration::from_millis(100));
    port.write_data_terminal_ready(true)?;
    port.write_request_to_send(false)?;
    std::thread::sleep(StdDuration::from_millis(100));
    port.write_data_terminal_ready(false)?;
    port.write_request_to_send(true)?;
    std::thread::sleep(StdDuration::from_millis(100));
    port.write_data_terminal_ready(false)?;
    port.write_request_to_send(false)?;
    std::thread::sleep(StdDuration::from_millis(500));
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
struct MonitorRecord {
    kind: &'static str,
    line: Option<String>,
    data_base64: Option<String>,
    byte_len: Option<usize>,
}

impl MonitorRecord {
    fn text(kind: &'static str, line: &str) -> Self {
        Self {
            kind,
            line: Some(line.to_string()),
            data_base64: None,
            byte_len: None,
        }
    }

    fn binary(bytes: &[u8]) -> Self {
        Self {
            kind: "binary",
            line: None,
            data_base64: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
            byte_len: Some(bytes.len()),
        }
    }
}

#[derive(Debug, Default)]
struct MonitorParserState {
    binary_fragment_budget: usize,
}

impl MonitorParserState {
    fn parse_line(&mut self, line: &[u8]) -> MonitorRecord {
        let parsed = parse_monitor_record(line);
        let parsed_binary = parsed.kind == "binary";
        let should_fold_fragment = self.binary_fragment_budget > 0
            && parsed.kind == "log"
            && is_single_byte_monitor_fragment(trim_monitor_line_bytes(line));
        let record = if should_fold_fragment {
            MonitorRecord::binary(trim_monitor_line_bytes(line))
        } else {
            parsed
        };

        self.binary_fragment_budget = if parsed_binary { 1 } else { 0 };
        record
    }
}

fn run_firmware_monitor(
    port_path: &str,
    elf_path: Option<&Path>,
    reset: bool,
    json: bool,
) -> anyhow::Result<()> {
    if !json {
        if let Some(elf_path) = elf_path {
            return run_espflash_monitor(port_path, elf_path, reset);
        }
    }
    if reset {
        let response = run_firmware_reset(port_path).map_err(anyhow::Error::msg)?;
        if !response.ok {
            return Err(anyhow!("reset before monitor failed"));
        }
    }
    if !json {
        eprintln!("warning: no --elf provided; falling back to raw serial text monitor");
    }
    let mut port = serialport::new(port_path, default_serial_baud_rate())
        .timeout(StdDuration::from_millis(200))
        .open()
        .with_context(|| format!("open {port_path} failed"))?;
    let mut pending = Vec::<u8>::new();
    let mut buf = [0u8; 256];
    let mut parser_state = MonitorParserState::default();
    loop {
        match port.read(&mut buf) {
            Ok(0) => continue,
            Ok(n) => {
                pending.extend_from_slice(&buf[..n]);
                while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
                    let line: Vec<u8> = pending.drain(..=newline).collect();
                    let record = parser_state.parse_line(&line);
                    if record.kind == "log" && record.line.as_deref() == Some("") {
                        continue;
                    }
                    if json {
                        println!("{}", serde_json::to_string(&monitor_record_json(&record))?);
                    } else if let Some(line) = record.line.as_deref() {
                        println!("[{}] {line}", record.kind);
                    } else {
                        println!(
                            "[{}] {} bytes base64:{}",
                            record.kind,
                            record.byte_len.unwrap_or(0),
                            record.data_base64.as_deref().unwrap_or("")
                        );
                    }
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(err) => return Err(anyhow!("serial monitor read failed: {err}")),
        }
    }
}

fn parse_monitor_record(bytes: &[u8]) -> MonitorRecord {
    let bytes = trim_monitor_line_bytes(bytes);
    let Ok(line) = std::str::from_utf8(bytes) else {
        return MonitorRecord::binary(bytes);
    };
    if contains_monitor_control_bytes(line) {
        return MonitorRecord::binary(bytes);
    }
    let kind = classify_monitor_line(line);
    MonitorRecord::text(kind, line)
}

fn trim_monitor_line_bytes(bytes: &[u8]) -> &[u8] {
    let mut end = bytes.len();
    while end > 0 && matches!(bytes[end - 1], b'\r' | b'\n') {
        end -= 1;
    }
    &bytes[..end]
}

fn contains_monitor_control_bytes(line: &str) -> bool {
    line.chars().any(|ch| ch.is_control() && ch != '\t')
}

fn is_single_byte_monitor_fragment(bytes: &[u8]) -> bool {
    matches!(bytes, [byte] if byte.is_ascii_graphic())
}

fn monitor_record_json(record: &MonitorRecord) -> serde_json::Value {
    if let Some(line) = record.line.as_deref() {
        serde_json::json!({
            "kind": record.kind,
            "line": line,
        })
    } else {
        serde_json::json!({
            "kind": record.kind,
            "byte_len": record.byte_len.unwrap_or(0),
            "data_base64": record.data_base64.as_deref().unwrap_or(""),
        })
    }
}

fn run_espflash_monitor(port_path: &str, elf_path: &Path, reset: bool) -> anyhow::Result<()> {
    if !elf_path.exists() {
        return Err(anyhow!("ELF does not exist: {}", elf_path.display()));
    }
    let status = Command::new("espflash")
        .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
        .arg("monitor")
        .arg("--chip")
        .arg("esp32s3")
        .arg("--port")
        .arg(port_path)
        .arg("--non-interactive")
        .arg("--before")
        .arg("no-reset-no-sync")
        .arg("--after")
        .arg(if reset { "hard-reset" } else { "no-reset" })
        .arg("--log-format")
        .arg("defmt")
        .arg("--elf")
        .arg(elf_path)
        .status()
        .map_err(|err| anyhow!("failed to start espflash monitor: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(anyhow!(
            "espflash monitor failed with exit code {}",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "signal".to_string())
        ))
    }
}

fn classify_monitor_line(line: &str) -> &'static str {
    let lower = line.to_lowercase();
    if serde_json::from_str::<serde_json::Value>(line)
        .map(|value| value.is_object())
        .unwrap_or(false)
    {
        "jsonl"
    } else if lower.contains("panic") || lower.contains("backtrace") {
        "panic"
    } else if lower.contains("rst:") || lower.contains("boot:") || lower.contains("esp-rom") {
        "boot"
    } else {
        "log"
    }
}
