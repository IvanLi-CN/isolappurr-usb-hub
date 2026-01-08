#![allow(clippy::identity_op)]

use core::convert::Infallible;
use core::future::{Future, ready};

use embedded_graphics_core::pixelcolor::Rgb565;
use embedded_graphics_core::pixelcolor::RgbColor;
use embedded_graphics_core::pixelcolor::raw::RawU16;
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

const GLYPH_SRC_W: u16 = 6;
const GLYPH_SRC_H: u16 = 8;

// Smaller font + spacing: render 6x8 glyph centered into a 24x48 tile.
const GLYPH_SX: u16 = 3;
const GLYPH_SY: u16 = 4;
const GLYPH_W: u16 = GLYPH_SRC_W * GLYPH_SX;
const GLYPH_H: u16 = GLYPH_SRC_H * GLYPH_SY;
const GLYPH_X0: u16 = (TILE_W - GLYPH_W) / 2;
const GLYPH_Y0: u16 = (TILE_H - GLYPH_H) / 2;

const FG: Rgb565 = Rgb565::WHITE;
const BG: Rgb565 = Rgb565::BLACK;

// --- GC9307 normal UI (3×2 fixed-width) colors (RGB565; frozen spec) ---
const UI_BG_RAW: u16 = 0x0000;

const UI_OK_VOLT_RAW: u16 = 0xFE45;
const UI_OK_CURR_RAW: u16 = 0xF206;
const UI_OK_PWR_RAW: u16 = 0x4D6A;

const UI_STATUS_NOT_PRESENT_RAW: u16 = 0x8410;
const UI_STATUS_ERROR_RAW: u16 = 0xF800;
const UI_STATUS_OVER_RAW: u16 = 0xFCC0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NormalUiField {
    Ok(u32),
    Err,
}

impl NormalUiField {
    pub const fn ok(value: u32) -> Self {
        Self::Ok(value)
    }

