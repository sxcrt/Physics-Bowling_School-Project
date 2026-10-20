"""The visual design system: tokens, neon text, buttons, panels, steppers.

The reference art is a neon bowling hall: a warm maple lane under deep indigo
and violet surroundings, magenta and cyan tube lights, hot red accents and
chunky, friendly, slightly tilted type. This module turns that language into
the widgets every screen uses, so the menus, the mode picker, the HUD and the
Physics Lab all read as one product:

* :data:`COLORS` / :data:`SIZES` / :data:`ALPHA` - **the one place every colour
  and every size lives**, written in reference pixels at 1280x720.
* :func:`px` / :func:`screen_pos` / :func:`ui_scale` - the reference grid, so
  a 1920x1080 or 1024x600 window gets the same picture.
* :class:`TextSprite` - labels painted at an exact pixel size and cropped to
  their ink, so "centred" means centred in both axes.
* :class:`ArcadeButton` - the primary (pink gradient), secondary (card with a
  cyan border) and ghost plates, with hover / pressed / focus / disabled states
  and a :class:`Keycap` for ENTER.
* :class:`SegmentedControl`, :class:`ModeCard`, :class:`Panel`,
  :class:`ChipFlow`, :class:`HintBar` - the rest of the front end.
* :class:`MenuButton`, :class:`Stepper`, :class:`Toggle`, :class:`Slider` and
  :class:`TextEntry` - the widgets the older screens use, all painted from the
  same tokens.

Every widget lays itself out from ``window.aspect_ratio``, and every widget is
a plain :class:`~ursina.Entity` under ``camera.ui``, so hit testing is a simple
rectangle test with :func:`pointer_in` - no colliders, no raycasts, and the same
code works in the offscreen window the tests use.
"""
from ursina import Entity, Text, color, window
from ursina.shaders import unlit_shader

from input.pointer import ui_pointer
from scene.textures import (glow_texture, gradient_bar_texture, icon_texture,
                            panel_texture, rounded_dash_texture,
                            rounded_mask_texture, rounded_texture, text_texture,
                            text_width_px, vertical_fade_texture,
                            vignette_texture)

# ---------------------------------------------------------------------------
# Palette (RGB 0-255)
# ---------------------------------------------------------------------------
PALETTE = {
    'bg': (20, 16, 40),              # deep indigo, the hall at night
    'panel': (28, 22, 58),           # raised panel
    'panel_dark': (14, 11, 30),      # recessed panel
    'panel_light': (46, 36, 92),     # hover fill
    'magenta': (232, 72, 168),       # neon trim
    'cyan': (96, 226, 255),          # cool accent
    'red': (226, 58, 40),            # hot accent
    'brand': (255, 84, 130),         # the "HELLS BALLS" sign: hot pink neon
    'amber': (255, 214, 130),        # score / highlight
    'green': (120, 230, 140),        # good
    'wood': (172, 120, 74),          # lane
    'white': (245, 245, 252),
    'grey': (176, 184, 210),
    'dim': (126, 132, 164),
    'ink': (16, 12, 30),
}


# Layer order for the UI. Ursina's UI camera draws *smaller* z in front,
# so panels and backdrops use a larger z than the text and widgets that
# sit on top of them. (Verified with a two-quad probe: the quad at z=0.0
# covers the one at z=0.5.)
BACKDROP_Z = 0.62
DIM_Z = 0.66          # the one full-screen dim (#0B0820 at 55%)
VIGNETTE_Z = 0.65     # the rim vignette, in front of the dim
PANEL_Z = 0.30
CARD_Z = 0.24
CONTENT_Z = 0.16
BUTTON_Z = 0.10
OVERLAY_Z = -0.10

# ---------------------------------------------------------------------------
# Typography and spacing scale
#
# Every screen uses these names instead of inventing a size per label, so the
# product reads as one thing: hero (the game title), title (screen headings),
# heading (panel headings), body (statements), small (labels), tiny (hints).
# ---------------------------------------------------------------------------
TYPE = {
    'hero': 1.70,
    'title': 1.30,
    'heading': 0.95,
    # The legacy aliases all resolve to 14px now: nothing in the UI is drawn
    # below 14px except the two places the brief names (the settings helper
    # text and the webcam chip, both 13px).
    'body': 0.778,       # 14px
    'small': 0.778,      # 14px
    'tiny': 0.778,       # 14px
}
SPACE = {
    'xs': 0.010,
    'sm': 0.020,
    'md': 0.034,
    'lg': 0.055,
    'xl': 0.085,
}

# ---------------------------------------------------------------------------
# HELLS BALLS UI tokens
#
# Every colour and every size the menus and the mode picker use lives here -
# nothing is placed by eye and no screen invents a colour. Sizes are written in
# *reference pixels* at 1280x720; :func:`px` turns them into UI units (the UI
# is exactly one unit tall) and :func:`screen_pos` maps a top-left-origin
# point onto the UI, so a 1920x1080 or 1024x600 window gets the same picture.
# ---------------------------------------------------------------------------
REFERENCE_WIDTH = 1280
REFERENCE_HEIGHT = 720
REFERENCE_ASPECT = REFERENCE_WIDTH / REFERENCE_HEIGHT

COLORS = {
    'panel':     (20, 16, 46),       # #14102E - panel background
    'card':      (28, 23, 69),       # #1C1745 - cards and quiet buttons
    'card_high': (37, 31, 90),       # #251F5A - the selected card
    'hairline':  (58, 50, 112),      # #3A3270 - 1px borders, slider tracks
    'pink':      (255, 61, 139),     # #FF3D8B - PLAY / START
    'pink_deep': (194, 24, 91),      # #C2185B - the bottom of the gradient
    'cyan':      (62, 201, 232),     # #3EC9E8 - accent, secondary buttons
    'amber':     (255, 181, 71),     # #FFB547 - rules chips
    'coral':     (255, 92, 108),     # #FF5C6C - QUIT only
    'purple':    (167, 139, 250),    # #A78BFA - player vs bot
    'green':     (74, 222, 128),     # #4ADE80 - equation challenge
    'text':      (255, 255, 255),    # text main
    'text_dim':  (207, 203, 234),    # #CFCBEA - text secondary
    'ink':       (14, 11, 30),       # dark text on a cyan fill
    'shade':     (9, 7, 20),         # the wash that darkens the lane
    'veil':      (11, 8, 32),        # #0B0820 - the one full-screen dim
}

# The spacing scale. Every gap in the UI is one of these five values - nothing
# is placed by eye - and the screen margins/panel padding are fixed.
LAYOUT = {
    'margin_x': 64,                  # screen margins, left and right
    'margin_top': 32,
    'margin_bottom': 32,
    'gap_min': 16,                   # the closest two elements may ever sit
    'gap_section': 32,               # between sections
    'pad': 32,                       # panel inner padding
    'scale': (8, 16, 24, 32, 48),    # the only spacing values allowed
    'title_y': 32,                   # screen titles: fixed 32px from the top
}

# Exact type sizes in reference pixels (see the brief's floor: nothing under
# 14px except the two places it names explicitly - helper text and the webcam
# chip, both 13px).
TYPE_PX = {
    'title': 40, 'question': 26, 'heading': 18, 'score': 28,
    'body': 17, 'body_small': 16, 'chip': 15, 'label': 14, 'helper': 13,
}

ALPHA = {
    'panel': 0.90,            # panels sit on the lane at 90%
    'panel_solid': 0.92,      # ... and 92% for the info/setup panels
    'glow': 0.40,             # PLAY / START halo
    'keycap_fill': 0.20,
    'keycap_edge': 0.50,
    'chip_fill': 0.20,
    'tile_fill': 0.25,
    'select_glow': 0.50,
    'hover_edge': 0.60,
    'disabled': 0.40,
}

SIZES = {
    # Primary action (PLAY / START).
    'primary_w': 380, 'primary_h': 72, 'primary_radius': 14,
    'primary_font': 24, 'primary_tracking': 2,
    'primary_glow': 24,                       # glow blur in px
    # Secondary row (HOW TO PLAY / PHYSICS LAB / SETTINGS).
    'secondary_w': 220, 'secondary_h': 56, 'secondary_radius': 12,
    'secondary_font': 18, 'secondary_gap': 16, 'secondary_border': 2,
    'label_tracking': 1,                      # +1px on every button label
    'title_tracking': 2,                      # +2px on every title
    'title_font': 40,
    # Key caps (ENTER, the arrows, A / D).
    'keycap_h': 22, 'keycap_font': 13, 'keycap_radius': 6, 'keycap_pad': 8,
    'keycap_edge': 1, 'keycap_min_w': 26, 'keycap_inset': 16,
    # Vertical rhythm of the main menu.
    'gap_title_play': 48, 'gap_play_row': 24, 'gap_row_input': 32,
    'input_label_gap': 8, 'input_label_font': 14,
    # Segmented control (input mode).
    'segment_h': 40, 'segment_font': 16, 'segment_radius': 10,
    'segment_pad': 18, 'segment_inset': 4, 'segment_gap': 6,
    # QUIT.
    'quit_w': 120, 'quit_h': 44, 'quit_font': 16, 'quit_margin': 32,
    # Bottom hint bar.
    'hint_font': 15, 'hint_bottom': 32, 'hint_gap': 8, 'hint_group': 24,
    'hint_strip': 72, 'hint_strip_alpha': 0.80,
    'tagline_font': 18, 'tagline_tracking': 4,
    # Mode list (mode select, left column).
    'list_x': 96, 'list_y': 112, 'list_w': 400, 'row_h': 60, 'row_gap': 8,
    'row_radius': 12, 'row_pad': 16, 'row_title': 18, 'row_tile': 40,
    'row_tile_radius': 10, 'row_icon_gap': 16, 'row_check': 20,
    'row_select_border': 3, 'row_hover_border': 2, 'row_shift': 4,
    'row_glow': 20, 'row_focus_border': 2, 'row_focus_offset': 3,
    'row_dash': 7, 'row_dash_gap': 5,
    # Mode detail panel (right column).
    'detail_x': 536, 'detail_w': 648, 'detail_pad': 32,
    'detail_title': 32, 'detail_tagline': 18, 'detail_desc': 17,
    'detail_gap_title': 8, 'detail_gap_tagline': 16, 'detail_gap_desc': 24,
    'detail_gap_chips': 24, 'detail_gap_rule': 24, 'detail_gap_setup': 16,
    'detail_rule': 1,
    # How to Play.
    'tab_y': 104, 'tab_w': 160, 'tab_h': 44, 'tab_gap': 16, 'tab_font': 16,
    'tab_underline': 3, 'tab_tracking': 1,
    'howto_x': 96, 'howto_y': 168, 'howto_w': 1088, 'howto_chip_col': 150,
    'howto_row_gap': 16, 'howto_body': 17, 'howto_line': 25.5,
    'howto_scroll_w': 6, 'howto_fade': 24,
    # Settings.
    'settings_w': 560, 'settings_gap': 32, 'settings_y': 104,
    'settings_pad': 24, 'settings_heading': 18, 'settings_head_track': 3,
    'settings_rule_gap': 12, 'settings_first_gap': 20,
    'settings_row_gap': 10, 'settings_row_h': 52, 'settings_row_h_help': 64,
    'settings_row_pad': 20, 'settings_row_radius': 12,
    'settings_label': 17, 'settings_value': 17, 'settings_helper': 13,
    'settings_label_col': 160, 'settings_value_col': 56,
    'settings_thumb': 18, 'settings_track': 6,
    'settings_note': 14,
    # Question panel (Trivia).
    'question_w': 760, 'question_y': 96, 'question_pad': 32,
    'question_gap': 24, 'question_header': 14, 'question_text': 26,
    'question_body': 17, 'question_input_h': 56, 'question_input_pad': 20,
    'question_input_radius': 12, 'question_border': 2,
    'question_button_w': 160, 'question_button_h': 56,
    # Challenge panel (Equation Mode): wider, because it carries the lane
    # diagram and the measured result next to the problem.
    'challenge_w': 900, 'challenge_y': 72, 'challenge_pad': 28,
    'challenge_gap': 16, 'challenge_header': 14, 'challenge_title': 21,
    'challenge_body': 16, 'challenge_input_h': 52, 'challenge_input_pad': 18,
    'challenge_input_radius': 12, 'challenge_border': 2,
    'challenge_button_w': 164, 'challenge_button_h': 48,
    'challenge_diagram_w': 240, 'challenge_diagram_h': 150,
    'challenge_feedback_lines': 6,
    'score_chip_pad': 16, 'score_chip_radius': 12,
    # Kept for the shared widgets that read them (buttons, chips, the lab).
    'chip_font': 15, 'chip_pad_x': 14, 'chip_pad_y': 8,
    'chip_gap': 10, 'chip_row_gap': 8,
    'panel_radius': 16, 'panel_pad': 32, 'panel_rule': 2,
    'card_pad': 16, 'card_focus_offset': 3,
    'card_tile': 40, 'card_tile_radius': 10,
    'setup_heading': 14, 'setup_tracking': 3, 'setup_font': 16,
    'setup_gear': 24, 'setup_gear_gap': 16,
    'panel_min_h': 236,
    # Cards row width for the 4 + 3 picker layout (kept for compatibility).
    'picker_title': 40, 'picker_title_tracking': 2, 'picker_subtitle': 18,
    'picker_gap_title': 12, 'picker_gap_subtitle': 26,
    'picker_nav_gap': 18,
    # BACK / START.
    'nav_w': 200, 'nav_h': 56, 'nav_font': 18,
    'nav_margin': 48, 'nav_bottom': 32,
    # Motion.
    'transition': 0.14, 'hover_scale': 1.03, 'press_scale': 0.97,
    'hover_brighten': 0.10,
    'screen_enter': 0.18, 'screen_enter_rise': 12,
}

