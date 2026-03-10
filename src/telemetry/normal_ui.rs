use embedded_hal::i2c::{Error as _, ErrorKind, I2c, NoAcknowledgeSource};

use ina226::{AVG, Config, INA226, MODE, VBUSCT, VSHCT};

use super::contract::Field;
use super::hardware::{
    INA226_U13_ADDR_7BIT, INA226_U13_FALLBACK_ADDR_7BIT, INA226_U17_ADDR_7BIT,
    INA226_U17_FALLBACK_ADDR_7BIT,
};
use super::i2c_allowlist::{TelemetryI2cAllowlist, TelemetryI2cError};

// Plan: docs/plan/0001:gc9307-normal-ui/PLAN.md (INA226 calibration + power source rules).
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

fn is_address_nak<E: embedded_hal::i2c::Error>(err: &TelemetryI2cError<E>) -> bool {
    matches!(
        err.kind(),
        ErrorKind::NoAcknowledge(NoAcknowledgeSource::Address)
    )
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
/// - USB-C/PD: INA226 U17 @ `0x41` (fallback `0x45` for counterfeit/clone chips)
/// - Power is sourced from INA226 Power register (not V×I).
pub struct NormalUiTelemetrySampler<I2C> {
    i2c: TelemetryI2cAllowlist<I2C>,
    usb_a_address: Option<u8>,
    usb_c_address: Option<u8>,
}

impl<I2C> NormalUiTelemetrySampler<I2C>
where
    I2C: I2c,
{
    pub fn new(i2c: I2C) -> Self {
        Self::new_with_allowlist(TelemetryI2cAllowlist::new(i2c))
    }

    pub const fn new_with_allowlist(i2c: TelemetryI2cAllowlist<I2C>) -> Self {
        Self {
            i2c,
            usb_a_address: None,
            usb_c_address: None,
        }
    }

    pub fn into_i2c(self) -> TelemetryI2cAllowlist<I2C> {
        self.i2c
    }

    pub const fn usb_a_address(&self) -> Option<u8> {
        self.usb_a_address
    }

    pub const fn usb_c_address(&self) -> Option<u8> {
        self.usb_c_address
    }

    pub fn init(&mut self) -> Result<(), TelemetryI2cError<I2C::Error>> {
        let usb_a = self.resolve_port_address(
            INA226_U13_ADDR_7BIT,
            INA226_U13_FALLBACK_ADDR_7BIT,
            U13_CALIBRATION,
        );
        let usb_c = self.resolve_port_address(
            INA226_U17_ADDR_7BIT,
            INA226_U17_FALLBACK_ADDR_7BIT,
            U17_CALIBRATION,
        );

        self.usb_a_address = usb_a.as_ref().copied().ok();
        self.usb_c_address = usb_c.as_ref().copied().ok();

        match (usb_a, usb_c) {
            (Ok(_), Ok(_)) => Ok(()),
            (Err(err), _) => Err(err),
            (Ok(_), Err(err)) => Err(err),
        }
    }

    pub fn sample(&mut self) -> NormalUiTelemetrySnapshot {
        if self.usb_a_address.is_none() {
            self.usb_a_address = self
                .resolve_port_address(
                    INA226_U13_ADDR_7BIT,
                    INA226_U13_FALLBACK_ADDR_7BIT,
                    U13_CALIBRATION,
                )
                .ok();
        }
        if self.usb_c_address.is_none() {
            self.usb_c_address = self
                .resolve_port_address(
                    INA226_U17_ADDR_7BIT,
                    INA226_U17_FALLBACK_ADDR_7BIT,
                    U17_CALIBRATION,
                )
                .ok();
        }

        let usb_a = match self.usb_a_address {
            Some(address) => self.sample_port(address, U13_CURRENT_LSB_UA_PER_BIT),
            None => PortMetrics::err(),
        };
        let usb_c = match self.usb_c_address {
            Some(address) => self.sample_port(address, U17_CURRENT_LSB_UA_PER_BIT),
            None => PortMetrics::err(),
        };

        NormalUiTelemetrySnapshot { usb_a, usb_c }
    }

    fn resolve_port_address(
        &mut self,
        primary: u8,
        fallback: u8,
        calibration: u16,
    ) -> Result<u8, TelemetryI2cError<I2C::Error>> {
        let resolved = match self.probe_port(primary) {
            Ok(()) => primary,
            Err(err) if is_address_nak(&err) => {
                self.probe_port(fallback)?;
                fallback
            }
            Err(err) => return Err(err),
        };

        self.configure_port(resolved, calibration)?;
        Ok(resolved)
    }

    fn probe_port(&mut self, address: u8) -> Result<(), TelemetryI2cError<I2C::Error>> {
        let mut ina226 = INA226::new(TelemetryI2cBorrow::new(&mut self.i2c), address);
        let _ = ina226.configuration_raw()?;
        Ok(())
    }

    fn configure_port(
        &mut self,
        address: u8,
        calibration: u16,
    ) -> Result<(), TelemetryI2cError<I2C::Error>> {
        let config = ina226_config_for_continuous_sampling();
        let mut ina226 = INA226::new(TelemetryI2cBorrow::new(&mut self.i2c), address);
        ina226.set_configuration(&config)?;
        ina226.set_callibration_raw(calibration)?;
        Ok(())
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

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use embedded_hal::i2c::{ErrorType, Operation, SevenBitAddress};
    use std::collections::BTreeMap;

    const CONFIG_REGISTER: u8 = 0x00;
    const BUS_VOLTAGE_REGISTER: u8 = 0x02;
    const POWER_REGISTER: u8 = 0x03;
    const CURRENT_REGISTER: u8 = 0x04;
    const CALIBRATION_REGISTER: u8 = 0x05;

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    struct FakeError(ErrorKind);

    impl embedded_hal::i2c::Error for FakeError {
        fn kind(&self) -> ErrorKind {
            self.0
        }
    }

    #[derive(Debug)]
    struct FakeDevice {
        registers: BTreeMap<u8, u16>,
        selected_register: u8,
        calibration_address_nak_remaining: usize,
    }

    impl FakeDevice {
        fn new(bus_voltage_raw: u16, current_raw: i16, power_raw: u16) -> Self {
            let mut registers = BTreeMap::new();
            registers.insert(CONFIG_REGISTER, 0x4527);
            registers.insert(BUS_VOLTAGE_REGISTER, bus_voltage_raw);
            registers.insert(POWER_REGISTER, power_raw);
            registers.insert(CURRENT_REGISTER, current_raw as u16);
            registers.insert(CALIBRATION_REGISTER, 0);
            Self {
                registers,
                selected_register: CONFIG_REGISTER,
                calibration_address_nak_remaining: 0,
            }
        }
    }

    #[derive(Debug)]
    struct FakeI2c {
        devices: BTreeMap<u8, FakeDevice>,
    }

    impl FakeI2c {
        fn new() -> Self {
            Self {
                devices: BTreeMap::new(),
            }
        }

        fn with_device(mut self, address: u8) -> Self {
            self.devices
                .insert(address, FakeDevice::new(3_200, 100, 50));
            self
        }

        fn with_calibration_address_nak(mut self, address: u8, remaining: usize) -> Self {
            self.devices
                .entry(address)
                .or_insert_with(|| FakeDevice::new(3_200, 100, 50))
                .calibration_address_nak_remaining = remaining;
            self
        }
    }

    impl ErrorType for FakeI2c {
        type Error = FakeError;
    }

    impl embedded_hal::i2c::I2c for FakeI2c {
        fn transaction(
            &mut self,
            address: SevenBitAddress,
            operations: &mut [Operation<'_>],
        ) -> Result<(), Self::Error> {
            let device =
                self.devices
                    .get_mut(&address)
                    .ok_or(FakeError(ErrorKind::NoAcknowledge(
                        NoAcknowledgeSource::Address,
                    )))?;

            for operation in operations {
                match operation {
                    Operation::Write(write) => match write.len() {
                        1 => device.selected_register = write[0],
                        3 => {
                            let register = write[0];
                            if register == CALIBRATION_REGISTER
                                && device.calibration_address_nak_remaining > 0
                            {
                                device.calibration_address_nak_remaining -= 1;
                                return Err(FakeError(ErrorKind::NoAcknowledge(
                                    NoAcknowledgeSource::Address,
                                )));
                            }
                            let value = u16::from_be_bytes([write[1], write[2]]);
                            device.registers.insert(register, value);
                        }
                        _ => unreachable!(),
                    },
                    Operation::Read(read) => {
                        let value = *device
                            .registers
                            .get(&device.selected_register)
                            .unwrap_or(&0);
                        let bytes = value.to_be_bytes();
                        read.copy_from_slice(&bytes[..read.len()]);
                    }
                }
            }

            Ok(())
        }
    }

    #[test]
    fn prefers_primary_addresses() {
        let mut sampler =
            NormalUiTelemetrySampler::new(FakeI2c::new().with_device(0x40).with_device(0x41));
        sampler.init().unwrap();

        assert_eq!(sampler.usb_a_address(), Some(0x40));
        assert_eq!(sampler.usb_c_address(), Some(0x41));
    }

    #[test]
    fn falls_back_on_primary_address_nak() {
        let mut sampler =
            NormalUiTelemetrySampler::new(FakeI2c::new().with_device(0x40).with_device(0x45));
        sampler.init().unwrap();

        assert_eq!(sampler.usb_a_address(), Some(0x40));
        assert_eq!(sampler.usb_c_address(), Some(0x45));
    }

    #[test]
    fn usb_c_still_resolves_when_usb_a_missing() {
        let mut sampler = NormalUiTelemetrySampler::new(FakeI2c::new().with_device(0x45));
        assert!(sampler.init().is_err());

        assert_eq!(sampler.usb_a_address(), None);
        assert_eq!(sampler.usb_c_address(), Some(0x45));

        let snapshot = sampler.sample();
        assert_eq!(snapshot.usb_a, PortMetrics::err());
        assert!(matches!(snapshot.usb_c.voltage_mv, Field::Ok(v) if v > 0));
    }

    #[test]
    fn sample_retries_unresolved_primary_without_switching_to_fallback() {
        let fake = FakeI2c::new()
            .with_device(0x41)
            .with_device(0x45)
            .with_calibration_address_nak(0x41, 1);
        let mut sampler = NormalUiTelemetrySampler::new(fake);

        assert!(sampler.init().is_err());
        assert_eq!(sampler.usb_c_address(), None);

        let snapshot = sampler.sample();
        assert_eq!(sampler.usb_c_address(), Some(0x41));
        assert!(matches!(snapshot.usb_c.voltage_mv, Field::Ok(v) if v > 0));
    }
}
