#!/usr/bin/env python3
"""
Generate 1:1 pixel previews of the GC9307 "normal UI" using the same glyph+tile
rendering method as the firmware.

Outputs (relative to repo root):
- docs/spec/images/gc9307-normal-ui-preview-normal.png
- docs/spec/images/gc9307-normal-ui-preview-not-present.png
- docs/spec/images/gc9307-normal-ui-preview-error-over.png
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path


# Display config (matches firmware defaults)
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

# Colors (match docs/spec/gc9307-normal-ui.md §5.5)
COLOR_BG = (0, 0, 0)
COLOR_NOT_PRESENT = (128, 128, 128)  # gray
COLOR_ERROR = (255, 0, 0)  # red
COLOR_OVER = (255, 152, 0)  # orange (#FF9800)

COLOR_OK_V = (255, 202, 40)  # #FFCA28 (Voltage)
COLOR_OK_I = (244, 67, 54)  # #F44336 (Current)
COLOR_OK_P = (76, 175, 80)  # #4CAF50 (Power)

ROW_OK_COLORS = [COLOR_OK_V, COLOR_OK_I, COLOR_OK_P]


def glyph_6x8(ch: str) -> list[int]:
    # Ported from firmware glyph table, with added 'O', 'V', 'W' needed for this UI.
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
        "E": [0b111111, 0b110000, 0b110000, 0b111110, 0b110000, 0b110000, 0b111111, 0],
        "R": [0b111110, 0b110011, 0b110011, 0b111110, 0b110110, 0b110011, 0b110011, 0],
        "O": [0b011110, 0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b011110, 0],
        "V": [0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b011110, 0b001100, 0],
        "W": [0b100001, 0b100001, 0b100001, 0b101101, 0b101101, 0b110011, 0b100001, 0],
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


def line_2col(
    left: str, right: str, left_fg: tuple[int, int, int], right_fg: tuple[int, int, int]
) -> list[tuple[str, tuple[int, int, int]]]:
    if len(left) != 6 or len(right) != 6:
        raise ValueError("expected 6-char cells for left/right")
    out: list[tuple[str, tuple[int, int, int]]] = []
    out.extend((ch, left_fg) for ch in left)
    out.append((" ", COLOR_BG))
    out.extend((ch, right_fg) for ch in right)
    return out


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
    # Raw scanlines with "no filter" (type 0).
    stride = width * 3
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(rgb[y * stride : (y + 1) * stride])
    compressed = zlib.compress(bytes(raw), level=9)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    out = bytearray()
    out.extend(b"\x89PNG\r\n\x1a\n")
    out.extend(png_chunk(b"IHDR", ihdr))
    out.extend(png_chunk(b"IDAT", compressed))
    out.extend(png_chunk(b"IEND", b""))
    path.write_bytes(bytes(out))


def main() -> None:
    out_dir = Path("docs/spec/images")
    out_dir.mkdir(parents=True, exist_ok=True)

    frames = {
        "gc9307-normal-ui-preview-normal.png": [
            line_2col("5.000V", "20.00V", ROW_OK_COLORS[0], ROW_OK_COLORS[0]),
            line_2col("0.500A", "3.250A", ROW_OK_COLORS[1], ROW_OK_COLORS[1]),
            line_2col("2.500W", "100.0W", ROW_OK_COLORS[2], ROW_OK_COLORS[2]),
        ],
        "gc9307-normal-ui-preview-not-present.png": [
            line_2col("--.--V", "--.--V", COLOR_NOT_PRESENT, COLOR_NOT_PRESENT),
            line_2col("--.--A", "--.--A", COLOR_NOT_PRESENT, COLOR_NOT_PRESENT),
            line_2col("--.--W", "--.--W", COLOR_NOT_PRESENT, COLOR_NOT_PRESENT),
        ],
        "gc9307-normal-ui-preview-error-over.png": [
            line_2col("ERROR ", "20.00V", COLOR_ERROR, ROW_OK_COLORS[0]),
            line_2col("0.500A", "ERROR ", ROW_OK_COLORS[1], COLOR_ERROR),
            line_2col("2.500W", "OVER  ", ROW_OK_COLORS[2], COLOR_OVER),
        ],
    }

    for name, lines in frames.items():
        rgb = render(lines)
        write_png_rgb(out_dir / name, rgb, WIDTH, HEIGHT)


if __name__ == "__main__":
    main()
