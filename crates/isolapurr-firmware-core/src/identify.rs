pub const IDENTIFY_DURATION_MS: u64 = 5_000;
pub const IDENTIFY_BORDER_TOGGLE_MS: u64 = 250;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct IdentifyState {
    started_at_ms: Option<u64>,
}

impl IdentifyState {
    pub const fn trigger(&mut self, now_ms: u64) {
        self.started_at_ms = Some(now_ms);
    }

    pub const fn cancel(&mut self) {
        self.started_at_ms = None;
    }

    pub const fn is_active(&self, now_ms: u64) -> bool {
        match self.started_at_ms {
            Some(started_at_ms) => now_ms.saturating_sub(started_at_ms) < IDENTIFY_DURATION_MS,
            None => false,
        }
    }

    pub const fn border_phase_on(&self, now_ms: u64) -> bool {
        match self.started_at_ms {
            Some(started_at_ms) => {
                (now_ms.saturating_sub(started_at_ms) / IDENTIFY_BORDER_TOGGLE_MS) % 2 == 0
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{IDENTIFY_DURATION_MS, IdentifyState};

    #[test]
    fn stays_active_for_exactly_five_seconds() {
        let mut state = IdentifyState::default();
        state.trigger(1_000);

        assert!(state.is_active(5_999));
        assert!(!state.is_active(1_000 + IDENTIFY_DURATION_MS));
    }

    #[test]
    fn alternates_border_every_250ms() {
        let mut state = IdentifyState::default();
        state.trigger(0);

        assert!(state.border_phase_on(0));
        assert!(state.border_phase_on(249));
        assert!(!state.border_phase_on(250));
        assert!(state.border_phase_on(500));
    }

    #[test]
    fn retrigger_restarts_and_cancel_stops() {
        let mut state = IdentifyState::default();
        state.trigger(0);
        state.trigger(4_900);
        assert!(state.is_active(5_000));
        state.cancel();
        assert!(!state.is_active(5_000));
    }
}
