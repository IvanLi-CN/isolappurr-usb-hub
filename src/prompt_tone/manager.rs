use core::time::Duration;

use crate::buzzer::BuzzerControl;

use super::{
    DEFAULT_DUTY_PCT, DEFAULT_FREQ_HZ, ErrorKind, SoundEvent, SoundId, SoundPattern, SoundRepeat,
    SoundStep,
};

const QUEUE_CAP: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BootSeverity {
    Ok,
    Warn,
    Fail,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ActivePlayback {
    id: SoundId,
    step_index: usize,
    deadline: Option<Duration>,
}

impl ActivePlayback {
    fn new(id: SoundId) -> Self {
        Self {
            id,
            step_index: 0,
            deadline: None,
        }
    }
}

struct SoundQueue {
    slots: [Option<SoundId>; QUEUE_CAP],
}

impl SoundQueue {
    const fn new() -> Self {
        Self {
            slots: [None; QUEUE_CAP],
        }
    }

    fn contains(&self, id: SoundId) -> bool {
        self.slots.iter().any(|&slot| slot == Some(id))
    }

    fn remove(&mut self, id: SoundId) {
        for slot in &mut self.slots {
            if *slot == Some(id) {
                *slot = None;
            }
        }
    }

    fn push(&mut self, id: SoundId) -> bool {
        if self.contains(id) {
            return false;
        }

        if let Some(slot) = self.slots.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(id);
            return true;
        }

        let mut lowest_index: Option<usize> = None;
        let mut lowest_priority: u8 = u8::MAX;
        for (i, slot) in self.slots.iter().enumerate() {
            let Some(existing) = *slot else { continue };
            let prio = sound_priority(existing);
            if prio < lowest_priority {
                lowest_priority = prio;
                lowest_index = Some(i);
            }
        }

        let new_priority = sound_priority(id);
        if let Some(lowest_index) = lowest_index {
            if new_priority > lowest_priority {
                self.slots[lowest_index] = Some(id);
                return true;
            }
        }

        false
    }

    fn pop_highest(&mut self) -> Option<SoundId> {
        let mut best: Option<(usize, u8, SoundId)> = None;
        for (i, slot) in self.slots.iter().enumerate() {
            let Some(id) = *slot else { continue };
            let prio = sound_priority(id);
            match best {
                None => best = Some((i, prio, id)),
                Some((_, best_prio, _)) if prio > best_prio => best = Some((i, prio, id)),
                _ => {}
            }
        }

        let Some((idx, _prio, id)) = best else {
            return None;
        };
        self.slots[idx] = None;
        Some(id)
    }
}

/// Non-blocking prompt tone manager (event → pattern → buzzer control).
///
/// Call [`Self::notify`] on state transitions and call [`Self::tick`] frequently
/// (e.g., every loop iteration) with a monotonic `now`.
pub struct PromptToneManager<B>
where
    B: BuzzerControl,
{
    buzzer: B,
    queue: SoundQueue,

    boot_severity: BootSeverity,
    boot_done_emitted: bool,

    safety_active: bool,

    playing: Option<ActivePlayback>,
    last_now: Duration,
}

