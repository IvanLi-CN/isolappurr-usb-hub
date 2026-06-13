use std::{
    collections::HashMap,
    env,
    io::{Read as _, Write as _},
    net::{Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration as StdDuration, Instant as StdInstant},
};

use anyhow::{Context as _, anyhow};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path as AxumPath, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use base64::Engine as _;
use clap::{Parser, Subcommand};
use default_net::interface::InterfaceType;
use directories::ProjectDirs;
use futures::{StreamExt as _, stream};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use serialport::ClearBuffer;
use time::format_description::well_known::Rfc3339;
use tokio::{
    net::TcpListener,
    sync::{Mutex as TokioMutex, RwLock},
};
use tokio_util::sync::CancellationToken;
use tower_http::cors::{AllowOrigin, CorsLayer};
use url::Url;

const DEFAULT_PORT_RANGE_START: u16 = 51200;
const DEFAULT_PORT_RANGE_END: u16 = 51299;
const LOCAL_WEB_ALLOWED_PORTS: &[u16] = &[45173, 45175];
const STORAGE_SCHEMA_VERSION: u8 = 1;
const STORAGE_FILE_NAME: &str = "storage.json";
const PORT_CACHE_FILE_NAME: &str = ".esp32-port";
const DEFAULT_FLASH_ADDRESS: u32 = 0x10000;
const PORT_IDENTITY_UNCONFIRMED: &str = "unconfirmed";

include!("app/cli.rs");

include!("app/agent_server.rs");

include!("app/storage.rs");

include!("app/http_error.rs");

include!("app/discovery_api.rs");

include!("app/serial_firmware.rs");

include!("app/storage_routes.rs");

