#[cfg(feature = "net_http")]
async fn handle_usb_port_action(
    request: &str,
    api_state: &'static net::ApiSharedMutex,
    id: &str,
) -> Option<alloc::string::String> {
    let is_action = request.contains("\"method\":\"port.replug\"")
        || request.contains("\"method\": \"port.replug\"")
        || request.contains("\"method\":\"port.power_set\"")
        || request.contains("\"method\": \"port.power_set\"")
        || request.contains("\"method\":\"port.data_set\"")
        || request.contains("\"method\": \"port.data_set\"");
    if !is_action {
        return None;
    }

    let mut body = alloc::string::String::new();
    let Some(port_id) = extract_json_string(request, "port").and_then(|port| match port.as_str() {
        "port_a" => Some(net::ApiPortId::PortA),
        "port_c" => Some(net::ApiPortId::PortC),
        _ => None,
    }) else {
        write_jsonl_error(&mut body, id, "bad_request", "missing or invalid port", false);
        return Some(body);
    };

    let data_connected = if request.contains("data_set") {
        let Some(connected) = extract_json_bool(request, "connected") else {
            write_jsonl_error(&mut body, id, "bad_request", "missing connected", false);
            return Some(body);
        };
        Some(connected)
    } else {
        None
    };
    let action = if request.contains("power_set") {
        let Some(enabled) = extract_json_bool(request, "enabled") else {
            write_jsonl_error(&mut body, id, "bad_request", "missing enabled", false);
            return Some(body);
        };
        net::ApiPortAction::Power { enabled }
    } else if let Some(connected) = data_connected {
        net::ApiPortAction::Data { connected }
    } else {
        net::ApiPortAction::Replug
    };
    let accepted = match data_connected {
        Some(connected) => net::try_set_data_action(api_state, port_id, connected)
            .await
            .map_err(|error| match error {
                net::ApiPortDataActionError::Busy => "busy",
                net::ApiPortDataActionError::PowerOff => "port_power_off",
            }),
        None => net::try_set_action(api_state, port_id, action).await.map_err(|_| "busy"),
    };
    match accepted {
        Ok(()) => {
            if let Some(connected) = data_connected {
                let _ = write!(body, "{{\"id\":{id},\"ok\":true,\"result\":{{\"accepted\":true,\"data_connected\":{connected}}}}}");
            } else {
                let _ = write!(body, "{{\"id\":{id},\"ok\":true,\"result\":{{\"accepted\":true}}}}");
            }
        }
        Err("busy") => write_jsonl_error(&mut body, id, "busy", "port is busy", true),
        Err("port_power_off") => write_jsonl_error(
            &mut body,
            id,
            "port_power_off",
            "enable port power before connecting the data link",
            false,
        ),
        Err(_) => unreachable!(),
    }
    Some(body)
}
