#![no_std]
#![no_main]
#![deny(
    clippy::mem_forget,
    reason = "mem::forget is generally not safe to do with esp_hal types, especially those \
    holding buffers for the duration of a data transfer."
)]

#[path = "../spi_device.rs"]
mod spi_device;

// Enable heap allocations (String, Vec, etc.) only when the experimental
// net_http feature is used for Wi‑Fi + mDNS + HTTP (Plan #0003).
#[cfg(feature = "net_http")]
extern crate alloc;

// Optional Wi‑Fi + mDNS + HTTP support; compiled only when `net_http` feature is set.
#[cfg(feature = "net_http")]
#[path = "../mdns.rs"]
mod mdns;
#[cfg(feature = "net_http")]
#[path = "../net.rs"]
mod net;

// Wi‑Fi compile-time configuration injected by build.rs when `net_http` is enabled.
#[cfg(feature = "net_http")]
pub const WIFI_SSID: &str = env!("USB_HUB_WIFI_SSID");
#[cfg(feature = "net_http")]
pub const WIFI_PSK: &str = env!("USB_HUB_WIFI_PSK");
#[cfg(feature = "net_http")]
pub const WIFI_HOSTNAME: Option<&str> = option_env!("USB_HUB_WIFI_HOSTNAME");
#[cfg(feature = "net_http")]
pub const WIFI_STATIC_IP: Option<&str> = option_env!("USB_HUB_WIFI_STATIC_IP");
#[cfg(feature = "net_http")]
pub const WIFI_NETMASK: Option<&str> = option_env!("USB_HUB_WIFI_NETMASK");
#[cfg(feature = "net_http")]
pub const WIFI_GATEWAY: Option<&str> = option_env!("USB_HUB_WIFI_GATEWAY");
#[cfg(feature = "net_http")]
pub const WIFI_DNS: Option<&str> = option_env!("USB_HUB_WIFI_DNS");

use defmt::info;
use embassy_executor::Spawner;
use embassy_time::Timer;
use esp_hal::clock::CpuClock;
use esp_hal::gpio::{Input, InputConfig, Level, Output, OutputConfig, Pull};
use esp_hal::i2c::master::{Config as I2cConfig, I2c, SoftwareTimeout};
use esp_hal::spi::Mode;
use esp_hal::spi::master::{Config as SpiConfig, Spi};
use esp_hal::time::{Duration, Instant, Rate};
use esp_hal::timer::timg::TimerGroup;
use isolapurr_usb_hub::buzzer::ledc::LedcBuzzer;
use isolapurr_usb_hub::display_ui::{
    ActiveLowBacklight, DisplayUi, EspHalSpinTimer, NormalUiField, NormalUiPort, NormalUiSnapshot,
    WORKBUF_SIZE,
};
use isolapurr_usb_hub::pd_i2c::I2cAllowlist;
use isolapurr_usb_hub::pd_i2c::PowerRequest;
use isolapurr_usb_hub::pd_i2c::TPS55288_ADDR_7BIT;
use isolapurr_usb_hub::pd_i2c::sw2303::{apply_enable_profile_full, read_power_request};
use isolapurr_usb_hub::pd_i2c::tps55288::{
    TpsApplyState, apply_setpoint, boot_supply_setpoint, power_request_to_setpoint,
};
use isolapurr_usb_hub::prompt_tone::{
    DEFAULT_DUTY_PCT, DEFAULT_FREQ_HZ, ErrorKind, InitFailReason, InitWarnReason,
    PromptToneManager, SafetyKind, SoundEvent,
};
use isolapurr_usb_hub::telemetry::{Field, NormalUiTelemetrySampler};
use {esp_backtrace as _, esp_println as _};

use spi_device::CsSpiDevice;

// This creates a default app-descriptor required by the esp-idf bootloader.
// For more information see: <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/app_image_format.html#application-description>
esp_bootloader_esp_idf::esp_app_desc!();

