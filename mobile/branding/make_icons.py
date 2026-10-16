"""Draws the DastaVault app icon and writes the Android launcher icons.

Run from mobile/: python3 branding/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

RES = Path(__file__).resolve().parent.parent / "android/app/src/main/res"
S = 1024  # drawing size

# Brand gradient of the web app (indigo -> violet -> pink).
# Primary colour of the logo (favicon.svg).
BRAND = (91, 79, 230)

STOPS = [(0.0, (79, 70, 229)), (0.55, (139, 92, 246)), (1.0, (219, 39, 119))]


def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
                if t0 <= t <= t1:
                    f = (t - t0) / (t1 - t0)
                    px[x, y] = tuple(round(a + (b - a) * f) for a, b in zip(c0, c1))
                    break
    return img


def glyph(size, scale=1.0):
    """The logo of the app (frontend/src/components/common/Logo.jsx): white
    shapes on the brand colour, drawn on a 64 x 64 grid like the SVG."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = size / 64 * scale
    off = size / 2 - 32 * u  # keeps the logo centred when scaled down
    def p(x, y):
        return (off + x * u, off + y * u)
    white = (255, 255, 255, 242)  # opacity 0.95
    # "M22 18h14a10 10 0 0 1 0 20H22z": a bar with a round right end
    d.rectangle([p(22, 18), p(36, 38)], fill=white)
    d.pieslice([p(26, 18), p(46, 38)], 270, 90, fill=white)
    # "M22 38h20v8H22z" at opacity 0.7
    d.rectangle([p(22, 38), p(42, 46)], fill=(255, 255, 255, 178))
    # circle at 44,44 r5
    d.ellipse([p(39, 39), p(49, 49)], fill=(255, 255, 255, 255))
    return img


def full_icon(size, round_shape=False):
    bg = Image.new("RGBA", (S, S), BRAND + (255,))
    # The logo's square is 52/64 of the canvas; the icon is the square itself.
    bg.alpha_composite(glyph(S, scale=64 / 52))
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    if round_shape:
        md.ellipse([0, 0, S - 1, S - 1], fill=255)
    else:
        md.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.22, fill=255)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(bg, mask=mask)
    return out.resize((size, size), Image.LANCZOS)


def foreground(size):
    # Adaptive icons show the middle 66 %: the glyph is drawn smaller.
    # Adaptive icons show the middle 66 %: the logo fits inside it.
    return glyph(S, scale=0.62 * 64 / 52).resize((size, size), Image.LANCZOS)


DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for name, scale in DENSITIES.items():
    folder = RES / f"mipmap-{name}"
    folder.mkdir(parents=True, exist_ok=True)
    full_icon(round(48 * scale)).save(folder / "ic_launcher.png")
    full_icon(round(48 * scale), round_shape=True).save(folder / "ic_launcher_round.png")
    foreground(round(108 * scale)).save(folder / "ic_launcher_foreground.png")

# Background of the adaptive icon: the brand colour.
(RES / "drawable").mkdir(exist_ok=True)
Image.new("RGB", (432, 432), BRAND).save(RES / "drawable/ic_launcher_background_gradient.png")
full_icon(512).save(Path(__file__).resolve().parent / "icon-512.png")
# The web app (PWA) uses the same icon.
WEB = Path(__file__).resolve().parent.parent.parent / "frontend/public/icons"
full_icon(512).save(WEB / "icon-512.png")
full_icon(192).save(WEB / "icon-192.png")
print("icons written")
