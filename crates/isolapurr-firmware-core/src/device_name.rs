use core::str;

pub const DEVICE_NAME_RECORD_LEN: usize = 64;
pub const DEVICE_NAME_MAGIC: &[u8; 8] = b"IPNAME01";
pub const DEVICE_NAME_VERSION: u8 = 1;
pub const DEVICE_NAME_MAX_BYTES: usize = 48;

/// IEEE CRC-32 (Ethernet, reflected polynomial) for the device-name record.
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= *byte as u32;
        for _ in 0..8 {
            let mask = 0u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

/// A validated UTF-8 display name stored without heap allocation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeviceDisplayName {
    bytes: [u8; DEVICE_NAME_MAX_BYTES],
    len: u8,
}

impl DeviceDisplayName {
    pub fn new(value: &str) -> Option<Self> {
        let bytes = value.as_bytes();
        if bytes.is_empty() || bytes.len() > DEVICE_NAME_MAX_BYTES {
            return None;
        }
        let mut chars = value.chars();
        if chars.next().is_some_and(char::is_whitespace)
            || value.chars().next_back().is_some_and(char::is_whitespace)
            || value.chars().any(char::is_control)
        {
            return None;
        }

        let mut out = Self {
            bytes: [0; DEVICE_NAME_MAX_BYTES],
            len: bytes.len() as u8,
        };
        out.bytes[..bytes.len()].copy_from_slice(bytes);
        Some(out)
    }

    pub fn as_str(&self) -> &str {
        // Construction and decoding both validate UTF-8 before storing bytes.
        str::from_utf8(&self.bytes[..self.len as usize]).unwrap_or("")
    }

    pub const fn len_bytes(&self) -> usize {
        self.len as usize
    }
}

pub fn encode_device_name_record(
    record: &mut [u8; DEVICE_NAME_RECORD_LEN],
    name: Option<&DeviceDisplayName>,
) {
    record.fill(0);
    record[..DEVICE_NAME_MAGIC.len()].copy_from_slice(DEVICE_NAME_MAGIC);
    record[DEVICE_NAME_MAGIC.len()] = DEVICE_NAME_VERSION;
    if let Some(name) = name {
        record[9] = name.len as u8;
        record[10..10 + name.len as usize].copy_from_slice(&name.bytes[..name.len as usize]);
    }
    let crc = crc32(record);
    record[DEVICE_NAME_RECORD_LEN - 4..].copy_from_slice(&crc.to_le_bytes());
}

pub fn decode_device_name_record(
    record: &[u8; DEVICE_NAME_RECORD_LEN],
) -> Option<Option<DeviceDisplayName>> {
    if record.iter().all(|byte| *byte == 0 || *byte == 0xff) {
        return Some(None);
    }
    if &record[..DEVICE_NAME_MAGIC.len()] != DEVICE_NAME_MAGIC
        || record[DEVICE_NAME_MAGIC.len()] != DEVICE_NAME_VERSION
    {
        return None;
    }
    let expected = u32::from_le_bytes([
        record[DEVICE_NAME_RECORD_LEN - 4],
        record[DEVICE_NAME_RECORD_LEN - 3],
        record[DEVICE_NAME_RECORD_LEN - 2],
        record[DEVICE_NAME_RECORD_LEN - 1],
    ]);
    let mut bytes = *record;
    bytes[DEVICE_NAME_RECORD_LEN - 4..].fill(0);
    if crc32(&bytes) != expected || record[58] != 0 || record[59] != 0 {
        return None;
    }
    let len = record[9] as usize;
    if len == 0 {
        return Some(None);
    }
    if len > DEVICE_NAME_MAX_BYTES {
        return None;
    }
    let value = str::from_utf8(&record[10..10 + len]).ok()?;
    Some(DeviceDisplayName::new(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_standard_ieee_crc32() {
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    }

    #[test]
    fn validates_utf8_bounds_and_controls_without_trimming() {
        assert_eq!(DeviceDisplayName::new(" bench "), None);
        assert_eq!(DeviceDisplayName::new("a\n"), None);
        assert_eq!(
            DeviceDisplayName::new("猫"),
            Some(DeviceDisplayName::new("猫").unwrap())
        );
        assert!(DeviceDisplayName::new("a".repeat(48).as_str()).is_some());
        assert!(DeviceDisplayName::new("猫".repeat(13).as_str()).is_some());
        assert!(DeviceDisplayName::new("猫".repeat(17).as_str()).is_none());
    }

    #[test]
    fn record_round_trips_set_and_clear() {
        for value in [Some("Bench 猫"), None] {
            let name = value.map(|value| DeviceDisplayName::new(value).unwrap());
            let mut record = [0u8; DEVICE_NAME_RECORD_LEN];
            encode_device_name_record(&mut record, name.as_ref());
            assert_eq!(decode_device_name_record(&record).unwrap(), name);
        }
    }

    #[test]
    fn erased_crc_and_reserved_bytes_fall_back() {
        let erased = [0xffu8; DEVICE_NAME_RECORD_LEN];
        assert_eq!(decode_device_name_record(&erased), Some(None));
        let name = DeviceDisplayName::new("Hub").unwrap();
        let mut record = [0u8; DEVICE_NAME_RECORD_LEN];
        encode_device_name_record(&mut record, Some(&name));
        record[20] ^= 1;
        assert_eq!(decode_device_name_record(&record), None);
        encode_device_name_record(&mut record, Some(&name));
        record[58] = 1;
        assert_eq!(decode_device_name_record(&record), None);
    }
}
