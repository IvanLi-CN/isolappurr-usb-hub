use isolapurr_firmware_core::hardware_discovery::HardwareProfile;

pub const COMPILED_PROFILE: HardwareProfile = if cfg!(feature = "board_tps_sw") {
    HardwareProfile::TpsSw
} else {
    HardwareProfile::TpsFusb
};

pub const COMPILED_PROFILE_NAME: &str = env!("USB_HUB_COMPILED_PROFILE");

/// A small, testable description of the reset-to-application safety boundary.
/// Hardware pin writes are performed by the firmware entry point in this order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BootSafetyStep {
    TpsDisable,
    VbusGateDisable,
    VinDisable,
    VinSelectDc,
    DataSwitchesDisable,
    McuDataRoute,
    StatusInputsHiZ,
    I2cOpenDrainIdle,
}

pub const BOOT_SAFETY_ORDER: [BootSafetyStep; 8] = [
    BootSafetyStep::TpsDisable,
    BootSafetyStep::VbusGateDisable,
    BootSafetyStep::VinDisable,
    BootSafetyStep::VinSelectDc,
    BootSafetyStep::DataSwitchesDisable,
    BootSafetyStep::McuDataRoute,
    BootSafetyStep::StatusInputsHiZ,
    BootSafetyStep::I2cOpenDrainIdle,
];

pub const fn is_profile_match(discovered: HardwareProfile) -> bool {
    matches!(
        (COMPILED_PROFILE, discovered),
        (HardwareProfile::TpsSw, HardwareProfile::TpsSw)
            | (HardwareProfile::TpsFusb, HardwareProfile::TpsFusb)
    )
}

#[cfg(test)]
mod tests {
    use super::{BOOT_SAFETY_ORDER, BootSafetyStep};

    #[test]
    fn power_is_disabled_before_routes_are_touched() {
        assert_eq!(BOOT_SAFETY_ORDER[0], BootSafetyStep::TpsDisable);
        assert_eq!(BOOT_SAFETY_ORDER[1], BootSafetyStep::VbusGateDisable);
        assert_eq!(BOOT_SAFETY_ORDER[2], BootSafetyStep::VinDisable);
        assert_eq!(BOOT_SAFETY_ORDER[4], BootSafetyStep::DataSwitchesDisable);
    }
}
