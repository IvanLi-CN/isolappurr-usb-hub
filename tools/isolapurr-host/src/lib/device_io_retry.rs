async fn usb_jsonl_request(
    state: &AppState,
    device_id: &str,
    method: &str,
    params: Option<Value>,
) -> anyhow::Result<Value> {
    let retry_params = params.clone();
    match usb_jsonl_request_with_exclusive(state, device_id, method, params, None).await {
        Ok(value) => Ok(value),
        Err(error) if should_retry_read_only_serial_request(method, &error) => {
            tokio::time::sleep(Duration::from_millis(SERIAL_READ_RETRY_DELAY_MS)).await;
            usb_jsonl_request_with_exclusive(state, device_id, method, retry_params, None).await
        }
        Err(error) => Err(error),
    }
}

fn should_retry_read_only_serial_request(method: &str, error: &anyhow::Error) -> bool {
    matches!(
        method,
        "info"
            | "wifi.get"
            | "ports.get"
            | "pd.diagnostics"
            | "power.config_get"
            | "power.idle_bias_get"
    ) && {
        let message = error.to_string();
        message.contains("serial response timed out") || message.contains("serial read")
    }
}

fn serial_timeout_ms_for_method(method: &str) -> u64 {
    match method {
        "info"
        | "wifi.get"
        | "ports.get"
        | "pd.diagnostics"
        | "power.config_get"
        | "power.idle_bias_get" => SERIAL_READ_TIMEOUT_MS,
        "power.config_set"
        | "power.config_defaults"
        | "power.idle_bias_set"
        | "power.idle_bias_clear" => SERIAL_POWER_CONFIG_EARLY_VERIFY_TIMEOUT_MS,
        "power.idle_bias_run" => 178_000,
        "settings.reset" => SERIAL_SETTINGS_RESET_TIMEOUT_MS,
        _ => SERIAL_TIMEOUT_MS,
    }
}
