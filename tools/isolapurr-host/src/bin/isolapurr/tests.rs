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
                "id": "isolapurr-01",
                "name": "Bench Hub",
                "transport": {
                    "kind": "usb",
                    "deviceId": "usb--dev-cu-usbmodem101"
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
        assert!(rendered.contains("Saved hardware:"));
        assert!(rendered.contains("- Bench Hub (isolapurr-01) usb:usb--dev-cu-usbmodem101"));
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
            "--hardware",
            "bench-hub",
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
        assert_eq!(selector.hardware.as_deref(), Some("bench-hub"));
        assert!(matches!(scope, SettingsResetScopeArg::Other));
        assert!(yes);
        assert!(cli.json);
    }

    #[test]
    fn ports_power_accepts_explicit_boolean_value() {
        let cli = Cli::try_parse_from([
            "isolapurr",
            "ports",
            "--device",
            "usb--dev-cu-usbmodem21221401",
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
            "--device",
            "usb--dev-cu-usbmodem21221401",
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
            "--hardware",
            "f293cc",
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
            "--hardware",
            "f293cc",
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
            "--hardware",
            "f293cc",
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
            "--device",
            "usb--dev-cu-usbmodem21221401",
        ])
        .expect_err("power show should reject devd temporary device selector");

        assert!(err.to_string().contains("unexpected argument '--device'"));
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CliPowerConfig, CliPowerDiagnostics, DeviceIdentity, DeviceProfile, DiscoverFirmware,
        HardwareTransport, ManualOutputArgs, OutputUsbCPathArg, apply_manual_output_args,
        format_power_config_output, format_power_show_output, parse_discovered_http_info,
        saved_hardware_match_for_transport,
    };
    use serde_json::json;

    #[test]
    fn power_config_human_output_avoids_chip_names() {
        let rendered = format_power_config_output(&json!({
            "hardware": "sw2303",
            "persisted": true,
            "tps_mode": "manual",
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
                "runtime_recovery_count": 0,
                "sample_uptime_ms": 1500
            }
        }));

        assert!(rendered.contains("Live USB-C status"));
        assert!(rendered.contains("Capability state: applied"));
        assert!(rendered.contains("Advertised source: 100 W"));
        assert!(rendered.contains("Negotiated request: 20000 mV @ 3250 mA"));
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
            "sw2303_last_valid_request": {
                "mv": 12000,
                "ma": 5000
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
    }

    #[test]
    fn manual_output_updates_only_manual_section() {
        let original: CliPowerConfig = serde_json::from_value(json!({
            "hardware": "legacy-hardware",
            "persisted": true,
            "tps_mode": "auto_follow",
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
        assert_eq!(updated.manual.voltage_mv, 21_000);
        assert_eq!(updated.manual.current_limit_ma, 6_350);
        assert_eq!(updated.manual.usb_c_path_mode, "disconnect");
        assert!(updated.manual.voltage_mv >= 3_000);
    }

    #[test]
    fn parse_discover_http_info_prefers_fqdn_base_url() {
        let parsed = parse_discovered_http_info(
            "http://192.168.1.42",
            json!({
                "device": {
                    "device_id": "aabbccdd",
                    "hostname": "isolapurr-usb-hub-aabbcc",
                    "fqdn": "isolapurr-usb-hub-aabbcc.local",
                    "mac": "AA:BB:CC:DD:EE:FF",
                    "firmware": {
                        "name": "isolapurr-usb-hub",
                        "version": "0.1.0"
                    },
                    "wifi": {
                        "ipv4": "192.168.1.42"
                    }
                }
            }),
            Some(std::net::Ipv4Addr::new(192, 168, 1, 42)),
        )
        .expect("discover info should parse");

        assert_eq!(parsed.base_url, "http://isolapurr-usb-hub-aabbcc.local");
        assert_eq!(parsed.ipv4.as_deref(), Some("192.168.1.42"));
        let identity = parsed.identity.expect("identity should exist");
        assert_eq!(identity.device_id.as_deref(), Some("aabbccdd"));
        assert_eq!(identity.mac.as_deref(), Some("AA:BB:CC:DD:EE:FF"));
        assert_eq!(
            parsed.firmware,
            DiscoverFirmware {
                name: "isolapurr-usb-hub".to_string(),
                version: "0.1.0".to_string(),
            }
        );
    }

    #[test]
    fn saved_hardware_match_uses_canonical_owner_facing_name() {
        let saved = vec![
            DeviceProfile {
                id: "isolapurr-01".to_string(),
                name: "Bench Hub".to_string(),
                transport: HardwareTransport::Usb {
                    device_id: "usb--dev-cu-usbmodem21221401".to_string(),
                    devd_url: None,
                },
                identity: Some(DeviceIdentity {
                    device_id: Some("856a14".to_string()),
                    mac: Some("AA:BB:CC:85:6A:14".to_string()),
                }),
                last_seen_at: None,
            },
            DeviceProfile {
                id: "isolapurr-01-wifi".to_string(),
                name: "Bench Hub Wi-Fi".to_string(),
                transport: HardwareTransport::Http {
                    base_url: "http://isolapurr-usb-hub-856a14.local".to_string(),
                },
                identity: Some(DeviceIdentity {
                    device_id: Some("856a14".to_string()),
                    mac: Some("AA:BB:CC:85:6A:14".to_string()),
                }),
                last_seen_at: None,
            },
        ];

        let usb_match = saved_hardware_match_for_transport(
            &saved,
            &[
                "usb:usb--dev-cu-usbmodem21221401".to_string(),
                "device:856a14".to_string(),
            ],
            Some("usb"),
        );

        let http_match = saved_hardware_match_for_transport(
            &saved,
            &[
                "http:http://isolapurr-usb-hub-856a14.local".to_string(),
                "device:856a14".to_string(),
            ],
            Some("http"),
        );

        assert_eq!(usb_match.len(), 1);
        assert_eq!(usb_match[0].id, "isolapurr-01");
        assert_eq!(usb_match[0].name, "Bench Hub");
        assert_eq!(http_match.len(), 1);
        assert_eq!(http_match[0].id, "isolapurr-01");
        assert_eq!(http_match[0].name, "Bench Hub");
        assert_eq!(http_match[0].transport, "http");
    }
}
