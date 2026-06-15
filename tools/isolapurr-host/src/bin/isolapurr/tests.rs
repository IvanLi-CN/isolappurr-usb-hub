#[cfg(test)]
mod power_output_tests {
    use super::*;

    #[test]
    fn ensure_success_envelope_rejects_jsonl_ok_false() {
        let value = json!({
            "ok": false,
            "error": {"message": "port is locked"}
        });
        let err = ensure_success_envelope(&value).expect_err("ok=false should fail");
        assert!(err.to_string().contains("port is locked"));
    }

    #[test]
    fn ensure_success_envelope_ignores_non_envelope_output() {
        ensure_success_envelope(&json!({"devices": []})).expect("list output should pass");
        ensure_success_envelope(&json!({"ok": true})).expect("ok=true should pass");
    }

    #[test]
    fn human_output_renders_hardware_available_sections() {
        let output = json!({
            "path": "/tmp/devices.json",
            "saved": [{
                "id": "aabbcc001122",
                "name": "Bench Hub",
                "transports": {
                    "localUsbPortPath": "/dev/cu.usbmodem101"
                }
            }],
            "devd": {
                "devices": [{
                    "id": "usb--dev-cu-usbmodem101",
                    "displayName": "ESP32-S3 USB JTAG",
                    "connection": "available"
                }]
            }
        });

        let rendered = format_human_output(&output);
        assert!(rendered.contains("Registry: /tmp/devices.json"));
        assert!(rendered.contains("Saved devices:"));
        assert!(rendered.contains("- Bench Hub (aabbcc001122) usb:/dev/cu.usbmodem101"));
        assert!(rendered.contains("Local devd devices:"));
        assert!(rendered.contains("- ESP32-S3 USB JTAG (usb--dev-cu-usbmodem101) - available"));
    }

    #[test]
    fn maps_http_port_mutation_endpoints() {
        let (_, path, body) =
            map_http_endpoint(Method::POST, "/ports/port_a/power?enabled=false", None)
                .expect("power endpoint should map");
        assert_eq!(path, "/api/v1/ports/port_a/power?enabled=false");
        assert!(body.is_none());

        let (_, path, _) = map_http_endpoint(Method::POST, "/ports/port_c/replug", None)
            .expect("replug endpoint should map");
        assert_eq!(path, "/api/v1/ports/port_c/actions/replug");

        let (_, path, body) =
            map_http_endpoint(Method::POST, "/hub/route", Some(json!({"route": "mcu"})))
                .expect("route endpoint should map");
        assert_eq!(path, "/api/v1/hub/usb-c-downstream-route?route=mcu");
        assert!(body.is_none());

        let (_, path, body) = map_http_endpoint(
            Method::POST,
            "/settings/reset",
            Some(json!({"scope": "other"})),
        )
        .expect("settings reset endpoint should map");
        assert_eq!(path, "/api/v1/settings/reset?scope=other");
        assert!(body.is_none());

        let (_, path, body) = map_http_endpoint(
            Method::POST,
            "/settings/reset",
            Some(json!({"scope": "other", "owner": 42})),
        )
        .expect("settings reset endpoint with owner should map");
        assert_eq!(path, "/api/v1/settings/reset?scope=other&owner=42");
        assert!(body.is_none());

        let (_, path, body) = map_http_endpoint(Method::GET, "/power/idle-bias", None)
            .expect("idle-bias show endpoint should map");
        assert_eq!(path, "/api/v1/power/idle-bias");
        assert!(body.is_none());

        let (_, path, body) = map_http_endpoint(
            Method::PUT,
            "/power/idle-bias?owner=9",
            Some(json!({"correction_enabled": true})),
        )
        .expect("idle-bias set endpoint should map");
        assert_eq!(path, "/api/v1/power/idle-bias?owner=9");
        assert_eq!(body, Some(json!({"correction_enabled": true})));

        let (_, path, body) = map_http_endpoint(Method::POST, "/power/idle-bias/run?owner=9", None)
            .expect("idle-bias run endpoint should map");
        assert_eq!(path, "/api/v1/power/idle-bias/run?owner=9");
        assert!(body.is_none());
    }

