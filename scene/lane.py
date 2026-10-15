"""Build the bowling environment: deck, markings, gutters, the neon city.

Everything is a primitive or a procedurally generated texture, sized from the
real lane dimensions in :mod:`config`, so the scene needs no shipped art and
the collision layout is untouched.

Layout, following the art:

* warm maple lane with 39 boards, the standard seven targeting chevrons and a
  cyan dashed guide line running down the middle;
* near-black gutters with a hot-pink neon rail and a cyan strip outside it;
* a brighter pin deck, a dark pit apron and a pink neon bar behind the pins;
* an open-air neon city around the lane: flat facades full of lit windows,
  magenta and cyan tubes, and a painted skyline with a moon behind the pins.

Shading note: the city is deliberately *flat*. Every environment surface is
unlit - the colours are vivid and the depth comes from the perspective of the
drawing, not from lights. The ball, the pins and the character keep their own
soft shading so the players still read as physical objects.
"""
from ursina import Entity, color
from ursina.shaders import unlit_shader

import config
from scene.geometry import disc, quad, triangle
from scene.textures import (approach_texture, city_skyline_texture,
                            facade_texture, glow_texture, gradient_texture,
                            wood_texture)

# Marking geometry (metres). The seven arrows sit 15 ft past the foul line,
# spaced one board (6 in) apart; the approach dots use the same spacing.
ARROW_SPACING = 0.1524
ARROW_Z = 4.572
ARROW_LENGTH = 0.30
ARROW_WIDTH = 0.16
DOT_RADIUS = 0.035
DOT_Z = -0.95

MARKING_COLOR = (34, 22, 20)
WALL_X = 2.7

# ---------------------------------------------------------------------------
# Registries for the motion layer (see motion/scene_fx.py)
#
# The environment is built once, here, and animated from ``motion``: every neon
# tube is recorded as ``(entity, base_rgb)`` so it can breathe and spike, the
# glow behind the pins is recorded so it can breathe and surge, and the
# targeting chevrons are recorded so they can pulse under the aim guide. None
# of this changes the geometry or the physics.
# ---------------------------------------------------------------------------
NEON_STRIPS = []          # [(entity, base_rgb), ...]
PIN_GLOW = None           # the pink glow quad behind the pins
LANE_ARROWS = []          # the seven targeting chevrons


def _rgb(rgb):
    return color.rgb32(*rgb)


def _rgba(rgb, alpha=1.0):
    """RGBA from a 0-255 colour and a 0-1 alpha (Ursina divides by 255)."""
    return color.rgba32(*(tuple(rgb) + (max(0.0, min(1.0, alpha)) * 255.0,)))


def _unlit(**kwargs):
    """A neon / glow / decal surface: bright and never shaded."""
    kwargs['shader'] = unlit_shader
    kwargs['unlit'] = True
    return Entity(**kwargs)


# ---------------------------------------------------------------------------
# Deck surfaces
# ---------------------------------------------------------------------------
def _build_decks():
    # Floor under everything, so the city does not float in space.
    _unlit(
        model='plane',
        scale=(24, 1, config.LANE_LENGTH * 2 + 2 * config.APPROACH_LENGTH),
        position=(0, -config.LANE_THICKNESS - 0.02,
                  (config.LANE_LENGTH - config.APPROACH_LENGTH) / 2),
        color=_rgb(config.FLOOR_COLOR),
    )

    # Approach: the run-up behind the foul line.
    _unlit(
        model='cube',
        scale=(config.TOTAL_WIDTH, config.LANE_THICKNESS, config.APPROACH_LENGTH),
        position=(0, -config.LANE_THICKNESS / 2, -config.APPROACH_LENGTH / 2),
        color=_rgb(config.APPROACH_COLOR),
    )
    _unlit(
        model=quad(config.TOTAL_WIDTH, config.APPROACH_LENGTH),
        texture=approach_texture(),
        position=(0, 0.0015, -config.APPROACH_LENGTH / 2),
        color=color.white,
    )

    # Lane: warm maple with the boards running the length of the deck.
    _unlit(
        model='cube',
        scale=(config.LANE_WIDTH, config.LANE_THICKNESS, config.LANE_LENGTH),
        position=(0, -config.LANE_THICKNESS / 2, config.LANE_LENGTH / 2),
        color=_rgb(config.LANE_COLOR),
    )
    _unlit(
        model=quad(config.LANE_WIDTH, config.LANE_LENGTH),
        texture=wood_texture(),
        position=(0, 0.0015, config.LANE_LENGTH / 2),
        color=color.white,
    )

    # Pin deck, then the dark pit apron the ball rolls onto.
    _unlit(
        model='cube',
        scale=(config.LANE_WIDTH, config.LANE_THICKNESS, config.PIN_DECK_LENGTH),
        position=(0, -config.LANE_THICKNESS / 2,
                  config.LANE_LENGTH + config.PIN_DECK_LENGTH / 2),
        color=_rgb(config.PIN_DECK_COLOR),
    )
    _unlit(
        model=quad(config.LANE_WIDTH, config.PIN_DECK_LENGTH),
        texture=wood_texture(boards=39, width=256, height=384,
                             base=config.PIN_DECK_COLOR, grain=0.10,
                             sheen=0.30, seed=23),
        position=(0, 0.0015, config.LANE_LENGTH + config.PIN_DECK_LENGTH / 2),
        color=color.white,
    )
    _unlit(
        model='cube',
        scale=(config.LANE_WIDTH, config.LANE_THICKNESS, 1.8),
        position=(0, -config.LANE_THICKNESS / 2,
                  config.LANE_LENGTH + config.PIN_DECK_LENGTH + 0.9),
        color=_rgb(config.GUTTER_COLOR),
    )

    # Foul line, inlaid across the approach.
    _unlit(
        model='cube',
        scale=(config.LANE_WIDTH, 0.02, 0.06),
        position=(0, 0.01, config.FOUL_LINE_Z),
        color=_rgb(config.FOUL_LINE_COLOR),
    )


