#![allow(dead_code)]

use std::env;
use std::fs;
use std::path::PathBuf;

#[path = "../../../../crates/isolapurr-firmware-core/src/pd_i2c.rs"]
mod pd_i2c;

mod power_config {
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum TpsMode {
        AutoFollow,
        Manual,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum ManualUsbCPathMode {
        Default,
        Disconnect,
        Force,
    }
}

mod telemetry {
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum Field<T> {
        Ok(T),
        Err,
    }
}

#[path = "../../../../crates/isolapurr-firmware-core/src/display_ui.rs"]
mod production_display_policy;

#[path = "../../../../src/display_ui/dashboard_font.rs"]
mod dashboard_font;

#[path = "../../../../src/display_ui/font6x8.rs"]
mod font6x8;

#[path = "../../../../src/display_ui/dashboard_format.rs"]
mod dashboard_format;

use dashboard_format::{
    OkValueError, UI_STATUS_ERROR_RAW, UI_STATUS_NOT_PRESENT_RAW, UI_STATUS_OVER_RAW,
    format_ok_value_6,
};
use pd_i2c::{PowerRequest, ProtocolStatus, Sw2303ActiveProtocol};
use power_config::{ManualUsbCPathMode, TpsMode};
use production_display_policy::{
    NormalUiField, NormalUiPort, NormalUiPortBadge, NormalUiPortMode, NormalUiSnapshot,
    USB_C_DISPLAY_TEXT_CAPACITY, UsbCDisplayInput, format_port_badge_text, format_port_mode_text,
    resolve_usb_c_display,
};
use telemetry::Field;

const DISPLAY_WIDTH: u16 = 320;
const DISPLAY_HEIGHT: u16 = 172;
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

#[path = "../../../../src/display_ui/surface.rs"]
mod surface;

use surface::{FrameSurface, blend565, measure_text_aa, rgb565_raw};

#[path = "../../../../src/display_ui/dashboard.rs"]
mod dashboard;

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

struct Scene {
    mode: NormalUiPortMode,
    badge: NormalUiPortBadge,
    measurements_visible: bool,
    usb_c_voltage_uv: u32,
    usb_c_current_ua: u32,
    usb_c_power_uw: u32,
}

fn resolve_scene(name: &str) -> Scene {
    let (protocol_status, cc_attached, v_req_mv, vbus_mv, tps_mode, path_mode, setpoint_mv) =
        match name {
            "usb-c-pps" | "usb-c-pps-present" => (
                ProtocolStatus::Active(Sw2303ActiveProtocol::Pps),
                true,
                17_500,
                Some(17_554),
                TpsMode::AutoFollow,
                ManualUsbCPathMode::Default,
                5_000,
            ),
            "usb-c-unknown" => (
                ProtocolStatus::Unknown,
                true,
                17_500,
                Some(17_554),
                TpsMode::AutoFollow,
                ManualUsbCPathMode::Default,
                5_000,
            ),
            "usb-c-5v-idle-not-present" => (
                ProtocolStatus::Inactive,
                false,
                5_000,
                Some(0),
                TpsMode::AutoFollow,
                ManualUsbCPathMode::Default,
                5_000,
            ),
            "usb-c-manual-focus" => (
                ProtocolStatus::Unknown,
                false,
                5_000,
                Some(0),
                TpsMode::Manual,
                ManualUsbCPathMode::Force,
                3_300,
            ),
            "usb-c-manual-path-off" => (
                ProtocolStatus::Unknown,
                false,
                9_000,
                Some(0),
                TpsMode::Manual,
                ManualUsbCPathMode::Disconnect,
                9_000,
            ),
            "usb-c-manual-path-on" => (
                ProtocolStatus::Unknown,
                false,
                9_000,
                Some(1_000),
                TpsMode::Manual,
                ManualUsbCPathMode::Default,
                9_000,
            ),
            _ => (
                ProtocolStatus::Active(Sw2303ActiveProtocol::PdFixed),
                true,
                9_000,
                Some(9_012),
                TpsMode::AutoFollow,
                ManualUsbCPathMode::Default,
                5_000,
            ),
        };
    let is_off_scene = name == "usb-c-5v-idle-not-present";
    let (voltage_mv, current_ma, power_mw) = match name {
        "usb-c-pps" | "usb-c-pps-present" | "usb-c-unknown" => (17_554, 530, 9_290),
        "usb-c-5v-idle-not-present" => (5_011, 0, 3),
        "usb-c-manual-focus" => (5_011, 0, 3),
        "usb-c-manual-path-off" => (0, 0, 0),
        "usb-c-manual-path-on" => (9_012, 810, 7_318),
        _ => (9_012, 810, 7_318),
    };
    let request = Some(PowerRequest {
        fast_protocol: false,
        fast_voltage: false,
        protocol_status,
        cc_attached,
        v_req_mv,
        i_req_ma: 3_000,
        vbus_mv,
    });
    let display = resolve_usb_c_display(UsbCDisplayInput {
        tps_mode,
        manual_path_mode: path_mode,
        manual_setpoint_mv: setpoint_mv,
        tps_output_enabled: true,
        port_power_enabled: !is_off_scene,
        request,
        voltage_mv: Field::Ok(voltage_mv),
        current_ma: Field::Ok(current_ma),
    });

    Scene {
        mode: display.mode,
        badge: display.badge,
        measurements_visible: display.measurements_visible,
        usb_c_voltage_uv: voltage_mv * 1_000,
        usb_c_current_ua: current_ma * 1_000,
        usb_c_power_uw: power_mw * 1_000,
    }
}

fn port(
    present: bool,
    mode: NormalUiPortMode,
    badge: NormalUiPortBadge,
    voltage_uv: u32,
    current_ua: u32,
    power_uw: u32,
) -> NormalUiPort {
    NormalUiPort {
        present,
        mode,
        badge,
        voltage_uv: NormalUiField::Ok(voltage_uv),
        current_ua: NormalUiField::Ok(current_ua),
        power_uw: NormalUiField::Ok(power_uw),
    }
}

fn write_rgb565_le(pixels: &[u16], path: &PathBuf) -> std::io::Result<()> {
    let mut bytes = Vec::with_capacity(pixels.len() * 2);
    for pixel in pixels {
        bytes.extend_from_slice(&pixel.to_le_bytes());
    }
    fs::write(path, bytes)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = env::current_dir()?;
    let assets = root.join("docs/specs/3j4df-gc9307-shell-dashboard-ui/assets");
    fs::create_dir_all(&assets)?;

    let scene_name = env::var("GC9307_DASHBOARD_SCENE").unwrap_or_else(|_| "usb-c-pd-fixed".into());
    let framebuffer_path = env::var_os("GC9307_DASHBOARD_OUTPUT")
        .map(PathBuf::from)
        .unwrap_or_else(|| assets.join(format!("gc9307-{scene_name}.framebuffer.bin")));
    if let Some(parent) = framebuffer_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let scene = resolve_scene(&scene_name);
    let snapshot = NormalUiSnapshot {
        usb_a: port(
            true,
            NormalUiPortMode::UsbA,
            NormalUiPortBadge::VoltageMv(5_000),
            5_030_000,
            420_000,
            2_100_000,
        ),
        usb_c: port(
            scene.measurements_visible,
            scene.mode,
            scene.badge,
            scene.usb_c_voltage_uv,
            scene.usb_c_current_ua,
            scene.usb_c_power_uw,
        ),
    };
    let mut pixels = vec![rgb565_raw(0xFF, 0xFF, 0xFF); FRAME_PIXELS];
    let mut surface = FrameSurface::new(&mut pixels);
    dashboard::render_dashboard_base(&mut surface);
    dashboard::render_dashboard_dynamic(&mut surface, &snapshot);
    write_rgb565_le(&pixels, &framebuffer_path)?;
    println!("{}", framebuffer_path.display());

    let mut mode_buf = [b' '; USB_C_DISPLAY_TEXT_CAPACITY];
    let mode_len = format_port_mode_text(scene.mode, &mut mode_buf);
    let mut badge_buf = [b' '; USB_C_DISPLAY_TEXT_CAPACITY];
    let badge_len = format_port_badge_text(scene.badge, &mut badge_buf);
    println!(
        "USB-C mode={} badge={}",
        core::str::from_utf8(&mode_buf[..mode_len])?,
        core::str::from_utf8(&badge_buf[..badge_len])?,
    );
    Ok(())
}