    #[test]
    fn maps_devd_device_endpoints_to_ipc_methods() {
        let (method, params) = map_devd_ipc_endpoint(
            Method::POST,
            "/api/v1/devices/usb--dev-cu-usbmodem21221401/ports/port_a/power?enabled=false",
            None,
        )
        .expect("power endpoint should map");
        assert_eq!(method, "device.port.power");
        assert_eq!(params["device_id"], "usb--dev-cu-usbmodem21221401");
        assert_eq!(params["port"], "port_a");
        assert_eq!(params["enabled"], false);

        let (method, params) = map_devd_ipc_endpoint(
            Method::POST,
            "/api/v1/devices/usb--dev-cu-usbmodem21221401/hub/route",
            Some(json!({"route": "mcu"})),
        )
        .expect("route endpoint should map");
        assert_eq!(method, "device.hub.route_set");
        assert_eq!(params["route"], "mcu");

        let (method, params) = map_devd_ipc_endpoint(
            Method::PUT,
            "/api/v1/devices/usb--dev-cu-usbmodem21221401/power/config?owner=7",
            Some(json!({"hardware": "legacy-hardware", "capability": {"power_watts": 100}})),
        )
        .expect("power config set endpoint should map");
        assert_eq!(method, "device.power.config_set");
        assert_eq!(params["device_id"], "usb--dev-cu-usbmodem21221401");
        assert_eq!(params["owner"], 7);
        assert_eq!(params["config"]["hardware"], "legacy-hardware");
        assert_eq!(params["config"]["capability"]["power_watts"], 100);

        let (method, params) = map_devd_ipc_endpoint(
            Method::PUT,
            "/api/v1/devices/usb--dev-cu-usbmodem21221401/power/idle-bias?owner=11",
            Some(json!({"correction_enabled": true})),
        )
        .expect("idle-bias set endpoint should map");
        assert_eq!(method, "device.power.idle_bias_set");
        assert_eq!(params["device_id"], "usb--dev-cu-usbmodem21221401");
        assert_eq!(params["owner"], 11);
        assert_eq!(params["correction_enabled"], true);

        let (method, params) = map_devd_ipc_endpoint(
            Method::POST,
            "/api/v1/devices/usb--dev-cu-usbmodem21221401/power/idle-bias/run?owner=11",
            None,
        )
        .expect("idle-bias run endpoint should map");
        assert_eq!(method, "device.power.idle_bias_run");
        assert_eq!(params["device_id"], "usb--dev-cu-usbmodem21221401");
        assert_eq!(params["owner"], 11);

        let (method, params) = map_devd_ipc_endpoint(
            Method::POST,
            "/api/v1/devices/usb--dev-cu-usbmodem21221401/settings/reset",
            Some(json!({"scope": "wifi", "owner": 9})),
        )
        .expect("settings reset endpoint should map");
        assert_eq!(method, "device.settings.reset");
        assert_eq!(params["device_id"], "usb--dev-cu-usbmodem21221401");
        assert_eq!(params["scope"], "wifi");
        assert_eq!(params["owner"], 9);
    }

