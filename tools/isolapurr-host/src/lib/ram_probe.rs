use super::*;

pub(super) fn parse_output(raw_output: &str) -> anyhow::Result<Value> {
    for line in raw_output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if value.get("boardTopologyProbe") != Some(&Value::Bool(true)) {
            continue;
        }
        let hardware = value
            .pointer("/hardware")
            .or_else(|| value.pointer("/result/device/hardware"))
            .or_else(|| value.pointer("/device/hardware"));
        if hardware
            .and_then(|value| value.pointer("/discovery"))
            .is_some()
        {
            return Ok(value);
        }
    }
    Err(anyhow!(
        "RAM topology probe did not return a physical discovery descriptor"
    ))
}

fn run_now(port_path: &str) -> anyhow::Result<Value> {
    let probe_path = std::env::var_os("ISOLAPURR_BOARD_TOPOLOGY_PROBE")
        .ok_or_else(|| anyhow!("ISOLAPURR_BOARD_TOPOLOGY_PROBE is not configured"))?;
    let output = Command::new("espflash")
        .env("ESPFLASH_SKIP_UPDATE_CHECK", "true")
        .arg("flash")
        .arg("--chip")
        .arg("esp32s3")
        .arg("--port")
        .arg(port_path)
        .arg("--no-stub")
        .arg("--ram")
        .arg(&probe_path)
        .output()
        .with_context(|| format!("start RAM topology probe for {port_path}"))?;
    let command_log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(anyhow!("RAM topology probe failed: {command_log}"));
    }

    let mut port = serialport::new(port_path, SERIAL_BAUD)
        .timeout(Duration::from_millis(100))
        .open()
        .with_context(|| format!("open probe output port {port_path}"))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut raw = String::new();
    let mut buf = [0_u8; 256];
    use std::io::Read as _;
    while Instant::now() < deadline {
        match port.read(&mut buf) {
            Ok(0) => {}
            Ok(n) => {
                raw.push_str(&String::from_utf8_lossy(&buf[..n]));
                if let Ok(value) = parse_output(&raw) {
                    return Ok(value);
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::TimedOut => {}
            Err(err) => return Err(err).context("read RAM topology probe output"),
        }
    }
    parse_output(&raw).with_context(|| {
        format!(
            "RAM topology probe timed out after espflash completed; command output: {command_log}"
        )
    })
}

pub(super) async fn run(state: &AppState, port_path: &str) -> anyhow::Result<Value> {
    let _serial_guard = acquire_serial_port_guard(state, port_path, None).await?;
    let port_path = port_path.to_string();
    tokio::task::spawn_blocking(move || run_now(&port_path))
        .await
        .context("RAM topology probe worker join")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_accepts_only_physical_discovery_payloads() {
        let value = parse_output(
            "boot noise\n{\"boardTopologyProbe\":true,\"hardware\":{\"discovery\":{\"state\":\"verified\",\"detectedProfile\":\"tps-fusb\"}}}\n",
        )
        .expect("probe payload should parse");
        assert_eq!(
            value
                .pointer("/hardware/discovery/detectedProfile")
                .and_then(Value::as_str),
            Some("tps-fusb")
        );
        assert!(parse_output("{}\n").is_err());
    }
}
