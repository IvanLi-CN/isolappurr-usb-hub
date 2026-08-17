use super::*;

pub(super) async fn port_data(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, port_id)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    let Some(connected) = query
        .get("connected")
        .and_then(|value| match value.as_str() {
            "1" | "true" => Some(true),
            "0" | "false" => Some(false),
            _ => None,
        })
    else {
        return bad_request("connected must be true or false");
    };
    match usb_jsonl_request(
        &state,
        &id,
        "port.data_set",
        Some(json!({"port": port_id, "connected": connected})),
    )
    .await
    {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}
