/// Minimal console used before a profile can safely instantiate its runtime.
/// It intentionally exposes only identity/diagnostics and never touches any
/// power, route, EEPROM, or PD controller.
#[cfg(feature = "net_http")]
async fn safe_mismatch_console(
    mut usb: UsbSerialJtag<'static, esp_hal::Async>,
    discovery: isolapurr_firmware_core::hardware_discovery::DiscoveryState,
    compatibility: isolapurr_firmware_core::hardware_discovery::ProfileCompatibility,
    device_names: Option<&'static net::DeviceNames>,
) -> ! {
    use embedded_io_async::{Read as _, Write as _};
    use isolapurr_firmware_core::hardware_discovery::write_hardware_descriptor_json;

    let mut rx = [0u8; 64];
    let mut line = [0u8; 256];
    let mut len = 0usize;
    loop {
        let n = usb.read(&mut rx).await.ok().unwrap_or(0);
        for byte in &rx[..n] {
            if *byte == b'\n' {
                let request = core::str::from_utf8(&line[..len]).unwrap_or("");
                let mut response = alloc::string::String::new();
                let id = parse_jsonl_id(request);
                let read_only = request.contains("\"method\":\"info\"")
                    || request.contains("\"method\": \"info\"")
                    || request.contains("\"method\":\"diagnostics\"")
                    || request.contains("\"method\": \"diagnostics\"")
                    || request.contains("\"method\":\"pd.diagnostics\"")
                    || request.contains("\"method\": \"pd.diagnostics\"");
                if !read_only {
                    let _ = write!(
                        response,
                        "{{\"id\":{},\"ok\":false,\"error\":{{\"code\":\"safe_mismatch\",\"message\":\"Only info and diagnostics are available until the compiled profile matches the physical board.\",\"retryable\":false}}}}",
                        id.as_str()
                    );
                    let _ = usb.write_all(response.as_bytes()).await;
                    let _ = usb.write_all(b"\n").await;
                    let _ = usb.flush().await;
                    len = 0;
                    continue;
                }
                let _ = write!(
                    response,
                    "{{\"id\":{},\"ok\":true,\"result\":{{\"diagnostics\":true,\"device\":{{",
                    id.as_str()
                );
                if let Some(names) = device_names {
                    let _ = write!(response, "\"device_id\":\"");
                    response.push_str(names.device_id.as_str());
                    let _ = write!(response, "\",\"mac\":\"");
                    response.push_str(format_usb_mac_lower(names.mac).as_str());
                    let _ = write!(response, "\",");
                }
                let _ = write!(
                    response,
                    "\"variant\":\"{}\",\"firmware\":{{\"name\":\"{}\",\"version\":\"{}\"}},\"hardware\":",
                    crate::board_profile::COMPILED_PROFILE_NAME,
                    env!("CARGO_PKG_NAME"),
                    release_version(),
                );
                let _ = write_hardware_descriptor_json(
                    &mut response,
                    crate::board_profile::COMPILED_PROFILE,
                    discovery,
                    compatibility,
                );
                let _ = write!(
                    response,
                    ",\"pd\":{{\"inputSink\":\"{}\"}}",
                    isolapurr_usb_hub::pd_i2c::usbpd_adapter::sink_status().as_str(),
                );
                response.push_str("}}}");
                let _ = usb.write_all(response.as_bytes()).await;
                let _ = usb.write_all(b"\n").await;
                let _ = usb.flush().await;
                len = 0;
            } else if *byte != b'\r' && len < line.len() {
                line[len] = *byte;
                len += 1;
            } else if len >= line.len() {
                len = 0;
            }
        }
    }
}

#[cfg(feature = "net_http")]
#[embassy_executor::task]
async fn fusb_diagnostics_console(
    usb: UsbSerialJtag<'static, esp_hal::Async>,
    discovery: isolapurr_firmware_core::hardware_discovery::DiscoveryState,
    compatibility: isolapurr_firmware_core::hardware_discovery::ProfileCompatibility,
    device_names: &'static net::DeviceNames,
) -> ! {
    safe_mismatch_console(usb, discovery, compatibility, Some(device_names)).await
}

/// Run U10 independently of boot diagnostics. A protocol or I2C fault must
/// end this task with VIN_USB disabled, never take down the boot task that
/// exposes the physical board identity.
#[cfg(feature = "board_tps_fusb")]
#[embassy_executor::task]
async fn fusb_input_runtime_task(
    i2c: I2cAllowlist<I2c<'static, esp_hal::Async>>,
    vin_en: Output<'static>,
    vin_sel: Output<'static>,
) {
    let mut phy = fusb302::Fusb302::new(i2c);
    let active_cc = match isolapurr_usb_hub::pd_i2c::fusb302::configure_sink(&mut phy).await {
        Ok(pin) => pin,
        Err(error) => {
            defmt::warn!(
                "tps-fusb U10 sink PHY setup failed: {:?}",
                defmt::Debug2Format(&error)
            );
            return;
        }
    };
    let driver = isolapurr_usb_hub::pd_i2c::usbpd_adapter::Fusb302UsbpdDriver::new(phy, active_cc);
    let dpm = isolapurr_usb_hub::pd_i2c::usbpd_adapter::FixedNineVoltSinkDpm::new(vin_en, vin_sel);
    let mut sink: usbpd::sink::policy_engine::Sink<
        _,
        isolapurr_usb_hub::pd_i2c::usbpd_adapter::EmbassyUsbPdTimer,
        _,
    > = usbpd::sink::policy_engine::Sink::new(driver, dpm);
    if let Err(error) = sink.run().await {
        defmt::warn!(
            "tps-fusb U10 sink policy stopped: {:?}",
            defmt::Debug2Format(&error)
        );
    }
}