# Tokens the widgets further down read that are not part of a screen's grid:
# the mode row width (400 = the list column width) and the 1px hairline the
# segmented control draws around itself.
SIZES.update({
    'row_w': 400,
    'card_border': 1,
})

# The mode picker's icons and accent colours (the brief's per-mode colours).
MODE_ICONS = {
    'classic': 'pin', 'trivia': 'question', 'equations': 'sigma',
    'pvbot': 'robot', 'local': 'people3',
    'bowlrush': 'stopwatch',
}
MODE_ACCENTS = {
    'classic': COLORS['cyan'], 'trivia': COLORS['pink'],
    'equations': COLORS['green'],
    'pvbot': COLORS['purple'], 'local': COLORS['amber'],
    'bowlrush': COLORS['cyan'],
}

# The older widgets (MenuButton, Stepper, the HUD, the overlays, the Lab) draw
# from PALETTE; the keys they use now resolve to the exact tokens above, so no
# screen can be left with a grey, a brown or a dull green in it.
PALETTE.update({
    'panel': COLORS['panel'],
    'panel_dark': COLORS['card'],
    'panel_light': COLORS['card_high'],
    'magenta': COLORS['pink'],
    'brand': COLORS['pink'],
    'cyan': COLORS['cyan'],
    'red': COLORS['coral'],
    'amber': COLORS['amber'],
    'green': COLORS['green'],
    'white': COLORS['text'],
    'grey': COLORS['text_dim'],
    'dim': COLORS['text_dim'],
})

_SCALE_CACHE = {}


def ui_scale():
    """Layout scale: 1.0 at 16:9, a little smaller on narrower windows.

    The UI is one unit tall on every window, so reference pixels already scale
    with the height; this factor only pulls the composition in when the window
    is narrower than the reference so nothing can reach the edges.
    """
    try:
        aspect = round(float(window.aspect_ratio), 4)
    except Exception:                                  # pragma: no cover
        aspect = REFERENCE_ASPECT
    value = _SCALE_CACHE.get(aspect)
    if value is None:
        value = min(1.0, aspect / REFERENCE_ASPECT)
        _SCALE_CACHE[aspect] = value
    return value


def px(value):
    """Reference pixels -> UI units (both axes; the UI is height-normalised)."""
    return float(value) * ui_scale() / REFERENCE_HEIGHT


def screen_pos(x_px, y_px):
    """Top-left-origin reference pixels -> UI space, about the screen centre."""
    scale = ui_scale()
    return ((float(x_px) - REFERENCE_WIDTH / 2.0) * scale / REFERENCE_HEIGHT,
            (REFERENCE_HEIGHT / 2.0 - float(y_px)) * scale / REFERENCE_HEIGHT)


def font_px(value):
    """Reference pixels -> an ursina ``Text`` scale (1.0 is 18 px tall)."""
    return float(value) / 18.0 * ui_scale()


def brighten(rgb_tuple, amount=0.10):
    """Mix a colour towards white - the hover 'brighten 10%'."""
    return tuple(round(channel + (255 - channel) * amount)
                 for channel in rgb_tuple)


def alpha_of(rgb_tuple, alpha):
    return rgba(rgb_tuple, alpha)


def rgb(name):
    """Colour from the palette, as an Ursina colour."""
    return color.rgb32(*PALETTE[name])


def rgba(rgb_tuple, alpha=1.0):
    """RGBA from a 0-255 colour triple and a **0-1** alpha.

    Ursina's ``color.rgba32`` divides *every* component by 255, so an alpha of
    ``1.0`` would come out as 0.004 (invisible). This helper is the one place
    the two scales meet: colours are 0-255, alpha is 0-1, and the conversion
    happens here.
    """
    return color.rgba32(*(tuple(rgb_tuple) + (max(0.0, min(1.0, alpha)) * 255.0,)))


def shade(rgb_tuple, factor):
    return tuple(max(0, min(255, int(channel * factor)))
                 for channel in rgb_tuple)


def _mix_rgb(a, b, t):
    """Linear blend of two 0-255 colour triples (``t = 0`` -> ``a``)."""
    return tuple(round(a[index] + (b[index] - a[index]) * t)
                 for index in range(3))


# ---------------------------------------------------------------------------
# Pointer helpers
# ---------------------------------------------------------------------------
_KEY_CHARACTERS = {
    'space': ' ', 'period': '.', 'minus': '-', 'comma': ',',
    'slash': '/', 'semicolon': ';', 'equal': '=', 'plus': '+',
    'asterisk': '*', 'underscore': '_',
}


def key_to_character(key):
    """Map an Ursina key name to the character it types, or None.

    Ursina reports key *names* (``'a'``, ``'space'``, ``'shift+a'``), so text
    entry has to translate them. Anything not printable is ignored.
    """
    if not key:
        return None
    if len(key) == 1:
        return key if key.isprintable() else None
    if '+' in key:
        tail = key.split('+')[-1]
        if len(tail) == 1 and tail.isprintable():
            return tail.upper() if tail.isalpha() else tail
        return None
    return _KEY_CHARACTERS.get(key.lower())


def pointer_in(position, scale, x, y):
    """Rectangle hit test in UI space (pure, so tests can call it directly)."""
    half_w = abs(scale[0]) * 0.5
    half_h = abs(scale[1]) * 0.5
    return (position[0] - half_w <= x <= position[0] + half_w
            and position[1] - half_h <= y <= position[1] + half_h)


def widget_active(widget):
    """True when a widget may take input: enabled *and* on screen.

    Invisible widgets must never consume a click - a hidden control stacked on
    top of a visible one used to swallow the click and do something else.
    """
    return bool(getattr(widget, 'enabled', True)) \
        and bool(getattr(widget, 'visible', True))


def pointer():
    """Current pointer position in UI space."""
    return ui_pointer()


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------
def glow_text(parent, text, position=(0, 0), scale=1.0, rgb_tuple=None,
              origin=(0, 0), glow=None, glow_alpha=0.40, glow_offset=0.0028):
    """Bold text with a neon halo.

    The halo is four offset copies of the same string, which is what gives the
    chunky, glowing look of the hall's signage without a custom font or a
    shader. Returns the root entity; its ``.main`` attribute is the crisp
    front copy and ``.set_text`` updates every copy at once.
    """
    rgb_tuple = rgb_tuple or PALETTE['white']
    glow = glow or rgb_tuple
    root = Entity(parent=parent, position=(position[0], position[1], -0.02))
    copies = []
    for dx, dy in ((-glow_offset, 0.0), (glow_offset, 0.0),
                   (0.0, -glow_offset), (0.0, glow_offset)):
        copies.append(Text(parent=root, text=text, origin=origin,
                           position=(dx, dy), scale=scale,
                           color=rgba(glow, glow_alpha), z=0.0))
    main = Text(parent=root, text=text, origin=origin, position=(0, 0),
                scale=scale, color=rgba(rgb_tuple, 1.0), z=0.01)
    root.main = main
    root.copies = copies
    root.glow_rgb = glow

    def set_text(value, colour=None):
        for copy in copies:
            copy.text = value
        main.text = value
        if colour is not None:
            main.color = rgba(colour, 1.0)

    root.set_text = set_text
    return root


def set_glow_colours(root, rgb_tuple=None, glow=None, glow_alpha=0.40):
    """Re-tint a :func:`glow_text` root (its main line and its halo copies).

    Used by the results screen to give an award banner its own colour without
    rebuilding the text.
    """
    if rgb_tuple is not None:
        root.main.color = rgba(tuple(rgb_tuple), 1.0)
    if glow is not None:
        root.glow_rgb = tuple(glow)
        for copy in root.copies:
            copy.color = rgba(tuple(glow), glow_alpha)
    return root


def label(parent, text, position=(0, 0), scale=0.8, rgb_tuple=None,
          origin=(-0.5, 0.5)):
    """A plain text line (no glow)."""
    return Text(parent=parent, text=text, position=position, scale=scale,
                color=rgba(rgb_tuple or PALETTE['grey'], 1.0), origin=origin)


def ui_triangle(width, height):
    """A flat triangle in UI space (apex up), for decorations."""
    from ursina import Mesh

    half = width / 2.0
    return Mesh(vertices=[(-half, -height / 2.0, 0.0),
                          (half, -height / 2.0, 0.0),
                          (0.0, height / 2.0, 0.0)],
                triangles=[0, 1, 2],
                uvs=[(0.0, 1.0), (1.0, 1.0), (0.5, 0.0)],
                normals=[(0.0, 0.0, -1.0)] * 3)


# ---------------------------------------------------------------------------
# The one backdrop and the one panel look
# ---------------------------------------------------------------------------
def dim_layer(parent, aspect=None, z=DIM_Z):
    """The single full-screen dim plus the rim vignette, behind all content.

    Every menu screen uses exactly this (and nothing else): a flat #0B0820 at
    55% and a vignette that goes from transparent in the centre to #0B0820 at
    70% at the edges. The old per-screen washes and the dark wrapper boxes
    behind the panels are gone.
    """
    aspect = float(aspect if aspect is not None else window.aspect_ratio)
    dim = Entity(parent=parent, model='quad', position=(0, 0, z),
                 scale=(aspect, 1.0), color=rgba(COLORS['veil'], 0.55),
                 shader=unlit_shader)
    vignette = Entity(parent=parent, model='quad',
                      position=(0, 0, z - 0.01),
                      scale=(aspect, 1.0),
                      texture=vignette_texture(COLORS['veil']),
                      color=color.white, shader=unlit_shader)
    return dim, vignette


def panel_plate(parent, width_px, height_px, radius_px=None, z=PANEL_Z):
    """The shared panel: rounded fill with the 1px cyan->pink rim."""
    radius = float(radius_px if radius_px is not None
                   else SIZES['panel_radius'])
    radius = min(radius, min(width_px, height_px) / 2.0)
    body = Entity(parent=parent, model='quad', position=(0, 0, z),
                  texture=panel_texture(
                      width_px, height_px, radius,
                      fill_rgb=COLORS['panel'], fill_alpha=ALPHA['panel_solid'],
                      border_left_rgb=COLORS['cyan'],
                      border_right_rgb=COLORS['pink'],
                      border_alpha=0.60),
                  color=color.white, shader=unlit_shader)
    body.scale = (px(width_px), px(height_px))
    return body


def panel(parent, position=(0, 0), scale=(0.5, 0.2), rgb_tuple=None,
          alpha=0.92, hairline=None, z=PANEL_Z):
    """A panel plate: #14102E at 92% with a 1px cyan->pink gradient border.

    ``position``/``scale`` are UI-space, as the older screens pass them;
    ``hairline`` and ``rgb_tuple`` are accepted and ignored (the old 3px top
    rule is gone - every panel now carries the same gradient rim).
    """
    width_px = abs(scale[0]) * REFERENCE_HEIGHT / max(ui_scale(), 1e-6)
    height_px = abs(scale[1]) * REFERENCE_HEIGHT / max(ui_scale(), 1e-6)
    body = panel_plate(parent, width_px, height_px, z=z)
    body.position = (position[0], position[1], z)
    return body


class ScreenTitle(Entity):
    """The one screen title: 40px bold white, +2px tracking, double pink glow.

    Drawn as two stacked TextSprites - a 12px halo at 80% and a 32px halo at
    40% - so the title reads as neon without a custom font. It is anchored to
    the top edge, 32px down the screen, and it never moves when the content
    below it changes.
    """

    FONT_PX = 40
    TRACKING = 2

    def __init__(self, parent, text='', center_px=640, top_px=None, z=None):
        super().__init__(parent=parent)
        top = float(LAYOUT['title_y'] if top_px is None else top_px)
        z = CONTENT_Z if z is None else z
        self.wide = TextSprite(
            self, text, size_px=self.FONT_PX, bold=True, tracking=self.TRACKING,
            rgb_tuple=(0, 0, 0), alpha=0.0, glow_rgb=COLORS['pink'],
            glow_px=32, glow_alpha=0.40, anchor='top', z=z + 0.02)
        self.near = TextSprite(
            self, text, size_px=self.FONT_PX, bold=True, tracking=self.TRACKING,
            rgb_tuple=COLORS['text'], glow_rgb=COLORS['pink'],
            glow_px=12, glow_alpha=0.80, anchor='top', z=z + 0.01)
        self.main = self.near
        self.center_px = float(center_px)
        self.top_px = top
        self.set_text(text)
        self.place()

    def set_text(self, text):
        """Set the title; both sprites update, the position stays fixed."""
        self.text = str(text)
        self.wide.set_text(self.text, rgb_tuple=(0, 0, 0), alpha=0.0)
        self.near.set_text(self.text, rgb_tuple=COLORS['text'], alpha=1.0)
        self.place()
        return self

    def place(self):
        x, y = screen_pos(self.center_px, self.top_px)
        # The text texture is cropped with 2 * blur of halo margin around the
        # ink, so the glyph top edge lands exactly at ``top_px`` on screen.
        self.wide.position = (x, y + px(2 * 32), self.wide.z)
        self.near.position = (x, y + px(2 * 12), self.near.z)
        return self

    def relayout(self):
        self.wide.relayout()
        self.near.relayout()
        return self.place()


