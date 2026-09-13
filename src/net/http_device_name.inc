async fn handle_device_name_api_request(
    socket: &mut TcpSocket<'_>,
    method: &str,
    body: &str,
    allow_origin: Option<&str>,
    api_state: &'static ApiSharedMutex,
) -> Result<(), embassy_net::tcp::Error> {
    match method {
        "PUT" => {
            let Some(value) = extract_body_string(body, "name") else {
                write_api_error(socket, "400 Bad Request", allow_origin, "invalid_name", "name must be 1-48 UTF-8 bytes without controls or outer whitespace", false).await?;
                return Ok(());
            };
            let Some(name) = isolapurr_firmware_core::device_name::DeviceDisplayName::new(value.as_str()) else {
                write_api_error(socket, "400 Bad Request", allow_origin, "invalid_name", "name must be 1-48 UTF-8 bytes without controls or outer whitespace", false).await?;
                return Ok(());
            };
            match try_set_device_name(api_state, ApiDeviceNameCommand::Set(name)).await {
                Ok(()) => {
                    if crate::wait_device_name_result(api_state).await {
                        let mut response = String::new();
                        let _ = core::write!(response, "{{\"display_name\":");
                        write_json_string(&mut response, name.as_str());
                        let _ = response.push('}');
                        write_json_response(socket, "200 OK", allow_origin, response.as_str()).await?;
                    } else {
                        write_api_error(socket, "500 Internal Server Error", allow_origin, "eeprom_failed", "device display name could not be saved to EEPROM U21", true).await?;
                    }
                }
                Err(ApiActionError::Busy) => {
                    write_api_error(socket, "409 Conflict", allow_origin, "busy", "device display name is busy or locked", true).await?;
                }
            }
        }
        "DELETE" => match try_set_device_name(api_state, ApiDeviceNameCommand::Clear).await {
            Ok(()) => {
                if crate::wait_device_name_result(api_state).await {
                    write_json_response(socket, "200 OK", allow_origin, "{\"display_name\":null}").await?;
                } else {
                    write_api_error(socket, "500 Internal Server Error", allow_origin, "eeprom_failed", "device display name could not be cleared from EEPROM U21", true).await?;
                }
            }
            Err(ApiActionError::Busy) => {
                write_api_error(socket, "409 Conflict", allow_origin, "busy", "device display name is busy or locked", true).await?;
            }
        },
        _ => return Ok(()),
    }
    Ok(())
}
