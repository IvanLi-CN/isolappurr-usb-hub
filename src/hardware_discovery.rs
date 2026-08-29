use embedded_hal_async::i2c::I2c;
use fusb302::Fusb302;
use isolapurr_firmware_core::hardware_discovery::{
    Fusb302Evidence, HardwareDiscoveryV1, Ina226Evidence,
};

const INA226_U17_ADDR_7BIT: u8 = 0x41;

/// Probe a fixed FUSB302 location without scanning or changing device state.
pub async fn probe_fusb<I2C>(i2c: &mut I2C) -> Fusb302Evidence
where
    I2C: I2c,
{
    let mut device = Fusb302::new(&mut *i2c);
    let first = device.device_id().await.ok().map(|id| id.bits());
    let second = device.device_id().await.ok().map(|id| id.bits());
    let acknowledged = first.is_some() && second.is_some();
    let stable_reads = if first.is_some() && first == second {
        2
    } else {
        0
    };
    Fusb302Evidence {
        acknowledged,
        family_id: second.or(first),
        stable_reads,
    }
}

/// Probe INA226 manufacturer and die IDs at the documented U17 address.
pub async fn probe_ina226<I2C>(i2c: &mut I2C) -> Ina226Evidence
where
    I2C: I2c,
{
    let mut device = ina226::INA226::new(&mut *i2c, INA226_U17_ADDR_7BIT);
    let first = device
        .manufacturer_id()
        .await
        .ok()
        .zip(device.die_id().await.ok());
    let second = device
        .manufacturer_id()
        .await
        .ok()
        .zip(device.die_id().await.ok());
    let acknowledged = first.is_some() && second.is_some();
    let stable_reads = if first.is_some() && first == second {
        2
    } else {
        0
    };
    Ina226Evidence {
        acknowledged,
        manufacturer_id: second.or(first).map(|ids| ids.0),
        die_id: second.or(first).map(|ids| ids.1),
        stable_reads,
    }
}

/// Read only the three fixed positive vectors required by HardwareDiscoveryV1.
pub async fn probe_topology<I2C0, I2C1>(i2c0: &mut I2C0, i2c1: &mut I2C1) -> HardwareDiscoveryV1
where
    I2C0: I2c,
    I2C1: I2c,
{
    HardwareDiscoveryV1 {
        u10_fusb: probe_fusb(i2c0).await,
        u11_fusb: probe_fusb(i2c1).await,
        u17_ina226: probe_ina226(i2c1).await,
    }
}
