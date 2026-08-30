use core::sync::atomic::{AtomicU8, Ordering};

use defmt::info;
use embassy_time::Timer;
use esp_hal::gpio::Output;
use fusb302::{CcPin, Fusb302, PdPacket, SopType};
use isolapurr_firmware_core::tps_fusb_power::{InputEvent, InputPowerSelector};
use uom::si::electric_current::milliampere;
use uom::si::electric_potential::millivolt;
use usbpd::protocol_layer::message::data::request::{CurrentRequest, PowerSource, VoltageRequest};
use usbpd::protocol_layer::message::data::source_capabilities::{
    PowerDataObject, SourceCapabilities,
};
use usbpd::sink::device_policy_manager::DevicePolicyManager;
use usbpd::timers::Timer as UsbPdTimer;
use usbpd_traits::{Driver, DriverRxError, DriverTxError};

/// U10 sink status visible to diagnostics without exposing its controller.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum SinkStatus {
    /// No VBUS has been observed.
    Detached = 0,
    /// VBUS is present but the source has not advertised a usable 9 V PDO.
    SourceUnsupported = 1,
    /// A fixed 9 V / 1 A request has been sent.
    Requesting9V1A = 2,
    /// PS_RDY was received and the VBUS comparator confirmed the 9 V range.
    Contract9V1A = 3,
    /// A policy, measurement, or bus fault forced the input path off.
    Fault = 4,
}

impl SinkStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Detached => "detached",
            Self::SourceUnsupported => "source_unsupported",
            Self::Requesting9V1A => "requesting_9v_1a",
            Self::Contract9V1A => "contract_9v_1a",
            Self::Fault => "fault",
        }
    }
}

static SINK_STATUS: AtomicU8 = AtomicU8::new(SinkStatus::Detached as u8);
static SINK_VBUS_NINE_VOLTS: AtomicU8 = AtomicU8::new(0);

pub fn sink_status() -> SinkStatus {
    match SINK_STATUS.load(Ordering::Acquire) {
        1 => SinkStatus::SourceUnsupported,
        2 => SinkStatus::Requesting9V1A,
        3 => SinkStatus::Contract9V1A,
        4 => SinkStatus::Fault,
        _ => SinkStatus::Detached,
    }
}

fn set_sink_status(status: SinkStatus) {
    SINK_STATUS.store(status as u8, Ordering::Release);
}

pub struct EmbassyUsbPdTimer;

impl UsbPdTimer for EmbassyUsbPdTimer {
    async fn after_millis(milliseconds: u64) {
        Timer::after_millis(milliseconds).await;
    }
}

/// DPM for the fixed 9 V / 1 A input contract.
///
/// The DPM owns the input path pins only after the policy engine has received
/// PS_RDY and the PHY comparator has confirmed the requested voltage. It never
/// enables a path for the 5 V fallback request.
pub struct FixedNineVoltSinkDpm<'d> {
    vin_en: Output<'d>,
    vin_sel: Output<'d>,
    selector: InputPowerSelector,
}

impl<'d> FixedNineVoltSinkDpm<'d> {
    pub fn new(vin_en: Output<'d>, vin_sel: Output<'d>) -> Self {
        Self {
            vin_en,
            vin_sel,
            selector: InputPowerSelector::new(),
        }
    }

    fn disable_input(&mut self) {
        self.vin_en.set_low();
        self.selector.handle(InputEvent::Fault);
    }

    async fn enable_usb_input(&mut self) {
        self.vin_en.set_low();
        Timer::after_millis(5).await;
        self.vin_sel.set_high();
        if SINK_VBUS_NINE_VOLTS.load(Ordering::Acquire) != 0 {
            self.vin_en.set_high();
            let _ = self.selector.handle(InputEvent::UsbContract9V1A);
            set_sink_status(SinkStatus::Contract9V1A);
        } else {
            self.disable_input();
            set_sink_status(SinkStatus::Fault);
        }
    }
}

impl DevicePolicyManager for FixedNineVoltSinkDpm<'_> {
    async fn inform(&mut self, source_capabilities: &SourceCapabilities) {
        let usable = source_capabilities.pdos().iter().any(|pdo| {
            matches!(pdo, PowerDataObject::FixedSupply(fixed)
                if fixed.voltage() == usbpd::units::ElectricPotential::new::<millivolt>(9_000)
                    && fixed.max_current()
                        >= usbpd::units::ElectricCurrent::new::<milliampere>(1_000))
        });
        if !usable {
            set_sink_status(SinkStatus::SourceUnsupported);
        }
    }

    async fn request(&mut self, source_capabilities: &SourceCapabilities) -> PowerSource {
        let voltage = usbpd::units::ElectricPotential::new::<millivolt>(9_000);
        let current = usbpd::units::ElectricCurrent::new::<milliampere>(1_000);
        let usable = source_capabilities.pdos().iter().any(|pdo| {
            matches!(pdo, PowerDataObject::FixedSupply(fixed)
                if fixed.voltage() == voltage && fixed.max_current() >= current)
        });
        if usable {
            set_sink_status(SinkStatus::Requesting9V1A);
            PowerSource::new_fixed(
                CurrentRequest::Specific(current),
                VoltageRequest::Specific(voltage),
                source_capabilities,
            )
            .unwrap_or_else(|_| {
                PowerSource::new_fixed(
                    CurrentRequest::Highest,
                    VoltageRequest::Safe5V,
                    source_capabilities,
                )
                .expect("source advertised the mandatory vSafe5V PDO")
            })
        } else {
            set_sink_status(SinkStatus::SourceUnsupported);
            PowerSource::new_fixed(
                CurrentRequest::Highest,
                VoltageRequest::Safe5V,
                source_capabilities,
            )
            .expect("source advertised the mandatory vSafe5V PDO")
        }
    }

    async fn transition_power(&mut self, _accepted: &PowerSource) {
        if sink_status() == SinkStatus::Requesting9V1A {
            self.enable_usb_input().await;
        } else {
            self.disable_input();
        }
    }

    async fn hard_reset(&mut self) {
        self.disable_input();
        set_sink_status(SinkStatus::Fault);
    }
}

