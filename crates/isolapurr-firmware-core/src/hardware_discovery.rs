use core::fmt;

/// Version of the physical-topology discovery contract.
pub const HARDWARE_DISCOVERY_SCHEMA_V1: u8 = 1;

/// The only two board profiles understood by this firmware family.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HardwareProfile {
    TpsSw,
    TpsFusb,
}

impl HardwareProfile {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TpsSw => "tps-sw",
            Self::TpsFusb => "tps-fusb",
        }
    }
}

/// Result of comparing the complete positive vectors for both board variants.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiscoveryState {
    Verified(HardwareProfile),
    Unknown,
    Conflicting,
}

impl DiscoveryState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Verified(_) => "verified",
            Self::Unknown => "unknown",
            Self::Conflicting => "conflicting",
        }
    }

    pub const fn detected_profile(self) -> Option<HardwareProfile> {
        match self {
            Self::Verified(profile) => Some(profile),
            Self::Unknown | Self::Conflicting => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProfileCompatibility {
    Match,
    Mismatch,
    NotVerified,
}

impl ProfileCompatibility {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Match => "match",
            Self::Mismatch => "mismatch",
            Self::NotVerified => "not_verified",
        }
    }
}

/// One read vector for a FUSB302B. A positive result requires an ACK, a family
/// ID in the documented 0x9x range, and repeated stable reads.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Fusb302Evidence {
    pub acknowledged: bool,
    pub family_id: Option<u8>,
    pub stable_reads: u8,
}

impl Fusb302Evidence {
    pub const fn positive(self) -> bool {
        self.acknowledged
            && self.stable_reads >= 2
            && matches!(self.family_id, Some(value) if value & 0xf0 == 0x90)
    }
}

/// One read vector for the INA226 used only by the TPS-SW topology.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Ina226Evidence {
    pub acknowledged: bool,
    pub manufacturer_id: Option<u16>,
    pub die_id: Option<u16>,
    pub stable_reads: u8,
}

impl Ina226Evidence {
    pub const fn positive(self) -> bool {
        if !self.acknowledged || self.stable_reads < 2 {
            return false;
        }
        match (self.manufacturer_id, self.die_id) {
            (Some(manufacturer), Some(die)) => manufacturer == 0x5449 && die == 0x2260,
            _ => false,
        }
    }
}

/// Read-only observations made on the fixed, populated component locations.
/// The detector never scans the bus and never consults writable storage.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct HardwareDiscoveryV1 {
    pub u10_fusb: Fusb302Evidence,
    pub u11_fusb: Fusb302Evidence,
    pub u17_ina226: Ina226Evidence,
}

impl HardwareDiscoveryV1 {
    pub const fn classify(self) -> DiscoveryState {
        let fusb = self.u10_fusb.positive() && self.u11_fusb.positive();
        let tps_sw = self.u17_ina226.positive();
        match (fusb, tps_sw) {
            (true, false) => DiscoveryState::Verified(HardwareProfile::TpsFusb),
            (false, true) => DiscoveryState::Verified(HardwareProfile::TpsSw),
            (true, true) => DiscoveryState::Conflicting,
            (false, false) => DiscoveryState::Unknown,
        }
    }

    pub const fn compatibility(self, compiled: HardwareProfile) -> ProfileCompatibility {
        match self.classify() {
            DiscoveryState::Verified(detected) if detected as u8 == compiled as u8 => {
                ProfileCompatibility::Match
            }
            DiscoveryState::Verified(_) => ProfileCompatibility::Mismatch,
            DiscoveryState::Unknown | DiscoveryState::Conflicting => {
                ProfileCompatibility::NotVerified
            }
        }
    }
}

/// Hardware capabilities are derived from the physical profile. They are not
/// user configuration and are intentionally not persisted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HardwareCapabilities {
    pub dual_fusb302: bool,
    pub ina226_input_meter: bool,
    pub fixed_9v_sink: bool,
    pub pd2_5v_source: bool,
    pub source_rp_default: bool,
}

impl HardwareCapabilities {
    pub const fn for_profile(profile: HardwareProfile) -> Self {
        match profile {
            HardwareProfile::TpsSw => Self {
                dual_fusb302: false,
                ina226_input_meter: true,
                fixed_9v_sink: false,
                pd2_5v_source: false,
                source_rp_default: false,
            },
            HardwareProfile::TpsFusb => Self {
                dual_fusb302: true,
                ina226_input_meter: false,
                fixed_9v_sink: true,
                pd2_5v_source: true,
                source_rp_default: true,
            },
        }
    }

    pub const fn unknown() -> Self {
        Self {
            dual_fusb302: false,
            ina226_input_meter: false,
            fixed_9v_sink: false,
            pd2_5v_source: false,
            source_rp_default: false,
        }
    }
}

/// Write the common hardware descriptor used by both HTTP and USB JSONL info.
/// `state` is deliberately explicit so an unknown/conflicting detector result
/// cannot be mistaken for a board profile.
pub fn write_hardware_descriptor_json<W: fmt::Write>(
    out: &mut W,
    compiled: HardwareProfile,
    discovery: DiscoveryState,
    compatibility: ProfileCompatibility,
) -> fmt::Result {
    write_hardware_descriptor_json_with_runtime(out, compiled, discovery, compatibility, None)
}

