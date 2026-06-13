fn print_human(output: &Value) {
    print!("{}", format_human_output(output));
}

fn unwrap_device_success_result(value: Value) -> anyhow::Result<Value> {
    if value.get("ok").and_then(Value::as_bool) == Some(false) {
        let message = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
            .or_else(|| value.get("error").and_then(Value::as_str))
            .unwrap_or("device returned ok=false");
        return Err(anyhow!("device request failed: {message}"));
    }

    if value.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(value.get("result").cloned().unwrap_or_else(|| json!({})));
    }

    Ok(value)
}

fn format_human_output(output: &Value) -> String {
    if output.get("config").is_some() && output.get("diagnostics").is_some() {
        return format_power_show_output(output);
    }

    if output.get("dataset").is_some() && output.get("run").is_some() {
        return format_idle_bias_output(output);
    }

    if output.get("capability").is_some() && output.get("manual").is_some() {
        return format_power_config_output(output);
    }

    if output.get("saved").is_some() || output.get("devd").is_some() {
        return format_hardware_available(output);
    }

    if let Some(devices) = output.get("devices").and_then(Value::as_array)
        && devices
            .first()
            .is_some_and(|device| device.get("transport").is_some())
    {
        return format_discover_output(output);
    }

    if let Some(devices) = output.get("devices").and_then(Value::as_array) {
        if devices.is_empty() {
            return "No devices found.\n".to_string();
        }
        let mut lines = Vec::new();
        for device in devices {
            let id = device
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("unknown-device");
            let name = device
                .get("displayName")
                .or_else(|| device.get("display_name"))
                .or_else(|| device.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(id);
            let connection = device
                .get("connection")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            lines.push(format!("{name} ({id}) - {connection}"));
        }
        return format!("{}\n", lines.join("\n"));
    }

    if let Some(path) = output.get("path").and_then(Value::as_str) {
        return format!("{path}\n");
    }

    if let Some(ok) = output.get("ok").and_then(Value::as_bool) {
        return format!("{}\n", if ok { "ok" } else { "failed" });
    }

    format!(
        "{}\n",
        serde_json::to_string_pretty(output).unwrap_or_else(|_| output.to_string())
    )
}

fn format_discover_output(output: &Value) -> String {
    let mut lines = Vec::new();
    if let Some(warnings) = output.get("warnings").and_then(Value::as_array) {
        for warning in warnings.iter().filter_map(Value::as_str) {
            lines.push(format!("warning: {warning}"));
        }
        if !warnings.is_empty() {
            lines.push(String::new());
        }
    }

    let Some(devices) = output.get("devices").and_then(Value::as_array) else {
        return "No devices found.\n".to_string();
    };
    if devices.is_empty() {
        if lines.is_empty() {
            return "No devices found.\n".to_string();
        }
        lines.push("No devices found.".to_string());
        return format!("{}\n", lines.join("\n"));
    }

    for device in devices {
        let transport = device.get("transport").unwrap_or(&Value::Null);
        let kind = transport
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let display_name = device
            .get("displayName")
            .or_else(|| device.get("display_name"))
            .and_then(Value::as_str)
            .unwrap_or("unknown-device");
        let mut detail = match kind {
            "http" => device
                .get("deviceId")
                .or_else(|| device.get("device_id"))
                .and_then(Value::as_str)
                .map(|device_id| format!("LAN {display_name} ({device_id})"))
                .unwrap_or_else(|| format!("LAN {display_name}")),
            "usb" => transport
                .get("deviceId")
                .or_else(|| transport.get("device_id"))
                .and_then(Value::as_str)
                .map(|device_id| format!("USB {display_name} ({device_id})"))
                .unwrap_or_else(|| format!("USB {display_name}")),
            _ => display_name.to_string(),
        };

        let endpoint = match kind {
            "http" => transport
                .get("baseUrl")
                .or_else(|| transport.get("base_url"))
                .and_then(Value::as_str),
            "usb" => transport
                .get("portPath")
                .or_else(|| transport.get("port_path"))
                .and_then(Value::as_str),
            _ => None,
        };
        if let Some(endpoint) = endpoint {
            detail.push_str(" - ");
            detail.push_str(endpoint);
        }

        let saved = device
            .get("savedHardware")
            .or_else(|| device.get("saved_hardware"))
            .and_then(Value::as_array)
            .map(|saved| {
                saved
                    .iter()
                    .filter_map(|entry| {
                        let id = entry.get("id").and_then(Value::as_str)?;
                        let name = entry.get("name").and_then(Value::as_str).unwrap_or(id);
                        Some(format!("{name} ({id})"))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if !saved.is_empty() {
            detail.push_str(" [saved device: ");
            detail.push_str(&saved.join(", "));
            detail.push(']');
        }

        lines.push(detail);
    }

    format!("{}\n", lines.join("\n"))
}

fn format_hardware_available(output: &Value) -> String {
    let mut lines = Vec::new();
    if let Some(path) = output.get("path").and_then(Value::as_str) {
        lines.push(format!("Registry: {path}"));
    }

    lines.push("Saved devices:".to_string());
    match output.get("saved").and_then(Value::as_array) {
        Some(saved) if !saved.is_empty() => {
            for device in saved {
                let id = device
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown-hardware");
                let name = device.get("name").and_then(Value::as_str).unwrap_or(id);
                lines.push(format!("- {name} ({id}) {}", transport_label(device)));
            }
        }
        _ => lines.push("- none".to_string()),
    }

    lines.push("Local devd devices:".to_string());
    if let Some(error) = output
        .get("devd")
        .and_then(|devd| devd.get("error"))
        .and_then(Value::as_str)
    {
        lines.push(format!("- unavailable: {error}"));
    } else {
        match output
            .get("devd")
            .and_then(|devd| devd.get("devices"))
            .and_then(Value::as_array)
        {
            Some(devices) if !devices.is_empty() => {
                for device in devices {
                    let id = device
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown-device");
                    let name = device
                        .get("displayName")
                        .or_else(|| device.get("display_name"))
                        .or_else(|| device.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or(id);
                    let connection = device
                        .get("connection")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    lines.push(format!("- {name} ({id}) - {connection}"));
                }
            }
            _ => lines.push("- none".to_string()),
        }
    }

    format!("{}\n", lines.join("\n"))
}

fn format_power_show_output(output: &Value) -> String {
    let mut rendered = String::new();
    if let Some(config) = output.get("config") {
        rendered.push_str("Power config\n");
        rendered.push_str(&format_power_config_output(config));
    }
    if let Some(ports) = output.get("ports") {
        let Ok(ports) = serde_json::from_value::<CliPortsResponse>(ports.clone()) else {
            return format!(
                "{}\n",
                serde_json::to_string_pretty(output).unwrap_or_else(|_| output.to_string())
            );
        };
        if let Some(port_c) = ports.ports.iter().find(|port| port.port_id == "port_c") {
            rendered.push('\n');
            rendered.push_str("USB-C output\n");
            rendered.push_str(&format!(
                "Corrected telemetry: {}\n",
                format_port_telemetry(&port_c.telemetry)
            ));
        }
    }
    if let Some(diagnostics) = output.get("diagnostics") {
        rendered.push('\n');
        rendered.push_str("Live USB-C status\n");
        rendered.push_str(&format_live_power_output(diagnostics));
    }
    rendered
}

fn format_power_config_output(output: &Value) -> String {
    let Ok(config) = serde_json::from_value::<CliPowerConfig>(output.clone()) else {
        return format!(
            "{}\n",
            serde_json::to_string_pretty(output).unwrap_or_else(|_| output.to_string())
        );
    };

    let mut lines = Vec::new();
    lines.push(format!(
        "Saved profile: {}",
        if config.persisted { "yes" } else { "no" }
    ));
    lines.push(format!(
        "Output mode: {}",
        format_power_mode(&config.tps_mode)
    ));
    lines.push(format!("Power cap: {} W", config.capability.power_watts));
    lines.push(format!(
        "Advertised protocols: {}",
        format_config_protocols(&config.capability)
    ));
    lines.push(format!(
        "Fixed PD voltages: {}",
        format_fixed_voltages(&config.capability.pd.fixed_voltages_mv)
    ));
    lines.push(format!(
        "Current profile: {}",
        format_current_profile(
            config.capability.current.pps3_limit_ma,
            config.capability.current.pd_pps_5a,
            config.capability.current.type_c_broadcast_ma,
            config.capability.current.scp_limit_ma,
            config.capability.current.fcp_afc_sfcp_limit_ma,
        )
    ));
    lines.push(format!(
        "Manual output: {} mV, {} mA, USB-C path {}",
        config.manual.voltage_mv,
        config.manual.current_limit_ma,
        format_usb_c_path_mode(&config.manual.usb_c_path_mode)
    ));
    if let Some(lock) = &config.lock {
        if lock.expires_at_ms == 0 {
            lines.push("Host lock: idle".to_string());
        } else {
            lines.push(format!(
                "Host lock: owner={}, expires_at_ms={}",
                lock.owner, lock.expires_at_ms
            ));
        }
    } else {
        lines.push("Host lock: idle".to_string());
    }
    format!("{}\n", lines.join("\n"))
}

fn format_live_power_output(output: &Value) -> String {
    let Ok(diagnostics) = serde_json::from_value::<CliPowerDiagnostics>(output.clone()) else {
        return format!(
            "{}\n",
            serde_json::to_string_pretty(output).unwrap_or_else(|_| output.to_string())
        );
    };

    let mut lines = Vec::new();
    lines.push(format!(
        "USB-C source: {}",
        if diagnostics.usb_c_power_enabled {
            "enabled"
        } else {
            "disabled"
        }
    ));
    lines.push(format!(
        "Capability state: {}",
        format_capability_state(&diagnostics)
    ));
    lines.push(format!(
        "Advertised source: {}",
        format_readback_summary(&diagnostics.sw2303_readback_config)
    ));
    lines.push(format!(
        "Negotiated request: {}",
        format_power_request(&diagnostics.sw2303_request)
    ));
    lines.push(format!(
        "Last valid request: {}",
        format_power_request(&diagnostics.sw2303_last_valid_request)
    ));
    lines.push(format!(
        "Output target: {}",
        format_output_target(&diagnostics.tps_setpoint)
    ));
    lines.push(format!(
        "Idle-bias dataset: {}",
        format_idle_bias_dataset(&diagnostics.idle_bias.dataset)
    ));
    lines.push(format!(
        "Idle-bias correction: {}",
        if diagnostics.idle_bias.correction_enabled {
            "enabled"
        } else {
            "disabled"
        }
    ));
    lines.push(format!(
        "Idle-bias applied offset: {}",
        diagnostics
            .idle_bias
            .current_applied_offset_ma
            .map(|value| format!("{value} mA"))
            .unwrap_or_else(|| "none".to_string())
    ));
    lines.push(format!(
        "Idle-bias run: {}",
        format_idle_bias_run(&diagnostics.idle_bias.run)
    ));
    lines.push(format!(
        "Runtime recoveries: {}",
        diagnostics.runtime_recovery_count
    ));
    lines.push(format!("Faults: {}", format_faults(&diagnostics)));
    lines.push(format!(
        "Status sample age: {} ms",
        diagnostics.sample_uptime_ms
    ));
    format!("{}\n", lines.join("\n"))
}

fn format_idle_bias_output(output: &Value) -> String {
    let Ok(idle_bias) = serde_json::from_value::<CliIdleBias>(output.clone()) else {
        return format!(
            "{}\n",
            serde_json::to_string_pretty(output).unwrap_or_else(|_| output.to_string())
        );
    };

    let mut lines = Vec::new();
    lines.push(format!(
        "Correction: {}",
        if idle_bias.correction_enabled {
            "enabled"
        } else {
            "disabled"
        }
    ));
    lines.push(format!(
        "Dataset: {}",
        format_idle_bias_dataset(&idle_bias.dataset)
    ));
    lines.push(format!(
        "Applied offset: {}",
        idle_bias
            .current_applied_offset_ma
            .map(|value| format!("{value} mA"))
            .unwrap_or_else(|| "none".to_string())
    ));
    lines.push(format!(
        "Run state: {}",
        format_idle_bias_run(&idle_bias.run)
    ));
    format!("{}\n", lines.join("\n"))
}

fn format_port_telemetry(telemetry: &CliPortTelemetry) -> String {
    match telemetry.status.as_str() {
        "ok" => match (
            telemetry.voltage_mv,
            telemetry.current_ma,
            telemetry.power_mw,
        ) {
            (Some(voltage_mv), Some(current_ma), Some(power_mw)) => {
                format!("{voltage_mv} mV @ {current_ma} mA / {power_mw} mW")
            }
            (Some(voltage_mv), Some(current_ma), None) => {
                format!("{voltage_mv} mV @ {current_ma} mA")
            }
            _ => "telemetry unavailable".to_string(),
        },
        "not_inserted" => "not inserted".to_string(),
        "overrange" => "overrange".to_string(),
        _ => "telemetry error".to_string(),
    }
}

fn format_idle_bias_dataset(dataset: &CliIdleBiasDataset) -> String {
    if dataset.status != "valid" {
        return dataset.status.clone();
    }
    format!(
        "valid ({}..{} mV, {} points, step {} mV)",
        dataset.min_voltage_mv, dataset.max_voltage_mv, dataset.point_count, dataset.step_mv
    )
}

fn format_idle_bias_run(run: &CliIdleBiasRun) -> String {
    match run.state.as_str() {
        "running" => format!(
            "running {}/{}{}",
            run.completed_points,
            run.point_count,
            run.target_voltage_mv
                .map(|mv| format!(" @ {mv} mV"))
                .unwrap_or_default()
        ),
        "failed" => {
            let reason = run
                .error
                .as_ref()
                .map(|error| error.message.as_str())
                .unwrap_or("unknown error");
            format!(
                "failed {}/{}{}: {}",
                run.completed_points,
                run.point_count,
                run.target_voltage_mv
                    .map(|mv| format!(" @ {mv} mV"))
                    .unwrap_or_default(),
                reason
            )
        }
        _ => "idle".to_string(),
    }
}

fn format_power_mode(mode: &str) -> &'static str {
    match mode {
        "auto_follow" => "Auto follow USB-C request",
        "manual" => "Manual bench output",
        _ => "Unknown",
    }
}

fn format_usb_c_path_mode(mode: &str) -> &'static str {
    match mode {
        "default" => "automatic",
        "disconnect" => "disconnected",
        "force" => "forced on",
        _ => "unknown",
    }
}

fn format_config_protocols(capability: &CliPowerCapability) -> String {
    let mut labels = Vec::new();
    append_protocol(
        &mut labels,
        capability.protocols.get("pd").and_then(Value::as_bool),
        "PD",
    );
    append_protocol(&mut labels, Some(capability.pd.pps), "PPS");
    append_protocol(
        &mut labels,
        capability.protocols.get("qc20").and_then(Value::as_bool),
        "QC2.0",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("qc30").and_then(Value::as_bool),
        "QC3.0",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("fcp").and_then(Value::as_bool),
        "FCP",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("afc").and_then(Value::as_bool),
        "AFC",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("scp").and_then(Value::as_bool),
        "SCP",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("pe20").and_then(Value::as_bool),
        "PE2.0",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("bc12").and_then(Value::as_bool),
        "BC1.2",
    );
    append_protocol(
        &mut labels,
        capability.protocols.get("sfcp").and_then(Value::as_bool),
        "SFCP",
    );
    if labels.is_empty() {
        "none".to_string()
    } else {
        labels.join(", ")
    }
}

fn append_protocol(labels: &mut Vec<&'static str>, enabled: Option<bool>, label: &'static str) {
    if enabled == Some(true) {
        labels.push(label);
    }
}

fn format_fixed_voltages(fixed_voltages_mv: &[u16]) -> String {
    if fixed_voltages_mv.is_empty() {
        return "none".to_string();
    }
    fixed_voltages_mv
        .iter()
        .map(|mv| format!("{} V", mv / 1000))
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_current_profile(
    pps3_limit_ma: u16,
    pd_pps_5a: bool,
    type_c_broadcast_ma: u16,
    scp_limit_ma: u16,
    fcp_afc_sfcp_limit_ma: u16,
) -> String {
    format!(
        "PPS3 {} mA, PD/PPS 5 A {}, Type-C {} mA, SCP {} mA, FCP/AFC/SFCP {} mA",
        pps3_limit_ma,
        if pd_pps_5a { "enabled" } else { "disabled" },
        type_c_broadcast_ma,
        scp_limit_ma,
        fcp_afc_sfcp_limit_ma,
    )
}

fn format_capability_state(diagnostics: &CliPowerDiagnostics) -> &'static str {
    let readback = &diagnostics.sw2303_readback_config;
    if !diagnostics.usb_c_power_enabled {
        "idle"
    } else if readback.available && readback.matches_config {
        "applied"
    } else if readback.available {
        "readback mismatch"
    } else if !diagnostics.sw2303_i2c_allowed {
        "controller not ready"
    } else if diagnostics.sw2303_profile_applied {
        "applied"
    } else {
        "pending readback"
    }
}

fn format_readback_summary(readback: &CliPowerCapabilityReadback) -> String {
    if !readback.available {
        return "unavailable".to_string();
    }

    let mut parts = Vec::new();
    if let Some(power_watts) = readback.power_watts {
        parts.push(format!("{power_watts} W"));
    }
    let protocols = format_readback_protocols(readback);
    if protocols != "none" {
        parts.push(protocols);
    }
    let fixed_voltages = format_fixed_voltages(&readback.pd.fixed_voltages_mv);
    if fixed_voltages != "none" {
        parts.push(format!("fixed {fixed_voltages}"));
    }
    parts.push(format!(
        "current {}",
        format_readback_current_profile(&readback.current)
    ));
    parts.join("; ")
}

fn format_readback_protocols(readback: &CliPowerCapabilityReadback) -> String {
    let mut labels = Vec::new();
    append_protocol(&mut labels, readback.protocols.pd, "PD");
    append_protocol(&mut labels, readback.pd.pps, "PPS");
    append_protocol(&mut labels, readback.protocols.qc20, "QC2.0");
    append_protocol(&mut labels, readback.protocols.qc30, "QC3.0");
    append_protocol(&mut labels, readback.protocols.fcp, "FCP");
    append_protocol(&mut labels, readback.protocols.afc, "AFC");
    append_protocol(&mut labels, readback.protocols.scp, "SCP");
    append_protocol(&mut labels, readback.protocols.pe20, "PE2.0");
    append_protocol(&mut labels, readback.protocols.bc12, "BC1.2");
    append_protocol(&mut labels, readback.protocols.sfcp, "SFCP");
    if labels.is_empty() {
        "none".to_string()
    } else {
        labels.join(", ")
    }
}

fn format_readback_current_profile(current: &CliPowerCurrentReadback) -> String {
    let pps3 = current
        .pps3_limit_ma
        .map(|value| format!("{value} mA"))
        .unwrap_or_else(|| "unknown".to_string());
    let pd_pps_5a = match current.pd_pps_5a {
        Some(true) => "enabled",
        Some(false) => "disabled",
        None => "unknown",
    };
    let type_c = current
        .type_c_broadcast_ma
        .map(|value| format!("{value} mA"))
        .unwrap_or_else(|| "unknown".to_string());
    let scp = current
        .scp_limit_ma
        .map(|value| format!("{value} mA"))
        .unwrap_or_else(|| "unknown".to_string());
    let fcp = current
        .fcp_afc_sfcp_limit_ma
        .map(|value| format!("{value} mA"))
        .unwrap_or_else(|| "unknown".to_string());
    format!("PPS3 {pps3}, PD/PPS 5 A {pd_pps_5a}, Type-C {type_c}, SCP {scp}, FCP/AFC/SFCP {fcp}")
}

fn format_power_request(request: &CliPowerRequest) -> String {
    match (request.mv, request.ma) {
        (Some(mv), Some(ma)) => format!("{mv} mV @ {ma} mA"),
        (Some(mv), None) => format!("{mv} mV"),
        (None, Some(ma)) => format!("{ma} mA"),
        (None, None) => "none".to_string(),
    }
}

fn format_output_target(setpoint: &CliPowerSetpoint) -> String {
    match (setpoint.output_enabled, setpoint.mv, setpoint.ilim_ma) {
        (Some(false), _, _) => "disabled".to_string(),
        (Some(true), Some(mv), Some(ilim_ma)) => format!("{mv} mV @ {ilim_ma} mA"),
        (Some(true), Some(mv), None) => format!("{mv} mV"),
        (Some(true), None, Some(ilim_ma)) => format!("{ilim_ma} mA current limit"),
        (Some(true), None, None) => "enabled".to_string(),
        (None, _, _) => "unavailable".to_string(),
    }
}

fn format_faults(diagnostics: &CliPowerDiagnostics) -> String {
    let mut faults = Vec::new();
    if diagnostics.sw2303_error_latched {
        faults.push("USB-C controller fault latched");
    }
    if diagnostics.tps_error_latched {
        faults.push("power-stage fault latched");
    }
    if faults.is_empty() {
        "none".to_string()
    } else {
        faults.join(", ")
    }
}

fn transport_label(device: &Value) -> String {
    let Some(transports) = device.get("transports") else {
        return "(unknown transport)".to_string();
    };
    let mut labels = Vec::new();
    if let Some(port_path) = transports.get("localUsbPortPath").and_then(Value::as_str) {
        labels.push(format!("usb:{port_path}"));
    }
    if let Some(base_url) = transports.get("httpBaseUrl").and_then(Value::as_str) {
        labels.push(format!("http:{base_url}"));
    }
    if let Some(label) = transports.get("webSerialLabel").and_then(Value::as_str) {
        labels.push(format!("web_serial:{label}"));
    }
    if labels.is_empty() {
        "unlinked".to_string()
    } else {
        labels.join(", ")
    }
}
