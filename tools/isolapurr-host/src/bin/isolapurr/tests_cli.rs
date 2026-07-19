use super::{
    CliPowerConfig, CliPowerDiagnostics, CliPowerSetpoint, DeviceProfile, DiscoverFirmware,
    LightLoadModeArg, ManualOutputArgs, OutputUsbCPathArg, PowerConfigSetArgs,
    SourceCapabilitySetArgs, Sw2303LineCompArg, TpsModeArg, apply_manual_output_args,
    apply_power_config_set_args, discover_usb_match_keys, format_power_config_output,
    format_power_show_output, parse_device_identity_from_info, parse_discovered_http_info,
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
        "sw2303_line_compensation": "50mohm",
        "runtime": {
            "output_enabled": true,
            "discharge_enabled": false
        },
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
            },
            "fast_charge": {
                "qc20_20v_enabled": true,
                "qc30_20v_enabled": false,
                "pe20_20v_enabled": true,
                "non_pd_12v_enabled": false
            }
        },
        "manual": {
            "voltage_mv": 12000,
            "current_limit_ma": 3000,
            "tps_cdc_rise_mv": 300,
            "usb_c_path_mode": "default",
            "path_policy": "auto"
        },
        "lock": null
    }));

    assert!(rendered.contains("Output mode: Manual bench output"));
    assert!(rendered.contains("Light-load mode: FPWM"));
    assert!(rendered.contains("Auto-follow cable loop compensation: 50mΩ"));
    assert!(rendered.contains("cable loop compensation 60mΩ"));
    assert!(rendered.contains("Runtime 2mm output: enabled"));
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
            "sw2303_line_compensation": "100mohm",
            "runtime": {
                "output_enabled": true,
                "discharge_enabled": false
            },
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
                },
                "fast_charge": {
                    "qc20_20v_enabled": true,
                    "qc30_20v_enabled": false,
                    "pe20_20v_enabled": true,
                    "non_pd_12v_enabled": false
                }
            },
            "manual": {
                "voltage_mv": 5000,
                "current_limit_ma": 5000,
                "tps_cdc_rise_mv": 0,
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
                },
                "fast_charge": {
                    "qc20_20v_enabled": true,
                    "qc30_20v_enabled": false,
                    "pe20_20v_enabled": true,
                    "non_pd_12v_enabled": false
                }
            },
            "sw2303_request": {
                "mv": 20000,
                "ma": 3250
            },
            "active_protocol": "qc30",
            "sw2303_last_valid_request": {
                "mv": 20000,
                "ma": 3250
            },
            "tps_setpoint": {
                "output_enabled": true,
                "discharge_enabled": false,
                "mv": 20000,
                "iout_limit_ma": 3250
            },
            "tps_iout_limit_readback": {
                "enabled": true,
                "ma": 3250
            },
            "thermal": {
                "sensors": {
                    "mcu": {
                        "temperature_deci_c": 792,
                        "status": "ok"
                    },
                    "tmp112": {
                        "temperature_deci_c": 851,
                        "status": "ok"
                    }
                },
                "hottest_temperature_deci_c": 851,
                "state": "derating",
                "reason": "tmp112_hot",
                "effective_power_watts": 75,
                "sample_uptime_ms": 1500
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
    assert!(rendered.contains("Fast-charge profile: QC2.0 20 V enabled, QC3.0 20 V disabled, PE2.0 20 V enabled, non-PD 12 V disabled"));
    assert!(rendered.contains("Negotiated request: 20000 mV @ 3250 mA"));
    assert!(rendered.contains("Active protocol: QC3.0"));
    assert!(rendered.contains("Thermal state: Derating (TMP112 hot)"));
    assert!(rendered.contains("Effective thermal cap: 75 W"));
    assert!(rendered.contains("Hottest temperature: 85.1°C"));
    assert!(rendered.contains("MCU temperature: 79.2°C (ok)"));
    assert!(rendered.contains("TMP112 temperature: 85.1°C (ok)"));
    assert!(rendered.contains("TPS IOUT_LIMIT: 3250 mA"));
    assert!(rendered.contains("Idle-bias dataset: valid (3000..21000 mV, 37 points, step 500 mV)"));
    assert!(rendered.contains("Idle-bias correction: enabled"));
    assert!(!rendered.to_ascii_lowercase().contains("sw2303"));
    assert!(!rendered.contains("TPS55288"));
}

