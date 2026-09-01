/// Minimal PD 2.0 source policy used by the tps-fusb output port.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceState {
    Detached,
    Prepare5V,
    VbusValid,
    SourceCaps,
    WaitRequest,
    Contract5V,
    Fault,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceEvent {
    Attach,
    VbusValid,
    Request { pdo_index: u8, current_ma: u16 },
    GetSourceCap,
    SoftReset,
    HardReset,
    Detach,
    PowerFault,
    ProtocolFault,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceAction {
    Enable5V1A,
    DisableVbus,
    SendSourceCaps,
    SendAccept,
    SendReject,
    SendSoftReset,
    SendHardReset,
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SourcePolicy {
    state: SourceState,
}

impl Default for SourcePolicy {
    fn default() -> Self {
        Self::new()
    }
}

impl SourcePolicy {
    pub const fn new() -> Self {
        Self {
            state: SourceState::Detached,
        }
    }

    pub const fn state(self) -> SourceState {
        self.state
    }

    pub const fn handle(&mut self, event: SourceEvent) -> SourceAction {
        use SourceAction::*;
        use SourceState::*;

        match (self.state, event) {
            (Detached, SourceEvent::Attach) => {
                self.state = Prepare5V;
                Enable5V1A
            }
            (_, SourceEvent::Detach) => {
                self.state = Detached;
                DisableVbus
            }
            (_, SourceEvent::PowerFault | SourceEvent::ProtocolFault) => {
                self.state = Fault;
                DisableVbus
            }
            (_, SourceEvent::HardReset) => {
                self.state = Prepare5V;
                SendHardReset
            }
            (_, SourceEvent::SoftReset) if !matches!(self.state, Detached | Fault) => {
                self.state = SourceCaps;
                SendSourceCaps
            }
            (Prepare5V, SourceEvent::VbusValid) => {
                self.state = SourceCaps;
                SendSourceCaps
            }
            (SourceCaps, SourceEvent::GetSourceCap)
            | (WaitRequest, SourceEvent::GetSourceCap)
            | (Contract5V, SourceEvent::GetSourceCap) => SendSourceCaps,
            (
                SourceCaps,
                SourceEvent::Request {
                    pdo_index,
                    current_ma,
                },
            )
            | (
                WaitRequest,
                SourceEvent::Request {
                    pdo_index,
                    current_ma,
                },
            ) if pdo_index == 1 && current_ma <= 1_000 => {
                self.state = Contract5V;
                SendAccept
            }
            (SourceCaps, SourceEvent::Request { .. })
            | (WaitRequest, SourceEvent::Request { .. }) => {
                self.state = Fault;
                DisableVbus
            }
            (SourceCaps, _) => {
                self.state = WaitRequest;
                None
            }
            (Fault, SourceEvent::Attach) => {
                self.state = Prepare5V;
                Enable5V1A
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{SourceAction, SourceEvent, SourcePolicy, SourceState};

    #[test]
    fn accepts_only_first_pdo_at_one_amp() {
        let mut policy = SourcePolicy::new();
        assert_eq!(policy.handle(SourceEvent::Attach), SourceAction::Enable5V1A);
        assert_eq!(
            policy.handle(SourceEvent::VbusValid),
            SourceAction::SendSourceCaps
        );
        assert_eq!(
            policy.handle(SourceEvent::Request {
                pdo_index: 1,
                current_ma: 1_000
            }),
            SourceAction::SendAccept
        );
        assert_eq!(policy.state(), SourceState::Contract5V);
    }

    #[test]
    fn rejects_other_pdos_and_overcurrent() {
        for request in [
            SourceEvent::Request {
                pdo_index: 2,
                current_ma: 500,
            },
            SourceEvent::Request {
                pdo_index: 1,
                current_ma: 1_001,
            },
        ] {
            let mut policy = SourcePolicy::new();
            policy.handle(SourceEvent::Attach);
            policy.handle(SourceEvent::VbusValid);
            assert_eq!(policy.handle(request), SourceAction::DisableVbus);
            assert_eq!(policy.state(), SourceState::Fault);
        }
    }

    #[test]
    fn any_fault_or_detach_disables_vbus() {
        let mut policy = SourcePolicy::new();
        policy.handle(SourceEvent::Attach);
        assert_eq!(
            policy.handle(SourceEvent::PowerFault),
            SourceAction::DisableVbus
        );
        assert_eq!(policy.state(), SourceState::Fault);
        assert_eq!(
            policy.handle(SourceEvent::Detach),
            SourceAction::DisableVbus
        );
        assert_eq!(policy.state(), SourceState::Detached);
    }

    #[test]
    fn resets_return_to_source_capability_advertisement() {
        let mut policy = SourcePolicy::new();
        policy.handle(SourceEvent::Attach);
        policy.handle(SourceEvent::VbusValid);
        assert_eq!(
            policy.handle(SourceEvent::SoftReset),
            SourceAction::SendSourceCaps
        );
        assert_eq!(policy.state(), SourceState::SourceCaps);
        assert_eq!(
            policy.handle(SourceEvent::HardReset),
            SourceAction::SendHardReset
        );
        assert_eq!(policy.state(), SourceState::Prepare5V);
    }
}
