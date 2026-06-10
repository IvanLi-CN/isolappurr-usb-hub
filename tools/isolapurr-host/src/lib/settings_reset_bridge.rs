use anyhow::{Context as _, anyhow};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use reqwest::Url;
use serde::Deserialize;
use serde_json::Value;
use std::time::Duration;

use super::{
    AppState, error_from_anyhow, redact_sensitive, require_auth,
    require_compatible_project_firmware, usb_settings_reset_request,
};

#[derive(Debug, Deserialize)]
pub(super) struct SettingsResetRequest {
    scope: String,
    owner: Option<u32>,
}

enum SettingsResetTarget {
    Usb,
    Http(String),
}

async fn settings_reset_target(state: &AppState, id: &str) -> anyhow::Result<SettingsResetTarget> {
    let inner = state.inner.lock().await;
    let device = inner
        .devices
        .get(id)
        .ok_or_else(|| anyhow!("device not found"))?;
    if device.usb.is_some() {
        return Ok(SettingsResetTarget::Usb);
    }
    if let Some(http) = device.http.as_ref() {
        return Ok(SettingsResetTarget::Http(http.base_url.clone()));
    }
    Err(anyhow!("device has no Local USB target"))
}

async fn http_settings_reset_request(
    base_url: &str,
    scope: &str,
    owner: Option<u32>,
) -> anyhow::Result<Value> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(5))
        .build()
        .context("build host HTTP client")?;
    let mut url = Url::parse(base_url).with_context(|| format!("parse base url {base_url}"))?;
    url.set_path("/api/v1/settings/reset");
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("scope", scope);
        if let Some(owner) = owner.filter(|owner| *owner != 0) {
            query.append_pair("owner", &owner.to_string());
        }
    }
    let response = client
        .post(url.clone())
        .send()
        .await
        .with_context(|| format!("post {url}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .context("read settings reset response")?;
    let value: Value = serde_json::from_str(&text).context("parse settings reset response")?;
    if status.is_success() {
        return Ok(value);
    }
    let message = value
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("settings reset request failed");
    Err(anyhow!("{message}"))
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
    let target = match settings_reset_target(&state, &id).await {
        Ok(target) => target,
        Err(err) => return error_from_anyhow(err),
    };
    if matches!(target, SettingsResetTarget::Usb)
        && let Err(err) = require_compatible_project_firmware(&state, &id).await
    {
        return error_from_anyhow(err);
    }
    let response = match target {
        SettingsResetTarget::Usb => {
            usb_settings_reset_request(&state, &id, &req.scope, req.owner).await
        }
        SettingsResetTarget::Http(base_url) => {
            http_settings_reset_request(&base_url, &req.scope, req.owner).await
        }
    };
    match response {
        Ok(value) => Json(redact_sensitive(&value)).into_response(),
        Err(err) => error_from_anyhow(err),
    }
}
