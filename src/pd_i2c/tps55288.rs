use super::{PowerRequest, PowerSetpoint, TPS55288_ADDR_7BIT};
use crate::power_config::{LightLoadMode, TpsCdcRise};

/// Default "keep-alive" setpoint used to power SW2303 before PD negotiation.
///
/// This must stay within the TPS55288 DAC range and should be a safe default on VBUS.
pub const TPS_BOOT_VOUT_MV: u16 = 5_000;
/// Conservative current limit for the boot setpoint (mA).
pub const TPS_BOOT_ILIM_MA: u16 = 6_350;
pub const TPS_IOUT_LIMIT_READBACK_RETRY_MS: u64 = 100;
pub const TPS_IOUT_LIMIT_READBACK_REFRESH_MS: u64 = 1_000;
pub const fn boot_supply_setpoint() -> PowerSetpoint {
    PowerSetpoint {
        output_enabled: true,
        discharge_enabled: false,
        v_out_mv: TPS_BOOT_VOUT_MV,
        i_lim_ma: TPS_BOOT_ILIM_MA,
    }
}

fn mode_bits_for_light_load(
    mut mode: tps55288::registers::ModeBits,
    light_load_mode: LightLoadMode,
) -> tps55288::registers::ModeBits {
    use tps55288::registers::ModeBits;

    match light_load_mode {
        LightLoadMode::Pfm => {
            mode.remove(ModeBits::MODE);
            mode.remove(ModeBits::PFM);
        }
        LightLoadMode::Fpwm => {
            mode.insert(ModeBits::MODE);
            mode.insert(ModeBits::PFM);
            mode.insert(ModeBits::VCC_EXT);
            mode.remove(ModeBits::I2CADD);
        }
    }

    mode
}

pub async fn apply_light_load_mode<I2C>(
    i2c: &mut I2C,
    state: &mut TpsApplyState,
    light_load_mode: LightLoadMode,
) -> Result<(), tps55288::Error<I2C::Error>>
where
    I2C: embedded_hal_async::i2c::I2c,
{
    if state.light_load_mode == Some(light_load_mode) {
        return Ok(());
    }

    use tps55288::registers::{ModeBits, addr};

    let mut dev = tps55288::Tps55288::with_address(i2c, TPS55288_ADDR_7BIT);
    let raw_mode = dev.read_reg(addr::MODE).await?;
    let mode = ModeBits::from_bits_truncate(raw_mode);
    let next_mode = mode_bits_for_light_load(mode, light_load_mode);
    if next_mode.bits() != raw_mode {
        dev.write_reg(addr::MODE, next_mode.bits()).await?;
    }
    state.light_load_mode = Some(light_load_mode);
    Ok(())
}

pub async fn apply_cable_compensation<I2C>(
    i2c: &mut I2C,
    rise: TpsCdcRise,
) -> Result<(), tps55288::Error<I2C::Error>>
where
    I2C: embedded_hal_async::i2c::I2c,
{
    use tps55288::registers::{CdcBits, addr};

    let mut dev = tps55288::Tps55288::with_address(i2c, TPS55288_ADDR_7BIT);
    let raw = dev.read_reg(addr::CDC).await?;
    let mut bits = CdcBits::from_bits_truncate(raw);
    bits.remove(CdcBits::CDC_OPT | CdcBits::CDC0 | CdcBits::CDC1 | CdcBits::CDC2);
    bits |= match rise {
        TpsCdcRise::V0 => CdcBits::empty(),
        TpsCdcRise::V100 => CdcBits::CDC0,
        TpsCdcRise::V200 => CdcBits::CDC1,
        TpsCdcRise::V300 => CdcBits::CDC0 | CdcBits::CDC1,
        TpsCdcRise::V400 => CdcBits::CDC2,
        TpsCdcRise::V500 => CdcBits::CDC2 | CdcBits::CDC0,
        TpsCdcRise::V600 => CdcBits::CDC2 | CdcBits::CDC1,
        TpsCdcRise::V700 => CdcBits::CDC2 | CdcBits::CDC1 | CdcBits::CDC0,
    };
    if bits.bits() != raw {
        dev.write_reg(addr::CDC, bits.bits()).await?;
    }
    Ok(())
}

