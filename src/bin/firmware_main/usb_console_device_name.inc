{
    if request.contains("\"method\":\"settings.name.set\"")
        || request.contains("\"method\": \"settings.name.set\"")
    {
        let Some(value) = extract_json_string(request, "name") else {
            write_jsonl_error(&mut body, id.as_str(), "invalid_name", "name must be 1-48 UTF-8 bytes without controls or outer whitespace", false);
            return body;
        };
        let Some(name) = isolapurr_firmware_core::device_name::DeviceDisplayName::new(value.as_str()) else {
            write_jsonl_error(&mut body, id.as_str(), "invalid_name", "name must be 1-48 UTF-8 bytes without controls or outer whitespace", false);
            return body;
        };
        match net::try_set_device_name(api_state, net::ApiDeviceNameCommand::Set(name)).await {
            Ok(()) => {
                if wait_device_name_result(api_state).await {
                    let _ = write!(body, "{{\"id\":{},\"ok\":true,\"result\":{{\"display_name\":", id.as_str());
                    write_json_string(&mut body, name.as_str());
                    let _ = body.push_str("}}");
                } else {
                    write_jsonl_error(&mut body, id.as_str(), "eeprom_failed", "device display name could not be saved to EEPROM U21", true);
                }
            }
            Err(net::ApiActionError::Busy) => write_jsonl_error(&mut body, id.as_str(), "busy", "device display name is busy or locked", true),
        }
        return body;
    }

    if request.contains("\"method\":\"settings.name.clear\"")
        || request.contains("\"method\": \"settings.name.clear\"")
    {
        match net::try_set_device_name(api_state, net::ApiDeviceNameCommand::Clear).await {
            Ok(()) => {
                if wait_device_name_result(api_state).await {
                    let _ = write!(body, "{{\"id\":{},\"ok\":true,\"result\":{{\"display_name\":null}}}}", id.as_str());
                } else {
                    write_jsonl_error(&mut body, id.as_str(), "eeprom_failed", "device display name could not be cleared from EEPROM U21", true);
                }
            }
            Err(net::ApiActionError::Busy) => write_jsonl_error(&mut body, id.as_str(), "busy", "device display name is busy or locked", true),
        }
        return body;
    }

}
