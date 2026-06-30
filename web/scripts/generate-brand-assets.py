from __future__ import annotations

from pathlib import Path
from shutil import copyfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BRAND_SRC = ROOT / "src" / "assets" / "brand"
PUBLIC_BRAND = ROOT / "public" / "brand"
GH_DIR = ROOT.parent / ".github"

SOURCE_RENDER = BRAND_SRC / "product-render-source.png"
LOGO_SVG = BRAND_SRC / "isolapurr-logo.svg"
PUBLIC_LOGO_SVG = PUBLIC_BRAND / "isolapurr-logo.svg"
LOGO_PNG = PUBLIC_BRAND / "isolapurr-logo.png"
POSTER = PUBLIC_BRAND / "isolapurr-product-poster.png"
SOCIAL = GH_DIR / "social-preview.png"
PUBLIC_SOCIAL = PUBLIC_BRAND / "github-social-preview.png"


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    preferred = (
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
        if weight == "bold"
        else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
    )
    for path in preferred:
        candidate = Path(path)
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


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


def add_gradient_overlay(image: Image.Image, strength: int) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    pixels = overlay.load()
    width, height = image.size
    for x in range(width):
        for y in range(height):
            horizontal = max(0.0, 1.0 - x / (width * 0.62))
            vertical = max(0.0, 1.0 - y / (height * 1.25))
            alpha = int(strength * min(1.0, horizontal * 0.82 + vertical * 0.18))
            pixels[x, y] = (247, 246, 239, alpha)
    return Image.alpha_composite(image.convert("RGBA"), overlay)


def rounded_rect(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    radius: int,
    fill: tuple[int, int, int, int],
) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def fit_text(
    draw: ImageDraw.ImageDraw, text: str, max_width: int, start_size: int
) -> ImageFont.FreeTypeFont:
    size = start_size
    while size >= 24:
        candidate = font(size, "bold")
        bbox = draw.textbbox((0, 0), text, font=candidate)
        if bbox[2] - bbox[0] <= max_width:
            return candidate
        size -= 2
    return font(24, "bold")


def generate_logo_png() -> None:
    PUBLIC_BRAND.mkdir(parents=True, exist_ok=True)
    if not LOGO_SVG.exists():
        raise SystemExit(f"missing logo svg: {LOGO_SVG}")
    copyfile(LOGO_SVG, PUBLIC_LOGO_SVG)
    canvas = Image.new("RGBA", (1520, 480), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((108, 108, 340, 340), radius=54, fill=(163, 198, 185, 255))
    draw.rounded_rectangle((140, 157, 307, 281), radius=40, fill=(246, 238, 217, 255))
    draw.rounded_rectangle((159, 192, 289, 241), radius=23, fill=(39, 50, 48, 255))
    draw.rounded_rectangle((184, 209, 265, 222), radius=7, fill=(247, 241, 223, 255))
    draw.rounded_rectangle((181, 260, 267, 267), radius=4, fill=(125, 217, 233, 214))
    draw.text((456, 132), "IsolaPurr", font=font(116, "bold"), fill=(32, 48, 45, 255))
    draw.text((462, 250), "USB Hub", font=font(68, "bold"), fill=(32, 48, 45, 255))
    canvas.save(LOGO_PNG)


def generate_social(source: Image.Image) -> None:
    GH_DIR.mkdir(parents=True, exist_ok=True)
    image = cover_crop(source, (1280, 640), anchor_x=0.54)
    image = add_gradient_overlay(image, strength=235)
    draw = ImageDraw.Draw(image)
    title_font = fit_text(draw, "IsolaPurr USB Hub", 560, 70)
    draw.text((78, 86), "IsolaPurr USB Hub", font=title_font, fill=(30, 46, 43, 255))
    draw.text((82, 168), "isolated USB-C power control", font=font(42, "bold"), fill=(64, 83, 78, 255))
    draw.text((84, 226), "Wi-Fi / Web Serial / Local USB", font=font(36), fill=(82, 101, 97, 255))
    draw.line((84, 292, 430, 292), fill=(119, 186, 174, 255), width=8)
    badge_x = 84
    badge_font = font(23, "bold")
    for label in ("USB-C", "USB-A", "PD", "ESP32-S3"):
        text_box = draw.textbbox((0, 0), label, font=badge_font)
        badge_w = text_box[2] - text_box[0] + 30
        rounded_rect(
            draw,
            (badge_x, 334, badge_x + badge_w, 374),
            16,
            (255, 250, 238, 210),
        )
        draw.text(
            (badge_x + 15, 343),
            label,
            font=badge_font,
            fill=(36, 54, 50, 255),
        )
        badge_x += badge_w + 20
    output = image.convert("RGB")
    output.save(SOCIAL, quality=94)
    output.save(PUBLIC_SOCIAL, quality=94)


def generate_poster(source: Image.Image) -> None:
    image = cover_crop(source, (1440, 1920), anchor_x=0.62)
    image = add_gradient_overlay(image, strength=245)
    draw = ImageDraw.Draw(image)
    draw.text((96, 120), "IsolaPurr", font=font(92, "bold"), fill=(30, 46, 43, 255))
    draw.text((100, 224), "USB Hub", font=font(74, "bold"), fill=(30, 46, 43, 255))
    draw.text(
        (104, 334),
        "Isolated downstream power, controllable USB-C routing,\nand a workbench console for hardware iteration.",
        font=font(38, "bold"),
        fill=(64, 83, 78, 255),
        spacing=12,
    )
    draw.line((104, 502, 520, 502), fill=(119, 186, 174, 255), width=10)
    panel = Image.new("RGBA", image.size, (0, 0, 0, 0))
    panel_draw = ImageDraw.Draw(panel)
    rounded_rect(panel_draw, (96, 1540, 1344, 1768), 34, (255, 250, 238, 222))
    panel = panel.filter(ImageFilter.GaussianBlur(0.2))
    image = Image.alpha_composite(image, panel)
    draw = ImageDraw.Draw(image)
    features = (
        "USB-C upstream + isolated downstream rails",
        "PWA, desktop shell, and released host tools",
        "ESP32-S3 firmware with Web Serial and LAN paths",
    )
    for idx, item in enumerate(features):
        y = 1592 + idx * 52
        draw.ellipse((132, y + 4, 152, y + 24), fill=(97, 170, 158, 255))
        draw.text((176, y - 2), item, font=font(36), fill=(36, 54, 50, 255))
    image.convert("RGB").save(POSTER, quality=94)


def main() -> None:
    if not SOURCE_RENDER.exists():
        raise SystemExit(f"missing product render source: {SOURCE_RENDER}")
    source = Image.open(SOURCE_RENDER).convert("RGB")
    generate_logo_png()
    generate_social(source)
    generate_poster(source)
    print(LOGO_PNG)
    print(POSTER)
    print(SOCIAL)


if __name__ == "__main__":
    main()
