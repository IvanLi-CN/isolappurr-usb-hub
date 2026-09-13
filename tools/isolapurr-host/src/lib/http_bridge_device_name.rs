#[derive(Debug, Deserialize)]
struct DeviceNameRequest {
    name: String,
}

async fn device_name_show(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match dispatch_ipc_request(
        &state,
        "device.settings.name.show",
        json!({"device_id": id}),
    )
    .await
    {
        Ok(value) => jsonl_device_response(value),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_name_set(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<DeviceNameRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match dispatch_ipc_request(
        &state,
        "device.settings.name.set",
        json!({"device_id": id, "name": req.name}),
    )
    .await
    {
        Ok(value) => jsonl_device_response(value),
        Err(err) => error_from_anyhow(err),
    }
}

async fn device_name_clear(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    match dispatch_ipc_request(
        &state,
        "device.settings.name.clear",
        json!({"device_id": id}),
    )
    .await
    {
        Ok(value) => jsonl_device_response(value),
        Err(err) => error_from_anyhow(err),
    }
}

fn jsonl_device_response(value: Value) -> Response {
    if value.get("ok").and_then(Value::as_bool) == Some(false) {
        let error = value.get("error");
        let code = error
            .and_then(|value| value.get("code"))
            .and_then(Value::as_str)
            .unwrap_or("device_error");
        let message = error
            .and_then(|value| value.get("message"))
            .and_then(Value::as_str)
            .unwrap_or("device request failed");
        let retryable = error
            .and_then(|value| value.get("retryable"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        return match code {
            "invalid_name" => invalid_name(message),
            "busy" => conflict(message),
            _ => error_response(StatusCode::BAD_GATEWAY, "device_error", message, retryable),
        };
    }
    Json(redact_sensitive(&value)).into_response()
}
