use embedded_hal_async::i2c::I2c;

use super::{PowerRequest, SW2303_ADDR_7BIT};
use crate::power_config::{
    PowerConfig, Sw2303CapabilityReadback, Sw2303LineCompensation, Sw2303PathControl,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EnableProfileStatus {
    pub power_config_register_mode: bool,
    pub power_watts: u8,
    pub protocols: sw2303::ProtocolConfiguration,
    pub pd_capabilities: Option<sw2303::PdCapabilityStatus>,
    pub fast_charge: sw2303::FastChargeConfiguration,
    pub type_c: sw2303::TypeCConfiguration,
    pub vin_mv: Option<u32>,
    pub vbus_mv: Option<u32>,
    pub system_status0: Option<sw2303::registers::SystemStatus0Flags>,
    pub system_status1: Option<sw2303::registers::SystemStatus1Flags>,
    pub system_status2: Option<sw2303::registers::SystemStatus2Flags>,
    pub readback: Sw2303CapabilityReadback,
}

impl EnableProfileStatus {
    pub fn matches_config(&self, config: &PowerConfig) -> bool {
        self.readback.matches_config(config)
    }
}

/// Apply SW2303 "Enable Profile" (full) configuration:
/// - enable all protocols/tiers
/// - cap power at 100W
///
/// This function uses only structured `sw2303-rs` APIs (no raw register access).
pub async fn apply_enable_profile_full<I2C>(
    i2c: &mut I2C,
) -> Result<EnableProfileStatus, sw2303::error::Error<I2C::Error>>
where
    I2C: I2c,
    I2C::Error: core::fmt::Debug,
{
    apply_enable_profile(i2c, &PowerConfig::defaults()).await
}

pub async fn apply_enable_profile<I2C>(
    i2c: &mut I2C,
    config: &PowerConfig,
) -> Result<EnableProfileStatus, sw2303::error::Error<I2C::Error>>
where
    I2C: I2c,
    I2C::Error: core::fmt::Debug,
{
    let mut dev = sw2303::SW2303::new(i2c, SW2303_ADDR_7BIT);

    dev.init().await?;
    dev.unlock_write_enable_0().await?;

    dev.set_power_config(config.capability.power_watts).await?;

    dev.configure_protocols(sw2303::ProtocolConfiguration {
        pd_enabled: config.capability.pd_enabled,
        qc20_enabled: config.capability.qc20_enabled,
        qc30_enabled: config.capability.qc30_enabled,
        fcp_enabled: config.capability.fcp_enabled,
        afc_enabled: config.capability.afc_enabled,
        scp_enabled: config.capability.scp_enabled,
        pe20_enabled: config.capability.pe20_enabled,
        bc12_enabled: config.capability.bc12_enabled,
        sfcp_enabled: config.capability.sfcp_enabled,
    })
    .await?;

    dev.configure_pd(sw2303::PdConfiguration {
        enabled: config.capability.pd_enabled,
        vconn_swap: true,
        dr_swap: false,
        emarker_enabled: true,
        pps_enabled: config.capability.pps_enabled,
        pps_config_mode: if config.capability.pps_enabled {
            sw2303::PpsConfigMode::Auto
        } else {
            sw2303::PpsConfigMode::Register
        },
        fixed_voltages: [
            config.capability.fixed_9v,
            config.capability.fixed_12v,
            config.capability.fixed_15v,
            config.capability.fixed_20v,
        ],
        emark_5a_bypass: false,
        emarker_60_70w: true,
    })
    .await?;

    dev.configure_fast_charge(sw2303::FastChargeConfiguration {
        qc_enabled: config.capability.qc20_enabled || config.capability.qc30_enabled,
        fcp_enabled: config.capability.fcp_enabled,
        afc_enabled: config.capability.afc_enabled,
        scp_enabled: config.capability.scp_enabled,
        pe20_enabled: config.capability.pe20_enabled,
        sfcp_enabled: config.capability.sfcp_enabled,
        bc12_enabled: config.capability.bc12_enabled,
        scp_current_limit: match config.capability.current.scp_limit_ma {
            5_000 => 0,
            4_000 => 1,
            2_000 => 2,
            _ => 0,
        },
        fcp_afc_sfcp_2_25a: config.capability.current.fcp_afc_sfcp_limit_ma == 2_250,
        qc20_20v_enabled: config.capability.fast_charge.qc20_20v_enabled,
        qc30_20v_enabled: config.capability.fast_charge.qc30_20v_enabled,
        pe20_20v_enabled: config.capability.fast_charge.pe20_20v_enabled,
        pd_12v_enabled: config.capability.fast_charge.non_pd_12v_enabled,
    })
    .await?;

    if config.capability.pd_enabled {
        let mut flags = dev.get_fast_charge_config_2_raw().await?;
        flags.remove(sw2303::registers::FastChargeConfig2Flags::FAST_CHARGE_DISABLE);
        dev.set_fast_charge_config_2_raw(flags).await?;
    }

    dev.configure_type_c(sw2303::TypeCConfiguration {
        current_1_5a: config.capability.current.type_c_broadcast_ma == 1_500,
        pd_pps_5a: config.capability.current.pd_pps_5a,
        cc_un_driving: false,
    })
    .await?;

    let (power_config_register_mode, power_watts) = dev.get_power_config().await?;
    let protocols = dev.get_protocol_status().await?;
    let fast_charge = dev.get_fast_charge_status().await?;
    let type_c = dev.get_type_c_status().await?;
    let pd_capabilities = dev.get_pd_capability_status().await.ok();
    let readback = capability_readback(
        power_watts,
        &protocols,
        pd_capabilities,
        &fast_charge,
        &type_c,
    );
    let vin_mv = dev.read_vin_mv_12bit().await.ok();
    let vbus_mv = dev.read_vbus_mv_12bit().await.ok();
    let system_status0 = dev.get_system_status0().await.ok();
    let system_status1 = dev.get_system_status_1().await.ok();
    let system_status2 = dev.get_system_status_2().await.ok();

    Ok(EnableProfileStatus {
        power_config_register_mode,
        power_watts,
        protocols,
        pd_capabilities,
        fast_charge,
        type_c,
        vin_mv,
        vbus_mv,
        system_status0,
        system_status1,
        system_status2,
        readback,
    })
}

fn capability_readback(
    power_watts: u8,
    protocols: &sw2303::ProtocolConfiguration,
    pd_capabilities: Option<sw2303::PdCapabilityStatus>,
    fast_charge: &sw2303::FastChargeConfiguration,
    type_c: &sw2303::TypeCConfiguration,
) -> Sw2303CapabilityReadback {
    let Some(pd_capabilities) = pd_capabilities else {
        return Sw2303CapabilityReadback {
            available: false,
            power_watts: Some(power_watts),
            pd_enabled: Some(protocols.pd_enabled),
            qc20_enabled: Some(protocols.qc20_enabled),
            qc30_enabled: Some(protocols.qc30_enabled),
            fcp_enabled: Some(protocols.fcp_enabled),
            afc_enabled: Some(protocols.afc_enabled),
            scp_enabled: Some(protocols.scp_enabled),
            pe20_enabled: Some(protocols.pe20_enabled),
            bc12_enabled: Some(protocols.bc12_enabled),
            sfcp_enabled: Some(protocols.sfcp_enabled),
            pps_enabled: None,
            fixed_9v: None,
            fixed_12v: None,
            fixed_15v: None,
            fixed_20v: None,
            pps3_limit_ma: None,
            pd_pps_5a: None,
            type_c_broadcast_ma: None,
            scp_limit_ma: None,
            fcp_afc_sfcp_limit_ma: None,
            qc20_20v_enabled: None,
            qc30_20v_enabled: None,
            pe20_20v_enabled: None,
            non_pd_12v_enabled: None,
        };
    };

    Sw2303CapabilityReadback {
        available: true,
        power_watts: Some(power_watts),
        pd_enabled: Some(protocols.pd_enabled),
        qc20_enabled: Some(protocols.qc20_enabled),
        qc30_enabled: Some(protocols.qc30_enabled),
        fcp_enabled: Some(protocols.fcp_enabled),
        afc_enabled: Some(protocols.afc_enabled),
        scp_enabled: Some(protocols.scp_enabled),
        pe20_enabled: Some(protocols.pe20_enabled),
        bc12_enabled: Some(protocols.bc12_enabled),
        sfcp_enabled: Some(protocols.sfcp_enabled),
        pps_enabled: Some(pd_capabilities.pps_enabled),
        fixed_9v: Some(pd_capabilities.fixed_voltages[0]),
        fixed_12v: Some(pd_capabilities.fixed_voltages[1]),
        fixed_15v: Some(pd_capabilities.fixed_voltages[2]),
        fixed_20v: Some(pd_capabilities.fixed_voltages[3]),
        pps3_limit_ma: Some(pd_capabilities.pps3_current_limit_ma),
        pd_pps_5a: Some(type_c.pd_pps_5a),
        type_c_broadcast_ma: Some(if type_c.current_1_5a { 1_500 } else { 500 }),
        scp_limit_ma: Some(match fast_charge.scp_current_limit {
            0 => 5_000,
            1 => 4_000,
            2 => 2_000,
            _ => 5_000,
        }),
        fcp_afc_sfcp_limit_ma: Some(if fast_charge.fcp_afc_sfcp_2_25a {
            2_250
        } else {
            3_250
        }),
        qc20_20v_enabled: Some(fast_charge.qc20_20v_enabled),
        qc30_20v_enabled: Some(fast_charge.qc30_20v_enabled),
        pe20_20v_enabled: Some(fast_charge.pe20_20v_enabled),
        non_pd_12v_enabled: Some(fast_charge.pd_12v_enabled),
    }
}

pub async fn set_path_control<I2C>(
    i2c: &mut I2C,
    control: Sw2303PathControl,
) -> Result<(), sw2303::error::Error<I2C::Error>>
where
    I2C: I2c,
    I2C::Error: core::fmt::Debug,
{
    let mut dev = sw2303::SW2303::new(i2c, SW2303_ADDR_7BIT);
    dev.unlock_write_enable_1().await?;

    match control {
        Sw2303PathControl::Auto => {
            let mut flags = dev.get_force_control_raw().await?;
            flags.remove(
                sw2303::registers::ForceControlFlags::FORCE_OPEN_PATH
                    | sw2303::registers::ForceControlFlags::FORCE_CLOSE_PATH,
            );
            dev.set_force_control_raw(flags).await
        }
        Sw2303PathControl::ForceClose => dev.force_path(false).await,
        Sw2303PathControl::ForceOpen => dev.force_path(true).await,
    }
}

pub async fn apply_line_compensation<I2C>(
    i2c: &mut I2C,
    line_compensation: Sw2303LineCompensation,
) -> Result<(), sw2303::error::Error<I2C::Error>>
where
    I2C: I2c,
    I2C::Error: core::fmt::Debug,
{
    use sw2303::registers::{ConnectionControlFlags, FastChargeConfig0Flags, Register};

    let mut dev = sw2303::SW2303::new(i2c, SW2303_ADDR_7BIT);
    dev.unlock_write_enable_0().await?;

    let enabled = !matches!(line_compensation, Sw2303LineCompensation::Off);
    dev.set_line_compensation(enabled).await?;

    let mut ad = dev.get_fast_charge_config_0_raw().await?;
    if enabled {
        ad.remove(FastChargeConfig0Flags::QC_PD_FIX_LINECOMP_DISABLE);
    } else {
        ad.insert(FastChargeConfig0Flags::QC_PD_FIX_LINECOMP_DISABLE);
    }
    dev.set_fast_charge_config_0_raw(ad).await?;

    if enabled {
        let impedance_code = match line_compensation {
            Sw2303LineCompensation::Off => 0b00,
            Sw2303LineCompensation::MilliOhm50 => 0b00,
            Sw2303LineCompensation::Ohm0 => 0b01,
            Sw2303LineCompensation::MilliOhm100 => 0b10,
            Sw2303LineCompensation::MilliOhm150 => 0b11,
        };
        let mut a4 = dev.read_register(Register::LineCompensationConfig).await?;
        a4 = (a4 & 0x3f) | (impedance_code << 6);
        dev.write_register(Register::LineCompensationConfig, a4)
            .await?;
    }

    let mut cc = dev.get_connection_control_raw().await?;
    if enabled {
        cc.remove(ConnectionControlFlags::LINE_COMPENSATION_CLOSE);
    } else {
        cc.insert(ConnectionControlFlags::LINE_COMPENSATION_CLOSE);
    }
    dev.set_connection_control_raw(cc).await
}

pub async fn trigger_cc_un_driving<I2C>(
    i2c: &mut I2C,
) -> Result<(), sw2303::error::Error<I2C::Error>>
where
    I2C: I2c,
    I2C::Error: core::fmt::Debug,
{
    let mut dev = sw2303::SW2303::new(i2c, SW2303_ADDR_7BIT);
    dev.unlock_write_enable_0().await?;
    dev.trigger_cc_un_driving().await
}

/// Poll SW2303 status via structured driver APIs and decode them into a `PowerRequest`.
pub async fn read_power_request<I2C>(
    i2c: &mut I2C,
) -> Result<PowerRequest, sw2303::error::Error<I2C::Error>>
where
    I2C: I2c,
    I2C::Error: core::fmt::Debug,
{
    let mut dev = sw2303::SW2303::new(i2c, SW2303_ADDR_7BIT);

    let req = dev.get_power_request().await?;
    let status = dev.get_fast_charging_status().await;
    let fast_protocol = match &status {
        Ok(status) => status.contains(sw2303::registers::FastChargingFlags::IN_FAST_PROTOCOL),
        Err(_) => false,
    };
    let fast_voltage = match &status {
        Ok(status) => status.contains(sw2303::registers::FastChargingFlags::IN_FAST_VOLTAGE),
        Err(_) => false,
    };
    let negotiated_protocol = dev.get_negotiated_protocol().await;
    let cc_attached = dev.is_sink_device_connected().await;
    let vbus_mv = dev.read_vbus_mv_12bit().await.ok();
    let status_valid = status.is_ok() && negotiated_protocol.is_ok() && cc_attached.is_ok();

    Ok(PowerRequest {
        fast_protocol,
        fast_voltage,
        negotiated_protocol: negotiated_protocol.ok().flatten(),
        cc_attached: cc_attached.ok().unwrap_or(false),
        status_valid,
        v_req_mv: req.voltage_mv,
        i_req_ma: req.current_limit_ma,
        vbus_mv,
    })
}

/// Read only the SW2303 target voltage/current registers used to drive TPS55288.
pub async fn read_power_target<I2C>(
    i2c: &mut I2C,
) -> Result<PowerRequest, sw2303::error::Error<I2C::Error>>
where
    I2C: I2c,
    I2C::Error: core::fmt::Debug,
{
    let mut dev = sw2303::SW2303::new(i2c, SW2303_ADDR_7BIT);
    let req = dev.get_power_request().await?;

    Ok(PowerRequest {
        fast_protocol: false,
        fast_voltage: false,
        negotiated_protocol: None,
        cc_attached: false,
        status_valid: false,
        v_req_mv: req.voltage_mv,
        i_req_ma: req.current_limit_ma,
        vbus_mv: None,
    })
}
