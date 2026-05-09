use super::{PowerRequest, PowerSetpoint, TPS55288_ADDR_7BIT};

/// Default "keep-alive" setpoint used to power SW2303 before PD negotiation.
///
/// This must stay within the TPS55288 DAC range and should be a safe default on VBUS.
pub const TPS_BOOT_VOUT_MV: u16 = 5_000;
/// Conservative current limit for the boot setpoint (mA).
pub const TPS_BOOT_ILIM_MA: u16 = 6_350;
pub const fn boot_supply_setpoint() -> PowerSetpoint {
    PowerSetpoint {
        output_enabled: true,
        v_out_mv: TPS_BOOT_VOUT_MV,
        i_lim_ma: TPS_BOOT_ILIM_MA,
    }
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
}

impl TpsApplyState {
    pub const fn new() -> Self {
        Self { last: None }
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
        v_out_mv: quantize_vout_mv_floor(request.v_req_mv.max(5_000)),
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
        if mode.contains(tps55288::registers::ModeBits::DISCHG) {
            mode.remove(tps55288::registers::ModeBits::DISCHG);
            dev.write_reg(tps55288::registers::addr::MODE, mode.bits())
                .await?;
        }
        dev.set_ilim_ma(setpoint.i_lim_ma, true).await?;
        dev.set_vout_mv(setpoint.v_out_mv).await?;
        dev.enable_output().await?;
    } else {
        dev.disable_output().await?;
    }

    state.last = Some(setpoint);
    Ok(())
}
