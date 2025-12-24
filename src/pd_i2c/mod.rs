pub mod allowlist;

pub use allowlist::{I2cAllowlist, PdI2cAddr};

/// SW2303 7-bit I2C address.
pub const SW2303_ADDR_7BIT: u8 = 0x3C;
/// TPS55288 7-bit I2C address.
pub const TPS55288_ADDR_7BIT: u8 = 0x74;

/// Netlist I2C SDA name (shared PD I2C bus).
pub const NET_SDA_TPS: &str = "SDA_TPS";
/// Netlist I2C SCL name (shared PD I2C bus).
pub const NET_SCL_TPS: &str = "SCL_TPS";

/// ESP32-S3 (U39) `SDA_TPS` pad number.
pub const SDA_TPS_PIN: u8 = 44;
/// ESP32-S3 `SDA_TPS` GPIO number.
pub const SDA_TPS_GPIO: u8 = 39;

/// ESP32-S3 (U39) `SCL_TPS` pad number.
pub const SCL_TPS_PIN: u8 = 45;
/// ESP32-S3 `SCL_TPS` GPIO number.
pub const SCL_TPS_GPIO: u8 = 40;
