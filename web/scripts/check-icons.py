from __future__ import annotations

from pathlib import Path
from typing import Final

from PIL import Image


ROOT: Final = Path(__file__).resolve().parents[1]
WEB_ICONS: Final = ROOT / "public" / "icons"
DESKTOP_ICONS: Final = ROOT.parent / "desktop" / "src-tauri" / "icons"

REGULAR_ICONS: Final = [
    WEB_ICONS / "pwa-192.png",
    WEB_ICONS / "pwa-512.png",
    WEB_ICONS / "apple-touch-icon.png",
    WEB_ICONS / "desktop-256.png",
    WEB_ICONS / "desktop-512.png",
    WEB_ICONS / "tauri-source-1024.png",
]

MASKABLE_ICONS: Final = [
    WEB_ICONS / "maskable-192.png",
    WEB_ICONS / "maskable-512.png",
]

DESKTOP_PNGS: Final = [
    DESKTOP_ICONS / "32x32.png",
    DESKTOP_ICONS / "128x128.png",
    DESKTOP_ICONS / "128x128@2x.png",
    DESKTOP_ICONS / "icon.png",
]


def visible_bounds(path: Path) -> tuple[int, int, int, int] | None:
    image = Image.open(path).convert("RGBA")
    alpha = image.getchannel("A")
    return alpha.getbbox()


def ensure_exists(path: Path) -> None:
    if not path.exists():
        raise SystemExit(f"missing icon asset: {path}")


def margin_ratio(path: Path) -> float:
    bounds = visible_bounds(path)
    if bounds is None:
        raise SystemExit(f"icon is fully transparent: {path}")

    image = Image.open(path)
    width, height = image.size
    left, top, right, bottom = bounds
    margins = [left, top, width - right, height - bottom]
    return min(margins) / min(width, height)


def main() -> None:
    for path in REGULAR_ICONS + MASKABLE_ICONS + DESKTOP_PNGS:
        ensure_exists(path)

    for path in REGULAR_ICONS:
        ratio = margin_ratio(path)
        if ratio < 0.07:
            raise SystemExit(
                f"regular icon must keep visible safe zone, got {ratio:.3f}: {path}"
            )

    for path in MASKABLE_ICONS:
        ratio = margin_ratio(path)
        if ratio > 0.02:
            raise SystemExit(
                f"maskable icon should stay full-bleed, got {ratio:.3f}: {path}"
            )

    for path in DESKTOP_PNGS:
        _ = margin_ratio(path)

    print("icon geometry checks passed")


if __name__ == "__main__":
    main()
