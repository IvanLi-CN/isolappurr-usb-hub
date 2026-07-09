use super::*;
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use tower::util::ServiceExt as _;

#[tokio::test]
async fn web_root_serves_spa_index_for_unknown_app_routes() {
    let temp = tempfile::tempdir().expect("temp dir");
    let root = temp.path();
    fs::write(root.join("index.html"), "<!doctype html><title>spa</title>").expect("write index");

    let app = router(
        AppState::new("http://127.0.0.1:0".to_string()),
        Some(root.to_path_buf()),
        false,
    );

    let response = app
        .oneshot(
            Request::builder()
                .uri("/flash")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    assert!(String::from_utf8_lossy(&body).contains("<title>spa</title>"));
}

#[tokio::test]
async fn web_root_keeps_existing_asset_responses() {
    let temp = tempfile::tempdir().expect("temp dir");
    let root = temp.path();
    fs::write(root.join("index.html"), "<!doctype html><title>spa</title>").expect("write index");
    fs::create_dir_all(root.join("assets")).expect("assets dir");
    fs::write(root.join("assets/hello.txt"), "asset-body").expect("write asset");

    let app = router(
        AppState::new("http://127.0.0.1:0".to_string()),
        Some(root.to_path_buf()),
        false,
    );

    let response = app
        .oneshot(
            Request::builder()
                .uri("/assets/hello.txt")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    assert_eq!(String::from_utf8_lossy(&body), "asset-body");
}

#[test]
fn power_config_verify_matches_requested_payload_without_runtime_only_fields() {
    let observed = json!({
        "ok": true,
        "result": {
            "hardware": "sw2303",
            "persisted": true,
            "tps_mode": "manual",
            "light_load_mode": "fpwm",
            "capability": {
                "profile": "full",
                "power_watts": 100,
                "protocols": {
                    "pd": true,
                    "qc20": true,
                    "qc30": true,
                    "fcp": true,
                    "afc": true,
                    "scp": true,
                    "pe20": true,
                    "bc12": true,
                    "sfcp": true
                },
                "pd": {
                    "pps": true,
                    "fixed_voltages_mv": [9000, 12000, 15000, 20000]
                }
            },
            "manual": {
                "voltage_mv": 4800,
                "current_limit_ma": 1000,
                "usb_c_path_mode": "default",
                "path_policy": "force_close"
            },
            "lock": {
                "owner": 42,
                "expires_at_ms": 1234
            }
        }
    });
    let expected = json!({
        "hardware": "sw2303",
        "tps_mode": "manual",
        "light_load_mode": "fpwm",
        "capability": {
            "profile": "full",
            "power_watts": 100,
            "protocols": {
                "pd": true,
                "qc20": true,
                "qc30": true,
                "fcp": true,
                "afc": true,
                "scp": true,
                "pe20": true,
                "bc12": true,
                "sfcp": true
            },
            "pd": {
                "pps": true,
                "fixed_voltages_mv": [9000, 12000, 15000, 20000]
            }
        },
        "manual": {
            "voltage_mv": 4800,
            "current_limit_ma": 1000,
            "usb_c_path_mode": "default"
        }
    });

    assert!(power_config_matches_expected(&observed, &expected));
}

#[test]
fn power_config_verify_rejects_mismatched_requested_payload() {
    let observed = json!({
        "ok": true,
        "result": {
            "hardware": "sw2303",
            "persisted": true,
            "tps_mode": "manual",
            "light_load_mode": "pfm",
            "capability": {
                "profile": "full",
                "power_watts": 100,
                "protocols": {
                    "pd": true,
                    "qc20": true,
                    "qc30": true,
                    "fcp": true,
                    "afc": true,
                    "scp": true,
                    "pe20": true,
                    "bc12": true,
                    "sfcp": true
                },
                "pd": {
                    "pps": true,
                    "fixed_voltages_mv": [9000, 12000, 15000, 20000]
                }
            },
            "manual": {
                "voltage_mv": 5000,
                "current_limit_ma": 1000,
                "usb_c_path_mode": "default"
            }
        }
    });
    let expected = json!({
        "hardware": "sw2303",
        "tps_mode": "manual",
        "light_load_mode": "fpwm",
        "capability": {
            "profile": "full",
            "power_watts": 100,
            "protocols": {
                "pd": true,
                "qc20": true,
                "qc30": true,
                "fcp": true,
                "afc": true,
                "scp": true,
                "pe20": true,
                "bc12": true,
                "sfcp": true
            },
            "pd": {
                "pps": true,
                "fixed_voltages_mv": [9000, 12000, 15000, 20000]
            }
        },
        "manual": {
            "voltage_mv": 4800,
            "current_limit_ma": 1000,
            "usb_c_path_mode": "default"
        }
    });

    assert!(!power_config_matches_expected(&observed, &expected));
}

#[test]
fn power_config_defaults_match_full_profile() {
    let observed = json!({
        "ok": true,
        "result": {
            "hardware": "sw2303",
            "persisted": true,
            "tps_mode": "auto_follow",
            "light_load_mode": "pfm",
            "capability": {
                "profile": "full",
                "power_watts": 100,
                "protocols": {
                    "pd": true,
                    "qc20": true,
                    "qc30": true,
                    "fcp": true,
                    "afc": true,
                    "scp": true,
                    "pe20": true,
                    "bc12": true,
                    "sfcp": true
                },
                "pd": {
                    "pps": true,
                    "fixed_voltages_mv": [9000, 12000, 15000, 20000]
                }
            },
            "manual": {
                "voltage_mv": 5000,
                "current_limit_ma": 1000,
                "usb_c_path_mode": "default",
                "path_policy": "auto"
            }
        }
    });

    assert!(power_config_matches_defaults(&observed));
}
