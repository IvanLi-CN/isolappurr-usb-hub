#!/usr/bin/env python3
"""
Generate documentation assets for Plan #0002:

- Pixel-perfect GC9307 previews (320×172 PNG) using the same 6×8 glyph into 24×48 tile
  rendering method as the firmware.
- WAV audition audio for action-confirm / action-deny (derived from the prompt_tone
  action patterns: 2700Hz, 12% duty, 30ms click, 40ms gap).

Outputs (relative to repo root):
- docs/plan/0002:usb-replug-power-cut/images/gc9307-action-*.png
- docs/plan/0002:usb-replug-power-cut/audio/action-confirm.wav
- docs/plan/0002:usb-replug-power-cut/audio/action-deny.wav
"""

from __future__ import annotations

import math
import struct
import wave
import zlib
from pathlib import Path

# ---------------------------------------------------------------------------
# GC9307 pixel previews
# ---------------------------------------------------------------------------

WIDTH = 320
HEIGHT = 172

TILE_W = 24
TILE_H = 48
TILES_X = 13
TILES_Y = 3

X_OFFSET = (WIDTH - TILE_W * TILES_X) // 2
Y_OFFSET = (HEIGHT - TILE_H * TILES_Y) // 2

GLYPH_SRC_W = 6
GLYPH_SRC_H = 8
GLYPH_SX = 3
GLYPH_SY = 4

GLYPH_W = GLYPH_SRC_W * GLYPH_SX
GLYPH_H = GLYPH_SRC_H * GLYPH_SY
GLYPH_X0 = (TILE_W - GLYPH_W) // 2
GLYPH_Y0 = (TILE_H - GLYPH_H) // 2

COLOR_BG = (0, 0, 0)
COLOR_OK = (76, 175, 80)  # green (OK)
COLOR_INFO = (255, 202, 40)  # yellow (action in-progress / info)
COLOR_WARN = (255, 152, 0)  # orange (power-off / warning)
COLOR_ERR = (255, 0, 0)  # red (reject)


def glyph_6x8(ch: str) -> list[int]:
    # Match firmware's 6x8 style and extend with minimal ASCII needed for Plan #0002 toasts.
    g = {
        "0": [0b011110, 0b110011, 0b110111, 0b111011, 0b110011, 0b110011, 0b011110, 0],
        "1": [0b001100, 0b011100, 0b001100, 0b001100, 0b001100, 0b001100, 0b111111, 0],
        "2": [0b011110, 0b110011, 0b000011, 0b000110, 0b001100, 0b011000, 0b111111, 0],
        "3": [0b011110, 0b110011, 0b000011, 0b001110, 0b000011, 0b110011, 0b011110, 0],
        "4": [0b000110, 0b001110, 0b011110, 0b110110, 0b111111, 0b000110, 0b000110, 0],
        "5": [0b111111, 0b110000, 0b111110, 0b000011, 0b000011, 0b110011, 0b011110, 0],
        "6": [0b011110, 0b110011, 0b110000, 0b111110, 0b110011, 0b110011, 0b011110, 0],
        "7": [0b111111, 0b000011, 0b000110, 0b001100, 0b011000, 0b011000, 0b011000, 0],
        "8": [0b011110, 0b110011, 0b110011, 0b011110, 0b110011, 0b110011, 0b011110, 0],
        "9": [0b011110, 0b110011, 0b110011, 0b011111, 0b000011, 0b110011, 0b011110, 0],
        ".": [0, 0, 0, 0, 0, 0, 0b001100, 0],
        "-": [0, 0, 0, 0b111111, 0, 0, 0, 0],
        " ": [0, 0, 0, 0, 0, 0, 0, 0],
        "A": [0b011110, 0b110011, 0b110011, 0b111111, 0b110011, 0b110011, 0b110011, 0],
        "B": [0b111110, 0b110011, 0b110011, 0b111110, 0b110011, 0b110011, 0b111110, 0],
        "C": [0b011110, 0b110011, 0b110000, 0b110000, 0b110000, 0b110011, 0b011110, 0],
        "D": [0b111100, 0b110110, 0b110011, 0b110011, 0b110011, 0b110110, 0b111100, 0],
        "E": [0b111111, 0b110000, 0b110000, 0b111110, 0b110000, 0b110000, 0b111111, 0],
        "F": [0b111111, 0b110000, 0b110000, 0b111110, 0b110000, 0b110000, 0b110000, 0],
        "I": [0b111111, 0b001100, 0b001100, 0b001100, 0b001100, 0b001100, 0b111111, 0],
        "M": [0b110011, 0b111111, 0b111111, 0b110011, 0b110011, 0b110011, 0b110011, 0],
        "N": [0b110011, 0b111011, 0b111011, 0b110111, 0b110111, 0b110011, 0b110011, 0],
        "O": [0b011110, 0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b011110, 0],
        "P": [0b111110, 0b110011, 0b110011, 0b111110, 0b110000, 0b110000, 0b110000, 0],
        "R": [0b111110, 0b110011, 0b110011, 0b111110, 0b110110, 0b110011, 0b110011, 0],
        "S": [0b011111, 0b110000, 0b110000, 0b011110, 0b000011, 0b000011, 0b111110, 0],
        "T": [0b111111, 0b001100, 0b001100, 0b001100, 0b001100, 0b001100, 0b001100, 0],
        "U": [0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b011110, 0],
        "V": [0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b011110, 0b001100, 0],
        "W": [0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b110111, 0b011110, 0],
        "Y": [0b110011, 0b110011, 0b011110, 0b001100, 0b001100, 0b001100, 0b001100, 0],
        "?": [0b011110, 0b110011, 0b000011, 0b000110, 0b001100, 0, 0b001100, 0],
    }
    return g.get(ch, g["?"])


