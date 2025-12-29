#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PowerRequest {
    /// SW2303 "online" indicator bit (SystemStatus3 / REG0x0D bit7).
    ///
    /// Manual semantics: set when Type‑C is inserted or A‑port current is above threshold.
    /// This value is provided for telemetry/debug only and must not be used for functional behavior.
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
