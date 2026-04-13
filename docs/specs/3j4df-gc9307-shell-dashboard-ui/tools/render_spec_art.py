#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
ASSETS.mkdir(parents=True, exist_ok=True)

PALETTE = {
    'canvas': '#F8FBFD',
    'mist': '#D8EEF6',
    'mist2': '#C6DAE5',
    'aqua': '#4BA6C3',
    'aqua_deep': '#377895',
    'ink': '#214457',
    'ink_soft': '#6E8491',
    'silver': '#BDC6D0',
    'shell': '#E9CFC4',
    'berry': '#B9495A',
    'warning': '#D58A63',
    'ok': '#3E96AE',
    'line': '#D6E5ED',
    'card': '#FFFFFF',
}

# T147BG-C08-06 mechanical drawing, page 5:
# the AA is labeled 32.83 mm × 17.65 mm, but the corner itself is not called
# out with an explicit "R..." value. The nearby 0.97 dimension should not be
# treated as a confirmed radius. For owner-facing preview art we therefore use
# a slightly larger fitted clip radius that better matches the visible contour
# in the drawing and the user's readability feedback.
DISPLAY_PREVIEW_RADIUS_PX = 14

FONT_CANDIDATES = [
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Trebuchet MS.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/SFNS.ttf',
]


def rgb(value):
    if isinstance(value, tuple):
        return value
    value = value.lstrip('#')
    return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))


def rgba(value, a: int):
    return (*rgb(value), a)


def font(size: int, bold: bool = False):
    for path in FONT_CANDIDATES:
        p = Path(path)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size=size)
            except Exception:
                pass
    return ImageFont.load_default()


def rounded_panel(base: Image.Image, box, radius, fill, outline=None, outline_w=1, shadow=None):
    x0, y0, x1, y1 = box
    if shadow:
        sx, sy, blur, color = shadow
        sh = Image.new('RGBA', base.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(sh)
        d.rounded_rectangle((x0 + sx, y0 + sy, x1 + sx, y1 + sy), radius=radius, fill=color)
        sh = sh.filter(ImageFilter.GaussianBlur(blur))
        base.alpha_composite(sh)
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=outline_w)
    base.alpha_composite(layer)


