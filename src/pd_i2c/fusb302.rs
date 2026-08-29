use embedded_hal_async::i2c::I2c;
use fusb302::{
    CcPin, CcPull, DataRole, Fusb302, PdRevision, PhyConfig, PowerRole, ReceiveSopMask, RetryCount,
    ToggleMode,
};

/// Configure the U10 FUSB302 as the fixed 9 V / 1 A PD2 sink PHY.
/// Policy and power switching remain owned by the tps-fusb runtime.
pub async fn configure_sink<I2C>(
    device: &mut Fusb302<I2C>,
) -> Result<(), fusb302::Error<I2C::Error>>
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
    device.start_toggle(ToggleMode::Sink).await
}

/// Configure the U11 FUSB302 as the PD2 source PHY with RpDefault.
/// The published 0.1 API exposes only the default host-current selection;
/// higher Rp/current modes are deliberately not reachable here.
pub async fn configure_source<I2C>(
    device: &mut Fusb302<I2C>,
) -> Result<(), fusb302::Error<I2C::Error>>
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
    device.start_toggle(ToggleMode::Source).await
}
