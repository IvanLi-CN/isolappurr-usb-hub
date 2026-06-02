async fn api_storage_list_devices(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let devices = state.storage.list_devices().await;
    Json(DevicesResponse { devices }).into_response()
}

async fn api_storage_upsert_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UpsertDeviceRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    match state.storage.upsert_device(req.device).await {
        Ok(device) => Json(UpsertDeviceResponse { device }).into_response(),
        Err(err) => err.response(),
    }
}

async fn api_storage_delete_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(device_id): AxumPath<String>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    match state.storage.delete_device(device_id.trim()).await {
        Ok(()) => Json(serde_json::json!({ "deleted": true })).into_response(),
        Err(err) => err.response(),
    }
}

async fn api_storage_get_settings(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let settings = state.storage.get_settings().await;
    Json(SettingsResponse { settings }).into_response()
}

async fn api_storage_update_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UpdateSettingsRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let theme = match ThemeId::parse(req.settings.theme.trim()) {
        Some(theme) => theme,
        None => {
            return bad_request("invalid theme");
        }
    };
    match state.storage.update_settings(theme).await {
        Ok(settings) => Json(SettingsResponse { settings }).into_response(),
        Err(err) => err.response(),
    }
}

async fn api_storage_migrate_localstorage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<MigrateRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    match state.storage.migrate_from_localstorage(req).await {
        Ok(response) => Json(response).into_response(),
        Err(err) => err.response(),
    }
}

async fn api_storage_export(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let storage = state.storage.export().await;
    Json(storage).into_response()
}

async fn api_storage_import(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ImportRequest>,
) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    let mode = req.mode.unwrap_or(ImportMode::Merge);
    match state.storage.import_storage(req.storage, mode).await {
        Ok(()) => Json(serde_json::json!({ "imported": true })).into_response(),
        Err(err) => err.response(),
    }
}

async fn api_storage_reset(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !is_origin_allowed(&headers, state.agent_base_url.port().unwrap()) {
        return forbidden("origin not allowed");
    }
    if !is_authorized(&headers, &state) {
        return unauthorized("missing/invalid bearer token");
    }
    match state.storage.reset().await {
        Ok(()) => Json(serde_json::json!({ "reset": true })).into_response(),
        Err(err) => err.response(),
    }
}

async fn ui_index() -> Response {
    ui_asset(AxumPath("index.html".to_string())).await
}

async fn ui_asset(AxumPath(path): AxumPath<String>) -> Response {
    // Serve SPA assets; fall back to index.html for client-side routing.
    let path = path.trim_start_matches('/').to_string();
    let (asset, served_path) = match WebDist::get(&path) {
        Some(asset) => (asset, path.as_str()),
        None => {
            let Some(asset) = WebDist::get("index.html") else {
                return StatusCode::NOT_FOUND.into_response();
            };
            (asset, "index.html")
        }
    };

    let body = asset.data;
    let mime = mime_guess::from_path(served_path).first_or_octet_stream();
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.essence_str()).unwrap(),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    (headers, body).into_response()
}
