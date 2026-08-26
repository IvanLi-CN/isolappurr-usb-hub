use core::fmt;

/// Version of the port capability declaration carried by device snapshots.
pub const PORT_CAPABILITY_SCHEMA_V1: u8 = 1;

/// Write the complete capability declaration required by schema version 1.
pub fn write_port_capabilities_json<W: fmt::Write>(out: &mut W) -> fmt::Result {
    out.write_str("{\"data_replug\":true,\"data_set\":true,\"power_set\":true}")
}

/// Write the immutable build metadata exposed by the firmware info endpoints.
pub fn write_firmware_build_json<W: fmt::Write>(
    out: &mut W,
    source_sha: &str,
    dirty: bool,
) -> fmt::Result {
    write!(
        out,
        "{{\"source_sha\":\"{}\",\"dirty\":{}}}",
        source_sha, dirty
    )
}

#[cfg(test)]
mod tests {
    use super::{
        PORT_CAPABILITY_SCHEMA_V1, write_firmware_build_json, write_port_capabilities_json,
    };
    use alloc::string::String;

    extern crate alloc;

    #[test]
    fn schema_v1_declares_all_port_controls() {
        let mut body = String::new();
        write_port_capabilities_json(&mut body).unwrap();

        assert_eq!(PORT_CAPABILITY_SCHEMA_V1, 1);
        assert_eq!(
            body,
            "{\"data_replug\":true,\"data_set\":true,\"power_set\":true}"
        );
    }

    #[test]
    fn firmware_build_metadata_uses_json_boolean_for_dirty() {
        let mut body = String::new();
        write_firmware_build_json(&mut body, "0123456789abcdef0123456789abcdef01234567", false)
            .unwrap();

        assert_eq!(
            body,
            "{\"source_sha\":\"0123456789abcdef0123456789abcdef01234567\",\"dirty\":false}"
        );
    }
}
