//! Exercise the production profile writer with the pinned driver, without ESP HAL.
use embedded_hal::i2c::{ErrorType, Operation};
use isolapurr_firmware_core::pd_i2c::{PowerRequest, ProtocolStatus};
use isolapurr_firmware_core::power_config::{self, PowerConfig};
use std::future::Future;
use std::task::{Context, Poll, Waker};
use sw2303::registers::{PdConfig1Flags, Register};

// Parent-module bindings used by the production file on the SW2303 bus.
const SW2303_ADDR_7BIT: u8 = 0x3c;
#[allow(dead_code)]
#[path = "../../../src/pd_i2c/sw2303.rs"]
mod sw2303_profile;

#[derive(Debug, Eq, PartialEq)]
struct BusError;

impl embedded_hal::i2c::Error for BusError {
    fn kind(&self) -> embedded_hal::i2c::ErrorKind {
        embedded_hal::i2c::ErrorKind::Other
    }
}

struct Registers {
    values: [u8; 256],
    cursor: usize,
    fail_current_limit_write: bool,
    ignore_current_limit_write: bool,
}

impl Registers {
    fn new(three_amp: bool) -> Self {
        let mut bus = Self {
            values: [0; 256],
            cursor: 0,
            fail_current_limit_write: false,
            ignore_current_limit_write: false,
        };
        if three_amp {
            bus.values[Register::PdConfig1 as usize] = PdConfig1Flags::PPS3_3A_LIMIT.bits();
        }
        bus
    }
}

impl ErrorType for Registers {
    type Error = BusError;
}

impl embedded_hal_async::i2c::I2c for Registers {
    async fn transaction(
        &mut self,
        address: u8,
        operations: &mut [Operation<'_>],
    ) -> Result<(), Self::Error> {
        assert_eq!(address, SW2303_ADDR_7BIT);
        for operation in operations {
            match operation {
                Operation::Write(bytes) => {
                    self.cursor = usize::from(bytes[0]);
                    for (offset, byte) in bytes[1..].iter().enumerate() {
                        let register = self.cursor + offset;
                        if register == Register::PdConfig1 as usize {
                            let mask = PdConfig1Flags::PPS3_3A_LIMIT.bits();
                            if self.fail_current_limit_write
                                && (byte ^ self.values[register]) & mask != 0
                            {
                                return Err(BusError);
                            }
                            if self.ignore_current_limit_write {
                                self.values[register] =
                                    (byte & !mask) | (self.values[register] & mask);
                                continue;
                            }
                        }
                        self.values[register] = *byte;
                    }
                }
                Operation::Read(bytes) => {
                    // The real driver uses separate write/read transactions.
                    for byte in bytes.iter_mut() {
                        *byte = self.values[self.cursor];
                        self.cursor += 1;
                    }
                }
            }
        }
        Ok(())
    }
}

fn run<F: Future>(future: F) -> F::Output {
    let mut future = std::pin::pin!(future);
    match future
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
    {
        Poll::Ready(result) => result,
        Poll::Pending => panic!("register transactions must complete without a timer"),
    }
}

fn three_amp_config() -> PowerConfig {
    let mut config = PowerConfig::defaults();
    config.capability.power_watts = 60;
    config.capability.current.pps3_limit_ma = 3_000;
    config.capability.current.pd_pps_5a = false;
    config
}

#[test]
fn saved_three_amp_profile_replaces_five_amp_register_default() {
    for pd_pps_5a in [false, true] {
        let mut config = three_amp_config();
        config.capability.current.pd_pps_5a = pd_pps_5a;
        let mut bus = Registers::new(false);
        let status = run(sw2303_profile::apply_enable_profile(&mut bus, &config)).unwrap();

        assert_eq!(status.readback.pps3_limit_ma, Some(3_000));
        assert_eq!(status.readback.pd_pps_5a, Some(pd_pps_5a));
        assert!(status.matches_config(&config));
    }
}

#[test]
fn restoring_defaults_clears_three_amp_limit_and_preserves_pd_configuration() {
    let mut bus = Registers::new(true);
    let status = run(sw2303_profile::apply_enable_profile_full(&mut bus)).unwrap();

    assert_eq!(status.readback.pps3_limit_ma, Some(5_000));
    assert!(status.matches_config(&PowerConfig::defaults()));
    let default_pd_config1 = bus.values[Register::PdConfig1 as usize];

    let config = three_amp_config();
    let status = run(sw2303_profile::apply_enable_profile(&mut bus, &config)).unwrap();
    assert!(status.matches_config(&config));
    assert_eq!(
        bus.values[Register::PdConfig1 as usize],
        default_pd_config1 | PdConfig1Flags::PPS3_3A_LIMIT.bits(),
        "current selection must preserve every other B4 bit"
    );
    let repeated = run(sw2303_profile::apply_enable_profile(&mut bus, &config)).unwrap();
    assert!(repeated.matches_config(&config));
}

#[test]
fn current_limit_write_error_cannot_report_profile_success() {
    let mut bus = Registers::new(false);
    bus.fail_current_limit_write = true;
    let result = run(sw2303_profile::apply_enable_profile(
        &mut bus,
        &three_amp_config(),
    ));
    assert!(matches!(result, Err(sw2303::error::Error::I2c(BusError))));
}

#[test]
fn ignored_current_limit_write_fails_complete_readback_match() {
    let config = three_amp_config();
    let mut bus = Registers::new(false);
    bus.ignore_current_limit_write = true;
    let status = run(sw2303_profile::apply_enable_profile(&mut bus, &config)).unwrap();

    assert_eq!(status.readback.pps3_limit_ma, Some(5_000));
    assert!(!status.matches_config(&config));
}
