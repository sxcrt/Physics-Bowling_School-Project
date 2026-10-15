"""Procedural bowling-pin geometry: one smooth lathe mesh and one shared skin.

A regulation pin is a solid of revolution: its silhouette (base fillet, belly,
narrow neck, head) is revolved about the pin's long axis. This module builds
that mesh once from a measured profile and hands the same objects to all ten
pins, so the rack costs one geometry, not ten.

The mesh is centred on the pin's base at ``y = -PIN_HEIGHT / 2`` and the head
at ``y = +PIN_HEIGHT / 2``, matching the physics convention that a pin entity's
origin is its centre of mass (``physics.PinPhysics.com``). The collision model
is untouched: it still uses the pin base, the tilt axis and the belly radius
from :mod:`config`; only the drawn surface changed.

Profile source: USBC pin specification (15 in tall, 4.766 in belly, ~1.8 in
neck, 12 in rack spacing). The intermediate points are interpolated
geometrically, not measured tabulations - documented in docs/VISUALS.md.
"""
import math

from panda3d.core import NodePath as PandaNodePath
from ursina import Mesh, Texture

import config

SEGMENTS = 32            # steps around the pin's axis
PROFILE_SAMPLES = 40     # samples along the silhouette

#: ``(height from the base, radius)`` control points in metres.
#: Ends are exact: the base sits on the deck, the head closes at the crest.
PIN_PROFILE = (
    (0.0000, 0.0255),    # base edge
    (0.0060, 0.0290),    # base fillet
    (0.0180, 0.0380),
    (0.0350, 0.0470),
    (0.0550, 0.0540),
    (0.0800, 0.0588),
    (0.1050, 0.0605),    # belly: 0.121 m diameter (USBC 4.766 in)
    (0.1300, 0.0600),
    (0.1550, 0.0575),
    (0.1800, 0.0530),
    (0.2050, 0.0455),
    (0.2250, 0.0370),
    (0.2420, 0.0300),
    (0.2550, 0.0240),    # neck: ~0.048 m diameter
    (0.2680, 0.0228),
    (0.2820, 0.0232),
    (0.2960, 0.0250),
    (0.3100, 0.0275),
    (0.3220, 0.0296),    # head: ~0.059 m diameter
    (0.3350, 0.0300),
    (0.3480, 0.0286),
    (0.3600, 0.0250),
    (0.3700, 0.0190),
    (0.3770, 0.0110),
    (0.3810, 0.0000),    # crest, closed
)

#: Red neck bands as ``(v0, v1)`` fractions of the pin's height, matching the
#: reference art: one bold stripe with a thinner companion above it.
PIN_BANDS = ((0.652, 0.734), (0.760, 0.788))

#: Skin colours (RGB 0-255).
PIN_BODY_RGB = config.PIN_COLOR          # near-white
PIN_BAND_RGB = config.PIN_STRIPE_COLOR   # regulation red
PIN_BASE_RGB = (206, 205, 210)           # faint scuff ring at the base

_MESH = None
_TEXTURE = None
_INSTANCE_ROOT = PandaNodePath('pin-instances')   # keeps copies off the scene graph


# ---------------------------------------------------------------------------
# Silhouette
# ---------------------------------------------------------------------------
def _monotone_cubic(points, count):
    """Sample ``(x, y)`` control points with a monotone cubic Hermite spline.

    Fritsch-Carlson tangents keep every span monotone, so the interpolated
    profile never overshoots between control points (a plain Catmull-Rom can
    bulge outside the measured radius and make the neck wobble).
    """
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    n = len(points)
    if n < 2 or count < 2:
        return list(points)

    slopes = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    tangents = [0.0] * n
    tangents[0] = slopes[0]
    tangents[-1] = slopes[-1]
    for i in range(1, n - 1):
        left, right = slopes[i - 1], slopes[i]
        if left * right <= 0.0:
            tangents[i] = 0.0                     # local extremum: flat
        else:
            h_left = xs[i] - xs[i - 1]
            h_right = xs[i + 1] - xs[i]
            w1 = 2.0 * h_right + h_left
            w2 = h_right + 2.0 * h_left
            tangents[i] = (w1 + w2) / (w1 / left + w2 / right)

    samples = []
    span = xs[-1] - xs[0]
    for k in range(count):
        x = xs[0] + span * k / (count - 1)
        i = 0
        while i < n - 2 and x > xs[i + 1]:
            i += 1
        h = xs[i + 1] - xs[i]
        t = 0.0 if h <= 0.0 else (x - xs[i]) / h
        t2, t3 = t * t, t * t * t
        y = ((2.0 * t3 - 3.0 * t2 + 1.0) * ys[i]
             + (t3 - 2.0 * t2 + t) * h * tangents[i]
             + (-2.0 * t3 + 3.0 * t2) * ys[i + 1]
             + (t3 - t2) * h * tangents[i + 1])
        # Belt and braces against any residual overshoot at the ends.
        low, high = min(ys[i], ys[i + 1]), max(ys[i], ys[i + 1])
        samples.append((x, max(low, min(high, y))))
    return samples