    #[test]
    fn cli_uses_ipc_instead_of_devd_http_flag() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "--ipc",
            "/tmp/isolapurr-test.sock",
            "--no-auto-start",
            "devices",
        ])
        .expect("ipc flags should parse");
        assert_eq!(cli.ipc, "/tmp/isolapurr-test.sock");
        assert!(cli.no_auto_start);

        let err = Cli::try_parse_from(["isolapurr", "--devd", "http://127.0.0.1:51200", "devices"])
            .expect_err("legacy devd HTTP flag must not parse");
        assert!(err.to_string().contains("unexpected argument"));
    }

    #[test]
    fn settings_reset_cli_parses_scope_and_confirmation_flag() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "--json",
            "settings",
            "reset",
            "--device-id",
            "aabbcc001122",
            "other",
            "--yes",
        ])
        .expect("settings reset should parse");
        let Command::Settings {
            command:
                SettingsCommand::Reset {
                    selector,
                    scope,
                    yes,
                },
        } = cli.command
        else {
            panic!("expected settings reset command");
        };
        assert_eq!(selector.device_id.as_deref(), Some("aabbcc001122"));
        assert!(matches!(scope, SettingsResetScopeArg::Other));
        assert!(yes);
        assert!(cli.json);
    }

    #[test]
    fn settings_reset_json_mode_parses_without_confirmation_flag() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "--json",
            "settings",
            "reset",
            "--device-id",
            "aabbcc001122",
            "wifi",
        ])
        .expect("json settings reset should parse without --yes");
        let Command::Settings {
            command:
                SettingsCommand::Reset {
                    selector,
                    scope,
                    yes,
                },
        } = cli.command
        else {
            panic!("expected settings reset command");
        };
        assert_eq!(selector.device_id.as_deref(), Some("aabbcc001122"));
        assert!(matches!(scope, SettingsResetScopeArg::Wifi));
        assert!(!yes);
        assert!(cli.json);
    }

    #[test]
    fn idle_bias_cli_parses_set_and_confirmation_flag() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "power",
            "idle-bias",
            "set",
            "--device-id",
            "aabbccddeeff",
            "--enabled",
            "true",
            "--yes",
        ])
        .expect("idle-bias set should parse");

        let Command::Power {
            command:
                PowerCommand::IdleBias {
                    command:
                        IdleBiasCommand::Set {
                            selector,
                            enabled,
                            yes,
                        },
                },
        } = cli.command
        else {
            panic!("expected idle-bias set command");
        };
        assert_eq!(selector.device_id.as_deref(), Some("aabbccddeeff"));
        assert!(enabled);
        assert!(yes);
    }

    #[test]
    fn idle_bias_cli_requires_explicit_enabled_value() {
        let err = Cli::try_parse_from([
            "isolapurr",
            "power",
            "idle-bias",
            "set",
            "--device-id",
            "aabbccddeeff",
            "--yes",
        ])
        .expect_err("idle-bias set should require --enabled");

        assert!(err.to_string().contains("--enabled"));
    }

    #[test]
    fn idle_bias_timeout_budget_scales_with_full_sweep_points() {
        assert_eq!(
            idle_bias_total_timeout(37),
            Duration::from_secs(37 * 4 + 30)
        );
        assert_eq!(idle_bias_total_timeout(0), Duration::from_secs(34));
    }

    #[test]
    fn idle_bias_cli_parses_run_without_confirmation_in_json_mode() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "--json",
            "power",
            "idle-bias",
            "run",
            "--device-id",
            "aabbccddeeff",
            "--yes",
        ])
        .expect("idle-bias run should parse");

        let Command::Power {
            command:
                PowerCommand::IdleBias {
                    command: IdleBiasCommand::Run { selector, yes },
                },
        } = cli.command
        else {
            panic!("expected idle-bias run command");
        };
        assert_eq!(selector.device_id.as_deref(), Some("aabbccddeeff"));
        assert!(yes);
        assert!(cli.json);
    }

    #[test]
    fn idle_bias_finalize_snapshot_rejects_failed_runs() {
        let snapshot = CliIdleBias {
            run: CliIdleBiasRun {
                state: "failed".to_string(),
                completed_points: 12,
                point_count: 37,
                target_voltage_mv: Some(9000),
                error: Some(CliIdleBiasError {
                    code: "attach_detected".to_string(),
                    message: "disconnect USB-C load before calibration".to_string(),
                }),
            },
            ..CliIdleBias::default()
        };

        let err = finalize_idle_bias_snapshot(&snapshot)
            .expect_err("failed calibration should surface as an error");
        assert!(err.to_string().contains("idle-bias calibration failed"));
        assert!(err.to_string().contains("attach_detected"));
        assert!(
            err.to_string()
                .contains("disconnect USB-C load before calibration")
        );
    }

    #[test]
    fn idle_bias_finalize_snapshot_keeps_completed_runs() {
        let snapshot = CliIdleBias {
            correction_enabled: true,
            run: CliIdleBiasRun {
                state: "completed".to_string(),
                completed_points: 37,
                point_count: 37,
                target_voltage_mv: None,
                error: None,
            },
            ..CliIdleBias::default()
        };

        let done =
            finalize_idle_bias_snapshot(&snapshot).expect("completed calibration should succeed");
        assert!(done);
        assert_eq!(snapshot.run.state, "completed");
        assert!(snapshot.correction_enabled);
    }

    #[test]
    fn ports_power_accepts_explicit_boolean_value() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "ports",
            "--device-id",
            "aabbcc001122",
            "power",
            "--port",
            "port_a",
            "--enabled",
            "false",
        ])
        .expect("explicit boolean value should parse");

        let Command::Ports {
            command: Some(PortsCommand::Power { enabled, .. }),
            ..
        } = cli.command
        else {
            panic!("expected ports power command");
        };
        assert!(!enabled);
    }

    #[test]
    fn flash_accepts_non_project_confirmation_flag() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "flash",
            "--device-id",
            "aabbcc001122",
            "--catalog",
            "catalog.json",
            "--artifact",
            "app",
            "--real",
            "--first-time",
            "--confirm-non-project-firmware",
        ])
        .expect("confirmation flag should parse");

        let Command::Flash(args) = cli.command else {
            panic!("expected flash command");
        };
        assert!(args.confirm_non_project_firmware);
    }

    #[test]
    fn source_capability_accepts_protocol_and_pd_voltage_flags() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "power",
            "source-capability",
            "set",
            "--device-id",
            "f293cc9c139e",
            "--power-watts",
            "65",
            "--pd",
            "true",
            "--pps",
            "true",
            "--qc20",
            "false",
            "--qc30",
            "true",
            "--fcp",
            "true",
            "--afc",
            "false",
            "--scp",
            "true",
            "--pe20",
            "false",
            "--bc12",
            "true",
            "--sfcp",
            "false",
            "--fixed-pd-voltages",
            "9000,15000,20000",
            "--pps3-limit-ma",
            "5000",
            "--pd-pps-5a",
            "false",
            "--type-c-broadcast-ma",
            "1500",
            "--scp-limit-ma",
            "5000",
            "--fcp-afc-sfcp-limit-ma",
            "3250",
        ])
        .expect("source capability command should parse");

        let Command::Power {
            command:
                PowerCommand::SourceCapability {
                    command:
                        SourceCapabilityCommand::Set {
                            args:
                                SourceCapabilitySetArgs {
                                    power_watts,
                                    pd,
                                    pps,
                                    qc20,
                                    qc30,
                                    fcp,
                                    afc,
                                    scp,
                                    pe20,
                                    bc12,
                                    sfcp,
                                    fixed_pd_voltages,
                                    pps3_limit_ma,
                                    pd_pps_5a,
                                    type_c_broadcast_ma,
                                    scp_limit_ma,
                                    fcp_afc_sfcp_limit_ma,
                                },
                            ..
                        },
                },
        } = cli.command
        else {
            panic!("expected power source-capability set command");
        };

        assert_eq!(power_watts, Some(65));
        assert_eq!(pd, Some(true));
        assert_eq!(pps, Some(true));
        assert_eq!(qc20, Some(false));
        assert_eq!(qc30, Some(true));
        assert_eq!(fcp, Some(true));
        assert_eq!(afc, Some(false));
        assert_eq!(scp, Some(true));
        assert_eq!(pe20, Some(false));
        assert_eq!(bc12, Some(true));
        assert_eq!(sfcp, Some(false));
        assert_eq!(fixed_pd_voltages.as_deref(), Some("9000,15000,20000"));
        assert_eq!(pps3_limit_ma, Some(5000));
        assert_eq!(pd_pps_5a, Some(false));
        assert_eq!(type_c_broadcast_ma, Some(1500));
        assert_eq!(scp_limit_ma, Some(5000));
        assert_eq!(fcp_afc_sfcp_limit_ma, Some(3250));
    }

    #[test]
    fn power_output_manual_accepts_owner_facing_flags() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "power",
            "output",
            "manual",
            "--device-id",
            "f293cc9c139e",
            "--voltage-mv",
            "9000",
            "--current-limit-ma",
            "3000",
            "--usb-c-path",
            "forced-on",
        ])
        .expect("power output manual command should parse");

        let Command::Power {
            command:
                PowerCommand::Output {
                    command:
                        OutputCommand::Manual {
                            args:
                                ManualOutputArgs {
                                    voltage_mv,
                                    current_limit_ma,
                                    usb_c_path,
                                },
                            ..
                        },
                },
        } = cli.command
        else {
            panic!("expected power output manual command");
        };

        assert_eq!(voltage_mv, Some(9000));
        assert_eq!(current_limit_ma, Some(3000));
        assert!(matches!(usb_c_path, Some(OutputUsbCPathArg::ForcedOn)));
    }

    #[test]
    fn power_output_auto_parses_without_manual_flags() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "power",
            "output",
            "auto",
            "--device-id",
            "f293cc9c139e",
        ])
        .expect("power output auto command should parse");

        let Command::Power {
            command:
                PowerCommand::Output {
                    command: OutputCommand::Auto { .. },
                },
        } = cli.command
        else {
            panic!("expected power output auto command");
        };
    }

    #[test]
    fn power_commands_reject_temporary_device_selector() {
        let err = Cli::try_parse_from([
            "isolapurr",
            "power",
            "show",
            "--port-path",
            "usb--dev-cu-usbmodem21221401",
        ])
        .expect_err("power show should reject Local USB port selector");

        assert!(
            err.to_string()
                .contains("unexpected argument '--port-path'")
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CliPowerConfig, CliPowerDiagnostics, DeviceProfile, DiscoverFirmware, LightLoadModeArg,
        ManualOutputArgs, OutputUsbCPathArg, PowerConfigSetArgs, SourceCapabilitySetArgs,
        TpsModeArg, apply_manual_output_args, apply_power_config_set_args, discover_usb_match_keys,
        format_power_config_output, format_power_show_output, parse_device_identity_from_info,
        parse_discovered_http_info, saved_hardware_match_for_transport,
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
                    "ilim_ma": 3250
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
        assert!(
            rendered.contains("Idle-bias dataset: valid (3000..21000 mV, 37 points, step 500 mV)")
        );
        assert!(rendered.contains("Idle-bias correction: enabled"));
        assert!(!rendered.to_ascii_lowercase().contains("sw2303"));
        assert!(!rendered.contains("TPS"));
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
                "ilim_ma": 4950
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
}
