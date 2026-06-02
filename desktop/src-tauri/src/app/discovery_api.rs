async fn api_bootstrap(State(state): State<AppState>) -> impl IntoResponse {
    let port = state
        .agent_base_url
        .port()
        .unwrap_or(DEFAULT_PORT_RANGE_START);
    let res = BootstrapResponse {
        token: state.token.clone(),
        agent_base_url: format!("http://127.0.0.1:{port}"),
        app: BootstrapApp {
            name: "isolapurr-desktop",
            version: release_version(),
            mode: state.mode,
        },
    };

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    (headers, Json(res))
}

async fn api_health(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    Json(serde_json::json!({ "ok": true })).into_response()
}

async fn api_discovery_snapshot(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let snapshot = state.discovery.snapshot().await;
    Json(snapshot).into_response()
}

async fn api_discovery_refresh(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    if let Err(err) = state.discovery.refresh_services().await {
        tracing::warn!("refresh: {err:#}");
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorEnvelope {
                error: ErrorInfo {
                    code: "temporarily_unavailable",
                    message: err.to_string(),
                    retryable: true,
                },
            }),
        )
            .into_response();
    }
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "accepted": true })),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
struct IpScanRequest {
    cidr: String,
}

async fn api_discovery_ip_scan(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<IpScanRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    if let Err(err) = state.discovery.start_ip_scan(req.cidr).await {
        tracing::warn!("ip scan: {err:#}");
        return bad_request(&err.to_string());
    }
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "accepted": true })),
    )
        .into_response()
}

async fn api_discovery_cancel(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    state.discovery.cancel_ip_scan().await;
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "accepted": true })),
    )
        .into_response()
}
