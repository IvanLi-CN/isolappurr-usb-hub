//! Prompt tone public types (IDs, events, and pattern "shape").
//!
//! The prompt tone manager is a non-blocking state machine that maps events
//! (`SoundEvent`) to predefined sound patterns (`SoundPattern`) and drives the
//! buzzer hardware via [`crate::buzzer::BuzzerControl`].
//!
//! This module intentionally contains *no* hardware details and performs no
//! allocations (`no_std`, no heap).

use core::time::Duration;

mod manager;

pub use manager::PromptToneManager;

/// Default base frequency in Hertz.
///
/// Matches the buzzer's nominal frequency and is used for most patterns.
pub const DEFAULT_FREQ_HZ: u32 = 2700;

/// Default duty cycle in percent.
///
/// "Light volume" is a safety requirement (no base resistor on the NPN stage).
/// Implementations should keep duty cycles low (typically 5–10%) and avoid
/// extended high-duty tones.
pub const DEFAULT_DUTY_PCT: u8 = 8;

/// Predefined prompt sounds.
///
/// This is the *catalog* of sounds the firmware can play. Patterns, priorities,
/// and mapping from events live in the prompt tone manager implementation.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SoundId {
    /// Normal boot completed successfully.
    BootOk,
    /// Boot completed with a warning (degraded, but runnable).
    BootWarn,
    /// Boot failed in a critical path.
    BootFail,

    /// A non-safety warning during runtime.
    WarningOnce,
    /// A general runtime error.
    ErrorOnce,

    /// Continuous alarm for safety-critical conditions.
    SafetyAlarm,

    /// Optional "recovered" acknowledgement (reserved for future wiring).
    RecoverOnce,

    /// Reserved: a short acknowledgement for user actions.
    ActionOnce,
    /// Reserved: PD-related acknowledgement or alert.
    PdOnce,

    /// Reserved: safety-specific alarms (may be mapped to `SafetyAlarm`).
    OverTemp,
    OverCurrent,
    OverVoltage,
}

/// Events reported by the system to the prompt tone manager.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SoundEvent {
    /// Initialization finished (manager may decide between `BootOk/BootWarn/BootFail`).
    InitDone,
    /// Initialization completed with a warning.
    InitWarn(InitWarnReason),
    /// Initialization failed in a critical path.
    InitFail(InitFailReason),

    /// Entered a general (non-safety) runtime error state.
    EnterError(ErrorKind),
    /// Exited a general runtime error state (reserved for future use).
    ExitError(ErrorKind),

    /// Entered a safety-critical state (requires continuous alarm).
    EnterSafety(SafetyKind),
    /// Exited a safety-critical state (must stop the alarm immediately).
    ExitSafety(SafetyKind),
}

/// Warning reasons during initialization.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitWarnReason {
    /// INA226 init failed.
    Ina226Init,
    /// Display init or first-frame render failed.
    DisplayInit,
}

/// Failure reasons during initialization.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitFailReason {
    /// SW2303 "enable profile" failed repeatedly during boot.
    Sw2303ProfileBoot,
    /// Reserved: PD/port subsystem unavailable during boot.
    PdCritical,
}

/// General runtime error kinds.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorKind {
    /// SW2303 I2C read/write error latched.
    Sw2303I2c,
    /// UI rendering error latched.
    UiRender,
    /// Reserved: PD negotiation/contract error.
    Pd,
}

/// Safety-critical runtime kinds.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SafetyKind {
    /// TPS55288 apply/config error latched.
    TpsApply,
    /// Reserved: temperature too high.
    OverTemp,
    /// Reserved: current too high.
    OverCurrent,
    /// Reserved: voltage too high.
    OverVoltage,
}

/// A single step in a prompt sound pattern.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SoundStep {
    /// Output a tone for the given duration.
    Tone {
        freq_hz: u32,
        duty_pct: u8,
        duration: Duration,
    },
    /// Silence for the given duration.
    Silence { duration: Duration },
}

/// Pattern repeat behavior.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SoundRepeat {
    /// Play the pattern once, then stop.
    Once,
    /// Loop the pattern indefinitely until stopped/preempted.
    Loop,
}

/// A prompt sound pattern definition.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SoundPattern {
    /// The pattern steps to play in order.
    pub steps: &'static [SoundStep],
    /// Whether the pattern repeats.
    pub repeat: SoundRepeat,
}

impl SoundPattern {
    /// Create a one-shot pattern from a static step slice.
    pub const fn once(steps: &'static [SoundStep]) -> Self {
        Self {
            steps,
            repeat: SoundRepeat::Once,
        }
    }

    /// Create a looping pattern from a static step slice.
    pub const fn looped(steps: &'static [SoundStep]) -> Self {
        Self {
            steps,
            repeat: SoundRepeat::Loop,
        }
    }
}
