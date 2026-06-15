fn set_bool_if_present(body: &str, key: &str, target: &mut bool) {
    if let Some(v) = extract_body_bool(body, key) {
        *target = v;
    }
}

fn extract_body_string(body: &str, key: &str) -> Option<String> {
    let rest = json_value_after_key_body(body, key)?;
    parse_json_string_value_body(rest).map(|(value, _)| value)
}

fn extract_body_bool(body: &str, key: &str) -> Option<bool> {
    let rest = json_value_after_key_body(body, key)?;
    if rest.starts_with("true") {
        Some(true)
    } else if rest.starts_with("false") {
        Some(false)
    } else {
        None
    }
}

fn extract_body_u16(body: &str, key: &str) -> Option<u16> {
    extract_body_u32(body, key).and_then(|v| u16::try_from(v).ok())
}

fn extract_body_u8(body: &str, key: &str) -> Option<u8> {
    extract_body_u32(body, key).and_then(|v| u8::try_from(v).ok())
}

fn extract_body_u32(body: &str, key: &str) -> Option<u32> {
    let rest = json_value_after_key_body(body, key)?;
    let mut out = 0u32;
    let mut seen = false;
    for ch in rest.chars() {
        if let Some(digit) = ch.to_digit(10) {
            seen = true;
            out = out.checked_mul(10)?.checked_add(digit)?;
        } else {
            break;
        }
    }
    seen.then_some(out)
}

fn apply_fixed_voltages_if_present(
    body: &str,
    capability: &mut UsbCCapabilityConfig,
) -> Option<()> {
    let Some(rest) = json_value_after_key_body(body, "fixed_voltages_mv") else {
        return Some(());
    };
    let mut rest = rest.strip_prefix('[')?.trim_start();
    let mut fixed_9v = false;
    let mut fixed_12v = false;
    let mut fixed_15v = false;
    let mut fixed_20v = false;

    loop {
        if rest.strip_prefix(']').is_some() {
            capability.fixed_9v = fixed_9v;
            capability.fixed_12v = fixed_12v;
            capability.fixed_15v = fixed_15v;
            capability.fixed_20v = fixed_20v;
            return Some(());
        }

        let (voltage_mv, consumed) = parse_json_u32_prefix(rest)?;
        match voltage_mv {
            9000 => fixed_9v = true,
            12000 => fixed_12v = true,
            15000 => fixed_15v = true,
            20000 => fixed_20v = true,
            _ => return None,
        }

        rest = rest[consumed..].trim_start();
        if let Some(after) = rest.strip_prefix(',') {
            rest = after.trim_start();
        } else if !rest.starts_with(']') {
            return None;
        }
    }
}

fn parse_json_u32_prefix(value: &str) -> Option<(u32, usize)> {
    let mut out = 0u32;
    let mut seen = false;
    let mut consumed = 0usize;
    for (idx, ch) in value.char_indices() {
        if let Some(digit) = ch.to_digit(10) {
            seen = true;
            out = out.checked_mul(10)?.checked_add(digit)?;
            consumed = idx + ch.len_utf8();
        } else {
            break;
        }
    }
    seen.then_some((out, consumed))
}

fn json_value_after_key_body<'a>(body: &'a str, key: &str) -> Option<&'a str> {
    let mut needle = String::new();
    let _ = core::write!(needle, "\"{}\"", key);
    let start = body.find(needle.as_str())?;
    let colon = body[start..].find(':')?;
    Some(body[start + colon + 1..].trim_start())
}

fn parse_json_string_value_body(rest: &str) -> Option<(String, usize)> {
    let mut chars = rest.char_indices();
    let (_, first) = chars.next()?;
    if first != '"' {
        return None;
    }

    let mut out = String::new();
    while let Some((idx, ch)) = chars.next() {
        match ch {
            '"' => return Some((out, idx + ch.len_utf8())),
            '\\' => {
                let (_, escaped) = chars.next()?;
                match escaped {
                    '"' | '\\' | '/' => {
                        let _ = out.push(escaped);
                    }
                    'n' => {
                        let _ = out.push('\n');
                    }
                    'r' => {
                        let _ = out.push('\r');
                    }
                    't' => {
                        let _ = out.push('\t');
                    }
                    _ => return None,
                }
            }
            _ => {
                let _ = out.push(ch);
            }
        }
    }
    None
}

fn parse_query_value(query: &str, key: &str) -> Option<String> {
    for part in query.split('&') {
        let (k, v) = part.split_once('=')?;
        if k == key {
            return percent_decode(v);
        }
    }
    None
}

fn percent_decode(value: &str) -> Option<String> {
    let mut out = String::new();
    let bytes = value.as_bytes();
    let mut idx = 0;
    while idx < bytes.len() {
        match bytes[idx] {
            b'+' => {
                let _ = out.push(' ');
                idx += 1;
            }
            b'%' if idx + 2 < bytes.len() => {
                let hi = hex_value(bytes[idx + 1])?;
                let lo = hex_value(bytes[idx + 2])?;
                let _ = out.push((hi << 4 | lo) as char);
                idx += 3;
            }
            byte => {
                let _ = out.push(byte as char);
                idx += 1;
            }
        }
    }
    Some(out)
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}