/// Adapter from the typed FUSB302 FIFO API to `usbpd` 2.0's async Driver.
/// Hardware GoodCRC and retry are enabled by the PHY setup before this driver
/// is handed to the sink policy engine.
pub struct Fusb302UsbpdDriver<I2C> {
    phy: Fusb302<I2C>,
    active_cc: CcPin,
    vbus_present: bool,
}

impl<I2C> Fusb302UsbpdDriver<I2C> {
    pub const fn new(phy: Fusb302<I2C>, active_cc: CcPin) -> Self {
        Self {
            phy,
            active_cc,
            vbus_present: false,
        }
    }

    pub const fn set_vbus_present(&mut self, present: bool) {
        self.vbus_present = present;
    }

    pub fn into_inner(self) -> Fusb302<I2C> {
        self.phy
    }

    async fn sample_vbus(
        &mut self,
        threshold: fusb302::VbusThreshold,
    ) -> Result<fusb302::VbusComparator, fusb302::Error<I2C::Error>>
    where
        I2C: embedded_hal_async::i2c::I2c,
    {
        self.phy.configure_vbus_measurement(threshold).await?;
        let result = self.phy.read_vbus_comparator().await;
        // VBUS measurement disconnects MEAS_CC1/2. Restore the settled CC
        // route before the next PD packet, otherwise the PHY cannot receive
        // or transmit BMC after the first comparator sample.
        self.phy.set_measure_cc(Some(self.active_cc)).await?;
        self.phy.set_tx_cc(self.active_cc).await?;
        result
    }
}

impl<I2C> Driver for Fusb302UsbpdDriver<I2C>
where
    I2C: embedded_hal_async::i2c::I2c,
{
    const HAS_AUTO_GOOD_CRC: bool = true;
    const HAS_AUTO_RETRY: bool = true;

    async fn wait_for_vbus(&mut self) {
        if self.vbus_present {
            return;
        }
        loop {
            match self.sample_vbus(fusb302::VbusThreshold::VSAFE5).await {
                Ok(fusb302::VbusComparator::AboveThreshold) => {
                    self.vbus_present = true;
                    info!("tps-fusb U10 VBUS comparator above vSafe5 threshold");
                    set_sink_status(SinkStatus::Detached);
                    return;
                }
                Ok(fusb302::VbusComparator::AtOrBelowThreshold) => {
                    Timer::after_millis(5).await;
                }
                Err(_) => {
                    set_sink_status(SinkStatus::Fault);
                    Timer::after_millis(20).await;
                }
            }
        }
    }

    async fn receive(&mut self, buffer: &mut [u8]) -> Result<usize, DriverRxError> {
        loop {
            match self.phy.receive().await {
                Ok(Some(packet)) => {
                    info!("tps-fusb U10 PD packet header={=u16:04x}", packet.header());
                    if self.vbus_present {
                        let measured_above = matches!(
                            self.sample_vbus(fusb302::VbusThreshold::NINE_VOLTS_MIN)
                                .await,
                            Ok(fusb302::VbusComparator::AboveThreshold)
                        );
                        SINK_VBUS_NINE_VOLTS.store(measured_above as u8, Ordering::Release);
                    }
                    let payload = packet.payload();
                    let needed = payload.len() + 2;
                    if buffer.len() < needed {
                        return Err(DriverRxError::Discarded);
                    }
                    buffer[..2].copy_from_slice(&packet.header().to_le_bytes());
                    buffer[2..needed].copy_from_slice(payload);
                    return Ok(needed);
                }
                Ok(None) => Timer::after_millis(1).await,
                Err(fusb302::Error::Receive(_)) => return Err(DriverRxError::Discarded),
                Err(_) => return Err(DriverRxError::HardReset),
            }
        }
    }

    async fn transmit(&mut self, data: &[u8]) -> Result<(), DriverTxError> {
        if data.len() < 2 {
            return Err(DriverTxError::Discarded);
        }
        let header = u16::from_le_bytes([data[0], data[1]]);
        let packet = PdPacket::new(SopType::Sop, header, &data[2..])
            .map_err(|_| DriverTxError::Discarded)?;
        self.phy
            .transmit(&packet)
            .await
            .map_err(|_| DriverTxError::Discarded)
    }

    async fn transmit_hard_reset(&mut self) -> Result<(), DriverTxError> {
        self.phy
            .transmit_hard_reset()
            .await
            .map_err(|_| DriverTxError::HardReset)
    }
}
