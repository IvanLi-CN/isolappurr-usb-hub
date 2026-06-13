#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ButtonId {
    Left,  // USB-A
    Right, // USB-C
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ButtonEdge {
    Pressed,
    Released,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PressClass {
    Short,
    Long,
    Invalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PowerState {
    On,
    Off,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DataState {
    Connected,
    Disconnected,
    Pulsing { until: Instant },
}

#[derive(Clone, Copy, Debug)]
struct PortState {
    power: PowerState,
    data: DataState,
    busy_until: Option<Instant>,
}

impl PortState {
    const fn new(power: PowerState) -> Self {
        let data = match power {
            PowerState::On => DataState::Connected,
            PowerState::Off => DataState::Disconnected,
        };
        Self {
            power,
            data,
            busy_until: None,
        }
    }

    fn is_busy(&self, now: Instant) -> bool {
        self.busy_until.is_some_and(|until| now < until)
            || matches!(self.data, DataState::Pulsing { .. })
    }
}

const DATA_DISCONNECT_MS: u64 = 250;
const TOAST_MS: u64 = 1500;
const POWER_SWITCH_GUARD_MS: u64 = 350;
#[cfg(feature = "net_http")]
// Keep CH442E disconnected long enough for host USB stacks to observe a real
// detach/attach cycle when the USB-C route returns to the MCU console path.
const USB_C_ROUTE_SETTLE_MS: u64 = 250;
#[cfg(feature = "net_http")]
const LEDD_SAMPLE_MS: u64 = 1_000;
#[cfg(feature = "net_http")]
const UP0_PG_SAMPLE_MS: u64 = 1_000;

const PRESS_SHORT_MIN: Duration = Duration::from_millis(100);
const PRESS_SHORT_MAX: Duration = Duration::from_millis(500);
const PRESS_LONG_MIN: Duration = Duration::from_millis(1000);
const PRESS_LONG_MAX: Duration = Duration::from_millis(5000);
const SETTINGS_MENU_MS: u64 = 5_000;
const SW2303_POR_RELEASE_MS: u64 = 100;
const PD_I2C_KHZ: u32 = 400;
const PD_I2C_TIMEOUT_MS: u64 = 10;
const SW2303_POLL_MS: u64 = 20;
const SW2303_ERROR_RETRY_MS: u64 = 100;
const SW2303_READ_RETRIES: u8 = 20;
const SW2303_READ_RETRY_DELAY_MS: u64 = 5;
const SW2303_STABLE_READS_BEFORE_TPS: u16 = 1;
const SW2303_STABLE_READS_BEFORE_TPS_STATUS: u16 = 500;
const SW2303_STABLE_READS_BEFORE_PROFILE: u16 = 50;
const SW2303_CC_UN_DRIVING_MS: u64 = 1_200;
const PD_RUNTIME_RECOVERY_ERROR_LIMIT: u8 = 3;
const PD_RUNTIME_RECOVERY_MIN_INTERVAL_MS: u64 = 1_000;
const PD_RUNTIME_RECOVERY_TPS_RETRIES: u8 = 4;
const BOOT_PD_DISCHARGE_SETTLE_MS: u64 = 50;
const BOOT_PD_RELEASE_SETTLE_MS: u64 = 10;
const BOOT_CE_RECOVERY_HOLD_MS: u64 = 5;
const BOOT_CE_RECOVERY_POLL_MS: u64 = 5;
const BOOT_CE_RELEASE_SETTLE_MS: u64 = 10;
const BOOT_TPS_RETRY_DELAY_MS: u64 = 10;
const USB_C_PD_RESTART_GUARD_MS: u64 = 500;
// Toast colors (RGB565 raw).
const TOAST_OK_RAW: u16 = 0x1407; // dark green (same as UI OK power)
const TOAST_INFO_RAW: u16 = 0x1A7B; // blue for white-background info toasts
const TOAST_WARN_RAW: u16 = 0xC201; // dark orange warning
const TOAST_ERR_RAW: u16 = 0x98C3; // dark red error

const TOAST_USB_A_DATA_OFF: [[u8; 13]; 3] =
    [*b"USB-A DATAOFF", *b"250MS        ", *b"             "];
const TOAST_USB_A_DATA_ON: [[u8; 13]; 3] =
    [*b"USB-A DATAON ", *b"DONE         ", *b"             "];
const TOAST_USB_A_PWR_OFF: [[u8; 13]; 3] =
    [*b"USB-A PWROFF ", *b"DONE         ", *b"             "];
const TOAST_USB_A_PWR_ON: [[u8; 13]; 3] = [*b"USB-A PWRON  ", *b"DONE         ", *b"             "];
const TOAST_USB_A_PWR_FAIL: [[u8; 13]; 3] =
    [*b"USB-A PWRERR ", *b"RETRY        ", *b"             "];
const TOAST_USB_A_BUSY: [[u8; 13]; 3] = [*b"USB-A BUSY   ", *b"REJECT       ", *b"             "];
const TOAST_USB_A_BADTIME: [[u8; 13]; 3] =
    [*b"USB-A BADTIME", *b"REJECT       ", *b"             "];

const TOAST_USB_C_DATA_OFF: [[u8; 13]; 3] =
    [*b"USB-C DATAOFF", *b"250MS        ", *b"             "];
const TOAST_USB_C_DATA_ON: [[u8; 13]; 3] =
    [*b"USB-C DATAON ", *b"DONE         ", *b"             "];
const TOAST_USB_C_PWR_OFF: [[u8; 13]; 3] =
    [*b"USB-C PWROFF ", *b"DONE         ", *b"             "];
const TOAST_USB_C_PWR_ON: [[u8; 13]; 3] = [*b"USB-C PWRON  ", *b"DONE         ", *b"             "];
const TOAST_USB_C_PWR_FAIL: [[u8; 13]; 3] =
    [*b"USB-C PWRERR ", *b"RETRY        ", *b"             "];
const TOAST_USB_C_BUSY: [[u8; 13]; 3] = [*b"USB-C BUSY   ", *b"REJECT       ", *b"             "];
const TOAST_USB_C_BADTIME: [[u8; 13]; 3] =
    [*b"USB-C BADTIME", *b"REJECT       ", *b"             "];
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SettingsMenuItem {
    Mode,
    PowerPreset,
    PowerAdvanced,
    Wifi,
    About,
}

#[cfg(feature = "net_http")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SettingsMenuView {
    Main,
    ModeDetail,
    PowerPresetDetail,
    PowerAdvancedDetail,
}

impl SettingsMenuItem {
    fn prev(self) -> Self {
        match self {
            Self::Mode => Self::About,
            Self::PowerPreset => Self::Mode,
            Self::PowerAdvanced => Self::PowerPreset,
            Self::Wifi => Self::PowerAdvanced,
            Self::About => Self::Wifi,
        }
    }

    fn next(self) -> Self {
        match self {
            Self::Mode => Self::PowerPreset,
            Self::PowerPreset => Self::PowerAdvanced,
            Self::PowerAdvanced => Self::Wifi,
            Self::Wifi => Self::About,
            Self::About => Self::Mode,
        }
    }

    fn index(self) -> usize {
        match self {
            Self::Mode => 0,
            Self::PowerPreset => 1,
            Self::PowerAdvanced => 2,
            Self::Wifi => 3,
            Self::About => 4,
        }
    }
}

#[cfg(feature = "net_http")]
fn copy_compact_line(line: &mut [u8; 20], text: &str) {
    for (dst, src) in line.iter_mut().zip(text.as_bytes().iter().copied()) {
        *dst = src;
    }
}

#[cfg(feature = "net_http")]
fn about_toast_lines() -> [[u8; 20]; 3] {
    let mut lines = [*b"                    "; 3];
    copy_compact_line(&mut lines[0], "ISOLAPURR USB HUB");
    copy_compact_line(&mut lines[1], release_version());
    copy_compact_line(&mut lines[2], BUILD_GIT_SHA);
    lines
}

#[cfg(feature = "net_http")]
fn route_mode_label(route: provisioning::UsbCDownstreamRoute) -> &'static str {
    match route {
        provisioning::UsbCDownstreamRoute::Mcu => "UPGRADE",
        provisioning::UsbCDownstreamRoute::UsbC => "NORMAL",
    }
}

#[cfg(feature = "net_http")]
fn route_transition_label(
    previous: provisioning::UsbCDownstreamRoute,
    next: provisioning::UsbCDownstreamRoute,
) -> &'static str {
    match (previous, next) {
        (provisioning::UsbCDownstreamRoute::UsbC, provisioning::UsbCDownstreamRoute::Mcu) => {
            "NORMAL TO UPGRADE"
        }
        (provisioning::UsbCDownstreamRoute::Mcu, provisioning::UsbCDownstreamRoute::UsbC) => {
            "UPGRADE TO NORMAL"
        }
        (_, next) => route_mode_label(next),
    }
}