static mut DISPLAY_WORKBUF: [u8; WORKBUF_SIZE] = [0; WORKBUF_SIZE];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ButtonId {
    Left,  // USB-A
    Right, // USB-C
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ButtonEdge {
    Pressed,
    Released,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PressClass {
    Short,
    Long,
    Invalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PowerState {
    On,
    Off,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DataState {
    Connected,
    Disconnected,
    Pulsing { until: Instant },
}

#[derive(Clone, Copy, Debug)]
struct PortState {
    power: PowerState,
    data: DataState,
    busy_until: Option<Instant>,
}

impl PortState {
    const fn new(power: PowerState) -> Self {
        let data = match power {
            PowerState::On => DataState::Connected,
            PowerState::Off => DataState::Disconnected,
        };
        Self {
            power,
            data,
            busy_until: None,
        }
    }

    fn is_busy(&self, now: Instant) -> bool {
        self.busy_until.is_some_and(|until| now < until)
            || matches!(self.data, DataState::Pulsing { .. })
    }
}

const DATA_DISCONNECT_MS: u64 = 250;
const TOAST_MS: u64 = 1500;
const POWER_SWITCH_GUARD_MS: u64 = 350;

const PRESS_SHORT_MIN: Duration = Duration::from_millis(100);
const PRESS_SHORT_MAX: Duration = Duration::from_millis(500);
const PRESS_LONG_MIN: Duration = Duration::from_millis(1000);
const PRESS_LONG_MAX: Duration = Duration::from_millis(5000);

// Toast colors (RGB565 raw).
const TOAST_OK_RAW: u16 = 0x4D6A; // green (same as UI OK power)
const TOAST_INFO_RAW: u16 = 0xFE45; // yellow (same as UI OK voltage)
const TOAST_WARN_RAW: u16 = 0xFD40; // orange-ish
const TOAST_ERR_RAW: u16 = 0xF800; // red

const TOAST_USB_A_DATA_OFF: [[u8; 13]; 3] =
    [*b"USB-A DATAOFF", *b"250MS        ", *b"             "];
const TOAST_USB_A_DATA_ON: [[u8; 13]; 3] =
    [*b"USB-A DATAON ", *b"DONE         ", *b"             "];
const TOAST_USB_A_PWR_OFF: [[u8; 13]; 3] =
    [*b"USB-A PWROFF ", *b"DONE         ", *b"             "];
const TOAST_USB_A_PWR_ON: [[u8; 13]; 3] = [*b"USB-A PWRON  ", *b"DONE         ", *b"             "];
const TOAST_USB_A_BUSY: [[u8; 13]; 3] = [*b"USB-A BUSY   ", *b"REJECT       ", *b"             "];
const TOAST_USB_A_BADTIME: [[u8; 13]; 3] =
    [*b"USB-A BADTIME", *b"REJECT       ", *b"             "];

const TOAST_USB_C_DATA_OFF: [[u8; 13]; 3] =
    [*b"USB-C DATAOFF", *b"250MS        ", *b"             "];
const TOAST_USB_C_DATA_ON: [[u8; 13]; 3] =
    [*b"USB-C DATAON ", *b"DONE         ", *b"             "];
const TOAST_USB_C_PWR_OFF: [[u8; 13]; 3] =
    [*b"USB-C PWROFF ", *b"DONE         ", *b"             "];
const TOAST_USB_C_PWR_ON: [[u8; 13]; 3] = [*b"USB-C PWRON  ", *b"DONE         ", *b"             "];
const TOAST_USB_C_BUSY: [[u8; 13]; 3] = [*b"USB-C BUSY   ", *b"REJECT       ", *b"             "];
const TOAST_USB_C_BADTIME: [[u8; 13]; 3] =
    [*b"USB-C BADTIME", *b"REJECT       ", *b"             "];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ToastId {
    DataOff,
    DataOn,
    PwrOff,
    PwrOn,
    Busy,
    BadTime,
}

fn toast_spec(button: ButtonId, toast: ToastId) -> (&'static [[u8; 13]; 3], u16) {
    let fg_raw = match toast {
        ToastId::DataOff => TOAST_INFO_RAW,
        ToastId::DataOn => TOAST_OK_RAW,
        ToastId::PwrOff => TOAST_WARN_RAW,
        ToastId::PwrOn => TOAST_OK_RAW,
        ToastId::Busy | ToastId::BadTime => TOAST_ERR_RAW,
    };

    let lines = match (button, toast) {
        (ButtonId::Left, ToastId::DataOff) => &TOAST_USB_A_DATA_OFF,
        (ButtonId::Left, ToastId::DataOn) => &TOAST_USB_A_DATA_ON,
        (ButtonId::Left, ToastId::PwrOff) => &TOAST_USB_A_PWR_OFF,
        (ButtonId::Left, ToastId::PwrOn) => &TOAST_USB_A_PWR_ON,
        (ButtonId::Left, ToastId::Busy) => &TOAST_USB_A_BUSY,
        (ButtonId::Left, ToastId::BadTime) => &TOAST_USB_A_BADTIME,
        (ButtonId::Right, ToastId::DataOff) => &TOAST_USB_C_DATA_OFF,
        (ButtonId::Right, ToastId::DataOn) => &TOAST_USB_C_DATA_ON,
        (ButtonId::Right, ToastId::PwrOff) => &TOAST_USB_C_PWR_OFF,
        (ButtonId::Right, ToastId::PwrOn) => &TOAST_USB_C_PWR_ON,
        (ButtonId::Right, ToastId::Busy) => &TOAST_USB_C_BUSY,
        (ButtonId::Right, ToastId::BadTime) => &TOAST_USB_C_BADTIME,
    };

    (lines, fg_raw)
}

#[derive(Debug)]
struct DebouncedButton {
    stable_pressed: bool,
    candidate_pressed: bool,
    candidate_since: Option<Instant>,
}

impl DebouncedButton {
    fn new() -> Self {
        Self {
            stable_pressed: false,
            candidate_pressed: false,
            candidate_since: None,
        }
    }

    #[cfg(feature = "net_http")]
    fn is_pressed(&self) -> bool {
        self.stable_pressed
    }

    fn update(&mut self, now: Instant, is_pressed: bool, debounce: Duration) -> Option<ButtonEdge> {
        if is_pressed == self.stable_pressed {
            self.candidate_pressed = is_pressed;
            self.candidate_since = None;
            return None;
        }

        let Some(since) = self.candidate_since else {
            self.candidate_pressed = is_pressed;
            self.candidate_since = Some(now);
            return None;
        };

        if self.candidate_pressed != is_pressed {
            self.candidate_pressed = is_pressed;
            self.candidate_since = Some(now);
            return None;
        }

        if now - since < debounce {
            return None;
        }

        self.stable_pressed = is_pressed;
        self.candidate_since = None;

        Some(if is_pressed {
            ButtonEdge::Pressed
        } else {
            ButtonEdge::Released
        })
    }
}

fn classify_press(duration: Duration) -> PressClass {
    if duration < PRESS_SHORT_MIN {
        return PressClass::Invalid;
    }
    if duration <= PRESS_SHORT_MAX {
        return PressClass::Short;
    }
    if duration < PRESS_LONG_MIN {
        return PressClass::Invalid;
    }
    if duration <= PRESS_LONG_MAX {
        return PressClass::Long;
    }
    PressClass::Invalid
}

fn telemetry_field_to_ui(field: Field<u32>) -> NormalUiField {
    match field {
        Field::Ok(v) => NormalUiField::Ok(v.saturating_mul(1_000)),
        Field::Err => NormalUiField::Err,
    }
}

#[esp_rtos::main]
async fn main(_spawner: Spawner) {
    let config = esp_hal::Config::default().with_cpu_clock(CpuClock::max());
    let peripherals = esp_hal::init(config);

    #[cfg(feature = "net_http")]
    {
        // Heap for Wi‑Fi + mDNS + HTTP allocations (SSID/PSK Strings + stack internals).
        esp_alloc::heap_allocator!(#[esp_hal::ram(reclaimed)] size: 64 * 1024);
    }

    // Initialize the preemptive scheduler used by esp-radio (+ embassy integrations).
    let timg0 = TimerGroup::new(peripherals.TIMG0);
    esp_rtos::start(timg0.timer0);

    info!("boot: isolapurr-usb-hub starting (pd i2c coordinator)");

    // Optional Wi‑Fi STA + mDNS + HTTP stack (Plan #0003).
    #[cfg(feature = "net_http")]
    let net_handles = net::spawn_wifi_mdns_http(&_spawner, peripherals.WIFI);

    let buzzer = LedcBuzzer::new(peripherals.LEDC, peripherals.GPIO21).expect("buzzer LEDC init");
    let mut prompt_tone = PromptToneManager::new(buzzer);
    info!(
        "buzzer: prompt_tone default freq={}Hz duty={}%",
        DEFAULT_FREQ_HZ, DEFAULT_DUTY_PCT
    );

    // Physical buttons:
    // - BTNR = GPIO0 (active-low, requires internal pull-up)
    // - BTNL = GPIO1 (active-low, requires internal pull-up)
    let btn_cfg = InputConfig::default().with_pull(Pull::Up);
    let btn_left = Input::new(peripherals.GPIO1, btn_cfg);
    let btn_right = Input::new(peripherals.GPIO0, btn_cfg);
    let mut btn_left_state = DebouncedButton::new();
    let mut btn_right_state = DebouncedButton::new();
    let btn_debounce = Duration::from_millis(30);
    let mut btn_raw_left_pressed = btn_left.is_low();
    let mut btn_raw_right_pressed = btn_right.is_low();
    info!(
        "buttons: initial raw left_pressed={} right_pressed={}",
        btn_raw_left_pressed, btn_raw_right_pressed
    );

    let mut btn_left_pressed_at: Option<Instant> = None;
    let mut btn_right_pressed_at: Option<Instant> = None;
    #[cfg(feature = "net_http")]
    let mut combo_active = false;
    #[cfg(not(feature = "net_http"))]
    let combo_active = false;
    #[cfg(feature = "net_http")]
    let mut combo_pressed_at: Option<Instant> = None;
    #[cfg(feature = "net_http")]
    let mut combo_done = false;
    #[cfg(feature = "net_http")]
    let mut combo_expired = false;

    // Port controls (tps-sw netlist):
    // - P1_CED/P2_CED drive CH442E IN: low=connect, high=disconnect (S2x is NC).
    // - P1_EN# drives CH217K enable: low=enable (power on), high=disable (power off).
    // - CE_TPS drives Q9, pulling TPS EN/UVLO low when CE_TPS is high (power off).
    //
    // Keep everything enabled/connected at boot.
    let mut p2_ced = Output::new(peripherals.GPIO2, Level::Low, OutputConfig::default());
    let mut p1_ced = Output::new(peripherals.GPIO4, Level::Low, OutputConfig::default());
    let mut p1_en_n = Output::new(peripherals.GPIO16, Level::Low, OutputConfig::default());
    let mut ce_tps = Output::new(peripherals.GPIO37, Level::Low, OutputConfig::default());
    info!(
        "ports: boot state p1_en#=low(on) p1_ced=low(connect) p2_ced=low(connect) ce_tps=low(on)"
    );

    let mut port_usb_a = PortState::new(PowerState::On);
    let mut port_usb_c = PortState::new(PowerState::On);

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

    // Telemetry I2C bus (no scanning; allowlist enforced in telemetry wrapper).
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
    info!("telemetry i2c: I2C1@400kHz SDA=GPIO8 SCL=GPIO9 addr=[0x40,0x41] (no scan)");

    let mut telemetry_sampler = NormalUiTelemetrySampler::new(i2c_telemetry);
    if let Err(err) = telemetry_sampler.init() {
        defmt::warn!(
            "telemetry: INA226 init error (PD loop continues; fields may show ERR): {:?}",
            defmt::Debug2Format(&err)
        );
        prompt_tone.notify(SoundEvent::InitWarn(InitWarnReason::Ina226Init));
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
        prompt_tone.notify(SoundEvent::InitWarn(InitWarnReason::DisplayInit));
    } else if let Err(err) = ui.draw_frame() {
        defmt::warn!(
            "display: draw_frame error (PD loop continues): {:?}",
            defmt::Debug2Format(&err)
        );
        prompt_tone.notify(SoundEvent::InitWarn(InitWarnReason::DisplayInit));
    }

    let mut tps_state = TpsApplyState::new();
    let mut last_request: Option<PowerRequest> = None;
    let mut last_fast_protocol: Option<bool> = None;

    let mut sw2303_error_latched = false;
    let mut tps_error_latched = false;
    let mut ui_error_latched = false;
    let mut last_sw2303_profile_attempt: Option<Instant> = None;
    let mut last_diag_tick = Instant::now();
    let mut button_fast_loop_until: Option<Instant> = None;

    let boot_sp = boot_supply_setpoint();
    // Give TPS and SW2303 time to power up before first I2C poll.
    Timer::after_millis(200).await;

    // Boot-time SW2303 "Enable Profile" apply: up to 3 attempts, 200ms backoff.
    // Failure strategy: warn and continue PD loop.
    let mut boot_profile_applied = false;
    for attempt in 1..=3 {
        match apply_enable_profile_full(&mut i2c) {
            Ok(status) => {
                info!(
                    "sw2303 profile: applied full (attempt {}/3) power_register_mode={} cap_w={}W protocols={:?} fast={:?} type_c={:?} vin_mv={:?} vbus_mv={:?} sys0={:?} sys1={:?} sys2={:?} sys3={:?}",
                    attempt,
                    status.power_config_register_mode,
                    status.power_watts,
                    defmt::Debug2Format(&status.protocols),
                    defmt::Debug2Format(&status.fast_charge),
                    defmt::Debug2Format(&status.type_c),
                    defmt::Debug2Format(&status.vin_mv),
                    defmt::Debug2Format(&status.vbus_mv),
                    defmt::Debug2Format(&status.system_status0),
                    defmt::Debug2Format(&status.system_status1),
                    defmt::Debug2Format(&status.system_status2),
                    defmt::Debug2Format(&status.system_status3)
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
                    Timer::after_millis(200).await;
                }
            }
        }
    }
    if !boot_profile_applied {
        defmt::warn!("sw2303 profile: giving up after 3 attempts (PD loop continues)");
        prompt_tone.notify(SoundEvent::InitFail(InitFailReason::Sw2303ProfileBoot));
    }

    let mut last_tick = Instant::now();

    prompt_tone.notify(SoundEvent::InitDone);
    {
        let now_us = esp_hal::time::Instant::now()
            .duration_since_epoch()
            .as_micros();
        let now = core::time::Duration::from_micros(now_us);
        prompt_tone.tick(now);
    }

    loop {
        let sw2303_was_in_error = sw2303_error_latched;
        let tps_was_in_error = tps_error_latched;
        let ui_was_in_error = ui_error_latched;

        let (request, setpoint) = match read_power_request(&mut i2c) {
            Ok(request) => {
                sw2303_error_latched = false;
                // NOTE: Do not use `request.online` (REG0x0D bit7) for any functional behavior.
                // Some chips may customize its semantics (Type‑C insert or A‑port current threshold).
                //
                // Follow SW2303 requests when a protocol is indicated as active; otherwise keep a
                // conservative 5V "keep-alive" supply for VBUS.
                let sp = if request.negotiated_protocol.is_some()
                    || request.fast_protocol
                    || request.fast_voltage
                {
                    power_request_to_setpoint(request)
                } else {
                    boot_sp
                };
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

        if !sw2303_was_in_error && sw2303_error_latched {
            prompt_tone.notify(SoundEvent::EnterError(ErrorKind::Sw2303I2c));
        } else if sw2303_was_in_error && !sw2303_error_latched {
            prompt_tone.notify(SoundEvent::ExitError(ErrorKind::Sw2303I2c));
        }

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
                            "sw2303 profile: re-applied full after i2c recovery power_register_mode={} cap_w={}W protocols={:?} fast={:?} type_c={:?} vin_mv={:?} vbus_mv={:?} sys0={:?} sys1={:?} sys2={:?} sys3={:?}",
                            status.power_config_register_mode,
                            status.power_watts,
                            defmt::Debug2Format(&status.protocols),
                            defmt::Debug2Format(&status.fast_charge),
                            defmt::Debug2Format(&status.type_c),
                            defmt::Debug2Format(&status.vin_mv),
                            defmt::Debug2Format(&status.vbus_mv),
                            defmt::Debug2Format(&status.system_status0),
                            defmt::Debug2Format(&status.system_status1),
                            defmt::Debug2Format(&status.system_status2),
                            defmt::Debug2Format(&status.system_status3)
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
                    "pd request: online_bit={} fast_proto={} fast_v={} proto={:?} v_req_mv={} i_req_ma={}",
                    request.online,
                    request.fast_protocol,
                    request.fast_voltage,
                    defmt::Debug2Format(&request.negotiated_protocol),
                    request.v_req_mv,
                    request.i_req_ma
                );
                last_request = Some(request);
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
            last_fast_protocol = None;
        }

        let mut loop_delay_ms = match request {
            Some(r) if r.negotiated_protocol.is_some() || r.fast_protocol || r.fast_voltage => 10,
            _ => 50,
        };

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

        if !tps_was_in_error && tps_error_latched {
            prompt_tone.notify(SoundEvent::EnterSafety(SafetyKind::TpsApply));
        } else if tps_was_in_error && !tps_error_latched {
            prompt_tone.notify(SoundEvent::ExitSafety(SafetyKind::TpsApply));
        }

        // 1 Hz diagnostics (never gate on `online` bit):
        // - requested vs applied setpoint
        // - measured VBUS/IBUS (INA226)
        // - TPS operating mode + fault flags
        if last_diag_tick.elapsed() >= Duration::from_secs(1) {
            last_diag_tick = Instant::now();

            let (tps_operating, tps_faults) = {
                let mut dev = tps55288::Tps55288::with_address(&mut i2c, TPS55288_ADDR_7BIT);
                match dev.read_status() {
                    Ok(v) => v,
                    Err(_) => (
                        tps55288::data_types::OperatingStatus::Reserved,
                        tps55288::data_types::FaultStatus::default(),
                    ),
                }
            };

            let (online_bit, fast_proto, fast_v, proto, v_req_mv, i_req_ma) = match request {
                Some(r) => (
                    r.online,
                    r.fast_protocol,
                    r.fast_voltage,
                    r.negotiated_protocol,
                    r.v_req_mv,
                    r.i_req_ma,
                ),
                None => (false, false, false, None, 0, 0),
            };
            let snapshot = telemetry_sampler.sample();
            info!(
                "diag: req_online_bit={} req_fast_proto={} req_fast_v={} req_proto={:?} req_v_mv={} req_i_ma={} set={:?} meas_usb_a={:?} meas_usb_c={:?} tps={:?} faults={:?}",
                online_bit,
                fast_proto,
                fast_v,
                defmt::Debug2Format(&proto),
                v_req_mv,
                i_req_ma,
                defmt::Debug2Format(&setpoint),
                defmt::Debug2Format(&snapshot.usb_a),
                defmt::Debug2Format(&snapshot.usb_c),
                defmt::Debug2Format(&tps_operating),
                defmt::Debug2Format(&tps_faults),
            );
        }

        // 2 Hz (500ms) UI tick. Keep PD loop behavior intact outside this path.
        if last_tick.elapsed() >= Duration::from_millis(500) {
            let ui_tick_now = Instant::now();
            last_tick = ui_tick_now;

            if ui.toast_active(ui_tick_now) {
                // Pause normal UI updates while an action toast is active.
                // Telemetry/PD loop continues unaffected.
            } else {
                let telemetry = telemetry_sampler.sample();

                // Presence rules (frozen spec):
                // - USB-A: if voltage is Ok(v_mv) and v_mv < 1000 => NotPresent; else Present (incl. read error).
                // - USB-C/PD: protocol active when negotiated_protocol OR fast_protocol OR fast_voltage; ignore `online`.
                let usb_a_present = match telemetry.usb_a.voltage_mv {
                    Field::Ok(v_mv) if v_mv < 1_000 => false,
                    _ => true,
                };
                let usb_c_present = request
                    .as_ref()
                    .map(|r| r.negotiated_protocol.is_some() || r.fast_protocol || r.fast_voltage)
                    .unwrap_or(false);

                let snapshot = NormalUiSnapshot {
                    usb_a: NormalUiPort {
                        present: usb_a_present,
                        voltage_uv: telemetry_field_to_ui(telemetry.usb_a.voltage_mv),
                        current_ua: telemetry_field_to_ui(telemetry.usb_a.current_ma),
                        power_uw: telemetry_field_to_ui(telemetry.usb_a.power_mw),
                    },
                    usb_c: NormalUiPort {
                        present: usb_c_present,
                        voltage_uv: telemetry_field_to_ui(telemetry.usb_c.voltage_mv),
                        current_ua: telemetry_field_to_ui(telemetry.usb_c.current_ma),
                        power_uw: telemetry_field_to_ui(telemetry.usb_c.power_mw),
                    },
                };

                if let Err(err) = ui.render_normal_ui(&snapshot) {
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

                if !ui_was_in_error && ui_error_latched {
                    prompt_tone.notify(SoundEvent::EnterError(ErrorKind::UiRender));
                } else if ui_was_in_error && !ui_error_latched {
                    prompt_tone.notify(SoundEvent::ExitError(ErrorKind::UiRender));
                }
            }
        }

        // Port state machine tick (data replug completion, busy windows, power/data invariants).
        let ports_now = Instant::now();
        if port_usb_a
            .busy_until
            .is_some_and(|until| ports_now >= until)
        {
            port_usb_a.busy_until = None;
        }
        if port_usb_c
            .busy_until
            .is_some_and(|until| ports_now >= until)
        {
            port_usb_c.busy_until = None;
        }

        // USB-A invariants.
        match port_usb_a.power {
            PowerState::On => {
                let _ = p1_en_n.set_low();
                match port_usb_a.data {
                    DataState::Connected => {
                        let _ = p1_ced.set_low();
                    }
                    DataState::Disconnected => {
                        let _ = p1_ced.set_high();
                    }
                    DataState::Pulsing { until } => {
                        if ports_now >= until {
                            port_usb_a.data = DataState::Connected;
                            port_usb_a.busy_until = None;
                            let _ = p1_ced.set_low();
                            let (lines, fg_raw) = toast_spec(ButtonId::Left, ToastId::DataOn);
                            let _ = ui.show_toast(
                                ports_now,
                                lines,
                                fg_raw,
                                Duration::from_millis(TOAST_MS),
                            );
                        } else {
                            let _ = p1_ced.set_high();
                        }
                    }
                }
            }
            PowerState::Off => {
                port_usb_a.data = DataState::Disconnected;
                let _ = p1_en_n.set_high();
                let _ = p1_ced.set_high();
            }
        }

        // USB-C invariants.
        match port_usb_c.power {
            PowerState::On => {
                let _ = ce_tps.set_low();
                match port_usb_c.data {
                    DataState::Connected => {
                        let _ = p2_ced.set_low();
                    }
                    DataState::Disconnected => {
                        let _ = p2_ced.set_high();
                    }
                    DataState::Pulsing { until } => {
                        if ports_now >= until {
                            port_usb_c.data = DataState::Connected;
                            port_usb_c.busy_until = None;
                            let _ = p2_ced.set_low();
                            let (lines, fg_raw) = toast_spec(ButtonId::Right, ToastId::DataOn);
                            let _ = ui.show_toast(
                                ports_now,
                                lines,
                                fg_raw,
                                Duration::from_millis(TOAST_MS),
                            );
                        } else {
                            let _ = p2_ced.set_high();
                        }
                    }
                }
            }
            PowerState::Off => {
                port_usb_c.data = DataState::Disconnected;
                let _ = ce_tps.set_high();
                let _ = p2_ced.set_high();
            }
        }

        // Button handling: stable press/release with duration classification.
        let buttons_now = Instant::now();
        let raw_left_pressed = btn_left.is_low();
        let raw_right_pressed = btn_right.is_low();
        if raw_left_pressed != btn_raw_left_pressed || raw_right_pressed != btn_raw_right_pressed {
            btn_raw_left_pressed = raw_left_pressed;
            btn_raw_right_pressed = raw_right_pressed;
            info!(
                "buttons: raw left_pressed={} right_pressed={}",
                raw_left_pressed, raw_right_pressed
            );
        }

        let left_edge = btn_left_state.update(buttons_now, raw_left_pressed, btn_debounce);
        let right_edge = btn_right_state.update(buttons_now, raw_right_pressed, btn_debounce);

        #[cfg(feature = "net_http")]
        let left_pressed = btn_left_state.is_pressed();
        #[cfg(feature = "net_http")]
        let right_pressed = btn_right_state.is_pressed();

        // Combo: press BOTH buttons, hold 1s..=5s, then release to show network info (Plan #0003).
        // Holding >5s is invalid ("expired") and does nothing.
        #[cfg(feature = "net_http")]
        if !combo_active && left_pressed && right_pressed {
            combo_active = true;
            combo_pressed_at = Some(buttons_now);
            combo_done = false;
            combo_expired = false;
        }

        #[cfg(feature = "net_http")]
        if combo_active && left_pressed && right_pressed {
            if let Some(since) = combo_pressed_at {
                if buttons_now - since > PRESS_LONG_MAX {
                    combo_expired = true;
                }
            }
        }

        #[cfg(feature = "net_http")]
        if combo_active && (!left_pressed || !right_pressed) && !combo_done {
            if let Some(since) = combo_pressed_at {
                let duration = buttons_now - since;
                if !combo_expired && duration >= PRESS_LONG_MIN && duration <= PRESS_LONG_MAX {
                    let (short_id, ip) = if let Some(handles) = net_handles.as_ref() {
                        let ip = {
                            let state = handles.wifi_state.lock().await;
                            state.ipv4
                        };
                        (Some(handles.device_names.short_id.as_str()), ip)
                    } else {
                        (None, None)
                    };

                    let lines = net::format_network_toast_lines(short_id, ip);
                    let _ = ui.show_toast_compact(
                        buttons_now,
                        &lines,
                        TOAST_INFO_RAW,
                        Duration::from_millis(5_000),
                    );
                }
            }
            combo_done = true;
        }

        if let Some(edge) = left_edge {
            match edge {
                ButtonEdge::Pressed => {
                    info!("button: left pressed");
                    btn_left_pressed_at = Some(buttons_now);
                    button_fast_loop_until = Some(buttons_now + PRESS_LONG_MAX);
                }
                ButtonEdge::Released => {
                    info!("button: left released");

                    if combo_active {
                        btn_left_pressed_at = None;
                    } else {
                        let Some(pressed_at) = btn_left_pressed_at.take() else {
                            // Ignore unmatched releases.
                            continue;
                        };
                        let class = classify_press(buttons_now - pressed_at);

                        let rejected = match class {
                            PressClass::Invalid => Some(ToastId::BadTime),
                            _ if port_usb_a.is_busy(buttons_now) => Some(ToastId::Busy),
                            _ => None,
                        };

                        if let Some(reject_toast) = rejected {
                            let (lines, fg_raw) = toast_spec(ButtonId::Left, reject_toast);
                            let _ = ui.show_toast(
                                buttons_now,
                                lines,
                                fg_raw,
                                Duration::from_millis(TOAST_MS),
                            );
                            prompt_tone.notify(SoundEvent::ActionFail);
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(250));
                        } else {
                            match class {
                                PressClass::Short => match port_usb_a.power {
                                    PowerState::Off => {
                                        port_usb_a.power = PowerState::On;
                                        port_usb_a.data = DataState::Connected;
                                        port_usb_a.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = p1_en_n.set_low();
                                        let _ = p1_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::PwrOn);
                                        let _ = ui.show_toast(
                                            buttons_now,
                                            lines,
                                            fg_raw,
                                            Duration::from_millis(TOAST_MS),
                                        );
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_a.data = DataState::Pulsing {
                                            until: buttons_now
                                                + Duration::from_millis(DATA_DISCONNECT_MS),
                                        };
                                        port_usb_a.busy_until = Some(
                                            buttons_now + Duration::from_millis(DATA_DISCONNECT_MS),
                                        );
                                        let _ = p1_ced.set_high();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::DataOff);
                                        let _ = ui.show_toast(
                                            buttons_now,
                                            lines,
                                            fg_raw,
                                            Duration::from_millis(TOAST_MS),
                                        );
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                },
                                PressClass::Long => match port_usb_a.power {
                                    PowerState::Off => {
                                        port_usb_a.power = PowerState::On;
                                        port_usb_a.data = DataState::Connected;
                                        port_usb_a.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = p1_en_n.set_low();
                                        let _ = p1_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::PwrOn);
                                        let _ = ui.show_toast(
                                            buttons_now,
                                            lines,
                                            fg_raw,
                                            Duration::from_millis(TOAST_MS),
                                        );
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_a.power = PowerState::Off;
                                        port_usb_a.data = DataState::Disconnected;
                                        port_usb_a.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = p1_en_n.set_high();
                                        let _ = p1_ced.set_high();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Left, ToastId::PwrOff);
                                        let _ = ui.show_toast(
                                            buttons_now,
                                            lines,
                                            fg_raw,
                                            Duration::from_millis(TOAST_MS),
                                        );
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                },
                                PressClass::Invalid => unreachable!("handled above"),
                            }
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(350));
                        }
                    }
                }
            }
        }

        if let Some(edge) = right_edge {
            match edge {
                ButtonEdge::Pressed => {
                    info!("button: right pressed");
                    btn_right_pressed_at = Some(buttons_now);
                    button_fast_loop_until = Some(buttons_now + PRESS_LONG_MAX);
                }
                ButtonEdge::Released => {
                    info!("button: right released");

                    if combo_active {
                        btn_right_pressed_at = None;
                    } else {
                        let Some(pressed_at) = btn_right_pressed_at.take() else {
                            continue;
                        };
                        let class = classify_press(buttons_now - pressed_at);

                        let rejected = match class {
                            PressClass::Invalid => Some(ToastId::BadTime),
                            _ if port_usb_c.is_busy(buttons_now) => Some(ToastId::Busy),
                            _ => None,
                        };

                        if let Some(reject_toast) = rejected {
                            let (lines, fg_raw) = toast_spec(ButtonId::Right, reject_toast);
                            let _ = ui.show_toast(
                                buttons_now,
                                lines,
                                fg_raw,
                                Duration::from_millis(TOAST_MS),
                            );
                            prompt_tone.notify(SoundEvent::ActionFail);
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(250));
                        } else {
                            match class {
                                PressClass::Short => match port_usb_c.power {
                                    PowerState::Off => {
                                        port_usb_c.power = PowerState::On;
                                        port_usb_c.data = DataState::Connected;
                                        port_usb_c.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = ce_tps.set_low();
                                        let _ = p2_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::PwrOn);
                                        let _ = ui.show_toast(
                                            buttons_now,
                                            lines,
                                            fg_raw,
                                            Duration::from_millis(TOAST_MS),
                                        );
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_c.data = DataState::Pulsing {
                                            until: buttons_now
                                                + Duration::from_millis(DATA_DISCONNECT_MS),
                                        };
                                        port_usb_c.busy_until = Some(
                                            buttons_now + Duration::from_millis(DATA_DISCONNECT_MS),
                                        );
                                        let _ = p2_ced.set_high();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::DataOff);
                                        let _ = ui.show_toast(
                                            buttons_now,
                                            lines,
                                            fg_raw,
                                            Duration::from_millis(TOAST_MS),
                                        );
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                },
                                PressClass::Long => match port_usb_c.power {
                                    PowerState::Off => {
                                        port_usb_c.power = PowerState::On;
                                        port_usb_c.data = DataState::Connected;
                                        port_usb_c.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = ce_tps.set_low();
                                        let _ = p2_ced.set_low();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::PwrOn);
                                        let _ = ui.show_toast(
                                            buttons_now,
                                            lines,
                                            fg_raw,
                                            Duration::from_millis(TOAST_MS),
                                        );
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                    PowerState::On => {
                                        port_usb_c.power = PowerState::Off;
                                        port_usb_c.data = DataState::Disconnected;
                                        port_usb_c.busy_until = Some(
                                            buttons_now
                                                + Duration::from_millis(POWER_SWITCH_GUARD_MS),
                                        );
                                        let _ = ce_tps.set_high();
                                        let _ = p2_ced.set_high();
                                        let (lines, fg_raw) =
                                            toast_spec(ButtonId::Right, ToastId::PwrOff);
                                        let _ = ui.show_toast(
                                            buttons_now,
                                            lines,
                                            fg_raw,
                                            Duration::from_millis(TOAST_MS),
                                        );
                                        prompt_tone.notify(SoundEvent::ActionOk);
                                    }
                                },
                                PressClass::Invalid => unreachable!("handled above"),
                            }
                            button_fast_loop_until = Some(buttons_now + Duration::from_millis(350));
                        }
                    }
                }
            }
        }

        #[cfg(feature = "net_http")]
        if combo_active && !left_pressed && !right_pressed {
            combo_active = false;
            combo_pressed_at = None;
            combo_done = false;
            combo_expired = false;
        }

        let now_us = esp_hal::time::Instant::now()
            .duration_since_epoch()
            .as_micros();
        let now = core::time::Duration::from_micros(now_us);
        prompt_tone.tick(now);

        if button_fast_loop_until.is_some_and(|until| Instant::now() < until) {
            loop_delay_ms = loop_delay_ms.min(10);
        } else {
            button_fast_loop_until = None;
        }

        Timer::after_millis(loop_delay_ms).await;
    }
}
