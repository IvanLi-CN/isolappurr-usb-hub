use crate::hardware_discovery::HardwareProfile;

/// The only logical routes that a profile may expose after hardware admission.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DataRoute {
    Mcu,
    UsbC,
}

/// Stable GPIO values for the CH442E route. The caller owns the actual GPIOs
/// and must disable both switches before applying a new selector value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DataRoutePins {
    pub p2_ced_high: bool,
    pub p1_ced_high: bool,
    pub p1_esp_high: bool,
}

impl DataRoutePins {
    pub const DISABLED: Self = Self {
        p2_ced_high: true,
        p1_ced_high: true,
        p1_esp_high: false,
    };
}

/// Profile-specific U7/U8 route map. The `tps-fusb` board swaps which CH442E
/// input is connected to `P1_ESP`, so its selector polarity is intentionally
/// the inverse of `tps-sw`.
pub const fn pins_for(profile: HardwareProfile, route: DataRoute) -> DataRoutePins {
    let p1_esp_high = match (profile, route) {
        (HardwareProfile::TpsSw, DataRoute::Mcu) => false,
        (HardwareProfile::TpsSw, DataRoute::UsbC) => true,
        (HardwareProfile::TpsFusb, DataRoute::Mcu) => true,
        (HardwareProfile::TpsFusb, DataRoute::UsbC) => false,
    };
    DataRoutePins {
        p1_esp_high,
        ..DataRoutePins::DISABLED
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_profiles_start_with_switches_disabled() {
        for profile in [HardwareProfile::TpsSw, HardwareProfile::TpsFusb] {
            for route in [DataRoute::Mcu, DataRoute::UsbC] {
                let pins = pins_for(profile, route);
                assert!(pins.p1_ced_high);
                assert!(pins.p2_ced_high);
            }
        }
    }

    #[test]
    fn fusb_selector_polarity_is_reversed() {
        assert!(!pins_for(HardwareProfile::TpsSw, DataRoute::Mcu).p1_esp_high);
        assert!(pins_for(HardwareProfile::TpsSw, DataRoute::UsbC).p1_esp_high);
        assert!(pins_for(HardwareProfile::TpsFusb, DataRoute::Mcu).p1_esp_high);
        assert!(!pins_for(HardwareProfile::TpsFusb, DataRoute::UsbC).p1_esp_high);
    }
}
