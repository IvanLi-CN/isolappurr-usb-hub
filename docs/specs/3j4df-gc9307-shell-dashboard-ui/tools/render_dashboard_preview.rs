use std::fs;
use std::path::PathBuf;

#[path = "../../../../src/display_ui/dashboard_font.rs"]
mod dashboard_font;

const WIDTH: usize = 320;
const HEIGHT: usize = 172;

const WHITE: u16 = rgb565(0xFF, 0xFF, 0xFF);
const AQUA: u16 = rgb565(0x4B, 0xA6, 0xC3);
const INK: u16 = rgb565(0x21, 0x44, 0x57);
const INK_SOFT: u16 = rgb565(0x6E, 0x84, 0x91);
const BERRY: u16 = rgb565(0xB9, 0x49, 0x5A);
const BORDER: u16 = rgb565(0xD6, 0xE5, 0xED);

const fn rgb565(r: u8, g: u8, b: u8) -> u16 {
    (((r as u16) & 0xF8) << 8) | (((g as u16) & 0xFC) << 3) | ((b as u16) >> 3)
}

#[derive(Clone)]
struct Canvas {
    pixels: Vec<u16>,
}

impl Canvas {
    fn new(fill: u16) -> Self {
        Self {
            pixels: vec![fill; WIDTH * HEIGHT],
        }
    }

    fn set(&mut self, x: i32, y: i32, color: u16) {
        if x < 0 || y < 0 || x >= WIDTH as i32 || y >= HEIGHT as i32 {
            return;
        }
        self.pixels[y as usize * WIDTH + x as usize] = color;
    }

    fn blend(&mut self, x: i32, y: i32, color: u16, alpha: u8) {
        if x < 0 || y < 0 || x >= WIDTH as i32 || y >= HEIGHT as i32 {
            return;
        }
        let idx = y as usize * WIDTH + x as usize;
        self.pixels[idx] = blend565(self.pixels[idx], color, alpha);
    }

    fn fill_round_rect(&mut self, x: i32, y: i32, w: i32, h: i32, r: i32, color: u16) {
        for yy in y..(y + h) {
            for xx in x..(x + w) {
                if point_in_round_rect(xx, yy, x, y, w, h, r) {
                    self.set(xx, yy, color);
                }
            }
        }
    }

    fn draw_hline(&mut self, x: i32, y: i32, w: i32, color: u16) {
        for xx in x..(x + w) {
            self.set(xx, y, color);
        }
    }

    fn draw_text_aa(
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

    fn write_rgb565_le(&self, path: &PathBuf) -> std::io::Result<()> {
        let mut out = Vec::with_capacity(self.pixels.len() * 2);
        for px in &self.pixels {
            out.extend_from_slice(&px.to_le_bytes());
        }
        fs::write(path, out)
    }
}

const fn measure_text_aa(font: &'static dashboard_font::AaFont, spacing: i32, text: &str) -> i32 {
    let bytes = text.as_bytes();
    let mut i = 0;
    let mut width = 0;
    while i < bytes.len() {
        let glyph = lookup_glyph_const(font, bytes[i]);
        width += glyph.advance as i32;
        if i + 1 < bytes.len() {
            width += spacing;
        }
        i += 1;
    }
    width
}

const fn point_in_round_rect(px: i32, py: i32, x: i32, y: i32, w: i32, h: i32, r: i32) -> bool {
    let rr = r * r;
    let cx = if px < x + r {
        x + r
    } else if px >= x + w - r {
        x + w - r - 1
    } else {
        px
    };
    let cy = if py < y + r {
        y + r
    } else if py >= y + h - r {
        y + h - r - 1
    } else {
        py
    };
    let dx = px - cx;
    let dy = py - cy;
    dx * dx + dy * dy <= rr
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
    rgb565(
        ((br as u32 * inv + or as u32 * a) / 255) as u8,
        ((bg as u32 * inv + og as u32 * a) / 255) as u8,
        ((bb as u32 * inv + ob as u32 * a) / 255) as u8,
    )
}

const fn lookup_glyph_const(
    font: &'static dashboard_font::AaFont,
    ch: u8,
) -> &'static dashboard_font::AaGlyph {
    let mut i = 0;
    while i < font.glyphs.len() {
        if font.glyphs[i].ch == ch {
            return &font.glyphs[i];
        }
        i += 1;
    }
    &font.glyphs[0]
}

