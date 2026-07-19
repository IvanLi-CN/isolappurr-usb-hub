{
        // Button handling: stable press/release with duration classification.
        let buttons_now = Instant::now();
        let raw_left_pressed = btn_left.is_low();
        let raw_right_pressed = btn_right.is_low();
        if raw_left_pressed != btn_raw_left_pressed || raw_right_pressed != btn_raw_right_pressed {
            btn_raw_left_pressed = raw_left_pressed;
            btn_raw_right_pressed = raw_right_pressed;
            info!(
                "buttons: raw left_pressed={} right_pressed={}",
                raw_left_pressed, raw_right_pressed
            );
        }

        let left_edge = btn_left_state.update(buttons_now, raw_left_pressed, btn_debounce);
        let right_edge = btn_right_state.update(buttons_now, raw_right_pressed, btn_debounce);

        #[cfg(feature = "net_http")]
        let left_pressed = btn_left_state.is_pressed();
        #[cfg(feature = "net_http")]
        let right_pressed = btn_right_state.is_pressed();
        #[cfg(feature = "net_http")]
        if settings_menu_until.is_some_and(|until| buttons_now >= until) {
            settings_menu_until = None;
            settings_menu_view = SettingsMenuView::Main;
            ui.clear_toast();
        }

        #[cfg(feature = "net_http")]
        let settings_menu_active = settings_menu_until.is_some_and(|until| buttons_now < until);

        // Combo: long press opens the settings menu; in-menu short combo selects.
        // Holding >5s is invalid ("expired") and does nothing.
        #[cfg(feature = "net_http")]
        if !combo_active && left_pressed && right_pressed {
            combo_active = true;
            combo_pressed_at = Some(buttons_now);
            combo_done = false;
            combo_expired = false;
        }

        #[cfg(feature = "net_http")]
        if combo_active && left_pressed && right_pressed {
            if let Some(since) = combo_pressed_at {
                if buttons_now - since > PRESS_LONG_MAX {
                    combo_expired = true;
                } else if !settings_menu_active
                    && !combo_done
                    && buttons_now - since >= PRESS_LONG_MIN
                {
                    settings_menu_selected = SettingsMenuItem::Mode;
                    settings_menu_until =
                        Some(buttons_now + Duration::from_millis(SETTINGS_MENU_MS));
                    let _ = ui
                        .show_settings_menu(
                            buttons_now,
                            settings_menu_selected.index(),
                            Duration::from_millis(SETTINGS_MENU_MS),
                        )
                        .await;
                    prompt_tone.notify(SoundEvent::MenuConfirm);
                    combo_done = true;
                }
            }
        }

        #[cfg(feature = "net_http")]
        if combo_active && (!left_pressed || !right_pressed) && !combo_done {
            if let Some(since) = combo_pressed_at {
                let duration = buttons_now - since;
                if !combo_expired && settings_menu_active {
                    if duration >= PRESS_SHORT_MIN && duration <= PRESS_SHORT_MAX {
                        match settings_menu_selected {
                            SettingsMenuItem::Mode => match settings_menu_view {
                                SettingsMenuView::Main => {
                                    settings_menu_view = SettingsMenuView::ModeDetail;
                                    settings_menu_until =
                                        Some(buttons_now + Duration::from_millis(SETTINGS_MENU_MS));
                                    let mut lines = [*b"                    "; 3];
                                    copy_compact_line(
                                        &mut lines[0],
                                        route_current_label(usb_c_downstream_route),
                                    );
                                    copy_compact_line(
                                        &mut lines[1],
                                        route_mode_label(usb_c_downstream_route),
                                    );
                                    copy_compact_line(&mut lines[2], "PRESS AGAIN TO SET");
                                    let _ = ui
                                        .show_lines_card(
                                            buttons_now,
                                            route_detail_title(usb_c_downstream_route),
                                            &lines,
                                            TOAST_INFO_RAW,
                                            Duration::from_millis(SETTINGS_MENU_MS),
                                        )
                                        .await;
                                    prompt_tone.notify(SoundEvent::MenuConfirm);
                                }
                                SettingsMenuView::ModeDetail => {
                                    let pending_busy = {
                                        let guard = api_state.lock().await;
                                        guard.pending.usb_c_downstream_route.is_some()
                                    };
                                    if port_usb_c.is_busy(buttons_now) || pending_busy {
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::Busy);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionFail);
                                    } else {
                                        let next_route = match usb_c_downstream_route {
                                            provisioning::UsbCDownstreamRoute::Mcu => {
                                                provisioning::UsbCDownstreamRoute::UsbC
                                            }
                                            provisioning::UsbCDownstreamRoute::UsbC => {
                                                provisioning::UsbCDownstreamRoute::Mcu
                                            }
                                        };
                                        {
                                            let mut guard = api_state.lock().await;
                                            guard.pending.usb_c_downstream_route = Some(next_route);
                                        }
                                        prompt_tone.notify(SoundEvent::MenuConfirm);
                                        settings_menu_until = None;
                                        settings_menu_view = SettingsMenuView::Main;
                                        button_fast_loop_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                    }
                                }
                                _ => {}
                            },
                            SettingsMenuItem::PowerPreset => match settings_menu_view {
                                SettingsMenuView::Main => {
                                    settings_menu_view = SettingsMenuView::PowerPresetDetail;
                                    settings_menu_until =
                                        Some(buttons_now + Duration::from_millis(SETTINGS_MENU_MS));
                                    let lines = power_preset_lines(power_config);
                                    let _ = ui
                                        .show_lines_card(
                                            buttons_now,
                                            "POWER PRESET",
                                            &lines,
                                            TOAST_INFO_RAW,
                                            Duration::from_millis(SETTINGS_MENU_MS),
                                        )
                                        .await;
                                    prompt_tone.notify(SoundEvent::MenuConfirm);
                                }
                                SettingsMenuView::PowerPresetDetail => {
                                    match net::try_set_power_config(
                                        api_state,
                                        net::ApiPowerConfigCommand::Defaults,
                                        None,
                                    )
                                    .await
                                    {
                                        Ok(()) => {
                                            let _ = ui
                                                .show_message_card(
                                                    buttons_now,
                                                    "POWER PRESET",
                                                    "FULL AUTO PENDING",
                                                    "EEPROM SAVE",
                                                    TOAST_OK_RAW,
                                                    Duration::from_millis(TOAST_MS),
                                                )
                                                .await;
                                            prompt_tone.notify(SoundEvent::MenuConfirm);
                                            settings_menu_until = None;
                                            settings_menu_view = SettingsMenuView::Main;
                                            button_fast_loop_until = Some(
                                                buttons_now
                                                    + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                            );
                                        }
                                        Err(_) => {
                                            let (lines, fg_raw) =
                                                toast_spec(ButtonId::Right, ToastId::Busy);
                                            let _ = ui
                                                .show_toast(
                                                    buttons_now,
                                                    lines,
                                                    fg_raw,
                                                    Duration::from_millis(TOAST_MS),
                                                )
                                                .await;
                                            prompt_tone.notify(SoundEvent::ActionFail);
                                        }
                                    }
                                }
                                _ => {}
                            },
                            SettingsMenuItem::PowerAdvanced => match settings_menu_view {
                                SettingsMenuView::Main => {
                                    settings_menu_view = SettingsMenuView::PowerAdvancedDetail;
                                    settings_menu_until =
                                        Some(buttons_now + Duration::from_millis(SETTINGS_MENU_MS));
                                    let lines = power_advanced_lines(power_config);
                                    let _ = ui
                                        .show_lines_card(
                                            buttons_now,
                                            "POWER ADV",
                                            &lines,
                                            TOAST_INFO_RAW,
                                            Duration::from_millis(SETTINGS_MENU_MS),
                                        )
                                        .await;
                                    prompt_tone.notify(SoundEvent::MenuConfirm);
                                }
                                SettingsMenuView::PowerAdvancedDetail => {
                                    let next_config = toggled_power_mode_config(power_config);
                                    match net::try_set_power_config(
                                        api_state,
                                        net::ApiPowerConfigCommand::Set {
                                            config: next_config,
                                        },
                                        None,
                                    )
                                    .await
                                    {
                                        Ok(()) => {
                                            let next_label = match next_config.tps_mode {
                                                TpsMode::AutoFollow => "AUTO FOLLOW PENDING",
                                                TpsMode::Manual => "MANUAL TPS PENDING",
                                            };
                                            let _ = ui
                                                .show_message_card(
                                                    buttons_now,
                                                    "POWER ADV",
                                                    next_label,
                                                    "EEPROM SAVE",
                                                    TOAST_OK_RAW,
                                                    Duration::from_millis(TOAST_MS),
                                                )
                                                .await;
                                            prompt_tone.notify(SoundEvent::MenuConfirm);
                                            settings_menu_until = None;
                                            settings_menu_view = SettingsMenuView::Main;
                                            button_fast_loop_until = Some(
                                                buttons_now
                                                    + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                            );
                                        }
                                        Err(_) => {
                                            let (lines, fg_raw) =
                                                toast_spec(ButtonId::Right, ToastId::Busy);
                                            let _ = ui
                                                .show_toast(
                                                    buttons_now,
                                                    lines,
                                                    fg_raw,
                                                    Duration::from_millis(TOAST_MS),
                                                )
                                                .await;
                                            prompt_tone.notify(SoundEvent::ActionFail);
                                        }
                                    }
                                }
                                _ => {}
                            },
                            SettingsMenuItem::Wifi => {
                                let (short_device_id, ip) = if let Some(handles) = net_handles.as_ref() {
                                    let ip = {
                                        let state = handles.wifi_state.lock().await;
                                        state.ipv4
                                    };
                                    (Some(handles.device_names.short_device_id.as_str()), ip)
                                } else {
                                    (None, None)
                                };

                                let lines = net::format_network_toast_lines(short_device_id, ip);
                                let _ = ui
                                    .show_lines_card(
                                        buttons_now,
                                        "WIFI",
                                        &lines,
                                        TOAST_INFO_RAW,
                                        Duration::from_millis(SETTINGS_MENU_MS),
                                    )
                                    .await;
                                prompt_tone.notify(SoundEvent::MenuConfirm);
                                settings_menu_until = None;
                            }
                            SettingsMenuItem::About => {
                                let lines = about_toast_lines();
                                let _ = ui
                                    .show_lines_card(
                                        buttons_now,
                                        "ABOUT",
                                        &lines,
                                        TOAST_INFO_RAW,
                                        Duration::from_millis(SETTINGS_MENU_MS),
                                    )
                                    .await;
                                prompt_tone.notify(SoundEvent::MenuConfirm);
                                settings_menu_until = None;
                            }
                        };
                    }
                } else if !combo_expired && duration >= PRESS_LONG_MIN && duration <= PRESS_LONG_MAX
                {
                    settings_menu_selected = SettingsMenuItem::Mode;
                    settings_menu_until =
                        Some(buttons_now + Duration::from_millis(SETTINGS_MENU_MS));
                    let _ = ui
                        .show_settings_menu(
                            buttons_now,
                            settings_menu_selected.index(),
                            Duration::from_millis(SETTINGS_MENU_MS),
                        )
                        .await;
                    prompt_tone.notify(SoundEvent::MenuConfirm);
                } else if !combo_expired
                    && duration >= PRESS_SHORT_MIN
                    && duration <= PRESS_SHORT_MAX
                {
                    // Short combo is only meaningful inside the settings menu.
                } else if !combo_expired {
                    // Preserve invalid timing as a no-op for combo actions.
                }
            }
            combo_done = true;
        }

        let settings_menu_active = settings_menu_until.is_some_and(|until| buttons_now < until);

        if let Some(edge) = left_edge {
            match edge {
                ButtonEdge::Pressed => {
                    info!("button: left pressed");
                    btn_left_pressed_at = Some(buttons_now);
                    button_fast_loop_until = Some(buttons_now + PRESS_LONG_MAX);
                }
                ButtonEdge::Released => {
                    info!("button: left released");

                    if combo_active {
                        btn_left_pressed_at = None;
                    } else if settings_menu_active {
                        if let Some(pressed_at) = btn_left_pressed_at.take() {
                            if matches!(classify_press(buttons_now - pressed_at), PressClass::Short)
                            {
                                match settings_menu_view {
                                    SettingsMenuView::Main => {
                                        settings_menu_selected = settings_menu_selected.prev();
                                        settings_menu_until = Some(
                                            buttons_now + Duration::from_millis(SETTINGS_MENU_MS),
                                        );
                                        let _ = ui
                                            .show_settings_menu(
                                                buttons_now,
                                                settings_menu_selected.index(),
                                                Duration::from_millis(SETTINGS_MENU_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::MenuNavigate);
                                    }
                                    _ => {
                                        settings_menu_until = Some(
                                            buttons_now + Duration::from_millis(SETTINGS_MENU_MS),
                                        );
                                    }
                                }
                            }
                        }
                    } else {
                        let Some(pressed_at) = btn_left_pressed_at.take() else {
                            // Ignore unmatched releases.
                            continue;
                        };
                        let class = classify_press(buttons_now - pressed_at);

                        let rejected = match class {
                            PressClass::Invalid => Some(ToastId::BadTime),
                            _ if port_usb_a.is_busy(buttons_now) => Some(ToastId::Busy),
                            _ => None,
                        };

                        if let Some(reject_toast) = rejected {
                            let (lines, fg_raw) = toast_spec(ButtonId::Left, reject_toast);
                            let _ = ui
                                .show_toast(
                                    buttons_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            prompt_tone.notify(SoundEvent::ActionFail);
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(250));
                        } else {
                            match class {
                                PressClass::Short => match port_usb_a.power {
                                    PowerState::Off => {
                                        port_usb_a.power = PowerState::On;
                                        port_usb_a.data = DataState::Connected;
                                        port_usb_a.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = p1_en_n.set_low();
                                        let _ = p1_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::PwrOn);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_a.data = DataState::Pulsing {
                                            until: buttons_now
                                                + Duration::from_millis(DATA_DISCONNECT_MS),
                                        };
                                        port_usb_a.busy_until = Some(
                                            buttons_now + Duration::from_millis(DATA_DISCONNECT_MS),
                                        );
                                        let _ = p1_ced.set_high();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::DataOff);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                },
                                PressClass::Long => match port_usb_a.power {
                                    PowerState::Off => {
                                        port_usb_a.power = PowerState::On;
                                        port_usb_a.data = DataState::Connected;
                                        port_usb_a.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = p1_en_n.set_low();
                                        let _ = p1_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::PwrOn);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_a.power = PowerState::Off;
                                        port_usb_a.data = DataState::Disconnected;
                                        port_usb_a.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = p1_en_n.set_high();
                                        let _ = p1_ced.set_high();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::PwrOff);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                },
                                PressClass::Invalid => unreachable!("handled above"),
                            }
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(350));
                        }
                    }
                }
            }
        }

        if let Some(edge) = right_edge {
            match edge {
                ButtonEdge::Pressed => {
                    info!("button: right pressed");
                    btn_right_pressed_at = Some(buttons_now);
                    button_fast_loop_until = Some(buttons_now + PRESS_LONG_MAX);
                }
                ButtonEdge::Released => {
                    info!("button: right released");

                    if combo_active {
                        btn_right_pressed_at = None;
                    } else if settings_menu_active {
                        if let Some(pressed_at) = btn_right_pressed_at.take() {
                            if matches!(classify_press(buttons_now - pressed_at), PressClass::Short)
                            {
                                match settings_menu_view {
                                    SettingsMenuView::Main => {
                                        settings_menu_selected = settings_menu_selected.next();
                                        settings_menu_until = Some(
                                            buttons_now + Duration::from_millis(SETTINGS_MENU_MS),
                                        );
                                        let _ = ui
                                            .show_settings_menu(
                                                buttons_now,
                                                settings_menu_selected.index(),
                                                Duration::from_millis(SETTINGS_MENU_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::MenuNavigate);
                                    }
                                    _ => {
                                        settings_menu_until = Some(
                                            buttons_now + Duration::from_millis(SETTINGS_MENU_MS),
                                        );
                                    }
                                }
                            }
                        }
                    } else {
                        let Some(pressed_at) = btn_right_pressed_at.take() else {
                            continue;
                        };
                        let class = classify_press(buttons_now - pressed_at);

                        let rejected = match class {
                            PressClass::Invalid => Some(ToastId::BadTime),
                            _ if port_usb_c.is_busy(buttons_now) => Some(ToastId::Busy),
                            _ => None,
                        };

                        if let Some(reject_toast) = rejected {
                            let (lines, fg_raw) = toast_spec(ButtonId::Right, reject_toast);
                            let _ = ui
                                .show_toast(
                                    buttons_now,
                                    lines,
                                    fg_raw,
                                    Duration::from_millis(TOAST_MS),
                                )
                                .await;
                            prompt_tone.notify(SoundEvent::ActionFail);
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(250));
                        } else {
                            match class {
                                PressClass::Short => match port_usb_c.power {
                                    PowerState::Off => {
                                        port_usb_c.power = PowerState::On;
                                        port_usb_c.data = DataState::Connected;
                                        port_usb_c.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(USB_C_PD_RESTART_GUARD_MS),
                                        );
                                        tps_state.last = None;
                                        tps_5v_setpoint_since = None;
                                        sw2303_i2c_allowed = false;
                                        sw2303_profile_applied = false;
                                        sw2303_readback_config =
                                            Sw2303CapabilityReadback::unavailable();
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
                                            "usb-c power: button re-enable requested; restarting PD coordinator without CE_TPS hard cycle"
                                        );
                                        let _ = p2_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::PwrOn);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_c.data = DataState::Pulsing {
                                            until: buttons_now
                                                + Duration::from_millis(DATA_DISCONNECT_MS),
                                        };
                                        port_usb_c.busy_until = Some(
                                            buttons_now + Duration::from_millis(DATA_DISCONNECT_MS),
                                        );
                                        let _ = p2_ced.set_high();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::DataOff);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                },
                                PressClass::Long => match port_usb_c.power {
                                    PowerState::Off => {
                                        port_usb_c.power = PowerState::On;
                                        port_usb_c.data = DataState::Connected;
                                        port_usb_c.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(USB_C_PD_RESTART_GUARD_MS),
                                        );
                                        tps_state.last = None;
                                        tps_5v_setpoint_since = None;
                                        sw2303_i2c_allowed = false;
                                        sw2303_profile_applied = false;
                                        sw2303_readback_config =
                                            Sw2303CapabilityReadback::unavailable();
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
                                            "usb-c power: button re-enable requested; restarting PD coordinator without CE_TPS hard cycle"
                                        );
                                        let _ = p2_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::PwrOn);
                                        let _ = ui
                                            .show_toast(
                                                buttons_now,
                                                lines,
                                                fg_raw,
                                                Duration::from_millis(TOAST_MS),
                                            )
                                            .await;
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_c.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
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
                                                buttons_now,
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
                                PressClass::Invalid => unreachable!("handled above"),
                            }
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(350));
                        }
                    }
                }
            }
        }

        #[cfg(feature = "net_http")]
        if combo_active && !left_pressed && !right_pressed {
            combo_active = false;
            combo_pressed_at = None;
            combo_done = false;
            combo_expired = false;
        }

        #[cfg(feature = "net_http")]
        {
            let now = Instant::now();
            let usb_c_display = resolve_usb_c_display(UsbCDisplayInput {
                tps_mode: power_config.tps_mode,
                manual_path_mode: power_config.manual.usb_c_path_mode,
                manual_setpoint_mv: power_config.manual.voltage_mv,
                tps_output_enabled: tps_state
                    .last
                    .map(|active_setpoint| active_setpoint.output_enabled)
                    .unwrap_or(setpoint.output_enabled),
                port_power_enabled: port_usb_c.power == PowerState::On,
                request,
                voltage_mv: api_usb_c_metrics.voltage_mv,
                current_ma: api_usb_c_metrics.current_ma,
            });

            let ports = net::ApiPortsSnapshot {
                port_a: net::ApiPortSnapshot {
                    telemetry: port_metrics_to_api_telemetry(
                        api_usb_a_present,
                        api_usb_a_metrics,
                        api_sample_uptime_ms,
                    ),
                    telemetry_raw: None,
                    state: net::ApiPortState {
                        power_enabled: port_usb_a.power == PowerState::On,
                        data_connected: matches!(port_usb_a.data, DataState::Connected),
                        replugging: matches!(port_usb_a.data, DataState::Pulsing { .. }),
                        busy: port_usb_a.is_busy(now),
                    },
                },
                port_c: net::ApiPortSnapshot {
                    telemetry: port_metrics_to_api_telemetry(
                        api_usb_c_present,
                        api_usb_c_metrics,
                        api_sample_uptime_ms,
                    ),
                    telemetry_raw: Some(port_metrics_to_api_telemetry(
                        api_usb_c_present,
                        api_usb_c_metrics_raw,
                        api_sample_uptime_ms,
                    )),
                    state: net::ApiPortState {
                        power_enabled: port_usb_c.power == PowerState::On,
                        data_connected: matches!(port_usb_c.data, DataState::Connected),
                        replugging: matches!(port_usb_c.data, DataState::Pulsing { .. }),
                        busy: port_usb_c.is_busy(now),
                    },
                },
            };

            let current_tps_setpoint_output_enabled =
                tps_state.last.map(|setpoint| setpoint.output_enabled);
            let current_tps_setpoint_discharge_enabled =
                tps_state.last.map(|setpoint| setpoint.discharge_enabled);
            let current_tps_setpoint_mv = tps_state.last.map(|setpoint| setpoint.v_out_mv as u32);
            let current_tps_setpoint_iout_limit_ma =
                tps_state.last.map(|setpoint| setpoint.i_lim_ma as u32);

            let (
                previous_tps_setpoint_output_enabled,
                previous_tps_setpoint_mv,
                previous_tps_setpoint_iout_limit_ma,
                previous_tps_iout_limit_readback_ma,
                previous_tps_iout_limit_readback_enabled,
            ) = {
                let guard = api_state.lock().await;
                (
                    guard.pd.tps_setpoint_output_enabled,
                    guard.pd.tps_setpoint_mv,
                    guard.pd.tps_setpoint_iout_limit_ma,
                    guard.pd.tps_iout_limit_readback_ma,
                    guard.pd.tps_iout_limit_readback_enabled,
                )
            };

            let tps_setpoint_changed =
                previous_tps_setpoint_output_enabled != current_tps_setpoint_output_enabled
                    || previous_tps_setpoint_mv != current_tps_setpoint_mv
                    || previous_tps_setpoint_iout_limit_ma != current_tps_setpoint_iout_limit_ma;

            let now_uptime_ms = uptime_ms_from_instant(now);
            let refresh_tps_iout_limit_readback =
                isolapurr_usb_hub::pd_i2c::tps55288::should_refresh_iout_limit_readback(
                    current_tps_setpoint_output_enabled.is_some(),
                    tps_setpoint_changed,
                    previous_tps_iout_limit_readback_ma.is_some()
                        && previous_tps_iout_limit_readback_enabled.is_some(),
                    last_tps_iout_limit_readback_attempt_uptime_ms,
                    now_uptime_ms,
                );
            let (tps_iout_limit_readback_ma, tps_iout_limit_readback_enabled) =
                if current_tps_setpoint_output_enabled.is_none() {
                    (None, None)
                } else if refresh_tps_iout_limit_readback {
                    last_tps_iout_limit_readback_attempt_uptime_ms = Some(now_uptime_ms);
                    match isolapurr_usb_hub::pd_i2c::tps55288::read_iout_limit(
                        telemetry_sampler.i2c_mut(),
                    )
                    .await
                    {
                        Ok((ma, enabled)) => (Some(ma as u32), Some(enabled)),
                        Err(_) => (None, None),
                    }
                } else {
                    (
                        previous_tps_iout_limit_readback_ma,
                        previous_tps_iout_limit_readback_enabled,
                    )
                };
            api_thermal = thermal_controller.telemetry(power_config.capability.power_watts);
            let mut api_effective_power_config = power_config;
            api_effective_power_config.capability.power_watts = api_thermal.effective_power_watts;

            let mut guard = api_state.lock().await;
            let idle_bias_run = guard.idle_bias.run;
            let previous_reported_path_control = guard.power.last_path_control;
            guard.hub = net::ApiHubSnapshot {
                upstream_connected: api_isolated_usb_ready,
                isolated_usb_fault: api_isolated_usb_fault,
                isolated_downstream_connected: !api_isolated_usb_fault,
                isolated_usb_ready: api_isolated_usb_ready,
                usb_c_downstream_route,
                usb_c_downstream_persisted,
            };
            guard.ports = ports;
            guard.pd = net::ApiPdSnapshot {
                usb_c_power_enabled: matches!(port_usb_c.power, PowerState::On),
                sw2303_i2c_allowed,
                sw2303_profile_applied,
                sw2303_stable_reads: sw2303_stable_reads as u32,
                sw2303_error_latched,
                tps_error_latched,
                sw2303_readback_config,
                sw2303_readback_matches_config: sw2303_readback_config
                    .matches_config(&api_effective_power_config),
                sw2303_request_mv: request.map(|request| request.v_req_mv as u32),
                sw2303_request_ma: request.map(|request| request.i_req_ma as u32),
                sw2303_vbus_mv: request.and_then(|request| request.vbus_mv),
                sw2303_last_valid_mv: last_valid_sw2303_request
                    .map(|request| request.v_req_mv as u32),
                sw2303_last_valid_ma: last_valid_sw2303_request
                    .map(|request| request.i_req_ma as u32),
                active_protocol: api_active_protocol(request),
                usb_c_display_mode: usb_c_display.mode,
                usb_c_display_badge: usb_c_display.badge,
                usb_c_display_measurements_visible: usb_c_display.measurements_visible,
                usb_c_actual: port_metrics_to_api_telemetry(
                    api_usb_c_present,
                    api_usb_c_metrics_raw,
                    api_sample_uptime_ms,
                ),
                tps_setpoint_output_enabled: current_tps_setpoint_output_enabled,
                tps_setpoint_discharge_enabled: current_tps_setpoint_discharge_enabled,
                tps_setpoint_mv: current_tps_setpoint_mv,
                tps_setpoint_iout_limit_ma: current_tps_setpoint_iout_limit_ma,
                tps_iout_limit_readback_ma,
                tps_iout_limit_readback_enabled,
                thermal: api_thermal,
                runtime_recovery_count: pd_runtime_recovery_count,
                sample_uptime_ms: uptime_ms_from_instant(now),
            };
            guard.idle_bias = idle_bias_api_snapshot(
                idle_bias_calibration,
                idle_bias_run,
                current_applied_idle_bias_offset_ma(idle_bias_calibration, api_usb_c_metrics_raw),
            );
            if let Some(lock) = guard.power.lock {
                if lock.expires_at_ms <= uptime_ms_from_instant(now) {
                    guard.power.lock = None;
                }
            }
            guard.power.config = power_config;
            guard.power.persisted = power_config_persisted;
            guard.power.runtime_output_enabled = runtime_tps_output_enabled_reported;
            guard.power.runtime_discharge_enabled =
                runtime_tps_discharge_enabled_reported;
            guard.power.last_path_control = last_sw2303_path_control.or({
                if idle_bias_run.state == net::ApiIdleBiasRunState::Failed {
                    previous_reported_path_control
                } else {
                    None
                }
            });
        }

        let now_us = esp_hal::time::Instant::now()
            .duration_since_epoch()
            .as_micros();
        let now = core::time::Duration::from_micros(now_us);
        prompt_tone.tick(now);

        if button_fast_loop_until.is_some_and(|until| Instant::now() < until) {
            loop_delay_ms = loop_delay_ms.min(10);
        } else {
            button_fast_loop_until = None;
        }

        Timer::after_millis(loop_delay_ms).await;
}
