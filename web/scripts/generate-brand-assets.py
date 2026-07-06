from __future__ import annotations

from pathlib import Path
from shutil import copyfile
import subprocess

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BRAND_SRC = ROOT / "src" / "assets" / "brand"
PUBLIC_BRAND = ROOT / "public" / "brand"
GH_DIR = ROOT.parent / ".github"

POSTER_SOURCE = BRAND_SRC / "product-poster-source.png"
SOCIAL_SOURCE = BRAND_SRC / "github-social-preview-source.png"
LOGO_SVG = BRAND_SRC / "isolapurr-logo.svg"
PUBLIC_LOGO_SVG = PUBLIC_BRAND / "isolapurr-logo.svg"
LOGO_PNG = PUBLIC_BRAND / "isolapurr-logo.png"
POSTER = PUBLIC_BRAND / "isolapurr-product-poster.png"
SOCIAL = GH_DIR / "social-preview.png"
PUBLIC_SOCIAL = PUBLIC_BRAND / "github-social-preview.png"


def cover_crop(
    image: Image.Image, size: tuple[int, int], anchor_x: float = 0.5
) -> Image.Image:
    target_w, target_h = size
    source_w, source_h = image.size
    scale = max(target_w / source_w, target_h / source_h)
    resized = image.resize(
        (round(source_w * scale), round(source_h * scale)),
        Image.Resampling.LANCZOS,
    )
    left = round((resized.width - target_w) * anchor_x)
    top = round((resized.height - target_h) * 0.5)
    return resized.crop((left, top, left + target_w, top + target_h))


def generate_logo_png() -> None:
    PUBLIC_BRAND.mkdir(parents=True, exist_ok=True)
    if not LOGO_SVG.exists():
        raise SystemExit(f"missing logo svg: {LOGO_SVG}")
    copyfile(LOGO_SVG, PUBLIC_LOGO_SVG)
    subprocess.run(
        [
            "rsvg-convert",
            str(LOGO_SVG),
            "--width",
            "1520",
            "--height",
            "480",
            "--format",
            "png",
            "--output",
            str(LOGO_PNG),
        ],
        check=True,
    )


def export_fixed_image(source_path: Path, output_paths: tuple[Path, ...], size: tuple[int, int]) -> None:
    if not source_path.exists():
        raise SystemExit(f"missing marketing source: {source_path}")
    image = Image.open(source_path).convert("RGB")
    if image.size != size:
        image = cover_crop(image, size)
    for output_path in output_paths:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(output_path, quality=95)


def generate_social() -> None:
    GH_DIR.mkdir(parents=True, exist_ok=True)
    export_fixed_image(SOCIAL_SOURCE, (SOCIAL, PUBLIC_SOCIAL), (1280, 640))


def generate_poster() -> None:
    export_fixed_image(POSTER_SOURCE, (POSTER,), (1440, 1920))


def main() -> None:
    generate_logo_png()
    generate_social()
    generate_poster()
    print(LOGO_PNG)
    print(POSTER)
    print(SOCIAL)


if __name__ == "__main__":
    main()
