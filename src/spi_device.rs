use core::convert::Infallible;

use embedded_hal::digital::OutputPin;
use embedded_hal_async::spi::{ErrorKind, ErrorType, Operation, SpiBus, SpiDevice};
use esp_hal::time::{Duration, Instant};

pub trait AsyncOutputPin {
    type Error: core::fmt::Debug;

    async fn set_low(&mut self) -> Result<(), Self::Error>;
    async fn set_high(&mut self) -> Result<(), Self::Error>;
}

impl<P> AsyncOutputPin for P
where
    P: OutputPin<Error = Infallible>,
{
    type Error = Infallible;

    async fn set_low(&mut self) -> Result<(), Self::Error> {
        OutputPin::set_low(self)
    }

    async fn set_high(&mut self) -> Result<(), Self::Error> {
        OutputPin::set_high(self)
    }
}

#[derive(Debug)]
pub enum CsSpiDeviceError<BUS, CS> {
    Bus(BUS),
    ChipSelect(CS),
}

impl<BUS, CS> embedded_hal_async::spi::Error for CsSpiDeviceError<BUS, CS>
where
    BUS: embedded_hal_async::spi::Error,
    CS: core::fmt::Debug,
{
    fn kind(&self) -> ErrorKind {
        match self {
            Self::Bus(err) => err.kind(),
            Self::ChipSelect(_) => ErrorKind::ChipSelectFault,
        }
    }
}

pub struct CsSpiDevice<BUS, CS> {
    bus: BUS,
    cs: CS,
}

impl<BUS, CS> CsSpiDevice<BUS, CS> {
    pub const fn new(bus: BUS, cs: CS) -> Self {
        Self { bus, cs }
    }
}

fn spin_delay_ns(ns: u32) {
    if ns == 0 {
        return;
    }
    let us = (u64::from(ns) + 999) / 1_000;
    let start = Instant::now();
    while start.elapsed() < Duration::from_micros(us) {}
}

impl<BUS, CS> ErrorType for CsSpiDevice<BUS, CS>
where
    BUS: SpiBus<u8>,
    CS: AsyncOutputPin,
{
    type Error = CsSpiDeviceError<BUS::Error, CS::Error>;
}

impl<BUS, CS> SpiDevice<u8> for CsSpiDevice<BUS, CS>
where
    BUS: SpiBus<u8>,
    CS: AsyncOutputPin,
{
    async fn transaction(
        &mut self,
        operations: &mut [Operation<'_, u8>],
    ) -> Result<(), Self::Error> {
        self.cs
            .set_low()
            .await
            .map_err(CsSpiDeviceError::ChipSelect)?;

        for op in operations {
            let result = match op {
                Operation::Read(buf) => self.bus.read(buf).await,
                Operation::Write(buf) => self.bus.write(buf).await,
                Operation::Transfer(read, write) => self.bus.transfer(read, write).await,
                Operation::TransferInPlace(buf) => self.bus.transfer_in_place(buf).await,
                Operation::DelayNs(ns) => {
                    spin_delay_ns(*ns);
                    Ok(())
                }
            };

            if let Err(err) = result {
                self.cs.set_high().await.ok();
                return Err(CsSpiDeviceError::Bus(err));
            }
        }

        if let Err(err) = self.bus.flush().await {
            self.cs.set_high().await.ok();
            return Err(CsSpiDeviceError::Bus(err));
        }

        self.cs
            .set_high()
            .await
            .map_err(CsSpiDeviceError::ChipSelect)?;
        Ok(())
    }
}