def _build_markings():
    """The targeting chevrons, the approach dots and the cyan guide dashes."""
    del LANE_ARROWS[:]
    for index in range(-3, 4):
        x = index * ARROW_SPACING
        arrow = _unlit(model=triangle(ARROW_WIDTH, ARROW_LENGTH),
                       position=(x, 0.004, ARROW_Z),
                       color=_rgba(MARKING_COLOR, 0.96))
        LANE_ARROWS.append(arrow)
        _unlit(model=disc(DOT_RADIUS, segments=14),
               position=(x, 0.004, DOT_Z),
               color=_rgba(MARKING_COLOR, 0.90))
    # A dashed guide line down the middle of the lane, like the art.
    z = 1.1
    end = config.LANE_LENGTH + config.PIN_DECK_LENGTH - 1.2
    while z < end:
        _unlit(model='cube',
               scale=(0.03, 0.004, 0.34),
               position=(0, 0.004, z),
               color=_rgba((96, 226, 255), 0.40))
        z += 1.55


def _build_gutters():
    rail_texture = gradient_texture(config.GUTTER_LIP_COLOR,
                                    (52, 14, 32), width=4, height=64)
    for side in (-1, 1):
        # The channel itself, sunk below the lane surface.
        _unlit(
            model='cube',
            scale=(config.GUTTER_WIDTH, config.LANE_THICKNESS,
                   config.LANE_LENGTH),
            position=(
                side * (config.LANE_WIDTH / 2 + config.GUTTER_WIDTH / 2),
                -config.LANE_THICKNESS / 2 - 0.06,
                config.LANE_LENGTH / 2,
            ),
            color=_rgb(config.GUTTER_COLOR),
        )
        # The outer rail: the bright pink neon edge of the lane.
        rail_x = side * (config.LANE_WIDTH / 2 + config.GUTTER_WIDTH + 0.07)
        _unlit(
            model='cube',
            scale=(0.14, 0.16, config.LANE_LENGTH),
            position=(rail_x, 0.02, config.LANE_LENGTH / 2),
            texture=rail_texture,
            color=color.white,
        )
        NEON_STRIPS.append((
            _unlit(model='cube',
                   scale=(0.04, 0.012, config.LANE_LENGTH),
                   position=(rail_x, 0.095, config.LANE_LENGTH / 2),
                   color=_rgba(config.GUTTER_LIP_COLOR)),
            config.GUTTER_LIP_COLOR))
        # A cyan tube just outside the rail, at street level.
        NEON_STRIPS.append((
            _unlit(model='cube',
                   scale=(0.035, 0.018, config.LANE_LENGTH - 1.2),
                   position=(side * (config.LANE_WIDTH / 2
                                     + config.GUTTER_WIDTH + 0.24),
                             0.012, config.LANE_LENGTH / 2),
                   color=_rgba((96, 226, 255), 0.9)),
            (96, 226, 255)))
        # A dim pink wash in the gutter, so the channel reads as a neon slot.
        _unlit(model='cube',
               scale=(0.03, 0.012, config.LANE_LENGTH),
               position=(side * (config.LANE_WIDTH / 2 + 0.02), -0.05,
                         config.LANE_LENGTH / 2),
               color=_rgba((150, 26, 72)))


