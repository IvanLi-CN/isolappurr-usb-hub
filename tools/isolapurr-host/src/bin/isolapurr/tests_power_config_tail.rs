#[test]
fn power_config_set_updates_only_requested_fields() {
    let original: CliPowerConfig = serde_json::from_value(json!({
        "hardware": "sw2303",
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

    apply_power_config_set_args(
        &mut updated,
        &PowerConfigSetArgs {
            light_load_mode: Some(LightLoadModeArg::Fpwm),
            tps_mode: Some(TpsModeArg::Manual),
            manual: ManualOutputArgs::default(),
            source: SourceCapabilitySetArgs::default(),
        },
    )
    .expect("power config set args should apply");

    assert_eq!(updated.light_load_mode, "fpwm");
    assert_eq!(updated.tps_mode, "manual");
    assert_eq!(updated.capability, capability_before);
    assert_eq!(updated.manual, original.manual);
}

#[test]
fn parse_discover_http_info_prefers_fqdn_base_url() {
    let parsed = parse_discovered_http_info(
        "http://192.168.1.42",
        json!({
            "device": {
                "device_id": "aabbcc001122",
                "hostname": "isolapurr-usb-hub-aabbcc001122",
                "fqdn": "isolapurr-usb-hub-aabbcc001122.local",
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

    assert_eq!(
        parsed.base_url,
        "http://isolapurr-usb-hub-aabbcc001122.local"
    );
    assert_eq!(parsed.ipv4.as_deref(), Some("192.168.1.42"));
    let identity = parsed.identity.expect("identity should exist");
    assert_eq!(identity.device_id.as_deref(), Some("aabbcc001122"));
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
        serde_json::from_value::<DeviceProfile>(json!({
            "id": "856a14abcdef",
            "name": "Bench Hub",
            "transports": {
                "httpBaseUrl": "http://isolapurr-usb-hub-856a14abcdef.local",
                "localUsbPortPath": "/dev/cu.usbmodem21221401"
            },
            "identity": {
                "deviceId": "856a14abcdef",
                "mac": "AA:BB:CC:85:6A:14"
            }
        }))
        .expect("saved profile"),
    ];

    let usb_match = saved_hardware_match_for_transport(
        &saved,
        &[
            "usb:usb--dev-cu-usbmodem21221401".to_string(),
            "device:856a14abcdef".to_string(),
        ],
        Some("usb"),
    );

    let http_match = saved_hardware_match_for_transport(
        &saved,
        &[
            "http:http://isolapurr-usb-hub-856a14abcdef.local".to_string(),
            "device:856a14abcdef".to_string(),
        ],
        Some("http"),
    );

    assert_eq!(usb_match.len(), 1);
    assert_eq!(usb_match[0].id, "856a14abcdef");
    assert_eq!(usb_match[0].name, "Bench Hub");
    assert_eq!(http_match.len(), 1);
    assert_eq!(http_match[0].id, "856a14abcdef");
    assert_eq!(http_match[0].name, "Bench Hub");
    assert_eq!(http_match[0].transport, "http");
}

#[test]
fn usb_discovery_identity_parses_ipc_result_envelope() {
    let identity = parse_device_identity_from_info(&json!({
        "ok": true,
        "result": {
            "device": {
                "device_id": "856a14abcdef",
                "mac": "AA:BB:CC:85:6A:14"
            }
        }
    }))
    .expect("identity");

    assert_eq!(identity.device_id.as_deref(), Some("856a14abcdef"));
    assert_eq!(identity.mac.as_deref(), Some("AA:BB:CC:85:6A:14"));
}

#[test]
fn saved_http_profiles_match_discovered_canonical_device_id() {
    let saved = vec![
        serde_json::from_value::<DeviceProfile>(json!({
            "id": "856a14abcdef",
            "name": "Bench Hub",
            "transports": {
                "httpBaseUrl": "http://old-address.local"
            }
        }))
        .expect("saved profile"),
    ];

    let http_match = saved_hardware_match_for_transport(
        &saved,
        &[
            "http:http://new-address.local".to_string(),
            "device:856a14abcdef".to_string(),
        ],
        Some("http"),
    );

    assert_eq!(http_match.len(), 1);
    assert_eq!(http_match[0].id, "856a14abcdef");
    assert_eq!(http_match[0].name, "Bench Hub");
    assert_eq!(http_match[0].transport, "http");
}

#[test]
fn usb_discovery_keys_match_saved_port_path_profiles() {
    let keys = discover_usb_match_keys("usb-/dev/cu.usbmodem21221401", "/dev/cu.usbmodem21221401");

    assert_eq!(keys[0], "usb:usb--dev-cu-usbmodem21221401");
    assert!(keys.contains(&"usb:usb-/dev/cu.usbmodem21221401".to_string()));
}
