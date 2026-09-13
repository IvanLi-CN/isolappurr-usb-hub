async fn update_usb_device_display_name(state: &AppState, device_id: &str, response: &Value) {
    let Some(display_name) = display_name_from_usb_response(response) else {
        return;
    };
    let mut inner = state.inner.lock().await;
    let Some(record) = inner.devices.get_mut(device_id) else {
        return;
    };
    if !display_name.trim().is_empty() {
        record.display_name = display_name;
    }
}

fn display_name_from_usb_response(response: &Value) -> Option<String> {
    let device = response
        .get("result")
        .and_then(|value| value.get("device"))
        .or_else(|| response.get("device"));
    let mutation_name = response
        .get("result")
        .and_then(|value| value.get("display_name"));
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
        .map(ToString::to_string)
}
