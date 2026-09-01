use super::*;

fn parse_features(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn capacity_from_features(features: &[String], needle: &str) -> Option<String> {
    features.iter().find_map(|feature| {
        if !feature.to_lowercase().contains(needle) {
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

fn canonical_chip(value: &str) -> String {
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

fn inferred_ram(chip_type: Option<&str>) -> Option<&'static str> {
    let chip_type = canonical_chip(chip_type?).replace('-', "");
    if chip_type.contains("ESP32S3") {
        Some("512 KB")
    } else if chip_type.contains("ESP32S2") {
        Some("320 KB")
    } else {
        None
    }
}

fn normalize_chip(value: &str) -> (String, Option<String>, Option<String>) {
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
        .map(canonical_chip)
        .or_else(|| (!chip_type.is_empty()).then(|| canonical_chip(&chip_type)));
    (canonical_chip(&chip_type), mcu_model, chip_revision)
}

fn parse(raw_output: &str) -> Value {
    let mut chip_type = None;
    let mut mcu_model = None;
    let mut chip_revision = None;
    let mut flash_size = None;
    let mut mac_address = None;
    let mut crystal_frequency = None;
    let mut features = Vec::new();

    for line in raw_output.lines() {
        let trimmed = line.trim();
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim().to_ascii_lowercase().as_str() {
            "chip type" => {
                let (next_chip, next_model, next_revision) = normalize_chip(value);
                chip_type = Some(next_chip);
                mcu_model = next_model;
                chip_revision = next_revision;
            }
            "features" => features = parse_features(value),
            "crystal frequency" => crystal_frequency = Some(value.to_string()),
            "flash size" => flash_size = Some(value.to_uppercase().replace("MB", " MB")),
            "mac address" => mac_address = Some(value.to_string()),
            _ => {}
        }
    }

    let psram_size = capacity_from_features(&features, "psram");
    if flash_size.is_none() {
        flash_size = capacity_from_features(&features, "flash");
    }
    json!({
        "source": "espflash",
        "chipType": chip_type,
        "mcuModel": mcu_model,
        "chipRevision": chip_revision,
        "flashSize": flash_size,
        "ramSize": inferred_ram(chip_type.as_deref()),
        "psramSize": psram_size,
        "macAddress": mac_address,
        "crystalFrequency": crystal_frequency,
        "features": features,
        "rawOutput": raw_output,
    })
}

fn command(port_path: &str, args: &[&str]) -> anyhow::Result<std::process::Output> {
    Command::new("espflash")
        .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
        .args(args)
        .output()
        .with_context(|| format!("start espflash board-info for {port_path}"))
}

fn read_now(port_path: &str) -> anyhow::Result<Value> {
    let candidates = [
        ["board-info", "--port", port_path],
        ["board-info", "-p", port_path],
        ["--port", port_path, "board-info"],
        ["-p", port_path, "board-info"],
    ];
    let mut last_error = String::new();
    for args in candidates {
        let output = command(port_path, &args)?;
        let log = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if output.status.success() {
            return Ok(parse(&log));
        }
        last_error = log;
    }
    Err(anyhow!("espflash board-info failed: {last_error}"))
}

pub(super) async fn read(state: &AppState, port_path: &str) -> anyhow::Result<Value> {
    let _serial_guard = acquire_serial_port_guard(state, port_path, None).await?;
    let port_path = port_path.to_string();
    tokio::task::spawn_blocking(move || read_now(&port_path))
        .await
        .context("serial board-info worker join")?
}
