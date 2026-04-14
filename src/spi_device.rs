use core::convert::Infallible;

use embedded_hal::digital::OutputPin;
use embedded_hal_async::spi::{ErrorType, Operation, SpiBus, SpiDevice};
use esp_hal::time::{Duration, Instant};

pub struct CsSpiDevice<BUS, CS> {
    bus: BUS,
    cs: CS,
}

impl<BUS, CS> CsSpiDevice<BUS, CS> {
    pub const fn new(bus: BUS, cs: CS) -> Self {
        Self { bus, cs }
    }
}

struct CsGuard<'a, CS: OutputPin<Error = Infallible>> {
    cs: &'a mut CS,
}

impl<CS: OutputPin<Error = Infallible>> Drop for CsGuard<'_, CS> {
    fn drop(&mut self) {
        self.cs.set_high().ok();
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
    CS: OutputPin<Error = Infallible>,
{
    type Error = BUS::Error;
}

impl<BUS, CS> SpiDevice<u8> for CsSpiDevice<BUS, CS>
where
    BUS: SpiBus<u8>,
    CS: OutputPin<Error = Infallible>,
{
    async fn transaction(
        &mut self,
        operations: &mut [Operation<'_, u8>],
    ) -> Result<(), Self::Error> {
        self.cs.set_low().ok();
        let _guard = CsGuard { cs: &mut self.cs };

        for op in operations {
            match op {
                Operation::Read(buf) => self.bus.read(buf).await?,
                Operation::Write(buf) => self.bus.write(buf).await?,
                Operation::Transfer(read, write) => self.bus.transfer(read, write).await?,
                Operation::TransferInPlace(buf) => self.bus.transfer_in_place(buf).await?,
                Operation::DelayNs(ns) => spin_delay_ns(*ns),
            }
        }

        self.bus.flush().await?;
        Ok(())
    }
}
