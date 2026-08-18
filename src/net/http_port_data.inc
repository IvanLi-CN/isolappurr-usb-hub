fn parse_connected_query(query: &str) -> Option<bool> {
    for part in query.split('&') {
        let (key, value) = part.split_once('=')?;
        if key == "connected" {
            return match value {
                "0" => Some(false),
                "1" => Some(true),
                _ => None,
            };
        }
    }
    None
}

fn parse_owner_query(query: &str) -> Option<u32> {
    for part in query.split('&') {
        let (key, value) = part.split_once('=')?;
        if key == "owner" {
            return value.parse::<u32>().ok().filter(|value| *value != 0);
        }
    }
    None
}

async fn handle_port_data_request(
    socket: &mut TcpSocket<'_>,
    query: &str,
    api_state: &'static ApiSharedMutex,
    port_id: ApiPortId,
    allow_origin: Option<&str>,
) -> Result<(), embassy_net::tcp::Error> {
    let Some(connected) = parse_connected_query(query) else {
        return write_api_error(
            socket,
            "400 Bad Request",
            allow_origin,
            "bad_request",
            "missing or invalid connected",
            false,
        )
        .await;
    };

    match try_set_data_action(api_state, port_id, connected).await {
        Ok(()) => {
            let body = if connected {
                "{\"accepted\":true,\"data_connected\":true}"
            } else {
                "{\"accepted\":true,\"data_connected\":false}"
            };
            write_json_response(socket, "202 Accepted", allow_origin, body).await
        }
        Err(ApiPortDataActionError::Busy) => {
            write_api_error(socket, "409 Conflict", allow_origin, "busy", "port is busy", true).await
        }
        Err(ApiPortDataActionError::PowerOff) => write_api_error(
            socket,
            "409 Conflict",
            allow_origin,
            "port_power_off",
            "enable port power before connecting the data link",
            false,
        )
        .await,
    }
}
