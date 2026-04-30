use embassy_sync::blocking_mutex::raw::CriticalSectionRawMutex;
use embassy_sync::mutex::Mutex;
use embassy_time::Timer;
use embedded_hal::i2c::{Error as I2cError, ErrorType, SevenBitAddress};
use embedded_hal_async::i2c::{I2c, Operation};

use crate::spi_device::AsyncOutputPin;

const REG_OUTPUT: u8 = 0x01;
const REG_CONFIG: u8 = 0x03;

pub const FRONT_PANEL_TCA_ADDR: SevenBitAddress = 0x21;
pub const DISPLAY_RES_BIT: u8 = 5;
pub const DISPLAY_CS_BIT: u8 = 6;

type I2cBusMutex<BUS> = Mutex<CriticalSectionRawMutex, BUS>;

#[derive(Clone, Copy)]
pub struct SharedI2c<'a, BUS> {
    bus: &'a I2cBusMutex<BUS>,
}

impl<'a, BUS> SharedI2c<'a, BUS> {
    pub const fn new(bus: &'a I2cBusMutex<BUS>) -> Self {
        Self { bus }
    }
}

impl<BUS> ErrorType for SharedI2c<'_, BUS>
where
    BUS: ErrorType,
{
    type Error = BUS::Error;
}

impl<BUS> I2c<SevenBitAddress> for SharedI2c<'_, BUS>
where
    BUS: I2c<SevenBitAddress>,
{
    async fn transaction(
        &mut self,
        address: SevenBitAddress,
        operations: &mut [Operation<'_>],
    ) -> Result<(), Self::Error> {
        let mut bus = self.bus.lock().await;
        bus.transaction(address, operations).await
    }
}

#[derive(Debug)]
pub enum Tca9554Error<E> {
    I2c(E),
    InvalidBit,
}

pub struct Tca9554<I2C> {
    i2c: I2C,
    address: SevenBitAddress,
}

impl<I2C> Tca9554<I2C>
where
    I2C: I2c<SevenBitAddress>,
    I2C::Error: I2cError,
{
    pub const fn new(i2c: I2C, address: SevenBitAddress) -> Self {
        Self { i2c, address }
    }

    pub async fn init_outputs_high(&mut self, mask: u8) -> Result<(), Tca9554Error<I2C::Error>> {
        let output = self.read_register(REG_OUTPUT).await?;
        self.write_register(REG_OUTPUT, output | mask).await?;

        let config = self.read_register(REG_CONFIG).await?;
        self.write_register(REG_CONFIG, config & !mask).await
    }

    pub async fn reset_active_low(&mut self, bit: u8) -> Result<(), Tca9554Error<I2C::Error>> {
        self.set_bit(bit, true).await?;
        Timer::after_millis(10).await;
        self.set_bit(bit, false).await?;
        Timer::after_millis(10).await;
        self.set_bit(bit, true).await
    }

    pub fn into_output_pin(self, bit: u8) -> Result<TcaOutputPin<I2C>, Tca9554Error<I2C::Error>> {
        if bit > 7 {
            return Err(Tca9554Error::InvalidBit);
        }
        Ok(TcaOutputPin { tca: self, bit })
    }

    async fn set_bit(&mut self, bit: u8, high: bool) -> Result<(), Tca9554Error<I2C::Error>> {
        if bit > 7 {
            return Err(Tca9554Error::InvalidBit);
        }

        let mask = 1 << bit;
        let output = self.read_register(REG_OUTPUT).await?;
        let next = if high { output | mask } else { output & !mask };
        self.write_register(REG_OUTPUT, next).await
    }

    async fn read_register(&mut self, register: u8) -> Result<u8, Tca9554Error<I2C::Error>> {
        let mut value = [0_u8; 1];
        let write = [register];
        let mut operations = [Operation::Write(&write), Operation::Read(&mut value)];
        self.i2c
            .transaction(self.address, &mut operations)
            .await
            .map_err(Tca9554Error::I2c)?;
        Ok(value[0])
    }

    async fn write_register(
        &mut self,
        register: u8,
        value: u8,
    ) -> Result<(), Tca9554Error<I2C::Error>> {
        let write = [register, value];
        let mut operations = [Operation::Write(&write)];
        self.i2c
            .transaction(self.address, &mut operations)
            .await
            .map_err(Tca9554Error::I2c)
    }
}

pub struct TcaOutputPin<I2C> {
    tca: Tca9554<I2C>,
    bit: u8,
}

impl<I2C> AsyncOutputPin for TcaOutputPin<I2C>
where
    I2C: I2c<SevenBitAddress>,
    I2C::Error: I2cError,
{
    type Error = Tca9554Error<I2C::Error>;

    async fn set_low(&mut self) -> Result<(), Self::Error> {
        self.tca.set_bit(self.bit, false).await
    }

    async fn set_high(&mut self) -> Result<(), Self::Error> {
        self.tca.set_bit(self.bit, true).await
    }
}

#[derive(Clone, Copy, Debug)]
pub struct NoopResetPin;

impl embedded_hal::digital::ErrorType for NoopResetPin {
    type Error = core::convert::Infallible;
}

impl embedded_hal::digital::OutputPin for NoopResetPin {
    fn set_low(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }

    fn set_high(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }
}
