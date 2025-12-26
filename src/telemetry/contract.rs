use crate::pd_i2c::PowerSetpoint;
use crate::telemetry::hardware::U17_R29_SHUNT_RESISTANCE_UOHMS;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Field<T> {
    Ok(T),
    Err,
}

impl<T> Field<T> {
    pub const fn ok(value: T) -> Self {
        Self::Ok(value)
    }

    pub const fn err() -> Self {
        Self::Err
    }

    pub fn is_err(&self) -> bool {
        matches!(self, Self::Err)
    }

    pub fn map<U>(self, f: impl FnOnce(T) -> U) -> Field<U> {
        match self {
            Self::Ok(v) => Field::Ok(f(v)),
            Self::Err => Field::Err,
        }
    }
}

/// Voltage (mV) and current (mA) pair for UI display.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct VoltageCurrent {
    pub voltage_mv: Field<u16>,
    pub current_ma: Field<u16>,
}

impl VoltageCurrent {
    pub const fn err() -> Self {
        Self {
            voltage_mv: Field::Err,
            current_ma: Field::Err,
        }
    }
}

/// UI line: `SET(applied)` (Voltage + current limit).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SetApplied {
    pub voltage_mv: Field<u16>,
    pub current_limit_ma: Field<u16>,
}

impl SetApplied {
    pub const fn err() -> Self {
        Self {
            voltage_mv: Field::Err,
            current_limit_ma: Field::Err,
        }
    }
}

impl From<PowerSetpoint> for SetApplied {
    fn from(setpoint: PowerSetpoint) -> Self {
        Self {
            voltage_mv: Field::Ok(setpoint.v_out_mv),
            current_limit_ma: Field::Ok(setpoint.i_lim_ma),
        }
    }
}

/// Frozen v1 telemetry snapshot: 3 UI lines (Landscape, 10 Hz).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TelemetrySnapshot {
    pub u17_meas: VoltageCurrent,
    pub u14_meas: VoltageCurrent,
    pub set_applied: SetApplied,
}

impl TelemetrySnapshot {
    pub const fn all_err() -> Self {
        Self {
            u17_meas: VoltageCurrent::err(),
            u14_meas: VoltageCurrent::err(),
            set_applied: SetApplied::err(),
        }
    }
}

/// Derive `U14(meas)` from `U17(meas)` using the frozen v1 formula:
/// `V_u14 = V_u17 + I_u17 * Rshunt`, `I_u14 = I_u17`.
pub fn derive_u14_meas_from_u17(u17_meas: VoltageCurrent) -> VoltageCurrent {
    let voltage_mv = match (u17_meas.voltage_mv, u17_meas.current_ma) {
        (Field::Ok(v_u17_mv), Field::Ok(i_u17_ma)) => {
            // mV = I(mA) * R(uΩ) / 1_000_000
            let delta_mv = (u32::from(i_u17_ma) * U17_R29_SHUNT_RESISTANCE_UOHMS) / 1_000_000;
            let v_u14_mv = u32::from(v_u17_mv) + delta_mv;

            Field::Ok(v_u14_mv.min(u32::from(u16::MAX)) as u16)
        }
        _ => Field::Err,
    };

    VoltageCurrent {
        voltage_mv,
        current_ma: u17_meas.current_ma,
    }
}
