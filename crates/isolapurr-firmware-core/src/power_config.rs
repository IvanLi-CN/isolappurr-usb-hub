#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PowerHardwareKind {
    Sw2303,
}

impl PowerHardwareKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Sw2303 => "sw2303",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TpsMode {
    AutoFollow,
    Manual,
}

impl TpsMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AutoFollow => "auto_follow",
            Self::Manual => "manual",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ManualUsbCPathMode {
    Default,
    Disconnect,
    Force,
}

impl ManualUsbCPathMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Disconnect => "disconnect",
            Self::Force => "force",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Sw2303PathControl {
    Auto,
    ForceClose,
    ForceOpen,
}

impl Sw2303PathControl {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::ForceClose => "force_close",
            Self::ForceOpen => "force_open",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UsbCCapabilityConfig {
    pub power_watts: u8,
    pub pd_enabled: bool,
    pub qc20_enabled: bool,
    pub qc30_enabled: bool,
    pub fcp_enabled: bool,
    pub afc_enabled: bool,
    pub scp_enabled: bool,
    pub pe20_enabled: bool,
    pub bc12_enabled: bool,
    pub sfcp_enabled: bool,
    pub pps_enabled: bool,
    pub fixed_9v: bool,
    pub fixed_12v: bool,
    pub fixed_15v: bool,
    pub fixed_20v: bool,
}

impl UsbCCapabilityConfig {
    pub const fn full_100w() -> Self {
        Self {
            power_watts: DEFAULT_POWER_WATTS,
            pd_enabled: true,
            qc20_enabled: true,
            qc30_enabled: true,
            fcp_enabled: true,
            afc_enabled: true,
            scp_enabled: true,
            pe20_enabled: true,
            bc12_enabled: true,
            sfcp_enabled: true,
            pps_enabled: true,
            fixed_9v: true,
            fixed_12v: true,
            fixed_15v: true,
            fixed_20v: true,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ManualTpsConfig {
    pub voltage_mv: u16,
    pub current_limit_ma: u16,
    pub usb_c_path_mode: ManualUsbCPathMode,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PowerConfig {
    pub hardware: PowerHardwareKind,
    pub capability: UsbCCapabilityConfig,
    pub tps_mode: TpsMode,
    pub manual: ManualTpsConfig,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Sw2303CapabilityReadback {
    pub available: bool,
    pub power_watts: Option<u8>,
    pub pd_enabled: Option<bool>,
    pub qc20_enabled: Option<bool>,
    pub qc30_enabled: Option<bool>,
    pub fcp_enabled: Option<bool>,
    pub afc_enabled: Option<bool>,
    pub scp_enabled: Option<bool>,
    pub pe20_enabled: Option<bool>,
    pub bc12_enabled: Option<bool>,
    pub sfcp_enabled: Option<bool>,
    pub pps_enabled: Option<bool>,
    pub fixed_9v: Option<bool>,
    pub fixed_12v: Option<bool>,
    pub fixed_15v: Option<bool>,
    pub fixed_20v: Option<bool>,
}

impl Sw2303CapabilityReadback {
    pub const fn unavailable() -> Self {
        Self {
            available: false,
            power_watts: None,
            pd_enabled: None,
            qc20_enabled: None,
            qc30_enabled: None,
            fcp_enabled: None,
            afc_enabled: None,
            scp_enabled: None,
            pe20_enabled: None,
            bc12_enabled: None,
            sfcp_enabled: None,
            pps_enabled: None,
            fixed_9v: None,
            fixed_12v: None,
            fixed_15v: None,
            fixed_20v: None,
        }
    }

    pub fn matches_config(self, config: &PowerConfig) -> bool {
        let cap = config.capability;
        self.available
            && self.power_watts == Some(cap.power_watts)
            && self.pd_enabled == Some(cap.pd_enabled)
            && self.qc20_enabled == Some(cap.qc20_enabled)
            && self.qc30_enabled == Some(cap.qc30_enabled)
            && self.fcp_enabled == Some(cap.fcp_enabled)
            && self.afc_enabled == Some(cap.afc_enabled)
            && self.scp_enabled == Some(cap.scp_enabled)
            && self.pe20_enabled == Some(cap.pe20_enabled)
            && self.bc12_enabled == Some(cap.bc12_enabled)
            && self.sfcp_enabled == Some(cap.sfcp_enabled)
            && self.pps_enabled == Some(cap.pps_enabled)
            && self.fixed_9v == Some(cap.fixed_9v)
            && self.fixed_12v == Some(cap.fixed_12v)
            && self.fixed_15v == Some(cap.fixed_15v)
            && self.fixed_20v == Some(cap.fixed_20v)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PowerConfigError {
    UnsupportedHardware,
    InvalidVoltage,
    InvalidCurrent,
    InvalidPower,
    InvalidCapability,
}

pub const DEFAULT_POWER_WATTS: u8 = 100;
pub const MANUAL_MIN_VOLTAGE_MV: u16 = 3_000;
pub const MANUAL_MAX_VOLTAGE_MV: u16 = 21_000;
pub const MANUAL_DEFAULT_VOLTAGE_MV: u16 = 5_000;
pub const MANUAL_DEFAULT_CURRENT_MA: u16 = 1_000;
pub const TPS_MAX_CURRENT_MA: u16 = 6_350;
pub const POWER_CAP_MW: u32 = 100_000;

impl PowerConfig {
    pub const fn defaults() -> Self {
        Self {
            hardware: PowerHardwareKind::Sw2303,
            capability: UsbCCapabilityConfig::full_100w(),
            tps_mode: TpsMode::AutoFollow,
            manual: ManualTpsConfig {
                voltage_mv: MANUAL_DEFAULT_VOLTAGE_MV,
                current_limit_ma: MANUAL_DEFAULT_CURRENT_MA,
                usb_c_path_mode: ManualUsbCPathMode::Default,
            },
        }
    }

    pub fn validated(mut self) -> Result<Self, PowerConfigError> {
        if self.hardware != PowerHardwareKind::Sw2303 {
            return Err(PowerConfigError::UnsupportedHardware);
        }
        if self.capability.power_watts == 0 || self.capability.power_watts > DEFAULT_POWER_WATTS {
            return Err(PowerConfigError::InvalidCapability);
        }
        if self.manual.voltage_mv < MANUAL_MIN_VOLTAGE_MV
            || self.manual.voltage_mv > MANUAL_MAX_VOLTAGE_MV
        {
            return Err(PowerConfigError::InvalidVoltage);
        }
        if self.manual.current_limit_ma == 0 {
            return Err(PowerConfigError::InvalidCurrent);
        }
        self.manual.current_limit_ma =
            clamp_manual_current_ma(self.manual.voltage_mv, self.manual.current_limit_ma);
        if self.manual.current_limit_ma == 0 {
            return Err(PowerConfigError::InvalidCurrent);
        }
        Ok(self)
    }
}

pub fn clamp_manual_current_ma(voltage_mv: u16, requested_ma: u16) -> u16 {
    let power_limited_ma = (POWER_CAP_MW.saturating_mul(1_000) / voltage_mv.max(1) as u32) as u16;
    quantize_manual_current_ma(requested_ma.min(power_limited_ma).min(TPS_MAX_CURRENT_MA))
}

pub fn quantize_manual_voltage_mv(mv: u16) -> u16 {
    let mv = mv.clamp(MANUAL_MIN_VOLTAGE_MV, MANUAL_MAX_VOLTAGE_MV);
    let steps = mv.saturating_sub(800) / 20;
    800 + steps * 20
}

pub fn quantize_manual_current_ma(ma: u16) -> u16 {
    (ma / 50) * 50
}

pub fn resolve_manual_path_control(
    mode: ManualUsbCPathMode,
    manual_vout_mv: u16,
    explicit_request_mv: Option<u16>,
) -> Sw2303PathControl {
    const TYPEC_DEFAULT_VBUS_MV: u16 = 5_000;

    match mode {
        ManualUsbCPathMode::Force => Sw2303PathControl::ForceOpen,
        ManualUsbCPathMode::Disconnect => Sw2303PathControl::ForceClose,
        ManualUsbCPathMode::Default => match explicit_request_mv {
            Some(request_mv) if manual_vout_mv <= request_mv => Sw2303PathControl::Auto,
            None if manual_vout_mv <= TYPEC_DEFAULT_VBUS_MV => Sw2303PathControl::Auto,
            _ => Sw2303PathControl::ForceClose,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_manual_current_to_100w_and_tps_limit() {
        assert_eq!(clamp_manual_current_ma(5_000, 10_000), 6_350);
        assert_eq!(clamp_manual_current_ma(20_000, 6_350), 5_000);
        assert_eq!(clamp_manual_current_ma(21_000, 6_350), 4_750);
    }

    #[test]
    fn validates_and_quantizes_manual_config() {
        let cfg = PowerConfig {
            tps_mode: TpsMode::Manual,
            manual: ManualTpsConfig {
                voltage_mv: 21_000,
                current_limit_ma: 6_350,
                usb_c_path_mode: ManualUsbCPathMode::Default,
            },
            ..PowerConfig::defaults()
        }
        .validated()
        .unwrap();

        assert_eq!(cfg.manual.current_limit_ma, 4_750);
    }

    #[test]
    fn resolves_default_manual_path_policy() {
        assert_eq!(
            resolve_manual_path_control(ManualUsbCPathMode::Default, 9_000, Some(5_000)),
            Sw2303PathControl::ForceClose
        );
        assert_eq!(
            resolve_manual_path_control(ManualUsbCPathMode::Default, 5_000, Some(5_000)),
            Sw2303PathControl::Auto
        );
        assert_eq!(
            resolve_manual_path_control(ManualUsbCPathMode::Default, 5_000, None),
            Sw2303PathControl::Auto
        );
        assert_eq!(
            resolve_manual_path_control(ManualUsbCPathMode::Default, 5_200, None),
            Sw2303PathControl::ForceClose
        );
    }

    #[test]
    fn resolves_explicit_path_modes() {
        assert_eq!(
            resolve_manual_path_control(ManualUsbCPathMode::Disconnect, 5_000, Some(21_000)),
            Sw2303PathControl::ForceClose
        );
        assert_eq!(
            resolve_manual_path_control(ManualUsbCPathMode::Force, 21_000, None),
            Sw2303PathControl::ForceOpen
        );
    }
}
