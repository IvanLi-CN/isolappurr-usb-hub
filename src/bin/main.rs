#![no_std]
#![no_main]
#![deny(
    clippy::mem_forget,
    reason = "mem::forget is generally not safe to do with esp_hal types, especially those \
    holding buffers for the duration of a data transfer."
)]

#[path = "../spi_device.rs"]
mod spi_device;

use defmt::info;
use esp_hal::clock::CpuClock;
use esp_hal::gpio::{Level, Output, OutputConfig};
use esp_hal::i2c::master::{Config as I2cConfig, I2c, SoftwareTimeout};
use esp_hal::main;
use esp_hal::spi::Mode;
use esp_hal::spi::master::{Config as SpiConfig, Spi};
use esp_hal::time::{Duration, Instant, Rate};
use isolapurr_usb_hub::display_ui::{ActiveLowBacklight, DisplayUi, EspHalSpinTimer, WORKBUF_SIZE};
use isolapurr_usb_hub::pd_i2c::I2cAllowlist;
use isolapurr_usb_hub::pd_i2c::PowerRequest;
use isolapurr_usb_hub::pd_i2c::sw2303::{apply_enable_profile_full, read_power_request};
use isolapurr_usb_hub::pd_i2c::tps55288::{
    TpsApplyState, apply_setpoint, boot_supply_setpoint, power_request_to_setpoint,
};
use isolapurr_usb_hub::telemetry::TelemetrySampler;
use {esp_backtrace as _, esp_println as _};

use spi_device::CsSpiDevice;

// This creates a default app-descriptor required by the esp-idf bootloader.
// For more information see: <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/app_image_format.html#application-description>
esp_bootloader_esp_idf::esp_app_desc!();