#[cfg(feature = "net_http")]
fn route_detail_title(route: provisioning::UsbCDownstreamRoute) -> &'static str {
    match route {
        provisioning::UsbCDownstreamRoute::Mcu => "USB-C MODE",
        provisioning::UsbCDownstreamRoute::UsbC => "USB-C MODE",
    }
}

#[cfg(feature = "net_http")]
fn route_current_label(route: provisioning::UsbCDownstreamRoute) -> &'static str {
    match route {
        provisioning::UsbCDownstreamRoute::Mcu => "CURRENT: UPGRADE",
        provisioning::UsbCDownstreamRoute::UsbC => "CURRENT: NORMAL",
    }
}

#[cfg(feature = "net_http")]
fn power_preset_label(config: PowerConfig) -> &'static str {
    if config == PowerConfig::defaults() {
        "FULL AUTO"
    } else if config.tps_mode == TpsMode::Manual {
        "MANUAL TPS"
    } else {
        "CUSTOM AUTO"
    }
}

#[cfg(feature = "net_http")]
fn power_preset_lines(config: PowerConfig) -> [[u8; 20]; 3] {
    let mut lines = [*b"                    "; 3];
    let mut current = heapless::String::<20>::new();
    let _ = write!(current, "CURRENT: {}", power_preset_label(config));
    copy_compact_line(&mut lines[0], current.as_str());
    copy_compact_line(&mut lines[1], "FULL SW2303 100W");
    copy_compact_line(&mut lines[2], "PRESS AGAIN DEFAULT");
    lines
}