def screen_title(parent, text, center_px=640):
    """Create the shared screen title (see :class:`ScreenTitle`)."""
    return ScreenTitle(parent, text, center_px=center_px)


def gradient_rule(parent, width_px, thickness_px=2.0, z=CONTENT_Z,
                  alpha=0.55, glow=10.0):
    """A 2px cyan->pink rule with a soft glow (the flat bars' replacement)."""
    entity = Entity(parent=parent, model='quad', position=(0, 0, z),
                    texture=gradient_bar_texture(
                        COLORS['cyan'], COLORS['pink'],
                        width=int(max(2, round(width_px))),
                        height=int(max(1, round(thickness_px))),
                        glow=glow),
                    color=rgba(COLORS['text'], alpha), shader=unlit_shader)
    entity.scale = (px(width_px), px(thickness_px + 2 * glow + 2))
    return entity


def bottom_strip(parent, height_px=72, alpha=0.80, z=DIM_Z + 0.02):
    """A fade-to-#0B0820 strip across the bottom edge (readable hints)."""
    entity = Entity(parent=parent, model='quad', position=(0, 0, z),
                    texture=vertical_fade_texture(COLORS['veil'], alpha=alpha,
                                                  height=128),
                    color=color.white, shader=unlit_shader)
    entity.scale = (window.aspect_ratio, px(height_px))
    entity.y = -0.5 + px(height_px) / 2.0
    return entity



def neon_bar(parent, position, scale, rgb_tuple=None, alpha=1.0, z=0.02):
    """A solid neon bar (trim, underline, gutter lip)."""
    return Entity(parent=parent, model='quad',
                  position=(position[0], position[1], z), scale=scale,
                  color=rgba(rgb_tuple or PALETTE['magenta'], alpha),
                  shader=unlit_shader)


# ---------------------------------------------------------------------------
# Buttons and controls
# ---------------------------------------------------------------------------
class MenuButton(Entity):
    """A clean menu button with hover, selection and click handling.

    Kept as an Entity (not :class:`ursina.Button`) because the layout, hover
    rules and hit testing here are the design system's own. The plate is the
    theme's quiet button: the #1C1745 card fill, a 2px accent border and a
    12px radius (all from :data:`SIZES`/:data:`COLORS`), with the label in
    white. Hovering brightens the plate by 10% and lights the halo; selection
    adds a soft glow, so the state reads without any extra outlines.

    The widget's own scale stays ``(1, 1, 1)`` and every child carries its
    absolute size: a non-uniform parent scale would squash the label text
    (Ursina renders text through the parent's matrix), which is exactly the
    bug that made the first menu screens unreadable.

    ``depth`` is accepted for callers written against the old gradient plate
    and no longer changes the fill: every button in the game is one plate.
    ``key_hint`` draws the same key cap as PLAY's ENTER, and
    :meth:`set_pulse` adds halo the title screens animate.
    """

    RADIUS = SIZES['secondary_radius']

    def __init__(self, parent, text, position=(0, 0), scale=(0.46, 0.062),
                 rgb_tuple=None, on_click=None, index=0, glyph=None,
                 text_scale=0.9, key_hint=None, depth=0.20, font_px=None,
                 tracking=None, radius_px=None):
        super().__init__(parent=parent, position=(position[0], position[1], 0.0))
        self.label = text
        self.accent = tuple(rgb_tuple or COLORS['cyan'])
        self.on_click = on_click
        self.index = index
        self.text_scale = 18.0 * float(text_scale)
        self.font_px = self.text_scale if font_px is None else float(font_px)
        self.tracking = (SIZES['label_tracking'] if tracking is None
                         else float(tracking))
        self.depth = max(0.0, min(1.0, float(depth)))
        self.radius_px = None if radius_px is None else float(radius_px)
        self.size = (float(scale[0]), float(scale[1]))
        width, height = self.size
        self._hovered = False
        self._selected = False
        self._glow = 0.0
        self._glyph_text = glyph or ''
        self.pulse = 0.0
        self.key_hint_text = str(key_hint) if key_hint else ''
        self._label_dx = -0.022 if key_hint else 0.0
        self.keycap = None
        # Draw order is by z, and Ursina's UI camera draws *smaller* z in
        # front, so the glow sits behind the plate and the text in front. The
        # halo is a stretched radial glow, so it never shows square corners.
        self.glow = Entity(parent=self, model='quad', position=(0, 0, 0.05),
                           scale=(width * 1.18, height * 2.4),
                           texture=glow_texture(self.accent, size=128,
                                                power=2.0),
                           color=rgba(self.accent, 0.0), shader=unlit_shader)
        self.body = Entity(parent=self, model='quad', position=(0, 0, 0.03),
                           scale=(width, height), shader=unlit_shader)
        self.edge = Entity(parent=self, model='quad', position=(0, 0, 0.015),
                           scale=(width, height), shader=unlit_shader)
        # The label is painted to a texture and centred on the plate, so its
        # glyph centre is the button's centre in both axes (Ursina's line-box
        # text sat visibly low on every plate).
        self.text = TextSprite(self, text, size_px=self.font_px,
                               rgb_tuple=COLORS['text'], bold=True,
                               tracking=self.tracking,
                               position=(self._label_dx, 0.0),
                               z=0.010)
        self.glyph = Text(parent=self, text=self._glyph_text,
                          origin=(0.5, 0.5),
                          position=(width / 2 - 0.022, 0.0, 0.010), scale=0.75,
                          color=rgba(self.accent, 0.9))
        self._skin()
        if key_hint:
            self.keycap = Keycap(self, self.key_hint_text)
            self._place_keycap(width, height)
        self._fit_label()

    def _skin(self):
        """Paint the plate from the tokens at the current size."""
        width, height = self.size
        width_px = width * REFERENCE_HEIGHT / max(ui_scale(), 1e-6)
        height_px = height * REFERENCE_HEIGHT / max(ui_scale(), 1e-6)
        radius = self.radius_px if self.radius_px is not None else min(
            self.RADIUS, min(width_px, height_px) / 2.0)
        self.body.texture = rounded_mask_texture(width_px, height_px, radius)
        self.body.color = rgba(COLORS['card'], 1.0)
        self.edge.texture = rounded_mask_texture(
            width_px, height_px, radius, SIZES['secondary_border'])
        self.edge.color = rgba(self.accent, 1.0)
        self.edge.scale = (width, height)
        self.text.color = rgba(COLORS['text'], 1.0)
        return self

    def _place_keycap(self, width, height):
        """Position the key cap on the right of the plate."""
        if self.keycap is None:
            return
        self.keycap.position = (width / 2 - px(SIZES['keycap_inset'])
                                - px(self.keycap.width_px) / 2.0, 0.0, 0.0)

    # ------------------------------------------------------------------ state
    def _fit_label(self):
        """Keep the label at its exact size; only its maximum width is set.

        Text is never shrunk to fit: the plate is the thing that has to be
        wide enough, so a long label is simply centred on it and stays legible.
        """
        self.text.max_width_px = None
        self.text.set_text(self.label)
        self.text.relayout()

    def set_label(self, text):
        """Replace the label; the plate re-fits long text."""
        self.label = str(text)
        self._fit_label()

    def set_selected(self, selected):
        self._selected = bool(selected)

    def set_pulse(self, amount):
        """Extra halo alpha a title screen may drive per frame (0 = off)."""
        self.pulse = max(0.0, float(amount))

    def resize(self, size):
        """Set the plate's size and re-lay out its children."""
        width, height = float(size[0]), float(size[1])
        self.size = (width, height)
        self.glow.scale = (width * 1.18, height * 2.4)
        self.body.scale = (width, height)
        self.edge.scale = (width, height)
        self._skin()
        self.text.position = (self._label_dx, 0.0, 0.010)
        if self.keycap is not None:
            self._place_keycap(width, height)
        self._fit_label()
        self.glyph.position = (width / 2 - 0.022, 0.0, 0.010)
        return self

    def set_enabled(self, enabled):
        self.enabled = bool(enabled)
        opacity = 1.0 if self.enabled else ALPHA['disabled']
        self.body.color = rgba(COLORS['card'], opacity)
        self.edge.color = rgba(self.accent, opacity)
        self.text.set_color(COLORS['text'], alpha=opacity)
        if not self.enabled:
            self.glow.color = rgba(self.accent, 0.0)

    def contains(self, x, y):
        return widget_active(self) and pointer_in((self.position[0],
                                                   self.position[1]),
                                                  self.size, x, y)

    def update_widget(self, x, y, dt):
        """Refresh hover/selection visuals for this frame."""
        if not self.enabled:
            return
        hovered = self.contains(x, y)
        self._hovered = hovered
        target = 1.0 if (hovered or self._selected) else 0.0
        self._glow += (target - self._glow) * min(1.0, max(0.0, dt) * 7.0)
        halo = 0.16 * self._glow + self.pulse
        self.glow.color = rgba(self.accent, min(0.40, halo))
        self.body.color = rgba(brighten(COLORS['card'],
                                        SIZES['hover_brighten'] * self._glow),
                               1.0)
        self.edge.color = rgba(brighten(self.accent,
                                        SIZES['hover_brighten'] * self._glow),
                               1.0)
        self.text.set_color(COLORS['text'], alpha=1.0)

    def click(self, x, y):
        """Handle a click; returns True when this button consumed it."""
        if not self.contains(x, y):
            return False
        if callable(self.on_click):
            self.on_click(self)
        return True


