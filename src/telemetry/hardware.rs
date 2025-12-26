use embedded_hal::i2c::SevenBitAddress;

/// Telemetry I2C controller: I2C1.
pub const TELEMETRY_I2C1_SDA_GPIO: u8 = 8;
pub const TELEMETRY_I2C1_SCL_GPIO: u8 = 9;

/// Optional INA226 ALERT/INT pin (not required for v1).
pub const TELEMETRY_I2C1_INT_GPIO: u8 = 7;

/// INA226 (U17) 7-bit I2C address.
pub const INA226_U17_ADDR_7BIT: SevenBitAddress = 0x41;

/// Shared shunt resistor: R29 = 10 mΩ.
pub const U17_R29_SHUNT_RESISTANCE_UOHMS: u32 = 10_000;

/// Expected maximum current for calibration/display.
pub const U17_I_MAX_MA: u16 = 5_000;