# ---------------------------------------------------------------------------
# Mesh
# ---------------------------------------------------------------------------
def _build_mesh():
    """Revolve the silhouette into a single closed, smooth-shaded mesh."""
    height = config.PIN_HEIGHT
    profile = _monotone_cubic(PIN_PROFILE, PROFILE_SAMPLES)
    half = height / 2.0

    vertices, uvs, normals, triangles = [], [], [], []
    for index, (h, radius) in enumerate(profile):
        # Profile tangent (dr, dh); rotating it about the axis gives the
        # surface normal, so the shading is smooth without post-processing.
        if index == 0:
            dr = profile[1][1] - radius
            dh = profile[1][0] - h
        elif index == len(profile) - 1:
            dr = radius - profile[index - 1][1]
            dh = h - profile[index - 1][0]
        else:
            dr = profile[index + 1][1] - profile[index - 1][1]
            dh = profile[index + 1][0] - profile[index - 1][0]
        length = math.hypot(dr, dh) or 1.0
        normal_r, normal_h = dh / length, -dr / length
        y = h - half
        for j in range(SEGMENTS + 1):              # +1 duplicates the seam uv
            angle = 2.0 * math.pi * j / SEGMENTS
            cos_a, sin_a = math.cos(angle), math.sin(angle)
            vertices.append((radius * cos_a, y, radius * sin_a))
            uvs.append((j / SEGMENTS, h / height))
            normals.append((normal_r * cos_a, normal_h, normal_r * sin_a))

    for i in range(len(profile) - 1):
        for j in range(SEGMENTS):
            a = i * (SEGMENTS + 1) + j
            b = (i + 1) * (SEGMENTS + 1) + j
            triangles += [a, b, b + 1, a, b + 1, a + 1]

    # Flat base disc (facing -y), so the mesh is closed.
    centre = len(vertices)
    vertices.append((0.0, -half, 0.0))
    uvs.append((0.5, 0.0))
    normals.append((0.0, -1.0, 0.0))
    for j in range(SEGMENTS):
        triangles += [centre, j, j + 1]

    return Mesh(vertices=vertices, triangles=triangles,
                uvs=uvs, normals=normals)


def pin_mesh():
    """The shared pin mesh (built on first use, reused by all ten pins)."""
    global _MESH
    if _MESH is None:
        _MESH = _build_mesh()
    return _MESH


def pin_model():
    """A per-pin instance of :func:`pin_mesh`.

    Ursina reparents the model it is handed to the entity that owns it, so a
    single Mesh object cannot be shared by ten entities: every pin gets an
    instance that shares the same geometry (Panda copies the NodePath, not the
    vertex data) but keeps its own transform.
    """
    return pin_mesh().copyTo(_INSTANCE_ROOT)


# ---------------------------------------------------------------------------
# Skin
# ---------------------------------------------------------------------------
def _blend(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def _band_colour(v, edge=0.006):
    """Colour at height fraction ``v`` (0 = base, 1 = crest).

    Band edges are blended over ``edge`` of the height so the stripe does not
    alias into a stair-stepped line on the narrow neck.
    """
    if v < 0.012:
        return PIN_BASE_RGB                       # faint scuff ring
    for v0, v1 in PIN_BANDS:
        if v0 <= v <= v1:
            if v < v0 + edge:
                t = (v - v0) / edge
            elif v > v1 - edge:
                t = (v1 - v) / edge
            else:
                t = 1.0
            return _blend(PIN_BODY_RGB, PIN_BAND_RGB,
                          max(0.0, min(1.0, t)))
    if v > 0.985:
        return _blend((250, 250, 253), (255, 255, 255), (v - 0.985) / 0.015)
    return PIN_BODY_RGB


def _build_texture():
    """Vertical white/red skin, one texel row per height fraction."""
    from PIL import Image, ImageDraw

    width, rows = 16, 384
    image = Image.new('RGB', (width, rows), PIN_BODY_RGB)
    draw = ImageDraw.Draw(image)
    for row in range(rows):
        v = row / (rows - 1)                 # v = 1 is the crest...
        y = rows - 1 - row                   # ...top row of the image
        draw.line([(0, y), (width - 1, y)], fill=_band_colour(v))
    return Texture(image)


def pin_texture():
    """The shared pin skin (built on first use, reused by all ten pins)."""
    global _TEXTURE
    if _TEXTURE is None:
        _TEXTURE = _build_texture()
    return _TEXTURE
