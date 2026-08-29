use embassy_time::Timer;
use fusb302::{Fusb302, PdPacket, SopType};
use usbpd_traits::{Driver, DriverRxError, DriverTxError};

/// Adapter from the typed FUSB302 FIFO API to `usbpd` 2.0's async Driver.
/// Hardware GoodCRC and retry are enabled by the PHY setup before this driver
/// is handed to the sink policy engine.
pub struct Fusb302UsbpdDriver<I2C> {
    phy: Fusb302<I2C>,
    vbus_present: bool,
}

impl<I2C> Fusb302UsbpdDriver<I2C> {
    pub const fn new(phy: Fusb302<I2C>) -> Self {
        Self {
            phy,
            vbus_present: false,
        }
    }

    pub const fn set_vbus_present(&mut self, present: bool) {
        self.vbus_present = present;
    }

    pub fn into_inner(self) -> Fusb302<I2C> {
        self.phy
    }
}

impl<I2C> Driver for Fusb302UsbpdDriver<I2C>
where
    I2C: embedded_hal_async::i2c::I2c,
{
    const HAS_AUTO_GOOD_CRC: bool = true;
    const HAS_AUTO_RETRY: bool = true;

    async fn wait_for_vbus(&mut self) {
        while !self.vbus_present {
            Timer::after_millis(1).await;
        }
    }

    async fn receive(&mut self, buffer: &mut [u8]) -> Result<usize, DriverRxError> {
        loop {
            match self.phy.receive().await {
                Ok(Some(packet)) => {
                    let payload = packet.payload();
                    let needed = payload.len() + 2;
                    if buffer.len() < needed {
                        return Err(DriverRxError::Discarded);
                    }
                    buffer[..2].copy_from_slice(&packet.header().to_le_bytes());
                    buffer[2..needed].copy_from_slice(payload);
                    return Ok(needed);
                }
                Ok(None) => Timer::after_millis(1).await,
                Err(fusb302::Error::Receive(_)) => return Err(DriverRxError::Discarded),
                Err(_) => return Err(DriverRxError::HardReset),
            }
        }
    }

    async fn transmit(&mut self, data: &[u8]) -> Result<(), DriverTxError> {
        if data.len() < 2 {
            return Err(DriverTxError::Discarded);
        }
        let header = u16::from_le_bytes([data[0], data[1]]);
        let packet = PdPacket::new(SopType::Sop, header, &data[2..])
            .map_err(|_| DriverTxError::Discarded)?;
        self.phy
            .transmit(&packet)
            .await
            .map_err(|_| DriverTxError::Discarded)
    }

    async fn transmit_hard_reset(&mut self) -> Result<(), DriverTxError> {
        self.phy
            .transmit_hard_reset()
            .await
            .map_err(|_| DriverTxError::HardReset)
    }
}
