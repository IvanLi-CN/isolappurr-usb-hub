pub mod contract;
pub mod hardware;
pub mod i2c_allowlist;
pub mod sampler;

pub use contract::{Field, SetApplied, TelemetrySnapshot, VoltageCurrent};
pub use hardware::{
    INA226_U17_ADDR_7BIT, TELEMETRY_I2C1_INT_GPIO, TELEMETRY_I2C1_SCL_GPIO,
    TELEMETRY_I2C1_SDA_GPIO, U17_I_MAX_MA, U17_R29_SHUNT_RESISTANCE_UOHMS,
};
pub use i2c_allowlist::{TelemetryI2cAllowlist, TelemetryI2cError};
pub use sampler::TelemetrySampler;
