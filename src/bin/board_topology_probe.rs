#![no_std]
#![no_main]

use core::fmt::Write as _;

use embedded_hal_async::i2c::I2c as AsyncI2c;
use esp_hal::clock::CpuClock;
use esp_hal::delay::Delay;
use esp_hal::gpio::{Flex, Level, Output, OutputConfig};
use esp_hal::i2c::master::{Config as I2cConfig, I2c, SoftwareTimeout};
use esp_hal::time::{Duration, Rate};
use esp_hal::usb_serial_jtag::UsbSerialJtag;
use fusb302::Fusb302;
use ina226::INA226;

use {esp_backtrace as _, esp_println as _};

esp_bootloader_esp_idf::esp_app_desc!();

const INA226_ADDR: u8 = 0x41;

/// Adapt the blocking I2C peripheral to the async driver traits used by the
/// typed FUSB302 and INA226 crates. Each operation completes synchronously;
/// this avoids requiring an RTOS scheduler in the RAM-only probe image.
struct BlockingAsyncI2c<I2C>(I2C);

impl<I2C> embedded_hal_async::i2c::ErrorType for BlockingAsyncI2c<I2C>
where
    I2C: embedded_hal::i2c::ErrorType,
{
    type Error = I2C::Error;
}

impl<I2C> AsyncI2c for BlockingAsyncI2c<I2C>
where
    I2C: embedded_hal::i2c::I2c,
{
    async fn transaction(
        &mut self,
        address: u8,
        operations: &mut [embedded_hal_async::i2c::Operation<'_>],
    ) -> Result<(), Self::Error> {
        self.0.transaction(address, operations)
    }
}

#[esp_hal::main]
fn main() -> ! {
    let config = esp_hal::Config::default().with_cpu_clock(CpuClock::max());
    let peripherals = esp_hal::init(config);
    let delay = Delay::new();
    let mut usb = UsbSerialJtag::new(peripherals.USB_DEVICE);
    // Keep the first observable event before I2C so a host can distinguish a
    // loader/startup failure from a topology transaction failure.
    esp_println::println!("PROBE_START");
    let _ = usb.write(b"PROBE_START\n");
    let _ = usb.flush_tx();

    // This image is a recovery probe, so it owns only the common restrictive
    // GPIO vector and never instantiates a profile-specific controller.
    let _vin_en = Output::new(peripherals.GPIO34, Level::Low, OutputConfig::default());
    let _vin_sel = Output::new(peripherals.GPIO35, Level::Low, OutputConfig::default());
    let _vbus_gate = Output::new(peripherals.GPIO36, Level::Low, OutputConfig::default());
    let _ce_tps = Output::new(peripherals.GPIO37, Level::High, OutputConfig::default());
    let _p2_ced = Output::new(peripherals.GPIO2, Level::High, OutputConfig::default());
    let _p1_ced = Output::new(peripherals.GPIO4, Level::High, OutputConfig::default());
    let _p1_esp = Output::new(peripherals.GPIO5, Level::Low, OutputConfig::default());
    let _p1_en_n = Output::new(peripherals.GPIO16, Level::High, OutputConfig::default());
    let _blk = Output::new(peripherals.GPIO15, Level::High, OutputConfig::default());
    let _buzzer = Output::new(peripherals.GPIO21, Level::Low, OutputConfig::default());
    let mut _gpio47 = Flex::new(peripherals.GPIO47);
    _gpio47.set_level(Level::High);
    _gpio47.set_output_enable(false);
    _gpio47.set_input_enable(true);

    let i2c0 = I2c::new(
        peripherals.I2C0,
        I2cConfig::default()
            .with_frequency(Rate::from_khz(400))
            .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(20))),
    )
    .unwrap()
    .with_sda(peripherals.GPIO39)
    .with_scl(peripherals.GPIO40);
    let i2c1 = I2c::new(
        peripherals.I2C1,
        I2cConfig::default()
            .with_frequency(Rate::from_khz(400))
            .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(20))),
    )
    .unwrap()
    .with_sda(peripherals.GPIO8)
    .with_scl(peripherals.GPIO9);
    let mut i2c0 = BlockingAsyncI2c(i2c0);
    let mut i2c1 = BlockingAsyncI2c(i2c1);
    let (u10, u11, u17) = embassy_futures::block_on(async {
        let u10 = fusb_id(&mut i2c0).await;
        let u11 = fusb_id(&mut i2c1).await;
        let u17 = ina_id(&mut i2c1).await;
        (u10, u11, u17)
    });
    esp_println::println!("PROBE_I2C_DONE {} {} {}", u10, u11, u17);
    let fusb_positive = u10 && u11;
    let ina_positive = u17;
    let (state, profile) = match (fusb_positive, ina_positive) {
        (true, false) => ("verified", "tps-fusb"),
        (false, true) => ("verified", "tps-sw"),
        (true, true) => ("conflicting", ""),
        (false, false) => ("unknown", ""),
    };
    let mut body = heapless::String::<512>::new();
    let _ = write!(
        body,
        "{{\"boardTopologyProbe\":true,\"hardware\":{{\"schema\":1,\"compiledProfile\":null,\"discovery\":{{\"state\":\"{}\",\"detectedProfile\":{},\"evidence\":[\"u10.fusb302b@i2c0:0x22\",\"u11.fusb302b@i2c1:0x22\",\"u17.ina226@i2c1:0x41\"]}},\"compatibility\":\"not_verified\",\"hardwareCapabilities\":{{}},\"firmwareCapabilities\":{{\"safeDiagnostics\":true}}}}",
        state,
        if profile.is_empty() {
            "null"
        } else {
            match profile {
                "tps-fusb" => "\"tps-fusb\"",
                _ => "\"tps-sw\"",
            }
        },
    );
    loop {
        let _ = usb.write(body.as_bytes());
        let _ = usb.write(b"\n");
        let _ = usb.flush_tx();
        delay.delay_millis(100);
    }
}

async fn fusb_id<I2C: AsyncI2c>(i2c: &mut I2C) -> bool {
    let mut device = Fusb302::new(i2c);
    let first = device.device_id().await.ok().map(|id| id.bits());
    let second = device.device_id().await.ok().map(|id| id.bits());
    first.is_some() && first == second && first.is_some_and(|value| value & 0xf0 == 0x90)
}

async fn ina_id<I2C: AsyncI2c>(i2c: &mut I2C) -> bool {
    let mut device = INA226::new(i2c, INA226_ADDR);
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
    first.is_some() && first == second && first == Some((0x5449, 0x2260))
}
