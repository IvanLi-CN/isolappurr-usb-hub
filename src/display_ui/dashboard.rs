use super::*;

pub const DASHBOARD_BG_RGB8: (u8, u8, u8) = (0xFF, 0xFF, 0xFF);

const DASHBOARD_BG_RAW: u16 = rgb565_raw(
    DASHBOARD_BG_RGB8.0,
    DASHBOARD_BG_RGB8.1,
    DASHBOARD_BG_RGB8.2,
);
const WHITE_RAW: u16 = rgb565_raw(0xFF, 0xFF, 0xFF);
const AQUA_RAW: u16 = rgb565_raw(0x4B, 0xA6, 0xC3);
const BERRY_RAW: u16 = rgb565_raw(0xB9, 0x49, 0x5A);
const INK_RAW: u16 = rgb565_raw(0x21, 0x44, 0x57);
const INK_SOFT_RAW: u16 = rgb565_raw(0x6E, 0x84, 0x91);
const BORDER_RAW: u16 = rgb565_raw(0xD6, 0xE5, 0xED);

const CARD_RADIUS: u16 = 14;
const CHIP_PAD_X: i32 = 8;
const CHIP_PAD_Y: i32 = 5;

struct PortTheme {
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

pub(super) fn render_dashboard_base(surface: &mut FrameSurface<'_>) {
    surface.fill(DASHBOARD_BG_RAW);
    draw_dashboard_port_base(surface, 6, 6, 150, 160, PortTheme::new(AQUA_RAW));
    draw_dashboard_port_base(surface, 164, 6, 150, 160, PortTheme::new(BERRY_RAW));
}

pub(super) fn render_dashboard_dynamic(
    surface: &mut FrameSurface<'_>,
    snapshot: &NormalUiSnapshot,
) {
    draw_dashboard_port_dynamic(
        surface,
        6,
        6,
        150,
        160,
        snapshot.usb_a,
        PortTheme::new(AQUA_RAW),
    );
    draw_dashboard_port_dynamic(
        surface,
        164,
        6,
        150,
        160,
        snapshot.usb_c,
        PortTheme::new(BERRY_RAW),
    );
}

fn draw_dashboard_port_base(
    surface: &mut FrameSurface<'_>,
    x: u16,
    y: u16,
    w: u16,
    h: u16,
    theme: PortTheme,
) {
    surface.fill_round_rect(
        x as i32,
        y as i32,
        w as i32,
        h as i32,
        CARD_RADIUS as i32,
        theme.card_fill,
    );
    surface.fill_rect(
        x as i32 + 12,
        y as i32 + 86,
        w as i32 - 24,
        2,
        theme.divider,
    );
    surface.fill_rect(
        x as i32 + 12,
        y as i32 + 123,
        w as i32 - 24,
        2,
        theme.divider,
    );
}

fn draw_dashboard_port_dynamic(
    surface: &mut FrameSurface<'_>,
    x: u16,
    y: u16,
    w: u16,
    _h: u16,
    port: NormalUiPort,
    theme: PortTheme,
) {
    let title = port_mode_text(port.mode);
    let mut badge_buf = [b' '; 5];
    let badge_len = format_badge_text(port, &mut badge_buf);
    let badge = core::str::from_utf8(&badge_buf[..badge_len]).unwrap_or("OFF");

    let chip_font = &dashboard_font::SMALL;
    let value_font = &dashboard_font::LARGE;
    let secondary_font = &dashboard_font::MEDIUM;

    surface.draw_chip(
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
    );

    let badge_w = measure_text_aa(chip_font, 0, badge) + CHIP_PAD_X * 2;
    let badge_h = chip_font.line_h as i32 + CHIP_PAD_Y * 2;
    let badge_x = x as i32 + w as i32 - badge_w - 10;
    let badge_y = y as i32 + 10;
    surface.fill_round_rect(
        badge_x,
        badge_y,
        badge_w,
        badge_h,
        badge_h / 2,
        theme.meta_fill,
    );
    surface.draw_text_centered_aa(
        badge_x,
        badge_y,
        badge_w,
        badge_h,
        chip_font,
        0,
        badge,
        theme.meta_text,
    );

    let (voltage, voltage_color) =
        format_dashboard_value(port.present, port.voltage_uv, b'V', theme.main_text);
    let (current, current_color) =
        format_dashboard_value(port.present, port.current_ua, b'A', theme.secondary_text);
    let (power, power_color) =
        format_dashboard_value(port.present, port.power_uw, b'W', theme.power_text);

    let voltage_text = core::str::from_utf8(&voltage).unwrap_or("ERR");
    let current_text = core::str::from_utf8(&current).unwrap_or("ERR");
    let power_text = core::str::from_utf8(&power).unwrap_or("ERR");

    surface.draw_text_aa(
        x as i32 + 12,
        y as i32 + 34,
        value_font,
        0,
        voltage_text,
        voltage_color,
    );
    surface.draw_text_aa(
        x as i32 + 12,
        y as i32 + 88,
        secondary_font,
        0,
        current_text,
        current_color,
    );
    surface.draw_text_aa(
        x as i32 + 12,
        y as i32 + 125,
        secondary_font,
        0,
        power_text,
        power_color,
    );
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