#[cfg(feature = "net_http")]
fn path_mode_label(mode: isolapurr_usb_hub::power_config::ManualUsbCPathMode) -> &'static str {
    match mode {
        isolapurr_usb_hub::power_config::ManualUsbCPathMode::Default => "PATH DEFAULT",
        isolapurr_usb_hub::power_config::ManualUsbCPathMode::Disconnect => "PATH DISCONNECT",
        isolapurr_usb_hub::power_config::ManualUsbCPathMode::Force => "PATH FORCE",
    }
}

#[cfg(feature = "net_http")]
fn power_advanced_lines(config: PowerConfig) -> [[u8; 20]; 3] {
    let mut lines = [*b"                    "; 3];
    copy_compact_line(
        &mut lines[0],
        match config.tps_mode {
            TpsMode::AutoFollow => "MODE AUTO FOLLOW",
            TpsMode::Manual => "MODE MANUAL TPS",
        },
    );
    let mut setpoint = heapless::String::<20>::new();
    let _ = write!(
        setpoint,
        "V {}MV I {}MA",
        config.manual.voltage_mv, config.manual.current_limit_ma
    );
    copy_compact_line(&mut lines[1], setpoint.as_str());
    copy_compact_line(&mut lines[2], path_mode_label(config.manual.usb_c_path_mode));
    lines
}

