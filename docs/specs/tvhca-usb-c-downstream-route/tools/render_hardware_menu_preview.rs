#![allow(dead_code)]

#[path = "../../../../src/display_ui/dashboard_font.rs"]
mod dashboard_font;
#[path = "../../../../src/display_ui/font6x8.rs"]
mod font6x8;
#[path = "../../../../src/display_ui/icons.rs"]
mod icons;
#[path = "../../../../src/display_ui/menu.rs"]
mod menu;
#[path = "../../../../src/display_ui/surface.rs"]
mod surface;

use std::fs;
use std::path::Path;

pub const DISPLAY_WIDTH: u16 = 320;
pub const DISPLAY_HEIGHT: u16 = 172;
const FRAME_PIXELS: usize = DISPLAY_WIDTH as usize * DISPLAY_HEIGHT as usize;

const TILE_W: u16 = 24;
const TILE_H: u16 = 48;
const TILES_X: u16 = 13;
const X_OFFSET: u16 = (DISPLAY_WIDTH - TILE_W * TILES_X) / 2;
const Y_OFFSET: u16 = (DISPLAY_HEIGHT - TILE_H * 3) / 2;
const GLYPH_SX: u16 = 3;
const GLYPH_SY: u16 = 4;

const TOAST_COMPACT_TILE_W: u16 = 16;
const TOAST_COMPACT_TILE_H: u16 = 32;
const TOAST_COMPACT_TILES_X: u16 = 20;
const TOAST_COMPACT_X_OFFSET: u16 =
    (DISPLAY_WIDTH - TOAST_COMPACT_TILE_W * TOAST_COMPACT_TILES_X) / 2;
const TOAST_COMPACT_Y_OFFSET: u16 = (DISPLAY_HEIGHT - TOAST_COMPACT_TILE_H * 3) / 2;
const TOAST_COMPACT_GLYPH_SX: u16 = 2;
const TOAST_COMPACT_GLYPH_SY: u16 = 3;

const TOAST_OK_RAW: u16 = 0x1407;
const TOAST_INFO_RAW: u16 = 0x1A7B;
const TOAST_ERR_RAW: u16 = 0x98C3;

fn render_char_6x8_scaled(ch: u8, out: &mut [u8]) {
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

fn write_framebuffer(out_dir: &Path, name: &str, pixels: &[u16]) {
    let mut raw = Vec::with_capacity(pixels.len() * 2);
    for pixel in pixels {
        raw.extend_from_slice(&pixel.to_le_bytes());
    }
    fs::write(out_dir.join(format!("{name}.rgb565")), raw).unwrap();
}

fn render(out_dir: &Path, name: &str, f: impl FnOnce(&mut surface::FrameSurface<'_>)) {
    let mut pixels = vec![0_u16; FRAME_PIXELS];
    {
        let mut surface = surface::FrameSurface::new(&mut pixels);
        f(&mut surface);
    }
    write_framebuffer(out_dir, name, &pixels);
}

fn main() {
    let out_dir = Path::new("docs/specs/tvhca-usb-c-downstream-route/assets/display");
    fs::create_dir_all(out_dir).unwrap();

    render(out_dir, "menu-mode", |surface| {
        menu::render_settings_menu(surface, 0);
    });
    render(out_dir, "menu-wifi", |surface| {
        menu::render_settings_menu(surface, 1);
    });
    render(out_dir, "menu-about", |surface| {
        menu::render_settings_menu(surface, 2);
    });
    render(out_dir, "mode-normal-saved", |surface| {
        menu::render_message_card(
            surface,
            "USB-C MODE",
            "UPGRADE TO NORMAL",
            "EEPROM SAVED",
            "",
            TOAST_OK_RAW,
        );
    });
    render(out_dir, "mode-upgrade-saved", |surface| {
        menu::render_message_card(
            surface,
            "USB-C MODE",
            "NORMAL TO UPGRADE",
            "EEPROM SAVED",
            "",
            TOAST_OK_RAW,
        );
    });
    render(out_dir, "mode-eeprom-fail", |surface| {
        menu::render_message_card(
            surface,
            "USB-C MODE",
            "EEPROM FAIL",
            "NOT SAVED",
            "",
            TOAST_ERR_RAW,
        );
    });
    render(out_dir, "wifi-info", |surface| {
        menu::render_message_card(
            surface,
            "WIFI",
            "HUB-A",
            "192.168.1.42",
            "WIFI/LAN READY",
            TOAST_INFO_RAW,
        );
    });
    render(out_dir, "about", |surface| {
        menu::render_message_card(
            surface,
            "ABOUT",
            "ISOLAPURR USB HUB",
            "0.1.0",
            "ABCDEF1",
            TOAST_INFO_RAW,
        );
    });
}
