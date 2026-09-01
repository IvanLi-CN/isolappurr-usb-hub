use embassy_time::Timer;
use embedded_hal_async::i2c::I2c;
use fusb302::{
    CcPin, CcPull, DataRole, Fusb302, PdRevision, PhyConfig, PowerRole, ReceiveSopMask, RetryCount,
    ToggleMode, ToggleStatus,
};

#[derive(Debug)]
pub enum FusbSetupError<E> {
    Phy(fusb302::Error<E>),
    ToggleTimeout,
}

impl<E> From<fusb302::Error<E>> for FusbSetupError<E> {
    fn from(error: fusb302::Error<E>) -> Self {
        Self::Phy(error)
    }
}

async fn settle_cc<I2C>(
    device: &mut Fusb302<I2C>,
    source: bool,
) -> Result<CcPin, FusbSetupError<I2C::Error>>
where
    I2C: I2c,
{
    // The FUSB302 toggle engine must be stopped and its settled CC pin routed
    // to both the measurement and PD transmit blocks before BMC can run.
    for _ in 0..100 {
        let status = device.toggle_status().await?;
        let valid = if source {
            matches!(status, ToggleStatus::SourceCc1 | ToggleStatus::SourceCc2)
        } else {
            matches!(status, ToggleStatus::SinkCc1 | ToggleStatus::SinkCc2)
        };
        if valid {
            let pin = status
                .settled_cc()
                .expect("settled toggle status has a CC pin");
            device.stop_toggle().await?;
            device.set_measure_cc(Some(pin)).await?;
            device.set_tx_cc(pin).await?;
            let other = match pin {
                CcPin::Cc1 => CcPin::Cc2,
                CcPin::Cc2 => CcPin::Cc1,
            };
            device
                .set_cc_pull(pin, if source { CcPull::Up } else { CcPull::Down })
                .await?;
            device.set_cc_pull(other, CcPull::Open).await?;
            return Ok(pin);
        }
        Timer::after_millis(5).await;
    }
    Err(FusbSetupError::ToggleTimeout)
}

/// Configure the U10 FUSB302 as the fixed 9 V / 1 A PD2 sink PHY.
/// Policy and power switching remain owned by the tps-fusb runtime.
pub async fn configure_sink<I2C>(
    device: &mut Fusb302<I2C>,
) -> Result<CcPin, FusbSetupError<I2C::Error>>
where
    I2C: I2c,
{
    device.init().await?;
    device
        .configure_phy(PhyConfig {
            pd_revision: PdRevision::Rev20,
            power_role: PowerRole::Sink,
            data_role: DataRole::Ufp,
            auto_goodcrc: true,
            retry_count: RetryCount::Three,
            auto_soft_reset: true,
            auto_hard_reset: true,
            receive_sop: ReceiveSopMask::NONE,
        })
        .await?;
    device.set_cc_pull(CcPin::Cc1, CcPull::Down).await?;
    device.set_cc_pull(CcPin::Cc2, CcPull::Down).await?;
    device.start_toggle(ToggleMode::Sink).await?;
    settle_cc(device, false).await
}

/// Configure the U11 FUSB302 as the PD2 source PHY with RpDefault.
/// The published 0.1 API exposes only the default host-current selection;
/// higher Rp/current modes are deliberately not reachable here.
pub async fn configure_source<I2C>(
    device: &mut Fusb302<I2C>,
) -> Result<(), FusbSetupError<I2C::Error>>
where
    I2C: I2c,
{
    device.init().await?;
    device
        .configure_phy(PhyConfig {
            pd_revision: PdRevision::Rev20,
            power_role: PowerRole::Source,
            data_role: DataRole::Dfp,
            auto_goodcrc: true,
            retry_count: RetryCount::Three,
            auto_soft_reset: true,
            auto_hard_reset: true,
            receive_sop: ReceiveSopMask::NONE,
        })
        .await?;
    device.set_host_current_default().await?;
    device.set_cc_pull(CcPin::Cc1, CcPull::Up).await?;
    device.set_cc_pull(CcPin::Cc2, CcPull::Up).await?;
    // A source port is legitimately detached at boot. Do not block startup
    // waiting for a TOGDONE result; the source policy settles and routes the
    // CC pin when a sink attaches.
    device.start_toggle(ToggleMode::Source).await?;
    Ok(())
}