impl<B> PromptToneManager<B>
where
    B: BuzzerControl,
{
    pub fn new(buzzer: B) -> Self {
        Self {
            buzzer,
            queue: SoundQueue::new(),
            boot_severity: BootSeverity::Ok,
            boot_done_emitted: false,
            safety_active: false,
            playing: None,
            last_now: Duration::ZERO,
        }
    }

    pub fn notify(&mut self, event: SoundEvent) {
        match event {
            SoundEvent::InitWarn(_) => {
                if self.boot_severity == BootSeverity::Ok {
                    self.boot_severity = BootSeverity::Warn;
                }
            }
            SoundEvent::InitFail(_) => {
                self.boot_severity = BootSeverity::Fail;
            }
            SoundEvent::InitDone => {
                if self.boot_done_emitted {
                    return;
                }
                self.boot_done_emitted = true;

                let id = match self.boot_severity {
                    BootSeverity::Ok => SoundId::BootOk,
                    BootSeverity::Warn => SoundId::BootWarn,
                    BootSeverity::Fail => SoundId::BootFail,
                };
                self.request_one_shot(id);
            }

            SoundEvent::EnterSafety(_) => {
                self.safety_active = true;
                self.queue.remove(SoundId::SafetyAlarm);
                self.start_immediately(SoundId::SafetyAlarm);
            }
            SoundEvent::ExitSafety(_) => {
                self.safety_active = false;
                self.queue.remove(SoundId::SafetyAlarm);
                if self.playing.is_some_and(|p| p.id == SoundId::SafetyAlarm) {
                    let _ = self.buzzer.stop();
                    self.playing = None;
                }
            }

            SoundEvent::EnterError(kind) => {
                let id = map_error_to_sound(kind);
                self.request_one_shot(id);
            }
            SoundEvent::ExitError(_) => {}
        }
    }

    pub fn tick(&mut self, now: Duration) {
        let now = now.max(self.last_now);
        self.last_now = now;

        if self.safety_active && !self.playing.is_some_and(|p| p.id == SoundId::SafetyAlarm) {
            self.start_with_now(SoundId::SafetyAlarm, now);
        }

        self.advance_playback(now);

        if self.safety_active || self.playing.is_some() {
            return;
        }

        if let Some(id) = self.queue.pop_highest() {
            self.start_with_now(id, now);
        }
    }

    pub fn buzzer_mut(&mut self) -> &mut B {
        &mut self.buzzer
    }

    pub fn into_buzzer(self) -> B {
        self.buzzer
    }

    fn request_one_shot(&mut self, id: SoundId) {
        if id == SoundId::SafetyAlarm {
            self.safety_active = true;
            self.start_immediately(SoundId::SafetyAlarm);
            return;
        }

        if self.is_one_shot_active_or_pending(id) {
            return;
        }

        let new_prio = sound_priority(id);
        let should_preempt = self
            .playing
            .is_some_and(|p| p.id != SoundId::SafetyAlarm && new_prio > sound_priority(p.id));

        if should_preempt && !self.safety_active {
            let _ = self.buzzer.stop();
            self.start_immediately(id);
            return;
        }

        let _ = self.queue.push(id);
    }

    fn is_one_shot_active_or_pending(&self, id: SoundId) -> bool {
        self.playing.is_some_and(|p| p.id == id) || self.queue.contains(id)
    }

    fn start_immediately(&mut self, id: SoundId) {
        self.playing = Some(ActivePlayback::new(id));
        self.apply_current_step();
    }

    fn start_with_now(&mut self, id: SoundId, now: Duration) {
        self.playing = Some(ActivePlayback::new(id));
        self.apply_current_step();
        self.schedule_current_deadline(now);
    }

    fn advance_playback(&mut self, now: Duration) {
        let Some(mut playing) = self.playing else {
            return;
        };

        let Some(pattern) = pattern_for(playing.id) else {
            let _ = self.buzzer.stop();
            self.playing = None;
            return;
        };
        if pattern.steps.is_empty() {
            let _ = self.buzzer.stop();
            self.playing = None;
            return;
        }

        if playing.deadline.is_none() {
            let step = pattern.steps[playing.step_index];
            playing.deadline = Some(now.saturating_add(step_duration(step)));
        }

        let mut guard = 0usize;
        while let Some(deadline) = playing.deadline {
            if now < deadline {
                break;
            }

            guard += 1;
            if guard > pattern.steps.len().saturating_add(2) {
                let _ = self.buzzer.stop();
                self.playing = None;
                return;
            }

            playing.step_index += 1;
            if playing.step_index >= pattern.steps.len() {
                match pattern.repeat {
                    SoundRepeat::Once => {
                        let _ = self.buzzer.stop();
                        self.playing = None;
                        return;
                    }
                    SoundRepeat::Loop => {
                        playing.step_index = 0;
                    }
                }
            }

            self.playing = Some(playing);
            self.apply_current_step();
            self.schedule_current_deadline(now);
            playing = self.playing.expect("just set");
        }

        self.playing = Some(playing);
    }

    fn apply_current_step(&mut self) {
        let Some(playing) = self.playing else {
            return;
        };
        let Some(pattern) = pattern_for(playing.id) else {
            let _ = self.buzzer.stop();
            self.playing = None;
            return;
        };
        let Some(step) = pattern.steps.get(playing.step_index).copied() else {
            let _ = self.buzzer.stop();
            self.playing = None;
            return;
        };

        match step {
            SoundStep::Tone {
                freq_hz, duty_pct, ..
            } => {
                let _ = self.buzzer.start_tone(freq_hz, duty_pct);
            }
            SoundStep::Silence { .. } => {
                let _ = self.buzzer.stop();
            }
        }
    }

    fn schedule_current_deadline(&mut self, now: Duration) {
        let Some(mut playing) = self.playing else {
            return;
        };
        let Some(pattern) = pattern_for(playing.id) else {
            return;
        };
        let Some(step) = pattern.steps.get(playing.step_index).copied() else {
            return;
        };

        playing.deadline = Some(now.saturating_add(step_duration(step)));
        self.playing = Some(playing);
    }
}

