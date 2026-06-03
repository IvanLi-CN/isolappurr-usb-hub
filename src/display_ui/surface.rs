use super::{
    DISPLAY_HEIGHT, DISPLAY_WIDTH, FRAME_PIXELS, TILE_H, TILE_W, TOAST_COMPACT_GLYPH_SX,
    TOAST_COMPACT_GLYPH_SY, TOAST_COMPACT_TILE_H, TOAST_COMPACT_TILE_W, TOAST_COMPACT_X_OFFSET,
    TOAST_COMPACT_Y_OFFSET, X_OFFSET, Y_OFFSET, dashboard_font, render_char_6x8_scaled,
    render_char_6x8_scaled_custom,
};

pub(crate) struct FrameSurface<'a> {
    pixels: &'a mut [u16],
}

impl<'a> FrameSurface<'a> {
    pub(super) fn new(pixels: &'a mut [u16]) -> Self {
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

    #[allow(clippy::too_many_arguments)]
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

    pub(super) fn draw_tile_colored_with_bg(
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

    pub(super) fn draw_compact_tile_colored(
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

pub(crate) const fn rgb565_raw(r: u8, g: u8, b: u8) -> u16 {
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

pub(crate) fn blend565(base: u16, over: u16, alpha: u8) -> u16 {
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

pub(crate) fn measure_text_aa(
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
