use super::dashboard_font;
use super::icons::{ICON_H, ICON_W, LUCIDE_INFO_40, LUCIDE_TOGGLE_RIGHT_40, LUCIDE_WIFI_40};
use super::surface::{FrameSurface, blend565, rgb565_raw};

const MENU_BG_RAW: u16 = rgb565_raw(0xF5, 0xF8, 0xFA);
const MENU_PANEL_RAW: u16 = rgb565_raw(0xFB, 0xFD, 0xFE);
const MENU_BORDER_RAW: u16 = rgb565_raw(0xD7, 0xE3, 0xEA);
const MENU_INK_RAW: u16 = rgb565_raw(0x21, 0x44, 0x57);
const MENU_MUTED_RAW: u16 = rgb565_raw(0x6E, 0x84, 0x91);
const MENU_ACCENT_RAW: u16 = rgb565_raw(0x4B, 0x63, 0xC7);
const MENU_ACCENT_SOFT_RAW: u16 = rgb565_raw(0xE7, 0xEA, 0xFB);

pub(super) fn render_settings_menu(surface: &mut FrameSurface<'_>, selected_index: usize) {
    surface.fill(MENU_BG_RAW);

    surface.fill_round_rect(8, 8, 304, 156, 14, MENU_BORDER_RAW);
    surface.fill_round_rect(10, 10, 300, 152, 13, MENU_PANEL_RAW);

    surface.draw_text_aa(
        22,
        22,
        &dashboard_font::SMALL,
        1,
        "SETTINGS",
        MENU_MUTED_RAW,
    );
    surface.draw_text_aa(
        22,
        44,
        &dashboard_font::MEDIUM,
        0,
        "USB-C MODE",
        MENU_INK_RAW,
    );

    let x0 = 34;
    let y0 = 88;
    let segment_w = 64;
    let segment_h = 64;
    let gap = 29;
    for index in 0..3 {
        let x = x0 + index as i32 * (segment_w + gap);
        let selected = index == selected_index;
        let fill = if selected {
            MENU_ACCENT_RAW
        } else {
            MENU_ACCENT_SOFT_RAW
        };
        let border = if selected {
            MENU_ACCENT_RAW
        } else {
            MENU_BORDER_RAW
        };
        let icon = if selected {
            MENU_PANEL_RAW
        } else {
            MENU_INK_RAW
        };

        surface.fill_round_rect(x, y0, segment_w, segment_h, 12, border);
        surface.fill_round_rect(x + 2, y0 + 2, segment_w - 4, segment_h - 4, 10, fill);
        draw_settings_menu_icon(surface, index, x, y0, segment_w, icon);
    }
}

pub(super) fn render_message_card(
    surface: &mut FrameSurface<'_>,
    title: &str,
    primary: &str,
    secondary: &str,
    tertiary: &str,
    accent_raw: u16,
) {
    surface.fill(MENU_BG_RAW);
    surface.fill_round_rect(8, 8, 304, 156, 14, MENU_BORDER_RAW);
    surface.fill_round_rect(10, 10, 300, 152, 13, MENU_PANEL_RAW);

    surface.draw_chip(
        22,
        20,
        &dashboard_font::SMALL,
        0,
        8,
        4,
        title,
        blend565(MENU_PANEL_RAW, accent_raw, 34),
        accent_raw,
        blend565(MENU_PANEL_RAW, accent_raw, 92),
    );
    surface.draw_text_aa(24, 60, &dashboard_font::MEDIUM, 0, primary, MENU_INK_RAW);
    if !secondary.is_empty() {
        surface.draw_text_aa(24, 92, &dashboard_font::SMALL, 0, secondary, MENU_MUTED_RAW);
    }
    if !tertiary.is_empty() {
        surface.draw_chip(
            24,
            122,
            &dashboard_font::SMALL,
            0,
            8,
            4,
            tertiary,
            blend565(MENU_PANEL_RAW, accent_raw, 24),
            accent_raw,
            blend565(MENU_PANEL_RAW, accent_raw, 76),
        );
    }
}

fn draw_settings_menu_icon(
    surface: &mut FrameSurface<'_>,
    index: usize,
    x: i32,
    y: i32,
    w: i32,
    icon: u16,
) {
    let cx = x + w / 2;
    let data = match index {
        0 => &LUCIDE_TOGGLE_RIGHT_40,
        1 => &LUCIDE_WIFI_40,
        _ => &LUCIDE_INFO_40,
    };
    surface.draw_bitmap_1bpp(
        cx - i32::from(ICON_W) / 2,
        y + (64 - i32::from(ICON_H)) / 2,
        ICON_W,
        ICON_H,
        data,
        icon,
    );
}

pub(super) fn trim_ascii_line<const N: usize>(line: &[u8; N]) -> &str {
    let mut end = N;
    while end > 0 && line[end - 1] == b' ' {
        end -= 1;
    }
    core::str::from_utf8(&line[..end]).unwrap_or("")
}