    pub const fn err() -> Self {
        Self::Err
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NormalUiPort {
    pub present: bool,
    /// Voltage in µV.
    pub voltage_uv: NormalUiField,
    /// Current in µA.
    pub current_ua: NormalUiField,
    /// Power in µW.
    pub power_uw: NormalUiField,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NormalUiSnapshot {
    /// Left column: USB-A.
    pub usb_a: NormalUiPort,
    /// Right column: USB-C/PD.
    pub usb_c: NormalUiPort,
}

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ActiveView {
    TelemetryFrame,
    NormalUi,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct NormalUiTileCache {
    chars: [[u8; 13]; 3],
    fg_raw: [[u16; 13]; 3],
}

impl NormalUiTileCache {
    const fn sentinel() -> Self {
        Self {
            chars: [[0; 13]; 3],
            fg_raw: [[0xFFFF; 13]; 3],
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
    active_view: ActiveView,
    cache: FrameCache,
    normal_ui_cache: NormalUiTileCache,
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
            active_view: ActiveView::TelemetryFrame,
            cache: FrameCache::empty(),
            normal_ui_cache: NormalUiTileCache::sentinel(),
        }
    }

    pub fn init(&mut self) -> Result<(), GcError<E>> {
        self.display.init()?;
        self.backlight.on();
        Ok(())
    }

    pub fn draw_frame(&mut self) -> Result<(), GcError<E>> {
        self.active_view = ActiveView::TelemetryFrame;
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
        self.active_view = ActiveView::TelemetryFrame;
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

    /// Render GC9307 "normal UI" (3 rows × 2 columns, 13 chars per row).
    ///
    /// Layout (each row): `left_cell(6) + ' ' + right_cell(6)`.
    /// Units are fixed per row: V / A / W.
    pub fn render_normal_ui(&mut self, snapshot: &NormalUiSnapshot) -> Result<(), GcError<E>> {
        // Clear only when entering normal UI (or switching from another view).
        if self.active_view != ActiveView::NormalUi {
            self.display.fill_color(BG)?;
            self.normal_ui_cache = NormalUiTileCache::sentinel();
            self.active_view = ActiveView::NormalUi;
        }

        // Row 0: Voltage (V)
        {
            let (left_s, left_fg_raw) = format_normal_ui_cell(
                snapshot.usb_a.present,
                snapshot.usb_a.voltage_uv,
                b'V',
                UI_OK_VOLT_RAW,
            );
            let (right_s, right_fg_raw) = format_normal_ui_cell(
                snapshot.usb_c.present,
                snapshot.usb_c.voltage_uv,
                b'V',
                UI_OK_VOLT_RAW,
            );
            self.draw_normal_ui_row_diff(0, 0, &left_s, left_fg_raw, &right_s, right_fg_raw)?;
        }

        // Row 1: Current (A)
        {
            let (left_s, left_fg_raw) = format_normal_ui_cell(
                snapshot.usb_a.present,
                snapshot.usb_a.current_ua,
                b'A',
                UI_OK_CURR_RAW,
            );
            let (right_s, right_fg_raw) = format_normal_ui_cell(
                snapshot.usb_c.present,
                snapshot.usb_c.current_ua,
                b'A',
                UI_OK_CURR_RAW,
            );
            self.draw_normal_ui_row_diff(1, 1, &left_s, left_fg_raw, &right_s, right_fg_raw)?;
        }

        // Row 2: Power (W)
        {
            let (left_s, left_fg_raw) = format_normal_ui_cell(
                snapshot.usb_a.present,
                snapshot.usb_a.power_uw,
                b'W',
                UI_OK_PWR_RAW,
            );
            let (right_s, right_fg_raw) = format_normal_ui_cell(
                snapshot.usb_c.present,
                snapshot.usb_c.power_uw,
                b'W',
                UI_OK_PWR_RAW,
            );
            self.draw_normal_ui_row_diff(2, 2, &left_s, left_fg_raw, &right_s, right_fg_raw)?;
        }

        Ok(())
    }

    fn draw_normal_ui_row_diff(
        &mut self,
        row_idx: usize,
        row: u16,
        left_s: &[u8; 6],
        left_fg_raw: u16,
        right_s: &[u8; 6],
        right_fg_raw: u16,
    ) -> Result<(), GcError<E>> {
        let prev_chars = self.normal_ui_cache.chars[row_idx];
        let prev_fg_raw = self.normal_ui_cache.fg_raw[row_idx];

        let mut next_chars = [0_u8; 13];
        let mut next_fg_raw = [0_u16; 13];

        next_chars[0..6].copy_from_slice(left_s);
        next_chars[6] = b' ';
        next_chars[7..13].copy_from_slice(right_s);

        next_fg_raw[0..6].fill(left_fg_raw);
        next_fg_raw[6] = UI_BG_RAW;
        next_fg_raw[7..13].fill(right_fg_raw);

        for tile_x in 0..13usize {
            let ch = next_chars[tile_x];
            let fg_raw = next_fg_raw[tile_x];
            if prev_chars[tile_x] != ch || prev_fg_raw[tile_x] != fg_raw {
                self.draw_tile_colored(tile_x as u16, row, ch, rgb565(fg_raw))?;
            }
        }

        self.normal_ui_cache.chars[row_idx] = next_chars;
        self.normal_ui_cache.fg_raw[row_idx] = next_fg_raw;
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
            self.draw_tile_str(9, row, next_i)?;
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
        self.draw_tile_colored(tile_x, tile_y, ch, FG)
    }

    fn draw_tile_colored(
        &mut self,
        tile_x: u16,
        tile_y: u16,
        ch: u8,
        fg: Rgb565,
    ) -> Result<(), GcError<E>> {
        let x = X_OFFSET + tile_x * TILE_W;
        let y = Y_OFFSET + tile_y * TILE_H;

        let mut data = [0_u8; (TILE_W as usize * TILE_H as usize) / 8];
        render_char_6x8_scaled(ch, &mut data);
        self.display.write_area(x, y, TILE_W, &data, fg, BG)?;
        Ok(())
    }
}

fn rgb565(raw: u16) -> Rgb565 {
    // `Rgb565` is a newtype around a raw 16-bit value. Keep the spec constants exact.
    Rgb565::from(RawU16::new(raw))
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

fn format_normal_ui_cell(
    present: bool,
    value: NormalUiField,
    unit: u8,
    ok_color_raw: u16,
) -> ([u8; 6], u16) {
    if !present {
        return (
            [b'-', b'-', b'.', b'-', b'-', unit],
            UI_STATUS_NOT_PRESENT_RAW,
        );
    }

    match value {
        NormalUiField::Err => (*b"ERROR ", UI_STATUS_ERROR_RAW),
        NormalUiField::Ok(micros) => match format_ok_value_6(micros, unit) {
            Ok(s) => (s, ok_color_raw),
            Err(OkValueError::Over) => (*b"OVER  ", UI_STATUS_OVER_RAW),
        },
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OkValueError {
    Over,
}

fn format_ok_value_6(micros: u32, unit: u8) -> Result<[u8; 6], OkValueError> {
    // Try 3 decimals: D.ddd
    let milli = (micros + 500) / 1_000; // value * 1_000, half-up
    if milli < 10_000 {
        let int = milli / 1_000; // 0..=9
        let frac = milli % 1_000;
        return Ok([
            b'0' + int as u8,
            b'.',
            b'0' + (frac / 100) as u8,
            b'0' + ((frac / 10) % 10) as u8,
            b'0' + (frac % 10) as u8,
            unit,
        ]);
    }

    // Try 2 decimals: DD.dd
    let centi = (micros + 5_000) / 10_000; // value * 100, half-up
    if centi < 10_000 {
        let int = centi / 100; // 0..=99 (expected 10..=99)
        let frac = centi % 100;
        return Ok([
            b'0' + (int / 10) as u8,
            b'0' + (int % 10) as u8,
            b'.',
            b'0' + (frac / 10) as u8,
            b'0' + (frac % 10) as u8,
            unit,
        ]);
    }

    // Try 1 decimal: DDD.d
    let deci = (micros + 50_000) / 100_000; // value * 10, half-up
    if deci < 10_000 {
        let int = deci / 10; // 0..=999 (expected 100..=999)
        let frac = deci % 10;
        return Ok([
            b'0' + (int / 100) as u8,
            b'0' + ((int / 10) % 10) as u8,
            b'0' + (int % 10) as u8,
            b'.',
            b'0' + frac as u8,
            unit,
        ]);
    }

    Err(OkValueError::Over)
}

fn render_char_6x8_scaled(ch: u8, out: &mut [u8; 144]) {
    out.fill(0);

    let glyph = glyph_6x8(ch);

    for (src_y, &row_bits) in glyph.iter().enumerate() {
        for rep_y in 0..GLYPH_SY {
            let y = GLYPH_Y0 + src_y as u16 * GLYPH_SY + rep_y;
            for src_x in 0..6u16 {
                let on = row_bits & (1 << (5 - src_x)) != 0;
                if !on {
                    continue;
                }
                for rep_x in 0..GLYPH_SX {
                    let x = GLYPH_X0 + src_x * GLYPH_SX + rep_x;
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
        b'V' => [
            0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b011110, 0b001100, 0,
        ],
        b'W' => [
            0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b110111, 0b011110, 0,
        ],
        b'O' => [
            0b011110, 0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b011110, 0,
        ],

        b'?' => [
            0b011110, 0b110011, 0b000011, 0b000110, 0b001100, 0, 0b001100, 0,
        ],
        _ => glyph_6x8(b'?'),
    }
}
