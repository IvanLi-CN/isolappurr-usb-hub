{
        // TPS55288 fault change logging via shared INT (GPIO7).
        // Note: `STATUS` is read-to-clear, so only read/print on interrupt-driven changes.
        if sw2303_stable_reads >= SW2303_STABLE_READS_BEFORE_TPS_STATUS
            && TPS_INT_DIRTY.swap(false, Ordering::AcqRel)
        {
            let int_tps_low = critical_section::with(|cs| {
                TPS_INT
                    .borrow_ref_mut(cs)
                    .as_ref()
                    .map(|pin| pin.is_low())
                    .unwrap_or(false)
            });

            let status = {
                let mut dev = tps55288::Tps55288::with_address(
                    telemetry_sampler.i2c_mut(),
                    TPS55288_ADDR_7BIT,
                );
                dev.read_status().await
            };

            match status {
                Ok((operating, faults)) => {
                    if faults.short_circuit || faults.over_current || faults.over_voltage {
                        tps_5v_setpoint_since = None;
                    }
                    let changed = int_tps_low != last_tps_int_low
                        || last_tps_status != Some((operating, faults));
                    if changed {
                        info!(
                            "tps fault: int_low={} tps={:?} faults={:?}",
                            int_tps_low,
                            defmt::Debug2Format(&operating),
                            defmt::Debug2Format(&faults),
                        );
                        last_tps_int_low = int_tps_low;
                        last_tps_status = Some((operating, faults));
                    } else {
                        last_tps_int_low = int_tps_low;
                    }
                }
                Err(err) => {
                    if int_tps_low != last_tps_int_low || last_tps_status.is_some() {
                        defmt::warn!(
                            "tps fault: int_low={} read_status error: {:?}",
                            int_tps_low,
                            defmt::Debug2Format(&err)
                        );
                        last_tps_int_low = int_tps_low;
                        last_tps_status = None;
                    } else {
                        last_tps_int_low = int_tps_low;
                    }
                }
            }
        }

        // 2 Hz (500ms) UI tick. Keep PD loop behavior intact outside this path.
        if last_tick.elapsed() >= Duration::from_millis(500) {
            let ui_tick_now = Instant::now();
            last_tick = ui_tick_now;

            if ui.toast_active(ui_tick_now) {
                // Pause normal UI updates while an action toast is active.
                // Telemetry/PD loop continues unaffected.
            } else {
                let telemetry = telemetry_sampler.sample().await;

                // Presence rules (frozen spec):
                // - USB-A: if voltage is Ok(v_mv) and v_mv < 1000 => NotPresent; else Present (incl. read error).
                // - USB-C/PD: present when U17 has real voltage/current or SW2303 reports a real protocol.
                let usb_a_present = match telemetry.usb_a.voltage_mv {
                    Field::Ok(v_mv) if v_mv < 1_000 => false,
                    _ => true,
                };
                let usb_c_api_present = normal_ui_usb_c_present(
                    request,
                    telemetry.usb_c.voltage_mv,
                    telemetry.usb_c.current_ma,
                );
                let usb_c_display = resolve_usb_c_display(UsbCDisplayInput {
                    tps_mode: power_config.tps_mode,
                    manual_path_mode: power_config.manual.usb_c_path_mode,
                    manual_setpoint_mv: power_config.manual.voltage_mv,
                    tps_output_enabled: tps_state
                        .last
                        .map(|active_setpoint| active_setpoint.output_enabled)
                        .unwrap_or(setpoint.output_enabled),
                    request,
                    voltage_mv: telemetry.usb_c.voltage_mv,
                    current_ma: telemetry.usb_c.current_ma,
                });

                #[cfg(feature = "net_http")]
                {
                    api_usb_a_present = usb_a_present;
                    api_usb_c_present = usb_c_api_present;
                    api_usb_a_metrics = telemetry.usb_a;
                    api_usb_c_metrics = telemetry.usb_c;
                    api_sample_uptime_ms = uptime_ms_from_instant(ui_tick_now);
                }

                let snapshot = NormalUiSnapshot {
                    usb_a: NormalUiPort {
                        present: usb_a_present,
                        mode: NormalUiPortMode::UsbA,
                        badge: if usb_a_present {
                            NormalUiPortBadge::VoltageMv(5_000)
                        } else {
                            NormalUiPortBadge::Unknown
                        },
                        voltage_uv: telemetry_field_to_ui(telemetry.usb_a.voltage_mv),
                        current_ua: telemetry_field_to_ui(telemetry.usb_a.current_ma),
                        power_uw: telemetry_field_to_ui(telemetry.usb_a.power_mw),
                    },
                    usb_c: NormalUiPort {
                        present: usb_c_display.measurements_visible,
                        mode: usb_c_display.mode,
                        badge: usb_c_display.badge,
                        voltage_uv: telemetry_field_to_ui(telemetry.usb_c.voltage_mv),
                        current_ua: telemetry_field_to_ui(telemetry.usb_c.current_ma),
                        power_uw: telemetry_field_to_ui(telemetry.usb_c.power_mw),
                    },
                };

                if let Err(err) = ui.render_normal_ui(&snapshot).await {
                    if !ui_error_latched {
                        defmt::warn!(
                            "display: render error (continuing): {:?}",
                            defmt::Debug2Format(&err)
                        );
                        ui_error_latched = true;
                    }
                } else {
                    ui_error_latched = false;
                }

                if !ui_was_in_error && ui_error_latched {
                    prompt_tone.notify(SoundEvent::EnterError(ErrorKind::UiRender));
                } else if ui_was_in_error && !ui_error_latched {
                    prompt_tone.notify(SoundEvent::ExitError(ErrorKind::UiRender));
                }
            }
        }

        // Port state machine tick (data replug completion, busy windows, power/data invariants).
        let ports_now = Instant::now();
        if port_usb_a
            .busy_until
            .is_some_and(|until| ports_now >= until)
        {
            port_usb_a.busy_until = None;
        }
        if port_usb_c
            .busy_until
            .is_some_and(|until| ports_now >= until)
        {
            port_usb_c.busy_until = None;
        }

        #[cfg(feature = "net_http")]
        {
            let mut exec_a: Option<net::ApiPortAction> = None;
            let mut exec_c: Option<net::ApiPortAction> = None;

            {
                let mut guard = api_state.lock().await;

                if let Some(action) = guard.pending.port_a {
                    if !port_usb_a.is_busy(ports_now) {
                        guard.pending.port_a = None;
                        exec_a = Some(action);
                    }
                }

                if let Some(action) = guard.pending.port_c {
                    if !port_usb_c.is_busy(ports_now) {
                        guard.pending.port_c = None;
                        exec_c = Some(action);
                    }
                }
            }

            if let Some(action) = exec_a {
                match action {
                    net::ApiPortAction::Replug => {
                        port_usb_a.power = PowerState::On;
                        port_usb_a.data = DataState::Pulsing {
                            until: ports_now + Duration::from_millis(DATA_DISCONNECT_MS),
                        };
                        port_usb_a.busy_until =
                            Some(ports_now + Duration::from_millis(DATA_DISCONNECT_MS));
                        let _ = p1_en_n.set_low();
                        let _ = p1_ced.set_high();
                        let (lines, fg_raw) = toast_spec(ButtonId::Left, ToastId::DataOff);
                        let _ = ui
                            .show_toast(ports_now, lines, fg_raw, Duration::from_millis(TOAST_MS))
                            .await;
                        prompt_tone.notify(SoundEvent::ActionOk);
                    }
                    net::ApiPortAction::Power { enabled } => match (enabled, port_usb_a.power) {
                        (true, PowerState::On) | (false, PowerState::Off) => {}
                        (true, PowerState::Off) => {
                            port_usb_a.power = PowerState::On;
                            port_usb_a.data = DataState::Connected;
                            port_usb_a.busy_until =
                                Some(ports_now + Duration::from_millis(POWER_SWITCH_GUARD_MS));
                            let _ = p1_en_n.set_low();
                            let _ = p1_ced.set_low();
                            let (lines, fg_raw) = toast_spec(ButtonId::Left, ToastId::PwrOn);
                            let _ = ui
                                .show_toast(
                                    ports_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            prompt_tone.notify(SoundEvent::ActionOk);
                        }
                        (false, PowerState::On) => {
                            port_usb_a.power = PowerState::Off;
                            port_usb_a.data = DataState::Disconnected;
                            port_usb_a.busy_until =
                                Some(ports_now + Duration::from_millis(POWER_SWITCH_GUARD_MS));
                            let _ = p1_en_n.set_high();
                            let _ = p1_ced.set_high();
                            let (lines, fg_raw) = toast_spec(ButtonId::Left, ToastId::PwrOff);
                            let _ = ui
                                .show_toast(
                                    ports_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            prompt_tone.notify(SoundEvent::ActionOk);
                        }
                    },
                }
            }

            if let Some(action) = exec_c {
                match action {
                    net::ApiPortAction::Replug => {
                        let was_usb_c_power_off = matches!(port_usb_c.power, PowerState::Off);
                        port_usb_c.power = PowerState::On;
                        port_usb_c.data = DataState::Pulsing {
                            until: ports_now + Duration::from_millis(DATA_DISCONNECT_MS),
                        };
                        port_usb_c.busy_until =
                            Some(ports_now + Duration::from_millis(DATA_DISCONNECT_MS));
                        if was_usb_c_power_off {
                            tps_state.last = None;
                            tps_5v_setpoint_since = None;
                            sw2303_i2c_allowed = false;
                            sw2303_profile_applied = false;
                            sw2303_readback_config = Sw2303CapabilityReadback::unavailable();
                            sw2303_recontract_pending = false;
                            sw2303_stable_reads = 0;
                            sw2303_consecutive_errors = 0;
                            tps_consecutive_errors = 0;
                            last_sw2303_read_attempt = None;
                            last_sw2303_profile_attempt = None;
                            last_valid_sw2303_request = None;
                            last_request = None;
                            last_fast_protocol = None;
                            info!(
                                "usb-c replug: restarting PD coordinator from power-off state without CE_TPS hard cycle"
                            );
                        }
                        let _ = p2_ced.set_high();
                        let (lines, fg_raw) = toast_spec(ButtonId::Right, ToastId::DataOff);
                        let _ = ui
                            .show_toast(ports_now, lines, fg_raw, Duration::from_millis(TOAST_MS))
                            .await;
                        prompt_tone.notify(SoundEvent::ActionOk);
                    }
                    net::ApiPortAction::Power { enabled } => match (enabled, port_usb_c.power) {
                        (true, PowerState::On) | (false, PowerState::Off) => {}
                        (true, PowerState::Off) => {
                            port_usb_c.power = PowerState::On;
                            port_usb_c.data = DataState::Connected;
                            port_usb_c.busy_until =
                                Some(ports_now + Duration::from_millis(USB_C_PD_RESTART_GUARD_MS));
                            tps_state.last = None;
                            tps_5v_setpoint_since = None;
                            sw2303_i2c_allowed = false;
                            sw2303_profile_applied = false;
                            sw2303_readback_config = Sw2303CapabilityReadback::unavailable();
                            sw2303_recontract_pending = false;
                            sw2303_stable_reads = 0;
                            sw2303_consecutive_errors = 0;
                            tps_consecutive_errors = 0;
                            last_sw2303_read_attempt = None;
                            last_sw2303_profile_attempt = None;
                            last_valid_sw2303_request = None;
                            last_request = None;
                            last_fast_protocol = None;
                            info!(
                                "usb-c power: re-enable requested; restarting PD coordinator without CE_TPS hard cycle"
                            );
                            let _ = p2_ced.set_low();
                            let (lines, fg_raw) = toast_spec(ButtonId::Right, ToastId::PwrOn);
                            let _ = ui
                                .show_toast(
                                    ports_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            prompt_tone.notify(SoundEvent::ActionOk);
                        }
                        (false, PowerState::On) => {
                            port_usb_c.busy_until =
                                Some(ports_now + Duration::from_millis(POWER_SWITCH_GUARD_MS));
                            match apply_setpoint(
                                telemetry_sampler.i2c_mut(),
                                &mut tps_state,
                                usb_c_power_off_setpoint,
                            )
                            .await
                            {
                                Ok(()) => {
                                    port_usb_c.power = PowerState::Off;
                                    tps_error_latched = false;
                                    tps_consecutive_errors = 0;
                                    tps_5v_setpoint_since = None;
                                    info!(
                                        "usb-c power: TPS output disabled via OE; CE_TPS left released"
                                    );
                                }
                                Err(err) => {
                                    if !tps_error_latched {
                                        defmt::warn!(
                                            "usb-c power: TPS OE disable failed; keeping USB-C power state on and CE_TPS released for coordinator recovery: {:?}",
                                            defmt::Debug2Format(&err)
                                        );
                                        tps_error_latched = true;
                                    }
                                    tps_consecutive_errors =
                                        tps_consecutive_errors.saturating_add(1);
                                    tps_state.last = None;
                                }
                            }
                            let toast = if matches!(port_usb_c.power, PowerState::Off) {
                                ToastId::PwrOff
                            } else {
                                ToastId::PwrFail
                            };
                            let (lines, fg_raw) = toast_spec(ButtonId::Right, toast);
                            let _ = ui
                                .show_toast(
                                    ports_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            if matches!(port_usb_c.power, PowerState::Off) {
                                prompt_tone.notify(SoundEvent::ActionOk);
                            } else {
                                prompt_tone.notify(SoundEvent::ActionFail);
                            }
                        }
                    },
                }
            }
        }

        // USB-A invariants: P1_CED drives CH442E EN# (low=connected, high=disconnected).
        match port_usb_a.power {
            PowerState::On => {
                let _ = p1_en_n.set_low();
                match port_usb_a.data {
                    DataState::Connected => {
                        let _ = p1_ced.set_low();
                    }
                    DataState::Disconnected => {
                        let _ = p1_ced.set_high();
                    }
                    DataState::Pulsing { until } => {
                        if ports_now >= until {
                            port_usb_a.data = DataState::Connected;
                            port_usb_a.busy_until = None;
                            let _ = p1_ced.set_low();
                            let (lines, fg_raw) = toast_spec(ButtonId::Left, ToastId::DataOn);
                            let _ = ui
                                .show_toast(
                                    ports_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                        } else {
                            let _ = p1_ced.set_high();
                        }
                    }
                }
            }
            PowerState::Off => {
                port_usb_a.data = DataState::Disconnected;
                let _ = p1_en_n.set_high();
                let _ = p1_ced.set_high();
            }
        }

        // USB-C invariants: P2_CED drives CH442E EN# (low=connected, high=disconnected).
        // CE_TPS is reserved for boot/recovery; routine port power uses TPS OE.
        // Keep the data route independent from TPS OE so USB JSONL can turn
        // USB-C power back on after a controlled output-off test.
        match port_usb_c.data {
            DataState::Connected => {
                let _ = p2_ced.set_low();
            }
            DataState::Disconnected => {
                let _ = p2_ced.set_high();
            }
            DataState::Pulsing { until } => {
                if ports_now >= until {
                    port_usb_c.data = DataState::Connected;
                    port_usb_c.busy_until = None;
                    let _ = p2_ced.set_low();
                    let (lines, fg_raw) = toast_spec(ButtonId::Right, ToastId::DataOn);
                    let _ = ui
                        .show_toast(ports_now, lines, fg_raw, Duration::from_millis(TOAST_MS))
                        .await;
                } else {
                    let _ = p2_ced.set_high();
                }
            }
        }

}
