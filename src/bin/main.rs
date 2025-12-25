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
use esp_hal::i2c::master::{Config as I2cConfig, I2c, SoftwareTimeout};
use esp_hal::main;
use esp_hal::time::{Duration, Instant, Rate};
use isolapurr_usb_hub::pd_i2c::I2cAllowlist;
use isolapurr_usb_hub::pd_i2c::PowerRequest;
use isolapurr_usb_hub::pd_i2c::sw2303::read_power_request;
use isolapurr_usb_hub::pd_i2c::tps55288::{
    TpsApplyState, apply_setpoint, boot_supply_setpoint, power_request_to_setpoint,
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

    info!("boot: isolapurr-usb-hub starting (pd i2c coordinator)");

    // CE_TPS is U39 pad 42 => GPIO37.
    // CE_TPS drives Q9 (NMOS) which pulls TPS EN/UVLO low when CE_TPS is high.
    // Keep TPS enabled at boot so it can provide default VBUS (powers SW2303).
    let _ce_tps = Output::new(peripherals.GPIO37, Level::Low, OutputConfig::default());
    info!("tps: CE_TPS released at boot (TPS enabled)");

    // Shared PD I2C bus (no scanning; strictly allowlisted).
    // SDA = GPIO39 (SDA_TPS), SCL = GPIO40 (SCL_TPS).
    //
    // Note: SW2303 supports 100 kHz / 400 kHz. Use 400 kHz by default; adjust if signal integrity requires.
    let i2c = I2c::new(
        peripherals.I2C0,
        I2cConfig::default()
            .with_frequency(Rate::from_khz(400))
            .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(20))),
    )
    .unwrap()
    .with_sda(peripherals.GPIO39)
    .with_scl(peripherals.GPIO40);
    let mut i2c = I2cAllowlist::new(i2c);
    info!("pd i2c: I2C0@400kHz SDA=GPIO39 SCL=GPIO40 allowlist=[0x3C,0x74]");

    let mut tps_state = TpsApplyState::new();
    let mut last_request: Option<PowerRequest> = None;
    let mut last_tc_connected: Option<bool> = None;
    let mut last_fc_active: Option<bool> = None;

    let mut sw2303_error_latched = false;
    let mut tps_error_latched = false;

    let boot_sp = boot_supply_setpoint();
    // Give TPS and SW2303 time to power up before first I2C poll.
    spin_delay_ms(200);

    loop {
        let (request, setpoint) = match read_power_request(&mut i2c) {
            Ok(request) => {
                sw2303_error_latched = false;
                let sp = power_request_to_setpoint(request);
                (Some(request), sp)
            }
            Err(err) => {
                if !sw2303_error_latched {
                    defmt::warn!(
                        "sw2303 read error; falling back to boot supply: {:?}",
                        defmt::Debug2Format(&err)
                    );
                    sw2303_error_latched = true;
                }
                (None, boot_sp)
            }
        };

        if let Some(request) = request {
            if last_request != Some(request) {
                info!(
                    "pd request: online={} tc={} fc={} pd_ver={} proto_raw={} v_req_mv={} i_req_ma={}",
                    request.online,
                    request.type_c_connected,
                    request.fast_charging,
                    request.pd_version_raw,
                    request.protocol_raw,
                    request.v_req_mv,
                    request.i_req_ma
                );
                last_request = Some(request);
            }

            if last_tc_connected != Some(request.type_c_connected) {
                if request.type_c_connected {
                    info!("pd link: type-c connected");
                } else {
                    info!("pd link: type-c disconnected");
                }
                last_tc_connected = Some(request.type_c_connected);
            }

            if last_fc_active != Some(request.fast_charging) {
                if request.fast_charging {
                    info!("pd state: fast-charging active");
                } else {
                    info!("pd state: inactive");
                }
                last_fc_active = Some(request.fast_charging);
            }
        } else {
            last_request = None;
            last_tc_connected = None;
            last_fc_active = None;
        }

        let mut loop_delay_ms = if request.is_some() { 10 } else { 50 };

        if let Err(err) = apply_setpoint(&mut i2c, &mut tps_state, setpoint) {
            if !tps_error_latched {
                defmt::warn!(
                    "tps55288 apply error (keeping output as-is): {:?}",
                    defmt::Debug2Format(&err)
                );
                tps_error_latched = true;
            }

            tps_state.last = None;
            loop_delay_ms = 100;
        } else {
            tps_error_latched = false;
        }

        spin_delay_ms(loop_delay_ms);
    }
}