def rounded_mask(size, radius):
    mask = Image.new('L', size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def paste_rounded(base: Image.Image, overlay: Image.Image, xy, radius):
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    mask = rounded_mask(overlay.size, radius)
    layer.paste(overlay, xy, mask)
    base.alpha_composite(layer)


def mask_dashboard_asset(path: Path):
    img = Image.open(path).convert('RGBA')
    mask = rounded_mask(img.size, DISPLAY_PREVIEW_RADIUS_PX)
    rounded = Image.new('RGBA', img.size, (0, 0, 0, 0))
    rounded.paste(img, (0, 0), mask)
    rounded.save(path)
    return rounded


def draw_chip(draw, box, text, fill, fg, stroke=None, font_obj=None):
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=(y1 - y0) // 2, fill=fill, outline=stroke, width=1 if stroke else 0)
    font_obj = font_obj or font(max(12, (y1 - y0) - 8), bold=True)
    bbox = draw.textbbox((0, 0), text, font=font_obj)
    tx = x0 + (x1 - x0 - (bbox[2] - bbox[0])) / 2
    ty = y0 + (y1 - y0 - (bbox[3] - bbox[1])) / 2 - 1
    draw.text((tx, ty), text, font=font_obj, fill=fg)


def wrap_text(draw, text, font_obj, max_width, max_lines=None):
    lines = []
    current = ""
    for ch in text:
        candidate = current + ch
        bbox = draw.textbbox((0, 0), candidate, font=font_obj)
        width = bbox[2] - bbox[0]
        if width <= max_width or not current:
            current = candidate
            continue
        lines.append(current)
        current = ch
        if max_lines and len(lines) >= max_lines - 1:
            break

    if current:
        remainder = text[len("".join(lines)):]
        if max_lines and len(lines) >= max_lines:
            remainder = ""
        if max_lines and len(lines) == max_lines - 1:
            ellipsis = ""
            trial = remainder
            while trial:
                bbox = draw.textbbox((0, 0), trial + "…", font=font_obj)
                if bbox[2] - bbox[0] <= max_width:
                    ellipsis = trial + "…"
                    break
                trial = trial[:-1]
            lines.append(ellipsis or current)
        else:
            lines.append(remainder or current)
    return [line for line in lines if line]


def draw_wrapped_text(draw, xy, text, font_obj, fill, max_width, line_spacing=6, max_lines=None):
    lines = wrap_text(draw, text, font_obj, max_width, max_lines=max_lines)
    x, y = xy
    line_h = font_obj.size + line_spacing
    for idx, line in enumerate(lines):
        draw.text((x, y + idx * line_h), line, font=font_obj, fill=fill)
    return len(lines) * line_h - line_spacing if lines else 0


def measure_wrapped_text_height(draw, text, font_obj, max_width, line_spacing=6, max_lines=None):
    lines = wrap_text(draw, text, font_obj, max_width, max_lines=max_lines)
    if not lines:
        return 0
    return len(lines) * (font_obj.size + line_spacing) - line_spacing


def add_bokeh(base: Image.Image, circles: list[tuple[int, int, int, int]]):
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x, y, r, a in circles:
        d.ellipse((x - r, y - r, x + r, y + r), fill=rgba(PALETTE['mist'], a))
    layer = layer.filter(ImageFilter.GaussianBlur(14))
    base.alpha_composite(layer)


def make_background(size):
    w, h = size
    img = Image.new('RGBA', size, rgb(PALETTE['canvas']) + (255,))
    px = img.load()
    c0 = rgb(PALETTE['canvas'])
    c1 = rgb(PALETTE['mist'])
    c2 = rgb(PALETTE['mist2'])
    for y in range(h):
        for x in range(w):
            t = min(1.0, max(0.0, (x * 0.55 + y * 1.2) / (w * 0.75 + h * 1.2)))
            u = min(1.0, max(0.0, (x * 1.1 - y * 0.45 + h * 0.2) / (w * 1.2)))
            r = int(c0[0] * (1 - t) + c1[0] * t * 0.8 + c2[0] * u * 0.18)
            g = int(c0[1] * (1 - t) + c1[1] * t * 0.8 + c2[1] * u * 0.18)
            b = int(c0[2] * (1 - t) + c1[2] * t * 0.8 + c2[2] * u * 0.18)
            px[x, y] = (r, g, b, 255)
    add_bokeh(img, [
        (w // 5, h // 6, 120, 120),
        (w // 3, h // 3, 160, 90),
        (w // 2, h // 4, 130, 70),
        (w // 8, h * 3 // 4, 140, 90),
        (w * 3 // 4, h // 6, 150, 60),
    ])
    gloss = Image.new('RGBA', size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.polygon([(0, h * 2 // 3), (w // 7, h), (0, h)], fill=rgba('#FFFFFF', 120))
    gd.ellipse((w * 4 // 5 - 160, -80, w * 4 // 5 + 260, 220), outline=rgba(PALETTE['shell'], 90), width=3)
    gd.arc((w * 3 // 5 - 80, h // 3, w * 3 // 5 + 240, h // 3 + 180), 190, 360, fill=rgba(PALETTE['silver'], 120), width=2)
    gloss = gloss.filter(ImageFilter.GaussianBlur(1))
    img.alpha_composite(gloss)
    return img


def dashboard_example(scale=4):
    W, H = 320 * scale, 172 * scale
    img = make_background((W, H))
    d = ImageDraw.Draw(img)

    # Decorative left wash
    left = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(left)
    ld.ellipse((-80 * scale // 4, 8 * scale, 170 * scale, 210 * scale), fill=rgba(PALETTE['mist'], 110))
    ld.ellipse((W - 180 * scale, -20 * scale, W + 60 * scale, 140 * scale), fill=rgba(PALETTE['shell'], 55))
    left = left.filter(ImageFilter.GaussianBlur(18))
    img.alpha_composite(left)

    rounded_panel(
        img,
        (10 * scale, 10 * scale, W - 10 * scale, H - 10 * scale),
        radius=18 * scale,
        fill=rgba('#FFFFFF', 104),
        outline=rgba(PALETTE['line'], 150),
        outline_w=max(1, scale),
        shadow=(0, 10 * scale // 4, 12 * scale // 4, rgba(PALETTE['aqua_deep'], 24)),
    )

    # Header
    d.rounded_rectangle((24 * scale, 20 * scale, 36 * scale, 32 * scale), radius=6 * scale, fill=PALETTE['aqua'])
    d.text((42 * scale, 12 * scale), 'Dashboard', font=font(14 * scale, bold=True), fill=PALETTE['ink'])
    d.text((42 * scale, 30 * scale), 'Shell-linked Pearl Aqua system', font=font(7 * scale), fill=PALETTE['ink_soft'])
    draw_chip(d, (W - 90 * scale, 18 * scale, W - 26 * scale, 36 * scale), 'ONLINE', rgba(PALETTE['aqua'], 40), PALETTE['aqua_deep'], stroke=rgba(PALETTE['aqua_deep'], 60), font_obj=font(7 * scale, bold=True))

    # Cards
    card_y0 = 48 * scale
    card_h = 88 * scale
    gap = 8 * scale
    pad = 16 * scale
    card_w = (W - 24 * scale - gap - 24 * scale) // 2
    card1 = (12 * scale, card_y0, 12 * scale + card_w, card_y0 + card_h)
    card2 = (card1[2] + gap, card_y0, card1[2] + gap + card_w, card_y0 + card_h)
    for box, accent in ((card1, PALETTE['aqua']), (card2, PALETTE['berry'])):
        rounded_panel(img, box, radius=12 * scale, fill=rgba('#FFFFFF', 220), outline=rgba(accent, 80), outline_w=max(1, scale), shadow=(0, 8 * scale // 4, 10 * scale // 4, rgba(PALETTE['aqua_deep'], 20)))
        ix0, iy0, ix1, iy1 = box
        d.rounded_rectangle((ix0 + 1 * scale, iy0 + 1 * scale, ix1 - 1 * scale, iy0 + 20 * scale), radius=12 * scale, fill=rgba(accent, 26))
        d.line((ix0 + 12 * scale, iy1 - 18 * scale, ix1 - 12 * scale, iy1 - 18 * scale), fill=rgba(PALETTE['line'], 220), width=max(1, scale))

    def port_card(box, title, badge, badge_fill, voltage, current, power, accent):
        x0, y0, x1, y1 = box
        d.text((x0 + 12 * scale, y0 + 8 * scale), title, font=font(8 * scale, bold=True), fill=PALETTE['ink'])
        draw_chip(d, (x1 - 60 * scale, y0 + 7 * scale, x1 - 12 * scale, y0 + 22 * scale), badge, rgba(badge_fill, 38), badge_fill, stroke=rgba(badge_fill, 60), font_obj=font(6 * scale, bold=True))
        d.text((x0 + 12 * scale, y0 + 28 * scale), voltage, font=font(18 * scale, bold=True), fill=PALETTE['ink'])
        d.text((x0 + 12 * scale, y0 + 54 * scale), f'Current  {current}', font=font(8 * scale), fill=PALETTE['ink_soft'])
        d.text((x0 + 12 * scale, y0 + 70 * scale), f'Power    {power}', font=font(8 * scale), fill=accent)
        # signal line
        d.rounded_rectangle((x0 + 12 * scale, y1 - 12 * scale, x1 - 12 * scale, y1 - 8 * scale), radius=2 * scale, fill=rgba(PALETTE['mist2'], 130))
        d.rounded_rectangle((x0 + 12 * scale, y1 - 12 * scale, x0 + 12 * scale + int((x1 - x0 - 24 * scale) * 0.68), y1 - 8 * scale), radius=2 * scale, fill=accent)

    port_card(card1, 'USB-A', '5V', rgb(PALETTE['aqua']), '5.03V', '0.48A', '2.4W', PALETTE['aqua_deep'])
    port_card(card2, 'PD', '20V', rgb(PALETTE['berry']), '20.1V', '3.12A', '62.7W', PALETTE['berry'])

    # Footer
    footer = (12 * scale, 144 * scale, W - 12 * scale, 160 * scale)
    rounded_panel(img, footer, radius=8 * scale, fill=rgba('#FFFFFF', 188), outline=rgba(PALETTE['line'], 170), outline_w=max(1, scale))
    draw_chip(d, (20 * scale, 147 * scale, 82 * scale, 157 * scale), 'TOTAL 65.1W', rgba(PALETTE['aqua'], 34), PALETTE['aqua_deep'], stroke=rgba(PALETTE['aqua_deep'], 50), font_obj=font(5 * scale, bold=True))
    d.text((96 * scale, 146 * scale), 'Dual-port glance-first telemetry · soft pearl contrast', font=font(6 * scale), fill=PALETTE['ink_soft'])
    d.text((W - 84 * scale, 146 * scale), 'THEME 01', font=font(6 * scale, bold=True), fill=PALETTE['berry'])

    # Soft gloss kept away from key metrics
    shine = Image.new('RGBA', img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shine)
    sd.ellipse((8 * scale, 12 * scale, 80 * scale, 72 * scale), fill=rgba('#FFFFFF', 70))
    shine = shine.filter(ImageFilter.GaussianBlur(8))
    img.alpha_composite(shine)
    return img


def render_poster(dashboard_path: Path):
    W, H = 1600, 900
    img = make_background((W, H))
    d = ImageDraw.Draw(img)
    board = (54, 48, W - 54, H - 48)

    # Main board
    rounded_panel(img, board, radius=34, fill=rgba('#FFFFFF', 180), outline=rgba(PALETTE['line'], 170), outline_w=2, shadow=(0, 12, 20, rgba(PALETTE['aqua_deep'], 24)))

    # Left text column
    d.text((110, 102), 'GC9307 Shell Dashboard UI', font=font(42, bold=True), fill=PALETTE['ink'])
    draw_wrapped_text(
        d,
        (110, 156),
        '把外壳原图里的「珍珠白 / 水雾青 / 绶带莓红 / 暖米金」收进屏幕，让硬件界面和外观成为同一套气质。',
        font(20),
        PALETTE['ink_soft'],
        max_width=520,
        line_spacing=8,
        max_lines=3,
    )

    d.text((110, 260), 'Color Tokens', font=font(24, bold=True), fill=PALETTE['ink'])
    swatches = [
        ('Canvas', PALETTE['canvas']),
        ('Mist', PALETTE['mist']),
        ('Aqua', PALETTE['aqua']),
        ('Deep Aqua', PALETTE['aqua_deep']),
        ('Shell', PALETTE['shell']),
        ('Berry', PALETTE['berry']),
    ]
    x, y = 110, 300
    for i, (label, color) in enumerate(swatches):
        yy = y + i * 58
        d.rounded_rectangle((x, yy, x + 58, yy + 38), radius=14, fill=color)
        d.text((x + 76, yy + 6), f'{label}  {color.upper()}', font=font(20, bold=(i in {2,3,5})), fill=PALETTE['ink'])

    rules = [
        '• 320×172 横屏；双卡片直接占主体，不预留全局标题栏',
        '• 相同信息只能出现一次；重复汇总一律砍掉',
        '• 主数据优先级：V / A / W 永远先于任何装饰或标签',
        '• 文本必须满足基线、留白、宽度与溢出降级规则',
    ]
    rules_title_font = font(24, bold=True)
    rules_body_font = font(16)
    rules_max_width = 510
    rules_top = y + (len(swatches) - 1) * 58 + 38 + 28
    title_bbox = d.textbbox((0, 0), 'Layout Rules', font=rules_title_font)
    title_h = title_bbox[3] - title_bbox[1]
    rule_heights = [
        measure_wrapped_text_height(d, rule, rules_body_font, rules_max_width, line_spacing=2, max_lines=2)
        for rule in rules
    ]
    rules_content_h = sum(rule_heights) + 8 * (len(rule_heights) - 1)
    rules_panel_bottom = rules_top + 20 + title_h + 16 + rules_content_h + 18
    if rules_panel_bottom > board[3] - 16:
        raise RuntimeError(f'Layout Rules panel overflow: bottom={rules_panel_bottom}, board_bottom={board[3]}')
    rules_panel = (92, rules_top, 650, rules_panel_bottom)
    rounded_panel(img, rules_panel, radius=24, fill=rgba('#FFFFFF', 138), outline=rgba(PALETTE['line'], 155), outline_w=2)
    title_y = rules_top + 20
    d.text((110, title_y), 'Layout Rules', font=rules_title_font, fill=PALETTE['ink'])
    yy = title_y + title_h + 16
    for idx, rule in enumerate(rules):
        used_h = draw_wrapped_text(
            d,
            (110, yy),
            rule,
            rules_body_font,
            PALETTE['ink_soft'],
            max_width=rules_max_width,
            line_spacing=2,
            max_lines=2,
        )
        if used_h != rule_heights[idx]:
            raise RuntimeError(f'Rules height mismatch for rule {idx}')
        yy += used_h + 8
    if yy - 8 > rules_panel[3] - 18:
        raise RuntimeError(f'Layout Rules text overflow after draw: content_bottom={yy - 8}, panel_bottom={rules_panel[3]}')

    # Device preview right
    panel = (730, 112, 1458, 812)
    rounded_panel(img, panel, radius=28, fill=rgba('#FFFFFF', 168), outline=rgba(PALETTE['line'], 160), outline_w=2, shadow=(0, 10, 18, rgba(PALETTE['aqua_deep'], 28)))
    d.text((772, 146), 'Dashboard Example', font=font(28, bold=True), fill=PALETTE['ink'])
    draw_wrapped_text(
        d,
        (772, 184),
        '规范图中的示例展示：默认运行态只保留端口名、短状态标签与 V / A / W 读数本体，所有常驻文字都必须正常可读。',
        font(18),
        PALETTE['ink_soft'],
        max_width=620,
        line_spacing=7,
        max_lines=3,
    )

    dash = mask_dashboard_asset(dashboard_path)
    dash = dash.resize((640, 344), Image.Resampling.LANCZOS)
    preview_box = (760, 226, 1444, 614)
    rounded_panel(
        img,
        preview_box,
        radius=30,
        fill=rgba('#FFFFFF', 128),
        outline=rgba(PALETTE['line'], 175),
        outline_w=2,
        shadow=(0, 8, 14, rgba(PALETTE['aqua_deep'], 18)),
    )
    px_radius = round(DISPLAY_PREVIEW_RADIUS_PX * (dash.size[0] / 320))
    screen_x = preview_box[0] + (preview_box[2] - preview_box[0] - dash.size[0]) // 2
    screen_y = preview_box[1] + (preview_box[3] - preview_box[1] - dash.size[1]) // 2

    screen_shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(screen_shadow)
    sd.rounded_rectangle(
        (screen_x + 6, screen_y + 10, screen_x + dash.size[0] + 6, screen_y + dash.size[1] + 10),
        radius=px_radius + 2,
        fill=rgba(PALETTE['aqua_deep'], 30),
    )
    screen_shadow = screen_shadow.filter(ImageFilter.GaussianBlur(10))
    img.alpha_composite(screen_shadow)
    paste_rounded(img, dash, (screen_x, screen_y), px_radius)
    d.rounded_rectangle(
        (screen_x, screen_y, screen_x + dash.size[0], screen_y + dash.size[1]),
        radius=px_radius,
        outline=rgba('#FFFFFF', 190),
        width=2,
    )
    d.rounded_rectangle(
        (screen_x - 1, screen_y - 1, screen_x + dash.size[0] + 1, screen_y + dash.size[1] + 1),
        radius=px_radius + 1,
        outline=rgba(PALETTE['line'], 160),
        width=1,
    )

    preview_margin_samples = [
        (preview_box[0] + 12, (preview_box[1] + preview_box[3]) // 2),
        (preview_box[2] - 12, (preview_box[1] + preview_box[3]) // 2),
    ]
    for point in preview_margin_samples:
        r, g, b, _ = img.getpixel(point)
        if (r + g + b) / 3 < 160:
            raise RuntimeError(f'Preview bezel unexpectedly dark at {point}: {(r, g, b)}')

    # Right-bottom callouts
    callouts = [
        ('Data first', '双口的 V / A / W 直接占主体，第一眼只能看到关键读数。', PALETTE['aqua_deep']),
        ('Hardware fit', 'USB-A / OFF / PD 标题胶囊必须有更强浅色底与描边，不能融进白卡片。', PALETTE['aqua']),
        ('Shell palette', 'RGB565 实屏优先保对比度，再保留珍珠白、水雾青、莓红气质。', PALETTE['berry']),
    ]
    callout_body_font = font(14)
    callout_heights = [
        measure_wrapped_text_height(d, body, callout_body_font, 168, line_spacing=4, max_lines=4)
        for _, body, _ in callouts
    ]
    callout_h = 44 + max(callout_heights) + 18
    box_y = 634
    if box_y + callout_h > panel[3] - 20:
        raise RuntimeError(f'Callout cards overflow: bottom={box_y + callout_h}, panel_bottom={panel[3]}')
    for idx, (title, body, accent) in enumerate(callouts):
        x0 = 772 + idx * 210
        rounded_panel(img, (x0, box_y, x0 + 200, box_y + callout_h), radius=18, fill=rgba('#FFFFFF', 180), outline=rgba(accent, 70), outline_w=2)
        d.rounded_rectangle((x0 + 16, box_y + 14, x0 + 36, box_y + 34), radius=10, fill=accent)
        d.text((x0 + 48, box_y + 10), title, font=font(18, bold=True), fill=PALETTE['ink'])
        used_h = draw_wrapped_text(
            d,
            (x0 + 16, box_y + 44),
            body,
            callout_body_font,
            PALETTE['ink_soft'],
            max_width=168,
            line_spacing=4,
            max_lines=4,
        )
        if used_h > callout_h - 62:
            raise RuntimeError(f'Callout text overflow for "{title}": used={used_h}, available={callout_h - 62}')
    return img


def main():
    dashboard_path = ASSETS / 'gc9307-shell-dashboard-example.png'
    if not dashboard_path.exists():
        raise FileNotFoundError(f'Missing firmware preview: {dashboard_path}')

    poster = render_poster(dashboard_path)
    poster_path = ASSETS / 'gc9307-shell-dashboard-intro.png'
    poster.save(poster_path)
    print(dashboard_path)
    print(poster_path)


if __name__ == '__main__':
    main()
