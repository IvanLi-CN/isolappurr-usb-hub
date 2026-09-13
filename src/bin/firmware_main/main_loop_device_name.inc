        #[cfg(feature = "net_http")]
        {
            let pending_device_name = {
                let mut guard = api_state.lock().await;
                let command = guard.pending.device_name.take();
                if command.is_some() {
                    guard.device_name_inflight = true;
                }
                command
            };
            if let Some(command) = pending_device_name {
                let result = match command {
                    net::ApiDeviceNameCommand::Set(name) => {
                        provisioning::store_device_display_name(
                            telemetry_sampler.i2c_mut(),
                            &name,
                        )
                        .await
                        .map(|_| Some(name))
                    }
                    net::ApiDeviceNameCommand::Clear => {
                        provisioning::clear_device_display_name(telemetry_sampler.i2c_mut())
                            .await
                            .map(|_| None)
                    }
                };
                match result {
                    Ok(name) => {
                        let mut guard = api_state.lock().await;
                        guard.device_display_name = name;
                        DEVICE_NAME_RESULT.signal(true);
                        info!("provisioning: device display name saved to EEPROM U21");
                    }
                    Err(err) => {
                        DEVICE_NAME_RESULT.signal(false);
                        defmt::warn!(
                            "provisioning: failed to save device display name to EEPROM U21: {:?}",
                            defmt::Debug2Format(&err)
                        );
                    }
                }
            }
        }
