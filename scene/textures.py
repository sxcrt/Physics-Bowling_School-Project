"""Procedurally generated textures for the environment.

Everything here is painted in code with Pillow, so the game ships no image
files and the palette stays in :mod:`config`. Textures are cached by their
arguments, because a texture is built once and shared by every entity that
wants it.
"""
import math
import os
import random

from ursina import Texture

import config

_CACHE = {}


def _cached(key, builder):
    if key not in _CACHE:
        _CACHE[key] = builder()
    return _CACHE[key]


def _sharpen(texture, anisotropic=8):
    """Keep a texture sharp when it is seen at a grazing angle.

    The lane is looked at almost edge-on, so the along-lane compression drives
    mip selection and blurs the plank seams away with plain trilinear
    filtering. Anisotropic sampling fixes exactly that.
    """
    panda_texture = getattr(texture, '_texture', None)
    if panda_texture is not None:
        try:
            panda_texture.setAnisotropicDegree(anisotropic)
        except AttributeError:
            pass
    return texture


def _shade(rgb, factor):
    return tuple(max(0, min(255, round(channel * factor))) for channel in rgb)


def _mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


# ---------------------------------------------------------------------------
# Lane wood
# ---------------------------------------------------------------------------
def wood_texture(boards=39, width=512, height=2048, base=None,
                 grain=0.10, sheen=0.55, seed=7):
    """A varnished lane surface: boards, grain, seams and a lane sheen.

    ``u`` runs across the lane (one board per band) and ``v`` along it, so the
    seams and the grain follow the lane exactly like a real maple deck.
    """
    key = ('wood', boards, width, height, base, grain, sheen, seed)

    def build():
        from PIL import Image, ImageDraw

        base_rgb = base if base is not None else config.LANE_COLOR
        dark_rgb = config.LANE_PLANK_DARK
        rng = random.Random(seed)
        image = Image.new('RGB', (width, height), base_rgb)
        draw = ImageDraw.Draw(image)

        for board in range(boards):
            x0 = round(board * width / boards)
            x1 = round((board + 1) * width / boards)
            # Board-to-board tone variation, plus a slightly darker edge board.
            tone = rng.uniform(-0.15, 0.12)
            edge = min(board, boards - 1 - board)
            if edge < 2:
                tone -= 0.10
            draw.rectangle([x0, 0, x1 - 1, height], fill=_shade(base_rgb, 1.0 + tone))

            # Grain: fine strokes running the length of the board.
            strokes = rng.randint(3, 6)
            for _ in range(strokes):
                u = rng.uniform(x0, max(x0, x1 - 1))
                drift = rng.uniform(-0.6, 0.6)
                shade = _shade(base_rgb, 1.0 + tone + rng.uniform(-grain, grain))
                points = []
                for step in range(0, height + 1, max(1, height // 26)):
                    points.append((u + math.sin(step / height * math.pi * 3) * 1.2
                                   + drift * step / height, step))
                draw.line(points, fill=shade, width=1)

            # Seam between this board and the next.
            draw.line([(x0, 0), (x0, height)], fill=_mix(base_rgb, dark_rgb, 0.6),
                      width=1)
            draw.line([(x0 + 1, 0), (x0 + 1, height)],
                      fill=_mix(base_rgb, dark_rgb, 0.28), width=1)
            draw.line([(x1 - 1, 0), (x1 - 1, height)],
                      fill=_mix(base_rgb, dark_rgb, 0.22), width=1)

        # A few knots, so the grain is not obviously repetitive.
        for _ in range(max(0, boards // 12)):
            cx, cy = rng.uniform(0, width), rng.uniform(0, height)
            r = rng.uniform(2.0, 5.0)
            draw.ellipse([cx - r, cy - r * 1.6, cx + r, cy + r * 1.6],
                         fill=_shade(base_rgb, 0.72))

        # Lane sheen: the oiled middle of the deck is brighter and glossier
        # than the edges. Painted per column, so it fades smoothly.
        for x in range(width):
            across = (x + 0.5) / width
            middle = math.exp(-((across - 0.5) ** 2) / (2 * 0.22 ** 2))
            brightness = 1.0 + sheen * middle
            column = image.crop((x, 0, x + 1, height)).point(
                lambda value, f=brightness: min(255, int(value * f)))
            image.paste(column, (x, 0))

        # Varnish grain: a touch of monochrome noise, so it is not banded.
        noise = Image.effect_noise((width, height), 14).convert('RGB')
        image = Image.blend(image, noise, 0.05)
        return _sharpen(Texture(image))

    return _cached(key, build)


def approach_texture(width=256, height=1024, seed=11):
    """The approach: the same boards, darker and more scuffed."""
    return wood_texture(boards=39, width=width, height=height,
                        base=config.APPROACH_COLOR, grain=0.12,
                        sheen=0.18, seed=seed)


# ---------------------------------------------------------------------------
# Flat colours, gradients and glows
# ---------------------------------------------------------------------------
def gradient_texture(top_rgb, bottom_rgb, width=8, height=256):
    """A vertical gradient (``v = 1`` at the top colour)."""
    key = ('gradient', top_rgb, bottom_rgb, width, height)

    def build():
        from PIL import Image, ImageDraw

        image = Image.new('RGB', (width, height), bottom_rgb)
        draw = ImageDraw.Draw(image)
        for row in range(height):
            t = row / (height - 1)
            draw.line([(0, height - 1 - row), (width - 1, height - 1 - row)],
                      fill=_mix(bottom_rgb, top_rgb, t))
        return Texture(image)

    return _cached(key, build)


def glow_texture(rgb, size=128, power=1.8):
    """A soft radial glow: opaque in the middle, transparent at the rim."""
    key = ('glow', rgb, size, power)

    def build():
        from PIL import Image, ImageDraw

        image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        steps = size // 2
        # Drawn from the rim inwards; each smaller disc replaces the centre of
        # the previous one, so the alpha ramps up towards the middle.
        for step in range(steps, 0, -1):
            alpha = round(255 * (1.0 - step / steps) ** power)
            draw.ellipse([size / 2 - step, size / 2 - step,
                          size / 2 + step, size / 2 + step],
                         fill=(rgb[0], rgb[1], rgb[2], alpha))
        return Texture(image)

    return _cached(key, build)


def ball_texture():
    """The energy ball: a deep blue sphere with a cyan crackle across it."""
    key = ('ball',)

    def build():
        from PIL import Image, ImageDraw

        size = 512
        rng = random.Random(3)
        image = Image.new('RGB', (size, size), config.BALL_COLOR)
        draw = ImageDraw.Draw(image)

        # A soft glow towards the top, so the ball reads as lit from above.
        for row in range(size):
            t = row / (size - 1)
            factor = 0.62 + 1.05 * (1.0 - t) ** 1.7
            draw.line([(0, row), (size - 1, row)],
                      fill=_shade(config.BALL_COLOR, factor))

        # Crackle: branching filaments in the accent colour. Drawn big, because
        # the ball is only ~90 px across on screen and thin lines just alias
        # into noise.
        accent = config.BALL_ACCENT_COLOR
        for _ in range(34):
            x, y = rng.uniform(0, size), rng.uniform(0, size)
            angle = rng.uniform(0, 2 * math.pi)
            points = [(x, y)]
            for _ in range(rng.randint(4, 9)):
                angle += rng.uniform(-0.7, 0.7)
                length = rng.uniform(30, 70)
                x += math.cos(angle) * length
                y += math.sin(angle) * length
                points.append((x, y))
                if not (-60 <= x <= size + 60 and -60 <= y <= size + 60):
                    break
            if len(points) < 2:
                continue
            draw.line(points, fill=_shade(accent, rng.uniform(0.75, 1.0)),
                      width=7)
            draw.line(points, fill=_shade(accent, 1.15), width=3)
            draw.line(points, fill=(238, 252, 255), width=1)

        # A few short, bright bolts on top of the wide filaments.
        for _ in range(40):
            x, y = rng.uniform(0, size), rng.uniform(0, size)
            angle = rng.uniform(0, 2 * math.pi)
            points = [(x, y)]
            for _ in range(rng.randint(2, 4)):
                angle += rng.uniform(-0.6, 0.6)
                x += math.cos(angle) * rng.uniform(14, 30)
                y += math.sin(angle) * rng.uniform(14, 30)
                points.append((x, y))
            draw.line(points, fill=(226, 250, 255), width=2)
        return Texture(image)

    return _cached(key, build)


# ---------------------------------------------------------------------------
# Signage (optional: needs a system font)
# ---------------------------------------------------------------------------
_FONT_CANDIDATES = (
    r'C:\Windows\Fonts\impact.ttf',
    r'C:\Windows\Fonts\arialbd.ttf',
    r'C:\Windows\Fonts\Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
)


def _load_font(size):
    from PIL import ImageFont

    for path in _FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return None


def sign_texture(text='HELLS BALLS', rgb=config.WALL_TRIM_COLOR,
                 width=768, height=192, font_size=104):
    """A neon sign plate, or ``None`` when no usable font is installed."""
    key = ('sign', text, rgb, width, height, font_size)

    def build():
        from PIL import Image, ImageDraw

        font = _load_font(font_size)
        if font is None:
            return None
        image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        box = draw.textbbox((0, 0), text, font=font)
        x = (width - (box[2] - box[0])) / 2 - box[0]
        y = (height - (box[3] - box[1])) / 2 - box[1]
        # Tube glow: a wide dim halo, then the tube itself, then a hot core.
        for grow, factor in ((6, 0.30), (3, 0.55), (1, 1.0)):
            colour = _shade(rgb, factor)
            draw.text((x, y), text, font=font, fill=colour + (110,),
                      stroke_width=grow, stroke_fill=colour + (70,))
        draw.text((x, y), text, font=font, fill=(255, 245, 250, 255))
        return Texture(image)

    return _cached(key, build)


def city_skyline_texture(width=2688, height=640, seed=17):
    """A flat neon night skyline: the backdrop behind the pin deck.

    Simple rectangles only - a gradient sky, stars, a cratered moon and three
    depth layers of buildings with lit windows, neon bars and signs - so the
    view down the lane reads as the illustrated city in the art rather than
    as the inside of a hall.
    """
    key = ('city', width, height, seed)

    def build():
        from PIL import Image, ImageDraw

        rng = random.Random(seed)
        image = Image.new('RGB', (width, height), (10, 12, 44))
        draw = ImageDraw.Draw(image)

        # Sky: deep indigo at the top, violet towards the skyline.
        for y in range(height):
            t = min(1.0, y / (height - 1) * 1.7)
            draw.line([(0, y), (width - 1, y)],
                      fill=_mix((10, 12, 44), (72, 46, 124), t))

        # Stars.
        for _ in range(120):
            x = rng.uniform(0, width)
            y = rng.uniform(0, height * 0.72)
            side = rng.choice((1, 1, 1, 2))
            tone = rng.randint(170, 255)
            draw.rectangle([x, y, x + side, y + side],
                           fill=(tone, tone, 255))

        def windows(x0, y0, x1, y1, rgb, chance, cell=15, gap=14, pull=0.5):
            for wy in range(int(y0), int(y1) - cell, cell + gap):
                for wx in range(int(x0), int(x1) - cell, cell + gap):
                    if rng.random() < chance:
                        colour = _mix(rgb, (14, 12, 36),
                                      rng.uniform(0.10, pull))
                        draw.rectangle([wx, wy, wx + cell, wy + cell],
                                       fill=colour)

        def tower(x0, x1, top, rgb, win_rgb, chance, neon=None):
            draw.rectangle([x0, top, x1, height], fill=rgb)
            windows(x0 + 9, top + 14, x1 - 7, height - 10, win_rgb, chance)
            if neon is not None:
                draw.rectangle([x0, top, x1, top + 3], fill=neon)

        # Back layer: hazy towers with a few lit windows.
        x = -40
        while x < width:
            w = rng.randint(70, 150)
            top = rng.uniform(height * 0.30, height * 0.60)
            tower(x, x + w, top, (32, 27, 74), (118, 94, 182), 0.02)
            x += w + rng.randint(8, 30)

        # Middle layer: the main skyline, with antennae and a skybridge.
        x = -60
        while x < width:
            w = rng.randint(90, 180)
            top = rng.uniform(height * 0.36, height * 0.70)
            neon = rng.choice((None, None, (255, 96, 160), (96, 226, 255)))
            tower(x, x + w, top, (23, 20, 58), (240, 112, 170), 0.045, neon)
            if rng.random() < 0.35:
                ax = (2 * x + w) / 2
                draw.rectangle([ax - 1, top - rng.randint(30, 76), ax + 1, top],
                               fill=(30, 26, 64))
                draw.rectangle([ax - 3, top - 9, ax + 3, top - 2],
                               fill=(255, 70, 96))
            x += w + rng.randint(14, 44)

        # Moon: a pale disc, a faint halo and two craters. Drawn above the
        # far skyline but behind the near towers, so it hangs in the sky.
        mx, my, mr = width * 0.33, height * 0.28, height * 0.125
        draw.ellipse([mx - mr * 1.45, my - mr * 1.45,
                      mx + mr * 1.45, my + mr * 1.45], fill=(44, 40, 90))
        draw.ellipse([mx - mr, my - mr, mx + mr, my + mr],
                     fill=(218, 220, 252))
        draw.ellipse([mx - mr * 0.62, my - mr * 0.52,
                      mx - mr * 0.08, my + mr * 0.04], fill=(200, 200, 242))
        draw.ellipse([mx + mr * 0.14, my + mr * 0.20,
                      mx + mr * 0.58, my + mr * 0.60], fill=(204, 204, 244))

        # Skybridge between two towers, with a sagging cable.
        bx0, bx1 = width * 0.55, width * 0.70
        by = height * 0.54
        draw.rectangle([bx0, by, bx1, by + 11], fill=(30, 26, 72))
        draw.rectangle([bx0, by, bx1, by + 2], fill=(96, 226, 255))
        for step in range(1, 14):
            t = step / 14.0
            cx = bx0 + (bx1 - bx0) * t
            cy = by + 24 + 30 * math.sin(math.pi * t)
            draw.rectangle([cx - 1, cy - 1, cx + 1, cy + 1],
                           fill=(118, 106, 188))

        # Front layer: larger, darker towers framing the lane.
        x = -80
        while x < width:
            w = rng.randint(130, 260)
            top = rng.uniform(height * 0.46, height * 0.78)
            tower(x, x + w, top, (14, 12, 40), (240, 104, 168), 0.07,
                  rng.choice((None, (255, 84, 130), (96, 226, 255))))
            if rng.random() < 0.12:      # one big lit storefront panel
                bw = w * rng.uniform(0.24, 0.36)
                bh = height * rng.uniform(0.12, 0.20)
                bx = x + rng.uniform(w * 0.12, w - bw - w * 0.12)
                by2 = top + rng.uniform(height * 0.06, height * 0.16)
                draw.rectangle([bx, by2, bx + bw, by2 + bh],
                               fill=rng.choice(((206, 84, 138),
                                                (76, 176, 200))))
            x += w + rng.randint(24, 80)

        # A bowling-pin neon sign on the left and a ringed planet on the right.
        px, py = width * 0.30, height * 0.50
        pw, ph = width * 0.05, height * 0.30
        draw.rectangle([px - pw / 2, py - ph / 2, px + pw / 2, py + ph / 2],
                       fill=(54, 30, 74))
        draw.rectangle([px - pw / 2, py - ph / 2, px + pw / 2, py + ph / 2],
                       outline=(255, 96, 160), width=4)
        draw.ellipse([px - pw * 0.15, py - ph * 0.40,
                      px + pw * 0.15, py - ph * 0.24],
                     outline=(255, 200, 226), width=4)
        draw.ellipse([px - pw * 0.26, py - ph * 0.23,
                      px + pw * 0.26, py + ph * 0.06],
                     outline=(255, 200, 226), width=4)
        draw.ellipse([px - pw * 0.22, py + ph * 0.02,
                      px + pw * 0.22, py + ph * 0.30],
                     outline=(255, 200, 226), width=4)

        qx, qy = width * 0.64, height * 0.52
        qw, qh = width * 0.052, height * 0.28
        draw.rectangle([qx - qw / 2, qy - qh / 2, qx + qw / 2, qy + qh / 2],
                       fill=(26, 52, 76))
        draw.rectangle([qx - qw / 2, qy - qh / 2, qx + qw / 2, qy + qh / 2],
                       outline=(96, 226, 255), width=4)
        pr = qw * 0.20
        draw.ellipse([qx - pr, qy - pr, qx + pr, qy + pr],
                     outline=(180, 246, 255), width=4)
        draw.ellipse([qx - pr * 1.8, qy - pr * 0.55,
                      qx + pr * 1.8, qy + pr * 0.55],
                     outline=(96, 226, 255), width=3)
        return Texture(image)

    return _cached(key, build)


def facade_texture(base_rgb=(20, 18, 52),
                   lit_rgbs=((255, 110, 176), (96, 226, 255)),
                   width=192, height=512, seed=29):
    """One flat building facade: dark wall, lit window grid and neon trim.

    Used for the city buildings beside the lane, so a sideways glance reads as
    the street rather than as the inside of a hall. ``v = 1`` is the top edge,
    where a neon strip runs.
    """
    key = ('facade', base_rgb, tuple(lit_rgbs), width, height, seed)

    def build():
        from PIL import Image, ImageDraw

        rng = random.Random(seed)
        image = Image.new('RGB', (width, height), base_rgb)
        draw = ImageDraw.Draw(image)
        cols, rows = 4, 8
        cell_w, cell_h = width / cols, height / rows
        for col in range(cols):
            if rng.random() < 0.25:            # a dark column of the building
                continue
            for row in range(1, rows - 2):     # keep the ground floor dark
                if rng.random() < 0.45:
                    continue
                rgb = rng.choice(lit_rgbs)
                pad_x, pad_y = cell_w * 0.20, cell_h * 0.24
                x0 = col * cell_w + pad_x
                y0 = row * cell_h + pad_y
                draw.rectangle(
                    [x0, y0, x0 + cell_w - 2 * pad_x, y0 + cell_h - 2 * pad_y],
                    fill=_mix(rgb, base_rgb, rng.uniform(0.30, 0.70)))
        # Roof neon trim, so each building carries a lit edge like the art.
        draw.rectangle([0, 0, width - 1, 3], fill=(255, 84, 130))
        return Texture(image)

    return _cached(key, build)


def button_texture(rgb=(96, 226, 255), width=320, height=76, radius=13,
                   depth=0.45):
    """A clean rounded button plate: one gradient fill, one hairline rim.

    ``depth`` is how much accent colour is mixed into the dark fill - low for
    quiet rows, high for the single primary action of a screen. Nothing else
    is drawn on the plate: no inner outlines and no highlight bands, so the
    label on top is the only thing that reads. Hover feedback is the widget's
    job: it lifts a brighter copy of this plate and a soft halo behind it.
    """
    rgb = tuple(rgb)
    depth = max(0.0, min(1.0, float(depth)))
    key = ('button', rgb, width, height, radius, round(depth, 3))

    def build():
        from PIL import Image, ImageDraw

        top = _mix(config.WALL_COLOR, rgb, 0.15 + 0.85 * depth)
        bottom = _mix(config.BACKDROP_COLOR, rgb, 0.10 + 0.55 * depth)
        rim = _mix(rgb, (255, 255, 255), 0.30)
        rim_alpha = round(70 + 130 * depth)

        gradient = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(gradient)
        for y in range(height):
            t = y / max(1, height - 1)
            draw.line([(0, y), (width, y)], fill=_mix(top, bottom, t) + (255,))
        mask = Image.new('L', (width, height), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            (0, 0, width - 1, height - 1), radius=radius, fill=255)
        image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        image.paste(gradient, (0, 0), mask)
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((1, 1, width - 2, height - 2), radius=radius,
                               outline=rim + (rim_alpha,), width=2)
        return Texture(image)

    return _cached(key, build)


def ball_sprite(rgb=(34, 78, 200), size=256, motif=None,
                motif_rgb=(255, 255, 255), motif_size=None):
    """A shaded bowling-ball sprite (RGBA) for the menus and mode picker.

    Drawn with concentric ellipses (a radial gradient), a blurred specular
    highlight and a circular mask, so a UI quad shows a glossy ball instead of
    a square. ``motif`` draws a short glyph on the ball, which is how each game
    mode is identified in the picker. Returns ``None`` when Pillow is missing.
    """
    key = ('ball_sprite', tuple(rgb), size, motif, tuple(motif_rgb),
           motif_size)

    def build():
        from PIL import Image, ImageDraw, ImageFilter

        image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        # A circle inscribed in the sprite, with a thin margin for the glow.
        margin = size * 0.045
        centre = size / 2.0
        rings = 72
        for step in range(rings, 0, -1):
            fraction = step / float(rings)          # 1 at the rim -> 0 centre
            radius = (size / 2.0 - margin) * fraction
            # Brightness peaks slightly up-left of centre (the key light).
            light = 0.42 + 0.78 * (1.0 - fraction) ** 1.6
            offset_x = -radius * 0.16 * (1.0 - fraction)
            offset_y = -radius * 0.16 * (1.0 - fraction)
            colour = tuple(min(255, int(channel * light)) for channel in rgb)
            draw.ellipse((centre + offset_x - radius, centre + offset_y - radius,
                          centre + offset_x + radius, centre + offset_y + radius),
                         fill=colour + (255,))
        # Specular highlight: a small bright blob, blurred so it looks glossy.
        highlight = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        highlight_draw = ImageDraw.Draw(highlight)
        hx, hy = size * 0.36, size * 0.30
        hr = size * 0.075
        highlight_draw.ellipse((hx - hr, hy - hr * 0.72, hx + hr, hy + hr * 0.72),
                              fill=(255, 255, 255, 210))
        highlight = highlight.filter(ImageFilter.GaussianBlur(size * 0.02))
        image = Image.alpha_composite(image, highlight)
        # Motif glyph in the middle of the ball.
        if motif:
            font = _load_font(motif_size or int(size * 0.26))
            if font is not None:
                motif_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
                motif_draw = ImageDraw.Draw(motif_layer)
                text = str(motif)
                box_text = motif_draw.textbbox((0, 0), text, font=font)
                tx = centre - (box_text[2] - box_text[0]) / 2.0 - box_text[0]
                ty = centre - (box_text[3] - box_text[1]) / 2.0 - box_text[1]
                for grow, alpha in ((3, 90), (1, 170)):
                    motif_draw.text((tx, ty), text, font=font,
                                   fill=motif_rgb + (alpha,),
                                   stroke_width=grow,
                                   stroke_fill=(10, 8, 20, alpha))
                motif_draw.text((tx, ty), text, font=font,
                                fill=motif_rgb + (255,))
                image = Image.alpha_composite(image, motif_layer)
        return Texture(image)

    return _cached(key, build)


# ---------------------------------------------------------------------------
# UI plates, labels and icons
#
# The design system (``ui/theme.py``) builds every button, card, chip and panel
# out of the helpers below. They live here because they are painted with
# Pillow, next to the rest of the game's generated art:
#
# * :func:`rounded_texture` - a solid/gradient plate with rounded corners and
#   an optional solid bar across the top (the panels' accent rule).
# * :func:`rounded_mask_texture` - a white plate or ring the widget *tints*,
#   which is what makes one texture serve every colour and state.
# * :func:`rounded_dash_texture` - the same ring, dashed (keyboard focus).
# * :func:`text_texture` - a label rendered at an exact font size with exact
#   letter spacing, cropped to its ink so it is centred by construction.
# * :func:`icon_texture` - the mode icons, drawn as white vector masks.
# ---------------------------------------------------------------------------
try:                                                    # pragma: no cover
    import ursina as _ursina
    _URSUNA_FONTS = os.path.join(os.path.dirname(_ursina.__file__), 'fonts')
except Exception:                                       # pragma: no cover
    _URSUNA_FONTS = ''

UI_FONT_CANDIDATES = (
    os.path.join(_URSUNA_FONTS, 'OpenSans-Regular.ttf'),
    r'C:\Windows\Fonts\segoeui.ttf',
    r'C:\Windows\Fonts\arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
)


def _ui_font(size):
    """A truetype font at ``size`` pixels, or None when none is installed."""
    size = max(1, int(round(size)))
    key = ('ui-font', size)
    if key not in _CACHE:
        from PIL import ImageFont

        font = None
        for path in UI_FONT_CANDIDATES:
            if path and os.path.exists(path):
                try:
                    font = ImageFont.truetype(path, size)
                    break
                except OSError:
                    continue
        _CACHE[key] = font
    return _CACHE[key]


def _ui_texture(image, filtering='bilinear'):
    texture = Texture(image, filtering=filtering)
    return _sharpen(texture, 2)


def _rounded_mask(width, height, radius, supersample=3):
    """An antialiased `L` mask of a rounded rectangle."""
    from PIL import Image, ImageDraw

    width = max(1, int(round(width)))
    height = max(1, int(round(height)))
    radius = max(0.0, min(float(radius), min(width, height) / 2.0))
    scale = max(1, int(supersample))
    big = Image.new('L', (width * scale, height * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, width * scale - 1, height * scale - 1),
        radius=radius * scale, fill=255)
    return big.resize((width, height), Image.LANCZOS)


def rounded_texture(width, height, radius, rgb=(255, 255, 255), alpha=255,
                    top_rgb=None, top_height=0, top_alpha=255,
                    bottom_rgb=None, supersample=3):
    """A rounded plate: solid fill, or a vertical gradient when asked.

    ``top_rgb``/``top_height`` lay a solid bar across the top edge (clipped to
    the rounded shape), which is how the panels carry their accent rule.
    """
    rgb = tuple(rgb)
    bottom_rgb = tuple(bottom_rgb if bottom_rgb is not None else rgb)
    key = ('rounded', int(width), int(height), round(radius, 2), rgb,
           int(alpha), top_rgb, int(top_height), int(top_alpha), bottom_rgb,
           int(supersample))
    if key in _CACHE:
        return _CACHE[key]

    from PIL import Image, ImageChops, ImageDraw

    width_px, height_px = max(1, int(round(width))), max(1, int(round(height)))
    mask = _rounded_mask(width_px, height_px, radius, supersample)
    image = Image.new('RGBA', (width_px, height_px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if bottom_rgb == rgb:
        draw.rectangle((0, 0, width_px, height_px), fill=rgb + (int(alpha),))
    else:
        for row in range(height_px):
            t = row / max(1, height_px - 1)
            draw.line([(0, row), (width_px, row)],
                      fill=_mix(rgb, bottom_rgb, t) + (int(alpha),))
    if top_rgb is not None and top_height > 0:
        bar = max(1, int(round(top_height)))
        draw.rectangle((0, 0, width_px, bar),
                       fill=tuple(top_rgb) + (int(top_alpha),))
    # Multiply the rounded mask into the drawn alpha, so a translucent fill
    # keeps its own alpha and the corners still soften.
    image.putalpha(ImageChops.multiply(image.getchannel('A'), mask))
    texture = _ui_texture(image)
    _CACHE[key] = texture
    return texture


def rounded_mask_texture(width, height, radius, thickness=0,
                         supersample=3):
    """A white rounded plate (``thickness=0``) or ring, ready to be tinted."""
    key = ('rounded-mask', int(width), int(height), round(radius, 2),
           round(thickness, 2), int(supersample))
    if key in _CACHE:
        return _CACHE[key]

    from PIL import Image, ImageChops

    width_px, height_px = max(1, int(round(width))), max(1, int(round(height)))
    mask = _rounded_mask(width_px, height_px, radius, supersample)
    if thickness > 0:
        inset = max(1.0, float(thickness))
        inner = _rounded_mask(max(1, width_px - 2 * inset),
                              max(1, height_px - 2 * inset),
                              max(0.0, radius - inset), supersample)
        canvas = Image.new('L', (width_px, height_px), 0)
        canvas.paste(inner, (int(round(inset)), int(round(inset))))
        mask = ImageChops.subtract(mask, canvas)
    image = Image.new('RGBA', (width_px, height_px), (255, 255, 255, 0))
    image.putalpha(mask)
    texture = _ui_texture(image)
    _CACHE[key] = texture
    return texture


def rounded_dash_texture(width, height, radius, thickness=2, dash=6, gap=5,
                         supersample=3):
    """A dashed white rounded ring (the keyboard-focus outline)."""
    key = ('rounded-dash', int(width), int(height), round(radius, 2),
           round(thickness, 2), round(dash, 2), round(gap, 2))
    if key in _CACHE:
        return _CACHE[key]

    import math

    from PIL import Image, ImageDraw

    width_px = max(8, int(round(width)))
    height_px = max(8, int(round(height)))
    radius = max(0.0, min(float(radius), min(width_px, height_px) / 2.0))
    thickness = max(1, int(round(thickness)))
    left, top = thickness / 2.0, thickness / 2.0
    right, bottom = width_px - thickness / 2.0, height_px - thickness / 2.0
    radius = min(radius, (right - left) / 2.0, (bottom - top) / 2.0)

    points = []

    def arc(cx, cy, start, end, steps=14):
        for index in range(steps + 1):
            angle = math.radians(start + (end - start) * index / steps)
            points.append((cx + radius * math.cos(angle),
                           cy + radius * math.sin(angle)))

    points.append((left + radius, top))              # top-left corner end
    points.append((right - radius, top))             # top edge
    arc(right - radius, top + radius, -90.0, 0.0)    # top-right corner
    points.append((right, bottom - radius))          # right edge
    arc(right - radius, bottom - radius, 0.0, 90.0)  # bottom-right corner
    points.append((left + radius, bottom))           # bottom edge
    arc(left + radius, bottom - radius, 90.0, 180.0)  # bottom-left corner
    points.append((left, top + radius))              # left edge
    arc(left + radius, top + radius, 180.0, 270.0)   # top-left corner

    mask = Image.new('L', (width_px, height_px), 0)
    draw = ImageDraw.Draw(mask)
    period = max(2.0, float(dash) + float(gap))
    travelled = 0.0
    for index in range(len(points) - 1):
        x0, y0 = points[index]
        x1, y1 = points[index + 1]
        length = math.hypot(x1 - x0, y1 - y0)
        if length <= 0.0:
            continue
        steps = max(1, int(length * 2))
        for step in range(steps):
            t0, t1 = step / steps, (step + 1) / steps
            if (travelled + length * t1) % period <= float(dash):
                draw.line([(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0),
                           (x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1)],
                          fill=255, width=thickness)
        travelled += length
    image = Image.new('RGBA', (width_px, height_px), (255, 255, 255, 0))
    image.putalpha(mask)
    texture = _ui_texture(image)
    _CACHE[key] = texture
    return texture


def panel_texture(width, height, radius, fill_rgb=(20, 16, 46),
                  fill_alpha=0.92, border_left_rgb=(62, 201, 232),
                  border_right_rgb=(255, 61, 139), border_alpha=0.60,
                  border_px=1.0, supersample=3):
    """A panel plate: flat fill plus a 1px cyan->pink gradient border.

    This is the one panel look of the UI (replacing the old solid top rule):
    the fill is the #14102E panel at its own alpha, and the rim is a hairline
    that runs from cyan on the left to pink on the right, clipped to the
    rounded corner.
    """
    key = ('panel', int(width), int(height), round(radius, 2),
           tuple(fill_rgb), round(float(fill_alpha), 3),
           tuple(border_left_rgb), tuple(border_right_rgb),
           round(float(border_alpha), 3), round(float(border_px), 2),
           int(supersample))
    if key in _CACHE:
        return _CACHE[key]

    from PIL import Image, ImageChops, ImageDraw

    width_px = max(2, int(round(width)))
    height_px = max(2, int(round(height)))
    mask = _rounded_mask(width_px, height_px, radius, supersample)
    image = Image.new('RGBA', (width_px, height_px), (0, 0, 0, 0))
    fill = Image.new('RGBA', (width_px, height_px),
                     tuple(fill_rgb) + (int(round(255 * fill_alpha)),))
    fill.putalpha(ImageChops.multiply(fill.getchannel('A'), mask))
    image = Image.alpha_composite(image, fill)
    thickness = max(1.0, float(border_px))
    inner = _rounded_mask(max(1, int(round(width_px - 2 * thickness))),
                          max(1, int(round(height_px - 2 * thickness))),
                          max(0.0, radius - thickness), supersample)
    ring = mask.copy()
    ring.paste(0, (int(round(thickness)), int(round(thickness))),
               inner)
    gradient = Image.new('RGBA', (width_px, height_px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(gradient)
    for x in range(width_px):
        t = x / max(1, width_px - 1)
        colour = _mix(border_left_rgb, border_right_rgb, t)
        draw.line([(x, 0), (x, height_px - 1)],
                  fill=colour + (int(round(255 * border_alpha)),))
    ring_alpha = ring.point(lambda value: value)
    gradient.putalpha(ImageChops.multiply(gradient.getchannel('A'),
                                          ring_alpha))
    image = Image.alpha_composite(image, gradient)
    texture = _ui_texture(image)
    _CACHE[key] = texture
    return texture


def gradient_bar_texture(left_rgb=(62, 201, 232), right_rgb=(255, 61, 139),
                         width=256, height=6, alpha=255, glow=0.0):
    """A horizontal cyan->pink bar with an optional soft glow above and below.

    Used for the 2px rules that replaced the old flat neon bars: ``glow`` is
    the blur radius in pixels, painted as a dim halo behind the crisp line.
    """
    key = ('gradient-bar', tuple(left_rgb), tuple(right_rgb), int(width),
           int(height), int(alpha), round(float(glow), 2))
    if key in _CACHE:
        return _CACHE[key]

    from PIL import Image, ImageFilter

    width_px = max(2, int(width))
    height_px = max(1, int(height))
    halo = max(0, int(round(float(glow))))
    canvas_h = height_px + 2 * halo + 2
    line = Image.new('RGBA', (width_px, canvas_h), (0, 0, 0, 0))
    for x in range(width_px):
        t = x / max(1, width_px - 1)
        colour = _mix(left_rgb, right_rgb, t) + (int(alpha),)
        for y in range(halo + 1, halo + 1 + height_px):
            line.putpixel((x, y), colour)
    image = Image.new('RGBA', (width_px, canvas_h), (0, 0, 0, 0))
    if halo:
        bright = line.filter(ImageFilter.GaussianBlur(halo))
        bright.putalpha(bright.getchannel('A').point(
            lambda value: int(value * 0.55)))
        image = Image.alpha_composite(image, bright)
    image = Image.alpha_composite(image, line)
    texture = _ui_texture(image)
    _CACHE[key] = texture
    return texture


def vertical_fade_texture(rgb=(11, 8, 32), alpha=0.80, width=8, height=128,
                          up=False):
    """A vertical fade to transparent: opaque at the bottom by default.

    ``up=False`` paints the colour at the bottom edge (the bottom hint strip
    and the scroll fade); ``up=True`` mirrors it for a fade under the top edge.
    """
    key = ('vertical-fade', tuple(rgb), round(float(alpha), 3), int(width),
           int(height), bool(up))
    if key in _CACHE:
        return _CACHE[key]

    from PIL import Image

    width_px = max(2, int(width))
    height_px = max(2, int(height))
    image = Image.new('RGBA', (width_px, height_px), (0, 0, 0, 0))
    peak = max(0.0, min(1.0, float(alpha)))
    for row in range(height_px):
        t = row / (height_px - 1)
        if up:
            t = 1.0 - t
        value = int(round(255 * peak * t))
        for x in range(width_px):
            image.putpixel((x, row), tuple(rgb) + (value,))
    texture = _ui_texture(image)
    _CACHE[key] = texture
    return texture


def vignette_texture(rgb=(11, 8, 32), size=192, power=1.7, max_alpha=0.70):
    """Transparent in the centre, dark at the edges (the screen vignette)."""
    key = ('vignette', tuple(rgb), int(size), round(float(power), 2),
           round(float(max_alpha), 3))
    if key in _CACHE:
        return _CACHE[key]

    from PIL import Image

    pixels = max(16, int(size))
    half = (pixels - 1) / 2.0
    diag = math.sqrt(2.0)
    image = Image.new('RGBA', (pixels, pixels))
    data = []
    for y in range(pixels):
        dy = (y - half) / half / diag
        for x in range(pixels):
            dx = (x - half) / half / diag
            distance = min(1.0, math.sqrt(dx * dx + dy * dy))
            data.append(tuple(rgb)
                        + (int(round(255 * max_alpha
                                     * distance ** float(power))),))
    image.putdata(data)
    texture = _ui_texture(image, filtering='bilinear')
    _CACHE[key] = texture
    return texture


def text_width_px(text, px=16, bold=False, tracking=0.0):
    """The width of one line of text in reference pixels, without rendering."""
    text = str(text)
    key = ('ui-text-width', text, round(float(px), 2), bool(bold),
           round(float(tracking), 2))
    if key in _CACHE:
        return _CACHE[key]
    font = _ui_font(float(px))
    if font is None:                                   # pragma: no cover
        _CACHE[key] = 0.0
        return 0.0
    width = (sum(font.getlength(character) for character in text)
             + float(tracking) * max(0, len(text) - 1))
    _CACHE[key] = width
    return width


def text_texture(text, px=16, rgb=(255, 255, 255), bold=False, tracking=0.0,
                 line_spacing=0.0, max_width_px=None, max_lines=0,
                 align='left', supersample=2, glow_rgb=None, glow_px=0.0,
                 glow_alpha=0.5):
    """Render a label at an exact pixel size.

    Returns ``(texture, width_px, height_px)`` where the sizes are the *ink*
    bounds in reference pixels (1280x720 space), so the caller can centre the
    quad and never clip a glyph. Long text wraps at ``max_width_px`` and is cut
    on a word boundary with an ellipsis when ``max_lines`` is reached. A neon
    halo is painted behind the glyphs when ``glow_rgb`` is given.
    """
    text = str(text)
    key = ('ui-text', text, round(float(px), 2), tuple(rgb), bool(bold),
           round(float(tracking), 2), round(float(line_spacing), 2),
           None if max_width_px is None else round(float(max_width_px), 1),
           int(max_lines), align, int(supersample), glow_rgb,
           round(float(glow_px), 2), round(float(glow_alpha), 2))
    if key in _CACHE:
        return _CACHE[key]

    from PIL import Image, ImageDraw

    scale = max(1, int(supersample))
    font = _ui_font(float(px) * scale)
    if font is None:                                   # pragma: no cover
        _CACHE[key] = (None, 0.0, 0.0)
        return _CACHE[key]
    stroke = max(1, int(round(px * scale / 16.0))) if bold else 0
    tracking_px = float(tracking) * scale
    step = float(line_spacing) * scale

    def run_width(line):
        if not line:
            return 0.0
        return (sum(font.getlength(character) for character in line)
                + tracking_px * (len(line) - 1))

    def fit_ellipsis(line):
        while line and run_width(line + '...') > limit:
            line = line.rsplit(' ', 1)[0] if ' ' in line else line[:-1]
        return line + '...'

    lines = text.split('\n')
    if max_width_px:
        limit = float(max_width_px) * scale
        wrapped = []
        for line in lines:
            words = line.split()
            current = ''
            for word in words:
                candidate = f'{current} {word}' if current else word
                if run_width(candidate) <= limit or not current:
                    current = candidate
                else:
                    wrapped.append(current)
                    current = word
            if current or not words:
                wrapped.append(current)
        lines = wrapped
    if max_lines and len(lines) > int(max_lines):
        lines = lines[:int(max_lines)]
        if lines:
            lines[-1] = fit_ellipsis(lines[-1])

    ascent, descent = font.getmetrics()
    line_height = ascent + descent
    line_advance = line_height + step
    total_h = line_advance * max(0, len(lines) - 1) + line_height
    total_w = max([run_width(line) for line in lines] or [0.0])
    halo = int(round(max(0.0, glow_px) * scale)) if glow_rgb else 0
    pad = stroke + halo * 2 + int(round(4 * scale))
    canvas = Image.new('L', (int(total_w) + 2 * pad + 8,
                             int(total_h) + 2 * pad + 8), 0)
    draw = ImageDraw.Draw(canvas)
    for index, line in enumerate(lines):
        if align == 'center':
            x = pad + (total_w - run_width(line)) / 2.0
        else:
            x = float(pad)
        baseline = pad + ascent + index * line_advance
        for character in line:
            if character != ' ':
                draw.text((x, baseline), character, font=font, fill=255,
                          anchor='ls', stroke_width=stroke, stroke_fill=255)
            x += font.getlength(character) + tracking_px
    box = canvas.getbbox()
    if box is None:
        _CACHE[key] = (None, 0.0, 0.0)
        return _CACHE[key]
    image = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    if halo:
        from PIL import ImageFilter

        blurred = canvas.filter(ImageFilter.GaussianBlur(halo))
        glow_layer = Image.new('RGBA', canvas.size, tuple(glow_rgb) + (0,))
        glow_layer.putalpha(blurred.point(
            lambda value: int(value * float(glow_alpha))))
        image = Image.alpha_composite(image, glow_layer)
    text_layer = Image.new('RGBA', canvas.size, tuple(rgb) + (0,))
    text_layer.putalpha(canvas)
    image = Image.alpha_composite(image, text_layer)
    crop = (max(0, box[0] - halo * 2), max(0, box[1] - halo * 2),
            min(canvas.size[0], box[2] + halo * 2),
            min(canvas.size[1], box[3] + halo * 2))
    ink = image.crop(crop)
    result = (_ui_texture(ink), ink.width / scale, ink.height / scale)
    _CACHE[key] = result
    return result


def lane_diagram_texture(width=240, height=150, pins=(), path=(),
                         start_x=0.0, aim_x=None, solved=False,
                         launched=False, gutter_x=None):
    """A schematic top view of the lane with the *simulated* ball path.

    ``pins`` is a sequence of ``(x, z, label, is_target, is_down)`` in lane
    metres - the real positions of the deck. ``path`` is the recorded
    ``((x, z), ...)`` trajectory the engine produced, drawn as the actual
    curve (cyan, green when the challenge is solved). The lane is heavily
    foreshortened (a real 18 m lane in a 150 px column) - the caption is drawn
    inside the texture - but every coordinate is the real one: the ball path
    and the pins cannot disagree with the simulation they came from.
    """
    key = ('lane-diagram', int(width), int(height),
           tuple(tuple(pin) for pin in pins),
           tuple((round(x, 3), round(z, 2)) for x, z in path),
           round(float(start_x), 4),
           None if aim_x is None else round(float(aim_x), 4),
           bool(solved), bool(launched),
           None if gutter_x is None else round(float(gutter_x), 3))
    if key in _CACHE:
        return _CACHE[key]

    from PIL import Image, ImageDraw

    lane_half = config.LANE_WIDTH / 2.0
    total_half = lane_half + config.GUTTER_WIDTH
    z_bottom, z_top = -0.6, config.PIN_DECK_LENGTH + config.HEAD_PIN_Z + 0.35
    pad_x, pad_top, pad_bottom = 8.0, 22.0, 12.0

    scale_x = (width - 2 * pad_x) / (2.0 * total_half)
    scale_y = (height - pad_top - pad_bottom) / (z_top - z_bottom)

    def to_px(x, z):
        return (width / 2.0 + x * scale_x,
                pad_top + (z_top - z) * scale_y)

    image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    # The caption lives inside the picture, so the panel does not spend a
    # separate text row on it.
    draw.text((6, 3), 'LANE - TOP VIEW', font=_ui_font(11),
              fill=(126, 132, 164, 255))

    # Gutters + lane surface.
    gx0, gy0 = to_px(-total_half, z_top)
    gx1, gy1 = to_px(total_half, z_bottom)
    draw.rounded_rectangle((gx0, gy0, gx1, gy1), radius=4,
                           fill=(20, 16, 40, 255))
    lx0, ly0 = to_px(-lane_half, z_top)
    lx1, ly1 = to_px(lane_half, z_bottom)
    draw.rectangle((lx0, ly0, lx1, ly1), fill=(70, 48, 30, 255))
    # The lane's pink neon lips.
    for edge in (-lane_half, lane_half):
        ex, _ = to_px(edge, 0.0)
        draw.line([(ex, gy0), (ex, gy1)], fill=(255, 61, 139, 220), width=1)
    # Foul line.
    _, fy = to_px(0.0, 0.0)
    draw.line([(lx0, fy), (lx1, fy)], fill=(255, 61, 139, 200), width=2)
    # Centre guide.
    cx, cy_top = to_px(0.0, z_top)
    _, cy_bottom = to_px(0.0, z_bottom)
    dash, gap = 5, 5
    y = cy_top
    while y < cy_bottom:
        draw.line([(cx, y), (cx, min(y + dash, cy_bottom))],
                  fill=(255, 255, 255, 40), width=1)
        y += dash + gap

    # The actual path, drawn under the pins. ``path`` is a sequence of
    # ``(x, z)`` samples straight from the deck's trajectory recorder.
    if path:
        colour = (74, 222, 128, 255) if solved else (96, 226, 255, 255)
        points = [to_px(x, z) for x, z in path]
        if len(points) > 1:
            draw.line(points, fill=colour, width=2, joint='curve')
        if gutter_x is not None:
            gxp, gyp = to_px(gutter_x, path[-1][1])
            draw.line([(gxp - 4, gyp - 4), (gxp + 4, gyp + 4)],
                      fill=(255, 92, 108, 255), width=2)
            draw.line([(gxp - 4, gyp + 4), (gxp + 4, gyp - 4)],
                      fill=(255, 92, 108, 255), width=2)

    # The pins: a ring for the target, a filled dot otherwise; a fallen pin
    # fades towards red so the outcome is visible without reading the text.
    for label, x, z, is_target, is_down in pins:
        px_x, px_y = to_px(x, z)
        if is_down:
            fill = (200, 90, 110, 230)
            ring = (200, 90, 110, 230)
        else:
            fill = (248, 248, 252, 245)
            ring = (255, 181, 71, 255) if is_target else (60, 52, 110, 230)
        radius = 4 if is_target else 3
        draw.ellipse((px_x - radius, px_y - radius,
                      px_x + radius, px_y + radius),
                     fill=fill, outline=ring, width=2)
        if is_target and label:
            font = _ui_font(11)
            text_w = font.getlength(str(label))
            label_x = px_x + radius + 3
            if label_x + text_w > width - 2:
                label_x = px_x - radius - 3 - text_w
            draw.text((label_x, px_y - 5), str(label),
                      font=font, fill=(255, 181, 71, 255))

    # Launch marker.
    if launched:
        sx, sy = to_px(start_x, 0.0)
        draw.ellipse((sx - 4, sy - 4, sx + 4, sy + 4),
                     fill=(96, 226, 255, 255))
    if aim_x is not None:
        ax, _ay = to_px(aim_x, z_top)
        bx, _by = to_px(aim_x, z_bottom)
        draw.line([(ax, gy0), (bx, gy1)], fill=(255, 181, 71, 90), width=1)

    texture = _ui_texture(image)
    _CACHE[key] = texture
    return texture


def _icon(draw, name, size):
    """Paint icon ``name`` as a white mask into ``draw`` (RGB + alpha)."""
    import math

    white = (255, 255, 255, 255)
    clear = (0, 0, 0, 0)
    unit = size / 96.0

    def box(*values):
        return [value * unit for value in values]

    def line_width(value):
        return max(1, int(round(value * unit)))

    if name == 'pin':
        draw.ellipse(box(35, 6, 61, 36), fill=white)
        draw.polygon([(42 * unit, 28 * unit), (54 * unit, 28 * unit),
                      (63 * unit, 58 * unit), (33 * unit, 58 * unit)],
                     fill=white)
        draw.ellipse(box(25, 48, 71, 84), fill=white)
        draw.ellipse(box(30, 78, 66, 92), fill=white)
    elif name == 'question':
        draw.arc(box(28, 8, 68, 50), start=150, end=10,
                 width=line_width(11), fill=white)
        draw.line([(60 * unit, 40 * unit), (48 * unit, 58 * unit)],
                  fill=white, width=line_width(11))
        draw.ellipse(box(42, 70, 54, 82), fill=white)
    elif name == 'sigma':
        draw.line([(66 * unit, 14 * unit), (30 * unit, 14 * unit),
                   (52 * unit, 48 * unit), (30 * unit, 82 * unit),
                   (66 * unit, 82 * unit)], fill=white,
                  width=line_width(11), joint='curve')
    elif name == 'people2':
        draw.ellipse(box(20, 10, 44, 34), fill=white)
        draw.ellipse(box(52, 10, 76, 34), fill=white)
        draw.rounded_rectangle(box(12, 40, 48, 82), radius=16 * unit,
                               fill=white)
        draw.rounded_rectangle(box(48, 40, 84, 82), radius=16 * unit,
                               fill=white)
    elif name == 'people3':
        draw.ellipse(box(12, 22, 32, 42), fill=white)
        draw.ellipse(box(38, 14, 58, 34), fill=white)
        draw.ellipse(box(64, 22, 84, 42), fill=white)
        draw.rounded_rectangle(box(4, 48, 40, 86), radius=16 * unit,
                               fill=white)
        draw.rounded_rectangle(box(32, 40, 64, 86), radius=16 * unit,
                               fill=white)
        draw.rounded_rectangle(box(56, 48, 92, 86), radius=16 * unit,
                               fill=white)
    elif name == 'robot':
        draw.rectangle(box(44, 12, 52, 26), fill=white)
        draw.ellipse(box(40, 2, 56, 18), fill=white)
        draw.rounded_rectangle(box(18, 24, 78, 78), radius=14 * unit,
                               fill=white)
        draw.rectangle(box(10, 44, 20, 60), fill=white)
        draw.rectangle(box(76, 44, 86, 60), fill=white)
        draw.rectangle(box(32, 42, 44, 56), fill=clear)
        draw.rectangle(box(52, 42, 64, 56), fill=clear)
        draw.rectangle(box(36, 64, 60, 69), fill=clear)
    elif name == 'stopwatch':
        draw.rounded_rectangle(box(40, 4, 56, 18), radius=5 * unit,
                               fill=white)
        draw.rectangle(box(45, 16, 51, 26), fill=white)
        draw.line([(48 * unit, 54 * unit), (48 * unit, 34 * unit)],
                  fill=white, width=line_width(8))
        draw.line([(48 * unit, 54 * unit), (63 * unit, 61 * unit)],
                  fill=white, width=line_width(8))
        draw.ellipse(box(12, 22, 84, 92), outline=white,
                     width=line_width(9))
        draw.ellipse(box(42, 48, 54, 60), fill=white)
    elif name == 'gear':
        centre, outer, inner = 48.0, 42.0, 32.0
        teeth = 8
        points = []
        for tooth in range(teeth):
            base = tooth * (2 * math.pi / teeth) - math.pi / 2
            for radius, offset in ((outer, -0.20), (outer, 0.20),
                                   (inner, 0.30), (inner, 0.70)):
                angle = base + offset * (2 * math.pi / teeth)
                points.append(((centre + radius * math.cos(angle)) * unit,
                               (centre + radius * math.sin(angle)) * unit))
        draw.polygon(points, fill=white)
        draw.ellipse(box(38, 38, 58, 58), fill=clear)
    elif name == 'check':
        draw.line([(26 * unit, 50 * unit), (42 * unit, 66 * unit),
                   (70 * unit, 32 * unit)], fill=white,
                  width=line_width(12), joint='curve')
    elif name in ('arrow_left', 'arrow_right', 'arrow_up', 'arrow_down'):
        if name == 'arrow_left':
            draw.polygon([(58 * unit, 16 * unit), (24 * unit, 48 * unit),
                          (58 * unit, 80 * unit)], fill=white)
            draw.rectangle(box(44, 42, 78, 54), fill=white)
        elif name == 'arrow_right':
            draw.polygon([(38 * unit, 16 * unit), (72 * unit, 48 * unit),
                          (38 * unit, 80 * unit)], fill=white)
            draw.rectangle(box(18, 42, 52, 54), fill=white)
        elif name == 'arrow_up':
            draw.polygon([(16 * unit, 58 * unit), (48 * unit, 24 * unit),
                          (80 * unit, 58 * unit)], fill=white)
            draw.rectangle(box(42, 44, 54, 78), fill=white)
        else:
            draw.polygon([(16 * unit, 38 * unit), (48 * unit, 72 * unit),
                          (80 * unit, 38 * unit)], fill=white)
            draw.rectangle(box(42, 18, 54, 52), fill=white)


def icon_texture(name, size=96):
    """A white vector icon mask; the widget tints it with the accent colour."""
    key = ('ui-icon', name, int(size))
    if key in _CACHE:
        return _CACHE[key]

    from PIL import Image, ImageDraw

    pixels = max(8, int(round(size)))
    image = Image.new('RGBA', (pixels, pixels), (0, 0, 0, 0))
    _icon(ImageDraw.Draw(image), name, pixels)
    texture = _ui_texture(image)
    _CACHE[key] = texture
    return texture
