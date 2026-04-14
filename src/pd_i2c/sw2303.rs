use embedded_hal_async::i2c::I2c;

use super::{PowerRequest, SW2303_ADDR_7BIT};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EnableProfileStatus {
    pub power_config_register_mode: bool,
    pub power_watts: u8,
    pub protocols: sw2303::ProtocolConfiguration,
    pub fast_charge: sw2303::FastChargeConfiguration,
    pub type_c: sw2303::TypeCConfiguration,
    pub vin_mv: Option<u32>,
    pub vbus_mv: Option<u32>,
    pub system_status0: Option<sw2303::registers::SystemStatus0Flags>,
    pub system_status1: Option<sw2303::registers::SystemStatus1Flags>,
    pub system_status2: Option<sw2303::registers::SystemStatus2Flags>,
    pub system_status3: Option<sw2303::registers::SystemStatus3Flags>,
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
    let mut dev = sw2303::SW2303::new(i2c, SW2303_ADDR_7BIT);

    dev.init().await?;
    dev.unlock_write_enable_0().await?;

    dev.set_power_config(100).await?;

    dev.configure_protocols(sw2303::ProtocolConfiguration {
        pd_enabled: true,
        qc20_enabled: true,
        qc30_enabled: true,
        fcp_enabled: true,
        afc_enabled: true,
        scp_enabled: true,
        pe20_enabled: true,
        bc12_enabled: true,
        sfcp_enabled: true,
    })
    .await?;

    dev.configure_pd(sw2303::PdConfiguration {
        enabled: true,
        vconn_swap: true,
        dr_swap: false,
        emarker_enabled: true,
        pps_enabled: true,
        fixed_voltages: [true, true, true, true],
        emark_5a_bypass: false,
        emarker_60_70w: true,
    })
    .await?;

    dev.configure_fast_charge(sw2303::FastChargeConfiguration {
        qc_enabled: true,
        fcp_enabled: true,
        afc_enabled: true,
        scp_enabled: true,
        pe20_enabled: true,
        sfcp_enabled: true,
        bc12_enabled: true,
        // Full profile: allow up to 5A tiers where applicable.
        scp_current_limit: 0,
        // Full profile: allow higher current tier where applicable.
        fcp_afc_sfcp_2_25a: false,
        qc20_20v_enabled: true,
        qc30_20v_enabled: true,
        pe20_20v_enabled: true,
        pd_12v_enabled: true,
    })
    .await?;

    dev.configure_type_c(sw2303::TypeCConfiguration {
        // Do not force broadcast currents here:
        // - Let SW2303 decide Type‑C advertisement based on negotiated PD power.
        // - Only advertise PPS 5A when cable/emarker constraints allow it.
        current_1_5a: false,
        pd_pps_5a: false,
        cc_un_driving: false,
    })
    .await?;

    let (power_config_register_mode, power_watts) = dev.get_power_config().await?;
    let protocols = dev.get_protocol_status().await?;
    let fast_charge = dev.get_fast_charge_status().await?;
    let type_c = dev.get_type_c_status().await?;
    let vin_mv = dev.read_vin_mv_12bit().await.ok();
    let vbus_mv = dev.read_vbus_mv_12bit().await.ok();
    let system_status0 = dev.get_system_status0().await.ok();
    let system_status1 = dev.get_system_status_1().await.ok();
    let system_status2 = dev.get_system_status_2().await.ok();
    let system_status3 = dev.get_system_status3().await.ok();

    Ok(EnableProfileStatus {
        power_config_register_mode,
        power_watts,
        protocols,
        fast_charge,
        type_c,
        vin_mv,
        vbus_mv,
        system_status0,
        system_status1,
        system_status2,
        system_status3,
    })
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

    let online = dev.is_sink_device_connected().await?;
    let req = dev.get_power_request().await?;
    let fc = dev.get_fast_charging_status().await?;
    let negotiated_protocol = dev.get_negotiated_protocol().await?;

    Ok(PowerRequest {
        online,
        fast_protocol: fc.contains(sw2303::registers::FastChargingFlags::IN_FAST_PROTOCOL),
        fast_voltage: fc.contains(sw2303::registers::FastChargingFlags::IN_FAST_VOLTAGE),
        negotiated_protocol,
        v_req_mv: req.voltage_mv,
        i_req_ma: req.current_limit_ma,
    })
}
