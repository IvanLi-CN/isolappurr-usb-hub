use super::{
    CliPowerConfig, CliPowerDiagnostics, CliPowerSetpoint, DeviceProfile, DiscoverFirmware,
    LightLoadModeArg, ManualOutputArgs, OutputUsbCPathArg, PowerConfigSetArgs,
    SourceCapabilitySetArgs, TpsModeArg, apply_manual_output_args, apply_power_config_set_args,
    discover_usb_match_keys, format_power_config_output, format_power_show_output,
    parse_device_identity_from_info, parse_discovered_http_info,
    saved_hardware_match_for_transport,
};
use serde_json::json;

#[test]
fn power_config_human_output_avoids_chip_names() {
    let rendered = format_power_config_output(&json!({
        "hardware": "sw2303",
        "persisted": true,
        "tps_mode": "manual",
        "light_load_mode": "fpwm",
        "capability": {
            "profile": "full",
            "power_watts": 65,
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
            },
            "current": {
                "pps3_limit_ma": 5000,
                "pd_pps_5a": false,
                "type_c_broadcast_ma": 500,
                "scp_limit_ma": 5000,
                "fcp_afc_sfcp_limit_ma": 3250
            }
        },
        "manual": {
            "voltage_mv": 12000,
            "current_limit_ma": 3000,
            "usb_c_path_mode": "default",
            "path_policy": "auto"
        },
        "lock": null
    }));

    assert!(rendered.contains("Output mode: Manual bench output"));
    assert!(rendered.contains("Light-load mode: FPWM"));
    assert!(rendered.contains("Current profile: PPS3 5000 mA"));
    assert!(!rendered.to_ascii_lowercase().contains("sw2303"));
    assert!(!rendered.contains("TPS"));
}

#[test]
fn power_show_human_output_summarizes_live_status_without_chip_names() {
    let rendered = format_power_show_output(&json!({
        "config": {
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
                },
                "current": {
                    "pps3_limit_ma": 5000,
                    "pd_pps_5a": false,
                    "type_c_broadcast_ma": 500,
                    "scp_limit_ma": 5000,
                    "fcp_afc_sfcp_limit_ma": 3250
                }
            },
            "manual": {
                "voltage_mv": 5000,
                "current_limit_ma": 5000,
                "usb_c_path_mode": "default",
                "path_policy": "auto"
            },
            "lock": null
        },
        "ports": {
            "ports": [{
                "portId": "port_c",
                "label": "USB-C",
                "telemetry": {
                    "status": "ok",
                    "voltage_mv": 20000,
                    "current_ma": 3210,
                    "power_mw": 64200,
                    "sample_uptime_ms": 1500
                },
                "telemetry_raw": {
                    "status": "ok",
                    "voltage_mv": 20000,
                    "current_ma": 3250,
                    "power_mw": 65000,
                    "sample_uptime_ms": 1500
                }
            }]
        },
        "diagnostics": {
            "usb_c_power_enabled": true,
            "sw2303_i2c_allowed": true,
            "sw2303_profile_applied": true,
            "sw2303_stable_reads": 3,
            "sw2303_error_latched": false,
            "tps_error_latched": false,
            "sw2303_readback_config": {
                "available": true,
                "matches_config": true,
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
                },
                "current": {
                    "pps3_current_limit_ma": 5000,
                    "pd_pps_5a": false,
                    "type_c_broadcast_ma": 500,
                    "scp_current_limit_ma": 5000,
                    "fcp_afc_sfcp_limit_ma": 3250
                }
            },
            "sw2303_request": {
                "mv": 20000,
                "ma": 3250
            },
            "sw2303_last_valid_request": {
                "mv": 20000,
                "ma": 3250
            },
            "tps_setpoint": {
                "output_enabled": true,
                "mv": 20000,
                "iout_limit_ma": 3250
            },
            "tps_iout_limit_readback": {
                "enabled": true,
                "ma": 3250
            },
            "idle_bias": {
                "correction_enabled": true,
                "dataset": {
                    "status": "valid",
                    "min_voltage_mv": 3000,
                    "max_voltage_mv": 21000,
                    "step_mv": 500,
                    "point_count": 37,
                    "offsets_ma": [12, 14]
                },
                "current_applied_offset_ma": 40,
                "run": {
                    "state": "idle",
                    "completed_points": 0,
                    "point_count": 37,
                    "target_voltage_mv": null,
                    "error": null
                }
            },
            "runtime_recovery_count": 0,
            "sample_uptime_ms": 1500
        }
    }));

    assert!(rendered.contains("Live USB-C status"));
    assert!(rendered.contains("USB-C output"));
    assert!(rendered.contains("Corrected telemetry: 20000 mV @ 3210 mA / 64200 mW"));
    assert!(rendered.contains("Capability state: applied"));
    assert!(rendered.contains("Advertised source: 100 W"));
    assert!(rendered.contains("Negotiated request: 20000 mV @ 3250 mA"));
    assert!(rendered.contains("TPS IOUT_LIMIT: 3250 mA"));
    assert!(rendered.contains("Idle-bias dataset: valid (3000..21000 mV, 37 points, step 500 mV)"));
    assert!(rendered.contains("Idle-bias correction: enabled"));
    assert!(!rendered.to_ascii_lowercase().contains("sw2303"));
    assert!(!rendered.contains("TPS55288"));
}

