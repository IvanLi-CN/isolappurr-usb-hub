//! ESP32-S3 LEDC-based buzzer driver (GPIO21).
//!
//! This driver is intentionally conservative:
//! - GPIO is configured as push-pull, no pulls, low drive strength (5mA)
//! - PWM duty defaults to 0% (silent) and `stop()` forces duty back to 0%
//!
//! The buzzer is expected to be connected to GPIO21 via an NPN stage; callers
//! should keep duty cycles low.

use super::{BuzzerControl, BuzzerError};

use esp_hal::{
    gpio::{DriveMode, DriveStrength, Level, Output, OutputConfig, OutputPin, Pull},
    ledc::{
        LSGlobalClkSource, Ledc, LowSpeed,
        channel::{self, ChannelIFace},
        timer::{self, TimerIFace},
    },
    time::Rate,
};

/// A non-blocking buzzer driver using ESP32-S3 LEDC PWM.
///
/// Designed for GPIO21 (see module docs). The pin is configured and then
/// frozen before being routed to LEDC, preventing LEDC from overriding the
/// conservative drive strength settings.
pub struct LedcBuzzer<'d> {
    _ledc: Ledc<'d>,
    timer: timer::Timer<'d, LowSpeed>,
    channel: channel::Number,
    duty_resolution: timer::config::Duty,
    current_freq_hz: u32,
}

impl<'d> LedcBuzzer<'d> {
    /// Create a new LEDC buzzer driver.
    ///
    /// For this board, `buzzer_pin` should be GPIO21.
    pub fn new(
        ledc: esp_hal::peripherals::LEDC<'d>,
        buzzer_pin: impl OutputPin + 'd,
    ) -> Result<Self, BuzzerError> {
        let config = OutputConfig::default()
            .with_drive_mode(DriveMode::PushPull)
            .with_drive_strength(DriveStrength::_5mA)
            .with_pull(Pull::None);

        // Configure as GPIO output, silent by default, then freeze before LEDC
        // routing so peripherals can't override drive strength.
        let buzzer_output = Output::new(buzzer_pin, Level::Low, config).into_peripheral_output();

        let mut ledc = Ledc::new(ledc);
        ledc.set_global_slow_clock(LSGlobalClkSource::APBClk);

        // Pick a moderate duty resolution; high enough for smooth low-duty
        // control, low enough to keep wide frequency range support.
        let duty_resolution = timer::config::Duty::Duty10Bit;

        let mut timer0 = ledc.timer::<LowSpeed>(timer::Number::Timer0);
        timer0
            .configure(timer::config::Config {
                duty: duty_resolution,
                clock_source: timer::LSClockSource::APBClk,
                // Arbitrary initial frequency; duty is 0% so the buzzer is silent.
                frequency: Rate::from_hz(1_000),
            })
            .map_err(|_| BuzzerError::Hardware)?;

        let mut channel0 = ledc.channel::<LowSpeed>(channel::Number::Channel0, buzzer_output);
        channel0
            .configure(channel::config::Config {
                timer: &timer0,
                duty_pct: 0,
                drive_mode: DriveMode::PushPull,
            })
            .map_err(|_| BuzzerError::Hardware)?;

        Ok(Self {
            _ledc: ledc,
            timer: timer0,
            channel: channel::Number::Channel0,
            duty_resolution,
            current_freq_hz: 1_000,
        })
    }

    fn set_duty_pct(&self, duty_pct: u8) -> Result<(), BuzzerError> {
        if duty_pct > 100 {
            return Err(BuzzerError::InvalidDutyPct(duty_pct));
        }

        let duty_bits = self.duty_resolution as u32;
        let duty_range = 1u32 << duty_bits;
        let duty_value = (duty_range * duty_pct as u32) / 100;

        // Mirror the esp-hal LEDC channel driver:
        // - duty register stores duty << 4
        // - kick duty_start, then para_up to apply
        let ledc = esp_hal::peripherals::LEDC::regs();
        let ch = self.channel as usize;
        ledc.ch(ch)
            .duty()
            .write(|w| unsafe { w.duty().bits(duty_value << 4) });

        ledc.ch(ch).conf1().write(|w| {
            w.duty_start().set_bit();
            w.duty_inc().set_bit();
            unsafe {
                w.duty_num().bits(0x1);
                w.duty_cycle().bits(0x1);
                w.duty_scale().bits(0x0)
            }
        });

        ledc.ch(ch).conf0().modify(|_, w| w.para_up().set_bit());

        Ok(())
    }
}

impl BuzzerControl for LedcBuzzer<'_> {
    fn start_tone(&mut self, freq_hz: u32, duty_pct: u8) -> Result<(), BuzzerError> {
        if freq_hz == 0 {
            return Err(BuzzerError::InvalidFreqHz(freq_hz));
        }
        if duty_pct > 100 {
            return Err(BuzzerError::InvalidDutyPct(duty_pct));
        }

        if self.current_freq_hz != freq_hz {
            self.timer
                .configure(timer::config::Config {
                    duty: self.duty_resolution,
                    clock_source: timer::LSClockSource::APBClk,
                    frequency: Rate::from_hz(freq_hz),
                })
                .map_err(|_| BuzzerError::Hardware)?;
            self.current_freq_hz = freq_hz;
        }

        self.set_duty_pct(duty_pct)
    }

    fn stop(&mut self) -> Result<(), BuzzerError> {
        self.set_duty_pct(0)
    }
}
