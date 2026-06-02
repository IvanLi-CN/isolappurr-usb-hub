fn generate_token() -> String {
    use rand::{Rng as _, distributions::Alphanumeric};
    let mut rng = rand::thread_rng();
    std::iter::repeat_with(|| rng.sample(Alphanumeric))
        .take(32)
        .map(char::from)
        .collect()
}

fn is_authorized(headers: &HeaderMap, state: &AppState) -> bool {
    let Some(auth) = headers.get(header::AUTHORIZATION) else {
        return false;
    };
    let Ok(auth) = auth.to_str() else {
        return false;
    };
    let expected = format!("Bearer {}", state.token);
    auth == expected
}

fn is_origin_allowed(headers: &HeaderMap, port: u16) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    is_local_web_origin(origin, port)
}

fn local_web_cors_layer(agent_port: u16) -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(move |origin, _| {
            is_local_web_origin(origin, agent_port)
        }))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
}

fn is_local_web_origin(origin: &HeaderValue, agent_port: u16) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let Ok(url) = Url::parse(origin) else {
        return false;
    };
    let host = url.host_str().unwrap_or_default();
    let loopback_host = host == "127.0.0.1" || host == "localhost" || host == "::1";
    if url.scheme() == "tauri" {
        return loopback_host;
    }
    if !matches!(url.scheme(), "http" | "https") || !loopback_host {
        return false;
    }
    let Some(port) = url.port() else {
        return false;
    };
    port == agent_port || LOCAL_WEB_ALLOWED_PORTS.contains(&port)
}

fn unauthorized(message: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "unauthorized",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}

fn forbidden(message: &str) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "forbidden",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}

fn bad_request(message: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "bad_request",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}

fn conflict(message: &str) -> Response {
    (
        StatusCode::CONFLICT,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "conflict",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}

fn not_found(message: &str) -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "not_found",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}

fn internal_error(message: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorEnvelope {
            error: ErrorInfo {
                code: "internal_error",
                message: message.to_string(),
                retryable: false,
            },
        }),
    )
        .into_response()
}