class Stepper(Entity):
    """One settings row: a label on the left, a value on the right.

    The row is the design system's control: the #1C1745 card fill, a 1px
    #3A3270 border, a 12px radius and 20px of horizontal padding, with the
    label (17px white) and the value (17px bold cyan) sharing one vertical
    centre line. An optional ``helper`` line sits *inside* the row, under the
    label at 13px - never between rows. Two chevrons are drawn beside the
    value - the left one steps down, the right one steps up - and clicking
    anywhere else on the row steps up, so mouse and keyboard paths keep
    working. Passing ``on_value_click`` turns the number itself into an
    editable field: the Lab uses it for typed launch values, while every
    other stepper keeps the click-to-step behaviour.
    """

    RADIUS = SIZES['settings_row_radius']
    LABEL_FONT = SIZES['settings_label']
    VALUE_FONT = SIZES['settings_value']
    HELPER_FONT = SIZES['settings_helper']
    PAD = SIZES['settings_row_pad']
    ARROW = 10.0          # chevron glyph size in reference pixels
    ARROW_GAP = 14.0

    def __init__(self, parent, caption, value_text, position=(0, 0),
                 scale=(0.42, 0.058), on_step=None, accent=None, helper='',
                 value_colour=None, on_value_click=None):
        super().__init__(parent=parent, position=(position[0], position[1], 0))
        self.caption = caption
        self.helper = str(helper or '')
        self.size = (float(scale[0]), float(scale[1]))
        self.size_px = (self.size[0] * REFERENCE_HEIGHT / max(ui_scale(), 1e-6),
                        self.size[1] * REFERENCE_HEIGHT / max(ui_scale(), 1e-6))
        self.value_text = value_text
        self.on_step = on_step
        # When set, clicking the number itself (between the chevrons) calls
        # this instead of stepping. The Physics Lab uses it to start typed
        # entry; plain steppers leave it None and keep the old behaviour.
        self.on_value_click = on_value_click
        self.accent = tuple(accent or COLORS['cyan'])
        self.value_colour = tuple(value_colour or COLORS['cyan'])
        width, height = self.size
        self.body = Entity(parent=self, model='quad', scale=(width, height),
                           position=(0, 0, 0.03), shader=unlit_shader)
        self.ring = Entity(parent=self, model='quad', scale=(width, height),
                           position=(0, 0, 0.025), shader=unlit_shader)
        self.left_arrow = Entity(parent=self, model='quad',
                                 position=(-width / 2 + 0.016, 0, 0.02),
                                 scale=(0.028, height * 0.92),
                                 color=rgba(COLORS['text'], 0.0),
                                 shader=unlit_shader)
        self.right_arrow = Entity(parent=self, model='quad',
                                  position=(width / 2 - 0.016, 0, 0.02),
                                  scale=(0.028, height * 0.92),
                                  color=rgba(COLORS['text'], 0.0),
                                  shader=unlit_shader)
        self.caption_text = TextSprite(self, caption, size_px=self.LABEL_FONT,
                                       rgb_tuple=COLORS['text'], anchor='left',
                                       z=-0.01)
        self.value = TextSprite(self, value_text, size_px=self.VALUE_FONT,
                                rgb_tuple=self.value_colour, bold=True,
                                anchor='right', z=-0.01)
        self.helper_text = TextSprite(self, self.helper,
                                      size_px=self.HELPER_FONT,
                                      rgb_tuple=COLORS['text_dim'],
                                      anchor='left', z=-0.01)
        self.left_glyph = Entity(parent=self,
                                 model=ui_triangle(px(self.ARROW * 1.7),
                                                   px(self.ARROW * 1.4)),
                                 rotation_z=-90, color=rgba(self.accent, 0.95),
                                 shader=unlit_shader)
        self.right_glyph = Entity(parent=self,
                                  model=ui_triangle(px(self.ARROW * 1.7),
                                                    px(self.ARROW * 1.4)),
                                  rotation_z=90,
                                  color=rgba(self.accent, 0.95),
                                  shader=unlit_shader)
        self._skin()
        self._layout()

    # ------------------------------------------------------------------ skin
    def _skin(self):
        """Re-paint the row from the tokens at the current size."""
        width_px, height_px = self.size_px
        self.body.texture = rounded_mask_texture(width_px, height_px,
                                                 self.RADIUS)
        self.body.color = rgba(COLORS['card'], 1.0)
        self.body.scale = (self.size[0], self.size[1])
        self.ring.texture = rounded_mask_texture(width_px, height_px,
                                                 self.RADIUS, 1)
        self.ring.scale = (self.size[0], self.size[1])
        self.ring.color = rgba(COLORS['hairline'], 1.0)

    def _line_offsets(self):
        """``(label_y, helper_y)`` in UI units, measured from the row centre."""
        if not self.helper:
            return 0.0, None
        height_px = self.size_px[1]
        block = self.LABEL_FONT * 1.25 + 4.0 + self.HELPER_FONT * 1.35
        top = (height_px - block) / 2.0
        label_y = height_px / 2.0 - top - self.LABEL_FONT * 0.625
        helper_y = label_y - self.LABEL_FONT * 0.625 - 4.0 \
            - self.HELPER_FONT * 0.675
        return px(label_y), px(helper_y)

    def _chevron_x(self):
        """``(left_x, right_x)``: where the two chevrons are drawn.

        Both sit beside the value on the right half of the row - the caption
        owns the left half - so the decrement glyph is the one immediately
        *left of the number* and the increment glyph sits at the row's right
        edge. :meth:`areas` uses the same maths, so what is drawn is exactly
        what is clickable.
        """
        width = self.size[0]
        pad = px(self.PAD)
        gap = px(self.ARROW_GAP)
        value_w = px(self.value.width_px)
        return (width / 2.0 - pad - px(self.ARROW) - value_w - gap,
                width / 2.0 - gap)

    def _layout(self):
        width = self.size[0]
        pad = px(self.PAD)
        label_y, helper_y = self._line_offsets()
        self.caption_text.position = (-width / 2.0 + pad, label_y, -0.01)
        self.value.set_text(self.value_text)
        self.value.set_color(self.value_colour)
        # The value stays right-aligned; the two chevrons sit just outside it
        # (a stepper affordance that never overlaps the number).
        self.value.position = (width / 2.0 - pad - px(self.ARROW), label_y,
                               -0.01)
        if helper_y is None:
            self.helper_text.visible = False
        else:
            self.helper_text.visible = True
            self.helper_text.max_width_px = max(
                40.0, self.size_px[0] - 2 * self.PAD - 120.0)
            self.helper_text.set_text(self.helper)
            self.helper_text.position = (-width / 2.0 + pad, helper_y, -0.01)
        left_x, right_x = self._chevron_x()
        self.right_arrow.position = (right_x, 0.0, 0.02)
        self.left_arrow.position = (left_x, 0.0, 0.02)
        self.right_glyph.position = (right_x, 0.0, 0.018)
        self.left_glyph.position = (left_x, 0.0, 0.018)
        self.left_arrow.scale = (px(self.ARROW * 2.4), self.size[1] * 0.92)
        self.right_arrow.scale = (px(self.ARROW * 2.0), self.size[1] * 0.92)

    # ------------------------------------------------------------------ state
    def set_size_px(self, size_px):
        """Resize from reference pixels (the mode picker lays out in px)."""
        self.size_px = (float(size_px[0]), float(size_px[1]))
        scale = ui_scale()
        self.resize((self.size_px[0] * scale / REFERENCE_HEIGHT,
                     self.size_px[1] * scale / REFERENCE_HEIGHT))
        return self

    def set_value(self, text):
        self.value_text = str(text)
        self.value.set_text(self.value_text)
        self._layout()

    def set_helper(self, text):
        self.helper = str(text or '')
        self._layout()

    def resize(self, size):
        """Set the row's size and re-lay out its children."""
        width, height = float(size[0]), float(size[1])
        self.size = (width, height)
        self.size_px = (width * REFERENCE_HEIGHT / max(ui_scale(), 1e-6),
                        height * REFERENCE_HEIGHT / max(ui_scale(), 1e-6))
        self.body.scale = (width, height)
        self.ring.scale = (width, height)
        self.left_arrow.scale = (px(self.ARROW * 2.4), height * 0.92)
        self.right_arrow.scale = (px(self.ARROW * 2.0), height * 0.92)
        self._skin()
        self._layout()
        return self

    def areas(self):
        """``(left_rect, right_rect, body_rect)`` in UI space.

        The side zones are exactly where the chevrons are drawn - immediately
        left and right of the value - so clicking the visible left chevron
        steps the value *down* and the right one steps it up. The body zone
        still covers the whole row and steps forward.
        """
        x, y = self.position[0], self.position[1]
        w, h = self.size
        left_x, right_x = self._chevron_x()
        zone = px(self.ARROW * 3.0)
        return ((x + left_x, y, zone, h),
                (x + right_x, y, zone, h),
                (x, y, w, h))

    def value_rect(self):
        """The number's own clickable zone: between the two chevrons.

        A stepper with ``on_value_click`` treats this as an editable field;
        the rect is clipped short of each chevron so the arrows keep working.
        """
        x, y = self.position[0], self.position[1]
        left_x, right_x = self._chevron_x()
        zone = px(self.ARROW * 3.0)
        x0 = left_x + zone / 2.0
        x1 = right_x - zone / 2.0
        width = max(px(self.ARROW * 2.0), x1 - x0)
        return (x + (x0 + x1) / 2.0, y, width, self.size[1] * 0.92)

    def value_hit(self, x, y):
        vx, vy, vw, vh = self.value_rect()
        return pointer_in((vx, vy), (vw, vh), x, y)

    def click(self, x, y):
        if not widget_active(self):
            return False
        left, right, body = self.areas()
        if pointer_in((left[0], left[1]), (left[2], left[3]), x, y):
            self._step(-1)
            return True
        if pointer_in((right[0], right[1]), (right[2], right[3]), x, y):
            self._step(1)
            return True
        if callable(self.on_value_click) and self.value_hit(x, y):
            self.on_value_click(self)
            return True
        if pointer_in((body[0], body[1]), (body[2], body[3]), x, y):
            self._step(1)
            return True
        return False

    def _step(self, direction):
        if callable(self.on_step):
            self.on_step(direction)

    def update_widget(self, x, y, dt):
        left, right, body = self.areas()
        hover_left = pointer_in((left[0], left[1]), (left[2], left[3]), x, y)
        hover_right = pointer_in((right[0], right[1]), (right[2], right[3]),
                                 x, y)
        hover_row = pointer_in((body[0], body[1]), (body[2], body[3]), x, y)
        self.left_arrow.color = rgba(COLORS['text'],
                                     0.07 if hover_left else 0.0)
        self.right_arrow.color = rgba(COLORS['text'],
                                      0.07 if hover_right else 0.0)
        self.body.color = rgba(brighten(COLORS['card'],
                                        0.04 if hover_row else 0.0), 1.0)
        self.left_glyph.color = rgba(self.accent, 1.0 if hover_left
                                     else 0.75)
        self.right_glyph.color = rgba(self.accent, 1.0 if hover_right
                                      else 0.75)


class Toggle(Stepper):
    """A boolean setting: the same row, with an ON/OFF chip for the value.

    ON is a cyan fill with dark text, OFF is the #3A3270 fill with secondary
    text. Clicking anywhere on the row still flips it.
    """

    CHIP_FONT = SIZES['settings_value']
    CHIP_PAD_X = 12.0
    CHIP_H = 26.0

    def __init__(self, parent, caption, value_text, position=(0, 0),
                 scale=(0.42, 0.058), on_flip=None, accent=None, helper='',
                 value_colour=None):
        super().__init__(parent, caption, value_text, position, scale,
                         on_step=None, accent=accent, helper=helper,
                         value_colour=value_colour)
        self.on_flip = on_flip
        self.value.visible = False
        self.chip = Entity(parent=self, z=-0.012)
        self.chip.plate = Entity(parent=self.chip, model='quad', z=0.01,
                                 shader=unlit_shader)
        self.chip.label = TextSprite(self.chip, str(value_text),
                                     size_px=self.CHIP_FONT, bold=True, z=0.0)
        self.left_arrow.visible = False
        self.right_arrow.visible = False
        self.left_glyph.visible = False
        self.right_glyph.visible = False
        self._sync_chip()

    def _sync_chip(self):
        width = self.chip.label.width_px + 2.0 * self.CHIP_PAD_X
        height = self.CHIP_H
        self.chip.plate.texture = rounded_mask_texture(width, height,
                                                       height / 2.0)
        self.chip.plate.scale = (px(width), px(height))
        pad = px(self.PAD)
        chip_x = (self.size[0] / 2.0 - pad - px(width) / 2.0)
        label_y, _helper = self._line_offsets()
        self.chip.position = (chip_x, label_y, -0.012)
        on = str(self.value_text).upper() == 'ON'
        fill = COLORS['cyan'] if on else COLORS['hairline']
        text = COLORS['ink'] if on else COLORS['text_dim']
        self.chip.plate.color = rgba(fill, 1.0)
        self.chip.label.set_text(self.value_text)
        self.chip.label.set_color(text)

    def set_value(self, text):
        self.value_text = str(text)
        self._sync_chip()

    def _layout(self):
        super()._layout()
        if hasattr(self, 'chip'):
            self._sync_chip()

    def resize(self, size):
        super().resize(size)
        if hasattr(self, 'chip'):
            self._sync_chip()
        return self

    def click(self, x, y):
        if not widget_active(self):
            return False
        _left, _right, body = self.areas()
        if pointer_in((body[0], body[1]), (body[2], body[3]), x, y):
            if callable(self.on_flip):
                self.on_flip(self)
            return True
        return False

    def update_widget(self, x, y, dt):
        _left, _right, body = self.areas()
        hover_row = pointer_in((body[0], body[1]), (body[2], body[3]), x, y)
        self.body.color = rgba(brighten(COLORS['card'],
                                        0.04 if hover_row else 0.0), 1.0)
        self.left_arrow.color = rgba(COLORS['text'], 0.0)
        self.right_arrow.color = rgba(COLORS['text'], 0.0)


class TextEntry(Entity):
    """A single-line text field (names, trivia answers).

    Ursina delivers key names, not characters, so :meth:`on_key` maps the
    names it can (letters, digits, ``space``, ``period``, ``minus``) onto text
    and ignores the rest. Backspace and Enter are handled by the caller through
    the returned command. Like the other widgets, the label is a child of an
    unscaled root so the text is never squashed.
    """

    ACCEPTED = {
        'space': ' ', 'period': '.', 'minus': '-', 'comma': ',',
        'slash': '/', 'semicolon': ';', 'equal': '=', 'plus': '+',
        'left shift': '', 'right shift': '',
    }

    def __init__(self, parent, position=(0, 0), scale=(0.5, 0.062),
                 placeholder='', rgb_tuple=None, on_submit=None):
        super().__init__(parent=parent, position=(position[0], position[1], 0))
        self.size = (float(scale[0]), float(scale[1]))
        self.accent = tuple(rgb_tuple or PALETTE['amber'])
        self.placeholder = placeholder
        self.text = ''
        self.focused = False
        self.on_submit = on_submit
        width, height = self.size
        self.body = Entity(parent=self, model='quad', scale=(width, height),
                           position=(0, 0, 0.03),
                           color=rgba(PALETTE['panel_dark'], 0.9),
                           shader=unlit_shader)
        self.caret = Entity(parent=self, model='quad',
                            position=(-width / 2 + 0.012, 0, 0.01),
                            scale=(0.005, height * 0.66),
                            color=rgba(self.accent, 0.9), shader=unlit_shader)
        self.caret.visible = False
        self.label = Text(parent=self, text='', origin=(-0.5, 0.5),
                          position=(-width / 2 + 0.020, 0.0), scale=0.95,
                          color=rgb('white'))
        self.hint = Text(parent=self, text=placeholder, origin=(-0.5, 0.5),
                         position=(-width / 2 + 0.020, 0.0), scale=0.8,
                         color=rgba(PALETTE['dim'], 0.9))

    # ------------------------------------------------------------------ state
    def focus(self, focused=True):
        self.focused = bool(focused)
        self.caret.visible = self.focused
        self.body.color = rgba(PALETTE['panel_dark'],
                               1.0 if self.focused else 0.75)

    def set_text(self, text):
        self.text = str(text)

    def on_key(self, key):
        """Handle a key press; returns ``'submit'``, ``'change'`` or None."""
        if not self.focused:
            return None
        if key in ('enter', 'return'):
            if callable(self.on_submit):
                self.on_submit(self.text)
            return 'submit'
        if key == 'backspace':
            self.text = self.text[:-1]
            return 'change'
        if key == 'escape':
            self.focus(False)
            return None
        character = key_to_character(key)
        if character:
            self.text += character
            return 'change'
        return None

    def click(self, x, y):
        if not widget_active(self):
            return False
        if pointer_in((self.position[0], self.position[1]), self.size, x, y):
            self.focus(True)
            return True
        self.focus(False)
        return False

    def update_widget(self, x, y, dt):
        self.label.text = self.text
        self.hint.visible = not bool(self.text)
        self.caret.visible = self.focused
        if self.focused:
            width = self.size[0]
            self.caret.x = min(-width / 2 + 0.016 + self.label.width
                               * float(self.label.scale[0]),
                               width / 2 - 0.014)


