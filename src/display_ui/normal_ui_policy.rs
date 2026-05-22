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
}
