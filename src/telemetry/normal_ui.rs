use embedded_hal::i2c::I2c;

use ina226::{AVG, Config, INA226, MODE, VBUSCT, VSHCT};

use super::contract::Field;
use super::hardware::{INA226_U13_ADDR_7BIT, INA226_U17_ADDR_7BIT};
use super::i2c_allowlist::{TelemetryI2cAllowlist, TelemetryI2cError};

// Spec: docs/spec/gc9307-normal-ui.md §7.1.1 / §7.2 (frozen on PM branch).
const U13_CURRENT_LSB_UA_PER_BIT: u32 = 62;
const U13_CALIBRATION: u16 = 8258;

const U17_CURRENT_LSB_UA_PER_BIT: u32 = 107;
const U17_CALIBRATION: u16 = 4785;

const POWER_LSB_MULTIPLIER: u32 = 25;

fn ina226_config_for_continuous_sampling() -> Config {
    Config {
        avg: AVG::_16,
        vbusct: VBUSCT::_1100us,
        vshct: VSHCT::_1100us,
        mode: MODE::ShuntBusVoltageContinuous,
    }
}

fn bus_voltage_raw_to_mv(raw: u16) -> u32 {
    // INA226 bus voltage LSB: 1.25 mV
    // Rounding policy: match existing sampler (half-up).
    ((u32::from(raw) * 125) + 50) / 100
}

fn current_raw_to_ma(raw: i16, current_lsb_ua_per_bit: u32) -> Field<u32> {
    if raw < 0 {
        return Field::Err;
    }

    // current(uA) = raw * Current_LSB(uA/bit)
    // current(mA) = current(uA) / 1000 (half-up)
    let ua = (raw as u32).saturating_mul(current_lsb_ua_per_bit);
    Field::Ok((ua + 500) / 1_000)
}

fn power_raw_to_mw(raw: u16, current_lsb_ua_per_bit: u32) -> u32 {
    // Power_LSB(W/bit) = 25 * Current_LSB(A/bit)
    // Power(mW) = raw * Power_LSB * 1000
    //          = raw * (25 * Current_LSB_uA) / 1000  (half-up)
    let numerator =
        (u64::from(raw)) * (u64::from(POWER_LSB_MULTIPLIER) * u64::from(current_lsb_ua_per_bit));
    ((numerator + 500) / 1_000) as u32
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PortMetrics {
    pub voltage_mv: Field<u32>,
    pub current_ma: Field<u32>,
    pub power_mw: Field<u32>,
}

impl PortMetrics {
    pub const fn err() -> Self {
        Self {
            voltage_mv: Field::Err,
            current_ma: Field::Err,
            power_mw: Field::Err,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NormalUiTelemetrySnapshot {
    pub usb_a: PortMetrics,
    pub usb_c: PortMetrics,
}

struct TelemetryI2cBorrow<'a, I2C>(&'a mut TelemetryI2cAllowlist<I2C>);

impl<'a, I2C> TelemetryI2cBorrow<'a, I2C> {
    fn new(inner: &'a mut TelemetryI2cAllowlist<I2C>) -> Self {
        Self(inner)
    }
}

impl<I2C> embedded_hal::i2c::ErrorType for TelemetryI2cBorrow<'_, I2C>
where
    TelemetryI2cAllowlist<I2C>: embedded_hal::i2c::ErrorType,
{
    type Error = <TelemetryI2cAllowlist<I2C> as embedded_hal::i2c::ErrorType>::Error;
}

impl<I2C> embedded_hal::i2c::I2c for TelemetryI2cBorrow<'_, I2C>
where
    TelemetryI2cAllowlist<I2C>: embedded_hal::i2c::I2c,
{
    fn transaction(
        &mut self,
        address: embedded_hal::i2c::SevenBitAddress,
        operations: &mut [embedded_hal::i2c::Operation<'_>],
    ) -> Result<(), Self::Error> {
        self.0.transaction(address, operations)
    }
}

/// Normal UI sampler (GC9307): two ports × (V/I/P) from dedicated INA226s.
///
/// - USB-A: INA226 U13 @ `0x40`
/// - USB-C/PD: INA226 U17 @ `0x41`
/// - Power is sourced from INA226 Power register (not V×I).
pub struct NormalUiTelemetrySampler<I2C> {
    i2c: TelemetryI2cAllowlist<I2C>,
}

impl<I2C> NormalUiTelemetrySampler<I2C>
where
    I2C: I2c,
{
    pub fn new(i2c: I2C) -> Self {
        Self::new_with_allowlist(TelemetryI2cAllowlist::new(i2c))
    }

    pub const fn new_with_allowlist(i2c: TelemetryI2cAllowlist<I2C>) -> Self {
        Self { i2c }
    }

    pub fn into_i2c(self) -> TelemetryI2cAllowlist<I2C> {
        self.i2c
    }

    pub fn init(&mut self) -> Result<(), TelemetryI2cError<I2C::Error>> {
        let config = ina226_config_for_continuous_sampling();

        {
            let mut u13 = INA226::new(TelemetryI2cBorrow::new(&mut self.i2c), INA226_U13_ADDR_7BIT);
            u13.set_configuration(&config)?;
            u13.set_callibration_raw(U13_CALIBRATION)?;
        }

        {
            let mut u17 = INA226::new(TelemetryI2cBorrow::new(&mut self.i2c), INA226_U17_ADDR_7BIT);
            u17.set_configuration(&config)?;
            u17.set_callibration_raw(U17_CALIBRATION)?;
        }

        Ok(())
    }

    pub fn sample(&mut self) -> NormalUiTelemetrySnapshot {
        let usb_a = self.sample_port(INA226_U13_ADDR_7BIT, U13_CURRENT_LSB_UA_PER_BIT);
        let usb_c = self.sample_port(INA226_U17_ADDR_7BIT, U17_CURRENT_LSB_UA_PER_BIT);

        NormalUiTelemetrySnapshot { usb_a, usb_c }
    }

    fn sample_port(&mut self, address: u8, current_lsb_ua_per_bit: u32) -> PortMetrics {
        let mut ina226 = INA226::new(TelemetryI2cBorrow::new(&mut self.i2c), address);

        let voltage_mv = match ina226.bus_voltage_raw() {
            Ok(raw) => Field::Ok(bus_voltage_raw_to_mv(raw)),
            Err(_) => Field::Err,
        };

        let current_ma = match ina226.current_raw() {
            Ok(raw) => current_raw_to_ma(raw, current_lsb_ua_per_bit),
            Err(_) => Field::Err,
        };

        let power_mw = match ina226.power_raw() {
            Ok(raw) => Field::Ok(power_raw_to_mw(raw, current_lsb_ua_per_bit)),
            Err(_) => Field::Err,
        };

        PortMetrics {
            voltage_mv,
            current_ma,
            power_mw,
        }
    }
}
