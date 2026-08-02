//! Runtime power sequencing for the TPS55288/SW2303 path.
//!
//! SW2303 is powered from the TPS output while its I2C pull-ups remain on the
//! MCU rail. Keep the I2C pins parked low while TPS output is off so an
//! off/on edge starts from a defined SW2303 power state.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Sw2303PowerGatePhase {
    WaitingForOffApply,
    HoldingOff { since_ms: u64 },
    Off,
    WaitingForPreBootI2cRelease,
    WaitingForBootApply,
    HoldingPor { since_ms: u64 },
    Ready,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Sw2303PowerGate {
    output_requested: bool,
    off_hold_ms: u64,
    por_hold_ms: u64,
    phase: Sw2303PowerGatePhase,
}

impl Sw2303PowerGate {
    pub const fn new(off_hold_ms: u64, por_hold_ms: u64) -> Self {
        Self {
            output_requested: true,
            off_hold_ms,
            por_hold_ms,
            phase: Sw2303PowerGatePhase::WaitingForBootApply,
        }
    }

    pub const fn phase(&self) -> Sw2303PowerGatePhase {
        self.phase
    }

    pub const fn output_requested(&self) -> bool {
        self.output_requested
    }

    pub const fn requires_tps_off(&self) -> bool {
        matches!(
            self.phase,
            Sw2303PowerGatePhase::WaitingForOffApply
                | Sw2303PowerGatePhase::HoldingOff { .. }
                | Sw2303PowerGatePhase::Off
                | Sw2303PowerGatePhase::WaitingForPreBootI2cRelease
        )
    }

    /// The SW2303 restart sequence needs an actual TPS discharge, even when
    /// the owner-facing runtime discharge preference is disabled.
    pub const fn requires_active_discharge(&self) -> bool {
        matches!(
            self.phase,
            Sw2303PowerGatePhase::WaitingForOffApply
                | Sw2303PowerGatePhase::HoldingOff { .. }
                | Sw2303PowerGatePhase::WaitingForPreBootI2cRelease
        )
    }

    pub const fn requires_boot_setpoint(&self) -> bool {
        matches!(
            self.phase,
            Sw2303PowerGatePhase::WaitingForBootApply | Sw2303PowerGatePhase::HoldingPor { .. }
        )
    }

    pub const fn waiting_for_tps_off_apply(&self) -> bool {
        matches!(self.phase, Sw2303PowerGatePhase::WaitingForOffApply)
    }

    pub const fn waiting_for_tps_boot_apply(&self) -> bool {
        matches!(self.phase, Sw2303PowerGatePhase::WaitingForBootApply)
    }

    pub const fn should_park_i2c(&self) -> bool {
        matches!(
            self.phase,
            Sw2303PowerGatePhase::WaitingForOffApply
                | Sw2303PowerGatePhase::HoldingOff { .. }
                | Sw2303PowerGatePhase::Off
                | Sw2303PowerGatePhase::WaitingForPreBootI2cRelease
        )
    }

    pub const fn should_release_i2c(&self) -> bool {
        matches!(
            self.phase,
            Sw2303PowerGatePhase::WaitingForPreBootI2cRelease
        )
    }

    pub const fn allows_sw2303_i2c(&self) -> bool {
        matches!(self.phase, Sw2303PowerGatePhase::Ready)
    }

    pub const fn off_transition_complete(&self) -> bool {
        matches!(
            self.phase,
            Sw2303PowerGatePhase::HoldingOff { .. } | Sw2303PowerGatePhase::Off
        ) && !self.output_requested
    }

    pub const fn on_transition_complete(&self) -> bool {
        matches!(self.phase, Sw2303PowerGatePhase::Ready) && self.output_requested
    }

    pub fn set_output_requested(&mut self, enabled: bool) {
        self.output_requested = enabled;
        if enabled {
            if matches!(self.phase, Sw2303PowerGatePhase::Off) {
                self.phase = Sw2303PowerGatePhase::WaitingForPreBootI2cRelease;
            }
        } else if !matches!(
            self.phase,
            Sw2303PowerGatePhase::WaitingForOffApply
                | Sw2303PowerGatePhase::HoldingOff { .. }
                | Sw2303PowerGatePhase::Off
        ) {
            self.phase = Sw2303PowerGatePhase::WaitingForOffApply;
        }
    }

    pub fn mark_tps_off_applied(&mut self, now_ms: u64) {
        if matches!(self.phase, Sw2303PowerGatePhase::WaitingForOffApply) {
            self.phase = Sw2303PowerGatePhase::HoldingOff { since_ms: now_ms };
        }
    }

    pub fn mark_tps_boot_applied(&mut self, now_ms: u64) {
        if matches!(self.phase, Sw2303PowerGatePhase::WaitingForBootApply) {
            self.phase = Sw2303PowerGatePhase::HoldingPor { since_ms: now_ms };
        }
    }