# ---------------------------------------------------------------------------
# The neon city
# ---------------------------------------------------------------------------
def _build_city():
    """The open-air city around the lane: facades, skyline and neon."""
    global PIN_GLOW
    length_center = (config.LANE_LENGTH - config.APPROACH_LENGTH) / 2
    length_span = config.LANE_LENGTH + config.APPROACH_LENGTH + 2.0
    facade = facade_texture()

    for side in (-1, 1):
        # The building mass; the facade panels carry the lit windows.
        _unlit(
            model='cube',
            scale=(0.16, 3.4, length_span),
            position=(side * (WALL_X + 0.08), 1.7, length_center),
            color=_rgb(config.WALL_COLOR),
        )
        z = -config.APPROACH_LENGTH + 0.6
        index = 0
        while z < config.LANE_LENGTH + 1.2:
            panel_width = (1.5, 1.9, 1.25)[index % 3]
            panel_height = (2.4, 3.2, 2.0)[index % 3]
            _unlit(
                model='cube',
                scale=(0.08, panel_height, panel_width),
                position=(side * (WALL_X - 0.06), panel_height / 2,
                          z + panel_width / 2),
                texture=facade,
                color=color.white,
            )
            z += panel_width + 0.30
            index += 1
        # A pink tube at street level and a cyan strip higher up.
        NEON_STRIPS.append((
            _unlit(model='cube',
                   scale=(0.05, 0.035, length_span - 0.6),
                   position=(side * (WALL_X - 0.11), 0.40, length_center),
                   color=_rgba(config.WALL_TRIM_COLOR)),
            config.WALL_TRIM_COLOR))
        NEON_STRIPS.append((
            _unlit(model='cube',
                   scale=(0.05, 0.025, length_span - 1.4),
                   position=(side * (WALL_X - 0.11), 2.15, length_center),
                   color=_rgba((96, 226, 255))),
            (96, 226, 255)))
        # Vertical neon bars between the buildings.
        for index, z in enumerate((-3.2, 1.2, 5.8, 10.6, 15.4, 19.0)):
            _unlit(model='cube',
                   scale=(0.05, 1.3, 0.05),
                   position=(side * (WALL_X - 0.11), 1.20, z),
                   color=_rgba((255, 110, 176) if index % 2 == 0
                               else (96, 226, 255), 0.85))

    # Behind the pins: a low dark band with the neon bar, then the skyline.
    wall_z = config.LANE_LENGTH + config.PIN_DECK_LENGTH + 2.0
    _unlit(
        model='cube',
        scale=(2 * WALL_X + 0.2, 1.8, 0.2),
        position=(0, 0.80, wall_z),
        color=_rgb(config.BACKDROP_COLOR),
    )
    NEON_STRIPS.append((
        _unlit(model='cube', scale=(2.7, 0.05, 0.06),
               position=(0, 1.76, wall_z - 0.12),
               color=_rgba((255, 84, 130))),
        (255, 84, 130)))
    PIN_GLOW = _unlit(model=quad(4.6, 1.5), rotation_x=-90,
                      texture=glow_texture(config.BACKDROP_GLOW_COLOR,
                                           size=96, power=2.4),
                      position=(0, 0.45, wall_z - 0.12), color=color.white)
    # The city itself: one big flat skyline standing behind everything.
    _unlit(model=quad(40.0, 9.5), rotation_x=-90,
           texture=city_skyline_texture(),
           position=(0, 1.6 + 4.75, wall_z + 0.6),
           color=color.white)


# ---------------------------------------------------------------------------
# Lighting
# ---------------------------------------------------------------------------
def _build_lighting():
    """Shading is done per pixel by :mod:`scene.shaders`.

    No Panda ``AmbientLight``/``DirectionalLight`` is created: the players
    (ball, pins, character) carry an explicit shader, and Ursina's shaders do
    not sample the Panda light nodes, so light entities here would be inert.
    Direction, key colour and fill colour live in ``config`` and are pushed to
    the shader instead. Real-time shadow maps are not used either: one 1024 map
    stretched over an 18 m lane is far too coarse to read, so the game fakes
    the contact shading that matters (the ball's shadow).
    """


def build_lane():
    """Create the whole bowling environment (called once, at game start)."""
    del NEON_STRIPS[:]        # the motion layer's registries are rebuilt too
    del LANE_ARROWS[:]
    _build_decks()
    _build_markings()
    _build_gutters()
    _build_city()
    _build_lighting()