#[test]
fn power_show_human_output_warns_for_manual_high_voltage_and_output_off() {
    let rendered = format_power_show_output(&json!({
        "config": {
            "hardware": "sw2303",
            "persisted": true,
            "tps_mode": "manual",
            "light_load_mode": "pfm",
            "runtime": {
                "output_enabled": false,
                "discharge_enabled": true
            },
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
                "voltage_mv": 9000,
                "current_limit_ma": 3000,
                "usb_c_path_mode": "force",
                "path_policy": "force"
            },
            "lock": null
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
                "mv": 5000,
                "ma": 3000
            },
            "sw2303_last_valid_request": {
                "mv": 5000,
                "ma": 3000
            },
            "tps_setpoint": {
                "output_enabled": false,
                "discharge_enabled": true,
                "mv": 9000,
                "iout_limit_ma": 3000
            },
            "tps_iout_limit_readback": {
                "enabled": true,
                "ma": 3000
            },
            "thermal": {
                "sensors": {
                    "mcu": {
                        "temperature_deci_c": 965,
                        "status": "ok"
                    },
                    "tmp112": {
                        "temperature_deci_c": 972,
                        "status": "ok"
                    }
                },
                "hottest_temperature_deci_c": 972,
                "state": "rearm_required",
                "reason": "none",
                "effective_power_watts": 0,
                "sample_uptime_ms": 1500
            },
            "runtime_recovery_count": 0,
            "sample_uptime_ms": 1500
        }
    }));

    assert!(rendered.contains("Runtime 2mm output: disabled"));
    assert!(rendered.contains("Runtime TPS discharge: enabled"));
    assert!(rendered.contains("Thermal state: Rearm required"));
    assert!(rendered.contains(
        "Thermal rearm: temperatures recovered; output stays off until you re-enable it."
    ));
    assert!(rendered.contains("TPS discharge: enabled"));
    assert!(rendered.contains("Warning: manual voltage above 5 V can still heat SW2303"));
    assert!(rendered.contains("Prefer auto follow for sustained high-voltage use."));
}