    pub fn advance(&mut self, now_ms: u64) {
        match self.phase {
            Sw2303PowerGatePhase::HoldingOff { since_ms }
                if now_ms.saturating_sub(since_ms) >= self.off_hold_ms =>
            {
                self.phase = if self.output_requested {
                    Sw2303PowerGatePhase::WaitingForPreBootI2cRelease
                } else {
                    Sw2303PowerGatePhase::Off
                };
            }
            Sw2303PowerGatePhase::HoldingPor { since_ms }
                if now_ms.saturating_sub(since_ms) >= self.por_hold_ms =>
            {
                self.phase = Sw2303PowerGatePhase::Ready;
            }
            _ => {}
        }
    }

    pub fn mark_pre_boot_i2c_released(&mut self) {
        if matches!(
            self.phase,
            Sw2303PowerGatePhase::WaitingForPreBootI2cRelease
        ) {
            self.phase = Sw2303PowerGatePhase::WaitingForBootApply;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OFF_HOLD_MS: u64 = 80;
    const POR_HOLD_MS: u64 = 100;

    #[test]
    fn starts_blocked_until_the_initial_boot_por_has_elapsed() {
        let mut gate = Sw2303PowerGate::new(OFF_HOLD_MS, POR_HOLD_MS);

        assert!(gate.requires_boot_setpoint());
        gate.mark_tps_boot_applied(10);
        gate.advance(109);
        assert!(!gate.allows_sw2303_i2c());
        gate.advance(110);
        assert!(gate.allows_sw2303_i2c());
    }

    #[test]
    fn rapid_on_after_off_keeps_tps_off_for_the_full_window() {
        let mut gate = Sw2303PowerGate::new(OFF_HOLD_MS, POR_HOLD_MS);
        gate.mark_tps_boot_applied(0);
        gate.advance(POR_HOLD_MS);

        gate.set_output_requested(false);
        assert!(gate.requires_tps_off());
        assert!(gate.requires_active_discharge());
        gate.mark_tps_off_applied(200);
        assert!(gate.off_transition_complete());

        gate.set_output_requested(true);
        gate.advance(279);
        assert!(gate.requires_tps_off());
        gate.advance(280);
        assert!(gate.should_release_i2c());
        assert!(gate.should_park_i2c());
        assert!(gate.requires_active_discharge());
        gate.mark_pre_boot_i2c_released();
        assert!(!gate.requires_active_discharge());
    }

    #[test]
    fn steady_off_releases_forced_discharge_after_the_window() {
        let mut gate = Sw2303PowerGate::new(OFF_HOLD_MS, POR_HOLD_MS);
        gate.set_output_requested(false);
        gate.mark_tps_off_applied(0);
        gate.advance(OFF_HOLD_MS);

        assert_eq!(gate.phase(), Sw2303PowerGatePhase::Off);
        assert!(gate.requires_tps_off());
        assert!(gate.should_park_i2c());
        assert!(!gate.requires_active_discharge());
        assert!(gate.off_transition_complete());

        gate.set_output_requested(true);
        assert!(gate.should_release_i2c());
        assert!(gate.requires_active_discharge());
    }

    #[test]
    fn failed_tps_off_write_never_starts_the_off_window() {
        let mut gate = Sw2303PowerGate::new(OFF_HOLD_MS, POR_HOLD_MS);
        gate.set_output_requested(false);
        gate.set_output_requested(true);
        gate.advance(10_000);

        assert!(gate.waiting_for_tps_off_apply());
        assert!(gate.should_park_i2c());
    }

    #[test]
    fn power_on_releases_lines_before_boot_but_blocks_i2c_until_por() {
        let mut gate = Sw2303PowerGate::new(OFF_HOLD_MS, POR_HOLD_MS);
        gate.set_output_requested(false);
        gate.mark_tps_off_applied(0);
        gate.set_output_requested(true);
        gate.advance(OFF_HOLD_MS);
        assert!(gate.should_release_i2c());
        gate.mark_pre_boot_i2c_released();
        gate.mark_tps_boot_applied(OFF_HOLD_MS);

        assert!(!gate.allows_sw2303_i2c());
        gate.advance(OFF_HOLD_MS + POR_HOLD_MS);
        assert!(gate.on_transition_complete());
        assert!(gate.allows_sw2303_i2c());
    }

    #[test]
    fn boot_waits_for_the_pre_boot_i2c_release() {
        let mut gate = Sw2303PowerGate::new(OFF_HOLD_MS, POR_HOLD_MS);
        gate.set_output_requested(false);
        gate.mark_tps_off_applied(0);
        gate.set_output_requested(true);
        gate.advance(OFF_HOLD_MS);
        gate.advance(OFF_HOLD_MS + POR_HOLD_MS);

        assert!(gate.should_release_i2c());
        assert!(gate.requires_tps_off());
    }
}
