#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PowerRequest {
    pub online: bool,
    pub protocol_raw: u8,
    pub v_req_mv: u16,
    pub i_req_ma: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PowerSetpoint {
    pub output_enabled: bool,
    pub v_out_mv: u16,
    pub i_lim_ma: u16,
}