/// Variant of [`write_hardware_descriptor_json`] that includes runtime memory
/// sizing without creating a second `hardware` object in the response.
pub fn write_hardware_descriptor_json_with_runtime<W: fmt::Write>(
    out: &mut W,
    compiled: HardwareProfile,
    discovery: DiscoveryState,
    compatibility: ProfileCompatibility,
    psram_bytes: Option<usize>,
) -> fmt::Result {
    out.write_str("{\"schema\":1,\"compiledProfile\":\"")?;
    out.write_str(compiled.as_str())?;
    out.write_str("\",\"discovery\":{\"state\":\"")?;
    out.write_str(discovery.as_str())?;
    out.write_str("\",\"detectedProfile\":")?;
    match discovery.detected_profile() {
        Some(profile) => {
            out.write_str("\"")?;
            out.write_str(profile.as_str())?;
            out.write_str("\"")?;
        }
        None => out.write_str("null")?,
    }
    out.write_str(
        ",\"evidence\":[\"u10.fusb302b@i2c0:0x22\",\"u11.fusb302b@i2c1:0x22\",\"u17.ina226@i2c1:0x41\"]},\"compatibility\":\"",
    )?;
    out.write_str(compatibility.as_str())?;
    out.write_str("\",\"hardwareCapabilities\":{")?;
    let capabilities = match discovery.detected_profile() {
        Some(profile) => HardwareCapabilities::for_profile(profile),
        None => HardwareCapabilities::unknown(),
    };
    write_bool_field(out, "dualFusb302", capabilities.dual_fusb302, true)?;
    write_bool_field(
        out,
        "ina226InputMeter",
        capabilities.ina226_input_meter,
        true,
    )?;
    write_bool_field(out, "fixed9vSink", capabilities.fixed_9v_sink, true)?;
    write_bool_field(out, "pd2_5vSource", capabilities.pd2_5v_source, true)?;
    write_bool_field(
        out,
        "sourceRpDefault",
        capabilities.source_rp_default,
        false,
    )?;
    out.write_str(
        "},\"firmwareCapabilities\":{\"safeDiagnostics\":true},\"mcu\":\"ESP32-S3\",\"flash_bytes\":4194304,\"ram_bytes\":524288,\"psram_bytes\":",
    )?;
    match psram_bytes {
        Some(bytes) => write!(out, "{}", bytes)?,
        None => out.write_str("null")?,
    }
    out.write_str("}")
}

fn write_bool_field<W: fmt::Write>(
    out: &mut W,
    name: &str,
    value: bool,
    comma: bool,
) -> fmt::Result {
    out.write_str("\"")?;
    out.write_str(name)?;
    out.write_str("\":")?;
    out.write_str(if value { "true" } else { "false" })?;
    if comma {
        out.write_str(",")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::String;

    extern crate alloc;

    const FUSB: Fusb302Evidence = Fusb302Evidence {
        acknowledged: true,
        family_id: Some(0x91),
        stable_reads: 2,
    };
    const INA: Ina226Evidence = Ina226Evidence {
        acknowledged: true,
        manufacturer_id: Some(0x5449),
        die_id: Some(0x2260),
        stable_reads: 2,
    };

    #[test]
    fn complete_positive_vectors_verify_exactly_one_profile() {
        assert_eq!(
            HardwareDiscoveryV1 {
                u10_fusb: FUSB,
                u11_fusb: FUSB,
                u17_ina226: Ina226Evidence::default(),
            }
            .classify(),
            DiscoveryState::Verified(HardwareProfile::TpsFusb)
        );
        assert_eq!(
            HardwareDiscoveryV1 {
                u10_fusb: Fusb302Evidence::default(),
                u11_fusb: Fusb302Evidence::default(),
                u17_ina226: INA,
            }
            .classify(),
            DiscoveryState::Verified(HardwareProfile::TpsSw)
        );
    }

    #[test]
    fn partial_or_faulty_vectors_are_unknown() {
        let mut partial = HardwareDiscoveryV1 {
            u10_fusb: FUSB,
            ..HardwareDiscoveryV1::default()
        };
        assert_eq!(partial.classify(), DiscoveryState::Unknown);
        partial.u10_fusb.stable_reads = 1;
        partial.u11_fusb = FUSB;
        assert_eq!(partial.classify(), DiscoveryState::Unknown);
    }

    #[test]
    fn simultaneous_positive_vectors_are_conflicting() {
        assert_eq!(
            HardwareDiscoveryV1 {
                u10_fusb: FUSB,
                u11_fusb: FUSB,
                u17_ina226: INA,
            }
            .classify(),
            DiscoveryState::Conflicting
        );
    }

    #[test]
    fn compatibility_only_matches_verified_same_profile() {
        let tps_fusb = HardwareDiscoveryV1 {
            u10_fusb: FUSB,
            u11_fusb: FUSB,
            ..HardwareDiscoveryV1::default()
        };
        assert_eq!(
            tps_fusb.compatibility(HardwareProfile::TpsFusb),
            ProfileCompatibility::Match
        );
        assert_eq!(
            tps_fusb.compatibility(HardwareProfile::TpsSw),
            ProfileCompatibility::Mismatch
        );
        assert_eq!(
            HardwareDiscoveryV1::default().compatibility(HardwareProfile::TpsSw),
            ProfileCompatibility::NotVerified
        );
    }

    #[test]
    fn descriptor_keeps_unknown_profile_explicit() {
        let mut body = String::new();
        write_hardware_descriptor_json(
            &mut body,
            HardwareProfile::TpsFusb,
            DiscoveryState::Unknown,
            ProfileCompatibility::NotVerified,
        )
        .unwrap();
        assert!(body.contains("\"state\":\"unknown\""));
        assert!(body.contains("\"detectedProfile\":null"));
        assert!(body.contains("\"dualFusb302\":false"));
        assert!(body.contains("\"pd2_5vSource\":false"));
        assert!(body.contains("\"safeDiagnostics\":true"));
    }
}
