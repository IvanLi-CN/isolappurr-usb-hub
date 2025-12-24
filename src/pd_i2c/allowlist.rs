use embedded_hal::i2c::{ErrorKind, ErrorType, I2c, Operation};

use super::{SW2303_ADDR_7BIT, TPS55288_ADDR_7BIT};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PdI2cAddr {
    Sw2303,
    Tps55288,
}

impl PdI2cAddr {
    pub const fn as_7bit(self) -> u8 {
        match self {
            Self::Sw2303 => SW2303_ADDR_7BIT,
            Self::Tps55288 => TPS55288_ADDR_7BIT,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum I2cAllowlistError<E> {
    NotAllowedAddress(u8),
    Bus(E),
}

impl<E> embedded_hal::i2c::Error for I2cAllowlistError<E>
where
    E: embedded_hal::i2c::Error,
{
    fn kind(&self) -> ErrorKind {
        match self {
            Self::NotAllowedAddress(_) => ErrorKind::Other,
            Self::Bus(e) => e.kind(),
        }
    }
}

pub struct I2cAllowlist<I2C> {
    inner: I2C,
}

fn ensure_allowed_address<E>(address: u8) -> Result<(), I2cAllowlistError<E>> {
    if address == SW2303_ADDR_7BIT || address == TPS55288_ADDR_7BIT {
        Ok(())
    } else {
        Err(I2cAllowlistError::NotAllowedAddress(address))
    }
}

impl<I2C> I2cAllowlist<I2C> {
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

impl<I2C> ErrorType for I2cAllowlist<I2C>
where
    I2C: ErrorType,
    I2C::Error: embedded_hal::i2c::Error,
{
    type Error = I2cAllowlistError<I2C::Error>;
}

impl<I2C> I2c for I2cAllowlist<I2C>
where
    I2C: I2c,
    I2C::Error: embedded_hal::i2c::Error,
{
    fn read(&mut self, address: u8, buffer: &mut [u8]) -> Result<(), Self::Error> {
        ensure_allowed_address::<I2C::Error>(address)?;
        self.inner
            .read(address, buffer)
            .map_err(I2cAllowlistError::Bus)
    }

    fn write(&mut self, address: u8, bytes: &[u8]) -> Result<(), Self::Error> {
        ensure_allowed_address::<I2C::Error>(address)?;
        self.inner
            .write(address, bytes)
            .map_err(I2cAllowlistError::Bus)
    }

    fn write_read(
        &mut self,
        address: u8,
        bytes: &[u8],
        buffer: &mut [u8],
    ) -> Result<(), Self::Error> {
        ensure_allowed_address::<I2C::Error>(address)?;
        self.inner
            .write_read(address, bytes, buffer)
            .map_err(I2cAllowlistError::Bus)
    }

    fn transaction(
        &mut self,
        address: u8,
        operations: &mut [Operation<'_>],
    ) -> Result<(), Self::Error> {
        ensure_allowed_address::<I2C::Error>(address)?;
        self.inner
            .transaction(address, operations)
            .map_err(I2cAllowlistError::Bus)
    }
}
