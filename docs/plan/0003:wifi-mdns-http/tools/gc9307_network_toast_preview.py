#!/usr/bin/env python3
"""
Generate pixel-perfect GC9307 previews for Plan #0003 network toast overlay.

This matches the firmware's "compact toast" rendering:
- 3 rows × 20 columns
- 16×32 tiles
- 6×8 glyph scaled by (2×3) and centered in each tile

Outputs (relative to repo root):
- docs/plan/0003:wifi-mdns-http/images/gc9307-network-toast-connected.png
- docs/plan/0003:wifi-mdns-http/images/gc9307-network-toast-no-wifi.png
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

# ---------------------------------------------------------------------------
# GC9307 compact toast pixel previews (match firmware)
# ---------------------------------------------------------------------------

WIDTH = 320
HEIGHT = 172

TILE_W = 16
TILE_H = 32
TILES_X = 20
TILES_Y = 3

X_OFFSET = (WIDTH - TILE_W * TILES_X) // 2  # 0
Y_OFFSET = (HEIGHT - TILE_H * TILES_Y) // 2  # 38

GLYPH_SRC_W = 6
GLYPH_SRC_H = 8
GLYPH_SX = 2
GLYPH_SY = 3

GLYPH_W = GLYPH_SRC_W * GLYPH_SX
GLYPH_H = GLYPH_SRC_H * GLYPH_SY
GLYPH_X0 = (TILE_W - GLYPH_W) // 2
GLYPH_Y0 = (TILE_H - GLYPH_H) // 2

# Colors (match firmware + docs conventions)
COLOR_BG = (0, 0, 0)
COLOR_INFO = (255, 202, 40)  # #FFCA28 (same as UI OK voltage)


def glyph_6x8(ch: str) -> list[int]:
    # Ported from `src/display_ui/mod.rs` (firmware glyph table).
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
        ":": [0, 0b001100, 0b001100, 0, 0b001100, 0b001100, 0, 0],
        "-": [0, 0, 0, 0b111111, 0, 0, 0, 0],
        "/": [0b000011, 0b000110, 0b001100, 0b011000, 0b110000, 0, 0, 0],
        "_": [0, 0, 0, 0, 0, 0, 0b111111, 0],
        " ": [0, 0, 0, 0, 0, 0, 0, 0],
        "A": [0b011110, 0b110011, 0b110011, 0b111111, 0b110011, 0b110011, 0b110011, 0],
        "B": [0b111110, 0b110011, 0b110011, 0b111110, 0b110011, 0b110011, 0b111110, 0],
        "C": [0b011110, 0b110011, 0b110000, 0b110000, 0b110000, 0b110011, 0b011110, 0],
        "D": [0b111100, 0b110110, 0b110011, 0b110011, 0b110011, 0b110110, 0b111100, 0],
        "E": [0b111111, 0b110000, 0b110000, 0b111110, 0b110000, 0b110000, 0b111111, 0],
        "F": [0b111111, 0b110000, 0b110000, 0b111110, 0b110000, 0b110000, 0b110000, 0],
        "G": [0b011110, 0b110011, 0b110000, 0b110111, 0b110011, 0b110011, 0b011110, 0],
        "H": [0b110011, 0b110011, 0b110011, 0b111111, 0b110011, 0b110011, 0b110011, 0],
        "I": [0b111111, 0b001100, 0b001100, 0b001100, 0b001100, 0b001100, 0b111111, 0],
        "J": [0b111111, 0b001100, 0b001100, 0b001100, 0b001100, 0b110011, 0b011110, 0],
        "K": [0b110011, 0b110110, 0b111100, 0b111000, 0b111100, 0b110110, 0b110011, 0],
        "L": [0b110000, 0b110000, 0b110000, 0b110000, 0b110000, 0b110000, 0b111111, 0],
        "M": [0b110011, 0b111111, 0b111111, 0b110011, 0b110011, 0b110011, 0b110011, 0],
        "N": [0b110011, 0b111011, 0b111011, 0b110111, 0b110111, 0b110011, 0b110011, 0],
        "O": [0b011110, 0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b011110, 0],
        "P": [0b111110, 0b110011, 0b110011, 0b111110, 0b110000, 0b110000, 0b110000, 0],
        "Q": [0b011110, 0b110011, 0b110011, 0b110011, 0b110011, 0b110111, 0b011111, 0],
        "R": [0b111110, 0b110011, 0b110011, 0b111110, 0b110110, 0b110011, 0b110011, 0],
        "S": [0b011111, 0b110000, 0b110000, 0b011110, 0b000011, 0b000011, 0b111110, 0],
        "T": [0b111111, 0b001100, 0b001100, 0b001100, 0b001100, 0b001100, 0b001100, 0],
        "U": [0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b011110, 0],
        "V": [0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b011110, 0b001100, 0],
        "W": [0b110011, 0b110011, 0b110011, 0b110011, 0b110011, 0b110111, 0b011110, 0],
        "X": [0b110011, 0b011110, 0b001100, 0b001100, 0b001100, 0b011110, 0b110011, 0],
        "Y": [0b110011, 0b110011, 0b011110, 0b001100, 0b001100, 0b001100, 0b001100, 0],
        "Z": [0b111111, 0b000011, 0b000110, 0b001100, 0b011000, 0b110000, 0b111111, 0],
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


def line_text(text20: str, fg: tuple[int, int, int]) -> list[tuple[str, tuple[int, int, int]]]:
    if len(text20) != TILES_X:
        raise ValueError(f"expected {TILES_X} chars, got {len(text20)}: {text20!r}")
    return [(ch, fg) for ch in text20]


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


def main() -> None:
    out_dir = Path("docs/plan/0003:wifi-mdns-http/images")
    out_dir.mkdir(parents=True, exist_ok=True)

    def pad(s: str) -> str:
        return s[:TILES_X].ljust(TILES_X)

    frames: dict[str, list[str]] = {
        "gc9307-network-toast-connected.png": [
            pad("ID F293CC"),
            pad("IP 192.168.31.224"),
            pad(""),
        ],
        "gc9307-network-toast-no-wifi.png": [
            pad("NO WIFI"),
            pad("NO IP"),
            pad(""),
        ],
    }

    for name, rows in frames.items():
        rgb = render([line_text(r, COLOR_INFO) for r in rows])
        write_png_rgb(out_dir / name, rgb, WIDTH, HEIGHT)


if __name__ == "__main__":
    main()

