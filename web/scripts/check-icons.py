from __future__ import annotations

from pathlib import Path
from typing import Final
import hashlib

from PIL import Image


ROOT: Final = Path(__file__).resolve().parents[1]
WEB_ICONS: Final = ROOT / "public" / "icons"
DESKTOP_ICONS: Final = ROOT.parent / "desktop" / "src-tauri" / "icons"
BRAND_ASSETS: Final = ROOT / "public" / "brand"
BRAND_SOURCES: Final = ROOT / "src" / "assets" / "brand"
GITHUB_ASSETS: Final = ROOT.parent / ".github"

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

MARKETING_ASSETS: Final = {
    BRAND_ASSETS / "isolapurr-logo.png": (1520, 480),
    BRAND_ASSETS / "isolapurr-product-poster.png": (1440, 1920),
    BRAND_ASSETS / "isolapurr-product-render.png": (1774, 887),
    BRAND_ASSETS / "github-social-preview.png": (1280, 640),
    GITHUB_ASSETS / "social-preview.png": (1280, 640),
}

FULL_RENDER_SOURCE: Final = BRAND_SOURCES / "product-render-full-source.png"
FULL_RENDER_EXPORT: Final = BRAND_ASSETS / "isolapurr-product-render-full.png"
CUTOUT_SOURCE: Final = BRAND_SOURCES / "product-render-cutout-source.png"
CUTOUT_EXPORT: Final = BRAND_ASSETS / "isolapurr-product-render-cutout.png"


def visible_bounds(path: Path) -> tuple[int, int, int, int] | None:
    image = Image.open(path).convert("RGBA")
    alpha = image.getchannel("A")
    return alpha.getbbox()


def ensure_exists(path: Path) -> None:
    if not path.exists():
        raise SystemExit(f"missing icon asset: {path}")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def margin_ratio(path: Path) -> float:
    bounds = visible_bounds(path)
    if bounds is None:
        raise SystemExit(f"icon is fully transparent: {path}")

    image = Image.open(path)
    width, height = image.size
    left, top, right, bottom = bounds
    margins = [left, top, width - right, height - bottom]
    return min(margins) / min(width, height)


def ensure_transparent_pixels(path: Path, image: Image.Image) -> None:
    rgba_image = image.convert("RGBA")
    alpha = rgba_image.getchannel("A")
    min_alpha, _ = alpha.getextrema()
    if min_alpha == 255:
        raise SystemExit(f"cutout asset must include transparent pixels: {path}")


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

    for path, size in MARKETING_ASSETS.items():
        ensure_exists(path)
        image = Image.open(path)
        if image.size != size:
            raise SystemExit(
                f"marketing asset must be {size[0]}x{size[1]}, got {image.size}: {path}"
            )

    ensure_exists(FULL_RENDER_SOURCE)
    ensure_exists(FULL_RENDER_EXPORT)
    source_image = Image.open(FULL_RENDER_SOURCE)
    export_image = Image.open(FULL_RENDER_EXPORT)
    if export_image.size != source_image.size:
        raise SystemExit(
            "full product render must preserve source dimensions, "
            f"got {export_image.size} from {FULL_RENDER_SOURCE.name} {source_image.size}"
        )
    if sha256(FULL_RENDER_EXPORT) != sha256(FULL_RENDER_SOURCE):
        raise SystemExit(
            "full product render export must be an exact copy of the approved source image"
        )

    ensure_exists(CUTOUT_SOURCE)
    ensure_exists(CUTOUT_EXPORT)
    cutout_source = Image.open(CUTOUT_SOURCE)
    cutout_export = Image.open(CUTOUT_EXPORT)
    ensure_transparent_pixels(CUTOUT_SOURCE, cutout_source)
    ensure_transparent_pixels(CUTOUT_EXPORT, cutout_export)
    if cutout_export.size != cutout_source.size:
        raise SystemExit(
            "product render cutout export must preserve source dimensions, "
            f"got {cutout_export.size} from {CUTOUT_SOURCE.name} {cutout_source.size}"
        )
    if sha256(CUTOUT_EXPORT) != sha256(CUTOUT_SOURCE):
        raise SystemExit(
            "product render cutout export must be an exact copy of the approved source image"
        )

    print("icon geometry checks passed")


if __name__ == "__main__":
    main()