#[cfg(feature = "net_http")]
fn toggled_power_mode_config(config: PowerConfig) -> PowerConfig {
    let mut next = config;
    next.tps_mode = match config.tps_mode {
        TpsMode::AutoFollow => TpsMode::Manual,
        TpsMode::Manual => TpsMode::AutoFollow,
    };
    next.validated().unwrap_or(PowerConfig::defaults())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ToastId {
    DataOff,
    DataOn,
    PwrOff,
    PwrOn,
    PwrFail,
    Busy,
    BadTime,
}

fn toast_spec(button: ButtonId, toast: ToastId) -> (&'static [[u8; 13]; 3], u16) {
    let fg_raw = match toast {
        ToastId::DataOff => TOAST_INFO_RAW,
        ToastId::DataOn => TOAST_OK_RAW,
        ToastId::PwrOff => TOAST_WARN_RAW,
        ToastId::PwrOn => TOAST_OK_RAW,
        ToastId::PwrFail | ToastId::Busy | ToastId::BadTime => TOAST_ERR_RAW,
    };

    let lines = match (button, toast) {
        (ButtonId::Left, ToastId::DataOff) => &TOAST_USB_A_DATA_OFF,
        (ButtonId::Left, ToastId::DataOn) => &TOAST_USB_A_DATA_ON,
        (ButtonId::Left, ToastId::PwrOff) => &TOAST_USB_A_PWR_OFF,
        (ButtonId::Left, ToastId::PwrOn) => &TOAST_USB_A_PWR_ON,
        (ButtonId::Left, ToastId::PwrFail) => &TOAST_USB_A_PWR_FAIL,
        (ButtonId::Left, ToastId::Busy) => &TOAST_USB_A_BUSY,
        (ButtonId::Left, ToastId::BadTime) => &TOAST_USB_A_BADTIME,
        (ButtonId::Right, ToastId::DataOff) => &TOAST_USB_C_DATA_OFF,
        (ButtonId::Right, ToastId::DataOn) => &TOAST_USB_C_DATA_ON,
        (ButtonId::Right, ToastId::PwrOff) => &TOAST_USB_C_PWR_OFF,
        (ButtonId::Right, ToastId::PwrOn) => &TOAST_USB_C_PWR_ON,
        (ButtonId::Right, ToastId::PwrFail) => &TOAST_USB_C_PWR_FAIL,
        (ButtonId::Right, ToastId::Busy) => &TOAST_USB_C_BUSY,
        (ButtonId::Right, ToastId::BadTime) => &TOAST_USB_C_BADTIME,
    };

    (lines, fg_raw)
}

#[derive(Debug)]
struct DebouncedButton {
    stable_pressed: bool,
    candidate_pressed: bool,
    candidate_since: Option<Instant>,
}

impl DebouncedButton {
    fn new() -> Self {
        Self {
            stable_pressed: false,
            candidate_pressed: false,
            candidate_since: None,
        }
    }

    #[cfg(feature = "net_http")]
    fn is_pressed(&self) -> bool {
        self.stable_pressed
    }

    fn update(&mut self, now: Instant, is_pressed: bool, debounce: Duration) -> Option<ButtonEdge> {
        if is_pressed == self.stable_pressed {
            self.candidate_pressed = is_pressed;
            self.candidate_since = None;
            return None;
        }

        let Some(since) = self.candidate_since else {
            self.candidate_pressed = is_pressed;
            self.candidate_since = Some(now);
            return None;
        };

        if self.candidate_pressed != is_pressed {
            self.candidate_pressed = is_pressed;
            self.candidate_since = Some(now);
            return None;
        }

        if now - since < debounce {
            return None;
        }

        self.stable_pressed = is_pressed;
        self.candidate_since = None;

        Some(if is_pressed {
            ButtonEdge::Pressed
        } else {
            ButtonEdge::Released
        })
    }
}

fn classify_press(duration: Duration) -> PressClass {
    if duration < PRESS_SHORT_MIN {
        return PressClass::Invalid;
    }
    if duration <= PRESS_SHORT_MAX {
        return PressClass::Short;
    }
    if duration < PRESS_LONG_MIN {
        return PressClass::Invalid;
    }
    if duration <= PRESS_LONG_MAX {
        return PressClass::Long;
    }
    PressClass::Invalid
}

fn telemetry_field_to_ui(field: Field<u32>) -> NormalUiField {
    match field {
        Field::Ok(v) => NormalUiField::Ok(v.saturating_mul(1_000)),
        Field::Err => NormalUiField::Err,
    }
}

fn log_sw2303_profile_status(context: &'static str, status: &EnableProfileStatus) {
    let pps_max_mv = status
        .pd_capabilities
        .and_then(|pd_capabilities| pd_capabilities.max_pps_voltage_mv());
    let pps_above_11v = status
        .pd_capabilities
        .map(|pd_capabilities| pd_capabilities.supports_pps_above_11v());

    info!(
        "sw2303 profile: {} power_register_mode={} cap_w={}W protocols={:?} pd_caps={:?} fast={:?} type_c={:?} vin_mv={:?} vbus_mv={:?} sys0={:?} sys1={:?} sys2={:?} pps_max_mv={:?} pps_above_11v={:?}",
        context,
        status.power_config_register_mode,
        status.power_watts,
        defmt::Debug2Format(&status.protocols),
        defmt::Debug2Format(&status.pd_capabilities),
        defmt::Debug2Format(&status.fast_charge),
        defmt::Debug2Format(&status.type_c),
        defmt::Debug2Format(&status.vin_mv),
        defmt::Debug2Format(&status.vbus_mv),
        defmt::Debug2Format(&status.system_status0),
        defmt::Debug2Format(&status.system_status1),
        defmt::Debug2Format(&status.system_status2),
        defmt::Debug2Format(&pps_max_mv),
        defmt::Debug2Format(&pps_above_11v)
    );

    if let Some(pd_capabilities) = status.pd_capabilities {
        if pd_capabilities.pps_enabled && !pd_capabilities.supports_pps_above_11v() {
            defmt::warn!(
                "sw2303 pps diag: PPS is enabled but >11V ranges are absent; pps_mode={:?} pps_ranges={:?}",
                defmt::Debug2Format(&pd_capabilities.pps_config_mode),
                defmt::Debug2Format(&pd_capabilities.pps_ranges)
            );
        }
    } else {
        defmt::warn!(
            "sw2303 pps diag: PD/PPS capability readback unavailable after profile apply; keeping configuration success"
        );
    }
}

#[cfg(feature = "net_http")]
fn uptime_ms_from_instant(now: Instant) -> u64 {
    (now.duration_since_epoch().as_micros() / 1_000) as u64
}

fn elapsed_ms_since(start: Instant) -> u64 {
    (start.elapsed().as_micros() / 1_000) as u64
}

fn power_request_changed_for_logging(last: Option<PowerRequest>, next: PowerRequest) -> bool {
    match last {
        Some(last) => {
            last.fast_protocol != next.fast_protocol
                || last.fast_voltage != next.fast_voltage
                || last.negotiated_protocol != next.negotiated_protocol
                || last.cc_attached != next.cc_attached
                || last.status_valid != next.status_valid
                || last.v_req_mv != next.v_req_mv
                || last.i_req_ma != next.i_req_ma
        }
        None => true,
    }
}

#[cfg(feature = "net_http")]
fn idle_bias_attach_detected(request: PowerRequest) -> bool {
    if !request.status_valid {
        return true;
    }

    request.cc_attached
        || request.negotiated_protocol.is_some()
        || request.fast_protocol
        || request.fast_voltage
}

#[cfg(feature = "net_http")]
fn current_applied_idle_bias_offset_ma(
    calibration: Option<IdleBiasCalibration>,
    metrics: PortMetrics,
) -> Option<u32> {
    let calibration = calibration?;
    let Field::Ok(voltage_mv) = metrics.voltage_mv else {
        return None;
    };
    let Field::Ok(_) = metrics.current_ma else {
        return None;
    };
    calibration.current_offset_ma(voltage_mv)
}

#[cfg(feature = "net_http")]
fn corrected_port_metrics(
    metrics: PortMetrics,
    calibration: Option<IdleBiasCalibration>,
) -> PortMetrics {
    let Some(offset_ma) = current_applied_idle_bias_offset_ma(calibration, metrics) else {
        return metrics;
    };
    let (Field::Ok(voltage_mv), Field::Ok(raw_current_ma)) = (metrics.voltage_mv, metrics.current_ma)
    else {
        return metrics;
    };
    let corrected_current_ma = corrected_current_ma(raw_current_ma, offset_ma);
    PortMetrics {
        voltage_mv: Field::Ok(voltage_mv),
        current_ma: Field::Ok(corrected_current_ma),
        power_mw: Field::Ok(corrected_power_mw(voltage_mv, corrected_current_ma)),
    }
}

#[cfg(feature = "net_http")]
fn idle_bias_api_snapshot(
    calibration: Option<IdleBiasCalibration>,
    run: net::ApiIdleBiasRunSnapshot,
    current_applied_offset_ma: Option<u32>,
) -> net::ApiIdleBiasSnapshot {
    let (correction_enabled, dataset_valid, current_offsets_ma) = match calibration {
        Some(calibration) => (
            calibration.correction_enabled,
            true,
            calibration.current_offsets_ma,
        ),
        None => (false, false, [0; IDLE_BIAS_POINT_COUNT]),
    };

    net::ApiIdleBiasSnapshot {
        correction_enabled,
        dataset_valid,
        metadata: IdleBiasMetadata::fixed(),
        current_offsets_ma,
        current_applied_offset_ma,
        run,
    }
}

#[cfg(feature = "net_http")]
fn port_metrics_to_api_telemetry(
    present: bool,
    metrics: PortMetrics,
    sample_uptime_ms: u64,
) -> net::ApiPortTelemetry {
    if !present {
        return net::ApiPortTelemetry {
            status: net::ApiTelemetryStatus::NotInserted,
            voltage_mv: None,
            current_ma: None,
            power_mw: None,
            sample_uptime_ms,
        };
    }

    let (Field::Ok(voltage_mv), Field::Ok(current_ma), Field::Ok(power_mw)) =
        (metrics.voltage_mv, metrics.current_ma, metrics.power_mw)
    else {
        return net::ApiPortTelemetry {
            status: net::ApiTelemetryStatus::Error,
            voltage_mv: None,
            current_ma: None,
            power_mw: None,
            sample_uptime_ms,
        };
    };

    // Keep the v1 "overrange" semantics aligned with Spec #j9twf's `>= 1000.0` threshold:
    // `1000.0 V/A/W` == `1_000_000 mV/mA/mW`.
    if voltage_mv >= 1_000_000 || current_ma >= 1_000_000 || power_mw >= 1_000_000 {
        return net::ApiPortTelemetry {
            status: net::ApiTelemetryStatus::Overrange,
            voltage_mv: None,
            current_ma: None,
            power_mw: None,
            sample_uptime_ms,
        };
    }

    net::ApiPortTelemetry {
        status: net::ApiTelemetryStatus::Ok,
        voltage_mv: Some(voltage_mv),
        current_ma: Some(current_ma),
        power_mw: Some(power_mw),
        sample_uptime_ms,
    }
}
