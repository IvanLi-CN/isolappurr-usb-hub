/// Input path selected by the single GPIO34/GPIO35 owner.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputPath {
    Off,
    Usb,
    Dc,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputEvent {
    UsbContract9V1A,
    DcStable9To28V,
    DcInvalid,
    ContractLost,
    BreakBeforeMakeElapsed,
    ExternalVbusDetected,
    Fault,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InputPowerSelector {
    path: InputPath,
    pending: Option<InputPath>,
}

impl Default for InputPowerSelector {
    fn default() -> Self {
        Self::new()
    }
}

impl InputPowerSelector {
    pub const fn new() -> Self {
        Self {
            path: InputPath::Off,
            pending: None,
        }
    }

    pub const fn path(self) -> InputPath {
        self.path
    }

    /// Returns the next physical path. A change always returns `Off` first;
    /// the caller must wait at least 5 ms before applying the pending path.
    pub fn handle(&mut self, event: InputEvent) -> InputPath {
        match event {
            InputEvent::UsbContract9V1A if self.path == InputPath::Dc => {
                self.pending = Some(InputPath::Usb);
                self.path = InputPath::Off;
                InputPath::Off
            }
            InputEvent::UsbContract9V1A => {
                self.path = InputPath::Usb;
                self.pending = None;
                InputPath::Usb
            }
            InputEvent::DcStable9To28V => {
                if self.path != InputPath::Dc {
                    self.pending = Some(InputPath::Dc);
                    self.path = InputPath::Off;
                    InputPath::Off
                } else {
                    InputPath::Dc
                }
            }
            InputEvent::BreakBeforeMakeElapsed => match self.pending.take() {
                Some(path) => {
                    self.path = path;
                    path
                }
                None => self.path,
            },
            InputEvent::DcInvalid
            | InputEvent::ContractLost
            | InputEvent::ExternalVbusDetected
            | InputEvent::Fault => {
                self.pending = None;
                self.path = InputPath::Off;
                InputPath::Off
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VbusGateController {
    enabled: bool,
}

/// Narrow request surface for the TPS55288 and its CE_TPS safety pin.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TpsCoordinator {
    enabled: bool,
}

impl TpsCoordinator {
    pub const fn new() -> Self {
        Self { enabled: false }
    }

    pub const fn is_enabled(self) -> bool {
        self.enabled
    }

    pub const fn enable_5v_1a(&mut self, stable: bool, external_vbus: bool) -> bool {
        self.enabled = stable && !external_vbus;
        self.enabled
    }

    pub const fn disable(&mut self) {
        self.enabled = false;
    }
}

/// GPIO ISR output is reduced to an event flag; device servicing happens in
/// task context on the mapped I2C bus.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InterruptSource {
    SharedGpio7,
    InputGpio38,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct InterruptCoordinator {
    gpio7_pending: bool,
    gpio38_pending: bool,
}

impl InterruptCoordinator {
    pub const fn new() -> Self {
        Self {
            gpio7_pending: false,
            gpio38_pending: false,
        }
    }

    pub const fn mark(&mut self, source: InterruptSource) {
        match source {
            InterruptSource::SharedGpio7 => self.gpio7_pending = true,
            InterruptSource::InputGpio38 => self.gpio38_pending = true,
        }
    }

    pub const fn take(&mut self) -> (bool, bool) {
        let pending = (self.gpio7_pending, self.gpio38_pending);
        self.gpio7_pending = false;
        self.gpio38_pending = false;
        pending
    }
}

impl VbusGateController {
    pub const fn new() -> Self {
        Self { enabled: false }
    }

    pub const fn is_enabled(self) -> bool {
        self.enabled
    }

    pub const fn enable_5v_1a(&mut self, tps_stable: bool, external_vbus: bool) -> bool {
        if tps_stable && !external_vbus {
            self.enabled = true;
        } else {
            self.enabled = false;
        }
        self.enabled
    }

    pub const fn disable(&mut self) {
        self.enabled = false;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        InputEvent, InputPath, InputPowerSelector, InterruptCoordinator, InterruptSource,
        TpsCoordinator, VbusGateController,
    };

    #[test]
    fn dc_switch_is_break_before_make() {
        let mut selector = InputPowerSelector::new();
        assert_eq!(selector.handle(InputEvent::UsbContract9V1A), InputPath::Usb);
        assert_eq!(selector.handle(InputEvent::DcStable9To28V), InputPath::Off);
        assert_eq!(selector.path(), InputPath::Off);
        assert_eq!(
            selector.handle(InputEvent::BreakBeforeMakeElapsed),
            InputPath::Dc
        );
        assert_eq!(selector.handle(InputEvent::UsbContract9V1A), InputPath::Off);
        assert_eq!(selector.path(), InputPath::Off);
        assert_eq!(
            selector.handle(InputEvent::BreakBeforeMakeElapsed),
            InputPath::Usb
        );
    }

    #[test]
    fn external_vbus_and_faults_force_off() {
        let mut selector = InputPowerSelector::new();
        selector.handle(InputEvent::UsbContract9V1A);
        assert_eq!(
            selector.handle(InputEvent::ExternalVbusDetected),
            InputPath::Off
        );
        assert_eq!(selector.handle(InputEvent::Fault), InputPath::Off);
    }

    #[test]
    fn gate_requires_tps_stability_and_no_external_vbus() {
        let mut gate = VbusGateController::new();
        assert!(!gate.enable_5v_1a(false, false));
        assert!(!gate.enable_5v_1a(true, true));
        assert!(gate.enable_5v_1a(true, false));
        assert!(!gate.enable_5v_1a(false, false));
        gate.disable();
        assert!(!gate.is_enabled());
    }

    #[test]
    fn tps_owner_fails_closed_and_interrupts_are_deferred() {
        let mut tps = TpsCoordinator::new();
        assert!(!tps.enable_5v_1a(false, false));
        assert!(tps.enable_5v_1a(true, false));
        assert!(!tps.enable_5v_1a(true, true));

        let mut interrupts = InterruptCoordinator::new();
        interrupts.mark(InterruptSource::SharedGpio7);
        interrupts.mark(InterruptSource::InputGpio38);
        assert_eq!(interrupts.take(), (true, true));
        assert_eq!(interrupts.take(), (false, false));
    }
}
