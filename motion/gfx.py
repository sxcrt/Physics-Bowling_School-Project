"""Textures the motion effects need, painted in code and cached like the rest.

Follows the convention of :mod:`scene.textures` (Pillow, cached by arguments,
no shipped image files):

* :func:`edge_glow` - a "screen-edge flash": transparent in the middle, bright
  at the rim. Used for the strike's alternating cyan/magenta edge flash and for
  the gutter's soft vignette (tinted dark there).
* :func:`band` - a soft horizontal band (bright in the middle, fading to both
  ends): the frame-change light sweep and the gold shimmer.
* :func:`soft_dot` - a white radial glow for particles; the particle's own
  colour tints it, so one texture serves every neon colour.
"""
from ursina import Texture

_CACHE = {}


def _cached(key, builder):
    if key not in _CACHE:
        _CACHE[key] = builder()
    return _CACHE[key]


def soft_dot(size=64, power=1.8):
    """A white radial glow (tinted per particle by ``entity.color``)."""
    key = ('motion_dot', size, power)

    def build():
        from PIL import Image, ImageDraw

        image = Image.new('RGBA', (size, size), (255, 255, 255, 0))
        draw = ImageDraw.Draw(image)
        steps = size // 2
        for step in range(steps, 0, -1):
            alpha = round(255 * (1.0 - step / steps) ** power)
            draw.ellipse([size / 2 - step, size / 2 - step,
                          size / 2 + step, size / 2 + step],
                         fill=(255, 255, 255, alpha))
        return Texture(image)

    return _cached(key, build)


def edge_glow(size=128, power=2.2, inner=0.25):
    """A white rim glow: transparent centre, bright edge.

    ``inner`` is the fraction of the radius that stays clear.
    """
    key = ('motion_edge', size, power, inner)

    def build():
        from PIL import Image

        image = Image.new('RGBA', (size, size), (255, 255, 255, 0))
        pixels = image.load()
        half = size / 2.0
        for y in range(size):
            for x in range(size):
                # Normalised distance from the centre, 0 at the middle and
                # 1 at the rim (clamped; the corners stay at full edge).
                dx = (x - half) / half
                dy = (y - half) / half
                distance = min(1.0, (dx * dx + dy * dy) ** 0.5)
                if distance <= inner:
                    continue
                ramp = (distance - inner) / max(1e-6, 1.0 - inner)
                pixels[x, y] = (255, 255, 255,
                                int(round(255 * ramp ** power)))
        return Texture(image)

    return _cached(key, build)


def band(width=128, height=32, power=2.0):
    """A soft horizontal band: bright in the middle, fading to both ends."""
    key = ('motion_band', width, height, power)

    def build():
        from PIL import Image

        image = Image.new('RGBA', (width, height), (255, 255, 255, 0))
        pixels = image.load()
        for x in range(width):
            edge = min(x, width - 1 - x) / (width / 2.0)
            alpha = int(round(255 * (edge ** power)))
            for y in range(height):
                vertical = 1.0 - abs((y / (height - 1.0)) * 2.0 - 1.0) \
                    if height > 1 else 1.0
                pixels[x, y] = (255, 255, 255, int(alpha * vertical ** 0.5))
        return Texture(image)

    return _cached(key, build)


def ring(size=128, thickness=0.16, power=1.6):
    """A white ring: transparent inside and outside, bright on the circle.

    Used for the impact shockwaves (the ball hitting the deck, and the ring
    that expands behind a result card). Everything is painted from one radius
    so the ring stays crisp at any scale.
    """
    key = ('motion_ring', size, round(float(thickness), 3),
           round(float(power), 3))

    def build():
        from PIL import Image

        image = Image.new('RGBA', (size, size), (255, 255, 255, 0))
        pixels = image.load()
        half = (size - 1) / 2.0
        inner = max(0.0, 1.0 - thickness)
        for y in range(size):
            for x in range(size):
                dx = (x - half) / max(1e-6, half)
                dy = (y - half) / max(1e-6, half)
                distance = (dx * dx + dy * dy) ** 0.5
                if distance >= 1.0:
                    continue
                if distance <= inner:
                    continue
                ramp = (distance - inner) / max(1e-6, 1.0 - inner)
                alpha = int(round(255 * (ramp ** power)))
                pixels[x, y] = (255, 255, 255, max(0, min(255, alpha)))
        return Texture(image)

    return _cached(key, build)