fn draw_chip(
    canvas: &mut Canvas,
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
    canvas.fill_round_rect(x, y, w, h, h / 2, border);
    if w > 2 && h > 2 {
        canvas.fill_round_rect(x + 1, y + 1, w - 2, h - 2, (h - 2) / 2, fill);
    }
    canvas.draw_text_centered_aa(x, y, w, h, font, spacing, text, text_color);
}

fn draw_port(
    canvas: &mut Canvas,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    accent: u16,
    title: &str,
    meta: &str,
    voltage: &str,
    current: &str,
    power: &str,
) {
    canvas.fill_round_rect(x, y, w, h, 14, blend565(WHITE, accent, 10));
    canvas.fill_round_rect(x + 1, y + 1, w - 2, h - 2, 13, WHITE);

    const CHIP_SPACING: i32 = 0;
    const CHIP_PAD_X: i32 = 8;
    const CHIP_PAD_Y: i32 = 5;
    let chip_font = &dashboard_font::SMALL;
    let value_font = &dashboard_font::LARGE;
    let secondary_font = &dashboard_font::MEDIUM;
    let title_fill = blend565(WHITE, accent, 74);
    let title_border = blend565(WHITE, accent, 132);
    let meta_fill = blend565(accent, INK, 64);

    draw_chip(
        canvas,
        x + 10,
        y + 10,
        chip_font,
        CHIP_SPACING,
        CHIP_PAD_X,
        CHIP_PAD_Y,
        title,
        title_fill,
        blend565(accent, INK, 24),
        title_border,
    );
    let meta_w = measure_text_aa(chip_font, CHIP_SPACING, meta) + CHIP_PAD_X * 2;
    let meta_h = chip_font.line_h as i32 + CHIP_PAD_Y * 2;
    canvas.fill_round_rect(
        x + w - meta_w - 10,
        y + 10,
        meta_w,
        meta_h,
        meta_h / 2,
        meta_fill,
    );
    canvas.draw_text_centered_aa(
        x + w - meta_w - 10,
        y + 10,
        meta_w,
        meta_h,
        chip_font,
        CHIP_SPACING,
        meta,
        WHITE,
    );

    canvas.draw_text_aa(x + 12, y + 38, value_font, 0, voltage, INK);
    canvas.draw_hline(x + 12, y + 86, w - 24, BORDER);
    canvas.draw_text_aa(x + 12, y + 92, secondary_font, 0, current, INK_SOFT);
    canvas.draw_hline(x + 12, y + 123, w - 24, BORDER);
    canvas.draw_text_aa(x + 12, y + 129, secondary_font, 0, power, accent);
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::env::current_dir()?;
    let assets = root.join("docs/specs/3j4df-gc9307-shell-dashboard-ui/assets");
    fs::create_dir_all(&assets)?;

    let framebuffer_path = assets.join("gc9307-shell-dashboard-example.framebuffer.bin");

    let mut canvas = Canvas::new(WHITE);

    draw_port(
        &mut canvas,
        6,
        6,
        150,
        160,
        AQUA,
        "USB-A",
        "5V",
        "5.03V",
        "0.48A",
        "2.4W",
    );
    draw_port(
        &mut canvas,
        164,
        6,
        150,
        160,
        BERRY,
        "PD",
        "20V",
        "20.1V",
        "3.12A",
        "62.7W",
    );

    canvas.write_rgb565_le(&framebuffer_path)?;
    println!("{}", framebuffer_path.display());
    Ok(())
}
