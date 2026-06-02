fn exit_server_failed(err: anyhow::Error) -> ! {
    eprintln!("{err:#}");
    std::process::exit(EXIT_SERVER_FAILED);
}

struct RunningAgent {
    agent_base_url: Url,
    shutdown: CancellationToken,
    state: AppState,
}

async fn start_agent_server(
    port_override: Option<u16>,
    mode: &'static str,
) -> anyhow::Result<RunningAgent> {
    let token = generate_token();
    let (listener, port) = bind_agent_port(port_override).await?;
    let agent_base_url = Url::parse(&format!("http://127.0.0.1:{port}")).unwrap();

    persist_last_port_if_needed(port_override, port)?;

    let (mdns, mdns_error) = match ServiceDaemon::new() {
        Ok(mdns) => (Some(mdns), None),
        Err(err) => (None, Some(mdns_unavailable_message(&format!("{err}")))),
    };
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .context("http client")?;

    let discovery = Arc::new(DiscoveryController::new(mdns, mdns_error, http));
    let storage = Arc::new(StorageManager::load_or_init()?);

    let state = AppState {
        token: token.clone(),
        agent_base_url: agent_base_url.clone(),
        mode,
        discovery: discovery.clone(),
        storage: storage.clone(),
        serial_lock: Arc::new(TokioMutex::new(())),
    };

    discovery.start_mdns_background().await;

    let router = Router::new()
        .route("/api/v1/bootstrap", get(api_bootstrap))
        .route("/api/v1/health", get(api_health))
        .route("/api/v1/discovery/snapshot", get(api_discovery_snapshot))
        .route("/api/v1/discovery/refresh", post(api_discovery_refresh))
        .route("/api/v1/discovery/ip-scan", post(api_discovery_ip_scan))
        .route("/api/v1/discovery/cancel", post(api_discovery_cancel))
        .route("/api/v1/serial/ports", get(api_serial_ports))
        .route("/api/v1/serial/request", post(api_serial_request))
        .route("/api/v1/firmware/flash", post(api_firmware_flash))
        .route(
            "/api/v1/storage/devices",
            get(api_storage_list_devices).post(api_storage_upsert_device),
        )
        .route(
            "/api/v1/storage/devices/:id",
            delete(api_storage_delete_device),
        )
        .route(
            "/api/v1/storage/settings",
            get(api_storage_get_settings).put(api_storage_update_settings),
        )
        .route(
            "/api/v1/storage/migrate/localstorage",
            post(api_storage_migrate_localstorage),
        )
        .route("/api/v1/storage/export", get(api_storage_export))
        .route("/api/v1/storage/import", post(api_storage_import))
        .route("/api/v1/storage/reset", post(api_storage_reset))
        .route("/", get(ui_index))
        .route("/*path", get(ui_asset))
        .with_state(state.clone())
        .layer(DefaultBodyLimit::max(16 * 1024 * 1024))
        .layer(local_web_cors_layer(
            agent_base_url.port().unwrap_or(DEFAULT_PORT_RANGE_START),
        ));

    let shutdown = CancellationToken::new();
    let shutdown_clone = shutdown.clone();
    tokio::spawn(async move {
        let serve = axum::serve(listener, router).with_graceful_shutdown(async move {
            shutdown_clone.cancelled().await;
        });
        if let Err(err) = serve.await {
            tracing::error!("agent server error: {err}");
        }
    });

    Ok(RunningAgent {
        agent_base_url,
        shutdown,
        state,
    })
}

fn mdns_unavailable_message(details: &str) -> String {
    let hint = if cfg!(target_os = "windows") {
        "On Windows: ensure your network is set to Private; allow this app through Windows Defender Firewall; disable VPN/virtual adapters."
    } else if cfg!(target_os = "linux") {
        "On Linux: ensure avahi-daemon is running; firewall allows multicast (UDP 5353); disable VPN if needed."
    } else if cfg!(target_os = "macos") {
        "On macOS: ensure local network access is allowed; disable VPN if needed."
    } else {
        "Check firewall/VPN settings."
    };

    let details = details.trim();
    if details.is_empty() {
        format!(
            "mDNS/DNS-SD discovery is unavailable. {hint} You can still use IP scan (advanced) or Manual add."
        )
    } else {
        format!(
            "mDNS/DNS-SD discovery is unavailable ({details}). {hint} You can still use IP scan (advanced) or Manual add."
        )
    }
}

async fn bind_agent_port(port_override: Option<u16>) -> anyhow::Result<(TcpListener, u16)> {
    if let Some(port) = port_override {
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        let listener = TcpListener::bind(addr)
            .await
            .with_context(|| format!("bind 127.0.0.1:{port}"))?;
        return Ok((listener, port));
    }

    if let Some(saved) = read_last_port().ok().flatten() {
        if let Ok((listener, port)) = try_bind_port(saved).await {
            return Ok((listener, port));
        }
    }

    for port in DEFAULT_PORT_RANGE_START..=DEFAULT_PORT_RANGE_END {
        if let Ok((listener, port)) = try_bind_port(port).await {
            return Ok((listener, port));
        }
    }

    Err(anyhow!(
        "no free port in {DEFAULT_PORT_RANGE_START}-{DEFAULT_PORT_RANGE_END}"
    ))
}

async fn try_bind_port(port: u16) -> anyhow::Result<(TcpListener, u16)> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let listener = TcpListener::bind(addr).await?;
    Ok((listener, port))
}

fn persist_last_port_if_needed(port_override: Option<u16>, port: u16) -> anyhow::Result<()> {
    if port_override.is_some() {
        return Ok(());
    }
    let dirs = project_dirs()?;
    std::fs::create_dir_all(dirs.config_dir()).context("create config dir")?;
    let path = dirs.config_dir().join("last_port");
    std::fs::write(path, port.to_string()).context("write last_port")?;
    Ok(())
}

fn read_last_port() -> anyhow::Result<Option<u16>> {
    let dirs = project_dirs()?;
    let path = dirs.config_dir().join("last_port");
    let raw = std::fs::read_to_string(path);
    let Ok(raw) = raw else {
        return Ok(None);
    };
    let parsed = raw.trim().parse::<u16>().ok();
    Ok(parsed)
}

fn project_dirs() -> anyhow::Result<ProjectDirs> {
    ProjectDirs::from("cc", "isolapurr", "isolapurr-desktop")
        .ok_or_else(|| anyhow!("project dirs unavailable"))
}
