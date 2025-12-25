#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PowerRequest {
    /// SystemStatus3 (REG 0x0D) bit7.
    pub online: bool,
    /// FastChargingStatus (REG 0x06) bit6.
    pub type_c_connected: bool,
    /// FastChargingStatus (REG 0x06) bit7.
    pub fast_charging: bool,
    /// FastChargingStatus (REG 0x06) bits5-4.
    pub pd_version_raw: u8,
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
