//! Buzzer driver abstractions.
//!
//! This module defines the minimal, stable API required by the prompt tone
//! manager. Hardware-specific PWM setup (e.g. ESP32-S3 LEDC) is implemented in
//! a separate task.

/// A buzzer control error.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BuzzerError {
    /// The duty cycle is out of range (0..=100).
    InvalidDutyPct(u8),
    /// The requested frequency is invalid (for example, zero).
    InvalidFreqHz(u32),
    /// The underlying driver/hardware reported an error.
    Hardware,
}

/// Minimal, non-blocking control of a buzzer output.
///
/// Implementations are expected to drive the buzzer using hardware PWM so that
/// tone generation does not block the main loop.
pub trait BuzzerControl {
    /// Start outputting a square-wave tone.
    ///
    /// - `freq_hz`: Tone frequency in Hertz.
    /// - `duty_pct`: Duty cycle in percent (0..=100). The default design target
    ///   is a *light* volume, so callers should keep this low.
    ///
    /// This method must be non-blocking and return quickly.
    fn start_tone(&mut self, freq_hz: u32, duty_pct: u8) -> Result<(), BuzzerError>;

    /// Stop any output and ensure the buzzer is silent.
    ///
    /// This method must be non-blocking and return quickly.
    fn stop(&mut self) -> Result<(), BuzzerError>;
}
