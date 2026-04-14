#![allow(clippy::identity_op)]

mod dashboard;
mod dashboard_font;
mod font6x8;

use allocator_api2::vec::Vec;
use core::convert::Infallible;
use core::future::{Future, ready};
use core::mem;

use embedded_graphics_core::pixelcolor::Rgb565;
use embedded_graphics_core::pixelcolor::RgbColor;
use embedded_hal::digital::OutputPin;
use embedded_hal_async::spi::SpiDevice;
use esp_alloc::ExternalMemory;
use esp_hal::time::{Duration, Instant};
use gc9307_async::{Config, Error as GcError, GC9307C, Orientation, Timer};

use crate::telemetry::{Field, TelemetrySnapshot};

pub const WORKBUF_SIZE: usize = gc9307_async::BUF_SIZE;
pub const DISPLAY_WIDTH: u16 = 320;
pub const DISPLAY_HEIGHT: u16 = 172;
const FRAME_PIXELS: usize = DISPLAY_WIDTH as usize * DISPLAY_HEIGHT as usize;

const TILE_W: u16 = 24;
const TILE_H: u16 = 48;
const TILES_X: u16 = 13;

const X_OFFSET: u16 = (DISPLAY_WIDTH - TILE_W * TILES_X) / 2;
const Y_OFFSET: u16 = (DISPLAY_HEIGHT - TILE_H * 3) / 2;

// Smaller font + spacing: render 6x8 glyph centered into a 24x48 tile.
const GLYPH_SX: u16 = 3;
const GLYPH_SY: u16 = 4;

// Compact toast: 3 rows × 20 columns (small font so IPv4 fits in one line).
const TOAST_COMPACT_TILE_W: u16 = 16;
const TOAST_COMPACT_TILE_H: u16 = 32;
const TOAST_COMPACT_TILES_X: u16 = 20;
const TOAST_COMPACT_X_OFFSET: u16 =
    (DISPLAY_WIDTH - TOAST_COMPACT_TILE_W * TOAST_COMPACT_TILES_X) / 2;
const TOAST_COMPACT_Y_OFFSET: u16 = (DISPLAY_HEIGHT - TOAST_COMPACT_TILE_H * 3) / 2;

const TOAST_COMPACT_GLYPH_SX: u16 = 2;
const TOAST_COMPACT_GLYPH_SY: u16 = 3;

