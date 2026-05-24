pub mod allowlist;
pub mod sw2303;
pub mod tps55288;
pub mod types;

pub use allowlist::{I2cAllowlist, PdI2cAddr};
pub use types::{PowerRequest, PowerSetpoint};

/// SW2303 7-bit I2C address.
pub const SW2303_ADDR_7BIT: u8 = 0x3C;
/// TPS55288 7-bit I2C address.
pub const TPS55288_ADDR_7BIT: u8 = 0x74;

/// Netlist I2C SDA name for the system bus shared by TPS55288 + telemetry.
pub const NET_SDA: &str = "SDA";
/// Netlist I2C SCL name for the system bus shared by TPS55288 + telemetry.
pub const NET_SCL: &str = "SCL";
/// Netlist I2C SDA name for the dedicated SW2303 bus.
pub const NET_SDA_SW: &str = "SDA_SW";
/// Netlist I2C SCL name for the dedicated SW2303 bus.
pub const NET_SCL_SW: &str = "SCL_SW";

/// ESP32-S3 (U19) `SDA` pad number.
pub const SDA_PIN: u8 = 13;
/// ESP32-S3 `SDA` GPIO number.
pub const SDA_GPIO: u8 = 8;

/// ESP32-S3 (U19) `SCL` pad number.
pub const SCL_PIN: u8 = 14;
/// ESP32-S3 `SCL` GPIO number.
pub const SCL_GPIO: u8 = 9;

/// ESP32-S3 (U19) `SDA_SW` pad number.
pub const SDA_SW_PIN: u8 = 44;
/// ESP32-S3 `SDA_SW` GPIO number.
pub const SDA_SW_GPIO: u8 = 39;

/// ESP32-S3 (U19) `SCL_SW` pad number.
pub const SCL_SW_PIN: u8 = 45;
/// ESP32-S3 `SCL_SW` GPIO number.
pub const SCL_SW_GPIO: u8 = 40;
