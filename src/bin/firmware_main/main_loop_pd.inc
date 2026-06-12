{

        #[cfg(feature = "net_http")]
        if let Some(command) = take_wifi_provisioning() {
            match command {
                WifiProvisioningCommand::Store(credentials) => {
                    match provisioning::store_wifi_credentials(
                        telemetry_sampler.i2c_mut(),
                        &credentials,
                    )
                    .await
                    {
                        Ok(()) => {
                            set_wifi_credentials_cache(Some(credentials));
                            net::request_wifi_runtime_apply();
                            WIFI_PROVISIONING_RESULT.signal(true);
                            info!("provisioning: Wi-Fi credentials saved to EEPROM U21")
                        }
                        Err(err) => {
                            WIFI_PROVISIONING_RESULT.signal(false);
                            defmt::warn!(
                                "provisioning: failed to save Wi-Fi credentials to EEPROM U21: {:?}",
                                defmt::Debug2Format(&err)
                            );
                        }
                    }
                }
                WifiProvisioningCommand::Clear => {
                    match provisioning::clear_wifi_credentials(telemetry_sampler.i2c_mut()).await {
                        Ok(()) => {
                            set_wifi_credentials_cache(None);
                            net::request_wifi_runtime_apply();
                            WIFI_PROVISIONING_RESULT.signal(true);
                            info!("provisioning: Wi-Fi credentials cleared from EEPROM U21")
                        }
                        Err(err) => {
                            WIFI_PROVISIONING_RESULT.signal(false);
                            defmt::warn!(
                                "provisioning: failed to clear Wi-Fi credentials from EEPROM U21: {:?}",
                                defmt::Debug2Format(&err)
                            );
                        }
                    }
                }
            }
        }
        #[cfg(feature = "net_http")]
        {
            if settings_reset_inflight.is_none() {
                let guard = api_state.lock().await;
                settings_reset_inflight = guard.pending.settings_reset;
            }

            if let Some(net::ApiSettingsResetScope::Other) = settings_reset_inflight {
                let reset_now = Instant::now();
                let default_route = provisioning::DEFAULT_USB_C_DOWNSTREAM_ROUTE;
                let default_power_config = PowerConfig::defaults();
                let capability_changed = power_config.capability != default_power_config.capability;

                port_usb_c.busy_until =
                    Some(reset_now + Duration::from_millis(USB_C_ROUTE_SETTLE_MS));
                let _ = p2_ced.set_high();
                match default_route {
                    provisioning::UsbCDownstreamRoute::Mcu => {
                        let _ = p1_esp.set_low();
                    }
                    provisioning::UsbCDownstreamRoute::UsbC => {
                        let _ = p1_esp.set_high();
                    }
                }
                Timer::after_millis(USB_C_ROUTE_SETTLE_MS).await;

                let route_cleared =
                    match provisioning::clear_usb_c_downstream_route(telemetry_sampler.i2c_mut())
                        .await
                    {
                        Ok(()) => true,
                        Err(err) => {
                            defmt::warn!(
                                "provisioning: failed to clear USB-C downstream route from EEPROM U21: {:?}",
                                defmt::Debug2Format(&err)
                            );
                            false
                        }
                    };
                let power_cleared =
                    match provisioning::clear_power_config(telemetry_sampler.i2c_mut()).await {
                        Ok(()) => true,
                        Err(err) => {
                            defmt::warn!(
                                "provisioning: failed to clear power config from EEPROM U21: {:?}",
                                defmt::Debug2Format(&err)
                            );
                            false
                        }
                    };
                let idle_bias_cleared =
                    match provisioning::clear_idle_bias_calibration(telemetry_sampler.i2c_mut())
                        .await
                    {
                        Ok(()) => true,
                        Err(err) => {
                            defmt::warn!(
                                "provisioning: failed to clear idle-bias calibration from EEPROM U21: {:?}",
                                defmt::Debug2Format(&err)
                            );
                            false
                        }
                    };

                if route_cleared {
                    usb_c_downstream_route = default_route;
                    usb_c_downstream_persisted = false;
                } else {
                    match usb_c_downstream_route {
                        provisioning::UsbCDownstreamRoute::Mcu => {
                            let _ = p1_esp.set_low();
                        }
                        provisioning::UsbCDownstreamRoute::UsbC => {
                            let _ = p1_esp.set_high();
                        }
                    }
                }

                if power_cleared {
                    power_config = default_power_config;
                    power_config_persisted = false;
                    sw2303_profile_applied = false;
                    sw2303_readback_config = Sw2303CapabilityReadback::unavailable();
                    sw2303_recontract_pending =
                        capability_changed && matches!(port_usb_c.power, PowerState::On);
                    last_sw2303_profile_attempt = None;
                    last_sw2303_path_control = None;
                    sw2303_stable_reads = 0;
                    last_valid_sw2303_request = None;
                    last_request = None;
                    last_fast_protocol = None;
                }
                if idle_bias_cleared {
                    idle_bias_calibration = None;
                }

                if matches!(port_usb_c.power, PowerState::On)
                    && matches!(port_usb_c.data, DataState::Connected)
                {
                    let _ = p2_ced.set_low();
                }

                {
                    let mut guard = api_state.lock().await;
                    guard.pending.settings_reset = None;
                    if route_cleared || power_cleared || idle_bias_cleared {
                        guard.hub.usb_c_downstream_route = usb_c_downstream_route;
                        guard.hub.usb_c_downstream_persisted = usb_c_downstream_persisted;
                        guard.power.config = power_config;
                        guard.power.persisted = power_config_persisted;
                        guard.power.last_path_control = last_sw2303_path_control;
                        if idle_bias_cleared {
                            guard.idle_bias = idle_bias_api_snapshot(
                                idle_bias_calibration,
                                net::ApiIdleBiasRunSnapshot::idle(),
                                None,
                            );
                        }
                    }
                }

                if route_cleared && power_cleared && idle_bias_cleared {
                    let _ = ui
                        .show_message_card(
                            reset_now,
                            "SETTINGS RESET",
                            "OTHER CLEARED",
                            "WIFI KEPT",
                            TOAST_OK_RAW,
                            Duration::from_millis(TOAST_MS),
                        )
                        .await;
                    prompt_tone.notify(SoundEvent::ActionOk);
                    SETTINGS_RESET_RESULT.signal(SettingsResetResult::Complete);
                    info!("provisioning: non-Wi-Fi settings cleared from EEPROM U21");
                } else if route_cleared || power_cleared || idle_bias_cleared {
                    let _ = ui
                        .show_message_card(
                            reset_now,
                            "SETTINGS RESET",
                            "PARTIAL CLEAR",
                            "CHECK SETTINGS",
                            TOAST_ERR_RAW,
                            Duration::from_millis(TOAST_MS),
                        )
                        .await;
                    prompt_tone.notify(SoundEvent::ActionFail);
                    SETTINGS_RESET_RESULT.signal(SettingsResetResult::Partial);
                } else {
                    let _ = ui
                        .show_message_card(
                            reset_now,
                            "SETTINGS RESET",
                            "EEPROM FAIL",
                            "NOT CLEARED",
                            TOAST_ERR_RAW,
                            Duration::from_millis(TOAST_MS),
                        )
                        .await;
                    prompt_tone.notify(SoundEvent::ActionFail);
                    SETTINGS_RESET_RESULT.signal(SettingsResetResult::Failed);
                }
                settings_reset_inflight = None;
                button_fast_loop_until =
                    Some(Instant::now() + Duration::from_millis(POWER_SWITCH_GUARD_MS));
            }
        }
        #[cfg(feature = "net_http")]
        {
            let route_now = Instant::now();
            let mut pending_route = None;
            {
                let mut guard = api_state.lock().await;
                if guard.pending.usb_c_downstream_route.is_some() && !port_usb_c.is_busy(route_now)
                {
                    pending_route = guard.pending.usb_c_downstream_route.take();
                }
            }

            if let Some(route) = pending_route {
                let previous_route = usb_c_downstream_route;
                port_usb_c.busy_until =
                    Some(route_now + Duration::from_millis(USB_C_ROUTE_SETTLE_MS));
                let _ = p2_ced.set_high();
                match route {
                    provisioning::UsbCDownstreamRoute::Mcu => {
                        let _ = p1_esp.set_low();
                    }
                    provisioning::UsbCDownstreamRoute::UsbC => {
                        let _ = p1_esp.set_high();
                    }
                }
                Timer::after_millis(USB_C_ROUTE_SETTLE_MS).await;
                usb_c_downstream_route = route;
                usb_c_downstream_persisted = false;

                if matches!(port_usb_c.power, PowerState::On)
                    && matches!(port_usb_c.data, DataState::Connected)
                {
                    let _ = p2_ced.set_low();
                }

                match provisioning::store_usb_c_downstream_route(telemetry_sampler.i2c_mut(), route)
                    .await
                {
                    Ok(()) => {
                        usb_c_downstream_persisted = true;
                        let route_label =
                            route_transition_label(previous_route, usb_c_downstream_route);
                        let _ = ui
                            .show_message_card(
                                route_now,
                                "USB-C MODE",
                                route_label,
                                "EEPROM SAVED",
                                TOAST_OK_RAW,
                                Duration::from_millis(TOAST_MS),
                            )
                            .await;
                        prompt_tone.notify(SoundEvent::ActionOk);
                        USB_C_ROUTE_RESULT.signal(true);
                        info!(
                            "provisioning: USB-C downstream route saved to EEPROM U21 route={}",
                            route.as_str()
                        );
                    }
                    Err(err) => {
                        let _ = ui
                            .show_message_card(
                                route_now,
                                "USB-C MODE",
                                "EEPROM FAIL",
                                "NOT SAVED",
                                TOAST_ERR_RAW,
                                Duration::from_millis(TOAST_MS),
                            )
                            .await;
                        prompt_tone.notify(SoundEvent::ActionFail);
                        USB_C_ROUTE_RESULT.signal(false);
                        defmt::warn!(
                            "provisioning: failed to save USB-C downstream route to EEPROM U21: {:?}",
                            defmt::Debug2Format(&err)
                        );
                    }
                }
                button_fast_loop_until =
                    Some(Instant::now() + Duration::from_millis(POWER_SWITCH_GUARD_MS));
            }
        }
        #[cfg(feature = "net_http")]
        {
            let pending_power_config = {
                let mut guard = api_state.lock().await;
                guard.pending.power_config.take()
            };

            if let Some(command) = pending_power_config {
                let next_config = match command {
                    net::ApiPowerConfigCommand::Set { config } => config,
                    net::ApiPowerConfigCommand::Defaults => PowerConfig::defaults(),
                };
                let capability_changed = power_config.capability != next_config.capability;
                match provisioning::store_power_config(telemetry_sampler.i2c_mut(), next_config)
                    .await
                {
                    Ok(()) => {
                        power_config = next_config;
                        power_config_persisted = true;
                        sw2303_profile_applied = false;
                        sw2303_readback_config = Sw2303CapabilityReadback::unavailable();
                        sw2303_recontract_pending =
                            capability_changed && matches!(port_usb_c.power, PowerState::On);
                        last_sw2303_profile_attempt = None;
                        last_sw2303_path_control = None;
                        sw2303_stable_reads = 0;
                        last_valid_sw2303_request = None;
                        last_request = None;
                        last_fast_protocol = None;
                        {
                            let mut guard = api_state.lock().await;
                            guard.power.config = power_config;
                            guard.power.persisted = power_config_persisted;
                            guard.power.last_path_control = last_sw2303_path_control;
                        }
                        POWER_CONFIG_RESULT.signal(true);
                    }
                    Err(_) => {
                        POWER_CONFIG_RESULT.signal(false);
                    }
                }
            }
        }
        #[cfg(feature = "net_http")]
        include!("main_loop_pd_idle_bias.inc");
        #[cfg(feature = "net_http")]
        if REBOOT_PENDING.load(Ordering::Acquire) && !has_wifi_provisioning_pending() {
            REBOOT_PENDING.store(false, Ordering::Release);
            Timer::after_millis(100).await;
            esp_hal::system::software_reset();
        }

        #[cfg(feature = "net_http")]
        if ledd_last_sample.elapsed() >= Duration::from_millis(LEDD_SAMPLE_MS) {
            ledd_last_sample = Instant::now();
            let raw_low = isolated_usb_ready.is_low();
            let ready = raw_low;
            if ready != api_isolated_usb_ready {
                debug!(
                    "isolated usb ready ledd: sampled_ready={} raw_low={} sample_ms={}",
                    ready, raw_low, LEDD_SAMPLE_MS
                );
            }
            api_isolated_usb_ready = ready;
        }

        #[cfg(feature = "net_http")]
        if up0_pg_last_sample.elapsed() >= Duration::from_millis(UP0_PG_SAMPLE_MS) {
            up0_pg_last_sample = Instant::now();
            let raw_high = up0_pg.is_high();
            let fault = raw_high;
            if fault != api_isolated_usb_fault {
                debug!(
                    "isolated usb fault io1: sampled_fault={} raw_high={} sample_ms={}",
                    fault, raw_high, UP0_PG_SAMPLE_MS
                );
            }
            api_isolated_usb_fault = fault;
        }

        usb_c_pd_power_on = matches!(port_usb_c.power, PowerState::On);
        usb_c_power_off_setpoint = PowerSetpoint {
            output_enabled: false,
            ..boot_sp
        };

        let allow_sw2303_probe = usb_c_pd_power_on
            && (!sw2303_error_latched
                || last_sw2303_read_attempt
                    .map(|attempt| {
                        attempt.elapsed() >= Duration::from_millis(SW2303_ERROR_RETRY_MS)
                    })
                    .unwrap_or(true));
        if !sw2303_i2c_allowed && allow_sw2303_probe {
            last_sw2303_read_attempt = Some(Instant::now());
            let i2c_inner = sw2303_i2c.into_inner();
            let mut pd_sda = Flex::new(unsafe { AnyPin::steal(39) });
            let mut pd_scl = Flex::new(unsafe { AnyPin::steal(40) });
            pd_sda.set_input_enable(true);
            pd_scl.set_input_enable(true);
            pd_sda.apply_input_config(&sw2303_i2c_release_input_cfg);
            pd_scl.apply_input_config(&sw2303_i2c_release_input_cfg);
            pd_sda.apply_output_config(&sw2303_i2c_release_output_cfg);
            pd_scl.apply_output_config(&sw2303_i2c_release_output_cfg);
            pd_sda.set_high();
            pd_scl.set_high();
            pd_sda.set_output_enable(false);
            pd_scl.set_output_enable(false);
            Timer::after_millis(10).await;
            let bus_released = pd_sda.is_high() && pd_scl.is_high();
            if bus_released {
                info!("sw2303 power gate: PD I2C released after runtime line check");
                sw2303_i2c_allowed = true;
                sw2303_error_latched = false;
            }
            let i2c_inner = i2c_inner.with_sda(pd_sda).with_scl(pd_scl);
            sw2303_i2c = I2cAllowlist::new(i2c_inner);
        }
        let sw2303_power_gate_ready = tps_5v_setpoint_since
            .map(|since| since.elapsed() >= Duration::from_millis(SW2303_POR_RELEASE_MS))
            .unwrap_or(false);
        let allow_sw2303_read = sw2303_i2c_allowed && allow_sw2303_probe && sw2303_power_gate_ready;
        (request, setpoint) = if !usb_c_pd_power_on {
            (None, usb_c_power_off_setpoint)
        } else if allow_sw2303_read {
            last_sw2303_read_attempt = Some(Instant::now());
            let mut retry = 0;
            let request_result = loop {
                match read_power_request(&mut sw2303_i2c).await {
                    Ok(request) => break Ok(request),
                    Err(err) if retry < SW2303_READ_RETRIES => {
                        retry += 1;
                        Timer::after_millis(SW2303_READ_RETRY_DELAY_MS).await;
                        let _ = err;
                    }
                    Err(err) => break Err(err),
                }
            };
            match request_result {
                Ok(request) => {
                    let _ = sw2303_i2c.inner_mut().apply_config(
                        &I2cConfig::default()
                            .with_frequency(Rate::from_khz(PD_I2C_KHZ))
                            .with_software_timeout(SoftwareTimeout::Transaction(
                                Duration::from_millis(PD_I2C_TIMEOUT_MS),
                            )),
                    );
                    if retry > 0 {
                        info!("sw2303 read recovered after {} retries", retry);
                    }
                    sw2303_error_latched = false;
                    sw2303_consecutive_errors = 0;
                    last_valid_sw2303_request = Some(request);
                    sw2303_stable_reads = sw2303_stable_reads.saturating_add(1);
                    if matches!(sw2303_stable_reads, 1 | 10 | 50 | 100)
                        || sw2303_stable_reads % 500 == 0
                    {
                        info!(
                            "sw2303 stable reads={} v_req_mv={} i_req_ma={}",
                            sw2303_stable_reads, request.v_req_mv, request.i_req_ma
                        );
                    }
                    let sp = if sw2303_stable_reads >= SW2303_STABLE_READS_BEFORE_TPS {
                        power_request_to_setpoint(request)
                    } else {
                        boot_sp
                    };
                    (Some(request), sp)
                }
                Err(err) => {
                    let _ = sw2303_i2c.inner_mut().apply_config(
                        &I2cConfig::default()
                            .with_frequency(Rate::from_khz(PD_I2C_KHZ))
                            .with_software_timeout(SoftwareTimeout::Transaction(
                                Duration::from_millis(PD_I2C_TIMEOUT_MS),
                            )),
                    );
                    if !sw2303_error_latched {
                        defmt::warn!(
                            "sw2303 read error; keeping last valid target if available: {:?}",
                            defmt::Debug2Format(&err)
                        );
                        sw2303_error_latched = true;
                    }
                    sw2303_consecutive_errors = sw2303_consecutive_errors.saturating_add(1);
                    let sp = last_valid_sw2303_request
                        .map(power_request_to_setpoint)
                        .unwrap_or(boot_sp);
                    (last_valid_sw2303_request, sp)
                }
            }
        } else {
            let sp = last_valid_sw2303_request
                .map(power_request_to_setpoint)
                .unwrap_or(boot_sp);
            (last_valid_sw2303_request, sp)
        };

        if !sw2303_was_in_error && sw2303_error_latched {
            prompt_tone.notify(SoundEvent::EnterError(ErrorKind::Sw2303I2c));
        } else if sw2303_was_in_error && !sw2303_error_latched {
            prompt_tone.notify(SoundEvent::ExitError(ErrorKind::Sw2303I2c));
        }

        // Boot profile apply waits for stable target reads; runtime config changes
        // apply immediately once SW2303 I2C is usable so source caps do not lag EEPROM.
        if !sw2303_profile_applied
            && sw2303_i2c_allowed
            && (sw2303_recontract_pending
                || (request.is_some() && sw2303_stable_reads >= SW2303_STABLE_READS_BEFORE_PROFILE))
        {
            let allow_retry = last_sw2303_profile_attempt
                .map(|t| t.elapsed() >= Duration::from_secs(60))
                .unwrap_or(true)
                || sw2303_recontract_pending;
            if allow_retry {
                let apply_context = if sw2303_recontract_pending {
                    "applied after runtime config change"
                } else {
                    "applied after stable target reads"
                };
                last_sw2303_profile_attempt = Some(Instant::now());
                match apply_enable_profile(&mut sw2303_i2c, &power_config).await {
                    Ok(status) => {
                        sw2303_readback_config = status.readback;
                        let readback_matches = status.matches_config(&power_config);
                        sw2303_profile_applied = readback_matches;
                        log_sw2303_profile_status(apply_context, &status);
                        if readback_matches {
                            if sw2303_recontract_pending {
                                info!(
                                    "sw2303 profile: readback matched config; triggering CC un-driving to refresh sink contract"
                                );
                                match trigger_cc_un_driving(&mut sw2303_i2c).await {
                                    Ok(()) => {
                                        Timer::after_millis(SW2303_CC_UN_DRIVING_MS).await;
                                        info!(
                                            "sw2303 profile: CC un-driving pulse requested after config refresh"
                                        );
                                    }
                                    Err(err) => {
                                        defmt::warn!(
                                            "sw2303 profile: CC un-driving trigger failed after config refresh: {:?}",
                                            defmt::Debug2Format(&err)
                                        );
                                    }
                                }
                                request = None;
                                setpoint = boot_sp;
                                last_valid_sw2303_request = None;
                                last_request = None;
                                last_fast_protocol = None;
                                sw2303_stable_reads = 0;
                                sw2303_recontract_pending = false;
                            }
                        } else {
                            defmt::warn!(
                                "sw2303 profile: readback did not match requested power config; keeping profile_applied=false"
                            );
                        }
                    }
                    Err(err) => {
                        sw2303_readback_config = Sw2303CapabilityReadback::unavailable();
                        defmt::warn!(
                            "sw2303 profile: apply failed after stable target reads: {:?}",
                            defmt::Debug2Format(&err)
                        );
                    }
                }
            }
        }

        if let Some(request) = request {
            if power_request_changed_for_logging(last_request, request) {
                info!(
                    "pd request: fast_proto={} fast_v={} proto={:?} v_req_mv={} i_req_ma={}",
                    request.fast_protocol,
                    request.fast_voltage,
                    defmt::Debug2Format(&request.negotiated_protocol),
                    request.v_req_mv,
                    request.i_req_ma
                );
                last_request = Some(request);
            }

            if last_fast_protocol != Some(request.fast_protocol) {
                if request.fast_protocol {
                    info!("pd state: fast protocol active");
                } else {
                    info!("pd state: inactive");
                }
                last_fast_protocol = Some(request.fast_protocol);
            }
        } else {
            last_request = None;
            last_fast_protocol = None;
        }

        if usb_c_pd_power_on && power_config.tps_mode == TpsMode::Manual {
            let manual_vout_mv = quantize_manual_voltage_mv(power_config.manual.voltage_mv);
            setpoint = PowerSetpoint {
                output_enabled: true,
                v_out_mv: manual_vout_mv,
                i_lim_ma: power_config.manual.current_limit_ma,
            };

            let explicit_request_mv = request
                .filter(|request| {
                    request.status_valid
                        && (request.negotiated_protocol.is_some()
                            || request.fast_protocol
                            || request.fast_voltage)
                })
                .map(|request| request.v_req_mv);
            let path_control = resolve_manual_path_control(
                power_config.manual.usb_c_path_mode,
                manual_vout_mv,
                explicit_request_mv,
            );

            if sw2303_i2c_allowed && last_sw2303_path_control != Some(path_control) {
                match set_path_control(&mut sw2303_i2c, path_control).await {
                    Ok(()) => {
                        last_sw2303_path_control = Some(path_control);
                        info!("sw2303 path control: {}", path_control.as_str());
                    }
                    Err(err) => {
                        defmt::warn!(
                            "sw2303 path control failed: {:?}",
                            defmt::Debug2Format(&err)
                        );
                    }
                }
            }
        } else if usb_c_pd_power_on
            && sw2303_i2c_allowed
            && last_sw2303_path_control != Some(Sw2303PathControl::Auto)
        {
            match set_path_control(&mut sw2303_i2c, Sw2303PathControl::Auto).await {
                Ok(()) => {
                    last_sw2303_path_control = Some(Sw2303PathControl::Auto);
                    info!("sw2303 path control: auto");
                }
                Err(err) => {
                    defmt::warn!(
                        "sw2303 path control auto failed: {:?}",
                        defmt::Debug2Format(&err)
                    );
                }
            }
        }

        loop_delay_ms = SW2303_POLL_MS;

        let tps_apply_needed = tps_state.last != Some(setpoint);
        let tps_voltage_update_needed = setpoint.v_out_mv > boot_sp.v_out_mv;
        let tps_boot_restore_needed = usb_c_pd_power_on
            && setpoint == boot_sp
            && tps_5v_setpoint_since.is_none()
            && tps_apply_needed;
        let manual_tps_active = usb_c_pd_power_on && power_config.tps_mode == TpsMode::Manual;
        if (!manual_tps_active
            && usb_c_pd_power_on
            && sw2303_stable_reads < SW2303_STABLE_READS_BEFORE_TPS
            && !tps_boot_restore_needed)
            || (!tps_voltage_update_needed && !tps_apply_needed)
        {
            loop_delay_ms = SW2303_POLL_MS;
        } else if let Err(err) =
            apply_setpoint(telemetry_sampler.i2c_mut(), &mut tps_state, setpoint).await
        {
            if !tps_error_latched {
                defmt::warn!(
                    "tps55288 apply error (keeping output as-is): {:?}",
                    defmt::Debug2Format(&err)
                );
                tps_error_latched = true;
            }
            tps_consecutive_errors = tps_consecutive_errors.saturating_add(1);

            tps_state.last = None;
            loop_delay_ms = SW2303_ERROR_RETRY_MS;
        } else {
            tps_error_latched = false;
            tps_consecutive_errors = 0;
            tps_5v_setpoint_since.get_or_insert_with(Instant::now);
        }

        if !tps_was_in_error && tps_error_latched {
            prompt_tone.notify(SoundEvent::EnterSafety(SafetyKind::TpsApply));
        } else if tps_was_in_error && !tps_error_latched {
            prompt_tone.notify(SoundEvent::ExitSafety(SafetyKind::TpsApply));
        }

        let runtime_recovery_due =
            usb_c_pd_power_on && tps_consecutive_errors >= PD_RUNTIME_RECOVERY_ERROR_LIMIT;
        let runtime_recovery_allowed = last_pd_runtime_recovery
            .map(|last| {
                last.elapsed() >= Duration::from_millis(PD_RUNTIME_RECOVERY_MIN_INTERVAL_MS)
            })
            .unwrap_or(true);
        if runtime_recovery_due && runtime_recovery_allowed {
            pd_runtime_recovery_count = pd_runtime_recovery_count.saturating_add(1);
            last_pd_runtime_recovery = Some(Instant::now());
            defmt::warn!(
                "pd i2c runtime recovery #{}: sw_errors={} tps_errors={} sw_allowed={} stable_reads={}",
                pd_runtime_recovery_count,
                sw2303_consecutive_errors,
                tps_consecutive_errors,
                sw2303_i2c_allowed,
                sw2303_stable_reads
            );

            match stop_output_and_enable_discharge(telemetry_sampler.i2c_mut()).await {
                Ok(()) => info!("pd i2c runtime recovery: TPS OE off and discharge enabled"),
                Err(err) => {
                    defmt::warn!(
                        "pd i2c runtime recovery: TPS discharge failed before CE recovery: {:?}",
                        defmt::Debug2Format(&err)
                    );
                    tps_state.last = None;
                }
            }
            Timer::after_millis(BOOT_PD_DISCHARGE_SETTLE_MS).await;

            let i2c_inner = sw2303_i2c.into_inner();
            let mut pd_sda = Flex::new(unsafe { AnyPin::steal(39) });
            let mut pd_scl = Flex::new(unsafe { AnyPin::steal(40) });
            pd_sda.set_input_enable(true);
            pd_scl.set_input_enable(true);
            pd_sda.apply_input_config(&sw2303_i2c_release_input_cfg);
            pd_scl.apply_input_config(&sw2303_i2c_release_input_cfg);
            pd_sda.apply_output_config(&sw2303_i2c_release_output_cfg);
            pd_scl.apply_output_config(&sw2303_i2c_release_output_cfg);
            pd_sda.set_high();
            pd_scl.set_high();
            pd_sda.set_output_enable(false);
            pd_scl.set_output_enable(false);

            let mut recovered_after_ms = 0;
            let mut recovery_cycles = 0;
            for cycle in 1..=3 {
                recovery_cycles = cycle;
                let _ = ce_tps.set_high();
                Timer::after_millis(BOOT_CE_RECOVERY_HOLD_MS).await;
                let _ = ce_tps.set_low();
                for step in 1..=100 {
                    Timer::after_millis(BOOT_CE_RECOVERY_POLL_MS).await;
                    if pd_sda.is_high() && pd_scl.is_high() {
                        recovered_after_ms = BOOT_CE_RECOVERY_HOLD_MS as u32
                            + step * BOOT_CE_RECOVERY_POLL_MS as u32;
                        break;
                    }
                }
                if pd_sda.is_high() && pd_scl.is_high() {
                    break;
                }
            }
            info!(
                "pd i2c runtime recovery: after CE sda_high={} scl_high={} cycles={} recovered_after_ms={}",
                pd_sda.is_high(),
                pd_scl.is_high(),
                recovery_cycles,
                recovered_after_ms
            );

            let i2c_inner = i2c_inner.with_sda(pd_sda).with_scl(pd_scl);
            sw2303_i2c = I2cAllowlist::new(i2c_inner);
            let _ = sw2303_i2c.inner_mut().apply_config(
                &I2cConfig::default()
                    .with_frequency(Rate::from_khz(PD_I2C_KHZ))
                    .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(
                        PD_I2C_TIMEOUT_MS,
                    ))),
            );

            let mut runtime_boot_ready = false;
            let mut runtime_sw2303_allowed = false;
            for attempt in 1..=PD_RUNTIME_RECOVERY_TPS_RETRIES {
                match apply_setpoint(telemetry_sampler.i2c_mut(), &mut tps_state, boot_sp).await {
                    Ok(()) => {
                        let i2c_inner = sw2303_i2c.into_inner();
                        let mut pd_sda = Flex::new(unsafe { AnyPin::steal(39) });
                        let mut pd_scl = Flex::new(unsafe { AnyPin::steal(40) });
                        pd_sda.set_input_enable(true);
                        pd_scl.set_input_enable(true);
                        pd_sda.apply_input_config(&sw2303_i2c_release_input_cfg);
                        pd_scl.apply_input_config(&sw2303_i2c_release_input_cfg);
                        pd_sda.apply_output_config(&sw2303_i2c_release_output_cfg);
                        pd_scl.apply_output_config(&sw2303_i2c_release_output_cfg);
                        pd_sda.set_high();
                        pd_scl.set_high();
                        pd_sda.set_output_enable(false);
                        pd_scl.set_output_enable(false);
                        tps_5v_setpoint_since = Some(Instant::now());
                        info!(
                            "pd i2c runtime recovery: TPS boot 5V applied (attempt {}/{}); holding SW2303 POR",
                            attempt, PD_RUNTIME_RECOVERY_TPS_RETRIES
                        );
                        Timer::after_millis(SW2303_POR_RELEASE_MS).await;
                        pd_sda.apply_input_config(&sw2303_i2c_release_input_cfg);
                        pd_scl.apply_input_config(&sw2303_i2c_release_input_cfg);
                        pd_sda.apply_output_config(&sw2303_i2c_release_output_cfg);
                        pd_scl.apply_output_config(&sw2303_i2c_release_output_cfg);
                        pd_sda.set_high();
                        pd_scl.set_high();
                        pd_sda.set_output_enable(false);
                        pd_scl.set_output_enable(false);
                        Timer::after_millis(BOOT_PD_RELEASE_SETTLE_MS).await;
                        runtime_sw2303_allowed = pd_sda.is_high() && pd_scl.is_high();
                        info!(
                            "pd i2c runtime recovery: SW2303 POR elapsed sda_high={} scl_high={}",
                            pd_sda.is_high(),
                            pd_scl.is_high()
                        );
                        sw2303_i2c = I2cAllowlist::new(i2c_inner.with_sda(pd_sda).with_scl(pd_scl));
                        runtime_boot_ready = true;
                        break;
                    }
                    Err(err) => {
                        if attempt == PD_RUNTIME_RECOVERY_TPS_RETRIES {
                            defmt::warn!(
                                "pd i2c runtime recovery: TPS boot 5V failed (attempt {}/{}): {:?}",
                                attempt,
                                PD_RUNTIME_RECOVERY_TPS_RETRIES,
                                defmt::Debug2Format(&err)
                            );
                        } else {
                            defmt::warn!(
                                "pd i2c runtime recovery: TPS boot I2C retry after error (attempt {}/{}): {:?}",
                                attempt,
                                PD_RUNTIME_RECOVERY_TPS_RETRIES,
                                defmt::Debug2Format(&err)
                            );
                            let i2c_inner = sw2303_i2c.into_inner();
                            let mut pd_sda = Flex::new(unsafe { AnyPin::steal(39) });
                            let mut pd_scl = Flex::new(unsafe { AnyPin::steal(40) });
                            pd_sda.set_input_enable(true);
                            pd_scl.set_input_enable(true);
                            pd_sda.apply_input_config(&sw2303_i2c_release_input_cfg);
                            pd_scl.apply_input_config(&sw2303_i2c_release_input_cfg);
                            pd_sda.apply_output_config(&sw2303_i2c_release_output_cfg);
                            pd_scl.apply_output_config(&sw2303_i2c_release_output_cfg);
                            pd_sda.set_high();
                            pd_scl.set_high();
                            pd_sda.set_output_enable(false);
                            pd_scl.set_output_enable(false);
                            let _ = ce_tps.set_high();
                            Timer::after_millis(BOOT_CE_RECOVERY_HOLD_MS).await;
                            let _ = ce_tps.set_low();
                            Timer::after_millis(BOOT_TPS_RETRY_DELAY_MS).await;
                            sw2303_i2c =
                                I2cAllowlist::new(i2c_inner.with_sda(pd_sda).with_scl(pd_scl));
                            let _ = sw2303_i2c.inner_mut().apply_config(
                                &I2cConfig::default()
                                    .with_frequency(Rate::from_khz(PD_I2C_KHZ))
                                    .with_software_timeout(SoftwareTimeout::Transaction(
                                        Duration::from_millis(PD_I2C_TIMEOUT_MS),
                                    )),
                            );
                        }
                        tps_state.last = None;
                    }
                }
            }

            sw2303_i2c_allowed = runtime_sw2303_allowed;
            if runtime_boot_ready {
                sw2303_consecutive_errors = 0;
                tps_consecutive_errors = 0;
                sw2303_error_latched = false;
                tps_error_latched = false;
                sw2303_stable_reads = 0;
                sw2303_profile_applied = false;
                sw2303_readback_config = Sw2303CapabilityReadback::unavailable();
                sw2303_recontract_pending = false;
                last_sw2303_read_attempt = None;
                last_sw2303_profile_attempt = None;
                last_valid_sw2303_request = None;
                last_request = None;
                last_fast_protocol = None;
                last_tps_status = None;
                info!(
                    "pd i2c runtime recovery #{} complete: sw2303_i2c_allowed={}",
                    pd_runtime_recovery_count, sw2303_i2c_allowed
                );
                Timer::after_millis(SW2303_POLL_MS).await;
                continue;
            }

            defmt::warn!(
                "pd i2c runtime recovery #{} failed; keeping safety state",
                pd_runtime_recovery_count
            );
        }

}