class Slider(Entity):
    """One slider row: label column, track, value column, on one centre line.

    The label owns a fixed 160px column on the left and the value a fixed
    56px column on the right (right-aligned); the 6px #3A3270 track with its
    cyan fill and 18px white thumb fills what is left. The drag geometry is
    unchanged, so the click-and-drag behaviour the settings screen relies on
    is exactly the same.
    """

    TRACK_PX = SIZES['settings_track']
    THUMB_PX = SIZES['settings_thumb']
    RADIUS_PX = SIZES['settings_row_radius']
    LABEL_FONT = SIZES['settings_label']
    VALUE_FONT = SIZES['settings_value']
    LABEL_COL = SIZES['settings_label_col']
    VALUE_COL = SIZES['settings_value_col']
    PAD = SIZES['settings_row_pad']

    def __init__(self, parent, caption, value=0.5, position=(0, 0),
                 scale=(0.42, 0.05), on_change=None, accent=None,
                 formatter=None):
        super().__init__(parent=parent, position=(position[0], position[1], 0))
        self.caption = caption
        self.value = max(0.0, min(1.0, float(value)))
        self.size = (float(scale[0]), float(scale[1]))
        self.on_change = on_change
        self.formatter = formatter or (lambda v: f'{int(round(v * 100))}%')
        self.accent = tuple(accent or COLORS['cyan'])
        self._dragging = False
        width, height = self.size
        self.width_px = width * REFERENCE_HEIGHT / max(ui_scale(), 1e-6)
        self.height_px = height * REFERENCE_HEIGHT / max(ui_scale(), 1e-6)
        self.body = Entity(parent=self, model='quad', scale=(width, height),
                           position=(0, 0, 0.03), shader=unlit_shader)
        self.body.texture = rounded_mask_texture(self.width_px, self.height_px,
                                                 self.RADIUS_PX)
        self.body.color = rgba(COLORS['card'], 1.0)
        self.ring = Entity(parent=self, model='quad', scale=(width, height),
                           position=(0, 0, 0.025), shader=unlit_shader)
        self.ring.texture = rounded_mask_texture(self.width_px, self.height_px,
                                                 self.RADIUS_PX, 1)
        self.ring.color = rgba(COLORS['hairline'], 1.0)
        self.track_width = width * 0.44
        self.track_scale = (self.track_width, px(self.TRACK_PX))
        self.track = Entity(parent=self, model='quad',
                            position=(width * 0.14, 0, 0.02),
                            scale=self.track_scale, shader=unlit_shader)
        self.fill = Entity(parent=self.track, model='quad',
                           origin=(-0.5, 0), position=(-0.5, 0, -0.01),
                           scale=(max(0.001, self.value), 1.0),
                           color=rgba(self.accent, 1.0), shader=unlit_shader)
        self.thumb = Entity(parent=self.track, model='quad', z=-0.02,
                            texture=rounded_mask_texture(self.THUMB_PX,
                                                         self.THUMB_PX,
                                                         self.THUMB_PX / 2.0),
                            color=rgba(COLORS['text'], 1.0),
                            shader=unlit_shader)
        self.caption_text = TextSprite(self, caption, size_px=self.LABEL_FONT,
                                       rgb_tuple=COLORS['text'], anchor='left',
                                       z=-0.01)
        self.value_text = TextSprite(self, '', size_px=self.VALUE_FONT,
                                     rgb_tuple=COLORS['cyan'], bold=True,
                                     anchor='right', z=-0.01)
        self._layout()
        self._sync()

    def _layout(self):
        """Label / track / value on one centre line, columns fixed."""
        width = self.size[0]
        pad = px(self.PAD)
        label_col = min(self.LABEL_COL, self.width_px * 0.42)
        self.caption_text.position = (-width / 2.0 + pad, 0.0, -0.01)
        self.value_text.position = (width / 2.0 - pad, 0.0, -0.01)
        track_left = -width / 2.0 + px(label_col)
        track_right = width / 2.0 - pad - px(self.VALUE_COL) - px(16)
        self.track_width = max(px(40), track_right - track_left)
        self.track_scale = (self.track_width, px(self.TRACK_PX))
        self.track.scale = self.track_scale
        self.track.position = ((track_left + track_right) / 2.0, 0.0, 0.02)
        track_px = (self.track_width * REFERENCE_HEIGHT
                    / max(ui_scale(), 1e-6))
        self.track.texture = rounded_mask_texture(track_px, self.TRACK_PX,
                                                  self.TRACK_PX / 2.0)
        self.track.color = rgba(COLORS['hairline'], 1.0)
        self.fill.texture = rounded_mask_texture(track_px, self.TRACK_PX,
                                                 self.TRACK_PX / 2.0)
        self.value_text.set_text(self.formatter(self.value))

    def set_size_px(self, size_px):
        """Resize from reference pixels (the settings layout works in px)."""
        self.size_px = (float(size_px[0]), float(size_px[1]))
        scale = ui_scale()
        return self.resize((self.size_px[0] * scale / REFERENCE_HEIGHT,
                            self.size_px[1] * scale / REFERENCE_HEIGHT))

    def resize(self, size):
        """Set the row's size and re-lay out its track and columns."""
        width, height = float(size[0]), float(size[1])
        self.size = (width, height)
        self.width_px = width * REFERENCE_HEIGHT / max(ui_scale(), 1e-6)
        self.height_px = height * REFERENCE_HEIGHT / max(ui_scale(), 1e-6)
        self.body.scale = (width, height)
        self.ring.scale = (width, height)
        self.body.texture = rounded_mask_texture(self.width_px, self.height_px,
                                                 self.RADIUS_PX)
        self.ring.texture = rounded_mask_texture(self.width_px, self.height_px,
                                                 self.RADIUS_PX, 1)
        self._layout()
        self._sync()
        return self

    def _sync(self):
        self.fill.scale = (max(0.001, self.value), 1.0)
        self.value_text.set_text(self.formatter(self.value))
        thumb = px(self.THUMB_PX)
        self.thumb.position = (-0.5 + self.value, 0.0, -0.02)
        self.thumb.scale = (thumb / max(1e-6, self.track_scale[0]),
                            thumb / max(1e-6, self.track_scale[1]), 1.0)

    def set_value(self, value, notify=False):
        self.value = max(0.0, min(1.0, float(value)))
        self._sync()
        if notify and callable(self.on_change):
            self.on_change(self.value)

    def nudge(self, amount):
        self.set_value(self.value + amount, notify=True)

    def click(self, x, y):
        if not widget_active(self):
            return False
        if pointer_in((self.position[0], self.position[1]), self.size, x, y):
            self._dragging = True
            self._drag_to(x)
            return True
        return False

    def _drag_to(self, x):
        start = (self.position[0] + self.track.position[0]
                 - self.track_width / 2.0)
        fraction = (x - start) / max(1e-6, self.track_width)
        self.set_value(fraction, notify=True)

    def update_widget(self, x, y, dt):
        hover_row = pointer_in((self.position[0], self.position[1]),
                               self.size, x, y)
        self.body.color = rgba(brighten(COLORS['card'],
                                        0.04 if hover_row else 0.0), 1.0)
        if self._dragging:
            from ursina import mouse
            if not getattr(mouse, 'left', False):
                self._dragging = False
            else:
                self._drag_to(x)


def divider(parent, y, width=0.72, rgb_tuple=None, alpha=0.5, z=0.01):
    """A thin horizontal rule with a bright centre."""
    return Entity(parent=parent, model='quad', position=(0, y, z),
                  scale=(width, 0.003), color=rgba(rgb_tuple or PALETTE['magenta'],
                                                   alpha), shader=unlit_shader)


class ModeRow(Entity):
    """One row of the mode list: a 40px icon tile, the mode title, a check.

    The row is 400x60 with a 12px radius, a 1px #3A3270 border and the
    #1C1745 card fill, the icon left and the 18px bold title next to it. The
    states are deliberately distinct:

    * hover    - a 2px white border at 60%
    * selected - the accent border at 3px, a 20px glow, the #251F5A fill,
      the row shifted 4px right and a 20px filled check circle at the end
    * focus    - a 2px dashed white outline, offset 3px (keyboard navigation)
    """

    def __init__(self, parent, title, position=(0.0, 0.0), size_px=None,
                 on_click=None, index=0, icon=None, accent=None, z=CARD_Z):
        super().__init__(parent=parent, position=(position[0], position[1], z))
        self.title_text = title
        self.index = index
        self.accent = tuple(accent or COLORS['cyan'])
        self.icon_name = icon or 'pin'
        self.size_px = tuple(size_px or (SIZES['row_w'], SIZES['row_h']))
        self.on_click = on_click
        self._hovered = False
        self._selected = False
        self._focused = False
        self._hover = 0.0
        self._hover_t = 0.0
        self._shift = 0.0
        self.size = (px(self.size_px[0]), px(self.size_px[1]))
        self.hit_size = self.size
        self.base_position = (position[0], position[1])
        self._build()
        self.relayout()

    # ---------------------------------------------------------------- visuals
    def _build(self):
        width, height = self.size_px
        self.glow = Entity(parent=self, model='quad', z=0.06,
                           texture=glow_texture(self.accent, size=128,
                                                power=2.0),
                           color=rgba(self.accent, 0.0), shader=unlit_shader)
        self.body = Entity(parent=self, model='quad', z=0.05,
                           shader=unlit_shader)
        self.edge = Entity(parent=self, model='quad', z=0.04,
                           shader=unlit_shader)
        self.focus = Entity(parent=self, model='quad', z=0.03,
                            shader=unlit_shader)
        self.tile = icon_tile(self, self.icon_name, tile_px=SIZES['row_tile'],
                              radius_px=SIZES['row_tile_radius'],
                              accent=self.accent, z=0.0)
        self.title_label = TextSprite(self, self.title_text,
                                      size_px=SIZES['row_title'],
                                      rgb_tuple=COLORS['text'], bold=True,
                                      anchor='left', z=-0.01)
        self.badge = Entity(parent=self, z=-0.02)
        size = SIZES['row_check']
        self.badge.plate = plate_entity(
            self.badge, size, size,
            rounded_mask_texture(size, size, size / 2.0), self.accent, 1.0)
        self.badge.check = Entity(parent=self.badge, model='quad', z=-0.01,
                                  texture=icon_texture('check', size=96),
                                  color=rgba(COLORS['ink'], 1.0),
                                  shader=unlit_shader)
        self.badge.check.scale = (px(size * 0.60),) * 2
        self.badge.visible = False
        self.marker = self.badge

    def _local(self, x_px, y_px):
        """Row-local reference pixels (top-left origin) -> entity offset."""
        return (px(x_px - self.size_px[0] / 2.0),
                -px(y_px - self.size_px[1] / 2.0))

    def place(self, position):
        """Place the row by its centre (UI space); the select shift is added."""
        self.base_position = (position[0], position[1])
        self.position = (position[0] + px(self._shift), position[1], self.z)
        return self

    def relayout(self):
        width, height = self.size_px
        self.size = (px(width), px(height))
        self.hit_size = (px(width), px(height))
        radius = min(SIZES['row_radius'], min(width, height) / 2.0)
        self.body.texture = rounded_mask_texture(width, height, radius)
        self.body.scale = (px(width), px(height))
        tile_size = SIZES['row_tile']
        self.tile.position = self._local(SIZES['row_pad'] + tile_size / 2.0,
                                         height / 2.0)
        text_left = SIZES['row_pad'] + tile_size + SIZES['row_icon_gap']
        self.title_label.max_width_px = (width - text_left - SIZES['row_pad']
                                         - SIZES['row_check'] - 12.0)
        self.title_label.set_text(self.title_text)
        self.title_label.position = self._local(text_left, height / 2.0)
        badge_half = SIZES['row_check'] / 2.0
        self.badge.position = self._local(width - SIZES['row_pad'] - badge_half,
                                          height / 2.0)
        offset = SIZES['row_focus_offset']
        self.focus.texture = rounded_dash_texture(
            width + 2 * offset, height + 2 * offset,
            radius + offset, SIZES['row_focus_border'], SIZES['row_dash'],
            SIZES['row_dash_gap'])
        self.focus.scale = (px(width + 2 * offset), px(height + 2 * offset))
        self.focus.color = rgba(COLORS['text'], 0.0)
        self.glow.scale = (px(width + 2 * SIZES['row_glow']),
                           px(height + 2 * SIZES['row_glow']))
        self._sync()
        return self

    def _set_edge(self, thickness, rgb_tuple, alpha=1.0):
        width, height = self.size_px
        radius = min(SIZES['row_radius'], min(width, height) / 2.0)
        self.edge.texture = rounded_mask_texture(width, height, radius,
                                                 thickness)
        self.edge.scale = (px(width), px(height))
        self.edge.color = rgba(rgb_tuple, alpha)

    def _sync(self):
        if self._selected:
            self.body.color = rgba(COLORS['card_high'], 1.0)
            self._set_edge(SIZES['row_select_border'], self.accent, 1.0)
            self.glow.color = rgba(self.accent, ALPHA['select_glow'])
            self.badge.visible = True
        elif self._hovered:
            self.body.color = rgba(brighten(COLORS['card'], 0.06), 1.0)
            self._set_edge(SIZES['row_hover_border'], COLORS['text'],
                           ALPHA['hover_edge'])
            self.glow.color = rgba(self.accent, 0.10)
            self.badge.visible = False
        else:
            self.body.color = rgba(COLORS['card'], 1.0)
            self._set_edge(1, COLORS['hairline'], 1.0)
            self.glow.color = rgba(self.accent, 0.0)
            self.badge.visible = False
        self.focus.color = rgba(COLORS['text'], 1.0 if self._focused else 0.0)
        self.title_label.relayout()

    # ------------------------------------------------------------------ state
    @property
    def selected(self):
        return self._selected

    def set_selected(self, selected):
        self._selected = bool(selected)
        self._sync()

    def set_focus(self, focused):
        self._focused = bool(focused)
        self._sync()

    def contains(self, x, y):
        return widget_active(self) and pointer_in(
            (self.position[0], self.position[1]), self.hit_size, x, y)

    def update_widget(self, x, y, dt):
        if not self.enabled:
            return
        self._hovered = self.contains(x, y)
        duration = max(1e-3, SIZES['transition'])
        step = dt / duration
        target = 1.0 if self._hovered else 0.0
        if target > self._hover_t:
            self._hover_t = min(1.0, self._hover_t + step)
        else:
            self._hover_t = max(0.0, self._hover_t - step)
        self._hover = 1.0 - (1.0 - self._hover_t) ** 2
        shift_target = SIZES['row_shift'] if self._selected else 0.0
        self._shift += (shift_target - self._shift) * min(1.0, dt / 0.055)
        self.position = (self.base_position[0] + px(self._shift),
                         self.base_position[1], self.z)
        self._sync()

    def click(self, x, y):
        if not self.contains(x, y):
            return False
        if callable(self.on_click):
            self.on_click(self)
        return True