fn step_duration(step: SoundStep) -> Duration {
    match step {
        SoundStep::Tone { duration, .. } => duration,
        SoundStep::Silence { duration } => duration,
    }
}

fn sound_priority(id: SoundId) -> u8 {
    match id {
        SoundId::SafetyAlarm => 100,

        SoundId::BootFail => 90,
        SoundId::BootWarn => 80,
        SoundId::BootOk => 70,

        SoundId::ErrorOnce => 60,
        SoundId::WarningOnce => 50,

        SoundId::RecoverOnce => 40,
        SoundId::ActionOnce => 30,
        SoundId::PdOnce => 30,

        SoundId::OverTemp => 100,
        SoundId::OverCurrent => 100,
        SoundId::OverVoltage => 100,
    }
}

fn map_error_to_sound(kind: ErrorKind) -> SoundId {
    match kind {
        ErrorKind::Sw2303I2c => SoundId::ErrorOnce,
        ErrorKind::UiRender => SoundId::WarningOnce,
        _ => SoundId::ErrorOnce,
    }
}

// --- Default patterns ---

const BOOT_OK_STEPS: &[SoundStep] = &[
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(250),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(250),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(250),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(250),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(250),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(250),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(250),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(250),
    },
];

const BOOT_WARN_STEPS: &[SoundStep] = &[
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(500),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(250),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(500),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(750),
    },
];

const BOOT_FAIL_STEPS: &[SoundStep] = &[
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(800),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(800),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
];

const WARNING_ONCE_STEPS: &[SoundStep] = &[
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(200),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(200),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(200),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(200),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(200),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
];

const ERROR_ONCE_STEPS: &[SoundStep] = &[
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(150),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(150),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(150),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(150),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(150),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(150),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(200),
    },
];

const SAFETY_ALARM_STEPS: &[SoundStep] = &[
    SoundStep::Tone {
        freq_hz: DEFAULT_FREQ_HZ,
        duty_pct: DEFAULT_DUTY_PCT,
        duration: Duration::from_millis(700),
    },
    SoundStep::Silence {
        duration: Duration::from_millis(300),
    },
];

pub const PATTERN_BOOT_OK: SoundPattern = SoundPattern::once(BOOT_OK_STEPS);
pub const PATTERN_BOOT_WARN: SoundPattern = SoundPattern::once(BOOT_WARN_STEPS);
pub const PATTERN_BOOT_FAIL: SoundPattern = SoundPattern::once(BOOT_FAIL_STEPS);
pub const PATTERN_WARNING_ONCE: SoundPattern = SoundPattern::once(WARNING_ONCE_STEPS);
pub const PATTERN_ERROR_ONCE: SoundPattern = SoundPattern::once(ERROR_ONCE_STEPS);
pub const PATTERN_SAFETY_ALARM: SoundPattern = SoundPattern::looped(SAFETY_ALARM_STEPS);

fn pattern_for(id: SoundId) -> Option<&'static SoundPattern> {
    match id {
        SoundId::BootOk => Some(&PATTERN_BOOT_OK),
        SoundId::BootWarn => Some(&PATTERN_BOOT_WARN),
        SoundId::BootFail => Some(&PATTERN_BOOT_FAIL),
        SoundId::WarningOnce => Some(&PATTERN_WARNING_ONCE),
        SoundId::ErrorOnce => Some(&PATTERN_ERROR_ONCE),
        SoundId::SafetyAlarm => Some(&PATTERN_SAFETY_ALARM),
        _ => None,
    }
}
