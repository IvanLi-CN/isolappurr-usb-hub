{
    let pending_idle_bias = {
        let mut guard = api_state.lock().await;
        guard.pending.idle_bias.take()
    };

    if let Some(command) = pending_idle_bias {
        match command {
        net::ApiIdleBiasCommand::SetCorrection { enabled } => {
            let Some(mut calibration) = idle_bias_calibration else {
                let mut guard = api_state.lock().await;
                let run = guard.idle_bias.run;
                guard.idle_bias = idle_bias_api_snapshot(
                    None,
                    run,
                    guard.idle_bias.current_applied_offset_ma,
                );
                IDLE_BIAS_RESULT.signal(true);
                continue;
            };

            calibration.correction_enabled = enabled;
            match provisioning::store_idle_bias_calibration(
                telemetry_sampler.i2c_mut(),
                calibration,
            )
            .await
            {
                Ok(()) => {
                    idle_bias_calibration = Some(calibration);
                    let mut guard = api_state.lock().await;
                    let run = guard.idle_bias.run;
                    guard.idle_bias = idle_bias_api_snapshot(
                        idle_bias_calibration,
                        run,
                        guard.idle_bias.current_applied_offset_ma,
                    );
                    IDLE_BIAS_RESULT.signal(true);
                    info!(
                        "idle-bias: correction {} and saved to EEPROM U21",
                        if enabled { "enabled" } else { "disabled" }
                    );
                }
                Err(err) => {
                    IDLE_BIAS_RESULT.signal(false);
                    defmt::warn!(
                        "idle-bias: failed to save correction setting to EEPROM U21: {:?}",
                        defmt::Debug2Format(&err)
                    );
                }
            }
            button_fast_loop_until =
                Some(Instant::now() + Duration::from_millis(POWER_SWITCH_GUARD_MS));
        }
        net::ApiIdleBiasCommand::Clear => {
            match provisioning::clear_idle_bias_calibration(telemetry_sampler.i2c_mut()).await {
                Ok(()) => {
                    idle_bias_calibration = None;
                    let mut guard = api_state.lock().await;
                    guard.idle_bias = idle_bias_api_snapshot(
                        idle_bias_calibration,
                        net::ApiIdleBiasRunSnapshot::idle(),
                        None,
                    );
                    IDLE_BIAS_RESULT.signal(true);
                    info!("idle-bias: dataset cleared from EEPROM U21");
                }
                Err(err) => {
                    IDLE_BIAS_RESULT.signal(false);
                    defmt::warn!(
                        "idle-bias: failed to clear dataset from EEPROM U21: {:?}",
                        defmt::Debug2Format(&err)
                    );
                }
            }
            button_fast_loop_until =
                Some(Instant::now() + Duration::from_millis(POWER_SWITCH_GUARD_MS));
        }
        net::ApiIdleBiasCommand::Run => {
            let previous_calibration = idle_bias_calibration;
            let preserved_correction_enabled = previous_calibration
                .map(|calibration| calibration.correction_enabled)
                .unwrap_or(false);
            let previous_power_config = power_config;
            let previous_last_valid_sw2303_request = last_valid_sw2303_request;
            let previous_last_request = last_request;
            let previous_last_fast_protocol = last_fast_protocol;
            let previous_sw2303_stable_reads = sw2303_stable_reads;
            let previous_sw2303_profile_applied = sw2303_profile_applied;
            let previous_sw2303_readback_config = sw2303_readback_config;
            let previous_sw2303_recontract_pending = sw2303_recontract_pending;
            let previous_last_sw2303_path_control = last_sw2303_path_control;
            let mut sampled_offsets = [0u16; IDLE_BIAS_POINT_COUNT];
            let mut run_error = None;
            let mut completed_points = 0u8;
            let mut target_voltage_mv = Some(idle_bias_point_voltage_mv(0));

            info!(
                "idle-bias: starting USB-C empty-load calibration sweep points={} range={}..{} step={}mV",
                IDLE_BIAS_POINT_COUNT,
                idle_bias_point_voltage_mv(0),
                idle_bias_point_voltage_mv(IDLE_BIAS_POINT_COUNT - 1),
                500
            );

            if !matches!(port_usb_c.power, PowerState::On)
                || !sw2303_i2c_allowed
                || tps_error_latched
                || sw2303_error_latched
                || tps_5v_setpoint_since.is_none()
            {
                run_error = Some(net::ApiIdleBiasErrorCode::ControllerNotReady);
            }

            if run_error.is_none() {
                match read_power_request(&mut sw2303_i2c).await {
                    Ok(request) if idle_bias_attach_detected(request) => {
                        run_error = Some(net::ApiIdleBiasErrorCode::AttachDetected);
                    }
                    Ok(_) => {}
                    Err(err) => {
                        defmt::warn!(
                            "idle-bias: preflight power-request read failed: {:?}",
                            defmt::Debug2Format(&err)
                        );
                        run_error = Some(net::ApiIdleBiasErrorCode::ControllerNotReady);
                    }
                }
            }

            if run_error.is_none() {
                match set_path_control(&mut sw2303_i2c, Sw2303PathControl::ForceClose).await {
                    Ok(()) => {}
                    Err(err) => {
                        defmt::warn!(
                            "idle-bias: failed to force USB-C path closed: {:?}",
                            defmt::Debug2Format(&err)
                        );
                        run_error = Some(net::ApiIdleBiasErrorCode::ControllerNotReady);
                    }
                }
            }

            if run_error.is_none() {
                for index in 0..IDLE_BIAS_POINT_COUNT {
                    let point_voltage_mv = idle_bias_point_voltage_mv(index);
                    target_voltage_mv = Some(point_voltage_mv);
                    {
                        let mut guard = api_state.lock().await;
                        guard.idle_bias = idle_bias_api_snapshot(
                            previous_calibration,
                            net::ApiIdleBiasRunSnapshot {
                                state: net::ApiIdleBiasRunState::Running,
                                completed_points,
                                point_count: IDLE_BIAS_POINT_COUNT as u8,
                                target_voltage_mv,
                                error: None,
                            },
                            None,
                        );
                    }

                    match read_power_request(&mut sw2303_i2c).await {
                        Ok(request) if idle_bias_attach_detected(request) => {
                            run_error = Some(net::ApiIdleBiasErrorCode::AttachDetected);
                            break;
                        }
                        Ok(_) => {}
                        Err(err) => {
                            defmt::warn!(
                                "idle-bias: attach preflight failed at {}mV: {:?}",
                                point_voltage_mv,
                                defmt::Debug2Format(&err)
                            );
                            run_error = Some(net::ApiIdleBiasErrorCode::ControllerNotReady);
                            break;
                        }
                    }

                    let point_setpoint = PowerSetpoint {
                        output_enabled: true,
                        v_out_mv: point_voltage_mv,
                        i_lim_ma: clamp_manual_current_ma(
                            point_voltage_mv,
                            MANUAL_DEFAULT_CURRENT_MA,
                        ),
                    };

                    if let Err(err) =
                        apply_setpoint(telemetry_sampler.i2c_mut(), &mut tps_state, point_setpoint)
                            .await
                    {
                        tps_state.last = None;
                        defmt::warn!(
                            "idle-bias: TPS apply failed at {}mV: {:?}",
                            point_voltage_mv,
                            defmt::Debug2Format(&err)
                        );
                        run_error = Some(net::ApiIdleBiasErrorCode::ControllerNotReady);
                        break;
                    }

                    Timer::after_millis(IDLE_BIAS_SETTLE_WINDOW_MS).await;

                    let mut total_current_ma = 0u32;
                    for sample_index in 0..IDLE_BIAS_SAMPLE_COUNT {
                        match read_power_request(&mut sw2303_i2c).await {
                            Ok(request) if idle_bias_attach_detected(request) => {
                                run_error = Some(net::ApiIdleBiasErrorCode::AttachDetected);
                                break;
                            }
                            Ok(_) => {}
                            Err(err) => {
                                defmt::warn!(
                                    "idle-bias: attach recheck failed at {}mV sample {}: {:?}",
                                    point_voltage_mv,
                                    sample_index + 1,
                                    defmt::Debug2Format(&err)
                                );
                                run_error =
                                    Some(net::ApiIdleBiasErrorCode::ControllerNotReady);
                                break;
                            }
                        }

                        let telemetry = telemetry_sampler.sample().await;
                        match (telemetry.usb_c.voltage_mv, telemetry.usb_c.current_ma) {
                            (Field::Ok(_), Field::Ok(current_ma)) => {
                                total_current_ma =
                                    total_current_ma.saturating_add(current_ma);
                            }
                            _ => {
                                run_error =
                                    Some(net::ApiIdleBiasErrorCode::TelemetryUnavailable);
                                break;
                            }
                        }

                        if sample_index + 1 < IDLE_BIAS_SAMPLE_COUNT {
                            Timer::after_millis(IDLE_BIAS_SAMPLE_INTERVAL_MS).await;
                        }
                    }

                    if run_error.is_some() {
                        break;
                    }

                    sampled_offsets[index] =
                        average_current_ma(total_current_ma, IDLE_BIAS_SAMPLE_COUNT);
                    completed_points = completed_points.saturating_add(1);
                }
            }

            power_config = previous_power_config;
            last_valid_sw2303_request = previous_last_valid_sw2303_request;
            last_request = previous_last_request;
            last_fast_protocol = previous_last_fast_protocol;
            sw2303_stable_reads = previous_sw2303_stable_reads;
            sw2303_profile_applied = previous_sw2303_profile_applied;
            sw2303_readback_config = previous_sw2303_readback_config;
            sw2303_recontract_pending = previous_sw2303_recontract_pending;
            tps_state.last = None;
            last_sw2303_path_control = None;
            last_sw2303_read_attempt = None;

            let mut final_run_error = run_error;
            let next_calibration =
                IdleBiasCalibration::new(preserved_correction_enabled, sampled_offsets);

            let mut restore_error = false;
            let previous_usb_c_pd_power_on = matches!(port_usb_c.power, PowerState::On);
            let manual_vout_mv = quantize_manual_voltage_mv(power_config.manual.voltage_mv);

            if sw2303_i2c_allowed {
                let explicit_request_mv = last_valid_sw2303_request
                    .filter(|request| {
                        request.status_valid
                            && (request.negotiated_protocol.is_some()
                                || request.fast_protocol
                                || request.fast_voltage)
                    })
                    .map(|request| request.v_req_mv);
                let restored_path_control = previous_last_sw2303_path_control.unwrap_or_else(|| {
                    if previous_usb_c_pd_power_on && power_config.tps_mode == TpsMode::Manual {
                        resolve_manual_path_control(
                            power_config.manual.usb_c_path_mode,
                            manual_vout_mv,
                            explicit_request_mv,
                        )
                    } else {
                        Sw2303PathControl::Auto
                    }
                });

                match set_path_control(&mut sw2303_i2c, restored_path_control).await {
                    Ok(()) => {
                        last_sw2303_path_control = Some(restored_path_control);
                        info!(
                            "idle-bias: restored SW2303 path control to {}",
                            restored_path_control.as_str()
                        );
                    }
                    Err(err) => {
                        restore_error = true;
                        defmt::warn!(
                            "idle-bias: failed to restore SW2303 path control to {}: {:?}",
                            restored_path_control.as_str(),
                            defmt::Debug2Format(&err)
                        );
                    }
                }
            }

            let restored_setpoint = if !previous_usb_c_pd_power_on {
                PowerSetpoint {
                    output_enabled: false,
                    ..boot_sp
                }
            } else if power_config.tps_mode == TpsMode::Manual {
                PowerSetpoint {
                    output_enabled: true,
                    v_out_mv: manual_vout_mv,
                    i_lim_ma: power_config.manual.current_limit_ma,
                }
            } else if previous_sw2303_stable_reads >= SW2303_STABLE_READS_BEFORE_TPS {
                previous_last_valid_sw2303_request
                    .map(power_request_to_setpoint)
                    .unwrap_or(boot_sp)
            } else {
                boot_sp
            };

            if let Err(err) =
                apply_setpoint(telemetry_sampler.i2c_mut(), &mut tps_state, restored_setpoint)
                    .await
            {
                restore_error = true;
                tps_state.last = None;
                tps_5v_setpoint_since = None;
                defmt::warn!(
                    "idle-bias: failed to restore TPS output after calibration: {:?}",
                    defmt::Debug2Format(&err)
                );
            } else if restored_setpoint.output_enabled {
                tps_5v_setpoint_since = Some(Instant::now());
            } else {
                tps_5v_setpoint_since = None;
            }

            if restore_error && final_run_error.is_none() {
                final_run_error = Some(net::ApiIdleBiasErrorCode::ControllerNotReady);
            }

            if final_run_error.is_none() {
                match provisioning::store_idle_bias_calibration(
                    telemetry_sampler.i2c_mut(),
                    next_calibration,
                )
                .await
                {
                    Ok(()) => {
                        idle_bias_calibration = Some(next_calibration);
                        info!("idle-bias: calibration completed and saved to EEPROM U21");
                    }
                    Err(err) => {
                        final_run_error = Some(net::ApiIdleBiasErrorCode::EepromFailed);
                        defmt::warn!(
                            "idle-bias: failed to save dataset to EEPROM U21: {:?}",
                            defmt::Debug2Format(&err)
                        );
                    }
                }
            }

            let reported_last_sw2303_path_control = last_sw2303_path_control.or({
                if final_run_error.is_some() {
                    previous_last_sw2303_path_control
                } else {
                    None
                }
            });

            #[cfg(feature = "net_http")]
            {
                let mut guard = api_state.lock().await;
                guard.power.config = power_config;
                guard.power.persisted = power_config_persisted;
                guard.power.last_path_control = reported_last_sw2303_path_control;
                guard.idle_bias = if let Some(error) = final_run_error {
                    idle_bias_api_snapshot(
                        idle_bias_calibration,
                        net::ApiIdleBiasRunSnapshot {
                            state: net::ApiIdleBiasRunState::Failed,
                            completed_points,
                            point_count: IDLE_BIAS_POINT_COUNT as u8,
                            target_voltage_mv,
                            error: Some(error),
                        },
                        None,
                    )
                } else {
                    idle_bias_api_snapshot(
                        idle_bias_calibration,
                        net::ApiIdleBiasRunSnapshot::idle(),
                        None,
                    )
                };
            }

            if let Some(error) = final_run_error {
                IDLE_BIAS_RESULT.signal(false);
                defmt::warn!(
                    "idle-bias: calibration failed after {}/{} points code={}",
                    completed_points,
                    IDLE_BIAS_POINT_COUNT,
                    error.as_str()
                );
            } else {
                IDLE_BIAS_RESULT.signal(true);
            }

            button_fast_loop_until =
                Some(Instant::now() + Duration::from_millis(POWER_SWITCH_GUARD_MS));
        }
        }
    }
}
