#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PowerRequest {
    /// Fast protocol flag (decoded via driver APIs).
    pub fast_protocol: bool,
    /// Fast voltage flag (decoded via driver APIs).
    pub fast_voltage: bool,
    /// Currently negotiated charging protocol (if any).
    pub negotiated_protocol: Option<sw2303::ProtocolType>,
    /// SW2303 sink/CC connection status when available.
    pub cc_attached: bool,
    /// Whether protocol and CC status fields came from successful status reads.
    pub status_valid: bool,
    pub v_req_mv: u16,
    pub i_req_ma: u16,
    pub vbus_mv: Option<u32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PowerSetpoint {
    pub output_enabled: bool,
    pub discharge_enabled: bool,
    pub v_out_mv: u16,
    pub i_lim_ma: u16,
}