def set_pixel(rgb: bytearray, x: int, y: int, color: tuple[int, int, int]) -> None:
    if x < 0 or y < 0 or x >= WIDTH or y >= HEIGHT:
        return
    idx = (y * WIDTH + x) * 3
    rgb[idx : idx + 3] = bytes(color)


def draw_char(
    rgb: bytearray, tile_x: int, tile_y: int, ch: str, fg: tuple[int, int, int]
) -> None:
    ox = X_OFFSET + tile_x * TILE_W + GLYPH_X0
    oy = Y_OFFSET + tile_y * TILE_H + GLYPH_Y0
    glyph = glyph_6x8(ch)
    for src_y, row_bits in enumerate(glyph):
        for src_x in range(GLYPH_SRC_W):
            on = (row_bits & (1 << (GLYPH_SRC_W - 1 - src_x))) != 0
            if not on:
                continue
            for ry in range(GLYPH_SY):
                for rx in range(GLYPH_SX):
                    set_pixel(
                        rgb,
                        ox + src_x * GLYPH_SX + rx,
                        oy + src_y * GLYPH_SY + ry,
                        fg,
                    )


def line_text(text13: str, fg: tuple[int, int, int]) -> list[tuple[str, tuple[int, int, int]]]:
    if len(text13) != 13:
        raise ValueError(f"expected 13 chars, got {len(text13)}: {text13!r}")
    return [(ch, fg) for ch in text13]


def render(lines: list[list[tuple[str, tuple[int, int, int]]]]) -> bytearray:
    if len(lines) != TILES_Y:
        raise ValueError("expected exactly 3 lines")
    for line in lines:
        if len(line) != TILES_X:
            raise ValueError(f"each line must be {TILES_X} chars, got {len(line)}")
    rgb = bytearray(WIDTH * HEIGHT * 3)
    for y in range(HEIGHT):
        for x in range(WIDTH):
            set_pixel(rgb, x, y, COLOR_BG)

    for y, line in enumerate(lines):
        for x, (ch, fg) in enumerate(line):
            draw_char(rgb, x, y, ch, fg)
    return rgb


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def write_png_rgb(path: Path, rgb: bytes, width: int, height: int) -> None:
    stride = width * 3
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0
        raw.extend(rgb[y * stride : (y + 1) * stride])
    compressed = zlib.compress(bytes(raw), level=9)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    out = bytearray()
    out.extend(b"\x89PNG\r\n\x1a\n")
    out.extend(png_chunk(b"IHDR", ihdr))
    out.extend(png_chunk(b"IDAT", compressed))
    out.extend(png_chunk(b"IEND", b""))
    path.write_bytes(bytes(out))