#[test]
fn power_config_deserializes_when_current_profile_is_missing() {
    let parsed: CliPowerConfig = serde_json::from_value(json!({
        "hardware": "legacy-hardware",
        "persisted": true,
        "tps_mode": "auto_follow",
        "capability": {
            "profile": "full",
            "power_watts": 100,
            "protocols": {
                "pd": true,
                "qc20": false,
                "qc30": false,
                "fcp": false,
                "afc": false,
                "scp": false,
                "pe20": false,
                "bc12": false,
                "sfcp": false
            },
            "pd": {
                "pps": true,
                "fixed_voltages_mv": [9000, 12000, 15000, 20000]
            }
        },
        "manual": {
            "voltage_mv": 5000,
            "current_limit_ma": 5000,
            "usb_c_path_mode": "default",
            "path_policy": "auto"
        },
        "lock": null
    }))
    .expect("legacy config without current profile should deserialize");

    assert_eq!(parsed.light_load_mode, "pfm");
    assert_eq!(parsed.capability.current.pps3_limit_ma, 5000);
    assert!(!parsed.capability.current.pd_pps_5a);
    assert_eq!(parsed.capability.current.type_c_broadcast_ma, 500);
    assert_eq!(parsed.capability.current.scp_limit_ma, 5000);
    assert_eq!(parsed.capability.current.fcp_afc_sfcp_limit_ma, 3250);
}

#[test]
fn power_diagnostics_deserializes_when_readback_current_is_missing() {
    let parsed: CliPowerDiagnostics = serde_json::from_value(json!({
        "usb_c_power_enabled": true,
        "sw2303_i2c_allowed": true,
        "sw2303_profile_applied": true,
        "sw2303_stable_reads": 3,
        "sw2303_error_latched": false,
        "tps_error_latched": false,
        "sw2303_readback_config": {
            "available": true,
            "matches_config": true,
            "power_watts": 100,
            "protocols": {
                "pd": true,
                "qc20": false,
                "qc30": false,
                "fcp": false,
                "afc": false,
                "scp": false,
                "pe20": false,
                "bc12": false,
                "sfcp": false
            },
            "pd": {
                "pps": true,
                "fixed_voltages_mv": [9000, 12000, 15000, 20000]
            }
        },
        "sw2303_request": {
            "mv": 12000,
            "ma": 5000
        },
        "sw2303_vbus_mv": 11980,
        "sw2303_last_valid_request": {
            "mv": 12000,
            "ma": 5000
        },
        "display": {
            "mode": {
                "kind": "dc",
                "label": "12.0V"
            },
            "measurements_visible": true,
            "badge": {
                "kind": "on",
                "label": "ON"
            }
        },
        "usb_c_actual": {
            "status": "ok",
            "voltage_mv": 11980,
            "current_ma": 0,
            "power_mw": 0,
            "sample_uptime_ms": 1500
        },
        "tps_setpoint": {
            "output_enabled": true,
            "mv": 12000,
            "iout_limit_ma": 4950
        },
        "tps_iout_limit_readback": {
            "enabled": true,
            "ma": 4950
        },
        "runtime_recovery_count": 0,
        "sample_uptime_ms": 1500
    }))
    .expect("legacy diagnostics without current readback should deserialize");

    assert_eq!(parsed.sw2303_readback_config.current.pps3_limit_ma, None);
    assert_eq!(parsed.sw2303_readback_config.current.pd_pps_5a, None);
    assert_eq!(
        parsed.sw2303_readback_config.current.type_c_broadcast_ma,
        None
    );
    assert_eq!(parsed.sw2303_readback_config.current.scp_limit_ma, None);
    assert_eq!(
        parsed.sw2303_readback_config.current.fcp_afc_sfcp_limit_ma,
        None
    );
    assert_eq!(parsed.sw2303_vbus_mv, Some(11980));
    assert!(
        parsed
            .display
            .as_ref()
            .is_some_and(|display| display.measurements_visible)
    );
    assert_eq!(
        parsed
            .usb_c_actual
            .as_ref()
            .and_then(|telemetry| telemetry.current_ma),
        Some(0)
    );
}

