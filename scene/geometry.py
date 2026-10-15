"""Small procedural meshes for flat markings (quads, triangles, discs).

Ursina's ``cube``/``quad`` models have fixed UVs, which makes it awkward to
orient a lane texture or a floor marking. These helpers build the handful of
flat shapes the scene needs with explicit UVs in the lane plane (``+y`` up),
so a texture's ``u`` runs across the shape and ``v`` along it.
"""
import math

from ursina import Mesh


def quad(width, depth, u_repeat=1.0, v_repeat=1.0):
    """A textured quad in the XZ plane, centred on the origin, facing +y."""
    half_w, half_d = width / 2.0, depth / 2.0
    vertices = [(-half_w, 0.0, -half_d), (half_w, 0.0, -half_d),
                (half_w, 0.0, half_d), (-half_w, 0.0, half_d)]
    uvs = [(0.0, 0.0), (u_repeat, 0.0), (u_repeat, v_repeat), (0.0, v_repeat)]
    normals = [(0.0, 1.0, 0.0)] * 4
    # Winding verified against Ursina's CullFaceAttrib.MCullClockwise: the
    # triangles below are front-facing when seen from +y.
    return Mesh(vertices=vertices, triangles=[0, 1, 2, 0, 2, 3],
                uvs=uvs, normals=normals)


def triangle(width, depth):
    """A flat isoceles triangle in the XZ plane, apex towards ``+z``."""
    half_w, half_d = width / 2.0, depth / 2.0
    vertices = [(-half_w, 0.0, -half_d), (half_w, 0.0, -half_d),
                (0.0, 0.0, half_d)]
    uvs = [(0.0, 0.0), (1.0, 0.0), (0.5, 1.0)]
    normals = [(0.0, 1.0, 0.0)] * 3
    return Mesh(vertices=vertices, triangles=[0, 1, 2], uvs=uvs,
                normals=normals)


def disc(radius, segments=20, u_repeat=1.0, v_repeat=1.0):
    """A flat disc in the XZ plane, centred on the origin, facing +y."""
    vertices = [(0.0, 0.0, 0.0)]
    uvs = [(0.5 * u_repeat, 0.5 * v_repeat)]
    normals = [(0.0, 1.0, 0.0)]
    for i in range(segments + 1):
        angle = 2.0 * math.pi * i / segments
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        vertices.append((radius * sin_a, 0.0, radius * cos_a))
        uvs.append((0.5 * (1.0 + sin_a) * u_repeat,
                    0.5 * (1.0 + cos_a) * v_repeat))
        normals.append((0.0, 1.0, 0.0))
    triangles = []
    for i in range(segments):
        triangles += [0, i + 2, i + 1]
    return Mesh(vertices=vertices, triangles=triangles, uvs=uvs,
                normals=normals)


# ---------------------------------------------------------------------------
# Low-poly body parts (used by the character)
#
# A retro low-poly look comes from *shaped* geometry, not from cubes: a limb is
# a tapered prism, a shoulder is a chamfered block, a head is a coarse sphere
# with a jaw. These builders have no UVs to speak of (the parts are flat
# coloured) so they stay tiny, and their low segment counts are what give the
# faceted, "rendered on older hardware" feel.
# ---------------------------------------------------------------------------
def _mesh(vertices, triangles, normals=None):
    return Mesh(vertices=vertices, triangles=triangles,
                uvs=[(0.0, 0.0)] * len(vertices),
                normals=normals or [(0.0, 0.0, 1.0)] * len(vertices))