pub async fn stop_output_and_enable_discharge<I2C>(
    i2c: &mut I2C,
) -> Result<(), tps55288::Error<I2C::Error>>
where
    I2C: embedded_hal_async::i2c::I2c,
{
    use tps55288::registers::{ModeBits, addr};

    let mut dev = tps55288::Tps55288::with_address(i2c, TPS55288_ADDR_7BIT);
    let mut mode = ModeBits::from_bits_truncate(dev.read_reg(addr::MODE).await?);
    mode.remove(ModeBits::OE);
    mode.insert(ModeBits::DISCHG);
    dev.write_reg(addr::MODE, mode.bits()).await
}

pub async fn set_output_discharge_enabled<I2C>(
    i2c: &mut I2C,
    enabled: bool,
) -> Result<(), tps55288::Error<I2C::Error>>
where
    I2C: embedded_hal_async::i2c::I2c,
{
    use tps55288::registers::{ModeBits, addr};

    let mut dev = tps55288::Tps55288::with_address(i2c, TPS55288_ADDR_7BIT);
    let mut mode = ModeBits::from_bits_truncate(dev.read_reg(addr::MODE).await?);
    if enabled {
        mode.insert(ModeBits::DISCHG);
    } else {
        mode.remove(ModeBits::DISCHG);
    }
    dev.write_reg(addr::MODE, mode.bits()).await
}

pub async fn read_iout_limit<I2C>(i2c: &mut I2C) -> Result<(u16, bool), tps55288::Error<I2C::Error>>
where
    I2C: embedded_hal_async::i2c::I2c,
{
    use tps55288::registers::{IoutLimitBits, addr, code_to_ilim_ma};

    let mut dev = tps55288::Tps55288::with_address(i2c, TPS55288_ADDR_7BIT);
    let val = dev.read_reg(addr::IOUT_LIMIT).await?;
    let enabled = (val & IoutLimitBits::EN.bits()) != 0;
    let code = val & 0x7F;
    Ok((code_to_ilim_ma(code), enabled))
}

pub fn should_refresh_iout_limit_readback(
    setpoint_available: bool,
    setpoint_changed: bool,
    has_cached_readback: bool,
    last_attempt_uptime_ms: Option<u64>,
    now_uptime_ms: u64,
) -> bool {
    if !setpoint_available {
        return false;
    }
    if setpoint_changed {
        return true;
    }
    let Some(last_attempt_uptime_ms) = last_attempt_uptime_ms else {
        return true;
    };
    let refresh_interval_ms = if has_cached_readback {
        TPS_IOUT_LIMIT_READBACK_REFRESH_MS
    } else {
        TPS_IOUT_LIMIT_READBACK_RETRY_MS
    };
    now_uptime_ms.saturating_sub(last_attempt_uptime_ms) >= refresh_interval_ms
}

pub async fn apply_setpoint_before_enable<I2C>(
    i2c: &mut I2C,
    state: &mut TpsApplyState,
    setpoint: PowerSetpoint,
) -> Result<u8, tps55288::Error<I2C::Error>>
where
    I2C: embedded_hal_async::i2c::I2c,
{
    use tps55288::registers::{ModeBits, addr};

    let mut dev = tps55288::Tps55288::with_address(i2c, TPS55288_ADDR_7BIT);
    let mut mode = ModeBits::from_bits_truncate(dev.read_reg(addr::MODE).await?);
    if mode.contains(ModeBits::DISCHG) {
        mode.remove(ModeBits::DISCHG);
        dev.write_reg(addr::MODE, mode.bits()).await?;
    }
    dev.set_ilim_ma(setpoint.i_lim_ma, true).await?;
    dev.set_vout_mv(setpoint.v_out_mv).await?;
    mode.insert(ModeBits::OE);
    state.last = None;
    Ok(mode.bits())
}

/// Caller-maintained state for "minimal write" TPS programming.
///
/// Store this alongside your PD/I2C coordinator so repeated calls can no-op when the
/// quantized setpoint is unchanged.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct TpsApplyState {
    pub last: Option<PowerSetpoint>,
    pub light_load_mode: Option<LightLoadMode>,
}

impl TpsApplyState {
    pub const fn new() -> Self {
        Self {
            last: None,
            light_load_mode: None,
        }
    }
}

/// Convert a `PowerRequest` into a safe, quantized `PowerSetpoint` for TPS55288.
///
/// Notes:
/// - Voltage is quantized with floor/truncation (never exceeds request due to rounding).
/// - Current limit applies a 50 mA safety margin before quantization when feasible.
pub fn power_request_to_setpoint(request: PowerRequest) -> PowerSetpoint {
    PowerSetpoint {
        output_enabled: true,
        discharge_enabled: false,
        v_out_mv: quantize_vout_mv_floor(request.v_req_mv),
        i_lim_ma: quantize_ilim_ma_floor_with_margin(request.i_req_ma),
    }
}

