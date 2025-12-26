use embedded_hal::i2c::I2c;

use ina226::{AVG, Config, INA226, MODE, VBUSCT, VSHCT};

use super::contract::{
    Field, SetApplied, TelemetrySnapshot, VoltageCurrent, derive_u14_meas_from_u17,
};
use super::hardware::{INA226_U17_ADDR_7BIT, U17_I_MAX_MA, U17_R29_SHUNT_RESISTANCE_UOHMS};
use super::i2c_allowlist::{TelemetryI2cAllowlist, TelemetryI2cError};
use crate::pd_i2c::PowerSetpoint;

const INA226_SCALING_VALUE: u64 = 5_120_000_000; // 0.00512 * 1e12

fn ceil_div_u32(n: u32, d: u32) -> u32 {
    if d == 0 {
        return 0;
    }
    (n + (d - 1)) / d
}

fn clamp_u32_to_u16(v: u32) -> u16 {
    v.min(u32::from(u16::MAX)) as u16
}

/// INA226 (U17) sampler for the frozen v1 telemetry snapshot (10 Hz).
///
/// - Uses `TelemetryI2cAllowlist` to ensure only address `0x41` is ever touched.
/// - Stores measurements as integer mV/mA for UI.
pub struct TelemetrySampler<I2C> {
    ina226: INA226<TelemetryI2cAllowlist<I2C>>,
    current_lsb_ua: u32,
}

impl<I2C> TelemetrySampler<I2C>
where
    I2C: I2c,
{
    /// Create a new sampler owning the provided telemetry I2C bus.
    ///
    /// Call [`Self::init`] once after creating the instance.
    pub fn new(i2c: I2C) -> Self {
        Self::new_with_allowlist(TelemetryI2cAllowlist::new(i2c))
    }

    /// Create a new sampler with an already-wrapped I2C allowlist bus.
    pub fn new_with_allowlist(i2c: TelemetryI2cAllowlist<I2C>) -> Self {
        let ina226 = INA226::new(i2c, INA226_U17_ADDR_7BIT);
        let current_lsb_ua = ceil_div_u32(u32::from(U17_I_MAX_MA) * 1_000, 1 << 15);
        Self {
            ina226,
            current_lsb_ua,
        }
    }

    /// Initialize INA226 for ~10 Hz sampling (continuous conversions) and calibrate
    /// it for the shared shunt resistor and expected maximum current.
    pub fn init(&mut self) -> Result<(), TelemetryI2cError<I2C::Error>> {
        let config = Config {
            avg: AVG::_16,
            vbusct: VBUSCT::_1100us,
            vshct: VSHCT::_1100us,
            mode: MODE::ShuntBusVoltageContinuous,
        };

        self.ina226.set_configuration(&config)?;

        // Calibration = 0.00512 / (current_lsb * rshunt)
        // Using integer math:
        // - current_lsb in uA/bit => current_lsb(A) = current_lsb_uA / 1e6
        // - rshunt in uOhm => rshunt(Ohm) = rshunt_uOhm / 1e6
        // - denom = current_lsb_uA * rshunt_uOhm / 1e12
        // - calib = 0.00512 / denom = 0.00512 * 1e12 / (current_lsb_uA * rshunt_uOhm)
        let denom = (self.current_lsb_ua as u64) * (U17_R29_SHUNT_RESISTANCE_UOHMS as u64);
        let cal = if denom == 0 {
            0
        } else {
            (INA226_SCALING_VALUE / denom).min(u64::from(u16::MAX)) as u16
        };

        self.ina226.set_callibration_raw(cal)?;
        Ok(())
    }

    pub fn into_i2c(self) -> TelemetryI2cAllowlist<I2C> {
        self.ina226.destroy()
    }

    /// Sample U17(meas), derive U14(meas), and attach SET(applied).
    ///
    /// Frozen v1 error policy:
    /// - Each U17 field becomes `Err` on read/compute failures.
    /// - U14 is derived and becomes fully `Err` if any U17 field is `Err`.
    /// - SET(applied) comes from the input `PowerSetpoint`.
    pub fn sample_snapshot(&mut self, setpoint_applied: PowerSetpoint) -> TelemetrySnapshot {
        let voltage_mv = match self.ina226.bus_voltage_raw() {
            Ok(raw) => {
                // INA226 bus voltage LSB: 1.25 mV
                let mv = ((u32::from(raw) * 125) + 50) / 100;
                Field::Ok(clamp_u32_to_u16(mv))
            }
            Err(_) => Field::Err,
        };

        let current_ma = match self.ina226.current_raw() {
            Ok(raw) if raw >= 0 => {
                // current = raw * current_lsb (uA/bit)
                let ua = (raw as u32).saturating_mul(self.current_lsb_ua);
                let ma = (ua + 500) / 1_000;
                Field::Ok(clamp_u32_to_u16(ma))
            }
            Ok(_) => Field::Err, // negative current not representable in v1 contract (u16)
            Err(_) => Field::Err,
        };

        let u17_meas = VoltageCurrent {
            voltage_mv,
            current_ma,
        };

        let u14_meas = if u17_meas.voltage_mv.is_err() || u17_meas.current_ma.is_err() {
            VoltageCurrent::err()
        } else {
            derive_u14_meas_from_u17(u17_meas)
        };

        TelemetrySnapshot {
            u17_meas,
            u14_meas,
            set_applied: SetApplied::from(setpoint_applied),
        }
    }
}