static mut DISPLAY_WORKBUF: [u8; WORKBUF_SIZE] = [0; WORKBUF_SIZE];

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

    // Telemetry I2C bus (no scanning; allowlist enforced in `TelemetrySampler`).
    // SDA = GPIO8, SCL = GPIO9.
    let i2c_telemetry = I2c::new(
        peripherals.I2C1,
        I2cConfig::default()
            .with_frequency(Rate::from_khz(400))
            .with_software_timeout(SoftwareTimeout::Transaction(Duration::from_millis(20))),
    )
    .unwrap()
    .with_sda(peripherals.GPIO8)
    .with_scl(peripherals.GPIO9);
    info!("telemetry i2c: I2C1@400kHz SDA=GPIO8 SCL=GPIO9 addr=[0x41] (no scan)");

    let mut sampler = TelemetrySampler::new(i2c_telemetry);
    if let Err(err) = sampler.init() {
        defmt::warn!(
            "telemetry: INA226 init error (PD loop continues; fields may show ERR): {:?}",
            defmt::Debug2Format(&err)
        );
    }

    // GC9307 display (landscape) + backlight control.
    // SPI: MOSI=GPIO11, SCLK=GPIO12. CS=GPIO13, DC=GPIO10, RES=GPIO14.
    // Backlight gate BLK=GPIO15 (active-low).
    let dc = Output::new(peripherals.GPIO10, Level::Low, OutputConfig::default());
    let rst = Output::new(peripherals.GPIO14, Level::High, OutputConfig::default());
    let cs = Output::new(peripherals.GPIO13, Level::High, OutputConfig::default());
    // Backlight gate BLK is active-low. Force it ON immediately so backlight is not
    // coupled to display init success.
    let blk = Output::new(peripherals.GPIO15, Level::Low, OutputConfig::default());

    let spi_bus = Spi::new(
        peripherals.SPI2,
        SpiConfig::default()
            .with_frequency(Rate::from_mhz(40))
            .with_mode(Mode::_0),
    )
    .unwrap()
    .with_sck(peripherals.GPIO12)
    .with_mosi(peripherals.GPIO11);

    let spi = CsSpiDevice::new(spi_bus, cs);

    let workbuf = unsafe { &mut *core::ptr::addr_of_mut!(DISPLAY_WORKBUF) };
    let backlight = ActiveLowBacklight(blk);
    let mut ui: DisplayUi<'_, _, _, _, EspHalSpinTimer, _> =
        DisplayUi::new(spi, dc, rst, workbuf, backlight);
    info!(
        "display: GC9307 landscape SPI2 MOSI=GPIO11 SCLK=GPIO12 CS=GPIO13 DC=GPIO10 RES=GPIO14 BLK=GPIO15(active-low)"
    );

    if let Err(err) = ui.init() {
        defmt::warn!(
            "display: init error (PD loop continues): {:?}",
            defmt::Debug2Format(&err)
        );
    } else if let Err(err) = ui.draw_frame() {
        defmt::warn!(
            "display: draw_frame error (PD loop continues): {:?}",
            defmt::Debug2Format(&err)
        );
    }

    let mut tps_state = TpsApplyState::new();
    let mut last_request: Option<PowerRequest> = None;
    let mut last_online: Option<bool> = None;
    let mut last_fast_protocol: Option<bool> = None;

    let mut sw2303_error_latched = false;
    let mut tps_error_latched = false;
    let mut ui_error_latched = false;
    let mut last_sw2303_profile_attempt: Option<Instant> = None;

    let boot_sp = boot_supply_setpoint();
    // Give TPS and SW2303 time to power up before first I2C poll.
    spin_delay_ms(200);

    // Boot-time SW2303 "Enable Profile" apply: up to 3 attempts, 200ms backoff.
    // Failure strategy: warn and continue PD loop.
    let mut boot_profile_applied = false;
    for attempt in 1..=3 {
        match apply_enable_profile_full(&mut i2c) {
            Ok(status) => {
                info!(
                    "sw2303 profile: applied full (attempt {}/3) power_register_mode={} cap_w={}W protocols={:?} fast={:?} type_c={:?}",
                    attempt,
                    status.power_config_register_mode,
                    status.power_watts,
                    defmt::Debug2Format(&status.protocols),
                    defmt::Debug2Format(&status.fast_charge),
                    defmt::Debug2Format(&status.type_c)
                );
                last_sw2303_profile_attempt = Some(Instant::now());
                boot_profile_applied = true;
                break;
            }
            Err(err) => {
                defmt::warn!(
                    "sw2303 profile: apply failed (attempt {}/3): {:?}",
                    attempt,
                    defmt::Debug2Format(&err)
                );
                if attempt < 3 {
                    spin_delay_ms(200);
                }
            }
        }
    }
    if !boot_profile_applied {
        defmt::warn!("sw2303 profile: giving up after 3 attempts (PD loop continues)");
    }

    let mut last_tick = Instant::now();

    loop {
        let sw2303_was_in_error = sw2303_error_latched;

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

        // Runtime SW2303 profile retry:
        // - only on I2C recovery (error -> ok transition)
        // - at least 60s between attempts
        if sw2303_was_in_error && request.is_some() {
            let allow_retry = last_sw2303_profile_attempt
                .map(|t| t.elapsed() >= Duration::from_secs(60))
                .unwrap_or(true);
            if allow_retry {
                last_sw2303_profile_attempt = Some(Instant::now());
                match apply_enable_profile_full(&mut i2c) {
                    Ok(status) => {
                        info!(
                            "sw2303 profile: re-applied full after i2c recovery power_register_mode={} cap_w={}W protocols={:?} fast={:?} type_c={:?}",
                            status.power_config_register_mode,
                            status.power_watts,
                            defmt::Debug2Format(&status.protocols),
                            defmt::Debug2Format(&status.fast_charge),
                            defmt::Debug2Format(&status.type_c)
                        );
                    }
                    Err(err) => {
                        defmt::warn!(
                            "sw2303 profile: re-apply failed after i2c recovery: {:?}",
                            defmt::Debug2Format(&err)
                        );
                    }
                }
            }
        }

        if let Some(request) = request {
            if last_request != Some(request) {
                info!(
                    "pd request: online={} fast_proto={} fast_v={} proto={:?} v_req_mv={} i_req_ma={}",
                    request.online,
                    request.fast_protocol,
                    request.fast_voltage,
                    defmt::Debug2Format(&request.negotiated_protocol),
                    request.v_req_mv,
                    request.i_req_ma
                );
                last_request = Some(request);
            }

            if last_online != Some(request.online) {
                if request.online {
                    info!("pd link: sink connected");
                } else {
                    info!("pd link: sink disconnected");
                }
                last_online = Some(request.online);
            }

            if last_fast_protocol != Some(request.fast_protocol) {
                if request.fast_protocol {
                    info!("pd state: fast protocol active");
                } else {
                    info!("pd state: inactive");
                }
                last_fast_protocol = Some(request.fast_protocol);
            }
        } else {
            last_request = None;
            last_online = None;
            last_fast_protocol = None;
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

        // 10 Hz (100ms) UI tick. Keep PD loop behavior intact outside this path.
        if last_tick.elapsed() >= Duration::from_millis(100) {
            last_tick = Instant::now();
            let snapshot = sampler.sample_snapshot(setpoint);
            if let Err(err) = ui.render_snapshot(&snapshot) {
                if !ui_error_latched {
                    defmt::warn!(
                        "display: render error (continuing): {:?}",
                        defmt::Debug2Format(&err)
                    );
                    ui_error_latched = true;
                }
            } else {
                ui_error_latched = false;
            }
        }

        spin_delay_ms(loop_delay_ms);
    }
}
