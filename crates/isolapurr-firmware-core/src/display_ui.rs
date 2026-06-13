use crate::pd_i2c::PowerRequest;
use crate::power_config::{ManualUsbCPathMode, TpsMode};
use crate::telemetry::Field;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NormalUiField {
    Ok(u32),
    Err,
}

impl NormalUiField {
    pub const fn ok(value: u32) -> Self {
        Self::Ok(value)
    }

    pub const fn err() -> Self {
        Self::Err
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NormalUiPortMode {
    UsbA,
    Pd,
    Pps,
    Dc,
    ManualVoltageMv(u16),
    Off,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NormalUiPortBadge {
    VoltageMv(u16),
    Focus,
    On,
    Off,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NormalUiPort {
    pub present: bool,
    pub mode: NormalUiPortMode,
    pub badge: NormalUiPortBadge,
    /// Voltage in uV.
    pub voltage_uv: NormalUiField,
    /// Current in uA.
    pub current_ua: NormalUiField,
    /// Power in uW.
    pub power_uw: NormalUiField,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NormalUiSnapshot {
    /// Left column: USB-A.
    pub usb_a: NormalUiPort,
    /// Right column: USB-C/PD.
    pub usb_c: NormalUiPort,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UsbCModeKind {
    Pd,
    Pps,
    Dc,
    Off,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UsbCPolicyInput {
    pub voltage_mv: Option<u32>,
    pub current_ma: Option<u32>,
    pub cc_attached: bool,
    pub protocol_active: bool,
    pub pd_protocol: bool,
    pub request_mv: Option<u16>,
}

const USB_C_PRESENT_VOLTAGE_MV: u32 = 3_000;
const USB_C_PRESENT_CURRENT_MA: u32 = 10;

pub const fn usb_c_present(input: UsbCPolicyInput) -> bool {
    let voltage_ready = match input.voltage_mv {
        Some(v_mv) => v_mv >= USB_C_PRESENT_VOLTAGE_MV,
        None => false,
    };
    let current_ready = match input.current_ma {
        Some(i_ma) => i_ma > USB_C_PRESENT_CURRENT_MA,
        None => false,
    };

    (voltage_ready && current_ready) || input.cc_attached || input.protocol_active
}

pub const fn usb_c_mode(input: UsbCPolicyInput) -> UsbCModeKind {
    if !usb_c_present(input) {
        return UsbCModeKind::Off;
    }

    if input.pd_protocol {
        return match input.request_mv {
            Some(5_000 | 9_000 | 12_000 | 15_000 | 20_000) => UsbCModeKind::Pd,
            Some(_) => UsbCModeKind::Pps,
            None => UsbCModeKind::Pd,
        };
    }

    UsbCModeKind::Dc
}

pub fn normal_ui_usb_c_protocol_active(request: Option<PowerRequest>) -> bool {
    request
        .map(|request| {
            request.negotiated_protocol.is_some() || request.fast_protocol || request.fast_voltage
        })
        .unwrap_or(false)
}

pub fn normal_ui_usb_c_present(
    request: Option<PowerRequest>,
    voltage_mv: Field<u32>,
    current_ma: Field<u32>,
) -> bool {
    usb_c_present(usb_c_policy_input(request, voltage_mv, current_ma))
}

pub fn normal_ui_usb_c_mode(
    request: Option<PowerRequest>,
    voltage_mv: Field<u32>,
    current_ma: Field<u32>,
) -> NormalUiPortMode {
    match usb_c_mode(usb_c_policy_input(request, voltage_mv, current_ma)) {
        UsbCModeKind::Pd => NormalUiPortMode::Pd,
        UsbCModeKind::Pps => NormalUiPortMode::Pps,
        UsbCModeKind::Dc => NormalUiPortMode::Dc,
        UsbCModeKind::Off => NormalUiPortMode::Off,
    }
}

fn usb_c_policy_input(
    request: Option<PowerRequest>,
    voltage_mv: Field<u32>,
    current_ma: Field<u32>,
) -> UsbCPolicyInput {
    UsbCPolicyInput {
        voltage_mv: field_ok(voltage_mv),
        current_ma: field_ok(current_ma),
        cc_attached: request.map(|request| request.cc_attached).unwrap_or(false),
        protocol_active: normal_ui_usb_c_protocol_active(request),
        pd_protocol: request
            .map(|request| request.negotiated_protocol == Some(sw2303::ProtocolType::PD))
            .unwrap_or(false),
        request_mv: request.map(|request| request.v_req_mv),
    }
}

pub const USB_C_VBUS_ON_THRESHOLD_MV: u32 = 1_000;
pub const USB_C_DISPLAY_TEXT_CAPACITY: usize = 6;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UsbCDisplayInput {
    pub tps_mode: TpsMode,
    pub manual_path_mode: ManualUsbCPathMode,
    pub manual_setpoint_mv: u16,
    pub tps_output_enabled: bool,
    pub port_power_enabled: bool,
    pub request: Option<PowerRequest>,
    pub voltage_mv: Field<u32>,
    pub current_ma: Field<u32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UsbCDisplayState {
    pub mode: NormalUiPortMode,
    pub badge: NormalUiPortBadge,
    pub measurements_visible: bool,
}

pub fn resolve_usb_c_display(input: UsbCDisplayInput) -> UsbCDisplayState {
    if matches!(input.tps_mode, TpsMode::Manual)
        && input.tps_output_enabled
        && input.port_power_enabled
    {
        return UsbCDisplayState {
            mode: NormalUiPortMode::ManualVoltageMv(input.manual_setpoint_mv),
            badge: manual_badge(input.manual_path_mode, input.request),
            measurements_visible: true,
        };
    }

    let policy_input = UsbCPolicyInput {
        voltage_mv: field_ok(input.voltage_mv),
        current_ma: field_ok(input.current_ma),
        cc_attached: input
            .request
            .map(|request| request.cc_attached)
            .unwrap_or(false),
        protocol_active: normal_ui_usb_c_protocol_active(input.request),
        pd_protocol: input
            .request
            .map(|request| request.negotiated_protocol == Some(sw2303::ProtocolType::PD))
            .unwrap_or(false),
        request_mv: input.request.map(|request| request.v_req_mv),
    };
    let measurements_visible = usb_c_present(policy_input);
    let mode = match usb_c_mode(policy_input) {
        UsbCModeKind::Pd => NormalUiPortMode::Pd,
        UsbCModeKind::Pps => NormalUiPortMode::Pps,
        UsbCModeKind::Dc => NormalUiPortMode::Dc,
        UsbCModeKind::Off => NormalUiPortMode::Off,
    };
    let badge = if !measurements_visible {
        NormalUiPortBadge::Off
    } else {
        voltage_badge(input.request, input.voltage_mv)
    };

    UsbCDisplayState {
        mode,
        badge,
        measurements_visible,
    }
}

pub fn format_port_mode_text(
    mode: NormalUiPortMode,
    out: &mut [u8; USB_C_DISPLAY_TEXT_CAPACITY],
) -> usize {
    match mode {
        NormalUiPortMode::UsbA => copy_text(out, b"USB-A"),
        NormalUiPortMode::Pd => copy_text(out, b"PD"),
        NormalUiPortMode::Pps => copy_text(out, b"PPS"),
        NormalUiPortMode::Dc => copy_text(out, b"DC"),
        NormalUiPortMode::ManualVoltageMv(mv) => format_mode_voltage_mv(mv, out),
        NormalUiPortMode::Off => copy_text(out, b"OFF"),
    }
}

pub fn format_port_badge_text(
    badge: NormalUiPortBadge,
    out: &mut [u8; USB_C_DISPLAY_TEXT_CAPACITY],
) -> usize {
    match badge {
        NormalUiPortBadge::VoltageMv(mv) => format_badge_mv(mv, out),
        NormalUiPortBadge::Focus => copy_text(out, b"FOCUS"),
        NormalUiPortBadge::On => copy_text(out, b"ON"),
        NormalUiPortBadge::Off => copy_text(out, b"OFF"),
        NormalUiPortBadge::Unknown => copy_text(out, b"---"),
    }
}

fn manual_badge(
    manual_path_mode: ManualUsbCPathMode,
    request: Option<PowerRequest>,
) -> NormalUiPortBadge {
    if matches!(manual_path_mode, ManualUsbCPathMode::Force) {
        return NormalUiPortBadge::Focus;
    }

    if usb_c_path_on(request.and_then(|sample| sample.vbus_mv)) {
        NormalUiPortBadge::On
    } else {
        NormalUiPortBadge::Off
    }
}

fn voltage_badge(
    request: Option<PowerRequest>,
    fallback_voltage_mv: Field<u32>,
) -> NormalUiPortBadge {
    if let Some(request_mv) = request
        .map(|request| request.v_req_mv)
        .filter(|request_mv| *request_mv >= USB_C_VBUS_ON_THRESHOLD_MV as u16)
    {
        return NormalUiPortBadge::VoltageMv(request_mv);
    }

    match fallback_voltage_mv {
        Field::Ok(voltage_mv) if voltage_mv >= USB_C_VBUS_ON_THRESHOLD_MV => {
            NormalUiPortBadge::VoltageMv(voltage_mv.min(u16::MAX as u32) as u16)
        }
        _ => NormalUiPortBadge::Unknown,
    }
}

fn copy_text(out: &mut [u8; USB_C_DISPLAY_TEXT_CAPACITY], text: &[u8]) -> usize {
    out[..text.len()].copy_from_slice(text);
    text.len()
}

fn format_mode_voltage_mv(mv: u16, out: &mut [u8; USB_C_DISPLAY_TEXT_CAPACITY]) -> usize {
    let centivolts = (u32::from(mv) + 5) / 10;
    let int = centivolts / 100;
    let frac = centivolts % 100;

    if int >= 10 {
        out[0] = b'0' + (int / 10) as u8;
        out[1] = b'0' + (int % 10) as u8;
        out[2] = b'.';
        out[3] = b'0' + (frac / 10) as u8;
        out[4] = b'0' + (frac % 10) as u8;
        out[5] = b'V';
        return 6;
    }

    out[0] = b'0' + int as u8;
    out[1] = b'.';
    out[2] = b'0' + (frac / 10) as u8;
    out[3] = b'0' + (frac % 10) as u8;
    out[4] = b'V';
    5
}

fn format_badge_mv(mv: u16, out: &mut [u8; USB_C_DISPLAY_TEXT_CAPACITY]) -> usize {
    let rounded = ((mv as u32) + 500) / 1_000;
    if rounded >= 100 {
        return copy_text(out, b"99V+");
    }
    if rounded >= 10 {
        out[0] = b'0' + (rounded / 10) as u8;
        out[1] = b'0' + (rounded % 10) as u8;
        out[2] = b'V';
        return 3;
    }
    out[0] = b'0' + rounded as u8;
    out[1] = b'V';
    2
}

const fn usb_c_path_on(vbus_mv: Option<u32>) -> bool {
    match vbus_mv {
        Some(vbus_mv) => vbus_mv >= USB_C_VBUS_ON_THRESHOLD_MV,
        None => false,
    }
}

const fn field_ok(field: Field<u32>) -> Option<u32> {
    match field {
        Field::Ok(value) => Some(value),
        Field::Err => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn input(
        voltage_mv: Option<u32>,
        current_ma: Option<u32>,
        cc_attached: bool,
        protocol_active: bool,
        pd_protocol: bool,
        request_mv: Option<u16>,
    ) -> UsbCPolicyInput {
        UsbCPolicyInput {
            voltage_mv,
            current_ma,
            cc_attached,
            protocol_active,
            pd_protocol,
            request_mv,
        }
    }

    const fn request(v_req_mv: u16, vbus_mv: Option<u32>) -> PowerRequest {
        PowerRequest {
            fast_protocol: false,
            fast_voltage: false,
            negotiated_protocol: Some(sw2303::ProtocolType::PD),
            cc_attached: true,
            status_valid: true,
            v_req_mv,
            i_req_ma: 3_000,
            vbus_mv,
        }
    }

    #[test]
    fn usb_c_present_requires_voltage_and_current_thresholds() {
        assert!(!usb_c_present(input(
            Some(5_000),
            Some(0),
            false,
            false,
            false,
            None
        )));
        assert!(!usb_c_present(input(
            Some(2_999),
            Some(11),
            false,
            false,
            false,
            None
        )));
        assert!(usb_c_present(input(
            Some(3_000),
            Some(11),
            false,
            false,
            false,
            None
        )));
    }

    #[test]
    fn usb_c_present_uses_strict_current_threshold() {
        assert!(!usb_c_present(input(
            Some(3_000),
            Some(10),
            false,
            false,
            false,
            None
        )));
        assert!(usb_c_present(input(
            Some(3_000),
            Some(11),
            false,
            false,
            false,
            None
        )));
    }

    #[test]
    fn usb_c_present_uses_cc_attachment() {
        assert!(usb_c_present(input(
            Some(0),
            Some(0),
            true,
            false,
            false,
            None
        )));
    }

    #[test]
    fn usb_c_present_uses_real_protocol_activity() {
        assert!(usb_c_present(input(
            None,
            None,
            false,
            true,
            true,
            Some(5_000)
        )));
    }

    #[test]
    fn usb_c_mode_reports_pps_for_non_fixed_pd_voltage() {
        assert_eq!(
            usb_c_mode(input(
                Some(7_000),
                Some(250),
                false,
                true,
                true,
                Some(7_000)
            )),
            UsbCModeKind::Pps
        );
    }

    #[test]
    fn usb_c_mode_falls_back_to_dc_when_only_measurement_is_present() {
        assert_eq!(
            usb_c_mode(input(Some(3_000), Some(11), false, false, false, None)),
            UsbCModeKind::Dc
        );
        assert_eq!(
            usb_c_mode(input(Some(5_000), Some(0), false, false, false, None)),
            UsbCModeKind::Off
        );
    }

    #[test]
    fn manual_force_reports_dc_focus_and_keeps_measurements_visible() {
        let state = resolve_usb_c_display(UsbCDisplayInput {
            tps_mode: TpsMode::Manual,
            manual_path_mode: ManualUsbCPathMode::Force,
            manual_setpoint_mv: 3_300,
            tps_output_enabled: true,
            port_power_enabled: true,
            request: None,
            voltage_mv: Field::Ok(0),
            current_ma: Field::Ok(0),
        });

        assert_eq!(
            state,
            UsbCDisplayState {
                mode: NormalUiPortMode::ManualVoltageMv(3_300),
                badge: NormalUiPortBadge::Focus,
                measurements_visible: true,
            }
        );
    }

    #[test]
    fn manual_non_force_uses_sw2303_vbus_truth_for_on_off() {
        let off_state = resolve_usb_c_display(UsbCDisplayInput {
            tps_mode: TpsMode::Manual,
            manual_path_mode: ManualUsbCPathMode::Default,
            manual_setpoint_mv: 9_000,
            tps_output_enabled: true,
            port_power_enabled: true,
            request: Some(request(9_000, Some(999))),
            voltage_mv: Field::Ok(0),
            current_ma: Field::Ok(0),
        });
        let on_state = resolve_usb_c_display(UsbCDisplayInput {
            tps_mode: TpsMode::Manual,
            manual_path_mode: ManualUsbCPathMode::Disconnect,
            manual_setpoint_mv: 9_000,
            tps_output_enabled: true,
            port_power_enabled: true,
            request: Some(request(9_000, Some(1_000))),
            voltage_mv: Field::Ok(0),
            current_ma: Field::Ok(0),
        });

        assert_eq!(off_state.mode, NormalUiPortMode::ManualVoltageMv(9_000));
        assert_eq!(off_state.badge, NormalUiPortBadge::Off);
        assert_eq!(on_state.badge, NormalUiPortBadge::On);
    }

    #[test]
    fn auto_follow_keeps_pd_pps_and_voltage_badges() {
        let fixed = resolve_usb_c_display(UsbCDisplayInput {
            tps_mode: TpsMode::AutoFollow,
            manual_path_mode: ManualUsbCPathMode::Default,
            manual_setpoint_mv: 5_000,
            tps_output_enabled: false,
            port_power_enabled: true,
            request: Some(request(9_000, Some(9_000))),
            voltage_mv: Field::Ok(9_000),
            current_ma: Field::Ok(500),
        });
        let pps = resolve_usb_c_display(UsbCDisplayInput {
            tps_mode: TpsMode::AutoFollow,
            manual_path_mode: ManualUsbCPathMode::Default,
            manual_setpoint_mv: 5_000,
            tps_output_enabled: false,
            port_power_enabled: true,
            request: Some(request(7_000, Some(7_000))),
            voltage_mv: Field::Ok(7_000),
            current_ma: Field::Ok(500),
        });

        assert_eq!(fixed.mode, NormalUiPortMode::Pd);
        assert_eq!(fixed.badge, NormalUiPortBadge::VoltageMv(9_000));
        assert_eq!(pps.mode, NormalUiPortMode::Pps);
        assert_eq!(pps.badge, NormalUiPortBadge::VoltageMv(7_000));
    }

    #[test]
    fn auto_follow_falls_back_to_off_when_not_present() {
        let state = resolve_usb_c_display(UsbCDisplayInput {
            tps_mode: TpsMode::AutoFollow,
            manual_path_mode: ManualUsbCPathMode::Default,
            manual_setpoint_mv: 5_000,
            tps_output_enabled: false,
            port_power_enabled: false,
            request: None,
            voltage_mv: Field::Ok(0),
            current_ma: Field::Ok(0),
        });

        assert_eq!(state.mode, NormalUiPortMode::Off);
        assert_eq!(state.badge, NormalUiPortBadge::Off);
        assert!(!state.measurements_visible);
    }

    #[test]
    fn manual_mode_falls_back_to_off_when_port_power_is_disabled() {
        let state = resolve_usb_c_display(UsbCDisplayInput {
            tps_mode: TpsMode::Manual,
            manual_path_mode: ManualUsbCPathMode::Force,
            manual_setpoint_mv: 3_300,
            tps_output_enabled: true,
            port_power_enabled: false,
            request: None,
            voltage_mv: Field::Ok(0),
            current_ma: Field::Ok(0),
        });

        assert_eq!(state.mode, NormalUiPortMode::Off);
        assert_eq!(state.badge, NormalUiPortBadge::Off);
        assert!(!state.measurements_visible);
    }

    #[test]
    fn format_port_mode_text_uses_two_decimals_for_manual_voltage() {
        let mut out = [b' '; USB_C_DISPLAY_TEXT_CAPACITY];
        let len = format_port_mode_text(NormalUiPortMode::ManualVoltageMv(3_300), &mut out);
        assert_eq!(&out[..len], b"3.30V");

        let len = format_port_mode_text(NormalUiPortMode::ManualVoltageMv(21_000), &mut out);
        assert_eq!(&out[..len], b"21.00V");
    }
}
