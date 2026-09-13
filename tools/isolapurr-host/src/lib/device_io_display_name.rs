async fn update_usb_device_display_name(state: &AppState, device_id: &str, response: &Value) {
    let display_name = display_name_from_usb_response(device_id, response);
    let mut inner = state.inner.lock().await;
    let Some(record) = inner.devices.get_mut(device_id) else {
        return;
    };
    if !display_name.trim().is_empty() {
        record.display_name = display_name;
    }
}

fn display_name_from_usb_response(device_id: &str, response: &Value) -> String {
    let device = response
        .get("result")
        .and_then(|value| value.get("device"))
        .or_else(|| response.get("device"));
    let mutation_name = response
        .get("result")
        .and_then(|value| value.get("display_name"));
    let fallback = format!("isolapurr-usb-hub-{device_id}");
    mutation_name
        .and_then(Value::as_str)
        .or_else(|| {
            device
                .and_then(|value| value.get("display_name"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            device
                .and_then(|value| value.get("hostname"))
                .and_then(Value::as_str)
        })
        .unwrap_or(fallback.as_str())
        .to_string()
}
