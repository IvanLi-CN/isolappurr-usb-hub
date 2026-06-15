use super::*;

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