include!("app/discovery.rs");

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Json, Router,
        response::{IntoResponse, Response},
        routing::get,
    };
    use http_body_util::BodyExt;
    use std::{
        env, fs,
        path::PathBuf,
        sync::{Arc, Once},
        time::Duration,
    };
    use tokio::net::TcpListener;

    #[derive(Clone, Debug)]
    enum InfoResponse {
        Valid { device_id: Option<String> },
        WrongFirmware,
        InvalidJson,
        Status(StatusCode),
    }

    struct TestServer {
        base_url: String,
        ipv4: Ipv4Addr,
        port: u16,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for TestServer {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    fn init_tracing() {
        static INIT: Once = Once::new();
        INIT.call_once(|| {
            let _ = tracing_subscriber::fmt()
                .with_env_filter(tracing_subscriber::EnvFilter::new("debug"))
                .with_test_writer()
                .try_init();
        });
    }

    async fn spawn_info_server(response: InfoResponse) -> TestServer {
        let response = Arc::new(response);
        let app = Router::new().route(
            "/api/v1/info",
            get({
                let response = Arc::clone(&response);
                move || async move { info_response(&response).into_response() }
            }),
        );

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test listener");
        let addr = listener.local_addr().expect("listener addr");
        let task = tokio::spawn(async move {
            if let Err(err) = axum::serve(listener, app).await {
                eprintln!("test server error: {err}");
            }
        });

        TestServer {
            base_url: format!("http://127.0.0.1:{}", addr.port()),
            ipv4: Ipv4Addr::LOCALHOST,
            port: addr.port(),
            task,
        }
    }

    fn info_response(response: &InfoResponse) -> Response {
        match response {
            InfoResponse::Valid { device_id } => {
                let body = serde_json::json!({
                    "device": {
                        "device_id": device_id,
                        "hostname": "isolapurr-test",
                        "fqdn": "isolapurr-test.local",
                        "variant": "test",
                        "firmware": {
                            "name": "isolapurr-usb-hub",
                            "version": "0.0.0-test"
                        },
                        "wifi": { "ipv4": "127.0.0.1" }
                    }
                });
                (StatusCode::OK, Json(body)).into_response()
            }
            InfoResponse::WrongFirmware => {
                let body = serde_json::json!({
                    "device": {
                        "firmware": { "name": "not-isolapurr", "version": "0.0.0-test" }
                    }
                });
                (StatusCode::OK, Json(body)).into_response()
            }
            InfoResponse::InvalidJson => (StatusCode::OK, "not-json").into_response(),
            InfoResponse::Status(code) => (*code, "error").into_response(),
        }
    }

    fn make_controller(timeout_ms: u64, mdns_error: Option<String>) -> DiscoveryController {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .build()
            .expect("http client");
        DiscoveryController::new(None, mdns_error, http)
    }

    fn resolved_for(server: &TestServer) -> ResolvedService {
        ResolvedService {
            hostname: "isolapurr-test".to_string(),
            port: server.port,
            ipv4: Some(server.ipv4),
        }
    }

    #[test]
    fn cli_filters_esp32_serial_candidates() {
        let ports = filter_esp32_serial_ports(vec![
            SerialPortInfo {
                path: "/dev/tty.usbmodem21221401".to_string(),
                label: "USB JTAG/serial debug unit".to_string(),
                vendor_id: Some(0x303a),
                product_id: Some(0x1001),
                serial_number: None,
                manufacturer: Some("Espressif".to_string()),
                product: Some("USB JTAG/serial debug unit".to_string()),
            },
            SerialPortInfo {
                path: "/dev/cu.usbmodem21221401".to_string(),
                label: "USB JTAG/serial debug unit".to_string(),
                vendor_id: Some(0x303a),
                product_id: Some(0x1001),
                serial_number: None,
                manufacturer: Some("Espressif".to_string()),
                product: Some("USB JTAG/serial debug unit".to_string()),
            },
            SerialPortInfo {
                path: "/dev/cu.Bluetooth-Incoming-Port".to_string(),
                label: "Bluetooth".to_string(),
                vendor_id: None,
                product_id: None,
                serial_number: None,
                manufacturer: None,
                product: None,
            },
        ]);
        assert_eq!(ports.len(), 1);
        assert_eq!(ports[0].path, "/dev/cu.usbmodem21221401");
    }

    #[test]
    fn jsonl_response_must_match_request_id() {
        assert!(jsonl_response_matches(
            &serde_json::json!({"id": 7, "ok": true}),
            Some(&serde_json::json!(7))
        ));
        assert!(!jsonl_response_matches(
            &serde_json::json!({"id": 8, "ok": true}),
            Some(&serde_json::json!(7))
        ));
        assert!(jsonl_response_matches(
            &serde_json::json!({"ok": true}),
            None
        ));
    }

    #[test]
    fn extracts_identity_from_info_response_shapes() {
        let nested = serde_json::json!({
            "id": 1,
            "ok": true,
            "result": {
                "device": {
                    "device_id": "f293cc",
                    "mac": "aa:bb:cc:dd:ee:ff"
                }
            }
        });
        let identity = extract_device_identity(&nested).expect("identity");
        assert_eq!(identity.device_id.as_deref(), Some("f293cc"));
        assert_eq!(identity.mac.as_deref(), Some("aa:bb:cc:dd:ee:ff"));
    }

    #[test]
    fn parses_port_preference_cache_with_identity() {
        let cache = parse_port_preference_cache(
            "/dev/cu.usbmodem212101\nmac=50:78:7d:19:88:40\ndevice_id=isolapurr-198840\n",
        )
        .expect("parse cache")
        .expect("cache present");

        assert_eq!(cache.port, "/dev/cu.usbmodem212101");
        assert_eq!(cache.mac.as_deref(), Some("50:78:7d:19:88:40"));
        assert_eq!(cache.device_id.as_deref(), Some("isolapurr-198840"));
    }

    #[test]
    fn parses_unconfirmed_port_preference_cache() {
        let cache = parse_port_preference_cache(
            "/dev/cu.usbmodem21231401\nidentity=unconfirmed\nsource=isolapurr-desktop select-port\n",
        )
        .expect("parse cache")
        .expect("cache present");

        assert_eq!(cache.port, "/dev/cu.usbmodem21231401");
        assert!(cache.is_unconfirmed());
        assert!(!cache.has_identity());
    }

    #[test]
    fn port_preference_cache_requires_identity_or_unconfirmed_state() {
        let err = parse_port_preference_cache("/dev/cu.usbmodem212101\n")
            .expect_err("missing identity state should fail");

        assert!(
            err.to_string().contains("identity=unconfirmed"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn port_preference_cache_rejects_unknown_identity_state() {
        let err = parse_port_preference_cache("/dev/cu.usbmodem212101\nidentity=unknown\n")
            .expect_err("unknown identity state should fail");

        assert!(
            err.to_string().contains("unsupported identity state"),
            "unexpected error: {err:#}"
        );
    }

    #[test]
    fn flash_address_is_locked_to_app_partition() {
        assert_eq!(
            parse_flash_address("0x10000").unwrap(),
            DEFAULT_FLASH_ADDRESS
        );
        assert!(parse_flash_address("0x0").is_err());
    }

    #[test]
    fn cli_flash_request_can_omit_expected_identity_for_first_flash() {
        let req = FirmwareFlashRequest {
            port_path: "/dev/cu.usbmodem1".to_string(),
            address: DEFAULT_FLASH_ADDRESS,
            file_name: "firmware.bin".to_string(),
            file_base64: "not-base64".to_string(),
            expected_identity: None,
        };
        let err = run_firmware_flash(req).expect_err("invalid payload should fail");

        assert!(
            err.contains("firmware payload was not valid base64"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn full_flash_requires_existing_elf() {
        let missing = PathBuf::from("/tmp/isolapurr-missing-release.elf");
        let err = run_firmware_full_flash_elf("/dev/cu.usbmodem1", &missing)
            .expect_err("missing ELF should fail before espflash");

        assert!(
            err.contains("ELF does not exist"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn identity_mismatch_is_explicit() {
        let actual = PortIdentityCache {
            port: "/dev/cu.usbmodem1".to_string(),
            identity: None,
            device_id: Some("actual".to_string()),
            mac: Some("aa:bb:cc:dd:ee:ff".to_string()),
            confirmed_at: "2026-05-19T00:00:00Z".to_string(),
            source: "test".to_string(),
        };
        let err = ensure_identity_matches(
            &actual,
            &DeviceIdentityExpectation {
                device_id: Some("expected".to_string()),
                mac: None,
            },
        )
        .expect_err("mismatch");
        assert!(err.contains("device identity mismatch"));
    }

    #[test]
    fn serial_port_names_match_windows_case_insensitively() {
        assert!(serial_port_name_matches("COM3", "com3"));
        assert!(serial_port_name_matches(
            "/dev/cu.usbmodem1",
            "/dev/cu.usbmodem1"
        ));
        assert!(!serial_port_name_matches("COM4", "COM3"));
    }

    #[tokio::test]
    async fn discovery_accepts_valid_device() {
        init_tracing();
        let server = spawn_info_server(InfoResponse::Valid {
            device_id: Some("dev-1".to_string()),
        })
        .await;
        let controller = make_controller(400, Some("mdns unavailable".to_string()));
        controller
            .handle_resolved(resolved_for(&server))
            .await
            .expect("handle resolved");

        let snapshot = controller.snapshot().await;
        assert_eq!(
            snapshot.devices.len(),
            1,
            "expected 1 device, got {:?}",
            snapshot.devices
        );
        let device = snapshot.devices.first().expect("device entry");
        assert_eq!(device.device_id.as_deref(), Some("dev-1"));
        assert_eq!(device.base_url, server.base_url);
        assert_eq!(snapshot.status, DiscoveryStatus::Ready);
    }

    #[tokio::test]
    async fn discovery_filters_non_device() {
        init_tracing();
        let server = spawn_info_server(InfoResponse::WrongFirmware).await;
        let controller = make_controller(300, Some("mdns unavailable".to_string()));
        controller
            .handle_resolved(resolved_for(&server))
            .await
            .expect("handle resolved");

        let snapshot = controller.snapshot().await;
        assert!(
            snapshot.devices.is_empty(),
            "expected filtered device, got {:?}",
            snapshot.devices
        );
    }

    #[tokio::test]
    async fn discovery_filters_invalid_json_and_non_2xx() {
        init_tracing();
        let controller = make_controller(300, Some("mdns unavailable".to_string()));

        let bad_json = spawn_info_server(InfoResponse::InvalidJson).await;
        controller
            .handle_resolved(resolved_for(&bad_json))
            .await
            .expect("handle resolved bad json");

        let bad_status = spawn_info_server(InfoResponse::Status(StatusCode::BAD_GATEWAY)).await;
        controller
            .handle_resolved(resolved_for(&bad_status))
            .await
            .expect("handle resolved bad status");

        let snapshot = controller.snapshot().await;
        assert!(
            snapshot.devices.is_empty(),
            "expected no devices after invalid responses, got {:?}",
            snapshot.devices
        );
    }

    #[tokio::test]
    async fn discovery_dedups_by_device_id() {
        init_tracing();
        let server_a = spawn_info_server(InfoResponse::Valid {
            device_id: Some("dev-1".to_string()),
        })
        .await;
        let server_b = spawn_info_server(InfoResponse::Valid {
            device_id: Some("dev-1".to_string()),
        })
        .await;
        let controller = make_controller(400, Some("mdns unavailable".to_string()));

        controller
            .handle_resolved(resolved_for(&server_a))
            .await
            .expect("handle resolved a");
        controller
            .handle_resolved(resolved_for(&server_b))
            .await
            .expect("handle resolved b");

        let snapshot = controller.snapshot().await;
        assert_eq!(
            snapshot.devices.len(),
            1,
            "expected 1 device after dedup, got {:?}",
            snapshot.devices
        );
        let device = snapshot.devices.first().expect("device entry");
        assert_eq!(device.device_id.as_deref(), Some("dev-1"));
        assert_eq!(
            device.base_url, server_b.base_url,
            "expected latest base_url to win"
        );
        assert!(
            device
                .last_seen_at
                .as_ref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false),
            "expected last_seen_at to be set"
        );
    }

    #[tokio::test]
    async fn discovery_unreachable_candidate_times_out() {
        init_tracing();
        let controller = make_controller(200, Some("mdns unavailable".to_string()));
        let port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind unused port");
            let port = listener.local_addr().expect("listener addr").port();
            drop(listener);
            port
        };
        let resolved = ResolvedService {
            hostname: "isolapurr-unused".to_string(),
            port,
            ipv4: Some(Ipv4Addr::LOCALHOST),
        };

        let result = tokio::time::timeout(
            Duration::from_millis(600),
            controller.handle_resolved(resolved),
        )
        .await;
        assert!(result.is_ok(), "handle_resolved timed out");

        let snapshot = controller.snapshot().await;
        assert!(
            snapshot.devices.is_empty(),
            "expected no devices after timeout, got {:?}",
            snapshot.devices
        );
    }

    #[tokio::test]
    async fn discovery_reports_mdns_unavailable() {
        init_tracing();
        let controller = make_controller(200, Some("mdns unavailable".to_string()));
        let snapshot = controller.snapshot().await;
        assert_eq!(snapshot.status, DiscoveryStatus::Unavailable);
        assert!(
            snapshot
                .error
                .as_ref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false),
            "expected non-empty error message"
        );

        let result = controller.refresh_services().await;
        assert!(result.is_err(), "expected refresh to fail");
        let snapshot = controller.snapshot().await;
        assert_eq!(snapshot.status, DiscoveryStatus::Unavailable);
    }

    fn temp_storage_path(label: &str) -> PathBuf {
        let mut dir = env::temp_dir();
        let suffix = time::OffsetDateTime::now_utc().unix_timestamp_nanos();
        dir.push(format!("isolapurr-storage-{label}-{suffix}"));
        let _ = fs::create_dir_all(&dir);
        dir.join("storage.json")
    }

    #[tokio::test]
    async fn storage_roundtrip_devices() {
        let path = temp_storage_path("roundtrip");
        let manager = StorageManager::load_at(path.clone()).expect("load storage");
        let device = manager
            .upsert_device(UpsertDeviceInput {
                id: Some("f293cc9c139e".to_string()),
                name: "Desk Hub".to_string(),
                base_url: "http://127.0.0.1:1234".to_string(),
                transports: Some(StoredDeviceTransports {
                    http_base_url: Some("http://127.0.0.1:1234".to_string()),
                    local_usb_port_path: Some("/dev/cu.usbmodem21221401".to_string()),
                    web_serial_label: None,
                }),
            })
            .await
            .expect("upsert");
        let list = manager.list_devices().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, device.id);

        let manager = StorageManager::load_at(path).expect("reload storage");
        let list = manager.list_devices().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].base_url, "http://127.0.0.1:1234");
        assert_eq!(list[0].id, "f293cc9c139e");
        assert_eq!(
            list[0]
                .transports
                .as_ref()
                .and_then(|value| value.local_usb_port_path.as_deref()),
            Some("/dev/cu.usbmodem21221401")
        );
    }

    #[tokio::test]
    async fn storage_recovers_from_corrupt_file() {
        let path = temp_storage_path("corrupt");
        fs::write(&path, "not-json").expect("write corrupt");
        let manager = StorageManager::load_at(path.clone()).expect("load storage");
        let exported = manager.export().await;
        assert!(exported.devices.is_empty());
        assert!(
            exported
                .meta
                .as_ref()
                .and_then(|meta| meta.last_corrupt_at.as_ref())
                .is_some(),
            "expected last_corrupt_at metadata"
        );
        assert!(path.exists(), "storage should be recreated");
        let parent = path.parent().expect("parent dir");
        let mut found_backup = false;
        for entry in fs::read_dir(parent).expect("read dir") {
            let entry = entry.expect("dir entry");
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with("storage.corrupt.") {
                    found_backup = true;
                    break;
                }
            }
        }
        assert!(found_backup, "expected corrupt backup file");
    }

    #[tokio::test]
    async fn storage_migrates_once() {
        let path = temp_storage_path("migrate");
        let manager = StorageManager::load_at(path).expect("load storage");
        let res = manager
            .migrate_from_localstorage(MigrateRequest {
                source: "localStorage".to_string(),
                devices: Some(vec![MigrateDeviceInput {
                    id: Some("f293cc9c139e".to_string()),
                    name: Some("Demo".to_string()),
                    base_url: Some("http://127.0.0.1:8080".to_string()),
                    last_seen_at: None,
                    transports: Some(StoredDeviceTransports {
                        http_base_url: Some("http://127.0.0.1:8080".to_string()),
                        local_usb_port_path: Some("/dev/cu.usbmodem21221401".to_string()),
                        web_serial_label: None,
                    }),
                }]),
                settings: Some(MigrateSettingsInput {
                    theme: Some("system".to_string()),
                }),
            })
            .await
            .expect("migrate");
        assert!(res.migrated);

        let res = manager
            .migrate_from_localstorage(MigrateRequest {
                source: "localStorage".to_string(),
                devices: None,
                settings: None,
            })
            .await
            .expect("migrate");
        assert!(!res.migrated);
        assert_eq!(res.reason.as_deref(), Some("already_initialized"));
    }

    #[tokio::test]
    async fn storage_drops_legacy_and_invalid_device_ids_on_load() {
        let path = temp_storage_path("legacy-cleanup");
        fs::write(
            &path,
            serde_json::to_string_pretty(&serde_json::json!({
                "schemaVersion": 1,
                "devices": [
                    {
                        "id": "f293cc",
                        "name": "Legacy Six",
                        "baseUrl": "http://127.0.0.1:8080"
                    },
                    {
                        "id": "garbage123",
                        "name": "Garbage",
                        "baseUrl": "http://127.0.0.1:9999"
                    },
                    {
                        "id": "f293cc9c139e",
                        "name": "Canonical",
                        "baseUrl": "http://127.0.0.1:1234",
                        "transports": {
                            "localUsbPortPath": "/dev/cu.usbmodem21221401"
                        }
                    }
                ],
                "settings": {
                    "theme": "isolapurr"
                }
            }))
            .expect("encode storage"),
        )
        .expect("write storage");

        let manager = StorageManager::load_at(path.clone()).expect("load storage");
        let list = manager.list_devices().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "f293cc9c139e");
        assert_eq!(list[0].name, "Canonical");
        assert_eq!(
            list[0]
                .transports
                .as_ref()
                .and_then(|value| value.local_usb_port_path.as_deref()),
            Some("/dev/cu.usbmodem21221401")
        );

        let persisted = fs::read_to_string(path).expect("read sanitized storage back from disk");
        assert!(persisted.contains("f293cc9c139e"));
        assert!(!persisted.contains("\"f293cc\""));
        assert!(!persisted.contains("garbage123"));
    }

    #[tokio::test]
    async fn storage_handler_lists_devices() {
        let path = temp_storage_path("handler");
        let manager = StorageManager::load_at(path).expect("load storage");
        manager
            .upsert_device(UpsertDeviceInput {
                id: Some("f293cc9c139e".to_string()),
                name: "Desk Hub".to_string(),
                base_url: "http://127.0.0.1:1234".to_string(),
                transports: None,
            })
            .await
            .expect("upsert");
        let state = AppState {
            token: "token".to_string(),
            agent_base_url: Url::parse("http://127.0.0.1:1234").unwrap(),
            mode: "test",
            discovery: Arc::new(make_controller(200, None)),
            storage: Arc::new(manager),
            serial_lock: Arc::new(TokioMutex::new(())),
        };

        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str("Bearer token").unwrap(),
        );
        let response = api_storage_list_devices(State(state), headers).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let parsed: DevicesResponse = serde_json::from_slice(&body).expect("parse response");
        assert_eq!(parsed.devices.len(), 1);
        assert_eq!(parsed.devices[0].id, "f293cc9c139e");
    }

    #[test]
    fn local_web_origin_allows_only_product_web_ports() {
        let agent_port = 51234;
        for origin in [
            format!("http://127.0.0.1:{agent_port}"),
            "http://127.0.0.1:45173".to_string(),
            "http://localhost:45175".to_string(),
            "tauri://localhost".to_string(),
        ] {
            let header = HeaderValue::from_str(&origin).expect("origin header");
            assert!(
                is_local_web_origin(&header, agent_port),
                "expected allowed origin: {origin}",
            );
        }
    }

    #[test]
    fn local_web_origin_rejects_untrusted_loopback_ports() {
        let agent_port = 51234;
        for origin in [
            "http://127.0.0.1:3000",
            "http://localhost:8080",
            "http://[::1]:5173",
            "https://example.com",
        ] {
            let header = HeaderValue::from_str(origin).expect("origin header");
            assert!(
                !is_local_web_origin(&header, agent_port),
                "expected rejected origin: {origin}",
            );
        }
    }

    fn test_iface(
        name: &str,
        friendly: Option<&str>,
        if_type: InterfaceType,
        ipv4: Vec<LanIpv4Net>,
    ) -> LanIface {
        LanIface {
            name: name.to_string(),
            friendly_name: friendly.map(|s| s.to_string()),
            if_type,
            is_up: true,
            is_loopback: false,
            is_tun: false,
            ipv4,
        }
    }

    #[test]
    fn lan_candidates_picks_primary_default_cidr() {
        let interfaces = vec![
            test_iface(
                "en0",
                Some("Wi-Fi"),
                InterfaceType::Wireless80211,
                vec![LanIpv4Net {
                    addr: Ipv4Addr::new(192, 168, 1, 23),
                    prefix_len: 24,
                    network: Ipv4Addr::new(192, 168, 1, 0),
                }],
            ),
            test_iface(
                "en5",
                Some("Ethernet"),
                InterfaceType::Ethernet,
                vec![LanIpv4Net {
                    addr: Ipv4Addr::new(10, 0, 0, 5),
                    prefix_len: 24,
                    network: Ipv4Addr::new(10, 0, 0, 0),
                }],
            ),
        ];

        let (default_cidr, candidates) = compute_lan_candidates(&interfaces, Some("en5"));

        assert_eq!(default_cidr.as_deref(), Some("10.0.0.0/24"));
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].cidr, "10.0.0.0/24");
        assert_eq!(candidates[0].r#interface.as_deref(), Some("en5"));
        assert_eq!(candidates[0].primary, Some(true));
        assert_eq!(candidates[1].cidr, "192.168.1.0/24");
        assert_eq!(candidates[1].primary, Some(false));
    }

    #[test]
    fn lan_candidates_filters_link_local_and_loopback() {
        let mut loopback = test_iface(
            "lo0",
            Some("Loopback"),
            InterfaceType::Loopback,
            vec![LanIpv4Net {
                addr: Ipv4Addr::new(127, 0, 0, 1),
                prefix_len: 8,
                network: Ipv4Addr::new(127, 0, 0, 0),
            }],
        );
        loopback.is_loopback = true;

        let interfaces = vec![
            loopback,
            test_iface(
                "en0",
                Some("Wi-Fi"),
                InterfaceType::Wireless80211,
                vec![
                    LanIpv4Net {
                        addr: Ipv4Addr::new(169, 254, 10, 1),
                        prefix_len: 16,
                        network: Ipv4Addr::new(169, 254, 0, 0),
                    },
                    LanIpv4Net {
                        addr: Ipv4Addr::new(192, 168, 0, 2),
                        prefix_len: 24,
                        network: Ipv4Addr::new(192, 168, 0, 0),
                    },
                ],
            ),
        ];

        let (default_cidr, candidates) = compute_lan_candidates(&interfaces, Some("en0"));

        assert_eq!(default_cidr.as_deref(), Some("192.168.0.0/24"));
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].cidr, "192.168.0.0/24");
    }
}