#[test]
fn power_show_human_output_reports_thermal_shutdown_and_sensor_fault() {
    let shutdown_rendered = format_power_show_output(&json!({
        "config": {
            "hardware": "sw2303",
            "persisted": true,
            "tps_mode": "auto_follow",
            "light_load_mode": "pfm",
            "runtime": {
                "output_enabled": false,
                "discharge_enabled": false
            },
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
                },
                "fast_charge": {
                    "qc20_20v_enabled": true,
                    "qc30_20v_enabled": false,
                    "pe20_20v_enabled": true,
                    "non_pd_12v_enabled": false
                }
            },
            "manual": {
                "voltage_mv": 5000,
                "current_limit_ma": 5000,
                "tps_cdc_rise_mv": 0,
                "usb_c_path_mode": "default",
                "path_policy": "auto"
            },
            "lock": null
        },
        "diagnostics": {
            "usb_c_power_enabled": false,
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
                "output_enabled": false,
                "discharge_enabled": false,
                "mv": 20000,
                "iout_limit_ma": 3250
            },
            "thermal": {
                "sensors": {
                    "mcu": {
                        "temperature_deci_c": 1008,
                        "status": "ok"
                    },
                    "tmp112": {
                        "temperature_deci_c": 995,
                        "status": "ok"
                    }
                },
                "hottest_temperature_deci_c": 1008,
                "state": "shutdown",
                "reason": "mcu_critical",
                "effective_power_watts": 0,
                "sample_uptime_ms": 1500
            },
            "runtime_recovery_count": 1,
            "sample_uptime_ms": 1500
        }
    }));

    assert!(shutdown_rendered.contains("Thermal state: Shutdown (MCU critical)"));
    assert!(shutdown_rendered.contains(
        "Thermal shutdown: output forced off until temperature recovers and you enable it again."
    ));
    assert!(shutdown_rendered.contains("Faults: thermal shutdown"));

    let sensor_fault_rendered = format_power_show_output(&json!({
        "config": {
            "hardware": "sw2303",
            "persisted": true,
            "tps_mode": "auto_follow",
            "light_load_mode": "pfm",
            "runtime": {
                "output_enabled": false,
                "discharge_enabled": false
            },
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
                },
                "fast_charge": {
                    "qc20_20v_enabled": true,
                    "qc30_20v_enabled": false,
                    "pe20_20v_enabled": true,
                    "non_pd_12v_enabled": false
                }
            },
            "manual": {
                "voltage_mv": 5000,
                "current_limit_ma": 5000,
                "tps_cdc_rise_mv": 0,
                "usb_c_path_mode": "default",
                "path_policy": "auto"
            },
            "lock": null
        },
        "diagnostics": {
            "usb_c_power_enabled": false,
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
                "output_enabled": false,
                "discharge_enabled": false,
                "mv": 20000,
                "iout_limit_ma": 3250
            },
            "thermal": {
                "sensors": {
                    "mcu": {
                        "temperature_deci_c": 512,
                        "status": "stale"
                    },
                    "tmp112": {
                        "temperature_deci_c": null,
                        "status": "error"
                    }
                },
                "hottest_temperature_deci_c": 512,
                "state": "sensor_fault",
                "reason": "tmp112_sensor_fault",
                "effective_power_watts": 0,
                "sample_uptime_ms": 1500
            },
            "runtime_recovery_count": 1,
            "sample_uptime_ms": 1500
        }
    }));

    assert!(sensor_fault_rendered.contains("Thermal state: Sensor fault (TMP112 sensor fault)"));
    assert!(sensor_fault_rendered.contains("TMP112 temperature: unavailable (error)"));
    assert!(sensor_fault_rendered.contains("Thermal sensor fault: output stays off until telemetry recovers, then re-enable it manually."));
    assert!(sensor_fault_rendered.contains("Faults: thermal sensor fault"));
}