def screen_header(parent, title, subtitle='', y=0.435, accent=None,
                  logo=None):
    """Compatibility shim: the shared screen title, in the one house style.

    Returns ``(title_entity, subtitle_entity)``. New screens use
    :func:`screen_title` (the fixed 40px double-glow heading); this keeps the
    older callers working without giving them their own colour or position.
    """
    title_entity = ScreenTitle(parent, title)
    subtitle_entity = None
    if subtitle:
        subtitle_entity = Text(parent=parent, text=subtitle,
                               origin=(0, 0.5),
                               position=(0, y - 0.062, CONTENT_Z - 0.01),
                               scale=TYPE['small'],
                               color=rgba(PALETTE['grey'], 1.0))
    return title_entity, subtitle_entity


def arrow_row(parent, y, count=7, spacing=0.05, size=0.03, rgb_tuple=None,
              alpha=0.5):
    """A row of the lane's triangular arrows, used as a decoration."""
    rgb_tuple = rgb_tuple or PALETTE['cyan']
    arrows = []
    for index in range(-(count // 2), count // 2 + 1):
        arrows.append(Entity(parent=parent, model=ui_triangle(size, size * 1.8),
                             position=(index * spacing, y, 0.01),
                             color=rgba(rgb_tuple, alpha),
                             shader=unlit_shader))
    return arrows


# ===========================================================================
# HELLS BALLS widgets
#
# The menu and the mode picker are built from the widgets below. All of them
# read their colours and sizes from COLORS / SIZES above, all of them lay out in
# reference pixels, and all of them share the same states:
#
# * hover   - brighten 10%, scale 1.03
# * pressed - scale 0.97
# * focus   - 2px white outline (3px offset) / a dashed outline for cards
# * disabled- 40% opacity
#
# They keep :class:`MenuButton`'s public shape (``position``, ``size``,
# ``click``, ``update_widget``, ``set_selected``, ``set_enabled``) so the
# screens, the keyboard selection and the hand cursor keep working unchanged.
# ===========================================================================
class TextSprite(Entity):
    """A label painted at an exact pixel size, centred by construction.

    The texture is the label's *ink*, so the quad's centre is the optical
    centre: no baseline guessing, no clipped descenders, and the size is the
    size the design asked for. ``anchor`` decides which point of the label the
    entity's position addresses (``'center'`` by default).
    """

    ANCHORS = {
        'center': (0.5, 0.5), 'left': (0.0, 0.5), 'right': (1.0, 0.5),
        'top': (0.5, 1.0), 'bottom': (0.5, 0.0),
        'topleft': (0.0, 1.0), 'lefttop': (0.0, 1.0),
        'topright': (1.0, 1.0), 'bottomleft': (0.0, 0.0),
        'bottomright': (1.0, 0.0),
    }

    def __init__(self, parent, text, position=(0.0, 0.0), size_px=16,
                 rgb_tuple=None, bold=False, tracking=0.0, line_spacing=0.0,
                 alpha=1.0, max_width_px=None, max_lines=0, anchor='center',
                 z=0.0, glow_rgb=None, glow_px=0.0, glow_alpha=0.55,
                 fit_width=False, min_size_px=13.0):
        super().__init__(parent=parent, position=(position[0], position[1], z))
        self.size_px = float(size_px)
        self.rgb_tuple = tuple(rgb_tuple or COLORS['text'])
        self.bold = bool(bold)
        self.tracking = float(tracking)
        self.line_spacing = float(line_spacing)
        self.alpha = float(alpha)
        self.max_width_px = max_width_px
        self.max_lines = int(max_lines)
        self.anchor = anchor
        self.glow_rgb = tuple(glow_rgb) if glow_rgb else None
        self.glow_px = float(glow_px)
        self.glow_alpha = float(glow_alpha)
        self.fit_width = bool(fit_width)
        self.min_size_px = float(min_size_px)
        self.rendered_px = float(size_px)
        self.width_px = 0.0
        self.height_px = 0.0
        self.quad = Entity(parent=self, model='quad', z=0.0,
                           color=rgba(COLORS['text'], self.alpha),
                           shader=unlit_shader)
        self.set_text(text)

    def set_text(self, text, rgb_tuple=None, alpha=None):
        if rgb_tuple is not None:
            self.rgb_tuple = tuple(rgb_tuple)
        if alpha is not None:
            self.alpha = float(alpha)
        self.text = str(text)
        size = self.size_px
        if self.fit_width and self.max_width_px:
            measured = text_width_px(self.text, size, self.bold, self.tracking)
            if measured > self.max_width_px > 0:
                size = max(self.min_size_px,
                           size * self.max_width_px / measured)
        self.rendered_px = size
        texture, width_px, height_px = text_texture(
            self.text, px=size, rgb=self.rgb_tuple, bold=self.bold,
            tracking=self.tracking, line_spacing=self.line_spacing,
            max_width_px=None if self.fit_width else self.max_width_px,
            max_lines=self.max_lines, glow_rgb=self.glow_rgb,
            glow_px=self.glow_px, glow_alpha=self.glow_alpha)
        self.width_px, self.height_px = float(width_px), float(height_px)
        self.quad.texture = texture
        self.quad.color = rgba(COLORS['text'], self.alpha)
        self.relayout()
        return self

    def set_color(self, rgb_tuple, alpha=None):
        self.rgb_tuple = tuple(rgb_tuple)
        if alpha is not None:
            self.alpha = float(alpha)
        self.set_text(self.text)
        return self

    def relayout(self):
        """Re-apply the quad's size and anchor (after a window change)."""
        width, height = px(self.width_px), px(self.height_px)
        self.quad.scale = (width, height)
        ax, ay = self.ANCHORS.get(self.anchor, (0.5, 0.5))
        self.quad.position = ((0.5 - ax) * width, (0.5 - ay) * height, 0.0)
        return self


def plate_entity(parent, width_px, height_px, texture, rgb_tuple, alpha=1.0,
                 position=(0.0, 0.0), z=0.0):
    """One tintable rounded plate/ring at a reference-pixel size."""
    entity = Entity(parent=parent, model='quad',
                    position=(position[0], position[1], z),
                    texture=texture,
                    color=rgba(rgb_tuple, alpha), shader=unlit_shader)
    entity.scale = (px(width_px), px(height_px))
    return entity


def place(entity, x_px, y_px):
    """Move an entity to a reference-pixel point, keeping its draw order."""
    x, y = screen_pos(x_px, y_px)
    entity.position = (x, y, entity.z)
    return entity


class Keycap(Entity):
    """The small key cap: ENTER, the arrow keys, A and D.

    ``#FFFFFF`` at 20% fill, a 1px white border at 50%, 6px corners and 13px
    text - the same cap in every position it appears. Pass ``icon`` instead of
    text for the arrow caps.
    """

    def __init__(self, parent, text='', position=(0.0, 0.0), height_px=None,
                 font_px=None, radius_px=None, anchor='center', z=0.0,
                 icon=None):
        super().__init__(parent=parent, position=(position[0], position[1], z))
        self.anchor = anchor
        self.height_px = float(height_px or SIZES['keycap_h'])
        self.font_px = float(font_px or SIZES['keycap_font'])
        self.radius_px = float(radius_px or SIZES['keycap_radius'])
        self.pad_px = float(SIZES['keycap_pad'])
        self.icon_name = icon
        self.ax, self.ay = TextSprite.ANCHORS.get(anchor, (0.5, 0.5))
        self.fill = Entity(parent=self, model='quad', z=0.01,
                           color=rgba(COLORS['text'], ALPHA['keycap_fill']),
                           shader=unlit_shader)
        self.edge = Entity(parent=self, model='quad', z=0.0,
                           color=rgba(COLORS['text'], ALPHA['keycap_edge']),
                           shader=unlit_shader)
        self.glyph = None
        self.label = None
        if icon:
            self.glyph = Entity(parent=self, model='quad', z=-0.01,
                                texture=icon_texture(icon, size=96),
                                color=rgba(COLORS['text'], 1.0),
                                shader=unlit_shader)
            self.width_px = self.height_px
            self.text = ''
        else:
            self.label = TextSprite(self, str(text), size_px=self.font_px,
                                    rgb_tuple=COLORS['text'], bold=True,
                                    z=-0.01)
            self.width_px = self.height_px
            self.set_text(text)

    def set_text(self, text):
        self.text = str(text)
        if self.label is not None:
            self.label.set_text(self.text)
            self.width_px = max(float(SIZES['keycap_min_w']),
                                self.label.width_px + 2.0 * self.pad_px)
        self.relayout()
        return self

    def relayout(self):
        width, height = self.width_px, self.height_px
        self.fill.texture = rounded_mask_texture(width, height, self.radius_px)
        self.fill.scale = (px(width), px(height))
        self.edge.texture = rounded_mask_texture(width, height, self.radius_px,
                                                 SIZES['keycap_edge'])
        self.edge.scale = (px(width), px(height))
        offset_x = (0.5 - self.ax) * px(width)
        offset_y = (0.5 - self.ay) * px(height)
        self.fill.position = (offset_x, offset_y, 0.01)
        self.edge.position = (offset_x, offset_y, 0.0)
        if self.label is not None:
            self.label.position = (offset_x, offset_y, -0.01)
            self.label.relayout()
        if self.glyph is not None:
            size = height * 0.52
            self.glyph.scale = (px(size), px(size))
            self.glyph.position = (offset_x, offset_y, -0.01)
        return self


class ArcadeButton(Entity):
    """The one button of the new UI: primary, secondary or ghost.

    * ``primary``   - the pink gradient PLAY/START plate with a soft glow and
      an optional key cap.
    * ``secondary`` - card background, 2px cyan border, white label.
    * ``ghost``     - transparent, a 2px border in the accent colour.
    """

    def __init__(self, parent, text, position=(0.0, 0.0), size_px=None,
                 variant='secondary', accent=None, on_click=None, index=0,
                 font_px=None, tracking=None, key_hint=None, label=None,
                 radius_px=None, z=BUTTON_Z, glow=None):
        super().__init__(parent=parent, position=(position[0], position[1], z))
        self.label = str(text)
        self.variant = variant
        self.accent = tuple(accent or COLORS['cyan'])
        self.on_click = on_click
        self.index = index
        self.key_hint = str(key_hint) if key_hint else None
        self._hover = 0.0
        self._hover_t = 0.0
        self._hovered = False
        self._focused = False
        self._pressed = False
        self.pulse = 0.0
        self.disabled = False
        self.size_px = tuple(size_px or (SIZES['secondary_w'],
                                         SIZES['secondary_h']))
        if font_px is None:
            font_px = (SIZES['primary_font'] if variant == 'primary'
                       else SIZES['secondary_font'])
        self.font_px = float(font_px)
        self.tracking = (SIZES['label_tracking'] if tracking is None
                         else float(tracking))
        if radius_px is None:
            radius_px = (SIZES['primary_radius'] if variant == 'primary'
                         else SIZES['secondary_radius'])
        self.radius_px = float(radius_px)
        self._glow_px = float(SIZES['primary_glow'] if glow is None
                              else glow)
        self.size = (px(self.size_px[0]), px(self.size_px[1]))
        self._build()
        self.relayout()

    # ---------------------------------------------------------------- visuals
    def _build(self):
        width, height = self.size_px
        self.plate = Entity(parent=self, position=(0, 0, 0))
        self.glow = None
        if self.variant == 'primary':
            self.glow = Entity(parent=self.plate, model='quad', z=0.03,
                               texture=glow_texture(self.accent, size=128,
                                                    power=2.0),
                               color=rgba(self.accent, 0.0),
                               shader=unlit_shader)
        self.fill = Entity(parent=self.plate, model='quad', z=0.02,
                           shader=unlit_shader)
        self.overlay = Entity(parent=self.plate, model='quad', z=0.015,
                              color=rgba(COLORS['text'], 0.0),
                              shader=unlit_shader)
        self.edge = Entity(parent=self.plate, model='quad', z=0.01,
                           shader=unlit_shader)
        self.focus = plate_entity(
            self.plate, width + 2 * SIZES['card_focus_offset'],
            height + 2 * SIZES['card_focus_offset'],
            rounded_mask_texture(width + 2 * SIZES['card_focus_offset'],
                                 height + 2 * SIZES['card_focus_offset'],
                                 self.radius_px + SIZES['card_focus_offset'],
                                 SIZES['keycap_edge'] * 2),
            COLORS['text'], 0.0, z=0.005)
        self.label_sprite = TextSprite(
            self.plate, self.label, size_px=self.font_px,
            rgb_tuple=(COLORS['text'] if self.variant == 'primary'
                       else self.accent if self.variant == 'ghost'
                       else COLORS['text']),
            bold=True, tracking=self.tracking, z=-0.01)
        self.keycap = None
        if self.key_hint:
            self.keycap = Keycap(self.plate, self.key_hint,
                                 height_px=SIZES['keycap_h'],
                                 font_px=SIZES['keycap_font'], z=-0.01)

    def _fill_texture(self):
        width, height = self.size_px
        if self.variant == 'primary':
            return rounded_texture(width, height, self.radius_px,
                                   rgb=self.accent,
                                   bottom_rgb=COLORS['pink_deep'])
        if self.variant == 'secondary':
            return rounded_mask_texture(width, height, self.radius_px)
        return None

    def relayout(self):
        scale = ui_scale()
        width_px = self.size_px[0] * scale
        height_px = self.size_px[1] * scale
        self.size = (width_px / REFERENCE_HEIGHT, height_px / REFERENCE_HEIGHT)
        # Hit testing uses the *design* size: scaling the picture must never
        # move the click target out from under the pointer.
        self.hit_size = (px(self.size_px[0]), px(self.size_px[1]))
        width, height = self.size_px
        fill_texture = self._fill_texture()
        if fill_texture is not None:
            self.fill.texture = fill_texture
            self.fill.scale = (px(width), px(height))
            self.fill.color = (rgba(COLORS['card'], 1.0)
                               if self.variant == 'secondary' else color.white)
        self.overlay.texture = rounded_mask_texture(width, height,
                                                    self.radius_px)
        self.overlay.scale = (px(width), px(height))
        border = (0 if self.variant == 'primary'
                  else SIZES['secondary_border'])
        self.edge.texture = (rounded_mask_texture(width, height,
                                                  self.radius_px, border)
                             if border else None)
        self.edge.scale = (px(width), px(height))
        self.edge.visible = bool(border)
        if self.glow is not None:
            glow_w = width + 2.0 * self._glow_px
            glow_h = height + 2.0 * self._glow_px
            self.glow.scale = (px(glow_w), px(glow_h))
        self.label_sprite.size_px = self.font_px
        # The label keeps its exact size (never shrunk, never wrapped): the
        # plate is sized for it, not the other way round.
        self.label_sprite.max_width_px = None
        self.label_sprite.max_lines = 0
        self.label_sprite.set_text(self.label)
        if self.keycap is not None:
            self.keycap.relayout()
            self.keycap.position = (px(width) / 2.0
                                    - px(SIZES['keycap_inset'])
                                    - px(self.keycap.width_px) / 2.0, 0.0, 0.0)
        self._sync()
        return self

    def _sync(self):
        """Push the animated state into the plate's colours."""
        hover = self._hover
        bright = SIZES['hover_brighten'] * hover
        opacity = ALPHA['disabled'] if self.disabled else 1.0
        if self.variant == 'primary':
            self.fill.color = rgba(COLORS['text'], opacity)
            self.overlay.color = rgba(COLORS['text'], bright * opacity)
        elif self.variant == 'secondary':
            self.fill.color = rgba(brighten(COLORS['card'], bright), opacity)
            self.overlay.color = rgba(COLORS['text'], 0.06 * hover * opacity)
        else:
            self.fill.color = rgba(COLORS['text'], 0.0)
            self.overlay.color = rgba(COLORS['text'], 0.08 * hover * opacity)
        edge_rgb = brighten(self.accent, bright)
        edge_alpha = {'primary': 0.0,
                      'secondary': 1.0,
                      'ghost': 1.0}[self.variant]
        if self.variant == 'ghost' and self.accent == COLORS['text_dim']:
            edge_rgb = (255, 255, 255)
            edge_alpha *= 0.40
        self.edge.color = rgba(edge_rgb, edge_alpha * opacity)
        if self.glow is not None:
            halo = (ALPHA['glow'] * (0.85 + 0.15 * hover) + 0.14 * self.pulse)
            self.glow.color = rgba(self.accent, min(0.75, halo) * opacity)
        self.focus.color = rgba(COLORS['text'], (1.0 if self._focused else 0.0)
                                * opacity)
        self.plate.scale = (self._plate_scale(),) * 3

    def _plate_scale(self):
        if not self.enabled or self.disabled:
            return 1.0
        if self._pressed:
            return SIZES['press_scale']
        if self._hovered:
            return 1.0 + (SIZES['hover_scale'] - 1.0) * self._hover
        return 1.0

    # ------------------------------------------------------------------ state
    def contains(self, x, y):
        return (widget_active(self) and not self.disabled
                and pointer_in((self.position[0], self.position[1]),
                               self.hit_size, x, y))

    def update_widget(self, x, y, dt):
        if not self.enabled:
            return
        self._hovered = self.contains(x, y)
        target = 1.0 if self._hovered else 0.0
        duration = max(1e-3, SIZES['transition'])
        step = dt / duration
        # Linear ramp, then ease-out for the picture: 140ms, ease-out.
        if target > self._hover_t:
            self._hover_t = min(1.0, self._hover_t + step)
        else:
            self._hover_t = max(0.0, self._hover_t - step)
        self._hover = 1.0 - (1.0 - self._hover_t) ** 2
        self._pressed = False
        if self._hovered:
            try:
                from ursina import mouse
                self._pressed = bool(mouse.left)
            except Exception:                          # pragma: no cover
                self._pressed = False
        self._sync()

    def set_selected(self, selected):
        """Keyboard focus: a 2px white outline, 3px outside the plate."""
        self._focused = bool(selected)
        self._sync()

    def set_pulse(self, amount):
        self.pulse = max(0.0, float(amount))
        self._sync()

    def set_label(self, text):
        self.label = str(text)
        self.label_sprite.set_text(self.label)

    def set_enabled(self, enabled):
        self.enabled = bool(enabled)
        self._sync()

    def resize(self, size_px):
        self.size_px = (float(size_px[0]), float(size_px[1]))
        return self.relayout()

    def click(self, x, y):
        if not self.contains(x, y):
            return False
        if callable(self.on_click):
            self.on_click(self)
        return True


class SegmentedControl(Entity):
    """A segmented control: MOUSE / WEBCAM.

    The active option is a cyan pill with dark text; the inactive ones are
    transparent with white text. Clicking an option selects it and reports the
    new value through ``on_change``.
    """

    def __init__(self, parent, options, position=(0.0, 0.0), value=None,
                 on_change=None, height_px=None, font_px=None, z=BUTTON_Z):
        super().__init__(parent=parent, position=(position[0], position[1], z))
        self.options = [(option, option) if isinstance(option, str) else option
                        for option in options]
        self.on_change = on_change
        self.height_px = float(height_px or SIZES['segment_h'])
        self.font_px = float(font_px or SIZES['segment_font'])
        self.index = 0
        self.size = (0.0, px(self.height_px))
        self._hover_index = -1
        self._tiles = []
        self.body = Entity(parent=self, model='quad', z=0.03,
                           shader=unlit_shader)
        self.edge = Entity(parent=self, model='quad', z=0.02,
                           shader=unlit_shader)
        for label in [option[1] for option in self.options]:
            tile = Entity(parent=self, model='quad', z=0.01,
                          shader=unlit_shader)
            text = TextSprite(self, label, size_px=self.font_px,
                              rgb_tuple=COLORS['text'], bold=True,
                              tracking=SIZES['label_tracking'], z=-0.01)
            self._tiles.append({'plate': tile, 'label': text,
                                'text': str(label)})
        self.set_value(value if value is not None else self.options[0][0])
        self.relayout()

    # ---------------------------------------------------------------- helpers
    def set_value(self, value, notify=False):
        for index, (key, _label) in enumerate(self.options):
            if str(key).lower() == str(value).lower():
                self.index = index
                break
        self._sync()
        if notify and callable(self.on_change):
            self.on_change(self.value)
        return self

    @property
    def value(self):
        return self.options[self.index][0]

    def set_index(self, index, notify=False):
        self.index = int(index) % len(self.options)
        self._sync()
        if notify and callable(self.on_change):
            self.on_change(self.value)
        return self

    def relayout(self):
        inset = SIZES['segment_inset']
        pad = SIZES['segment_pad']
        widths = [tile['label'].width_px + 2.0 * pad for tile in self._tiles]
        total = sum(widths) + 2.0 * inset * len(widths)
        self.size_px = (total, self.height_px)
        self.size = (px(total), px(self.height_px))
        self.body.texture = rounded_mask_texture(total, self.height_px,
                                                 SIZES['segment_radius'])
        self.body.scale = (px(total), px(self.height_px))
        self.body.color = rgba(COLORS['card'], 1.0)
        self.edge.texture = rounded_mask_texture(total, self.height_px,
                                                 SIZES['segment_radius'],
                                                 SIZES['card_border'])
        self.edge.scale = (px(total), px(self.height_px))
        self.edge.color = rgba(COLORS['hairline'], 1.0)
        x = -total / 2.0 + inset
        for tile, width in zip(self._tiles, widths):
            tile['width'] = width
            tile['x'] = x + width / 2.0
            tile['plate'].texture = rounded_mask_texture(
                width, self.height_px - 2 * inset,
                max(2.0, SIZES['segment_radius'] - inset))
            tile['plate'].scale = (px(width),
                                   px(self.height_px - 2 * inset))
            tile['plate'].position = (px(tile['x']), 0.0, 0.01)
            tile['label'].position = (px(tile['x']), 0.0, -0.01)
            tile['label'].relayout()
            x += width + 2 * inset
        self._sync()
        return self

    def _sync(self):
        for index, tile in enumerate(self._tiles):
            active = index == self.index
            hovered = index == self._hover_index
            if active:
                tile['plate'].color = rgba(COLORS['cyan'], 1.0)
                tile['label'].set_color(COLORS['ink'])
            else:
                tile['plate'].color = rgba(COLORS['text'],
                                           0.10 if hovered else 0.0)
                tile['label'].set_color(COLORS['text'])

    # ------------------------------------------------------------------ state
    def contains(self, x, y):
        return widget_active(self) and pointer_in(
            (self.position[0], self.position[1]), self.size, x, y)

    def _option_at(self, x, y):
        if not self.contains(x, y):
            return -1
        inset = px(SIZES['segment_inset'])
        left = self.position[0] - self.size[0] / 2.0
        start = left + inset
        for index, tile in enumerate(self._tiles):
            end = start + px(tile['width'])
            if start - inset <= x <= end + inset:
                return index
            start = end + 2 * inset
        return -1

    def update_widget(self, x, y, dt):
        if not self.enabled:
            return
        hovered = self._option_at(x, y)
        if hovered != self._hover_index:
            self._hover_index = hovered
            self._sync()

    def click(self, x, y):
        index = self._option_at(x, y)
        if index < 0:
            return False
        self.set_index(index, notify=True)
        return True


def icon_tile(parent, name, size_px=None, tile_px=None, radius_px=None,
              accent=None, alpha=None, z=0.0, icon_scale=0.62):
    """A rounded tile in the accent colour with a vector icon on top."""
    accent = tuple(accent or COLORS['cyan'])
    tile_px = float(tile_px or SIZES['card_tile'])
    radius_px = float(radius_px if radius_px is not None
                      else SIZES['card_tile_radius'])
    alpha = float(alpha if alpha is not None else ALPHA['tile_fill'])
    root = Entity(parent=parent, position=(0.0, 0.0, z))
    root.tile = plate_entity(root, tile_px, tile_px,
                             rounded_mask_texture(tile_px, tile_px, radius_px),
                             accent, alpha)
    root.icon_px = float(size_px or tile_px * icon_scale)
    root.icon = Entity(parent=root, model='quad', z=-0.01,
                       texture=icon_texture(name, size=96),
                       color=rgba(accent, 1.0), shader=unlit_shader)
    root.icon.scale = (px(root.icon_px), px(root.icon_px))
    root.name = name
    return root


class Chip(Entity):
    """A rule pill: amber text on an amber 20% fill, 999px radius."""

    def __init__(self, parent, text='', position=(0.0, 0.0), font_px=None,
                 pad_x=None, pad_y=None, accent=None, z=0.0):
        super().__init__(parent=parent, position=(position[0], position[1], z))
        self.accent = tuple(accent or COLORS['amber'])
        self.font_px = float(font_px or SIZES['chip_font'])
        self.pad_x = float(pad_x if pad_x is not None else SIZES['chip_pad_x'])
        self.pad_y = float(pad_y if pad_y is not None else SIZES['chip_pad_y'])
        self.plate = Entity(parent=self, model='quad', z=0.01,
                            color=rgba(self.accent, ALPHA['chip_fill']),
                            shader=unlit_shader)
        self.label = TextSprite(self, str(text), size_px=self.font_px,
                                rgb_tuple=self.accent, bold=False, z=0.0)
        self.width_px = 0.0
        self.height_px = 0.0
        self.set_text(text)

    def set_text(self, text):
        self.text = str(text)
        self.label.set_text(self.text)
        self.width_px = self.label.width_px + 2.0 * self.pad_x
        self.height_px = self.label.height_px + 2.0 * self.pad_y
        self.relayout()
        return self

    def relayout(self):
        if self.width_px <= 0.0:
            return self
        radius = self.height_px / 2.0
        self.plate.texture = rounded_mask_texture(self.width_px,
                                                  self.height_px, radius)
        self.plate.scale = (px(self.width_px), px(self.height_px))
        self.label.relayout()
        return self


class ChipFlow(Entity):
    """Lay out chips left to right, wrapping onto new lines."""

    def __init__(self, parent, max_width_px, count=5, font_px=None, z=0.0,
                 align='left'):
        super().__init__(parent=parent, z=z)
        self.max_width_px = float(max_width_px)
        self.align = align
        self.chips = [Chip(self, '', font_px=font_px) for _ in range(count)]
        self.set_texts([])

    def set_texts(self, texts):
        texts = list(texts)
        for index, chip in enumerate(self.chips):
            if index < len(texts):
                chip.visible = True
                chip.set_text(texts[index])
            else:
                chip.visible = False
        self.relayout()
        return self

    def relayout(self):
        gap = SIZES['chip_gap']
        row_gap = SIZES['chip_row_gap']
        rows = []
        row = []
        used = 0.0
        for chip in self.chips:
            if not chip.visible:
                continue
            width = chip.width_px
            if row and used + gap + width > self.max_width_px:
                rows.append(row)
                row = []
                used = 0.0
            row.append(chip)
            used += width + gap
        if row:
            rows.append(row)
        y = 0.0
        for row in rows:
            total = sum(chip.width_px for chip in row) + gap * (len(row) - 1)
            x = -total / 2.0 if self.align == 'center' else 0.0
            for chip in row:
                chip.position = (px(x + chip.width_px / 2.0),
                                 -px(y + chip.height_px / 2.0), 0.0)
                chip.relayout()
                x += chip.width_px + gap
            y += max(chip.height_px for chip in row) + row_gap
        self.height_px = max(0.0, y - row_gap) if rows else 0.0
        return self


class Panel(Entity):
    """A rounded panel: #14102E at 92% with a 1px cyan->pink gradient border.

    ``center_px`` is the panel's centre in reference pixels, so a panel can be
    sized to its content and re-centred without the rest of the screen moving.
    """

    def __init__(self, parent, width_px, height_px, center_px=(0.0, 0.0),
                 radius_px=None, pad_px=None, accent=None,
                 alpha=None, z=PANEL_Z):
        super().__init__(parent=parent, position=(0.0, 0.0, z))
        self.width_px = float(width_px)
        self.height_px = float(height_px)
        self.radius_px = float(radius_px or SIZES['panel_radius'])
        self.pad_px = float(pad_px if pad_px is not None else SIZES['panel_pad'])
        self.accent = tuple(accent or COLORS['cyan'])
        self.alpha = float(alpha if alpha is not None else ALPHA['panel_solid'])
        self.body = Entity(parent=self, model='quad', z=0.0,
                           shader=unlit_shader)
        self.set_center(center_px)
        self.relayout()

    def set_center(self, center_px):
        self.center_px = (float(center_px[0]), float(center_px[1]))
        position = screen_pos(*self.center_px)
        self.position = (position[0], position[1], self.z)
        return self

    def set_size(self, height_px, width_px=None):
        if width_px is not None:
            self.width_px = float(width_px)
        self.height_px = float(height_px)
        self.set_center(self.center_px)
        return self.relayout()

    def relayout(self):
        radius = min(self.radius_px,
                     min(self.width_px, self.height_px) / 2.0)
        self.body.texture = panel_texture(
            self.width_px, self.height_px, radius,
            fill_rgb=COLORS['panel'], fill_alpha=self.alpha,
            border_left_rgb=COLORS['cyan'], border_right_rgb=COLORS['pink'],
            border_alpha=0.60)
        self.body.scale = (px(self.width_px), px(self.height_px))
        return self

    def rect(self):
        """``(left, top, width, height)`` in reference pixels."""
        return (self.center_px[0] - self.width_px / 2.0,
                self.center_px[1] - self.height_px / 2.0,
                self.width_px, self.height_px)

    def content(self):
        """``(left, top)`` of the padded content area, in reference pixels."""
        left, top, _w, _h = self.rect()
        return (left + self.pad_px, top + self.pad_px)


class HintBar(Entity):
    """The bottom hint bar: key caps and one line of 15px secondary text.

    ``items`` is a sequence of ``('key', 'ENTER')``, ``('icon', 'arrow_left')``
    and ``('text', 'move your feet')``; the row is centred and every key is
    drawn with the same :class:`Keycap` as ENTER on the PLAY plate.
    """

    def __init__(self, parent, items, bottom_px=None, z=CONTENT_Z):
        super().__init__(parent=parent, z=z)
        self.bottom_px = float(bottom_px if bottom_px is not None
                               else SIZES['hint_bottom'])
        self.entries = []
        for item in items:
            kind, value = (item if isinstance(item, tuple) else (item, None))
            if kind == 'break':
                self.entries.append(('break', None))
                continue
            if kind == 'key':
                entity = Keycap(self, value)
            elif kind == 'icon':
                entity = Keycap(self, icon=value)
            else:
                entity = TextSprite(self, value, size_px=SIZES['hint_font'],
                                    rgb_tuple=COLORS['text_dim'])
            self.entries.append((kind, entity))
        self.relayout()

    def _width(self, entity):
        if entity is None:
            return 0.0
        return getattr(entity, 'width_px', entity.width_px)

    def relayout(self):
        gap = float(SIZES['hint_gap'])
        group = float(SIZES['hint_group'])
        widths = [self._width(entity) for _kind, entity in self.entries]
        separations = []
        for index in range(1, len(self.entries)):
            previous = self.entries[index - 1][0]
            current = self.entries[index][0]
            if 'break' in (previous, current):
                # Half a group on each side of the marker = one 24px gap
                # between the two hint groups.
                separations.append(group / 2.0)
            else:
                separations.append(gap)
        total = sum(widths) + sum(separations)
        x = -total / 2.0
        y = -0.5 + px(self.bottom_px + SIZES['keycap_h'] / 2.0)
        self.position = (0.0, y, self.z)
        for index, (_kind, entity) in enumerate(self.entries):
            if index:
                x += separations[index - 1]
            if entity is not None:
                entity.position = (px(x + widths[index] / 2.0), 0.0, 0.0)
                entity.relayout()
            x += widths[index]
        self.width_px = total
        return self


class SetupEntry(TextEntry):
    """A text field with the row skin: 44px tall, 12px radius, hairline edge."""

    RADIUS = 12
    FONT = 16

    def __init__(self, parent, position=(0.0, 0.0), size_px=(172.0, 44.0),
                 placeholder='', on_submit=None, accent=None):
        self.size_px = (float(size_px[0]), float(size_px[1]))
        super().__init__(parent, position=position,
                         scale=(px(self.size_px[0]), px(self.size_px[1])),
                         placeholder=placeholder,
                         rgb_tuple=accent or COLORS['cyan'],
                         on_submit=on_submit)
        self.ring = Entity(parent=self, model='quad', z=0.025,
                           shader=unlit_shader)
        self._skin()

    def _skin(self):
        width_px, height_px = self.size_px
        radius = self.RADIUS
        width, height = self.size
        self.body.texture = rounded_mask_texture(width_px, height_px, radius)
        self.body.color = rgba(COLORS['card'], 1.0)
        self.body.scale = (px(width_px), px(height_px))
        self.ring.texture = rounded_mask_texture(width_px, height_px, radius,
                                                 1)
        self.ring.scale = (px(width_px), px(height_px))
        self.caret.scale = (px(2), height * 0.52)
        self.label.scale = font_px(self.FONT)
        self.hint.scale = font_px(self.FONT)
        self.label.position = (-width / 2 + px(16), 0.0)
        self.hint.position = (-width / 2 + px(16), 0.0)
        self.hint.color = rgba(COLORS['text_dim'], 0.85)
        self.focus(False)

    def focus(self, focused=True):
        super().focus(focused)
        self.body.color = rgba(COLORS['card'], 1.0)
        self.ring.color = rgba(COLORS['cyan'] if self.focused
                               else COLORS['hairline'], 1.0)
        self.caret.color = rgba(COLORS['cyan'], 0.9)

    def update_widget(self, x, y, dt):
        super().update_widget(x, y, dt)
        self.caret.color = rgba(COLORS['cyan'], 0.9)

    def set_size_px(self, size_px):
        """Resize from reference pixels (used by the picker's layout)."""
        self.size_px = (float(size_px[0]), float(size_px[1]))
        scale = ui_scale()
        self.size = (self.size_px[0] * scale / REFERENCE_HEIGHT,
                     self.size_px[1] * scale / REFERENCE_HEIGHT)
        self._skin()
        return self

    def resize(self, size):
        self.size = (float(size[0]), float(size[1]))
        self.size_px = (self.size[0] * REFERENCE_HEIGHT / max(ui_scale(), 1e-6),
                        self.size[1] * REFERENCE_HEIGHT / max(ui_scale(), 1e-6))
        self._skin()
        return self


class EmptySetup(Entity):
    """The 'no extra setup' state: a 24px gear inline with one 16px line.

    Left-aligned, gear first, text next to it - so an empty setup panel reads
    as a statement rather than as centred placeholder furniture.
    """

    def __init__(self, parent, z=CONTENT_Z):
        super().__init__(parent=parent, z=z)
        size = SIZES['setup_gear']
        self.icon = Entity(parent=self, model='quad', z=0.0,
                           texture=icon_texture('gear', size=96),
                           color=rgba(COLORS['text_dim'], 0.9),
                           shader=unlit_shader)
        self.icon.scale = (px(size), px(size))
        self.label = TextSprite(self, 'No extra setup. Press START to bowl.',
                                size_px=SIZES['setup_font'],
                                rgb_tuple=COLORS['text_dim'], anchor='left',
                                z=0.0)
        self.visible = False
        self.place(640.0, 480.0)

    def place(self, left_px, center_y_px):
        """Place the block: ``left_px`` is the gear's left edge."""
        size = SIZES['setup_gear']
        gap = SIZES['setup_gear_gap']
        self.icon.position = (
            screen_pos(left_px + size / 2.0, center_y_px)[0],
            screen_pos(left_px + size / 2.0, center_y_px)[1], 0.0)
        self.label.position = (screen_pos(left_px + size + gap, center_y_px)[0],
                               screen_pos(left_px + size + gap,
                                          center_y_px)[1], 0.0)
        return self
