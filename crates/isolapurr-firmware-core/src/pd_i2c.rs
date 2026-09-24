#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Sw2303ActiveProtocol {
    PdFixed,
    Pps,
    Qc20,
    Qc30,
    Fcp,
    Afc,
    Scp,
    Pe20,
    Bc12,
    Sfcp,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolStatus {
    Unknown,
    Inactive,
    Active(Sw2303ActiveProtocol),
}

impl ProtocolStatus {
    pub const fn from_sw2303_status_byte(status: u8) -> Self {
        match status & 0x0F {
            0 if status & 0xC0 == 0 => Self::Inactive,
            1 => Self::Active(Sw2303ActiveProtocol::Qc20),
            2 => Self::Active(Sw2303ActiveProtocol::Qc30),
            3 => Self::Active(Sw2303ActiveProtocol::Fcp),
            5 => Self::Active(Sw2303ActiveProtocol::Scp),
            6 => Self::Active(Sw2303ActiveProtocol::PdFixed),
            7 => Self::Active(Sw2303ActiveProtocol::Pps),
            9 => Self::Active(Sw2303ActiveProtocol::Pe20),
            0x0C => Self::Active(Sw2303ActiveProtocol::Sfcp),
            0x0D => Self::Active(Sw2303ActiveProtocol::Afc),
            _ => Self::Unknown,
        }
    }

    pub const fn active_protocol(self) -> Option<Sw2303ActiveProtocol> {
        match self {
            Self::Active(protocol) => Some(protocol),
            Self::Unknown | Self::Inactive => None,
        }
    }

    pub const fn is_active(self) -> bool {
        matches!(self, Self::Active(_))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PowerRequest {
    /// Fast protocol indication from SW2303 status register 0x06.
    pub fast_protocol: bool,
    /// Fast voltage indication from SW2303 status register 0x06.
    pub fast_voltage: bool,
    /// Freshness-aware protocol evidence decoded from SW2303 status register 0x06.
    pub protocol_status: ProtocolStatus,
    /// SW2303 sink/CC connection status when available.
    pub cc_attached: bool,
    pub v_req_mv: u16,
    pub i_req_ma: u16,
    pub vbus_mv: Option<u32>,
}

impl PowerRequest {
    pub const fn without_protocol_evidence(self) -> Self {
        Self {
            fast_protocol: false,
            fast_voltage: false,
            protocol_status: ProtocolStatus::Unknown,
            cc_attached: false,
            v_req_mv: self.v_req_mv,
            i_req_ma: self.i_req_ma,
            vbus_mv: self.vbus_mv,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PowerSetpoint {
    pub output_enabled: bool,
    pub discharge_enabled: bool,
    pub v_out_mv: u16,
    pub i_lim_ma: u16,
}

#[cfg(test)]
mod tests {
    use super::{ProtocolStatus, Sw2303ActiveProtocol};

    #[test]
    fn sw2303_status_distinguishes_pd_fixed_and_pps() {
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x06),
            ProtocolStatus::Active(Sw2303ActiveProtocol::PdFixed)
        );
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x07),
            ProtocolStatus::Active(Sw2303ActiveProtocol::Pps)
        );
    }

    #[test]
    fn unrelated_status_bits_do_not_change_protocol_id() {
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0xF6),
            ProtocolStatus::Active(Sw2303ActiveProtocol::PdFixed)
        );
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0xB7),
            ProtocolStatus::Active(Sw2303ActiveProtocol::Pps)
        );
    }

    #[test]
    fn inactive_reserved_and_unavailable_protocol_states_are_distinct() {
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x00),
            ProtocolStatus::Inactive
        );
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x04),
            ProtocolStatus::Unknown
        );
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x40),
            ProtocolStatus::Unknown
        );
    }

    #[test]
    fn non_pd_status_ids_keep_their_existing_protocol_mapping() {
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x01),
            ProtocolStatus::Active(Sw2303ActiveProtocol::Qc20)
        );
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x02),
            ProtocolStatus::Active(Sw2303ActiveProtocol::Qc30)
        );
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x03),
            ProtocolStatus::Active(Sw2303ActiveProtocol::Fcp)
        );
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x05),
            ProtocolStatus::Active(Sw2303ActiveProtocol::Scp)
        );
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x09),
            ProtocolStatus::Active(Sw2303ActiveProtocol::Pe20)
        );
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x0C),
            ProtocolStatus::Active(Sw2303ActiveProtocol::Sfcp)
        );
        assert_eq!(
            ProtocolStatus::from_sw2303_status_byte(0x0D),
            ProtocolStatus::Active(Sw2303ActiveProtocol::Afc)
        );
    }

    #[test]
    fn stale_request_clears_protocol_evidence_but_keeps_power_target() {
        let stale = super::PowerRequest {
            fast_protocol: true,
            fast_voltage: true,
            protocol_status: ProtocolStatus::Active(Sw2303ActiveProtocol::Pps),
            cc_attached: true,
            v_req_mv: 7_550,
            i_req_ma: 3_250,
            vbus_mv: Some(7_554),
        }
        .without_protocol_evidence();

        assert_eq!(stale.protocol_status, ProtocolStatus::Unknown);
        assert!(!stale.fast_protocol);
        assert!(!stale.fast_voltage);
        assert!(!stale.cc_attached);
        assert_eq!(stale.v_req_mv, 7_550);
        assert_eq!(stale.i_req_ma, 3_250);
    }
}
