#![allow(clippy::identity_op)]

use core::convert::Infallible;
use core::future::{Future, ready};

use embedded_graphics_core::pixelcolor::Rgb565;
use embedded_graphics_core::pixelcolor::RgbColor;
use embedded_hal::digital::OutputPin;
use embedded_hal::spi::SpiDevice;
use esp_hal::time::{Duration, Instant};
use gc9307_async::{Config, Error as GcError, GC9307C, Orientation, Timer};

use crate::telemetry::{Field, TelemetrySnapshot};

pub const WORKBUF_SIZE: usize = gc9307_async::BUF_SIZE;

const TILE_W: u16 = 24;
const TILE_H: u16 = 48;
const TILES_X: u16 = 13;

const X_OFFSET: u16 = (320 - TILE_W * TILES_X) / 2;
const Y_OFFSET: u16 = (172 - TILE_H * 3) / 2;

const FG: Rgb565 = Rgb565::WHITE;
const BG: Rgb565 = Rgb565::BLACK;

pub trait BacklightControl {
    fn on(&mut self);
}

pub struct AlwaysOnBacklight;

impl BacklightControl for AlwaysOnBacklight {
    fn on(&mut self) {}
}

/// Q8 is a P-channel MOSFET (D=3V3, S=LEDA, G=BLK), so pulling BLK low turns backlight on.
pub struct ActiveLowBacklight<PIN>(pub PIN);

impl<PIN> BacklightControl for ActiveLowBacklight<PIN>
where
    PIN: OutputPin<Error = Infallible>,
{
    fn on(&mut self) {
        self.0.set_low().ok();
    }
}

pub struct EspHalSpinTimer;

