{
    if last_thermal_sample_at
        .map(|sampled_at| sampled_at.elapsed() >= Duration::from_millis(THERMAL_SAMPLE_INTERVAL_MS))
        .unwrap_or(true)
    {
        let thermal_sample_now = Instant::now();
        let mcu_temperature_celsius = mcu_temperature_sensor.get_temperature().to_celsius();
        let mcu_temp_deci_c = if mcu_temperature_celsius >= 0.0 {
            (mcu_temperature_celsius * 10.0 + 0.5) as i16
        } else {
            (mcu_temperature_celsius * 10.0 - 0.5) as i16
        };
        let tmp112_temp_deci_c = telemetry_sampler.sample_tmp112_temperature_deci_c().await.ok();
        thermal_controller.update(
            Some(mcu_temp_deci_c),
            tmp112_temp_deci_c,
            uptime_ms_from_instant(thermal_sample_now),
        );
        last_thermal_sample_at = Some(thermal_sample_now);
    }
    #[cfg(feature = "net_http")]
    {
        let pending_power_runtime = if power_runtime_result_inflight {
            None
        } else {
            let guard = api_state.lock().await;
            guard.pending.power_runtime
        };

        if let Some(command) = pending_power_runtime {
            match command {
                net::ApiPowerRuntimeCommand::SetOutputEnabled { enabled } => {
                    if enabled {
                        if thermal_controller.state() == ThermalState::RearmRequired {
                            if !thermal_controller.try_acknowledge_rearm() {
                                let mut guard = api_state.lock().await;
                                guard.pending.power_runtime = None;
                                POWER_RUNTIME_RESULT.signal(false);
                                continue;
                            }
                        } else if thermal_controller.state().requires_output_off() {
                            let mut guard = api_state.lock().await;
                            guard.pending.power_runtime = None;
                            POWER_RUNTIME_RESULT.signal(false);
                            continue;
                        }
                    }
                    let output_runtime_applied = runtime_tps_output_enabled_reported == enabled;
                    if runtime_tps_output_enabled != enabled || !output_runtime_applied {
                        runtime_tps_output_enabled = enabled;
                        tps_state.last = None;
                        tps_5v_setpoint_since = None;
                        sw2303_i2c_allowed = false;
                        sw2303_profile_applied = false;
                        sw2303_readback_config = Sw2303CapabilityReadback::unavailable();
                        sw2303_recontract_pending = false;
                        last_sw2303_profile_attempt = None;
                        last_sw2303_path_control = None;
                        last_sw2303_line_compensation = None;
                        last_tps_cdc_rise = None;
                        sw2303_stable_reads = 0;
                        sw2303_consecutive_errors = 0;
                        tps_consecutive_errors = 0;
                        sw2303_error_latched = false;
                        tps_error_latched = false;
                        last_sw2303_read_attempt = None;
                        last_valid_sw2303_request = None;
                        last_request = None;
                        last_fast_protocol = None;
                        last_tps_status = None;
                        power_runtime_result_inflight = true;
                    } else {
                        let mut guard = api_state.lock().await;
                        guard.pending.power_runtime = None;
                        guard.power.runtime_output_enabled = runtime_tps_output_enabled_reported;
                        guard.power.runtime_discharge_enabled =
                            runtime_tps_discharge_enabled_reported;
                        POWER_RUNTIME_RESULT.signal(true);
                    }
                }
                net::ApiPowerRuntimeCommand::SetDischargeEnabled { enabled } => {
                    let discharge_runtime_applied =
                        runtime_tps_discharge_enabled_reported == enabled;
                    if runtime_tps_output_enabled {
                        runtime_tps_discharge_enabled = enabled;
                        runtime_tps_discharge_enabled_reported = enabled;
                        let mut guard = api_state.lock().await;
                        guard.pending.power_runtime = None;
                        guard.power.runtime_output_enabled = runtime_tps_output_enabled_reported;
                        guard.power.runtime_discharge_enabled =
                            runtime_tps_discharge_enabled_reported;
                        POWER_RUNTIME_RESULT.signal(true);
                    } else if runtime_tps_discharge_enabled != enabled
                        || !discharge_runtime_applied
                    {
                        runtime_tps_discharge_enabled = enabled;
                        tps_state.last = None;
                        power_runtime_result_inflight = true;
                    } else {
                        let mut guard = api_state.lock().await;
                        guard.pending.power_runtime = None;
                        guard.power.runtime_output_enabled = runtime_tps_output_enabled_reported;
                        guard.power.runtime_discharge_enabled =
                            runtime_tps_discharge_enabled_reported;
                        POWER_RUNTIME_RESULT.signal(true);
                    }
                }
            }
        }
    }
    if thermal_controller.state().requires_output_off() && runtime_tps_output_enabled {
        runtime_tps_output_enabled = false;
        tps_state.last = None;
        tps_5v_setpoint_since = None;
        sw2303_i2c_allowed = false;
        sw2303_profile_applied = false;
        sw2303_readback_config = Sw2303CapabilityReadback::unavailable();
        sw2303_recontract_pending = false;
        last_sw2303_profile_attempt = None;
        last_sw2303_path_control = None;
        last_sw2303_line_compensation = None;
        last_tps_cdc_rise = None;
        sw2303_stable_reads = 0;
        sw2303_consecutive_errors = 0;
        tps_consecutive_errors = 0;
        sw2303_error_latched = false;
        tps_error_latched = false;
        last_sw2303_read_attempt = None;
        last_valid_sw2303_request = None;
        last_request = None;
        last_fast_protocol = None;
        last_tps_status = None;
    }
    let thermal_effective_power_watts =
        thermal_controller.effective_power_watts(power_config.capability.power_watts);
    let mut effective_power_config = power_config;
    effective_power_config.capability.power_watts = thermal_effective_power_watts;
    if last_thermal_effective_power_watts != Some(thermal_effective_power_watts) {
        sw2303_profile_applied = false;
        sw2303_readback_config = Sw2303CapabilityReadback::unavailable();
        sw2303_recontract_pending = matches!(port_usb_c.power, PowerState::On);
        last_sw2303_profile_attempt = None;
        last_thermal_effective_power_watts = Some(thermal_effective_power_watts);
    }
    (thermal_effective_power_watts, effective_power_config)
}
