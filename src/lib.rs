#![no_std]

extern crate alloc;

pub mod buzzer;
pub mod display_ui;
pub mod idle_bias;
pub mod pd_i2c;
pub mod power_config;
pub mod prompt_tone;
#[cfg(feature = "net_http")]
pub mod provisioning;
pub mod telemetry;
pub mod thermal;

pub fn release_version() -> &'static str {
    option_env!("ISOLAPURR_RELEASE_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}
