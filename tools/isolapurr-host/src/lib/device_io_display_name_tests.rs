#[test]
fn usb_name_response_prefers_hardware_name_and_falls_back_to_hostname() {
    assert_eq!(
        display_name_from_usb_response(
            "aabbcc001122",
            &json!({"ok": true, "result": {"device": {
                "hostname": "isolapurr-usb-hub-aabbcc001122",
                "display_name": "Bench 猫"
            }}})
        ),
        "Bench 猫"
    );
    assert_eq!(
        display_name_from_usb_response(
            "aabbcc001122",
            &json!({"ok": true, "result": {"display_name": null}})
        ),
        "isolapurr-usb-hub-aabbcc001122"
    );
}