def tapered_box(bottom=(0.2, 0.2), top=(0.16, 0.16), height=0.5,
                bevel=0.0, down=False):
    """A prism that tapers from ``bottom`` to ``top`` (widths in x and z).

    ``bevel`` chamfers the four vertical edges (0 = a plain prism), which is
    what keeps a limb or a torso from reading as a programmer's cube.
    ``down=True`` builds it from ``y=0`` down to ``y=-height`` (limbs hang from
    their joint), with the winding flipped so the faces stay outward.
    """
    bw, bd = bottom
    tw, td = top
    if bevel <= 0.0:
        ring_bottom = [(-bw / 2, 0, -bd / 2), (bw / 2, 0, -bd / 2),
                       (bw / 2, 0, bd / 2), (-bw / 2, 0, bd / 2)]
        ring_top = [(-tw / 2, height, -td / 2), (tw / 2, height, -td / 2),
                    (tw / 2, height, td / 2), (-tw / 2, height, td / 2)]
    else:
        def ring(w, d, y):
            return [(-w / 2 + bevel, y, -d / 2), (w / 2 - bevel, y, -d / 2),
                    (w / 2, y, -d / 2 + bevel), (w / 2, y, d / 2 - bevel),
                    (w / 2 - bevel, y, d / 2), (-w / 2 + bevel, y, d / 2),
                    (-w / 2, y, d / 2 - bevel), (-w / 2, y, -d / 2 + bevel)]
        ring_bottom = ring(bw, bd, 0.0)
        ring_top = ring(tw, td, height)
    count = len(ring_bottom)
    vertices = ring_bottom + ring_top
    triangles = []
    for i in range(count):
        j = (i + 1) % count
        triangles += [i, j, count + j, i, count + j, count + i]
    for i in range(1, count - 1):
        triangles += [0, i + 1, i]
        triangles += [count, count + i, count + i + 1]
    if down:
        vertices = [(x, -y, z) for (x, y, z) in vertices]
        triangles = [triangles[i:i + 3][::-1]
                     for i in range(0, len(triangles), 3)]
        triangles = [index for face in triangles for index in face]
    return _mesh(vertices, triangles)


def low_poly_sphere(radius=0.5, rings=5, segments=8, squash=(1.0, 1.0, 1.0)):
    """A coarse sphere (an egg with a few flat bands), centred on the origin."""
    sx, sy, sz = squash
    vertices = [(0.0, radius * sy, 0.0)]
    for ring in range(1, rings):
        phi = math.pi * ring / rings
        y = radius * math.cos(phi) * sy
        ring_radius = radius * math.sin(phi)
        for segment in range(segments):
            theta = 2.0 * math.pi * segment / segments
            vertices.append((ring_radius * math.sin(theta) * sx, y,
                             ring_radius * math.cos(theta) * sz))
    bottom = len(vertices)
    vertices.append((0.0, -radius * sy, 0.0))
    triangles = []
    for segment in range(segments):
        a = 1 + segment
        b = 1 + (segment + 1) % segments
        triangles += [0, b, a]
    for ring in range(rings - 2):
        base = 1 + ring * segments
        nxt = base + segments
        for segment in range(segments):
            a = base + segment
            b = base + (segment + 1) % segments
            c = nxt + segment
            d = nxt + (segment + 1) % segments
            triangles += [a, d, c, a, b, d]
    base = 1 + (rings - 2) * segments
    for segment in range(segments):
        a = base + segment
        b = base + (segment + 1) % segments
        triangles += [bottom, a, b]
    return _mesh(vertices, triangles)


def cone(radius=0.1, height=0.3, segments=8):
    """A low-poly cone, base at y=0, apex at y=height, centred on the origin."""
    vertices = [(0.0, 0.0, 0.0)]
    for segment in range(segments):
        theta = 2.0 * math.pi * segment / segments
        vertices.append((radius * math.sin(theta), 0.0,
                         radius * math.cos(theta)))
    vertices.append((0.0, height, 0.0))
    apex = len(vertices) - 1
    triangles = []
    for segment in range(segments):
        a = 1 + segment
        b = 1 + (segment + 1) % segments
        triangles += [0, b, a]
        triangles += [a, b, apex]
    return _mesh(vertices, triangles)