fn quantize_vout_mv_floor(mv: u16) -> u16 {
    use tps55288::registers::{VOUT_LSB_MV, VOUT_MAX_MV, VOUT_MIN_MV};

    let mv = mv.clamp(VOUT_MIN_MV, VOUT_MAX_MV);
    let steps = mv.saturating_sub(VOUT_MIN_MV) / VOUT_LSB_MV;
    VOUT_MIN_MV + steps * VOUT_LSB_MV
}

fn quantize_ilim_ma_floor_with_margin(ma: u16) -> u16 {
    use tps55288::registers::{ILIM_LSB_MA, ILIM_MAX_MA};

    let ma = ma.saturating_sub(ILIM_LSB_MA);
    let ma = ma.min(ILIM_MAX_MA);
    (ma / ILIM_LSB_MA) * ILIM_LSB_MA
}

/// Apply a `PowerSetpoint` to TPS55288 (I2C address 0x74) using a safe write order.
///
/// Hardware note: TPS55288 MODE/RMODE is set by `R35=75kΩ` (external VCC, 0x74, PFM).
/// The driver calls below only change OE while preserving the other MODE bits.
///
/// Safe order:
/// - Never disable output when `setpoint.output_enabled = true` (avoids VOUT dropouts).
/// - Only disable output when the setpoint explicitly requests it.
///
/// Minimal write policy: if `setpoint == state.last`, this is a no-op.
pub async fn apply_setpoint<I2C>(
    i2c: &mut I2C,
    state: &mut TpsApplyState,
    setpoint: PowerSetpoint,
) -> Result<(), tps55288::Error<I2C::Error>>
where
    I2C: embedded_hal_async::i2c::I2c,
{
    if state.last == Some(setpoint) {
        return Ok(());
    }

    let mut dev = tps55288::Tps55288::with_address(i2c, TPS55288_ADDR_7BIT);

    if setpoint.output_enabled {
        let mut mode = tps55288::registers::ModeBits::from_bits_truncate(
            dev.read_reg(tps55288::registers::addr::MODE).await?,
        );
        if mode.contains(tps55288::registers::ModeBits::DISCHG) != setpoint.discharge_enabled {
            if setpoint.discharge_enabled {
                mode.insert(tps55288::registers::ModeBits::DISCHG);
            } else {
                mode.remove(tps55288::registers::ModeBits::DISCHG);
            }
            dev.write_reg(tps55288::registers::addr::MODE, mode.bits())
                .await?;
        }
        dev.set_ilim_ma(setpoint.i_lim_ma, true).await?;
        dev.set_vout_mv(setpoint.v_out_mv).await?;
        dev.enable_output().await?;
    } else {
        let mut mode = tps55288::registers::ModeBits::from_bits_truncate(
            dev.read_reg(tps55288::registers::addr::MODE).await?,
        );
        if setpoint.discharge_enabled {
            mode.insert(tps55288::registers::ModeBits::DISCHG);
        } else {
            mode.remove(tps55288::registers::ModeBits::DISCHG);
        }
        mode.remove(tps55288::registers::ModeBits::OE);
        dev.write_reg(tps55288::registers::addr::MODE, mode.bits())
            .await?;
    }

    state.last = Some(setpoint);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readback_refreshes_immediately_on_setpoint_change() {
        assert!(should_refresh_iout_limit_readback(
            true,
            true,
            true,
            Some(500),
            550,
        ));
    }

    #[test]
    fn readback_does_not_refresh_without_a_setpoint() {
        assert!(!should_refresh_iout_limit_readback(
            false, false, false, None, 0,
        ));
    }

    #[test]
    fn readback_retries_missing_cache_after_short_backoff() {
        assert!(!should_refresh_iout_limit_readback(
            true,
            false,
            false,
            Some(1_000),
            1_050,
        ));
        assert!(should_refresh_iout_limit_readback(
            true,
            false,
            false,
            Some(1_000),
            1_100,
        ));
    }

    #[test]
    fn readback_refreshes_cached_value_after_longer_interval() {
        assert!(!should_refresh_iout_limit_readback(
            true,
            false,
            true,
            Some(2_000),
            2_900,
        ));
        assert!(should_refresh_iout_limit_readback(
            true,
            false,
            true,
            Some(2_000),
            3_000,
        ));
    }
}
