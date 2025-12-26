#![no_std]

use core::convert::Infallible;

use embedded_hal::digital::OutputPin;
use embedded_hal::spi::{Operation, SpiBus, SpiDevice};
use esp_hal::time::{Duration, Instant};

pub struct CsSpiDevice<BUS, CS> {
    bus: BUS,
    cs: CS,
}

impl<BUS, CS> CsSpiDevice<BUS, CS> {
    pub const fn new(bus: BUS, cs: CS) -> Self {
        Self { bus, cs }
    }

    pub fn into_inner(self) -> (BUS, CS) {
        (self.bus, self.cs)
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

impl<BUS, CS, E> SpiDevice<u8> for CsSpiDevice<BUS, CS>
where
    BUS: SpiBus<u8, Error = E>,
    CS: OutputPin<Error = Infallible>,
{
    type Error = E;

    fn transaction(&mut self, operations: &mut [Operation<'_, u8>]) -> Result<(), Self::Error> {
        self.cs.set_low().ok();
        let _guard = CsGuard { cs: &mut self.cs };

        for op in operations {
            match op {
                Operation::Read(buf) => self.bus.read(buf)?,
                Operation::Write(buf) => self.bus.write(buf)?,
                Operation::Transfer(read, write) => self.bus.transfer(read, write)?,
                Operation::TransferInPlace(buf) => self.bus.transfer_in_place(buf)?,
                Operation::DelayNs(ns) => spin_delay_ns(*ns),
            }
        }

        Ok(())
    }
}
