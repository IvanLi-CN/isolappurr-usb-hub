{
    let config = esp_hal::Config::default()
        .with_cpu_clock(CpuClock::max())
        .with_psram(esp_hal::psram::PsramConfig::default());
    let peripherals = esp_hal::init(config);
    #[cfg(feature = "net_http")]
    {
        let (_, psram_size_bytes) = esp_hal::psram::psram_raw_parts(&peripherals.PSRAM);
        PSRAM_SIZE_BYTES.store(psram_size_bytes, Ordering::Release);
    }
    esp_alloc::heap_allocator!(#[esp_hal::ram(reclaimed)] size: 64 * 1024);
    esp_alloc::psram_allocator!(peripherals.PSRAM, esp_hal::psram);
    let timg0 = TimerGroup::new(peripherals.TIMG0);
    esp_rtos::start(timg0.timer0);
    info!(
        "boot: tps-fusb profile={} (FUSB302 PHY + PD2 source policy)",
        board_profile::COMPILED_PROFILE_NAME
    );

    // The common reset state is deliberately established before the buses,
    // FUSB302 devices, display, Wi-Fi, or any profile controller exist.
    let _vin_en = Output::new(peripherals.GPIO34, Level::Low, OutputConfig::default());
    let _vin_sel = Output::new(peripherals.GPIO35, Level::Low, OutputConfig::default());
    let _vbus_gate = Output::new(peripherals.GPIO36, Level::Low, OutputConfig::default());
    let _ce_tps = Output::new(peripherals.GPIO37, Level::High, OutputConfig::default());
    let _p2_ced = Output::new(peripherals.GPIO2, Level::High, OutputConfig::default());
    let _p1_ced = Output::new(peripherals.GPIO4, Level::High, OutputConfig::default());
    let _p1_esp = Output::new(peripherals.GPIO5, Level::Low, OutputConfig::default());
    let _p1_en_n = Output::new(peripherals.GPIO16, Level::High, OutputConfig::default());
    let _blk = Output::new(peripherals.GPIO15, Level::High, OutputConfig::default());
    let _buzzer = Output::new(peripherals.GPIO21, Level::Low, OutputConfig::default());
    let mut _gpio47 = Flex::new(peripherals.GPIO47);
    _gpio47.set_level(Level::High);
    _gpio47.set_output_enable(false);
    _gpio47.set_input_enable(true);

    #[cfg(feature = "net_http")]
    let device_names = net::init_device_names();

    let i2c0 = I2c::new(
        peripherals.I2C0,
        I2cConfig::default()
            .with_frequency(Rate::from_khz(400))
            .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(20))),
    )
    .unwrap()
    .with_sda(peripherals.GPIO39)
    .with_scl(peripherals.GPIO40)
    .into_async();
    let i2c1 = I2c::new(
        peripherals.I2C1,
        I2cConfig::default()
            .with_frequency(Rate::from_khz(400))
            .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(20))),
    )
    .unwrap()
    .with_sda(peripherals.GPIO8)
    .with_scl(peripherals.GPIO9)
    .into_async();
    let mut i2c0 = I2cAllowlist::new(i2c0);
    let mut i2c1 = TelemetryI2cAllowlist::new(i2c1);
    let observed = hardware_discovery::probe_topology(&mut i2c0, &mut i2c1).await;
    let discovery_state = observed.classify();
    let compatibility = observed.compatibility(board_profile::COMPILED_PROFILE);
    crate::set_hardware_discovery_state(discovery_state);
    info!(
        "tps-fusb discovery: state={} compatibility={}",
        discovery_state.as_str(),
        compatibility.as_str()
    );
    if !matches!(compatibility, ProfileCompatibility::Match) {
        #[cfg(feature = "net_http")]
        {
            let usb = UsbSerialJtag::new(peripherals.USB_DEVICE).into_async();
            safe_mismatch_console(usb, discovery_state, compatibility, Some(device_names)).await;
        }
        #[cfg(not(feature = "net_http"))]
        loop {
            Timer::after_millis(1_000).await;
        }
    }

    // Keep the power path disabled until the source/sink HIL gate proves the
    // TPS/VBUS ownership and fault sequencing. PHY setup is still typed and
    // harmless with VBUS gate held low.
    let mut input_phy = fusb302::Fusb302::new(i2c0);
    let mut output_phy = fusb302::Fusb302::new(i2c1);
    let input_cc = match isolapurr_usb_hub::pd_i2c::fusb302::configure_sink(&mut input_phy).await {
        Ok(pin) => pin,
        Err(err) => {
            defmt::warn!("tps-fusb U10 sink PHY setup failed: {:?}", defmt::Debug2Format(&err));
            loop { Timer::after_millis(1_000).await; }
        }
    };
    if let Err(err) = isolapurr_usb_hub::pd_i2c::fusb302::configure_source(&mut output_phy).await {
        defmt::warn!("tps-fusb U11 source PHY setup failed: {:?}", defmt::Debug2Format(&err));
        loop { Timer::after_millis(1_000).await; }
    }
    info!("tps-fusb: source PHY ready; source VBUS gate remains disabled until output policy is attached");

    #[cfg(feature = "net_http")]
    {
        let usb = UsbSerialJtag::new(peripherals.USB_DEVICE).into_async();
        let _ = _spawner.spawn(fusb_diagnostics_console(
            usb,
            discovery_state,
            compatibility,
            device_names,
        ));
    }
    // The input policy owns U10 and the USB PMOS pins. It requests only a
    // fixed 9 V / 1 A PDO and enables VIN_USB after PS_RDY plus comparator
    // confirmation. All failures leave VIN_EN low.
    let sink_driver = isolapurr_usb_hub::pd_i2c::usbpd_adapter::Fusb302UsbpdDriver::new(input_phy, input_cc);
    let sink_dpm = isolapurr_usb_hub::pd_i2c::usbpd_adapter::FixedNineVoltSinkDpm::new(
        _vin_en,
        _vin_sel,
    );
    let mut sink: usbpd::sink::policy_engine::Sink<
        _,
        isolapurr_usb_hub::pd_i2c::usbpd_adapter::EmbassyUsbPdTimer,
        _,
    > = usbpd::sink::policy_engine::Sink::new(sink_driver, sink_dpm);
    if let Err(error) = sink.run().await {
        defmt::error!("tps-fusb U10 sink policy stopped: {:?}", defmt::Debug2Format(&error));
        loop {
            Timer::after_millis(1_000).await;
        }
    }
}
