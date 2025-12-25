#![no_std]
#![no_main]
#![deny(
    clippy::mem_forget,
    reason = "mem::forget is generally not safe to do with esp_hal types, especially those \
    holding buffers for the duration of a data transfer."
)]

use defmt::info;
use esp_hal::clock::CpuClock;
use esp_hal::gpio::{Level, Output, OutputConfig};
use esp_hal::i2c::master::{Config as I2cConfig, I2c};
use esp_hal::main;
use esp_hal::time::{Duration, Instant, Rate};
use isolapurr_usb_hub::pd_i2c::I2cAllowlist;
use isolapurr_usb_hub::pd_i2c::PowerRequest;
use isolapurr_usb_hub::pd_i2c::sw2303::read_power_request;
use isolapurr_usb_hub::pd_i2c::tps55288::{
    TpsApplyState, apply_setpoint, power_request_to_setpoint,
};
use {esp_backtrace as _, esp_println as _};

// This creates a default app-descriptor required by the esp-idf bootloader.
// For more information see: <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/app_image_format.html#application-description>
esp_bootloader_esp_idf::esp_app_desc!();

fn spin_delay_ms(ms: u64) {
    let start = Instant::now();
    while start.elapsed() < Duration::from_millis(ms) {}
}

#[main]
fn main() -> ! {
    let config = esp_hal::Config::default().with_cpu_clock(CpuClock::max());
    let peripherals = esp_hal::init(config);

    // CE_TPS is U39 pad 42 => GPIO37.
    // CE_TPS drives Q9 (NMOS) which pulls TPS EN/UVLO low when CE_TPS is high.
    // Start hard-disabled at boot.
    let mut ce_tps = Output::new(peripherals.GPIO37, Level::High, OutputConfig::default());
    let mut ce_tps_asserted = true;

    // Shared PD I2C bus (no scanning; strictly allowlisted).
    // SDA = GPIO39 (SDA_TPS), SCL = GPIO40 (SCL_TPS).
    let i2c = I2c::new(
        peripherals.I2C0,
        I2cConfig::default().with_frequency(Rate::from_khz(400)),
    )
    .unwrap()
    .with_sda(peripherals.GPIO39)
    .with_scl(peripherals.GPIO40);
    let mut i2c = I2cAllowlist::new(i2c);

    let mut tps_state = TpsApplyState::new();
    let mut last_request: Option<PowerRequest> = None;
    let mut last_online: Option<bool> = None;

    let mut sw2303_error_latched = false;
    let mut tps_error_latched = false;

    loop {
        let request = match read_power_request(&mut i2c) {
            Ok(request) => {
                sw2303_error_latched = false;
                request
            }
            Err(err) => {
                if !sw2303_error_latched {
                    defmt::warn!(
                        "sw2303 read error; asserting CE_TPS and skipping TPS: {:?}",
                        defmt::Debug2Format(&err)
                    );
                    sw2303_error_latched = true;
                }

                if !ce_tps_asserted {
                    ce_tps.set_high();
                    ce_tps_asserted = true;
                    info!("CE_TPS asserted (TPS hard-disabled)");
                }
                tps_state.last = None;
                last_online = None;
                spin_delay_ms(10);
                continue;
            }
        };

        if last_request != Some(request) {
            info!(
                "pd request: online={} proto_raw={} v_req_mv={} i_req_ma={}",
                request.online, request.protocol_raw, request.v_req_mv, request.i_req_ma
            );
            last_request = Some(request);
        }

        if last_online != Some(request.online) {
            if request.online {
                info!("pd state: online");
            } else {
                info!("pd state: offline");
            }
            last_online = Some(request.online);
        }

        if !request.online {
            if !ce_tps_asserted {
                ce_tps.set_high();
                ce_tps_asserted = true;
                info!("CE_TPS asserted (TPS hard-disabled)");
            }
            // TPS regs reset in shutdown; force a re-program next time.
            tps_state.last = None;
            spin_delay_ms(10);
            continue;
        }

        if ce_tps_asserted {
            ce_tps.set_low();
            ce_tps_asserted = false;
            info!("CE_TPS released (TPS enabled)");

            // Give TPS EN/UVLO time to settle before talking I2C.
            spin_delay_ms(8);

            // TPS regs reset in shutdown; force a re-program next time.
            tps_state.last = None;
        }

        let sp = power_request_to_setpoint(request);
        if let Err(err) = apply_setpoint(&mut i2c, &mut tps_state, sp) {
            if !tps_error_latched {
                defmt::warn!(
                    "tps55288 apply error; asserting CE_TPS: {:?}",
                    defmt::Debug2Format(&err)
                );
                tps_error_latched = true;
            }

            if !ce_tps_asserted {
                ce_tps.set_high();
                ce_tps_asserted = true;
                info!("CE_TPS asserted (TPS hard-disabled)");
            }
            tps_state.last = None;
        } else {
            tps_error_latched = false;
        }

        spin_delay_ms(10);
    }
}
