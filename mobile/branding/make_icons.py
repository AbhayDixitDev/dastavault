"""Draws the DastaVault app icon and writes the Android launcher icons.

Run from mobile/: python3 branding/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

RES = Path(__file__).resolve().parent.parent / "android/app/src/main/res"
S = 1024  # drawing size

# Brand gradient of the web app (indigo -> violet -> pink).
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


def glyph(size):
    """A white document with a folded corner and a lock: documents kept safe."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = size / 100
    # page
    left, top, right, bottom, fold = 28 * u, 18 * u, 72 * u, 82 * u, 14 * u
    d.rounded_rectangle([left, top, right, bottom], radius=7 * u, fill=(255, 255, 255, 255))
    d.polygon([(right - fold, top), (right, top), (right, top + fold)], fill=(0, 0, 0, 0))
    d.polygon([(right - fold, top), (right, top + fold), (right - fold, top + fold)], fill=(220, 214, 255, 255))
    # text lines
    for i, w in enumerate([28, 22, 26]):
        y = 34 * u + i * 8 * u
        d.rounded_rectangle([36 * u, y, (36 + w) * u, y + 3.6 * u], radius=1.8 * u, fill=(139, 132, 246, 255))
    # lock
    cx, cy = 58 * u, 68 * u
    d.rounded_rectangle([cx - 11 * u, cy - 4 * u, cx + 11 * u, cy + 13 * u], radius=4 * u, fill=(79, 70, 229, 255))
    d.arc([cx - 7 * u, cy - 14 * u, cx + 7 * u, cy + 2 * u], 180, 360, fill=(79, 70, 229, 255), width=round(3.6 * u))
    d.ellipse([cx - 2.6 * u, cy + 1.5 * u, cx + 2.6 * u, cy + 6.7 * u], fill=(255, 255, 255, 255))
    return img


def full_icon(size, round_shape=False):
    bg = gradient(S).convert("RGBA")
    g = glyph(S)
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 70), mask=g.split()[3])
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    bg.alpha_composite(shadow, (0, 14))
    bg.alpha_composite(g)
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
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    g = glyph(round(S * 0.62))
    off = (S - g.width) // 2
    canvas.alpha_composite(g, (off, off))
    return canvas.resize((size, size), Image.LANCZOS)


DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for name, scale in DENSITIES.items():
    folder = RES / f"mipmap-{name}"
    folder.mkdir(parents=True, exist_ok=True)
    full_icon(round(48 * scale)).save(folder / "ic_launcher.png")
    full_icon(round(48 * scale), round_shape=True).save(folder / "ic_launcher_round.png")
    foreground(round(108 * scale)).save(folder / "ic_launcher_foreground.png")

# Background of the adaptive icon: the gradient as a drawable.
(RES / "drawable").mkdir(exist_ok=True)
gradient(432).save(RES / "drawable/ic_launcher_background_gradient.png")
full_icon(512).save(Path(__file__).resolve().parent / "icon-512.png")
print("icons written")