#[test]
fn power_config_deserializes_when_current_profile_is_missing() {
    let parsed: CliPowerConfig = serde_json::from_value(json!({
        "hardware": "legacy-hardware",
        "persisted": true,
        "tps_mode": "auto_follow",
        "runtime": {
            "output_enabled": true,
            "discharge_enabled": false
        },
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
            },
            "fast_charge": {
                "qc20_20v_enabled": true,
                "qc30_20v_enabled": false,
                "pe20_20v_enabled": true,
                "non_pd_12v_enabled": false
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
    assert!(parsed.capability.fast_charge.qc20_20v_enabled);
    assert!(!parsed.capability.fast_charge.qc30_20v_enabled);
    assert!(parsed.capability.fast_charge.pe20_20v_enabled);
    assert!(!parsed.capability.fast_charge.non_pd_12v_enabled);
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
            },
            "fast_charge": {
                "qc20_20v_enabled": true,
                "qc30_20v_enabled": false,
                "pe20_20v_enabled": true,
                "non_pd_12v_enabled": false
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
            "discharge_enabled": false,
            "mv": 12000,
            "iout_limit_ma": 4950
        },
        "tps_iout_limit_readback": {
            "enabled": true,
            "ma": 4950
        },
        "thermal": {
            "sensors": {
                "mcu": {
                    "temperature_deci_c": 488,
                    "status": "ok"
                },
                "tmp112": {
                    "temperature_deci_c": 505,
                    "status": "ok"
                }
            },
            "hottest_temperature_deci_c": 505,
            "state": "normal",
            "reason": "none",
            "effective_power_watts": 100,
            "sample_uptime_ms": 1500
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
    assert_eq!(
        parsed.sw2303_readback_config.fast_charge.qc20_20v_enabled,
        Some(true)
    );
    assert_eq!(
        parsed.sw2303_readback_config.fast_charge.qc30_20v_enabled,
        Some(false)
    );
    assert_eq!(
        parsed.sw2303_readback_config.fast_charge.pe20_20v_enabled,
        Some(true)
    );
    assert_eq!(
        parsed.sw2303_readback_config.fast_charge.non_pd_12v_enabled,
        Some(false)
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
    assert_eq!(parsed.thermal.state, "normal");
    assert_eq!(parsed.thermal.effective_power_watts, 100);
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
            "discharge_enabled": false,
            "mv": 20000,
            "ilim_ma": 3250
        },
        "thermal": {
            "sensors": {
                "mcu": {
                    "temperature_deci_c": 488,
                    "status": "ok"
                },
                "tmp112": {
                    "temperature_deci_c": 505,
                    "status": "ok"
                }
            },
            "hottest_temperature_deci_c": 505,
            "state": "normal",
            "reason": "none",
            "effective_power_watts": 100,
            "sample_uptime_ms": 1500
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
            "discharge_enabled": false,
            "mv": 20000,
            "iout_limit_ma": 3300,
            "ilim_ma": 3250
        },
        "thermal": {
            "sensors": {
                "mcu": {
                    "temperature_deci_c": 488,
                    "status": "ok"
                },
                "tmp112": {
                    "temperature_deci_c": 505,
                    "status": "ok"
                }
            },
            "hottest_temperature_deci_c": 505,
            "state": "normal",
            "reason": "none",
            "effective_power_watts": 100,
            "sample_uptime_ms": 1500
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
        discharge_enabled: Some(false),
        mv: Some(20_000),
        iout_limit_ma: Some(3_250),
    })
    .expect("serialize setpoint");

    assert_eq!(value["iout_limit_ma"], 3250);
    assert_eq!(value["ilim_ma"], 3250);
    assert_eq!(value["discharge_enabled"], false);
}

#[test]
fn power_config_runtime_deserializes() {
    let parsed: CliPowerConfig = serde_json::from_value(json!({
        "hardware": "sw2303",
        "persisted": true,
        "tps_mode": "manual",
        "light_load_mode": "fpwm",
        "runtime": {
            "output_enabled": false,
            "discharge_enabled": true
        },
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
            }
        },
        "manual": {
            "voltage_mv": 9000,
            "current_limit_ma": 3000,
            "usb_c_path_mode": "default",
            "path_policy": "auto"
        },
        "lock": null
    }))
    .expect("runtime should deserialize");

    assert!(!parsed.runtime.output_enabled);
    assert!(parsed.runtime.discharge_enabled);
}

#[test]
fn power_config_runtime_defaults_enabled_when_missing() {
    let parsed: CliPowerConfig = serde_json::from_value(json!({
        "hardware": "legacy-hardware",
        "persisted": true,
        "tps_mode": "auto_follow",
        "light_load_mode": "pfm",
        "sw2303_line_compensation": "50mohm",
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
            "current_limit_ma": 3000,
            "usb_c_path_mode": "default",
            "path_policy": "auto"
        },
        "lock": null
    }))
    .expect("legacy runtime should deserialize");

    assert!(parsed.runtime.output_enabled);
    assert!(!parsed.runtime.discharge_enabled);
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
            "tps_cdc_rise_mv": 0,
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
            tps_cdc_rise_mv: Some(700),
            cable_resistance_mohm: None,
            usb_c_path: Some(OutputUsbCPathArg::Disconnected),
        },
    );

    assert_eq!(updated.capability, capability_before);
    assert_eq!(updated.light_load_mode, "pfm");
    assert_eq!(updated.manual.voltage_mv, 21_000);
    assert_eq!(updated.manual.current_limit_ma, 6_350);
    assert_eq!(updated.manual.tps_cdc_rise_mv, 700);
    assert_eq!(updated.manual.usb_c_path_mode, "disconnect");
    assert!(updated.manual.voltage_mv >= 3_000);
    let mut mapped = original;
    apply_manual_output_args(
        &mut mapped,
        &ManualOutputArgs {
            cable_resistance_mohm: Some(100),
            ..Default::default()
        },
    );
    assert_eq!(mapped.manual.tps_cdc_rise_mv, 500);
}

include!("tests_power_config_tail.rs");