const FRAME_FG: Rgb565 = Rgb565::BLACK;
const FRAME_BG: Rgb565 = Rgb565::WHITE;
const UI_BG_RAW: u16 = 0xFFFF;
const UI_STATUS_NOT_PRESENT_RAW: u16 = 0x4AAC;
const UI_STATUS_ERROR_RAW: u16 = 0x98C3;
const UI_STATUS_OVER_RAW: u16 = 0xC201;

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
pub enum NormalUiPortMode {
    UsbA,
    Pd,
    Pps,
    Dc,
    Off,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NormalUiPort {
    pub present: bool,
    pub mode: NormalUiPortMode,
    pub badge_mv: Option<u16>,
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
    Toast,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FlushStrategy {
    Full,
    DirtyBands,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DisplayUiAllocError;

pub(super) struct FrameSurface<'a> {
    pixels: &'a mut [u16],
}

impl<'a> FrameSurface<'a> {
    fn new(pixels: &'a mut [u16]) -> Self {
        debug_assert_eq!(pixels.len(), FRAME_PIXELS);
        Self { pixels }
    }

    pub(super) fn fill(&mut self, color: u16) {
        self.pixels.fill(color);
    }

    pub(super) fn fill_rect(&mut self, x: i32, y: i32, w: i32, h: i32, color: u16) {
        if w <= 0 || h <= 0 {
            return;
        }
        for py in y.max(0)..(y + h).min(DISPLAY_HEIGHT as i32) {
            let row = py as usize * DISPLAY_WIDTH as usize;
            for px in x.max(0)..(x + w).min(DISPLAY_WIDTH as i32) {
                self.pixels[row + px as usize] = color;
            }
        }
    }

    pub(super) fn fill_round_rect(
        &mut self,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        radius: i32,
        color: u16,
    ) {
        if w <= 0 || h <= 0 {
            return;
        }
        for py in 0..h {
            for px in 0..w {
                if point_in_round_rect(px, py, w, h, radius) {
                    self.set(x + px, y + py, color);
                }
            }
        }
    }

    pub(super) fn draw_text_aa(
        &mut self,
        x: i32,
        y: i32,
        font: &'static dashboard_font::AaFont,
        spacing: i32,
        text: &str,
        color: u16,
    ) {
        let mut cursor_x = x;
        for ch in text.bytes() {
            let glyph = dashboard_font::lookup_glyph(font, ch);
            self.draw_alpha_glyph(cursor_x, y, glyph, color);
            cursor_x += glyph.advance as i32 + spacing;
        }
    }

    pub(super) fn draw_text_centered_aa(
        &mut self,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        font: &'static dashboard_font::AaFont,
        spacing: i32,
        text: &str,
        color: u16,
    ) {
        let text_w = measure_text_aa(font, spacing, text);
        let text_h = font.line_h as i32;
        self.draw_text_aa(
            x + (w - text_w) / 2,
            y + (h - text_h) / 2,
            font,
            spacing,
            text,
            color,
        );
    }

    pub(super) fn draw_chip(
        &mut self,
        x: i32,
        y: i32,
        font: &'static dashboard_font::AaFont,
        spacing: i32,
        pad_x: i32,
        pad_y: i32,
        text: &str,
        fill: u16,
        text_color: u16,
        border: u16,
    ) {
        let w = measure_text_aa(font, spacing, text) + pad_x * 2;
        let h = font.line_h as i32 + pad_y * 2;
        self.fill_round_rect(x, y, w, h, h / 2, border);
        if w > 2 && h > 2 {
            self.fill_round_rect(x + 1, y + 1, w - 2, h - 2, (h - 2) / 2, fill);
        }
        self.draw_text_centered_aa(x, y, w, h, font, spacing, text, text_color);
    }

    fn draw_alpha_glyph(&mut self, x: i32, y: i32, glyph: &dashboard_font::AaGlyph, color: u16) {
        let width = glyph.width as usize;
        for gy in 0..glyph.height as usize {
            let row = gy * width;
            for gx in 0..width {
                let alpha = glyph.alpha[row + gx];
                if alpha == 0 {
                    continue;
                }
                self.blend(
                    x + gx as i32,
                    y + glyph.y_offset as i32 + gy as i32,
                    color,
                    alpha,
                );
            }
        }
    }

    fn write_bitmap_area(
        &mut self,
        x: i32,
        y: i32,
        width: u16,
        height: u16,
        data: &[u8],
        fg_raw: u16,
        bg_raw: u16,
    ) {
        for py in 0..height as usize {
            for px in 0..width as usize {
                let bit_index = py * width as usize + px;
                let byte = data[bit_index / 8];
                let mask = 1 << (7 - (bit_index % 8));
                let color = if byte & mask != 0 { fg_raw } else { bg_raw };
                self.set(x + px as i32, y + py as i32, color);
            }
        }
    }

    fn draw_tile_colored_with_bg(
        &mut self,
        tile_x: u16,
        tile_y: u16,
        ch: u8,
        fg_raw: u16,
        bg_raw: u16,
    ) {
        let x = X_OFFSET + tile_x * TILE_W;
        let y = Y_OFFSET + tile_y * TILE_H;

        let mut data = [0_u8; (TILE_W as usize * TILE_H as usize) / 8];
        render_char_6x8_scaled(ch, &mut data);
        self.write_bitmap_area(x as i32, y as i32, TILE_W, TILE_H, &data, fg_raw, bg_raw);
    }

    fn draw_compact_tile_colored(
        &mut self,
        tile_x: u16,
        tile_y: u16,
        ch: u8,
        fg_raw: u16,
        bg_raw: u16,
    ) {
        let x = TOAST_COMPACT_X_OFFSET + tile_x * TOAST_COMPACT_TILE_W;
        let y = TOAST_COMPACT_Y_OFFSET + tile_y * TOAST_COMPACT_TILE_H;

        let mut data = [0_u8; (TOAST_COMPACT_TILE_W as usize * TOAST_COMPACT_TILE_H as usize) / 8];
        render_char_6x8_scaled_custom(
            ch,
            &mut data,
            TOAST_COMPACT_TILE_W,
            TOAST_COMPACT_TILE_H,
            TOAST_COMPACT_GLYPH_SX,
            TOAST_COMPACT_GLYPH_SY,
        );
        self.write_bitmap_area(
            x as i32,
            y as i32,
            TOAST_COMPACT_TILE_W,
            TOAST_COMPACT_TILE_H,
            &data,
            fg_raw,
            bg_raw,
        );
    }

    fn set(&mut self, x: i32, y: i32, color: u16) {
        if x < 0 || y < 0 || x >= DISPLAY_WIDTH as i32 || y >= DISPLAY_HEIGHT as i32 {
            return;
        }
        self.pixels[y as usize * DISPLAY_WIDTH as usize + x as usize] = color;
    }

    fn blend(&mut self, x: i32, y: i32, color: u16, alpha: u8) {
        if x < 0 || y < 0 || x >= DISPLAY_WIDTH as i32 || y >= DISPLAY_HEIGHT as i32 {
            return;
        }
        let idx = y as usize * DISPLAY_WIDTH as usize + x as usize;
        self.pixels[idx] = blend565(self.pixels[idx], color, alpha);
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
    toast_until: Option<Instant>,
    front: Vec<u16, ExternalMemory>,
    back: Vec<u16, ExternalMemory>,
    dashboard_base: Vec<u16, ExternalMemory>,
    dashboard_base_ready: bool,
    front_valid: bool,
}

impl<'b, SPI, DC, RST, TimerImpl, BL> DisplayUi<'b, SPI, DC, RST, TimerImpl, BL>
where
    SPI: SpiDevice,
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
    ) -> Result<Self, DisplayUiAllocError> {
        let mut config = Config::default();
        config.orientation = Orientation::Landscape;
        config.width = DISPLAY_WIDTH;
        config.height = DISPLAY_HEIGHT;

        Ok(Self {
            display: GC9307C::new(config, spi, dc, rst, &mut workbuf[..]),
            backlight,
            active_view: ActiveView::TelemetryFrame,
            cache: FrameCache::empty(),
            toast_until: None,
            front: alloc_psram_frame(UI_BG_RAW)?,
            back: alloc_psram_frame(UI_BG_RAW)?,
            dashboard_base: alloc_psram_frame(0)?,
            dashboard_base_ready: false,
            front_valid: false,
        })
    }
}

impl<'b, SPI, DC, RST, E, TimerImpl, BL> DisplayUi<'b, SPI, DC, RST, TimerImpl, BL>
where
    SPI: SpiDevice<Error = E>,
    DC: OutputPin<Error = Infallible>,
    RST: OutputPin<Error = Infallible>,
    TimerImpl: Timer,
    BL: BacklightControl,
{
    pub async fn init(&mut self) -> Result<(), GcError<E>> {
        self.display.init().await?;
        self.backlight.on();
        Ok(())
    }

    pub async fn draw_frame(&mut self) -> Result<(), GcError<E>> {
        self.active_view = ActiveView::TelemetryFrame;
        self.toast_until = None;
        self.front_valid = false;
        self.display.fill_color(FRAME_BG).await?;

        self.draw_tile_str(0, 0, b"U17").await?;
        self.draw_tile_str(0, 1, b"U14").await?;
        self.draw_tile_str(0, 2, b"SET").await?;

        Ok(())
    }

    pub fn toast_active(&self, now: Instant) -> bool {
        self.toast_until.is_some_and(|until| now < until)
    }

    pub fn clear_toast(&mut self) {
        self.toast_until = None;
    }

    /// Render a 3×13 character toast screen (pixel-perfect tile grid).
    pub async fn show_toast(
        &mut self,
        now: Instant,
        lines: &[[u8; 13]; 3],
        fg_raw: u16,
        duration: Duration,
    ) -> Result<(), GcError<E>> {
        self.active_view = ActiveView::Toast;
        self.toast_until = Some(now + duration);

        {
            let mut surface = FrameSurface::new(self.back.as_mut_slice());
            surface.fill(UI_BG_RAW);
            for (tile_y, row) in lines.iter().enumerate() {
                for (tile_x, &ch) in row.iter().enumerate() {
                    surface.draw_tile_colored_with_bg(
                        tile_x as u16,
                        tile_y as u16,
                        ch,
                        fg_raw,
                        UI_BG_RAW,
                    );
                }
            }
        }

        self.present_back(FlushStrategy::Full).await
    }

    /// Render a 3×20 character toast screen (compact font for longer strings).
    pub async fn show_toast_compact(
        &mut self,
        now: Instant,
        lines: &[[u8; 20]; 3],
        fg_raw: u16,
        duration: Duration,
    ) -> Result<(), GcError<E>> {
        self.active_view = ActiveView::Toast;
        self.toast_until = Some(now + duration);

        {
            let mut surface = FrameSurface::new(self.back.as_mut_slice());
            surface.fill(UI_BG_RAW);
            for (tile_y, row) in lines.iter().enumerate() {
                for (tile_x, &ch) in row.iter().enumerate() {
                    surface.draw_compact_tile_colored(
                        tile_x as u16,
                        tile_y as u16,
                        ch,
                        fg_raw,
                        UI_BG_RAW,
                    );
                }
            }
        }

        self.present_back(FlushStrategy::Full).await
    }

    pub async fn render_snapshot(
        &mut self,
        snapshot: &TelemetrySnapshot,
    ) -> Result<(), GcError<E>> {
        self.active_view = ActiveView::TelemetryFrame;
        self.toast_until = None;
        self.front_valid = false;
        let prev = self.cache;
        let mut next = self.cache;

        next.u17_v = format_mv_2dp_5(snapshot.u17_meas.voltage_mv);
        next.u17_i = format_ma_2dp_4(snapshot.u17_meas.current_ma);

        next.u14_v = format_mv_2dp_5(snapshot.u14_meas.voltage_mv);
        next.u14_i = format_ma_2dp_4(snapshot.u14_meas.current_ma);

        next.set_v = format_mv_2dp_5(snapshot.set_applied.voltage_mv);
        next.set_i = format_ma_2dp_4(snapshot.set_applied.current_limit_ma);

        self.draw_values_row(0, &next.u17_v, &next.u17_i, &prev.u17_v, &prev.u17_i)
            .await?;
        self.draw_values_row(1, &next.u14_v, &next.u14_i, &prev.u14_v, &prev.u14_i)
            .await?;
        self.draw_values_row(2, &next.set_v, &next.set_i, &prev.set_v, &prev.set_i)
            .await?;

        self.cache = next;
        Ok(())
    }

    pub async fn render_normal_ui(
        &mut self,
        snapshot: &NormalUiSnapshot,
    ) -> Result<(), GcError<E>> {
        let strategy = if self.front_valid && self.active_view == ActiveView::NormalUi {
            FlushStrategy::DirtyBands
        } else {
            FlushStrategy::Full
        };

        self.ensure_dashboard_base();
        self.back
            .as_mut_slice()
            .copy_from_slice(self.dashboard_base.as_slice());
        {
            let mut surface = FrameSurface::new(self.back.as_mut_slice());
            dashboard::render_dashboard_dynamic(&mut surface, snapshot);
        }

        self.toast_until = None;
        self.present_back(strategy).await?;
        self.active_view = ActiveView::NormalUi;
        Ok(())
    }

    fn ensure_dashboard_base(&mut self) {
        if self.dashboard_base_ready {
            return;
        }

        let mut surface = FrameSurface::new(self.dashboard_base.as_mut_slice());
        dashboard::render_dashboard_base(&mut surface);
        self.dashboard_base_ready = true;
    }

    async fn present_back(&mut self, strategy: FlushStrategy) -> Result<(), GcError<E>> {
        match strategy {
            FlushStrategy::Full => {
                self.display
                    .write_rgb565_rect(0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, self.back.as_slice())
                    .await?;
            }
            FlushStrategy::DirtyBands => {
                let width = DISPLAY_WIDTH as usize;
                let mut row = 0usize;
                while row < DISPLAY_HEIGHT as usize {
                    let start = row * width;
                    let end = start + width;
                    if self.front.as_slice()[start..end] == self.back.as_slice()[start..end] {
                        row += 1;
                        continue;
                    }

                    let band_start = row;
                    row += 1;
                    while row < DISPLAY_HEIGHT as usize {
                        let start = row * width;
                        let end = start + width;
                        if self.front.as_slice()[start..end] == self.back.as_slice()[start..end] {
                            break;
                        }
                        row += 1;
                    }

                    let band_end = row;
                    let slice_start = band_start * width;
                    let slice_end = band_end * width;
                    self.display
                        .write_rgb565_rect(
                            0,
                            band_start as u16,
                            DISPLAY_WIDTH,
                            (band_end - band_start) as u16,
                            &self.back.as_slice()[slice_start..slice_end],
                        )
                        .await?;
                }
            }
        }

        mem::swap(&mut self.front, &mut self.back);
        self.front_valid = true;
        Ok(())
    }

    async fn draw_values_row(
        &mut self,
        row: u16,
        next_v: &[u8; 5],
        next_i: &[u8; 4],
        prev_v: &[u8; 5],
        prev_i: &[u8; 4],
    ) -> Result<(), GcError<E>> {
        if next_v != prev_v {
            self.draw_tile_str(3, row, next_v).await?;
        }
        if next_i != prev_i {
            self.draw_tile_str(9, row, next_i).await?;
        }
        Ok(())
    }

    async fn draw_tile_str(
        &mut self,
        tile_x: u16,
        tile_y: u16,
        s: &[u8],
    ) -> Result<(), GcError<E>> {
        for (i, &ch) in s.iter().enumerate() {
            self.draw_tile(tile_x + i as u16, tile_y, ch).await?;
        }
        Ok(())
    }

    async fn draw_tile(&mut self, tile_x: u16, tile_y: u16, ch: u8) -> Result<(), GcError<E>> {
        self.draw_tile_colored_with_bg(tile_x, tile_y, ch, FRAME_FG, FRAME_BG)
            .await
    }

    async fn draw_tile_colored_with_bg(
        &mut self,
        tile_x: u16,
        tile_y: u16,
        ch: u8,
        fg: Rgb565,
        bg: Rgb565,
    ) -> Result<(), GcError<E>> {
        let x = X_OFFSET + tile_x * TILE_W;
        let y = Y_OFFSET + tile_y * TILE_H;

        let mut data = [0_u8; (TILE_W as usize * TILE_H as usize) / 8];
        render_char_6x8_scaled(ch, &mut data);
        self.display.write_area(x, y, TILE_W, &data, fg, bg).await
    }
}

fn alloc_psram_frame(fill: u16) -> Result<Vec<u16, ExternalMemory>, DisplayUiAllocError> {
    let mut frame = Vec::new_in(ExternalMemory);
    frame
        .try_reserve_exact(FRAME_PIXELS)
        .map_err(|_| DisplayUiAllocError)?;
    frame.resize(FRAME_PIXELS, fill);
    Ok(frame)
}

fn format_mv_2dp_5(v: Field<u16>) -> [u8; 5] {
    match v {
        Field::Err => *b"ERR  ",
        Field::Ok(mv) => {
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OkValueError {
    Over,
}

fn format_ok_value_6(micros: u32, unit: u8) -> Result<[u8; 6], OkValueError> {
    let milli = (micros + 500) / 1_000;
    if milli < 10_000 {
        let int = milli / 1_000;
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

    let centi = (micros + 5_000) / 10_000;
    if centi < 10_000 {
        let int = centi / 100;
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

    let deci = (micros + 50_000) / 100_000;
    if deci < 10_000 {
        let int = deci / 10;
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
    font6x8::render_char_6x8_scaled_custom(ch, out, TILE_W, TILE_H, GLYPH_SX, GLYPH_SY);
}

fn render_char_6x8_scaled_custom(
    ch: u8,
    out: &mut [u8],
    tile_w: u16,
    tile_h: u16,
    glyph_sx: u16,
    glyph_sy: u16,
) {
    font6x8::render_char_6x8_scaled_custom(ch, out, tile_w, tile_h, glyph_sx, glyph_sy);
}

pub(super) const fn rgb565_raw(r: u8, g: u8, b: u8) -> u16 {
    (((r as u16) & 0xF8) << 8) | (((g as u16) & 0xFC) << 3) | ((b as u16) >> 3)
}

const fn expand_565(c: u16) -> (u8, u8, u8) {
    let r = ((c >> 11) & 0x1F) as u8;
    let g = ((c >> 5) & 0x3F) as u8;
    let b = (c & 0x1F) as u8;
    (
        (r << 3) | (r >> 2),
        (g << 2) | (g >> 4),
        (b << 3) | (b >> 2),
    )
}

pub(super) fn blend565(base: u16, over: u16, alpha: u8) -> u16 {
    let (br, bg, bb) = expand_565(base);
    let (or, og, ob) = expand_565(over);
    let a = alpha as u32;
    let inv = 255_u32 - a;
    rgb565_raw(
        ((br as u32 * inv + or as u32 * a) / 255) as u8,
        ((bg as u32 * inv + og as u32 * a) / 255) as u8,
        ((bb as u32 * inv + ob as u32 * a) / 255) as u8,
    )
}

pub(super) fn point_in_round_rect(px: i32, py: i32, w: i32, h: i32, r: i32) -> bool {
    let rr = r * r;
    let cx = if px < r {
        r
    } else if px >= w - r {
        w - r - 1
    } else {
        px
    };
    let cy = if py < r {
        r
    } else if py >= h - r {
        h - r - 1
    } else {
        py
    };
    let dx = px - cx;
    let dy = py - cy;
    dx * dx + dy * dy <= rr
}

pub(super) fn measure_text_aa(
    font: &'static dashboard_font::AaFont,
    spacing: i32,
    text: &str,
) -> i32 {
    let mut width = 0;
    for (idx, ch) in text.bytes().enumerate() {
        let glyph = dashboard_font::lookup_glyph(font, ch);
        width += glyph.advance as i32;
        if idx + 1 < text.len() {
            width += spacing;
        }
    }
    width
}
