#[test]
fn usb_name_response_prefers_hardware_name_and_falls_back_to_hostname() {
    assert_eq!(
        display_name_from_usb_response(&json!({"ok": true, "result": {"device": {
            "hostname": "isolapurr-usb-hub-aabbcc001122",
            "display_name": "Bench 猫"
        }}})),
        Some("Bench 猫".to_string())
    );
    assert_eq!(
        display_name_from_usb_response(&json!({"ok": true, "result": {"device": {
            "hostname": "isolapurr-usb-hub-aabbcc001122",
            "display_name": null
        }}})),
        Some("isolapurr-usb-hub-aabbcc001122".to_string())
    );
    assert_eq!(
        display_name_from_usb_response(&json!({
            "ok": true,
            "result": {"display_name": null}
        })),
        None
    );
}
