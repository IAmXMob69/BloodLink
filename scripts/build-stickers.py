#!/usr/bin/env python3
"""Build built-in BloodLink sticker packs (transparent PNG, Telegram-sized)."""

from __future__ import annotations

import json
import math
import subprocess
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
ICON = ROOT / "assets" / "icon.png"
SEED = ROOT / "server" / "seed-stickers"
GEN = None  # optional rebuild dir: BLOODLINK_STICKER_SRC
SIZE = 512


def flood_key(im: Image.Image, is_bg, neighbors=4) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()

    def push(x, y):
        if 0 <= x < w and 0 <= y < h and not seen[y * w + x]:
            seen[y * w + x] = 1
            q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    offs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    if neighbors == 8:
        offs = offs + ((1, 1), (1, -1), (-1, 1), (-1, -1))

    while q:
        x, y = q.popleft()
        r, g, b, a = px[x, y]
        if a == 0 or not is_bg(r, g, b, a):
            continue
        px[x, y] = (r, g, b, 0)
        for dx, dy in offs:
            push(x + dx, y + dy)
    return im


def feather_alpha(im: Image.Image, radius: float = 1.2) -> Image.Image:
    a = im.getchannel("A").filter(ImageFilter.GaussianBlur(radius))
    out = im.copy()
    out.putalpha(a)
    return out


def trim_alpha(im: Image.Image, pad: int = 8) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(im.width, r + pad)
    b = min(im.height, b + pad)
    return im.crop((l, t, r, b))


def fit_square(im: Image.Image, size: int = SIZE, margin: int = 28) -> Image.Image:
    im = trim_alpha(im, 4)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    box = size - margin * 2
    im.thumbnail((box, box), Image.Resampling.LANCZOS)
    x = (size - im.width) // 2
    y = (size - im.height) // 2
    canvas.alpha_composite(im, (x, y))
    return canvas


def extract_drop() -> Image.Image:
    """Keep only the glossy crimson drop; drop the app-icon plate and rim."""
    im = Image.open(ICON).convert("RGBA")
    w, h = im.size
    px = im.load()
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            red = r > 70 and r >= g + 18 and r >= b + 12 and (r - min(g, b)) > 28
            hi = r > 170 and g > 130 and b > 110 and r >= g - 8 and (r + g) > b + 80
            if red or hi:
                mp[x, y] = 255
    # largest blob = the drop
    seen = bytearray(w * h)
    best = []
    for y in range(h):
        for x in range(w):
            if mp[x, y] < 128 or seen[y * w + x]:
                continue
            blob = []
            q = deque([(x, y)])
            seen[y * w + x] = 1
            while q:
                cx, cy = q.popleft()
                blob.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and mp[nx, ny] >= 128:
                        seen[ny * w + nx] = 1
                        q.append((nx, ny))
            if len(blob) > len(best):
                best = blob
    keep = set(best)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for x, y in keep:
        op[x, y] = px[x, y]
    out = feather_alpha(out, 0.6)
    return fit_square(out, SIZE, 40)


def extract_generated(src: Path) -> Image.Image:
    im = Image.open(src).convert("RGBA")
    px = im.load()
    w, h = im.size
    samples = [
        px[4, 4][:3],
        px[w - 5, 4][:3],
        px[4, h - 5][:3],
        px[w - 5, h - 5][:3],
        px[w // 2, 4][:3],
        px[4, h // 2][:3],
    ]

    def dist(a, b):
        return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))

    def is_bg(r, g, b, a):
        if a < 8:
            return True
        if any(dist((r, g, b), s) < 52 for s in samples):
            return True
        # leftover magenta / hot pink field
        if r > 170 and b > 90 and g < 150 and (r + b) / 2 - g > 36 and r - g > 25:
            return True
        return False

    cut = flood_key(im, is_bg, neighbors=8)
    cut = feather_alpha(cut, 0.7)
    return fit_square(cut, SIZE, 24)


