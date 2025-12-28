#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PowerRequest {
    /// Sink device online status.
    pub online: bool,
    /// Fast protocol flag (decoded via driver APIs).
    pub fast_protocol: bool,
    /// Fast voltage flag (decoded via driver APIs).
    pub fast_voltage: bool,
    /// Currently negotiated charging protocol (if any).
    pub negotiated_protocol: Option<sw2303::ProtocolType>,
    pub v_req_mv: u16,
    pub i_req_ma: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PowerSetpoint {
    pub output_enabled: bool,
    pub v_out_mv: u16,
    pub i_lim_ma: u16,
}
