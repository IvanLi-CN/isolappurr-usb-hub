use crate::power_config::{DEFAULT_POWER_WATTS, TPS_MAX_CURRENT_MA, quantize_manual_current_ma};

pub const THERMAL_SAMPLE_INTERVAL_MS: u64 = 1_000;
pub const THERMAL_DERATE_START_DECI_C: i16 = 800;
pub const THERMAL_CLEAR_DECI_C: i16 = 780;
pub const THERMAL_SHUTDOWN_DECI_C: i16 = 1_000;
pub const THERMAL_REARM_DECI_C: i16 = 980;
pub const THERMAL_STATE_CONFIRM_SAMPLES: u8 = 3;
pub const THERMAL_STALE_BUDGET: u8 = 3;
pub const THERMAL_DERATE_STEP_WATTS: u8 = 5;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThermalSensorStatus {
    Ok,
    Stale,
    Error,
}

impl ThermalSensorStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Stale => "stale",
            Self::Error => "error",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ThermalSensorReading {
    pub temperature_deci_c: Option<i16>,
    pub status: ThermalSensorStatus,
}

impl ThermalSensorReading {
    pub const fn error() -> Self {
        Self {
            temperature_deci_c: None,
            status: ThermalSensorStatus::Error,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ThermalSensors {
    pub mcu: ThermalSensorReading,
    pub tmp112: ThermalSensorReading,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThermalState {
    Normal,
    Derating,
    Shutdown,
    RearmRequired,
    SensorFault,
}

impl ThermalState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Derating => "derating",
            Self::Shutdown => "shutdown",
            Self::RearmRequired => "rearm_required",
            Self::SensorFault => "sensor_fault",
        }
    }

    pub const fn requires_output_off(self) -> bool {
        matches!(
            self,
            Self::Shutdown | Self::RearmRequired | Self::SensorFault
        )
    }

    pub const fn alarm_active(self) -> bool {
        matches!(self, Self::Derating | Self::Shutdown | Self::SensorFault)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThermalReason {
    None,
    McuHot,
    Tmp112Hot,
    BothHot,
    McuCritical,
    Tmp112Critical,
    BothCritical,
    McuSensorFault,
    Tmp112SensorFault,
    BothSensorFault,
}

impl ThermalReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::McuHot => "mcu_hot",
            Self::Tmp112Hot => "tmp112_hot",
            Self::BothHot => "both_hot",
            Self::McuCritical => "mcu_critical",
            Self::Tmp112Critical => "tmp112_critical",
            Self::BothCritical => "both_critical",
            Self::McuSensorFault => "mcu_sensor_fault",
            Self::Tmp112SensorFault => "tmp112_sensor_fault",
            Self::BothSensorFault => "both_sensor_fault",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ThermalTelemetry {
    pub sensors: ThermalSensors,
    pub hottest_temperature_deci_c: Option<i16>,
    pub state: ThermalState,
    pub reason: ThermalReason,
    pub effective_power_watts: u8,
    pub sample_uptime_ms: u64,
}

impl ThermalTelemetry {
    pub const fn unknown() -> Self {
        Self {
            sensors: ThermalSensors {
                mcu: ThermalSensorReading::error(),
                tmp112: ThermalSensorReading::error(),
            },
            hottest_temperature_deci_c: None,
            state: ThermalState::SensorFault,
            reason: ThermalReason::BothSensorFault,
            effective_power_watts: 0,
            sample_uptime_ms: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SensorTracker {
    last_ok_deci_c: Option<i16>,
    stale_cycles: u8,
    reading: ThermalSensorReading,
}

impl SensorTracker {
    const fn new() -> Self {
        Self {
            last_ok_deci_c: None,
            stale_cycles: 0,
            reading: ThermalSensorReading::error(),
        }
    }

    fn update(&mut self, sample: Option<i16>) {
        match sample {
            Some(temperature_deci_c) => {
                self.last_ok_deci_c = Some(temperature_deci_c);
                self.stale_cycles = 0;
                self.reading = ThermalSensorReading {
                    temperature_deci_c: Some(temperature_deci_c),
                    status: ThermalSensorStatus::Ok,
                };
            }
            None => match self.last_ok_deci_c {
                Some(last_ok) if self.stale_cycles < THERMAL_STALE_BUDGET => {
                    self.stale_cycles = self.stale_cycles.saturating_add(1);
                    self.reading = ThermalSensorReading {
                        temperature_deci_c: Some(last_ok),
                        status: ThermalSensorStatus::Stale,
                    };
                }
                _ => {
                    self.stale_cycles = THERMAL_STALE_BUDGET;
                    self.reading = ThermalSensorReading::error();
                }
            },
        }
    }
}

pub struct ThermalController {
    mcu: SensorTracker,
    tmp112: SensorTracker,
    state: ThermalState,
    reason: ThermalReason,
    confirm_samples: u8,
    sample_uptime_ms: u64,
}

impl ThermalController {
    pub const fn new() -> Self {
        Self {
            mcu: SensorTracker::new(),
            tmp112: SensorTracker::new(),
            state: ThermalState::Normal,
            reason: ThermalReason::None,
            confirm_samples: 0,
            sample_uptime_ms: 0,
        }
    }

    pub fn update(
        &mut self,
        mcu_sample_deci_c: Option<i16>,
        tmp112_sample_deci_c: Option<i16>,
        sample_uptime_ms: u64,
    ) {
        self.sample_uptime_ms = sample_uptime_ms;
        self.mcu.update(mcu_sample_deci_c);
        self.tmp112.update(tmp112_sample_deci_c);

        let live_state = self.live_state();
        match self.state {
            ThermalState::Shutdown | ThermalState::SensorFault => match live_state.state {
                ThermalState::Shutdown | ThermalState::SensorFault => {
                    self.state = live_state.state;
                    self.reason = live_state.reason;
                    self.confirm_samples = 0;
                }
                _ if self.rearm_window_ready() => {
                    self.confirm_samples = self.confirm_samples.saturating_add(1);
                    if self.confirm_samples >= THERMAL_STATE_CONFIRM_SAMPLES {
                        self.state = ThermalState::RearmRequired;
                        self.confirm_samples = 0;
                    }
                }
                _ => {
                    self.confirm_samples = 0;
                }
            },
            ThermalState::RearmRequired => {
                if matches!(
                    live_state.state,
                    ThermalState::Shutdown | ThermalState::SensorFault
                ) {
                    self.state = live_state.state;
                    self.reason = live_state.reason;
                    self.confirm_samples = 0;
                }
            }
            ThermalState::Derating => match live_state.state {
                ThermalState::Shutdown | ThermalState::SensorFault => {
                    self.state = live_state.state;
                    self.reason = live_state.reason;
                    self.confirm_samples = 0;
                }
                ThermalState::Derating => {
                    self.reason = live_state.reason;
                    self.confirm_samples = 0;
                }
                ThermalState::Normal if self.clear_window_ready() => {
                    self.confirm_samples = self.confirm_samples.saturating_add(1);
                    if self.confirm_samples >= THERMAL_STATE_CONFIRM_SAMPLES {
                        self.state = ThermalState::Normal;
                        self.reason = ThermalReason::None;
                        self.confirm_samples = 0;
                    }
                }
                _ => {
                    self.confirm_samples = 0;
                }
            },
            ThermalState::Normal => match live_state.state {
                ThermalState::Normal => {
                    self.reason = ThermalReason::None;
                    self.confirm_samples = 0;
                }
                ThermalState::Derating | ThermalState::Shutdown | ThermalState::SensorFault => {
                    self.state = live_state.state;
                    self.reason = live_state.reason;
                    self.confirm_samples = 0;
                }
                ThermalState::RearmRequired => {}
            },
        }
    }

    pub fn try_acknowledge_rearm(&mut self) -> bool {
        if self.state != ThermalState::RearmRequired || !self.rearm_window_ready() {
            return false;
        }

        let live_state = self.live_state();
        if matches!(
            live_state.state,
            ThermalState::Shutdown | ThermalState::SensorFault
        ) {
            return false;
        }

        self.state = live_state.state;
        self.reason = live_state.reason;
        self.confirm_samples = 0;
        true
    }

    pub const fn state(&self) -> ThermalState {
        self.state
    }

    pub const fn reason(&self) -> ThermalReason {
        self.reason
    }

    pub fn telemetry(&self, user_power_watts: u8) -> ThermalTelemetry {
        ThermalTelemetry {
            sensors: ThermalSensors {
                mcu: self.mcu.reading,
                tmp112: self.tmp112.reading,
            },
            hottest_temperature_deci_c: self.hottest_temperature_deci_c(),
            state: self.state,
            reason: self.reason,
            effective_power_watts: self.effective_power_watts(user_power_watts),
            sample_uptime_ms: self.sample_uptime_ms,
        }
    }

    pub fn effective_power_watts(&self, user_power_watts: u8) -> u8 {
        if self.state.requires_output_off() {
            return 0;
        }
        user_power_watts.min(thermal_derated_power_watts(
            self.hottest_temperature_deci_c(),
        ))
    }

    pub fn hottest_temperature_deci_c(&self) -> Option<i16> {
        match (
            self.mcu.reading.temperature_deci_c,
            self.tmp112.reading.temperature_deci_c,
        ) {
            (Some(mcu), Some(tmp112)) => Some(mcu.max(tmp112)),
            (Some(mcu), None) => Some(mcu),
            (None, Some(tmp112)) => Some(tmp112),
            (None, None) => None,
        }
    }

    fn clear_window_ready(&self) -> bool {
        self.hottest_temperature_deci_c()
            .is_some_and(|temperature| temperature < THERMAL_CLEAR_DECI_C)
            && !self.has_sensor_fault()
    }

    fn rearm_window_ready(&self) -> bool {
        self.hottest_temperature_deci_c()
            .is_some_and(|temperature| temperature < THERMAL_REARM_DECI_C)
            && self.all_sensors_fresh()
    }

    const fn has_sensor_fault(&self) -> bool {
        matches!(self.mcu.reading.status, ThermalSensorStatus::Error)
            || matches!(self.tmp112.reading.status, ThermalSensorStatus::Error)
    }

    const fn all_sensors_fresh(&self) -> bool {
        matches!(self.mcu.reading.status, ThermalSensorStatus::Ok)
            && matches!(self.tmp112.reading.status, ThermalSensorStatus::Ok)
    }

    fn live_state(&self) -> ThermalLiveState {
        if self.has_sensor_fault() {
            return ThermalLiveState {
                state: ThermalState::SensorFault,
                reason: sensor_fault_reason(self.mcu.reading.status, self.tmp112.reading.status),
            };
        }

        let hottest = self.hottest_temperature_deci_c();
        if hottest.is_some_and(|temperature| temperature > THERMAL_SHUTDOWN_DECI_C) {
            return ThermalLiveState {
                state: ThermalState::Shutdown,
                reason: critical_reason(
                    self.mcu.reading.temperature_deci_c,
                    self.tmp112.reading.temperature_deci_c,
                ),
            };
        }

        if hottest.is_some_and(|temperature| temperature > THERMAL_DERATE_START_DECI_C) {
            return ThermalLiveState {
                state: ThermalState::Derating,
                reason: hot_reason(
                    self.mcu.reading.temperature_deci_c,
                    self.tmp112.reading.temperature_deci_c,
                ),
            };
        }

        ThermalLiveState {
            state: ThermalState::Normal,
            reason: ThermalReason::None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ThermalLiveState {
    state: ThermalState,
    reason: ThermalReason,
}

pub fn thermal_derated_power_watts(hottest_temperature_deci_c: Option<i16>) -> u8 {
    let Some(hottest_temperature_deci_c) = hottest_temperature_deci_c else {
        return DEFAULT_POWER_WATTS;
    };
    if hottest_temperature_deci_c <= THERMAL_DERATE_START_DECI_C {
        return DEFAULT_POWER_WATTS;
    }

    let excess_deci_c = i32::from(hottest_temperature_deci_c - THERMAL_DERATE_START_DECI_C);
    let derate_steps = ((excess_deci_c + 9) / 10) as u8;
    DEFAULT_POWER_WATTS.saturating_sub(derate_steps.saturating_mul(THERMAL_DERATE_STEP_WATTS))
}

pub fn current_limit_ma_for_power_watts(voltage_mv: u16, power_watts: u8) -> u16 {
    if power_watts == 0 || voltage_mv == 0 {
        return 0;
    }

    let current_ma =
        (u32::from(power_watts).saturating_mul(1_000_000) / u32::from(voltage_mv)) as u16;
    current_ma.min(TPS_MAX_CURRENT_MA)
}

pub fn clamp_manual_current_limit_ma(voltage_mv: u16, requested_ma: u16, power_watts: u8) -> u16 {
    quantize_manual_current_ma(
        requested_ma
            .min(current_limit_ma_for_power_watts(voltage_mv, power_watts))
            .min(TPS_MAX_CURRENT_MA),
    )
}

pub fn tmp112_raw_to_deci_c(raw: [u8; 2]) -> i16 {
    let bits = i16::from_be_bytes(raw) >> 4;
    let deci_c = i32::from(bits) * 625;
    if deci_c >= 0 {
        ((deci_c + 500) / 1_000) as i16
    } else {
        ((deci_c - 500) / 1_000) as i16
    }
}

fn hot_reason(mcu_deci_c: Option<i16>, tmp112_deci_c: Option<i16>) -> ThermalReason {
    let mcu_hot = mcu_deci_c.is_some_and(|temperature| temperature > THERMAL_DERATE_START_DECI_C);
    let tmp112_hot =
        tmp112_deci_c.is_some_and(|temperature| temperature > THERMAL_DERATE_START_DECI_C);
    match (mcu_hot, tmp112_hot) {
        (true, true) => ThermalReason::BothHot,
        (true, false) => ThermalReason::McuHot,
        (false, true) => ThermalReason::Tmp112Hot,
        (false, false) => ThermalReason::None,
    }
}

fn critical_reason(mcu_deci_c: Option<i16>, tmp112_deci_c: Option<i16>) -> ThermalReason {
    let mcu_critical = mcu_deci_c.is_some_and(|temperature| temperature > THERMAL_SHUTDOWN_DECI_C);
    let tmp112_critical =
        tmp112_deci_c.is_some_and(|temperature| temperature > THERMAL_SHUTDOWN_DECI_C);
    match (mcu_critical, tmp112_critical) {
        (true, true) => ThermalReason::BothCritical,
        (true, false) => ThermalReason::McuCritical,
        (false, true) => ThermalReason::Tmp112Critical,
        (false, false) => ThermalReason::None,
    }
}

fn sensor_fault_reason(
    mcu_status: ThermalSensorStatus,
    tmp112_status: ThermalSensorStatus,
) -> ThermalReason {
    let mcu_fault = matches!(mcu_status, ThermalSensorStatus::Error);
    let tmp112_fault = matches!(tmp112_status, ThermalSensorStatus::Error);
    match (mcu_fault, tmp112_fault) {
        (true, true) => ThermalReason::BothSensorFault,
        (true, false) => ThermalReason::McuSensorFault,
        (false, true) => ThermalReason::Tmp112SensorFault,
        (false, false) => ThermalReason::None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        THERMAL_CLEAR_DECI_C, THERMAL_STATE_CONFIRM_SAMPLES, ThermalController, ThermalReason,
        ThermalSensorStatus, ThermalState, clamp_manual_current_limit_ma,
        current_limit_ma_for_power_watts, thermal_derated_power_watts, tmp112_raw_to_deci_c,
    };

    #[test]
    fn derate_step_edges_round_up_each_started_degree() {
        assert_eq!(thermal_derated_power_watts(Some(800)), 100);
        assert_eq!(thermal_derated_power_watts(Some(801)), 95);
        assert_eq!(thermal_derated_power_watts(Some(810)), 95);
        assert_eq!(thermal_derated_power_watts(Some(811)), 90);
        assert_eq!(thermal_derated_power_watts(Some(1_000)), 0);
        assert_eq!(thermal_derated_power_watts(Some(1_001)), 0);
    }

    #[test]
    fn effective_power_takes_lower_of_user_cap_and_thermal_cap() {
        let mut controller = ThermalController::new();
        controller.update(Some(841), Some(790), 1_000);
        assert_eq!(controller.effective_power_watts(100), 75);
        assert_eq!(controller.effective_power_watts(60), 60);
    }

    #[test]
    fn manual_current_limit_clamps_to_power_cap_and_quantizes() {
        assert_eq!(current_limit_ma_for_power_watts(20_000, 40), 2_000);
        assert_eq!(clamp_manual_current_limit_ma(20_000, 3_250, 40), 2_000);
        assert_eq!(clamp_manual_current_limit_ma(20_000, 3_250, 41), 2_050);
    }

    #[test]
    fn enters_sensor_fault_after_three_stale_cycles() {
        let mut controller = ThermalController::new();
        controller.update(Some(500), Some(510), 1_000);
        for uptime_ms in [2_000, 3_000, 4_000] {
            controller.update(None, Some(510), uptime_ms);
            assert_eq!(controller.state(), ThermalState::Normal);
            assert_eq!(
                controller.telemetry(100).sensors.mcu.status,
                ThermalSensorStatus::Stale
            );
        }
        controller.update(None, Some(510), 5_000);
        assert_eq!(controller.state(), ThermalState::SensorFault);
        assert_eq!(controller.reason(), ThermalReason::McuSensorFault);
        assert_eq!(
            controller.telemetry(100).sensors.mcu.status,
            ThermalSensorStatus::Error
        );
    }

    #[test]
    fn clears_derating_only_after_three_cool_samples_below_hysteresis_floor() {
        let mut controller = ThermalController::new();
        controller.update(Some(850), Some(790), 1_000);
        assert_eq!(controller.state(), ThermalState::Derating);

        controller.update(Some(790), Some(779), 2_000);
        assert_eq!(controller.state(), ThermalState::Derating);

        for sample_index in 0..THERMAL_STATE_CONFIRM_SAMPLES {
            controller.update(
                Some(770),
                Some(THERMAL_CLEAR_DECI_C - 1),
                3_000 + u64::from(sample_index),
            );
        }

        assert_eq!(controller.state(), ThermalState::Normal);
        assert_eq!(controller.reason(), ThermalReason::None);
    }

    #[test]
    fn shutdown_recovers_to_rearm_and_requires_explicit_enable() {
        let mut controller = ThermalController::new();
        controller.update(Some(1_001), Some(790), 1_000);
        assert_eq!(controller.state(), ThermalState::Shutdown);
        assert_eq!(controller.reason(), ThermalReason::McuCritical);
        assert_eq!(controller.effective_power_watts(100), 0);

        for sample_index in 0..THERMAL_STATE_CONFIRM_SAMPLES {
            controller.update(Some(970), Some(960), 2_000 + u64::from(sample_index));
        }

        assert_eq!(controller.state(), ThermalState::RearmRequired);
        assert_eq!(controller.effective_power_watts(100), 0);
        assert!(controller.try_acknowledge_rearm());
        assert_eq!(controller.state(), ThermalState::Derating);
        assert_eq!(controller.reason(), ThermalReason::BothHot);
    }

    #[test]
    fn sensor_fault_recovery_also_requires_explicit_enable() {
        let mut controller = ThermalController::new();
        controller.update(Some(500), Some(510), 1_000);
        for uptime_ms in [2_000, 3_000, 4_000, 5_000] {
            controller.update(None, Some(510), uptime_ms);
        }
        assert_eq!(controller.state(), ThermalState::SensorFault);

        for sample_index in 0..THERMAL_STATE_CONFIRM_SAMPLES {
            controller.update(Some(500), Some(510), 6_000 + u64::from(sample_index));
        }

        assert_eq!(controller.state(), ThermalState::RearmRequired);
        assert!(controller.try_acknowledge_rearm());
        assert_eq!(controller.state(), ThermalState::Normal);
    }

    #[test]
    fn tmp112_temperature_decoding_matches_signed_quarter_degree_format() {
        assert_eq!(tmp112_raw_to_deci_c([0x19, 0x00]), 250);
        assert_eq!(tmp112_raw_to_deci_c([0xFF, 0x00]), -10);
        assert_eq!(tmp112_raw_to_deci_c([0x07, 0xD0]), 78);
    }
}
