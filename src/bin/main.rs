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

const BUILD_GIT_SHA: &str = env!("USB_HUB_BUILD_GIT_SHA");
const BUILD_GIT_REF: &str = env!("USB_HUB_BUILD_GIT_REF");
const BUILD_GIT_DIRTY: &str = env!("USB_HUB_BUILD_GIT_DIRTY");
const BUILD_PROFILE: &str = env!("USB_HUB_BUILD_PROFILE");

use core::cell::RefCell;
#[cfg(feature = "net_http")]
use core::fmt::Write as _;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use critical_section::Mutex;
#[cfg(feature = "net_http")]
use defmt::debug;
use defmt::info;
use embassy_executor::Spawner;
#[cfg(feature = "net_http")]
use embassy_futures::select::{Either, select};
#[cfg(feature = "net_http")]
use embassy_sync::{blocking_mutex::raw::CriticalSectionRawMutex, signal::Signal};
use embassy_time::Timer;
use esp_hal::clock::CpuClock;
use esp_hal::dma::{DmaRxBuf, DmaTxBuf};
use esp_hal::gpio::{
    AnyPin, DriveMode, Event, Flex, Input, InputConfig, Io, Level, Output, OutputConfig, Pull,
};
use esp_hal::i2c::master::{Config as I2cConfig, I2c, SoftwareTimeout};
use esp_hal::spi::Mode;
use esp_hal::spi::master::{Config as SpiConfig, Spi};
use esp_hal::time::{Duration, Instant, Rate};
use esp_hal::timer::timg::TimerGroup;
#[cfg(feature = "net_http")]
use esp_hal::usb_serial_jtag::UsbSerialJtag;
use esp_hal::{dma_buffers, handler, ram};
use isolapurr_usb_hub::buzzer::ledc::LedcBuzzer;
use isolapurr_usb_hub::display_ui::{
    ActiveLowBacklight, DASHBOARD_BG_RGB8, DisplayUi, EspHalSpinTimer, NormalUiField, NormalUiPort,
    NormalUiPortBadge, NormalUiPortMode, NormalUiSnapshot, UsbCDisplayInput, WORKBUF_SIZE,
    resolve_usb_c_display,
};
#[cfg(feature = "net_http")]
use isolapurr_usb_hub::idle_bias::{
    IDLE_BIAS_POINT_COUNT, IDLE_BIAS_SAMPLE_COUNT, IDLE_BIAS_SAMPLE_INTERVAL_MS,
    IDLE_BIAS_SETTLE_WINDOW_MS, IdleBiasCalibration, IdleBiasMetadata, average_current_ma,
    corrected_current_ma, corrected_power_mw, idle_bias_point_voltage_mv,
};
use isolapurr_usb_hub::pd_i2c::I2cAllowlist;
use isolapurr_usb_hub::pd_i2c::PowerRequest;
use isolapurr_usb_hub::pd_i2c::PowerSetpoint;
use isolapurr_usb_hub::pd_i2c::TPS55288_ADDR_7BIT;
use isolapurr_usb_hub::pd_i2c::sw2303::{
    EnableProfileStatus, apply_enable_profile, apply_line_compensation, read_power_request,
    set_path_control, trigger_cc_un_driving,
};
use isolapurr_usb_hub::pd_i2c::tps55288::{
    TpsApplyState, apply_cable_compensation, apply_light_load_mode, apply_setpoint,
    boot_supply_setpoint, power_request_to_setpoint, stop_output_and_enable_discharge,
};
use isolapurr_usb_hub::power_config::{
    MANUAL_DEFAULT_CURRENT_MA, PowerConfig, Sw2303CapabilityReadback, Sw2303PathControl, TpsMode,
    clamp_manual_current_ma, quantize_manual_voltage_mv, resolve_manual_path_control,
};
use isolapurr_usb_hub::prompt_tone::{
    DEFAULT_DUTY_PCT, DEFAULT_FREQ_HZ, ErrorKind, InitWarnReason, PromptToneManager, SafetyKind,
    SoundEvent,
};
#[cfg(feature = "net_http")]
use isolapurr_usb_hub::provisioning;
use isolapurr_usb_hub::release_version;
use isolapurr_usb_hub::telemetry::{Field, NormalUiTelemetrySampler, TelemetryI2cAllowlist};

#[cfg(feature = "net_http")]
use isolapurr_usb_hub::telemetry::PortMetrics;
use {esp_backtrace as _, esp_println as _};

use spi_device::CsSpiDevice;

// This creates a default app-descriptor required by the esp-idf bootloader.
// For more information see: <https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/app_image_format.html#application-description>
esp_bootloader_esp_idf::esp_app_desc!();

static mut DISPLAY_WORKBUF: [u8; WORKBUF_SIZE] = [0; WORKBUF_SIZE];

static TPS_INT: Mutex<RefCell<Option<Input>>> = Mutex::new(RefCell::new(None));
static TPS_INT_DIRTY: AtomicBool = AtomicBool::new(false);
#[cfg(feature = "net_http")]
static PSRAM_SIZE_BYTES: AtomicUsize = AtomicUsize::new(0);

#[cfg(feature = "net_http")]
#[derive(Clone, Copy)]
enum WifiProvisioningCommand {
    Store(provisioning::WifiCredentials),
    Clear,
}

#[cfg(feature = "net_http")]
static WIFI_PROVISIONING_PENDING: Mutex<RefCell<Option<WifiProvisioningCommand>>> =
    Mutex::new(RefCell::new(None));

#[cfg(feature = "net_http")]
static WIFI_PROVISIONING_RESULT: Signal<CriticalSectionRawMutex, bool> = Signal::new();

#[cfg(feature = "net_http")]
static USB_C_ROUTE_RESULT: Signal<CriticalSectionRawMutex, bool> = Signal::new();

#[cfg(feature = "net_http")]
static POWER_CONFIG_RESULT: Signal<CriticalSectionRawMutex, bool> = Signal::new();

#[cfg(feature = "net_http")]
static POWER_RUNTIME_RESULT: Signal<CriticalSectionRawMutex, bool> = Signal::new();

#[cfg(feature = "net_http")]
static IDLE_BIAS_RESULT: Signal<CriticalSectionRawMutex, bool> = Signal::new();

#[cfg(feature = "net_http")]
#[derive(Clone, Copy, PartialEq, Eq)]
enum SettingsResetResult {
    Complete,
    Partial,
    Failed,
}

#[cfg(feature = "net_http")]
static SETTINGS_RESET_RESULT: Signal<CriticalSectionRawMutex, SettingsResetResult> = Signal::new();

#[cfg(feature = "net_http")]
static WIFI_CREDENTIALS_CACHE: Mutex<RefCell<Option<provisioning::WifiCredentials>>> =
    Mutex::new(RefCell::new(None));

#[cfg(feature = "net_http")]
static REBOOT_PENDING: AtomicBool = AtomicBool::new(false);

include!("firmware_main/usb_console.inc");

include!("firmware_main/ui_runtime.inc");

#[esp_rtos::main]
async fn main(_spawner: Spawner) {
    include!("firmware_main/main_runtime.inc")
}
