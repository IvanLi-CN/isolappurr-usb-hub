use crate::idle_bias::{
    IDLE_BIAS_MAX_VOLTAGE_MV, IDLE_BIAS_MIN_VOLTAGE_MV, IDLE_BIAS_POINT_COUNT, IDLE_BIAS_STEP_MV,
    IdleBiasCalibration, IdleBiasMetadata,
};
use crate::power_config::{
    LightLoadMode, ManualTpsConfig, ManualUsbCPathMode, PowerConfig, PowerHardwareKind, TpsMode,
    UsbCCapabilityConfig, UsbCCurrentLimitConfig, UsbCFastChargeConfig,
};

const IDLE_BIAS_FIXED_METADATA: IdleBiasMetadata = IdleBiasMetadata::fixed();

pub const POWER_SETTINGS_RECORD_LEN: usize = 96;
pub const POWER_SETTINGS_MAGIC: &[u8; 8] = b"IPPWR01\0";
pub const POWER_SETTINGS_VERSION: u8 = 2;
pub const IDLE_BIAS_RECORD_LEN: usize = 96;
pub const IDLE_BIAS_MAGIC: &[u8; 8] = b"IPIBIAS\0";
pub const IDLE_BIAS_VERSION: u8 = 1;

pub fn checksum(bytes: &[u8]) -> u32 {
    let mut h = 0x811c_9dc5u32;
    for b in bytes {
        h ^= *b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

pub fn record_checksum_matches(record: &mut [u8]) -> bool {
    if record.len() < 4 {
        return false;
    }
    let checksum_offset = record.len() - 4;
    let expected = u32::from_le_bytes([
        record[checksum_offset],
        record[checksum_offset + 1],
        record[checksum_offset + 2],
        record[checksum_offset + 3],
    ]);
    record[checksum_offset..].fill(0);
    checksum(record) == expected
}

pub fn write_record_checksum(record: &mut [u8]) {
    if record.len() < 4 {
        return;
    }
    let crc = checksum(record);
    let checksum_offset = record.len() - 4;
    record[checksum_offset..].copy_from_slice(&crc.to_le_bytes());
}

pub fn encode_power_config(record: &mut [u8; POWER_SETTINGS_RECORD_LEN], config: PowerConfig) {
    record[9] = match config.hardware {
        PowerHardwareKind::Sw2303 => 0,
    };
    record[10] = match config.tps_mode {
        TpsMode::AutoFollow => 0,
        TpsMode::Manual => 1,
    };
    record[11] = match config.manual.usb_c_path_mode {
        ManualUsbCPathMode::Default => 0,
        ManualUsbCPathMode::Disconnect => 1,
        ManualUsbCPathMode::Force => 2,
    };
    record[12..14].copy_from_slice(&config.manual.voltage_mv.to_le_bytes());
    record[14..16].copy_from_slice(&config.manual.current_limit_ma.to_le_bytes());
    record[16] = config.capability.power_watts;
    record[17] = pack_protocol_flags(config.capability);
    record[18] = pack_pd_flags(config.capability);
    record[19] = match config.light_load_mode {
        LightLoadMode::Pfm => 0,
        LightLoadMode::Fpwm => 1,
    };
    record[20] = match config.capability.current.pps3_limit_ma {
        3_000 => 0,
        5_000 => 1,
        _ => 1,
    };
    record[21] = (config.capability.current.pd_pps_5a as u8)
        | ((config.capability.current.type_c_broadcast_ma == 1_500) as u8) << 1
        | (pack_scp_limit(config.capability.current.scp_limit_ma) << 2)
        | ((config.capability.current.fcp_afc_sfcp_limit_ma == 2_250) as u8) << 4;
    record[22] = (config.capability.fast_charge.qc20_20v_enabled as u8)
        | ((config.capability.fast_charge.qc30_20v_enabled as u8) << 1)
        | ((config.capability.fast_charge.pe20_20v_enabled as u8) << 2)
        | ((config.capability.fast_charge.non_pd_12v_enabled as u8) << 3);
}

pub fn decode_power_config(record: &[u8; POWER_SETTINGS_RECORD_LEN]) -> Option<PowerConfig> {
    let version = record[POWER_SETTINGS_MAGIC.len()];
    let hardware = match record[9] {
        0 => PowerHardwareKind::Sw2303,
        _ => return None,
    };
    let tps_mode = match record[10] {
        0 => TpsMode::AutoFollow,
        1 => TpsMode::Manual,
        _ => return None,
    };
    let usb_c_path_mode = match record[11] {
        0 => ManualUsbCPathMode::Default,
        1 => ManualUsbCPathMode::Disconnect,
        2 => ManualUsbCPathMode::Force,
        _ => return None,
    };
    let voltage_mv = u16::from_le_bytes([record[12], record[13]]);
    let current_limit_ma = u16::from_le_bytes([record[14], record[15]]);
    let light_load_mode = match record[19] {
        0 => LightLoadMode::Pfm,
        1 => LightLoadMode::Fpwm,
        _ => return None,
    };
    Some(PowerConfig {
        hardware,
        tps_mode,
        light_load_mode,
        manual: ManualTpsConfig {
            voltage_mv,
            current_limit_ma,
            usb_c_path_mode,
        },
        capability: if version >= 2 {
            unpack_capability_v2(
                record[16], record[17], record[18], record[20], record[21], record[22],
            )?
        } else {
            unpack_capability_v1(record[16], record[17], record[18])
        },
    })
}

fn pack_protocol_flags(capability: UsbCCapabilityConfig) -> u8 {
    (capability.pd_enabled as u8)
        | ((capability.qc20_enabled as u8) << 1)
        | ((capability.qc30_enabled as u8) << 2)
        | ((capability.fcp_enabled as u8) << 3)
        | ((capability.afc_enabled as u8) << 4)
        | ((capability.scp_enabled as u8) << 5)
        | ((capability.pe20_enabled as u8) << 6)
        | ((capability.bc12_enabled as u8) << 7)
}

fn pack_pd_flags(capability: UsbCCapabilityConfig) -> u8 {
    (capability.sfcp_enabled as u8)
        | ((capability.pps_enabled as u8) << 1)
        | ((capability.fixed_9v as u8) << 2)
        | ((capability.fixed_12v as u8) << 3)
        | ((capability.fixed_15v as u8) << 4)
        | ((capability.fixed_20v as u8) << 5)
}

fn unpack_capability_v1(power_watts: u8, flags: u8, pd_flags: u8) -> UsbCCapabilityConfig {
    UsbCCapabilityConfig {
        power_watts,
        pd_enabled: flags & (1 << 0) != 0,
        qc20_enabled: flags & (1 << 1) != 0,
        qc30_enabled: flags & (1 << 2) != 0,
        fcp_enabled: flags & (1 << 3) != 0,
        afc_enabled: flags & (1 << 4) != 0,
        scp_enabled: flags & (1 << 5) != 0,
        pe20_enabled: flags & (1 << 6) != 0,
        bc12_enabled: flags & (1 << 7) != 0,
        sfcp_enabled: pd_flags & (1 << 0) != 0,
        pps_enabled: pd_flags & (1 << 1) != 0,
        fixed_9v: pd_flags & (1 << 2) != 0,
        fixed_12v: pd_flags & (1 << 3) != 0,
        fixed_15v: pd_flags & (1 << 4) != 0,
        fixed_20v: pd_flags & (1 << 5) != 0,
        current: UsbCCurrentLimitConfig::defaults(),
        fast_charge: UsbCFastChargeConfig::defaults(),
    }
}

fn unpack_capability_v2(
    power_watts: u8,
    flags: u8,
    pd_flags: u8,
    current_flags0: u8,
    current_flags1: u8,
    fast_charge_flags: u8,
) -> Option<UsbCCapabilityConfig> {
    Some(UsbCCapabilityConfig {
        power_watts,
        pd_enabled: flags & (1 << 0) != 0,
        qc20_enabled: flags & (1 << 1) != 0,
        qc30_enabled: flags & (1 << 2) != 0,
        fcp_enabled: flags & (1 << 3) != 0,
        afc_enabled: flags & (1 << 4) != 0,
        scp_enabled: flags & (1 << 5) != 0,
        pe20_enabled: flags & (1 << 6) != 0,
        bc12_enabled: flags & (1 << 7) != 0,
        sfcp_enabled: pd_flags & (1 << 0) != 0,
        pps_enabled: pd_flags & (1 << 1) != 0,
        fixed_9v: pd_flags & (1 << 2) != 0,
        fixed_12v: pd_flags & (1 << 3) != 0,
        fixed_15v: pd_flags & (1 << 4) != 0,
        fixed_20v: pd_flags & (1 << 5) != 0,
        current: UsbCCurrentLimitConfig {
            pps3_limit_ma: if current_flags0 & 1 == 0 {
                3_000
            } else {
                5_000
            },
            pd_pps_5a: current_flags1 & (1 << 0) != 0,
            type_c_broadcast_ma: if current_flags1 & (1 << 1) != 0 {
                1_500
            } else {
                500
            },
            scp_limit_ma: unpack_scp_limit((current_flags1 >> 2) & 0x03)?,
            fcp_afc_sfcp_limit_ma: if current_flags1 & (1 << 4) != 0 {
                2_250
            } else {
                3_250
            },
        },
        fast_charge: UsbCFastChargeConfig {
            qc20_20v_enabled: fast_charge_flags & (1 << 0) != 0,
            qc30_20v_enabled: fast_charge_flags & (1 << 1) != 0,
            pe20_20v_enabled: fast_charge_flags & (1 << 2) != 0,
            non_pd_12v_enabled: fast_charge_flags & (1 << 3) != 0,
        },
    })
}

fn pack_scp_limit(value: u16) -> u8 {
    match value {
        5_000 => 0,
        4_000 => 1,
        2_000 => 2,
        _ => 0,
    }
}

fn unpack_scp_limit(bits: u8) -> Option<u16> {
    match bits {
        0 => Some(5_000),
        1 => Some(4_000),
        2 => Some(2_000),
        _ => None,
    }
}

pub fn encode_idle_bias_calibration(
    record: &mut [u8; IDLE_BIAS_RECORD_LEN],
    calibration: IdleBiasCalibration,
) {
    record[9] = calibration.correction_enabled as u8;
    record[10..12].copy_from_slice(&IDLE_BIAS_MIN_VOLTAGE_MV.to_le_bytes());
    record[12..14].copy_from_slice(&IDLE_BIAS_MAX_VOLTAGE_MV.to_le_bytes());
    record[14..16].copy_from_slice(&IDLE_BIAS_STEP_MV.to_le_bytes());
    record[16] = IDLE_BIAS_POINT_COUNT as u8;
    for (index, offset_ma) in calibration.current_offsets_ma.iter().enumerate() {
        let start = 17 + (index * 2);
        record[start..start + 2].copy_from_slice(&offset_ma.to_le_bytes());
    }
}

pub fn decode_idle_bias_calibration(
    record: &[u8; IDLE_BIAS_RECORD_LEN],
) -> Option<IdleBiasCalibration> {
    let min_voltage_mv = u16::from_le_bytes([record[10], record[11]]);
    let max_voltage_mv = u16::from_le_bytes([record[12], record[13]]);
    let step_mv = u16::from_le_bytes([record[14], record[15]]);
    let point_count = record[16];
    if min_voltage_mv != IDLE_BIAS_FIXED_METADATA.min_voltage_mv
        || max_voltage_mv != IDLE_BIAS_FIXED_METADATA.max_voltage_mv
        || step_mv != IDLE_BIAS_FIXED_METADATA.step_mv
        || point_count != IDLE_BIAS_FIXED_METADATA.point_count
    {
        return None;
    }

    let mut current_offsets_ma = [0u16; IDLE_BIAS_POINT_COUNT];
    for (index, offset_ma) in current_offsets_ma.iter_mut().enumerate() {
        let start = 17 + (index * 2);
        *offset_ma = u16::from_le_bytes([record[start], record[start + 1]]);
    }

    Some(IdleBiasCalibration::new(
        record[9] & 1 != 0,
        current_offsets_ma,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_idle_bias(enabled: bool) -> IdleBiasCalibration {
        let mut offsets = [0u16; IDLE_BIAS_POINT_COUNT];
        for (index, offset) in offsets.iter_mut().enumerate() {
            *offset = (index as u16) * 3;
        }
        IdleBiasCalibration::new(enabled, offsets)
    }

    #[test]
    fn power_config_record_round_trips() {
        let config = PowerConfig {
            tps_mode: TpsMode::Manual,
            light_load_mode: LightLoadMode::Fpwm,
            manual: ManualTpsConfig {
                voltage_mv: 9_000,
                current_limit_ma: 3_000,
                usb_c_path_mode: ManualUsbCPathMode::Force,
            },
            capability: UsbCCapabilityConfig {
                current: UsbCCurrentLimitConfig {
                    pps3_limit_ma: 3_000,
                    pd_pps_5a: true,
                    type_c_broadcast_ma: 1_500,
                    scp_limit_ma: 4_000,
                    fcp_afc_sfcp_limit_ma: 2_250,
                },
                fast_charge: UsbCFastChargeConfig {
                    qc20_20v_enabled: false,
                    qc30_20v_enabled: true,
                    pe20_20v_enabled: false,
                    non_pd_12v_enabled: true,
                },
                ..PowerConfig::defaults().capability
            },
            ..PowerConfig::defaults()
        };
        let mut record = [0u8; POWER_SETTINGS_RECORD_LEN];
        record[..POWER_SETTINGS_MAGIC.len()].copy_from_slice(POWER_SETTINGS_MAGIC);
        record[POWER_SETTINGS_MAGIC.len()] = POWER_SETTINGS_VERSION;
        encode_power_config(&mut record, config);

        assert_eq!(decode_power_config(&record), Some(config));
    }

    #[test]
    fn power_config_legacy_reserved_byte_defaults_to_pfm() {
        let config = PowerConfig {
            tps_mode: TpsMode::Manual,
            light_load_mode: LightLoadMode::Fpwm,
            manual: ManualTpsConfig {
                voltage_mv: 9_000,
                current_limit_ma: 3_000,
                usb_c_path_mode: ManualUsbCPathMode::Force,
            },
            ..PowerConfig::defaults()
        };
        let mut record = [0u8; POWER_SETTINGS_RECORD_LEN];
        record[..POWER_SETTINGS_MAGIC.len()].copy_from_slice(POWER_SETTINGS_MAGIC);
        record[POWER_SETTINGS_MAGIC.len()] = POWER_SETTINGS_VERSION;
        encode_power_config(&mut record, config);
        record[19] = 0;

        let decoded = decode_power_config(&record).expect("legacy record should decode");
        assert_eq!(decoded.light_load_mode, LightLoadMode::Pfm);
        assert_eq!(decoded.tps_mode, TpsMode::Manual);
        assert_eq!(decoded.manual.voltage_mv, 9_000);
    }

    #[test]
    fn power_config_defaults_new_fields_for_v1_legacy_record_bytes() {
        let config = PowerConfig::defaults();
        let mut record = [0u8; POWER_SETTINGS_RECORD_LEN];
        record[..POWER_SETTINGS_MAGIC.len()].copy_from_slice(POWER_SETTINGS_MAGIC);
        record[POWER_SETTINGS_MAGIC.len()] = 1;
        encode_power_config(&mut record, config);

        let decoded = decode_power_config(&record).expect("legacy record should decode");
        assert_eq!(decoded.capability.current.pps3_limit_ma, 5_000);
        assert!(!decoded.capability.current.pd_pps_5a);
        assert_eq!(decoded.capability.current.type_c_broadcast_ma, 500);
        assert_eq!(decoded.capability.current.scp_limit_ma, 5_000);
        assert_eq!(decoded.capability.current.fcp_afc_sfcp_limit_ma, 3_250);
        assert!(decoded.capability.fast_charge.qc20_20v_enabled);
        assert!(decoded.capability.fast_charge.qc30_20v_enabled);
        assert!(decoded.capability.fast_charge.pe20_20v_enabled);
        assert!(decoded.capability.fast_charge.non_pd_12v_enabled);
    }

    #[test]
    fn idle_bias_record_round_trips() {
        let calibration = sample_idle_bias(true);
        let mut record = [0u8; IDLE_BIAS_RECORD_LEN];
        record[..IDLE_BIAS_MAGIC.len()].copy_from_slice(IDLE_BIAS_MAGIC);
        record[IDLE_BIAS_MAGIC.len()] = IDLE_BIAS_VERSION;
        encode_idle_bias_calibration(&mut record, calibration);
        write_record_checksum(&mut record);

        let mut validated = record;
        assert!(record_checksum_matches(&mut validated));
        let decoded = decode_idle_bias_calibration(&record).expect("decode calibration");
        assert_eq!(decoded, calibration);
    }

    #[test]
    fn idle_bias_record_rejects_mismatched_metadata() {
        let calibration = sample_idle_bias(false);
        let mut record = [0u8; IDLE_BIAS_RECORD_LEN];
        record[..IDLE_BIAS_MAGIC.len()].copy_from_slice(IDLE_BIAS_MAGIC);
        record[IDLE_BIAS_MAGIC.len()] = IDLE_BIAS_VERSION;
        encode_idle_bias_calibration(&mut record, calibration);
        record[14..16].copy_from_slice(&600u16.to_le_bytes());

        assert!(decode_idle_bias_calibration(&record).is_none());
    }

    #[test]
    fn idle_bias_record_detects_crc_corruption() {
        let calibration = sample_idle_bias(true);
        let mut record = [0u8; IDLE_BIAS_RECORD_LEN];
        record[..IDLE_BIAS_MAGIC.len()].copy_from_slice(IDLE_BIAS_MAGIC);
        record[IDLE_BIAS_MAGIC.len()] = IDLE_BIAS_VERSION;
        encode_idle_bias_calibration(&mut record, calibration);
        write_record_checksum(&mut record);
        record[24] ^= 0x5a;

        assert!(!record_checksum_matches(&mut record));
    }

    #[test]
    fn idle_bias_record_version_mismatch_is_rejected() {
        let calibration = sample_idle_bias(true);
        let mut record = [0u8; IDLE_BIAS_RECORD_LEN];
        record[..IDLE_BIAS_MAGIC.len()].copy_from_slice(IDLE_BIAS_MAGIC);
        record[IDLE_BIAS_MAGIC.len()] = IDLE_BIAS_VERSION + 1;
        encode_idle_bias_calibration(&mut record, calibration);

        assert_ne!(record[IDLE_BIAS_MAGIC.len()], IDLE_BIAS_VERSION);
    }
}
