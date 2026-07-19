use esp_hal::peripherals::{SENS, SYSTEM};

pub struct Esp32S3Temperature {
    raw_value: u8,
}

impl Esp32S3Temperature {
    pub fn to_celsius(&self) -> f32 {
        (self.raw_value as f32) * 0.4386 + 7.36
    }
}

pub struct Esp32S3TemperatureSensor<'d> {
    _system: SYSTEM<'d>,
    _sens: SENS<'d>,
}

impl<'d> Esp32S3TemperatureSensor<'d> {
    pub fn new(system: SYSTEM<'d>, sens: SENS<'d>) -> Self {
        let sensor = Self {
            _system: system,
            _sens: sens,
        };
        sensor.configure();
        sensor
    }

    fn configure(&self) {
        SYSTEM::regs()
            .perip_clk_en0()
            .modify(|_, w| w.apb_saradc_clk_en().set_bit());
        SYSTEM::regs()
            .perip_rst_en0()
            .modify(|_, w| w.apb_saradc_rst().clear_bit());

        SENS::regs().sar_peri_clk_gate_conf().modify(|_, w| {
            w.rtc_i2c_clk_en().set_bit();
            w.tsens_clk_en().set_bit();
            w.saradc_clk_en().set_bit()
        });
        SENS::regs().sar_peri_reset_conf().modify(|_, w| {
            w.sar_rtc_i2c_reset().clear_bit();
            w.sar_tsens_reset().clear_bit();
            w.sar_saradc_reset().clear_bit()
        });
        SENS::regs().sar_tsens_ctrl().modify(|_, w| {
            w.sar_tsens_power_up_force().set_bit();
            w.sar_tsens_power_up().set_bit();
            w.sar_tsens_dump_out().set_bit()
        });
    }

    pub fn get_temperature(&self) -> Esp32S3Temperature {
        let raw_value = SENS::regs().sar_tsens_ctrl().read().sar_tsens_out().bits();
        Esp32S3Temperature { raw_value }
    }
}