impl Timer for EspHalSpinTimer {
    fn after_millis(milliseconds: u64) -> impl Future<Output = ()> {
        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(milliseconds) {}
        ready(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct FrameCache {
    u17_v: [u8; 5],
    u17_i: [u8; 4],
    u14_v: [u8; 5],
    u14_i: [u8; 4],
    set_v: [u8; 5],
    set_i: [u8; 4],
}

impl FrameCache {
    const fn empty() -> Self {
        Self {
            u17_v: *b"-----",
            u17_i: *b"----",
            u14_v: *b"-----",
            u14_i: *b"----",
            set_v: *b"-----",
            set_i: *b"----",
        }
    }
}

pub struct DisplayUi<'b, SPI, DC, RST, TimerImpl = EspHalSpinTimer, BL = AlwaysOnBacklight>
where
    SPI: SpiDevice,
    DC: OutputPin<Error = Infallible>,
    RST: OutputPin<Error = Infallible>,
    TimerImpl: Timer,
    BL: BacklightControl,
{
    display: GC9307C<'b, SPI, DC, RST, TimerImpl>,
    backlight: BL,
    cache: FrameCache,
}

impl<'b, SPI, DC, RST, E, TimerImpl, BL> DisplayUi<'b, SPI, DC, RST, TimerImpl, BL>
where
    SPI: SpiDevice<Error = E>,
    DC: OutputPin<Error = Infallible>,
    RST: OutputPin<Error = Infallible>,
    TimerImpl: Timer,
    BL: BacklightControl,
{
    pub fn new(
        spi: SPI,
        dc: DC,
        rst: RST,
        workbuf: &'b mut [u8; WORKBUF_SIZE],
        backlight: BL,
    ) -> Self {
        let mut config = Config::default();
        config.orientation = Orientation::Landscape;
        config.width = 320;
        config.height = 172;

        Self {
            display: GC9307C::new(config, spi, dc, rst, &mut workbuf[..]),
            backlight,
            cache: FrameCache::empty(),
        }
    }

    pub fn init(&mut self) -> Result<(), GcError<E>> {
        self.display.init()?;
        self.backlight.on();
        Ok(())
    }

    pub fn draw_frame(&mut self) -> Result<(), GcError<E>> {
        self.display.fill_color(BG)?;

        // Row 0: "U17"
        self.draw_tile_str(0, 0, b"U17")?;
        // Row 1: "U14"
        self.draw_tile_str(0, 1, b"U14")?;
        // Row 2: "SET"
        self.draw_tile_str(0, 2, b"SET")?;

        Ok(())
    }

    pub fn render_snapshot(&mut self, snapshot: &TelemetrySnapshot) -> Result<(), GcError<E>> {
        let prev = self.cache;
        let mut next = self.cache;

        next.u17_v = format_mv_2dp_5(snapshot.u17_meas.voltage_mv);
        next.u17_i = format_ma_2dp_4(snapshot.u17_meas.current_ma);

        next.u14_v = format_mv_2dp_5(snapshot.u14_meas.voltage_mv);
        next.u14_i = format_ma_2dp_4(snapshot.u14_meas.current_ma);

        next.set_v = format_mv_2dp_5(snapshot.set_applied.voltage_mv);
        next.set_i = format_ma_2dp_4(snapshot.set_applied.current_limit_ma);

        self.draw_values_row(0, &next.u17_v, &next.u17_i, &prev.u17_v, &prev.u17_i)?;
        self.draw_values_row(1, &next.u14_v, &next.u14_i, &prev.u14_v, &prev.u14_i)?;
        self.draw_values_row(2, &next.set_v, &next.set_i, &prev.set_v, &prev.set_i)?;

        self.cache = next;
        Ok(())
    }

    fn draw_values_row(
        &mut self,
        row: u16,
        next_v: &[u8; 5],
        next_i: &[u8; 4],
        prev_v: &[u8; 5],
        prev_i: &[u8; 4],
    ) -> Result<(), GcError<E>> {
        if next_v != prev_v {
            self.draw_tile_str(3, row, next_v)?;
        }
        if next_i != prev_i {
            self.draw_tile_str(8, row, next_i)?;
        }
        Ok(())
    }

    fn draw_tile_str(&mut self, tile_x: u16, tile_y: u16, s: &[u8]) -> Result<(), GcError<E>> {
        for (i, &ch) in s.iter().enumerate() {
            self.draw_tile(tile_x + i as u16, tile_y, ch)?;
        }
        Ok(())
    }

    fn draw_tile(&mut self, tile_x: u16, tile_y: u16, ch: u8) -> Result<(), GcError<E>> {
        let x = X_OFFSET + tile_x * TILE_W;
        let y = Y_OFFSET + tile_y * TILE_H;

        let mut data = [0_u8; (TILE_W as usize * TILE_H as usize) / 8];
        render_char_6x8_scaled(ch, &mut data);
        self.display.write_area(x, y, TILE_W, &data, FG, BG)?;
        Ok(())
    }
}

fn format_mv_2dp_5(v: Field<u16>) -> [u8; 5] {
    match v {
        Field::Err => *b"ERR  ",
        Field::Ok(mv) => {
            // 0.01V = 10mV.
            let mut cv = (u32::from(mv) + 5) / 10;
            let max = 99 * 100 + 99;
            if cv > max {
                cv = max;
            }
            let int = cv / 100;
            let frac = cv % 100;
            [
                b'0' + (int / 10) as u8,
                b'0' + (int % 10) as u8,
                b'.',
                b'0' + (frac / 10) as u8,
                b'0' + (frac % 10) as u8,
            ]
        }
    }
}

fn format_ma_2dp_4(i: Field<u16>) -> [u8; 4] {
    match i {
        Field::Err => *b"ERR ",
        Field::Ok(ma) => {
            // 0.01A = 10mA.
            let mut ca = (u32::from(ma) + 5) / 10;
            let max = 9 * 100 + 99;
            if ca > max {
                ca = max;
            }
            let int = ca / 100;
            let frac = ca % 100;
            [
                b'0' + int as u8,
                b'.',
                b'0' + (frac / 10) as u8,
                b'0' + (frac % 10) as u8,
            ]
        }
    }
}

fn render_char_6x8_scaled(ch: u8, out: &mut [u8; 144]) {
    out.fill(0);

    const SX: u16 = 4;
    const SY: u16 = 6;

    let glyph = glyph_6x8(ch);

    for (src_y, &row_bits) in glyph.iter().enumerate() {
        for rep_y in 0..SY {
            let y = src_y as u16 * SY + rep_y;
            for src_x in 0..6u16 {
                let on = row_bits & (1 << (5 - src_x)) != 0;
                if !on {
                    continue;
                }
                for rep_x in 0..SX {
                    let x = src_x * SX + rep_x;
                    set_1bpp_24x48(out, x, y);
                }
            }
        }
    }
}

fn set_1bpp_24x48(buf: &mut [u8; 144], x: u16, y: u16) {
    let idx = usize::from(y) * 24 + usize::from(x);
    let byte = idx / 8;
    let bit = 7 - (idx % 8);
    buf[byte] |= 1 << bit;
}

fn glyph_6x8(ch: u8) -> [u8; 8] {
    match ch {
        b'0' => [
            0b011110, 0b110011, 0b110111, 0b111011, 0b110011, 0b110011, 0b011110, 0,
        ],
        b'1' => [
            0b001100, 0b011100, 0b001100, 0b001100, 0b001100, 0b001100, 0b111111, 0,
        ],
        b'2' => [
            0b011110, 0b110011, 0b000011, 0b000110, 0b001100, 0b011000, 0b111111, 0,
        ],
        b'3' => [
            0b011110, 0b110011, 0b000011, 0b001110, 0b000011, 0b110011, 0b011110, 0,
        ],
        b'4' => [
            0b000110, 0b001110, 0b011110, 0b110110, 0b111111, 0b000110, 0b000110, 0,
        ],
        b'5' => [
            0b111111, 0b110000, 0b111110, 0b000011, 0b000011, 0b110011, 0b011110, 0,
        ],
        b'6' => [
            0b011110, 0b110011, 0b110000, 0b111110, 0b110011, 0b110011, 0b011110, 0,
        ],
        b'7' => [
            0b111111, 0b000011, 0b000110, 0b001100, 0b011000, 0b011000, 0b011000, 0,
        ],
        b'8' => [
            0b011110, 0b110011, 0b110011, 0b011110, 0b110011, 0b110011, 0b011110, 0,
        ],
        b'9' => [
            0b011110, 0b110011, 0b110011, 0b011111, 0b000011, 0b110011, 0b011110, 0,
        ],

        b'.' => [0, 0, 0, 0, 0, 0, 0b001100, 0],
        b'-' => [0, 0, 0, 0b111111, 0, 0, 0, 0],
        b' ' => [0, 0, 0, 0, 0, 0, 0, 0],

        b'A' => [
            0b011110, 0b110011, 0b110011, 0b111111, 0b110011, 0b110011, 0b110011, 0,
        ],
        b'E' => [
            0b111111, 0b110000, 0b110000, 0b111110, 0b110000, 0b110000, 0b111111, 0,
        ],
        b'R' => [
            0b111110, 0b110011, 0b110011, 0b111110, 0b110110, 0b110011, 0b110011, 0,
        ],
        b'S' => [
            0b011111, 0b110000, 0b110000, 0b011110, 0b000011, 0b000011, 0b111110, 0,
        ],
        b'T' => [
            0b111111, 0b001100, 0b001100, 0b001100, 0b001100, 0b001100, 0b001100, 0,
        ],
        b'U' => [
            0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b011110, 0,
        ],

        b'?' => [
            0b011110, 0b110011, 0b000011, 0b000110, 0b001100, 0, 0b001100, 0,
        ],
        _ => glyph_6x8(b'?'),
    }
}
