use embedded_hal::i2c::I2c;

use super::{PowerRequest, SW2303_ADDR_7BIT};

/// Poll SW2303 registers and decode them into a `PowerRequest`.
///
/// This intentionally uses raw register reads (no "convenience" voltage APIs) to match the
/// SW2303 register manual bit/units exactly.
pub fn read_power_request<I2C>(
    i2c: &mut I2C,
) -> Result<PowerRequest, sw2303::error::Error<I2C::Error>>
where
    I2C: I2c,
    I2C::Error: core::fmt::Debug,
{
    let mut dev = sw2303::SW2303::new(i2c, SW2303_ADDR_7BIT);

    let reg0d = dev.read_register(sw2303::registers::Register::SystemStatus3)?;
    let online = (reg0d & 0x80) != 0;

    let reg06 = dev.read_register(sw2303::registers::Register::FastChargingStatus)?;
    let fast_charging = (reg06 & 0x80) != 0;
    let type_c_connected = (reg06 & 0x40) != 0;
    let pd_version_raw = (reg06 >> 4) & 0x03;
    let protocol_raw = reg06 & 0x0F;

    let reg03 = dev.read_register(sw2303::registers::Register::VoltageHigh)?;
    let reg04 = dev.read_register(sw2303::registers::Register::VoltageLow)?;
    let dac_vol_12b = ((reg03 as u16) << 4) | ((reg04 as u16) >> 4);
    let v_req_mv = dac_vol_12b * 10;

    let reg05 = dev.read_register(sw2303::registers::Register::CurrentLimit)?;
    let ctrl_icc = (reg05 & 0x7F) as u16;
    let i_req_ma = 1000 + ctrl_icc * 50;

    Ok(PowerRequest {
        online,
        type_c_connected,
        fast_charging,
        pd_version_raw,
        protocol_raw,
        v_req_mv,
        i_req_ma,
    })
}