def drop_face(kind: str) -> Image.Image:
    """Draw a face overlay sized for the glossy drop belly."""
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = 256, 318

    def eye(x, y, rx=22, ry=28, highlight=True):
        d.ellipse((x - rx, y - ry, x + rx, y + ry), fill=(28, 18, 18, 255))
        if highlight:
            d.ellipse((x - 8, y - ry + 8, x + 4, y - ry + 22), fill=(255, 255, 255, 230))

    def blush(x, y):
        blush = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        bd = ImageDraw.Draw(blush)
        bd.ellipse((x - 22, y - 10, x + 22, y + 12), fill=(255, 120, 140, 110))
        layer.alpha_composite(blush.filter(ImageFilter.GaussianBlur(2)))

    def smile(width=54, open_=False):
        box = (cx - width, cy + 18, cx + width, cy + 70)
        if open_:
            d.pieslice(box, 15, 165, fill=(40, 20, 24, 255))
            d.pieslice((cx - width + 10, cy + 28, cx + width - 10, cy + 64), 20, 160, fill=(90, 30, 40, 255))
        else:
            d.arc(box, 20, 160, fill=(40, 20, 24, 255), width=7)

    def frown():
        d.arc((cx - 40, cy + 34, cx + 40, cy + 78), 200, 340, fill=(40, 20, 24, 255), width=7)

    def brow(x, y, tilt):
        d.line((x - 22, y + tilt, x + 22, y - tilt), fill=(40, 20, 24, 255), width=7)

    def heart(x, y, s=16, color=(230, 40, 60, 255)):
        d.ellipse((x - s, y - s // 2, x, y + s // 2 + 2), fill=color)
        d.ellipse((x, y - s // 2, x + s, y + s // 2 + 2), fill=color)
        d.polygon([(x - s, y + 2), (x + s, y + 2), (x, y + s + 10)], fill=color)

    def tear(x, y):
        d.ellipse((x - 10, y, x + 10, y + 28), fill=(120, 190, 255, 230))
        d.polygon([(x, y - 10), (x - 10, y + 10), (x + 10, y + 10)], fill=(120, 190, 255, 230))
        d.ellipse((x - 3, y + 8, x + 2, y + 14), fill=(255, 255, 255, 200))

    if kind == "hello":
        eye(cx - 38, cy - 8)
        eye(cx + 38, cy - 8)
        smile()
        blush(cx - 70, cy + 18)
        blush(cx + 70, cy + 18)
    elif kind == "wink":
        eye(cx - 38, cy - 8)
        d.arc((cx + 18, cy - 16, cx + 58, cy + 8), 200, 340, fill=(28, 18, 18, 255), width=8)
        smile(48)
        blush(cx + 72, cy + 16)
    elif kind == "love":
        heart(cx - 40, cy - 10, 18)
        heart(cx + 40, cy - 10, 18)
        smile(46)
        blush(cx - 74, cy + 20)
        blush(cx + 74, cy + 20)
        heart(90, 150, 14, (255, 70, 90, 230))
        heart(400, 180, 12, (255, 80, 100, 210))
        heart(360, 110, 10, (255, 90, 110, 200))
    elif kind == "laugh":
        eye(cx - 40, cy - 18, 20, 10, False)
        eye(cx + 40, cy - 18, 20, 10, False)
        d.arc((cx - 42, cy - 28, cx - 18, cy - 4), 20, 160, fill=(28, 18, 18, 255), width=7)
        d.arc((cx + 18, cy - 28, cx + 42, cy - 4), 20, 160, fill=(28, 18, 18, 255), width=7)
        smile(62, open_=True)
        blush(cx - 78, cy + 8)
        blush(cx + 78, cy + 8)
    elif kind == "cry":
        eye(cx - 36, cy - 4, 20, 24)
        eye(cx + 36, cy - 4, 20, 24)
        frown()
        tear(cx - 36, cy + 22)
        tear(cx + 36, cy + 22)
        d.ellipse((cx - 10, cy + 56, cx + 10, cy + 78), fill=(110, 185, 255, 200))
    elif kind == "angry":
        brow(cx - 40, cy - 38, 10)
        brow(cx + 40, cy - 38, -10)
        eye(cx - 36, cy - 2, 20, 24)
        eye(cx + 36, cy - 2, 20, 24)
        frown()
    elif kind == "sleepy":
        d.arc((cx - 58, cy - 16, cx - 18, cy + 8), 200, 340, fill=(28, 18, 18, 255), width=8)
        d.arc((cx + 18, cy - 16, cx + 58, cy + 8), 200, 340, fill=(28, 18, 18, 255), width=8)
        d.arc((cx - 28, cy + 20, cx + 28, cy + 52), 20, 160, fill=(40, 20, 24, 255), width=6)
        for i, ch in enumerate("zzz"):
            d.text((340 + i * 22, 120 - i * 18), ch, fill=(255, 230, 230, 230))
    elif kind == "shock":
        eye(cx - 40, cy - 12, 26, 32)
        eye(cx + 40, cy - 12, 26, 32)
        d.ellipse((cx - 22, cy + 22, cx + 22, cy + 72), fill=(40, 20, 24, 255))
        d.ellipse((cx - 12, cy + 40, cx + 12, cy + 64), fill=(90, 30, 40, 255))
    elif kind == "cool":
        d.rounded_rectangle((cx - 92, cy - 28, cx + 92, cy + 22), radius=14, fill=(20, 20, 24, 255))
        d.ellipse((cx - 78, cy - 22, cx - 10, cy + 18), fill=(40, 80, 140, 255))
        d.ellipse((cx + 10, cy - 22, cx + 78, cy + 18), fill=(40, 80, 140, 255))
        d.ellipse((cx - 60, cy - 14, cx - 40, cy), fill=(200, 230, 255, 180))
        d.ellipse((cx + 28, cy - 14, cx + 48, cy), fill=(200, 230, 255, 180))
        d.rectangle((cx - 12, cy - 8, cx + 12, cy + 4), fill=(20, 20, 24, 255))
        smile(36)
    elif kind == "party":
        eye(cx - 38, cy - 4)
        eye(cx + 38, cy - 4)
        smile(52, open_=True)
        hat = [(256, 70), (330, 210), (182, 210)]
        d.polygon(hat, fill=(255, 196, 40, 255), outline=(30, 18, 18, 255))
        d.ellipse((238, 52, 274, 90), fill=(255, 70, 110, 255), outline=(30, 18, 18, 255))
        d.polygon([(256, 70), (300, 160), (256, 150)], fill=(255, 120, 40, 220))
        for x, y, col in (
            (90, 140, (90, 200, 255, 230)),
            (400, 160, (255, 90, 160, 230)),
            (120, 220, (120, 230, 90, 220)),
            (390, 240, (255, 210, 50, 230)),
            (80, 300, (200, 90, 255, 210)),
        ):
            d.rectangle((x, y, x + 14, y + 22), fill=col)
    elif kind == "think":
        eye(cx - 36, cy - 10)
        eye(cx + 36, cy - 10)
        d.arc((cx - 8, cy + 16, cx + 48, cy + 58), 20, 200, fill=(40, 20, 24, 255), width=7)
        d.ellipse((360, 150, 430, 210), fill=(255, 255, 255, 230), outline=(40, 20, 24, 200))
        d.ellipse((348, 208, 378, 238), fill=(255, 255, 255, 220), outline=(40, 20, 24, 180))
        d.ellipse((332, 236, 350, 254), fill=(255, 255, 255, 210), outline=(40, 20, 24, 160))
        d.text((378, 168), "?", fill=(40, 20, 24, 255))
    elif kind == "ok":
        eye(cx - 38, cy - 8)
        eye(cx + 38, cy - 8)
        smile()
        # little OK hand on the right
        d.ellipse((360, 300, 470, 410), fill=(244, 196, 164, 255), outline=(30, 18, 18, 255))
        d.ellipse((388, 318, 430, 360), fill=(0, 0, 0, 0), outline=(30, 18, 18, 255), width=7)
    else:
        eye(cx - 38, cy - 8)
        eye(cx + 38, cy - 8)
        smile()
    return layer


def wave_arm() -> Image.Image:
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.polygon([(360, 300), (455, 210), (480, 240), (390, 330)], fill=(228, 50, 58, 255), outline=(90, 16, 22, 255))
    d.ellipse((430, 170, 505, 250), fill=(244, 196, 164, 255), outline=(30, 18, 18, 255))
    return layer


def thumbs_arm() -> Image.Image:
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((368, 250, 455, 360), radius=24, fill=(244, 196, 164, 255), outline=(30, 18, 18, 255), width=4)
    d.rounded_rectangle((400, 168, 448, 268), radius=18, fill=(244, 196, 164, 255), outline=(30, 18, 18, 255), width=4)
    return layer


def compose_drop(base: Image.Image, kind: str) -> Image.Image:
    out = base.copy()
    if kind == "wave":
        out.alpha_composite(wave_arm())
        out.alpha_composite(drop_face("hello"))
    elif kind == "thumb":
        out.alpha_composite(thumbs_arm())
        out.alpha_composite(drop_face("hello"))
    else:
        out.alpha_composite(drop_face(kind))
    return out


def render_svg(svg: str, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".svg")
    tmp.write_text(svg, encoding="utf-8")
    subprocess.check_call(["rsvg-convert", "-w", str(SIZE), "-h", str(SIZE), str(tmp), "-o", str(dest)])
    tmp.unlink(missing_ok=True)
    im = Image.open(dest).convert("RGBA")
    fit_square(im, SIZE, 16).save(dest, "PNG")


def svg_wrap(inner: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="4" flood-color="#000" flood-opacity="0.18"/>
    </filter>
  </defs>
  <g filter="url(#s)">{inner}</g>
</svg>"""


PUNCH_SVG = {
    "laugh": (
        "😂",
        """
    <circle cx="256" cy="256" r="168" fill="#FFD54A" stroke="#1a1210" stroke-width="16"/>
    <ellipse cx="190" cy="200" rx="28" ry="16" fill="#1a1210"/>
    <ellipse cx="322" cy="200" rx="28" ry="16" fill="#1a1210"/>
    <path d="M150 268c20 70 192 70 212 0" fill="#1a1210"/>
    <path d="M176 274c16 46 144 46 160 0" fill="#E85A4F"/>
    <ellipse cx="256" cy="292" rx="34" ry="18" fill="#F3C6B8"/>
    <circle cx="148" cy="250" r="22" fill="#FF8A80" opacity=".85"/>
    <circle cx="364" cy="250" r="22" fill="#FF8A80" opacity=".85"/>
    """,
    ),
    "star": (
        "⭐",
        """
    <polygon points="256,70 300,198 436,198 326,276 368,406 256,328 144,406 186,276 76,198 212,198"
      fill="#FFD54A" stroke="#1a1210" stroke-width="16" stroke-linejoin="round"/>
    <polygon points="256,120 284,200 368,200 300,248 324,328 256,282 188,328 212,248 144,200 228,200"
      fill="#FFE082"/>
    """,
    ),
    "zap": (
        "⚡",
        """
    <polygon points="292,56 148,262 236,262 196,456 372,214 276,214"
      fill="#FFD54A" stroke="#1a1210" stroke-width="16" stroke-linejoin="round"/>
    <polygon points="280,96 180,258 250,258 226,390 340,228 274,228" fill="#FFF59D"/>
    """,
    ),
    "moon": (
        "🌙",
        """
    <path d="M300 86c-86 10-150 84-150 174 0 96 78 174 174 174 46 0 88-18 120-46
             C390 430 286 386 286 270 286 168 356 92 300 86z"
      fill="#FFE082" stroke="#1a1210" stroke-width="16"/>
    <circle cx="250" cy="230" r="10" fill="#E0C060"/>
    <circle cx="300" cy="300" r="16" fill="#E0C060"/>
    <circle cx="236" cy="320" r="8" fill="#E0C060"/>
    <circle cx="272" cy="214" r="7" fill="#1a1210"/>
    <path d="M292 250c8 12 24 12 32 0" fill="none" stroke="#1a1210" stroke-width="8" stroke-linecap="round"/>
    """,
    ),
    "party": (
        "🎉",
        """
    <polygon points="186,360 326,360 256,96" fill="#7C4DFF" stroke="#1a1210" stroke-width="14" stroke-linejoin="round"/>
    <polygon points="256,96 300,280 256,268" fill="#B388FF"/>
    <rect x="168" y="352" width="176" height="36" rx="12" fill="#FFD54A" stroke="#1a1210" stroke-width="10"/>
    <circle cx="120" cy="160" r="12" fill="#FF5252"/>
    <circle cx="390" cy="140" r="10" fill="#40C4FF"/>
    <circle cx="400" cy="240" r="8" fill="#69F0AE"/>
    <rect x="96" y="220" width="16" height="28" rx="3" fill="#FFD54A" transform="rotate(-20 104 234)"/>
    <rect x="380" y="300" width="16" height="28" rx="3" fill="#FF80AB" transform="rotate(24 388 314)"/>
    """,
    ),
    "hundred": (
        "💯",
        """
    <rect x="70" y="150" width="372" height="220" rx="36" fill="#FF5252" stroke="#1a1210" stroke-width="16"/>
    <text x="256" y="300" text-anchor="middle" font-size="150" font-family="Arial Black, sans-serif"
      font-weight="800" fill="#FFF8E1">100</text>
    """,
    ),
}


def write_pack(slug: str, name: str, description: str, items: list[tuple[str, str, Path]]):
    d = SEED / slug
    d.mkdir(parents=True, exist_ok=True)
    stickers = []
    cover = None
    for i, (stem, emoji, src) in enumerate(items):
        dest = d / f"{i+1:02d}-{stem}.png"
        im = Image.open(src).convert("RGBA") if src.suffix.lower() != ".png" or src.parent != d else Image.open(src)
        if src != dest:
            im.save(dest, "PNG")
        stickers.append({"file": dest.name, "emoji": emoji})
        if cover is None:
            cover = dest.name
    (d / "pack.json").write_text(
        json.dumps(
            {
                "slug": slug,
                "name": name,
                "description": description,
                "cover": cover,
                "stickers": stickers,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {slug}: {len(stickers)} stickers")


def main():
    SEED.mkdir(parents=True, exist_ok=True)
    drop = extract_drop()
    drop_dir = SEED / "droplet"
    drop_dir.mkdir(parents=True, exist_ok=True)
    drop_specs = [
        ("hello", "👋"),
        ("wave", "👋"),
        ("wink", "😉"),
        ("love", "😍"),
        ("laugh", "😂"),
        ("cry", "😢"),
        ("angry", "😠"),
        ("sleepy", "😴"),
        ("shock", "😲"),
        ("cool", "😎"),
        ("party", "🥳"),
        ("think", "🤔"),
        ("thumb", "👍"),
        ("ok", "👌"),
    ]
    drop_items = []
    for i, (kind, emoji) in enumerate(drop_specs):
        dest = drop_dir / f"{i+1:02d}-{kind}.png"
        compose_drop(drop, kind).save(dest, "PNG")
        drop_items.append((kind, emoji, dest))
    write_pack("droplet", "Droplet", "The official BloodLink drop.", drop_items)

    punch_dir = SEED / "punch"
    punch_dir.mkdir(parents=True, exist_ok=True)
    punch_items = []
    generated = [
        ("thumbs", "👍", GEN / "5.jpg"),
        ("heart", "❤️", GEN / "3.jpg"),
        ("fire", "🔥", GEN / "4.jpg"),
        ("cry", "😭", GEN / "8.jpg"),
        ("clap", "👏", GEN / "7.jpg"),
        ("skull", "💀", GEN / "6.jpg"),
    ]
    for i, (stem, emoji, src) in enumerate(generated):
        dest = punch_dir / f"{i+1:02d}-{stem}.png"
        extract_generated(src).save(dest, "PNG")
        punch_items.append((stem, emoji, dest))

    start = len(punch_items)
    for j, (stem, (emoji, inner)) in enumerate(PUNCH_SVG.items()):
        dest = punch_dir / f"{start+j+1:02d}-{stem}.png"
        render_svg(svg_wrap(inner), dest)
        punch_items.append((stem, emoji, dest))

    write_pack("punch", "Punch", "Big reactions. Tap to send.", punch_items)


if __name__ == "__main__":
    main()
