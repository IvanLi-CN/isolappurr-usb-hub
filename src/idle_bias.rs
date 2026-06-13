pub const IDLE_BIAS_MIN_VOLTAGE_MV: u16 = 3_000;
pub const IDLE_BIAS_MAX_VOLTAGE_MV: u16 = 21_000;
pub const IDLE_BIAS_STEP_MV: u16 = 500;
pub const IDLE_BIAS_SETTLE_WINDOW_MS: u64 = 500;
pub const IDLE_BIAS_SAMPLE_WINDOW_MS: u64 = 500;
pub const IDLE_BIAS_SAMPLE_INTERVAL_MS: u64 = 100;
pub const IDLE_BIAS_SAMPLE_COUNT: usize =
    (IDLE_BIAS_SAMPLE_WINDOW_MS / IDLE_BIAS_SAMPLE_INTERVAL_MS) as usize + 1;
pub const IDLE_BIAS_POINT_COUNT: usize =
    ((IDLE_BIAS_MAX_VOLTAGE_MV - IDLE_BIAS_MIN_VOLTAGE_MV) / IDLE_BIAS_STEP_MV) as usize + 1;

pub type IdleBiasOffsetsMa = [u16; IDLE_BIAS_POINT_COUNT];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct IdleBiasMetadata {
    pub min_voltage_mv: u16,
    pub max_voltage_mv: u16,
    pub step_mv: u16,
    pub point_count: u8,
}

impl IdleBiasMetadata {
    pub const fn fixed() -> Self {
        Self {
            min_voltage_mv: IDLE_BIAS_MIN_VOLTAGE_MV,
            max_voltage_mv: IDLE_BIAS_MAX_VOLTAGE_MV,
            step_mv: IDLE_BIAS_STEP_MV,
            point_count: IDLE_BIAS_POINT_COUNT as u8,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct IdleBiasCalibration {
    pub correction_enabled: bool,
    pub current_offsets_ma: IdleBiasOffsetsMa,
}

impl IdleBiasCalibration {
    pub const fn new(correction_enabled: bool, current_offsets_ma: IdleBiasOffsetsMa) -> Self {
        Self {
            correction_enabled,
            current_offsets_ma,
        }
    }

    pub fn current_offset_ma(self, voltage_mv: u32) -> Option<u32> {
        if !self.correction_enabled {
            return None;
        }
        Some(interpolate_current_offset_ma(
            &self.current_offsets_ma,
            voltage_mv,
        ))
    }
}

pub const fn idle_bias_point_voltage_mv(index: usize) -> u16 {
    IDLE_BIAS_MIN_VOLTAGE_MV + (index as u16 * IDLE_BIAS_STEP_MV)
}

pub fn interpolate_current_offset_ma(offsets: &IdleBiasOffsetsMa, voltage_mv: u32) -> u32 {
    let min_mv = u32::from(IDLE_BIAS_MIN_VOLTAGE_MV);
    let max_mv = u32::from(IDLE_BIAS_MAX_VOLTAGE_MV);
    let step_mv = u32::from(IDLE_BIAS_STEP_MV);

    if voltage_mv <= min_mv {
        return u32::from(offsets[0]);
    }
    if voltage_mv >= max_mv {
        return u32::from(offsets[IDLE_BIAS_POINT_COUNT - 1]);
    }

    let clamped = voltage_mv - min_mv;
    let low_index = (clamped / step_mv) as usize;
    let high_index = low_index + 1;
    let remainder = clamped % step_mv;

    if remainder == 0 {
        return u32::from(offsets[low_index]);
    }

    let low_ma = u32::from(offsets[low_index]);
    let high_ma = u32::from(offsets[high_index]);
    if high_ma >= low_ma {
        low_ma + (((high_ma - low_ma) * remainder) + (step_mv / 2)) / step_mv
    } else {
        low_ma - (((low_ma - high_ma) * remainder) + (step_mv / 2)) / step_mv
    }
}

pub fn corrected_current_ma(raw_current_ma: u32, offset_ma: u32) -> u32 {
    raw_current_ma.saturating_sub(offset_ma)
}

pub fn corrected_power_mw(raw_voltage_mv: u32, corrected_current_ma: u32) -> u32 {
    (((u64::from(raw_voltage_mv) * u64::from(corrected_current_ma)) + 500) / 1_000)
        .min(u64::from(u32::MAX)) as u32
}

pub fn average_current_ma(total_current_ma: u32, sample_count: usize) -> u16 {
    if sample_count == 0 {
        return 0;
    }
    ((total_current_ma + ((sample_count as u32) / 2)) / (sample_count as u32))
        .min(u32::from(u16::MAX)) as u16
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolates_between_voltage_points() {
        let mut offsets = [0u16; IDLE_BIAS_POINT_COUNT];
        offsets[0] = 10;
        offsets[1] = 30;
        offsets[2] = 50;

        assert_eq!(interpolate_current_offset_ma(&offsets, 3_000), 10);
        assert_eq!(interpolate_current_offset_ma(&offsets, 3_250), 20);
        assert_eq!(interpolate_current_offset_ma(&offsets, 3_500), 30);
        assert_eq!(interpolate_current_offset_ma(&offsets, 3_750), 40);
    }

    #[test]
    fn clamps_interpolation_to_lut_edges() {
        let mut offsets = [0u16; IDLE_BIAS_POINT_COUNT];
        offsets[0] = 11;
        offsets[IDLE_BIAS_POINT_COUNT - 1] = 77;

        assert_eq!(interpolate_current_offset_ma(&offsets, 2_000), 11);
        assert_eq!(interpolate_current_offset_ma(&offsets, 22_000), 77);
    }

    #[test]
    fn clamps_corrected_current_to_zero() {
        assert_eq!(corrected_current_ma(80, 120), 0);
        assert_eq!(corrected_current_ma(120, 80), 40);
    }

    #[test]
    fn recalculates_corrected_power_from_voltage_and_current() {
        assert_eq!(corrected_power_mw(5_000, 0), 0);
        assert_eq!(corrected_power_mw(20_000, 123), 2_460);
        assert_eq!(corrected_power_mw(9_000, 555), 4_995);
    }

    #[test]
    fn idle_bias_sample_window_spans_last_half_second() {
        assert_eq!(IDLE_BIAS_SETTLE_WINDOW_MS, 500);
        assert_eq!(IDLE_BIAS_SAMPLE_WINDOW_MS, 500);
        assert_eq!(IDLE_BIAS_SAMPLE_INTERVAL_MS, 100);
        assert_eq!(IDLE_BIAS_SAMPLE_COUNT, 6);
    }

    #[test]
    fn averages_current_with_rounding() {
        assert_eq!(average_current_ma(0, 0), 0);
        assert_eq!(average_current_ma(5, 2), 3);
        assert_eq!(average_current_ma(6, 2), 3);
        assert_eq!(average_current_ma(7, 2), 4);
        assert_eq!(average_current_ma(11, 6), 2);
    }
}
