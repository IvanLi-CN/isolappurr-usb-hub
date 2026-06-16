{
    let config = esp_hal::Config::default()
        .with_cpu_clock(CpuClock::max())
        .with_psram(esp_hal::psram::PsramConfig::default());
    let peripherals = esp_hal::init(config);

    // Internal heap for firmware/runtime allocations; display framebuffers are explicitly placed
    // in PSRAM via `esp_alloc::ExternalMemory`.
    esp_alloc::heap_allocator!(#[esp_hal::ram(reclaimed)] size: 64 * 1024);
    esp_alloc::psram_allocator!(peripherals.PSRAM, esp_hal::psram);

    // Initialize the preemptive scheduler used by esp-radio (+ embassy integrations).
    let timg0 = TimerGroup::new(peripherals.TIMG0);
    esp_rtos::start(timg0.timer0);

    info!("boot: isolapurr-usb-hub starting (pd i2c coordinator)");
    info!(
        "firmware: version={} profile={} git={} ref={} dirty={} dashboard_bg_rgb=({},{},{})",
        release_version(),
        BUILD_PROFILE,
        BUILD_GIT_SHA,
        BUILD_GIT_REF,
        BUILD_GIT_DIRTY,
        DASHBOARD_BG_RGB8.0,
        DASHBOARD_BG_RGB8.1,
        DASHBOARD_BG_RGB8.2
    );

    // Optional HTTP API state is shared by Wi-Fi and USB/native transports.
    #[cfg(feature = "net_http")]
    let api_state = net::init_http_api_state();

    let buzzer = LedcBuzzer::new(peripherals.LEDC, peripherals.GPIO21).expect("buzzer LEDC init");
    let mut prompt_tone = PromptToneManager::new(buzzer);
    info!(
        "buzzer: prompt_tone default freq={}Hz duty={}%",
        DEFAULT_FREQ_HZ, DEFAULT_DUTY_PCT
    );

    // Physical buttons:
    // - BTNR = GPIO0 (active-low, requires internal pull-up)
    // - BTNL = GPIO1 (active-low, requires internal pull-up)
    let btn_cfg = InputConfig::default().with_pull(Pull::Up);
    let btn_left = Input::new(peripherals.GPIO1, btn_cfg);
    let btn_right = Input::new(peripherals.GPIO0, btn_cfg);
    let mut btn_left_state = DebouncedButton::new();
    let mut btn_right_state = DebouncedButton::new();
    let btn_debounce = Duration::from_millis(30);
    let mut btn_raw_left_pressed = btn_left.is_low();
    let mut btn_raw_right_pressed = btn_right.is_low();
    info!(
        "buttons: initial raw left_pressed={} right_pressed={}",
        btn_raw_left_pressed, btn_raw_right_pressed
    );

    // Isolated-side USB indicators:
    // - HUSB305-01 STAT/UP0_PG → MCU GPIO18, external 100k pull-up, active-high fault indication.
    // - U2 pin13 LED/MODE = LEDD → MCU GPIO6, active-low isolated USB ready/link indicator.
    // Both signals are status inputs only; keep MCU pins hi-Z with no internal pulls.
    #[cfg(feature = "net_http")]
    let up0_pg_cfg = InputConfig::default().with_pull(Pull::None);
    #[cfg(feature = "net_http")]
    let up0_pg = Input::new(peripherals.GPIO18, up0_pg_cfg);
    #[cfg(feature = "net_http")]
    let mut api_isolated_usb_fault = up0_pg.is_high();
    #[cfg(feature = "net_http")]
    let mut up0_pg_last_sample = Instant::now();
    #[cfg(feature = "net_http")]
    info!(
        "isolated usb fault io1: GPIO18 initial raw_high={} (active-high, hi-z input; no pull)",
        up0_pg.is_high()
    );

    #[cfg(feature = "net_http")]
    let ledd_cfg = InputConfig::default().with_pull(Pull::None);
    #[cfg(feature = "net_http")]
    let isolated_usb_ready = Input::new(peripherals.GPIO6, ledd_cfg);
    #[cfg(feature = "net_http")]
    let mut api_isolated_usb_ready = isolated_usb_ready.is_low();
    #[cfg(feature = "net_http")]
    let mut ledd_last_sample = Instant::now();
    #[cfg(feature = "net_http")]
    info!(
        "isolated usb ready ledd: GPIO6 initial raw_low={} (active-low, hi-z input; no pull)",
        isolated_usb_ready.is_low()
    );

    let mut btn_left_pressed_at: Option<Instant> = None;
    let mut btn_right_pressed_at: Option<Instant> = None;
    #[cfg(feature = "net_http")]
    let mut combo_active = false;
    #[cfg(not(feature = "net_http"))]
    let combo_active = false;
    #[cfg(feature = "net_http")]
    let mut combo_pressed_at: Option<Instant> = None;
    #[cfg(feature = "net_http")]
    let mut combo_done = false;
    #[cfg(feature = "net_http")]
    let mut combo_expired = false;
    let mut settings_menu_selected = SettingsMenuItem::Mode;
    #[cfg(feature = "net_http")]
    let mut settings_menu_view = SettingsMenuView::Main;
    let mut settings_menu_until: Option<Instant> = None;

    // Port controls (tps-sw netlist):
    // - P1_CED/P2_CED drive CH442E EN#: low=enable/connect, high=disable/disconnect.
    // - U8 IN is P1_ESP: low=MCU D+/D-, high=USB-C/TPS D+/D-.
    // - P1_EN# drives CH217K enable: low=enable (power on), high=disable (power off).
    // - CE_TPS drives Q9, pulling TPS EN/UVLO low when CE_TPS is high (power off).
    //
    // Keep data paths connected at boot, but hold TPS output off before the
    // SW2303 POR window is explicitly controlled below.
    let mut p2_ced = Output::new(peripherals.GPIO2, Level::Low, OutputConfig::default());
    let mut p1_ced = Output::new(peripherals.GPIO4, Level::Low, OutputConfig::default());
    #[allow(unused_mut, unused_variables)]
    let mut p1_esp = Output::new(peripherals.GPIO5, Level::High, OutputConfig::default());
    let mut p1_en_n = Output::new(peripherals.GPIO16, Level::Low, OutputConfig::default());
    let mut ce_tps = Output::new(peripherals.GPIO37, Level::High, OutputConfig::default());
    info!(
        "ports: boot state p1_en#=low(on) p1_ced=low(connect) p2_ced=low(connect) p1_esp=high(route=usb_c) ce_tps=high(off)"
    );

    let mut port_usb_a = PortState::new(PowerState::On);
    let mut port_usb_c = PortState::new(PowerState::On);

    // TPS55288 FB/INT fault indication (tps-sw netlist):
    // - shared INT = GPIO7
    // - active-low, external 4.7k pull-up to 3V3
    // - keep hi-Z (no internal pull)
    let mut io = Io::new(peripherals.IO_MUX);
    io.set_interrupt_handler(gpio_interrupt_handler);
    let tps_int_cfg = InputConfig::default().with_pull(Pull::None);
    let mut tps_int = Input::new(peripherals.GPIO7, tps_int_cfg);
    let mut last_tps_int_low = tps_int.is_low();
    info!(
        "tps int: GPIO7 initial raw_low={} (active-low, hi-z input; no pull)",
        last_tps_int_low
    );
    critical_section::with(|cs| {
        tps_int.listen(Event::AnyEdge);
        TPS_INT.borrow_ref_mut(cs).replace(tps_int);
    });
    if last_tps_int_low {
        TPS_INT_DIRTY.store(true, Ordering::Release);
    }

    let tps_i2c = I2c::new(
        peripherals.I2C1,
        I2cConfig::default()
            .with_frequency(Rate::from_khz(400))
            .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(20))),
    )
    .unwrap()
    .with_sda(peripherals.GPIO8)
    .with_scl(peripherals.GPIO9)
    .into_async();
    let mut telemetry_i2c = TelemetryI2cAllowlist::new(tps_i2c);
    info!(
        "tps i2c: I2C1@400kHz async SDA=GPIO8 SCL=GPIO9 allowlist=[0x40/0x44,0x41/0x45,0x50,0x74]"
    );

    let sw2303_i2c = I2c::new(
        peripherals.I2C0,
        I2cConfig::default()
            .with_frequency(Rate::from_khz(PD_I2C_KHZ))
            .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(
                PD_I2C_TIMEOUT_MS,
            ))),
    )
    .unwrap()
    .with_sda(peripherals.GPIO39)
    .with_scl(peripherals.GPIO40)
    .into_async();
    let mut sw2303_i2c = I2cAllowlist::new(sw2303_i2c);
    info!(
        "sw2303 i2c: I2C0@{}kHz async SDA=GPIO39 SCL=GPIO40 allowlist=[0x3C]",
        PD_I2C_KHZ
    );
    let sw2303_i2c_release_input_cfg = InputConfig::default().with_pull(Pull::Up);
    let sw2303_i2c_release_output_cfg = OutputConfig::default()
        .with_drive_mode(DriveMode::OpenDrain)
        .with_pull(Pull::Up);

    let mut tps_state = TpsApplyState::new();
    let mut last_request: Option<PowerRequest> = None;
    let mut last_valid_sw2303_request: Option<PowerRequest> = None;
    let mut last_fast_protocol: Option<bool> = None;

    let mut sw2303_error_latched = false;
    let mut tps_error_latched = false;
    let mut ui_error_latched = false;
    let mut sw2303_profile_applied = false;
    let mut sw2303_readback_config = Sw2303CapabilityReadback::unavailable();
    let mut sw2303_recontract_pending = false;
    let mut last_sw2303_profile_attempt: Option<Instant> = None;
    let mut last_sw2303_read_attempt: Option<Instant> = None;
    let mut sw2303_stable_reads: u16 = 0;
    let mut sw2303_consecutive_errors: u8 = 0;
    let mut tps_consecutive_errors: u8 = 0;
    let mut last_pd_runtime_recovery: Option<Instant> = None;
    let mut pd_runtime_recovery_count: u32 = 0;
    let mut tps_5v_setpoint_since: Option<Instant> = None;
    let mut last_tps_iout_limit_readback_attempt_uptime_ms: Option<u64> = None;
    let mut last_tps_status: Option<(
        tps55288::data_types::OperatingStatus,
        tps55288::data_types::FaultStatus,
    )> = None;
    let mut button_fast_loop_until: Option<Instant> = None;

    let pd_boot_started = Instant::now();
    let mut boot_recovery_cycled = false;
    let boot_sp = boot_supply_setpoint();
    // CE_TPS has held TPS/SW2303 off since GPIO init. Release TPS only after
    // SDA/SCL have been held high, then program TPS; SW2303 POR starts after
    // the final TPS OE write completes.
    let _ = ce_tps.set_low();
    Timer::after_millis(BOOT_CE_RELEASE_SETTLE_MS).await;
    match stop_output_and_enable_discharge(&mut telemetry_i2c).await {
        Ok(()) => {
            info!("tps55288 boot discharge: OE off and active discharge enabled");
        }
        Err(err) => {
            defmt::warn!(
                "tps55288 boot discharge failed; continuing with boot setpoint: {:?}",
                defmt::Debug2Format(&err)
            );
            tps_state.last = None;
        }
    }
    Timer::after_millis(BOOT_PD_DISCHARGE_SETTLE_MS).await;

    if let Err(err) = apply_light_load_mode(
        &mut telemetry_i2c,
        &mut tps_state,
        PowerConfig::defaults().light_load_mode,
    )
    .await
    {
        defmt::warn!(
            "tps55288 boot light-load mode apply failed; continuing with board default: {:?}",
            defmt::Debug2Format(&err)
        );
        tps_state.light_load_mode = None;
    }

    let mut tps_boot_ready = false;
    let mut sw2303_i2c_allowed = false;
    let mut boot_retry_recovery_cycled = false;
    for attempt in 1..=4 {
        match apply_setpoint(&mut telemetry_i2c, &mut tps_state, boot_sp).await {
            Ok(()) => {
                tps_error_latched = false;
                tps_boot_ready = true;
                tps_5v_setpoint_since = Some(Instant::now());
                info!(
                    "tps55288 boot supply applied (attempt {}/4): v={}mV ilim={}mA elapsed_ms={}",
                    attempt,
                    boot_sp.v_out_mv,
                    boot_sp.i_lim_ma,
                    elapsed_ms_since(pd_boot_started)
                );
                info!(
                    "sw2303 power gate: holding SW2303 POR for {}ms after TPS boot setpoint",
                    SW2303_POR_RELEASE_MS
                );
                Timer::after_millis(SW2303_POR_RELEASE_MS).await;
                sw2303_i2c_allowed = true;
                info!(
                    "sw2303 power gate: SW2303 POR delay elapsed elapsed_ms={}",
                    elapsed_ms_since(pd_boot_started)
                );
                break;
            }
            Err(err) => {
                if attempt == 4 {
                    defmt::warn!(
                        "tps55288 boot supply apply failed (attempt {}/4): {:?}",
                        attempt,
                        defmt::Debug2Format(&err)
                    );
                } else {
                    if !boot_retry_recovery_cycled {
                        defmt::warn!(
                            "tps55288 boot I2C failed; hard-cycling CE_TPS before retry: {:?}",
                            defmt::Debug2Format(&err)
                        );
                        let _ = ce_tps.set_high();
                        Timer::after_millis(BOOT_CE_RECOVERY_HOLD_MS).await;
                        let _ = ce_tps.set_low();
                        boot_retry_recovery_cycled = true;
                        boot_recovery_cycled = true;
                    } else {
                        info!(
                            "tps55288 boot supply retrying after transient I2C error (attempt {}/4): {:?}",
                            attempt,
                            defmt::Debug2Format(&err)
                        );
                    }
                    tps_state.last = None;
                    tps_error_latched = true;
                    if attempt < 4 {
                        Timer::after_millis(BOOT_TPS_RETRY_DELAY_MS).await;
                    }
                }
            }
        }
    }
    if !tps_boot_ready {
        defmt::warn!("tps55288 boot supply not ready; skipping boot-time SW2303 profile");
        prompt_tone.notify(SoundEvent::EnterSafety(SafetyKind::TpsApply));
    }

    if tps_boot_ready {
        info!("sw2303 profile: deferred until first successful SW2303 read");
    }

    #[allow(unused_mut)]
    let mut telemetry_i2c = telemetry_i2c;
    #[cfg(feature = "net_http")]
    let wifi_credentials = match provisioning::load_wifi_credentials(&mut telemetry_i2c).await {
        Ok(value) => {
            set_wifi_credentials_cache(value);
            if value.is_some() {
                info!("provisioning: Wi-Fi credentials loaded from EEPROM U21");
            } else {
                info!("provisioning: Wi-Fi EEPROM U21 has no configured credentials");
            }
            value
        }
        Err(err) => {
            defmt::warn!(
                "provisioning: failed to load Wi-Fi credentials from EEPROM U21: {:?}",
                defmt::Debug2Format(&err)
            );
            None
        }
    };
    #[cfg(feature = "net_http")]
    let (mut usb_c_downstream_route, mut usb_c_downstream_persisted) =
        match provisioning::load_usb_c_downstream_route(&mut telemetry_i2c).await {
            Ok(Some(route)) => {
                info!(
                    "provisioning: USB-C downstream route loaded from EEPROM U21 route={}",
                    route.as_str()
                );
                (route, true)
            }
            Ok(None) => {
                info!(
                    "provisioning: USB-C downstream route EEPROM record empty; defaulting to mcu"
                );
                (provisioning::DEFAULT_USB_C_DOWNSTREAM_ROUTE, false)
            }
            Err(err) => {
                defmt::warn!(
                    "provisioning: failed to load USB-C downstream route from EEPROM U21: {:?}; defaulting to mcu",
                    defmt::Debug2Format(&err)
                );
                (provisioning::DEFAULT_USB_C_DOWNSTREAM_ROUTE, false)
            }
        };
    #[cfg(feature = "net_http")]
    match usb_c_downstream_route {
        provisioning::UsbCDownstreamRoute::Mcu => {
            let _ = p2_ced.set_high();
            let _ = p1_esp.set_low();
            Timer::after_millis(USB_C_ROUTE_SETTLE_MS).await;
            let _ = p2_ced.set_low();
        }
        provisioning::UsbCDownstreamRoute::UsbC => {
            let _ = p2_ced.set_high();
            let _ = p1_esp.set_high();
            Timer::after_millis(USB_C_ROUTE_SETTLE_MS).await;
            let _ = p2_ced.set_low();
        }
    }
    #[cfg(feature = "net_http")]
    let (mut power_config, mut power_config_persisted) =
        match provisioning::load_power_config(&mut telemetry_i2c).await {
            Ok(Some(config)) => {
                info!("provisioning: power config loaded from EEPROM U21");
                (config, true)
            }
            Ok(None) => {
                info!("provisioning: power config EEPROM record empty; defaulting to full auto profile");
                (PowerConfig::defaults(), false)
            }
            Err(err) => {
                defmt::warn!(
                    "provisioning: failed to load power config from EEPROM U21: {:?}; defaulting to full auto profile",
                    defmt::Debug2Format(&err)
                );
                (PowerConfig::defaults(), false)
            }
        };
    tps_state.light_load_mode = None;
    #[cfg(feature = "net_http")]
    let mut idle_bias_calibration = match provisioning::load_idle_bias_calibration(&mut telemetry_i2c)
        .await
    {
        Ok(Some(calibration)) => {
            info!("provisioning: idle-bias calibration loaded from EEPROM U21");
            Some(calibration)
        }
        Ok(None) => {
            info!("provisioning: idle-bias EEPROM record empty; correction disabled");
            None
        }
        Err(err) => {
            defmt::warn!(
                "provisioning: failed to load idle-bias calibration from EEPROM U21: {:?}; correction disabled",
                defmt::Debug2Format(&err)
            );
            None
        }
    };
    #[cfg(not(feature = "net_http"))]
    let mut power_config = PowerConfig::defaults();
    let mut last_sw2303_path_control: Option<Sw2303PathControl> = None;
    #[cfg(feature = "net_http")]
    let mut settings_reset_inflight: Option<net::ApiSettingsResetScope> = None;
    #[cfg(feature = "net_http")]
    {
        let mut guard = api_state.lock().await;
        guard.idle_bias = idle_bias_api_snapshot(
            idle_bias_calibration,
            net::ApiIdleBiasRunSnapshot::idle(),
            None,
        );
    }
    #[cfg(feature = "net_http")]
    let net_handles =
        net::spawn_wifi_mdns_http(&_spawner, peripherals.WIFI, api_state, wifi_credentials);
    #[cfg(feature = "net_http")]
    {
        let usb_serial = UsbSerialJtag::new(peripherals.USB_DEVICE).into_async();
        let device_names = net_handles.as_ref().map(|handles| handles.device_names);
        let wifi_state = net_handles.as_ref().map(|handles| handles.wifi_state);
        if _spawner
            .spawn(usb_console_task(
                usb_serial,
                api_state,
                device_names,
                wifi_state,
            ))
            .is_err()
        {
            defmt::warn!("usb console: failed to spawn USB Serial/JTAG JSONL task");
        } else {
            info!("usb console: USB Serial/JTAG JSONL task started");
        }
    }

    let mut telemetry_sampler = NormalUiTelemetrySampler::new_with_allowlist(telemetry_i2c);
    match telemetry_sampler.init().await {
        Ok(()) => {
            info!(
                "telemetry: INA226 init ok usb_a_addr={:?} usb_c_addr={:?}",
                defmt::Debug2Format(&telemetry_sampler.usb_a_address()),
                defmt::Debug2Format(&telemetry_sampler.usb_c_address())
            );
        }
        Err(err) => {
            defmt::warn!(
                "telemetry: INA226 init error (PD loop continues; fields may show ERR): {:?}; usb_a_addr={:?} usb_c_addr={:?}",
                defmt::Debug2Format(&err),
                defmt::Debug2Format(&telemetry_sampler.usb_a_address()),
                defmt::Debug2Format(&telemetry_sampler.usb_c_address())
            );
            prompt_tone.notify(SoundEvent::InitWarn(InitWarnReason::Ina226Init));
        }
    }

    // GC9307 display (landscape) + backlight control.
    // SPI: MOSI=GPIO11, SCLK=GPIO12. CS=GPIO13, DC=GPIO10, RES=GPIO14.
    // Backlight gate BLK=GPIO15 (active-low).
    let dc = Output::new(peripherals.GPIO10, Level::Low, OutputConfig::default());
    let rst = Output::new(peripherals.GPIO14, Level::High, OutputConfig::default());
    let cs = Output::new(peripherals.GPIO13, Level::High, OutputConfig::default());
    // Backlight gate BLK is active-low. Force it ON immediately so backlight is not
    // coupled to display init success.
    let blk = Output::new(peripherals.GPIO15, Level::Low, OutputConfig::default());

    let spi_bus = Spi::new(
        peripherals.SPI2,
        SpiConfig::default()
            .with_frequency(Rate::from_mhz(40))
            .with_mode(Mode::_0),
    )
    .unwrap()
    .with_sck(peripherals.GPIO12)
    .with_mosi(peripherals.GPIO11);

    let (rx_buffer, rx_descriptors, tx_buffer, tx_descriptors) = dma_buffers!(4096);
    let dma_rx_buf = DmaRxBuf::new(rx_descriptors, rx_buffer).unwrap();
    let dma_tx_buf = DmaTxBuf::new(tx_descriptors, tx_buffer).unwrap();
    let spi_bus = spi_bus
        .with_dma(peripherals.DMA_CH0)
        .with_buffers(dma_rx_buf, dma_tx_buf)
        .into_async();

    let spi = CsSpiDevice::new(spi_bus, cs);

    let workbuf = unsafe { &mut *core::ptr::addr_of_mut!(DISPLAY_WORKBUF) };
    let backlight = ActiveLowBacklight(blk);
    let mut ui: DisplayUi<'_, _, _, _, EspHalSpinTimer, _> =
        DisplayUi::new(spi, dc, rst, workbuf, backlight).expect("display ui psram framebuffers");
    info!(
        "display: GC9307 landscape SPI2@40MHz async DMA MOSI=GPIO11 SCLK=GPIO12 CS=GPIO13 DC=GPIO10 RES=GPIO14 BLK=GPIO15(active-low)"
    );
    info!(
        "pd boot summary: tps_ready={} path={} sw2303_i2c_allowed={} elapsed_ms={}",
        tps_boot_ready,
        if boot_retry_recovery_cycled {
            "ce_recovered_before_tps_and_retry"
        } else if boot_recovery_cycled {
            "ce_recovered_before_tps"
        } else {
            "direct"
        },
        sw2303_i2c_allowed,
        elapsed_ms_since(pd_boot_started)
    );

    if let Err(err) = ui.init().await {
        defmt::warn!(
            "display: init error (PD loop continues): {:?}",
            defmt::Debug2Format(&err)
        );
        prompt_tone.notify(SoundEvent::InitWarn(InitWarnReason::DisplayInit));
    } else if let Err(err) = ui.draw_frame().await {
        defmt::warn!(
            "display: draw_frame error (PD loop continues): {:?}",
            defmt::Debug2Format(&err)
        );
        prompt_tone.notify(SoundEvent::InitWarn(InitWarnReason::DisplayInit));
    }

    let mut last_tick = Instant::now();

    #[cfg(feature = "net_http")]
    let mut api_usb_a_present = false;
    #[cfg(feature = "net_http")]
    let mut api_usb_c_present = false;
    #[cfg(feature = "net_http")]
    let mut api_sample_uptime_ms: u64 = 0;
    #[cfg(feature = "net_http")]
    let mut api_usb_a_metrics = PortMetrics::err();
    #[cfg(feature = "net_http")]
    let mut api_usb_c_metrics = PortMetrics::err();
    #[cfg(feature = "net_http")]
    let mut api_usb_c_metrics_raw = PortMetrics::err();

    prompt_tone.notify(SoundEvent::InitDone);
    {
        let now_us = esp_hal::time::Instant::now()
            .duration_since_epoch()
            .as_micros();
        let now = core::time::Duration::from_micros(now_us);
        prompt_tone.tick(now);
    }


    loop {
        let sw2303_was_in_error = sw2303_error_latched;
        let tps_was_in_error = tps_error_latched;
        let ui_was_in_error = ui_error_latched;
        #[cfg(feature = "net_http")]
        let mut power_config_result_pending: Option<bool> = None;
        let usb_c_pd_power_on: bool;
        let usb_c_power_off_setpoint: PowerSetpoint;
        let mut request: Option<PowerRequest>;
        let mut setpoint: PowerSetpoint;
        let mut loop_delay_ms: u64;
        include!("main_loop_pd.inc");
        include!("main_loop_ports.inc");
        include!("main_loop_buttons.inc");
    }
}
