use super::*;

const DASHBOARD_BG_RAW: u16 = rgb565_raw(0xF8, 0xFB, 0xFD);
const WHITE_RAW: u16 = rgb565_raw(0xFF, 0xFF, 0xFF);
const AQUA_RAW: u16 = rgb565_raw(0x4B, 0xA6, 0xC3);
const BERRY_RAW: u16 = rgb565_raw(0xB9, 0x49, 0x5A);
const INK_RAW: u16 = rgb565_raw(0x21, 0x44, 0x57);
const INK_SOFT_RAW: u16 = rgb565_raw(0x6E, 0x84, 0x91);
const BORDER_RAW: u16 = rgb565_raw(0xD6, 0xE5, 0xED);

const DASHBOARD_CHUNK_PIXELS: usize = 2048;
const GLYPH_THRESHOLD: u8 = 92;
const CARD_RADIUS: u16 = 14;
const CHIP_PAD_X: i32 = 8;
const CHIP_PAD_Y: i32 = 5;
const MAX_CHIP_W: usize = 96;
const MAX_CHIP_H: usize = 40;

struct PortTheme {
    accent: u16,
    card_fill: u16,
    title_fill: u16,
    title_border: u16,
    title_text: u16,
    meta_fill: u16,
    meta_text: u16,
    divider: u16,
    main_text: u16,
    secondary_text: u16,
    power_text: u16,
}

