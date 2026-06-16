use embedded_hal::i2c::SevenBitAddress;

/// Telemetry I2C controller: I2C1.
pub const TELEMETRY_I2C1_SDA_GPIO: u8 = 8;
pub const TELEMETRY_I2C1_SCL_GPIO: u8 = 9;

/// Optional INA226 ALERT/INT pin (not required for v1).
pub const TELEMETRY_I2C1_INT_GPIO: u8 = 7;

/// INA226 (U13, USB-A) 7-bit I2C address.
pub const INA226_U13_ADDR_7BIT: SevenBitAddress = 0x40;
/// Counterfeit/clone fallback observed in the field for U13.
pub const INA226_U13_FALLBACK_ADDR_7BIT: SevenBitAddress = 0x44;

/// INA226 (U17, USB-C) 7-bit I2C address.
pub const INA226_U17_ADDR_7BIT: SevenBitAddress = 0x41;
/// Counterfeit/clone fallback observed in the field for U17.
pub const INA226_U17_FALLBACK_ADDR_7BIT: SevenBitAddress = 0x45;

/// USB-A shunt resistor: R22 = 10 mΩ.
pub const U13_R22_SHUNT_RESISTANCE_UOHMS: u32 = 10_000;

/// Shared shunt resistor: R29 = 10 mΩ.
pub const U17_R29_SHUNT_RESISTANCE_UOHMS: u32 = 10_000;

/// Expected maximum current for calibration/display.
pub const U17_I_MAX_MA: u16 = 5_000;

/// INA226 current LSB for U17 at the shared 5 A display/calibration ceiling.
pub const U17_CURRENT_LSB_UA_PER_BIT: u32 = 153;

/// INA226 calibration value for U17 with the shared 10 mΩ shunt.
pub const U17_CALIBRATION: u16 = 3346;

#[cfg(test)]
mod tests {
    use super::{U17_CALIBRATION, U17_CURRENT_LSB_UA_PER_BIT};

    #[test]
    fn u17_calibration_constants_match_shared_5a_profile() {
        assert_eq!(U17_CURRENT_LSB_UA_PER_BIT, 153);
        assert_eq!(U17_CALIBRATION, 3346);
    }
}
