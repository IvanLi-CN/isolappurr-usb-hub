use embedded_hal::i2c::{
    Error, ErrorKind, ErrorType, I2c, NoAcknowledgeSource, Operation, SevenBitAddress,
};

use super::hardware::{INA226_U13_ADDR_7BIT, INA226_U17_ADDR_7BIT};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TelemetryI2cError<E> {
    AddressNotAllowed(SevenBitAddress),
    Bus(E),
}

impl<E: Error> Error for TelemetryI2cError<E> {
    fn kind(&self) -> ErrorKind {
        match self {
            Self::AddressNotAllowed(_) => ErrorKind::NoAcknowledge(NoAcknowledgeSource::Address),
            Self::Bus(e) => e.kind(),
        }
    }
}

/// Telemetry-only I2C allowlist wrapper.
///
/// Frozen v1 policy:
/// - Only allow INA226 (U13/U17) at addresses `0x40` / `0x41`
/// - Never scan / never touch other devices on the same bus (e.g. EEPROM @ 0x50)
pub struct TelemetryI2cAllowlist<I2C> {
    inner: I2C,
}

impl<I2C> TelemetryI2cAllowlist<I2C> {
    pub const fn new(inner: I2C) -> Self {
        Self { inner }
    }

    pub fn into_inner(self) -> I2C {
        self.inner
    }

    pub fn inner_mut(&mut self) -> &mut I2C {
        &mut self.inner
    }
}

impl<I2C: ErrorType> ErrorType for TelemetryI2cAllowlist<I2C> {
    type Error = TelemetryI2cError<I2C::Error>;
}

impl<I2C> I2c<SevenBitAddress> for TelemetryI2cAllowlist<I2C>
where
    I2C: I2c<SevenBitAddress>,
{
    fn transaction(
        &mut self,
        address: SevenBitAddress,
        operations: &mut [Operation<'_>],
    ) -> Result<(), Self::Error> {
        if address != INA226_U13_ADDR_7BIT && address != INA226_U17_ADDR_7BIT {
            return Err(TelemetryI2cError::AddressNotAllowed(address));
        }

        self.inner
            .transaction(address, operations)
            .map_err(TelemetryI2cError::Bus)
    }
}