impl PortTheme {
    fn new(accent: u16) -> Self {
        Self {
            accent,
            card_fill: blend565(WHITE_RAW, accent, 10),
            title_fill: blend565(WHITE_RAW, accent, 74),
            title_border: blend565(WHITE_RAW, accent, 132),
            title_text: blend565(accent, INK_RAW, 24),
            meta_fill: blend565(accent, INK_RAW, 64),
            meta_text: WHITE_RAW,
            divider: BORDER_RAW,
            main_text: INK_RAW,
            secondary_text: INK_SOFT_RAW,
            power_text: accent,
        }
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
    pub(super) fn render_dashboard_ui(
        &mut self,
        snapshot: &NormalUiSnapshot,
    ) -> Result<(), GcError<E>> {
        self.display.fill_color(rgb565(DASHBOARD_BG_RAW))?;
        self.active_view = ActiveView::NormalUi;
        self.toast_until = None;

        self.draw_dashboard_port(6, 6, 150, 160, snapshot.usb_a, PortTheme::new(AQUA_RAW))?;
        self.draw_dashboard_port(164, 6, 150, 160, snapshot.usb_c, PortTheme::new(BERRY_RAW))?;

        Ok(())
    }

    fn draw_dashboard_port(
        &mut self,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
        port: NormalUiPort,
        theme: PortTheme,
    ) -> Result<(), GcError<E>> {
        self.fill_round_rect(x, y, w, h, CARD_RADIUS, theme.card_fill, DASHBOARD_BG_RAW)?;

        let title = port_mode_text(port.mode);
        let mut badge_buf = [b' '; 5];
        let badge_len = format_badge_text(port, &mut badge_buf);
        let badge = core::str::from_utf8(&badge_buf[..badge_len]).unwrap_or("OFF");

        let chip_font = &dashboard_font::SMALL;
        let value_font = &dashboard_font::LARGE;
        let secondary_font = &dashboard_font::MEDIUM;

        self.draw_chip(
            x as i32 + 10,
            y as i32 + 10,
            chip_font,
            0,
            CHIP_PAD_X,
            CHIP_PAD_Y,
            title,
            theme.title_fill,
            theme.title_text,
            theme.title_border,
            theme.card_fill,
        )?;

        let badge_w = measure_text_aa(chip_font, 0, badge) + CHIP_PAD_X * 2;
        let badge_h = chip_font.line_h as i32 + CHIP_PAD_Y * 2;
        let badge_x = x as i32 + w as i32 - badge_w - 10;
        let badge_y = y as i32 + 10;
        self.fill_round_rect(
            badge_x as u16,
            badge_y as u16,
            badge_w as u16,
            badge_h as u16,
            (badge_h / 2) as u16,
            theme.meta_fill,
            theme.card_fill,
        )?;
        self.draw_text_centered_aa(
            badge_x,
            badge_y,
            badge_w,
            badge_h,
            chip_font,
            0,
            badge,
            theme.meta_text,
            theme.meta_fill,
        )?;

        let (voltage, voltage_color) =
            format_dashboard_value(port.present, port.voltage_uv, b'V', theme.main_text);
        let (current, current_color) =
            format_dashboard_value(port.present, port.current_ua, b'A', theme.secondary_text);
        let (power, power_color) =
            format_dashboard_value(port.present, port.power_uw, b'W', theme.power_text);

        let voltage_text = core::str::from_utf8(&voltage).unwrap_or("ERR");
        let current_text = core::str::from_utf8(&current).unwrap_or("ERR");
        let power_text = core::str::from_utf8(&power).unwrap_or("ERR");

        self.draw_text_aa(
            x as i32 + 12,
            y as i32 + 34,
            value_font,
            0,
            voltage_text,
            voltage_color,
            theme.card_fill,
        )?;
        self.fill_rect(x + 12, y + 86, w - 24, 2, theme.divider)?;
        self.draw_text_aa(
            x as i32 + 12,
            y as i32 + 88,
            secondary_font,
            0,
            current_text,
            current_color,
            theme.card_fill,
        )?;
        self.fill_rect(x + 12, y + 123, w - 24, 2, theme.divider)?;
        self.draw_text_aa(
            x as i32 + 12,
            y as i32 + 125,
            secondary_font,
            0,
            power_text,
            power_color,
            theme.card_fill,
        )?;

        Ok(())
    }

    fn draw_chip(
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
        bg: u16,
    ) -> Result<(), GcError<E>> {
        let w = measure_text_aa(font, spacing, text) + pad_x * 2;
        let h = font.line_h as i32 + pad_y * 2;
        debug_assert!(w as usize <= MAX_CHIP_W && h as usize <= MAX_CHIP_H);

        let radius = h / 2;
        let inner_w = (w - 2).max(0);
        let inner_h = (h - 2).max(0);
        let inner_radius = (inner_h / 2).max(0);
        let text_w = measure_text_aa(font, spacing, text);
        let text_h = font.line_h as i32;
        let text_x0 = (w - text_w) / 2;
        let text_y0 = (h - text_h) / 2;

        let mut pixels = [bg; MAX_CHIP_W * MAX_CHIP_H];
        for py in 0..h {
            for px in 0..w {
                let idx = py as usize * w as usize + px as usize;
                let mut color = bg;
                if point_in_round_rect(px, py, w, h, radius) {
                    color = border;
                    if inner_w > 0
                        && inner_h > 0
                        && px >= 1
                        && py >= 1
                        && point_in_round_rect(px - 1, py - 1, inner_w, inner_h, inner_radius)
                    {
                        color = fill;
                    }
                }
                pixels[idx] = color;
            }
        }

        let mut cursor_x = text_x0;
        for ch in text.bytes() {
            let glyph = dashboard_font::lookup_glyph(font, ch);
            for gy in 0..glyph.height as i32 {
                for gx in 0..glyph.width as i32 {
                    let alpha = glyph.alpha[gy as usize * glyph.width as usize + gx as usize];
                    if alpha < GLYPH_THRESHOLD {
                        continue;
                    }
                    let px = cursor_x + gx;
                    let py = text_y0 + glyph.y_offset as i32 + gy;
                    if px < 0 || py < 0 || px >= w || py >= h {
                        continue;
                    }
                    let idx = py as usize * w as usize + px as usize;
                    pixels[idx] = blend565(pixels[idx], text_color, alpha);
                }
            }
            cursor_x += glyph.advance as i32 + spacing;
        }

        self.display.write_rgb565_rect(
            x as u16,
            y as u16,
            w as u16,
            h as u16,
            &pixels[..w as usize * h as usize],
        )
    }

    fn draw_text_centered_aa(
        &mut self,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        font: &'static dashboard_font::AaFont,
        spacing: i32,
        text: &str,
        color: u16,
        bg: u16,
    ) -> Result<(), GcError<E>> {
        let text_w = measure_text_aa(font, spacing, text);
        let text_h = font.line_h as i32;
        self.draw_text_aa(
            x + (w - text_w) / 2,
            y + (h - text_h) / 2,
            font,
            spacing,
            text,
            color,
            bg,
        )
    }

    fn draw_text_aa(
        &mut self,
        x: i32,
        y: i32,
        font: &'static dashboard_font::AaFont,
        spacing: i32,
        text: &str,
        color: u16,
        bg: u16,
    ) -> Result<(), GcError<E>> {
        let text_w = measure_text_aa(font, spacing, text);
        let text_h = font.line_h as i32;
        if text_w <= 0 || text_h <= 0 {
            return Ok(());
        }

        let mut placements = [GlyphPlacement::EMPTY; 8];
        let mut placement_count = 0usize;
        let mut cursor_x = 0i32;
        for ch in text.bytes() {
            if placement_count >= placements.len() {
                break;
            }
            let glyph = dashboard_font::lookup_glyph(font, ch);
            placements[placement_count] = GlyphPlacement { x: cursor_x, glyph };
            placement_count += 1;
            cursor_x += glyph.advance as i32 + spacing;
        }

        self.write_generated_patch(
            x as u16,
            y as u16,
            text_w as u16,
            text_h as u16,
            |px, py| {
                let mut out = bg;
                for placement in placements.iter().take(placement_count) {
                    let glyph = placement.glyph;
                    let gx = px - placement.x;
                    let gy = py - glyph.y_offset as i32;
                    if gx < 0 || gy < 0 || gx >= glyph.width as i32 || gy >= glyph.height as i32 {
                        continue;
                    }
                    let alpha = glyph.alpha[gy as usize * glyph.width as usize + gx as usize];
                    if alpha >= GLYPH_THRESHOLD {
                        out = blend565(bg, color, alpha);
                    }
                    break;
                }
                out
            },
        )
    }

    fn fill_round_rect(
        &mut self,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
        radius: u16,
        color: u16,
        bg: u16,
    ) -> Result<(), GcError<E>> {
        self.write_generated_patch(x, y, w, h, |px, py| {
            if point_in_round_rect(px, py, w as i32, h as i32, radius as i32) {
                color
            } else {
                bg
            }
        })
    }

    fn fill_rect(&mut self, x: u16, y: u16, w: u16, h: u16, color: u16) -> Result<(), GcError<E>> {
        self.write_generated_patch(x, y, w, h, |_px, _py| color)
    }

    fn write_generated_patch<F>(
        &mut self,
        x: u16,
        y: u16,
        w: u16,
        h: u16,
        mut color_at: F,
    ) -> Result<(), GcError<E>>
    where
        F: FnMut(i32, i32) -> u16,
    {
        if w == 0 || h == 0 {
            return Ok(());
        }

        let mut scratch = [0u16; DASHBOARD_CHUNK_PIXELS];
        let rows_per_chunk = core::cmp::max(1usize, DASHBOARD_CHUNK_PIXELS / w as usize);
        let mut row = 0u16;

        while row < h {
            let chunk_h = core::cmp::min(rows_per_chunk as u16, h - row);
            let chunk_pixels = w as usize * chunk_h as usize;
            for cy in 0..chunk_h as usize {
                for cx in 0..w as usize {
                    scratch[cy * w as usize + cx] = color_at(cx as i32, row as i32 + cy as i32);
                }
            }
            self.display
                .write_rgb565_rect(x, y + row, w, chunk_h, &scratch[..chunk_pixels])?;
            row += chunk_h;
        }

        Ok(())
    }
}

#[derive(Clone, Copy)]
struct GlyphPlacement {
    x: i32,
    glyph: &'static dashboard_font::AaGlyph,
}

impl GlyphPlacement {
    const EMPTY: Self = Self {
        x: 0,
        glyph: &dashboard_font::SMALL.glyphs[0],
    };
}

const fn rgb565_raw(r: u8, g: u8, b: u8) -> u16 {
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

fn blend565(base: u16, over: u16, alpha: u8) -> u16 {
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

fn point_in_round_rect(px: i32, py: i32, w: i32, h: i32, r: i32) -> bool {
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

fn measure_text_aa(font: &'static dashboard_font::AaFont, spacing: i32, text: &str) -> i32 {
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

fn port_mode_text(mode: NormalUiPortMode) -> &'static str {
    match mode {
        NormalUiPortMode::UsbA => "USB-A",
        NormalUiPortMode::Pd => "PD",
        NormalUiPortMode::Pps => "PPS",
        NormalUiPortMode::Dc => "DC",
        NormalUiPortMode::Off => "OFF",
    }
}

fn format_badge_text(port: NormalUiPort, out: &mut [u8; 5]) -> usize {
    if let Some(mv) = port.badge_mv {
        return format_badge_mv(mv, out);
    }

    let fallback = match port.mode {
        NormalUiPortMode::Off => *b"OFF",
        _ => *b"---",
    };
    out[..fallback.len()].copy_from_slice(&fallback);
    fallback.len()
}

fn format_badge_mv(mv: u16, out: &mut [u8; 5]) -> usize {
    let rounded = ((mv as u32) + 500) / 1_000;
    if rounded >= 100 {
        out[..4].copy_from_slice(b"99V+");
        return 4;
    }
    if rounded >= 10 {
        out[0] = b'0' + (rounded / 10) as u8;
        out[1] = b'0' + (rounded % 10) as u8;
        out[2] = b'V';
        return 3;
    }
    out[0] = b'0' + rounded as u8;
    out[1] = b'V';
    2
}

fn format_dashboard_value(
    present: bool,
    value: NormalUiField,
    unit: u8,
    ok_color: u16,
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
            Ok(text) => (text, ok_color),
            Err(OkValueError::Over) => (*b"OVER  ", UI_STATUS_OVER_RAW),
        },
    }
}