def gen_gc9307_previews() -> None:
    out_dir = Path("docs/plan/0002:usb-replug-power-cut/images")
    out_dir.mkdir(parents=True, exist_ok=True)

    # 3 lines × 13 chars, all-monocolor to match 1bpp tile rendering.
    frames: dict[str, list[str]] = {
        # USB-A: data replug (start/end)
        "gc9307-action-usb-a-dataoff.png": [
            "USB-A DATAOFF",
            "250MS        ",
            "             ",
        ],
        "gc9307-action-usb-a-dataon.png": [
            "USB-A DATAON ",
            "DONE         ",
            "             ",
        ],
        # USB-A: power toggle
        "gc9307-action-usb-a-pwroff.png": [
            "USB-A PWROFF ",
            "DONE         ",
            "             ",
        ],
        "gc9307-action-usb-a-pwron.png": [
            "USB-A PWRON  ",
            "DONE         ",
            "             ",
        ],
        # Reject examples
        "gc9307-action-usb-a-busy.png": [
            "USB-A BUSY   ",
            "REJECT       ",
            "             ",
        ],
        "gc9307-action-usb-a-badtime.png": [
            "USB-A BADTIME",
            "REJECT       ",
            "             ",
        ],
        # USB-C examples
        "gc9307-action-usb-c-dataoff.png": [
            "USB-C DATAOFF",
            "250MS        ",
            "             ",
        ],
        "gc9307-action-usb-c-dataon.png": [
            "USB-C DATAON ",
            "DONE         ",
            "             ",
        ],
        "gc9307-action-usb-c-pwroff.png": [
            "USB-C PWROFF ",
            "DONE         ",
            "             ",
        ],
        "gc9307-action-usb-c-pwron.png": [
            "USB-C PWRON  ",
            "DONE         ",
            "             ",
        ],
        "gc9307-action-usb-c-busy.png": [
            "USB-C BUSY   ",
            "REJECT       ",
            "             ",
        ],
        "gc9307-action-usb-c-badtime.png": [
            "USB-C BADTIME",
            "REJECT       ",
            "             ",
        ],
    }

    color_for_name: dict[str, tuple[int, int, int]] = {
        "dataoff": COLOR_INFO,
        "dataon": COLOR_OK,
        "pwroff": COLOR_WARN,
        "pwron": COLOR_OK,
        "busy": COLOR_ERR,
        "badtime": COLOR_ERR,
    }

    for name, rows in frames.items():
        # Choose a reasonable single color based on suffix.
        fg = COLOR_INFO
        for key, c in color_for_name.items():
            if key in name:
                fg = c
                break
        rgb = render([line_text(r, fg) for r in rows])
        write_png_rgb(out_dir / name, rgb, WIDTH, HEIGHT)


# ---------------------------------------------------------------------------
# WAV audition audio (action confirm/deny)
# ---------------------------------------------------------------------------

SAMPLE_RATE = 44100

ACTION_FREQ_HZ = 2700
ACTION_DUTY_PCT = 12  # matches firmware ACTION_DUTY_PCT
ACTION_CLICK_MS = 30  # matches firmware ACTION_CLICK_MS
ACTION_DOUBLE_GAP_MS = 40  # matches firmware ACTION_DOUBLE_GAP_MS


def pwm_sample(phase: float, duty: float) -> float:
    # phase in [0, 1)
    return 1.0 if phase < duty else 0.0


def gen_wav(path: Path, segments: list[tuple[str, int]]) -> None:
    # 16-bit PCM mono
    amp = 0.25  # keep it modest to avoid harsh clipping on speakers
    duty = ACTION_DUTY_PCT / 100.0

    samples: list[int] = []
    t = 0
    for kind, ms in segments:
        n = int(round(ms * SAMPLE_RATE / 1000))
        if kind == "silence":
            samples.extend([0] * n)
        elif kind == "tone":
            for i in range(n):
                # phase progresses by freq/sample_rate
                ph = ((t + i) * ACTION_FREQ_HZ / SAMPLE_RATE) % 1.0
                v = pwm_sample(ph, duty)
                # Center PWM around 0 to sound less "DC-ish".
                s = (v * 2.0 - 1.0) * amp
                samples.append(int(max(-1.0, min(1.0, s)) * 32767))
        else:
            raise ValueError(kind)
        t += n

    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(struct.pack("<" + "h" * len(samples), *samples))


def gen_action_wavs() -> None:
    out_dir = Path("docs/plan/0002:usb-replug-power-cut/audio")
    out_dir.mkdir(parents=True, exist_ok=True)

    tail_ms = 120  # a short tail so the sound isn't cut off abruptly

    gen_wav(
        out_dir / "action-confirm.wav",
        [("tone", ACTION_CLICK_MS), ("silence", tail_ms)],
    )
    gen_wav(
        out_dir / "action-deny.wav",
        [
            ("tone", ACTION_CLICK_MS),
            ("silence", ACTION_DOUBLE_GAP_MS),
            ("tone", ACTION_CLICK_MS),
            ("silence", tail_ms),
        ],
    )


def main() -> None:
    gen_gc9307_previews()
    gen_action_wavs()


if __name__ == "__main__":
    main()