#[test]
fn power_diagnostics_deserializes_legacy_ilim_field() {
    let parsed: CliPowerDiagnostics = serde_json::from_value(json!({
        "usb_c_power_enabled": true,
        "sw2303_i2c_allowed": true,
        "sw2303_profile_applied": true,
        "sw2303_stable_reads": 3,
        "sw2303_error_latched": false,
        "tps_error_latched": false,
        "sw2303_readback_config": {
            "available": true,
            "matches_config": true,
            "power_watts": 100,
            "protocols": {
                "pd": true,
                "qc20": false,
                "qc30": false,
                "fcp": false,
                "afc": false,
                "scp": false,
                "pe20": false,
                "bc12": false,
                "sfcp": false
            },
            "pd": {
                "pps": true,
                "fixed_voltages_mv": [9000, 12000, 15000, 20000]
            }
        },
        "sw2303_request": {
            "mv": 20000,
            "ma": 3250
        },
        "sw2303_last_valid_request": {
            "mv": 20000,
            "ma": 3250
        },
        "tps_setpoint": {
            "output_enabled": true,
            "mv": 20000,
            "ilim_ma": 3250
        },
        "runtime_recovery_count": 0,
        "sample_uptime_ms": 1500
    }))
    .expect("legacy ilim diagnostics should deserialize");

    assert_eq!(parsed.tps_setpoint.iout_limit_ma, Some(3250));
}

#[test]
fn power_diagnostics_deserializes_when_both_current_limit_keys_are_present() {
    let parsed: CliPowerDiagnostics = serde_json::from_value(json!({
        "usb_c_power_enabled": true,
        "sw2303_i2c_allowed": true,
        "sw2303_profile_applied": true,
        "sw2303_stable_reads": 3,
        "sw2303_error_latched": false,
        "tps_error_latched": false,
        "sw2303_readback_config": {
            "available": true,
            "matches_config": true,
            "power_watts": 100,
            "protocols": {
                "pd": true,
                "qc20": false,
                "qc30": false,
                "fcp": false,
                "afc": false,
                "scp": false,
                "pe20": false,
                "bc12": false,
                "sfcp": false
            },
            "pd": {
                "pps": true,
                "fixed_voltages_mv": [9000, 12000, 15000, 20000]
            }
        },
        "sw2303_request": {
            "mv": 20000,
            "ma": 3250
        },
        "sw2303_last_valid_request": {
            "mv": 20000,
            "ma": 3250
        },
        "tps_setpoint": {
            "output_enabled": true,
            "mv": 20000,
            "iout_limit_ma": 3300,
            "ilim_ma": 3250
        },
        "runtime_recovery_count": 0,
        "sample_uptime_ms": 1500
    }))
    .expect("dual-key diagnostics should deserialize");

    assert_eq!(parsed.tps_setpoint.iout_limit_ma, Some(3300));
}

#[test]
fn power_setpoint_serialization_keeps_legacy_ilim_field() {
    let value = serde_json::to_value(CliPowerSetpoint {
        output_enabled: Some(true),
        mv: Some(20_000),
        iout_limit_ma: Some(3_250),
    })
    .expect("serialize setpoint");

    assert_eq!(value["iout_limit_ma"], 3250);
    assert_eq!(value["ilim_ma"], 3250);
}

#[test]
fn manual_output_updates_only_manual_section() {
    let original: CliPowerConfig = serde_json::from_value(json!({
        "hardware": "legacy-hardware",
        "persisted": true,
        "tps_mode": "auto_follow",
        "light_load_mode": "pfm",
        "capability": {
            "profile": "full",
            "power_watts": 65,
            "protocols": {
                "pd": true,
                "qc20": false,
                "qc30": true,
                "fcp": false,
                "afc": false,
                "scp": false,
                "pe20": false,
                "bc12": true,
                "sfcp": false
            },
            "pd": {
                "pps": true,
                "fixed_voltages_mv": [9000, 15000]
            },
            "current": {
                "pps3_limit_ma": 5000,
                "pd_pps_5a": false,
                "type_c_broadcast_ma": 1500,
                "scp_limit_ma": 5000,
                "fcp_afc_sfcp_limit_ma": 3250
            }
        },
        "manual": {
            "voltage_mv": 5000,
            "current_limit_ma": 1000,
            "usb_c_path_mode": "default",
            "path_policy": "auto"
        },
        "lock": null
    }))
    .expect("power config should deserialize");
    let capability_before = original.capability.clone();
    let mut updated = original.clone();

    apply_manual_output_args(
        &mut updated,
        &ManualOutputArgs {
            voltage_mv: Some(21_000),
            current_limit_ma: Some(6_350),
            usb_c_path: Some(OutputUsbCPathArg::Disconnected),
        },
    );

    assert_eq!(updated.capability, capability_before);
    assert_eq!(updated.light_load_mode, "pfm");
    assert_eq!(updated.manual.voltage_mv, 21_000);
    assert_eq!(updated.manual.current_limit_ma, 6_350);
    assert_eq!(updated.manual.usb_c_path_mode, "disconnect");
    assert!(updated.manual.voltage_mv >= 3_000);
}

include!("tests_power_config_tail.rs");
