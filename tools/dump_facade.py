"""Recreate the ORIGINAL facade texture with Pillow (same code as
scene/textures.py:facade_texture) and report its stats, for comparison with the
browser canvas version.
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reference')


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def facade(base_rgb=(20, 18, 52),
           lit_rgbs=((255, 110, 176), (96, 226, 255)),
           width=192, height=512, seed=29):
    from PIL import Image, ImageDraw

    rng = random.Random(seed)
    image = Image.new('RGB', (width, height), base_rgb)
    draw = ImageDraw.Draw(image)
    cols, rows = 4, 8
    cell_w, cell_h = width / cols, height / rows
    for col in range(cols):
        if rng.random() < 0.25:
            continue
        for row in range(1, rows - 2):
            if rng.random() < 0.45:
                continue
            rgb = rng.choice(lit_rgbs)
            pad_x, pad_y = cell_w * 0.20, cell_h * 0.24
            x0 = col * cell_w + pad_x
            y0 = row * cell_h + pad_y
            draw.rectangle([x0, y0, x0 + cell_w - 2 * pad_x, y0 + cell_h - 2 * pad_y],
                           fill=mix(rgb, base_rgb, rng.uniform(0.30, 0.70)))
    draw.rectangle([0, 0, width - 1, 3], fill=(255, 84, 130))
    return image


def main():
    image = facade()
    os.makedirs(OUT, exist_ok=True)
    image.save(os.path.join(OUT, 'facade_py.png'))
    pixels = list(image.convert('RGB').getdata())
    avg = sum(sum(p) / 3 for p in pixels) / len(pixels)
    mx = max(sum(p) / 3 for p in pixels)
    lit = sum(1 for p in pixels if sum(p) / 3 > 60)
    print(f'facade {image.size} avg={avg:.1f} max={mx:.1f} lit_pixels={lit} ({lit * 100 / len(pixels):.1f}%)')


if __name__ == '__main__':
    main()
