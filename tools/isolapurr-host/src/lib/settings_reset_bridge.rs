use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use super::{
    AppState, error_from_anyhow, redact_sensitive, require_auth,
    require_compatible_project_firmware, usb_settings_reset_request,
};

#[derive(Debug, Deserialize)]
pub(super) struct SettingsResetRequest {
    scope: String,
    owner: Option<u32>,
}

pub(super) async fn settings_reset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(req): Json<SettingsResetRequest>,
) -> Response {
    if let Err(response) = require_auth(&headers, &state) {
        return *response;
    }
    if let Err(err) = require_compatible_project_firmware(&state, &id).await {
        return error_from_anyhow(err);
    }
    match usb_settings_reset_request(&state, &id, &req.scope, req.owner).await {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}
