"""The Physics Lab: one throw, studied on the real lane.

The lab runs the *actual* simulation the game runs - the shared
:class:`physics.Deck` behind the on-screen :class:`scene.pins.PinRack` - and
lets the player study it:

* the ball stays still until **BOWL** is clicked. Nothing is launched, rolled
  or replayed on its own when the lab opens, and nothing restarts by itself
  when a run ends;
* **PAUSE/RESUME** freezes and continues the run at any time, and **RESET**
  returns the rack, the ball and the timeline to their initial state;
* a timeline at the bottom-centre of the screen records one complete
  simulation state per physics sub-step, so dragging the scrubber backwards or
  forwards restores the exact state the simulation had at that moment - not
  an animation interpolating between samples. While paused, the readout shows
  the physics of the selected moment; resuming from a selected state drops
  the old future and continues the simulation from there.

Next to the lane is a live readout: the variables of the motion (time, speed,
acceleration, sideways speed, spin, momentum, kinetic energy, pin count) plus
a compact BALL STATE block with the position, velocity, angular velocity,
angular momentum, torque and moment of inertia. Every readout row is a
dropdown: click it and the panel shows the equation behind the number - first
symbolically, then with the simulation's *current* values substituted - so the
readout says why a value is what it is, not just what it is.

The launch steppers step in both directions and have no upper limit: the lab
may explore past the match ranges (the ball simply ends up in the gutter, or
the throw leaves at whatever speed was dialled in). A throw's speed only has a
floor at zero, because the simulation clamps it there and the readout would
otherwise show a number the physics is not using. Clicking the number itself
lets the player type an exact value (Enter applies it, Escape cancels), so an
11.37 m/s release no longer has to be reached arrow-step by arrow-step.

Everything shown comes from the simulation: nothing here is a canned
animation. The throw is described by the same launch conditions a real
release produces (speed, start position, aim angle, hook spin), so changing a
stepper and watching the replay is watching the physics change.
"""
import math

from ursina import Entity, Text, window
from ursina.shaders import unlit_shader

import config
import physics
from input.mouse_input import ThrowData
from scene.camera import fov_push_in, fov_reset, update_camera
from scene.textures import rounded_mask_texture
from ui import theme
from ui.layout import wrap_text
from ui.screens import Screen

# The live readout: (key, label, unit). The values come from the deck.
READOUT = (
    ('t', 't', 's'),
    ('v', 'v', 'm/s'),
    ('a', 'a', 'm/s2'),
    ('vx', 'vx', 'm/s'),
    ('spin', 'spin', 'rad/s'),
    ('p', 'p', 'kg m/s'),
    ('k', 'K', 'J'),
    ('pins', 'pins', ''),
)
UNITS = {key: unit for key, _label, unit in READOUT}

# The editable launch rows: (key, caption). Every click moves the value one
# step in the direction of the arrow that was clicked; there is no upper
# limit, so the lab can push a throw past the match ranges.
ROWS = (('speed', 'SPEED'), ('lateral', 'START X'), ('angle', 'AIM'),
        ('spin', 'HOOK'))
STEPS = {'speed': 0.25, 'lateral': 0.05, 'angle': 0.2, 'spin': 0.5}
# The only floor: ``BallPhysics.launch`` clamps speed at zero, so allowing a
# negative number here would print a value the simulation never uses.
FLOORS = {'speed': 0.0}

# Live-row geometry, in UI units. Eight rows fit the panel; one row may open
# its equation block at a time (the screen enforces that), which keeps the
# last row inside the panel even with the first row expanded.
ROW_PITCH = 0.060       # centre-to-centre distance of two collapsed rows
ROW_HEIGHT = 0.048      # the row plate itself
DETAIL_HEIGHT = 0.076   # reserved height of an open equation block
EQUATION_CHARS = 36     # wrap width of an equation line, in characters
LINE_HEIGHT = 0.020     # one 13 px text line, in UI units

# Timeline bar geometry, in UI units.
TL_HEIGHT = 0.16        # the bar's height
TL_Y = -0.415           # the bar's centre (bottom-centre of the screen)
TRACK_HEIGHT = 0.008    # the scrub track


def format_value(value, signed=False):
    """Show up to three decimals without trailing zeros.

    A typed launch number has to stay readable: the old one-/two-decimal
    display would turn an entered ``-3.25`` into ``-3.2`` even though the
    simulation used the typed value.
    """
    text = f'{value:.3f}'.rstrip('0').rstrip('.')
    if text in ('-0', ''):
        text = '0'
    if signed and value >= 0:
        text = '+' + text
    return text


class ThrowSetup:
    """The editable launch parameters of the lab throw."""

    def __init__(self, speed=7.5, lateral=0.20, angle=-0.4, spin=-1.6):
        self.speed = speed
        self.lateral = lateral
        self.angle = angle
        self.spin = spin

    def as_kwargs(self):
        return dict(speed=self.speed, lateral_position=self.lateral,
                    launch_angle=math.radians(self.angle),
                    spin_omega=self.spin)


def equation_lines(key, ctx):
    """``(symbolic, substituted)`` for one live row.

    The substituted line is the equation with the simulation's current values
    filled in, so a value that moved also shows the calculation that moved it.
    Text is plain ASCII (the UI's bitmap font has no Greek or superscript
    glyphs), and every substituted line is written to fit the row in at most
    two wrapped lines.
    """
    if key == 't':
        return ('t = steps x dt',
                f'= {ctx["steps"]} x {ctx["dt_label"]} s = {ctx["t"]:.2f} s')
    if key == 'v':
        return ('v = sqrt(vx^2 + vz^2)',
                f'= sqrt({ctx["vx"]:.2f}^2 + {ctx["vz"]:.2f}^2) '
                f'= {ctx["v"]:.2f} m/s')
    if key == 'a':
        if ctx['regime'] == 'rest':
            return ('a = -mu g', '= 0.00 m/s2 (ball at rest)')
        return (f'a = -mu g   ({ctx["regime"]})',
                f'= -{ctx["friction"]:.2f} x {ctx["gravity"]:.2f} '
                f'= {ctx["a"]:.2f} m/s2')
    if key == 'vx':
        return ('vx = v sin(theta)',
                f'= {ctx["v"]:.2f} sin({ctx["heading"]:.1f} deg) '
                f'= {ctx["vx"]:.2f} m/s')
    if key == 'spin':
        return ('spin = |(wx, wy, wz)|',
                f'= |({ctx["wx"]:.1f}, {ctx["wy"]:.1f}, {ctx["wz"]:.1f})| '
                f'= {ctx["spin"]:.1f} rad/s')
    if key == 'p':
        return ('p = m v',
                f'= {ctx["mass"]:.2f} x {ctx["v"]:.3f} '
                f'= {ctx["p"]:.1f} kg m/s')
    if key == 'k':
        return ('K = 0.5 m v^2',
                f'= 0.5 x {ctx["mass"]:.2f} x {ctx["v"]:.3f}^2 '
                f'= {ctx["k"]:.1f} J')
    return (f'pins = {ctx["count"]} - standing',
            f'= {ctx["count"]} - {ctx["standing"]} = {int(ctx["pins"])}')


class LiveRow:
    """One live variable with an expandable equation underneath.

    Collapsed, the row is the label and the current value. Opened, two extra
    lines sit below it: the equation symbolically, then the same equation
    with the current numbers substituted. The screen keeps at most one row
    open, and the layout reserves the block's height, so nothing can overlap.
    """

    RADIUS = theme.SIZES['settings_row_radius']

    def __init__(self, parent, key, label, on_toggle):
        self.key = key
        self.label = label
        self.on_toggle = on_toggle
        self.open = False
        self.position = (0.0, 0.0)
        self.size = (0.38, ROW_HEIGHT)
        self.entity = Entity(parent=parent, position=(0, 0, theme.CONTENT_Z))
        self.body = Entity(parent=self.entity, model='quad', z=0.03,
                           shader=unlit_shader)
        self.ring = Entity(parent=self.entity, model='quad', z=0.025,
                           shader=unlit_shader)
        self.chevron = Entity(parent=self.entity,
                              model=theme.ui_triangle(theme.px(9),
                                                      theme.px(7)),
                              color=theme.rgba(theme.COLORS['cyan'], 0.85),
                              shader=unlit_shader)
        self.chevron.z = 0.02
        self.label_text = Text(parent=self.entity, text=label,
                               origin=(-0.5, 0.5), scale=theme.TYPE['small'],
                               color=theme.rgb('grey'))
        self.value_text = Text(parent=self.entity, text='0.00',
                               origin=(0.5, 0.5), scale=theme.TYPE['small'],
                               color=theme.rgb('white'))
        self.equation_text = Text(parent=self.entity, text='',
                                  origin=(-0.5, 0.5), scale=theme.TYPE['tiny'],
                                  color=theme.rgb('grey'))
        self.result_text = Text(parent=self.entity, text='',
                                origin=(-0.5, 0.5), scale=theme.TYPE['tiny'],
                                color=theme.rgb('white'))
        self.resize(*self.size)
        self.set_open(False)

    # ----------------------------------------------------------------- layout
    def resize(self, width, height):
        self.size = (float(width), float(height))
        width_px = self.size[0] * theme.REFERENCE_HEIGHT \
            / max(theme.ui_scale(), 1e-6)
        height_px = self.size[1] * theme.REFERENCE_HEIGHT \
            / max(theme.ui_scale(), 1e-6)
        for plate in (self.body, self.ring):
            plate.scale = self.size
        self.body.texture = rounded_mask_texture(width_px, height_px,
                                                 self.RADIUS)
        self.body.color = theme.rgba(theme.COLORS['card'], 1.0)
        self.ring.texture = rounded_mask_texture(width_px, height_px,
                                                 self.RADIUS, 1)
        self.ring.color = theme.rgba(theme.COLORS['hairline'], 1.0)
        self._place()
        return self

    def set_position(self, x, y):
        self.position = (float(x), float(y))
        self._place()
        return self

    def _place(self):
        x, y = self.position
        width, height = self.size
        self.entity.position = (x, y, theme.CONTENT_Z)
        left = -width / 2.0
        self.chevron.position = (left + theme.px(15), 0.0, 0.02)
        self.label_text.position = (left + theme.px(28), 0.0, -0.01)
        self.value_text.position = (width / 2.0 - theme.px(14), 0.0, -0.01)
        block_top = -height / 2.0 - theme.px(7)
        self.equation_text.position = (left + theme.px(14), block_top, -0.01)
        self.result_text.position = (left + theme.px(14),
                                     block_top - LINE_HEIGHT, -0.01)

    # ------------------------------------------------------------------ state
    def set_open(self, opened):
        self.open = bool(opened)
        self.equation_text.visible = self.open
        self.result_text.visible = self.open
        # A right-pointing triangle is "closed"; it turns down when open.
        self.chevron.rotation_z = 180.0 if self.open else 90.0
        return self

    def set_value(self, text):
        self.value_text.text = str(text)

    def set_equations(self, symbolic, substituted):
        """Fill the dropdown with the equation, wrapped to the row's width.

        The symbolic line is short by construction, and the layout reserves
        three 13 px lines for the block, so the wrap is capped to stay inside
        that reservation no matter what the numbers do.
        """
        symbolic_lines = wrap_text(symbolic, EQUATION_CHARS)[:1]
        result_lines = wrap_text(substituted, EQUATION_CHARS)[:2]
        self.equation_text.text = '\n'.join(symbolic_lines)
        self.result_text.text = '\n'.join(result_lines)

    # ------------------------------------------------------------------ input
    def contains(self, x, y):
        px_x, px_y = self.position
        width, height = self.size
        if theme.pointer_in((px_x, px_y), (width, height), x, y):
            return True
        if not self.open:
            return False
        return theme.pointer_in((px_x, px_y - height / 2.0
                                 - DETAIL_HEIGHT / 2.0),
                                (width, DETAIL_HEIGHT), x, y)

    def click(self, x, y):
        if not theme.widget_active(self.entity):
            return False
        if not self.contains(x, y):
            return False
        if callable(self.on_toggle):
            self.on_toggle(self)
        return True

    def update_widget(self, x, y, dt):
        hovered = theme.pointer_in(self.position, self.size, x, y)
        if hovered:
            self.body.color = theme.rgba(
                theme.brighten(theme.COLORS['card'], 0.04), 1.0)
            self.ring.color = theme.rgba(theme.COLORS['cyan'], 0.85)
        else:
            self.body.color = theme.rgba(theme.COLORS['card'], 1.0)
            self.ring.color = theme.rgba(theme.COLORS['hairline'], 1.0)
        self.chevron.color = theme.rgba(
            theme.COLORS['cyan'], 1.0 if (hovered or self.open) else 0.85)


class ScrubTrack:
    """The timeline's track as a clickable, draggable widget.

    ``click`` starts a drag and jumps the time; while the button is held,
    :meth:`update_widget` keeps scrubbing. This is the same click-and-drag
    pattern as the settings sliders, kept local so the bottom bar's geometry
    stays in one place.
    """

    def __init__(self, screen):
        self.screen = screen
        self.position = (0.0, 0.0)
        self.size = (0.0, 0.05)

    def contains(self, x, y):
        if not self.screen.timeline_available():
            return False
        return theme.pointer_in(self.position, self.size, x, y)

    def click(self, x, y):
        if not self.contains(x, y):
            return False
        self.screen.tl_dragging = True
        self.screen.scrub_pointer(x)
        return True

    def update_widget(self, x, y, dt):
        if not self.screen.tl_dragging:
            return
        from ursina import mouse
        if not getattr(mouse, 'left', False):
            self.screen.tl_dragging = False
        else:
            self.screen.scrub_pointer(x)


class LabScreen(Screen):
    """One throw through the real simulation, studied with a timeline."""

    name = 'lab'
    camera_view = 'game'      # the game camera follows the studied state

    def build(self):
        super().build()
        # The lane is the point of this screen, so it keeps its own light
        # panels over the scene (no full-screen dim) - only the title follows
        # the house style.
        self.heading = theme.screen_title(self.root, 'PHYSICS LAB')

        # --- throw controls (left) ---------------------------------------
        self.launch_panel = theme.panel(self.root, position=(-0.62, 0.0),
                                        scale=(0.40, 0.66), alpha=0.74,
                                        hairline=theme.PALETTE['cyan'])
        self.launch_title = Text(parent=self.root, text='THROW',
                                 origin=(-0.5, 0.5),
                                 position=(0, 0, theme.CONTENT_Z),
                                 scale=theme.TYPE['small'],
                                 color=theme.rgb('cyan'))
        self.launch_hint = Text(parent=self.root, text='CLICK A VALUE TO TYPE IT',
                                origin=(0.5, 0.5),
                                position=(0, 0, theme.CONTENT_Z),
                                scale=theme.TYPE['tiny'],
                                color=theme.rgb('dim'))
        self.setup = ThrowSetup()
        self.steppers = {}
        self.editing_key = None
        self.edit_buffer = ''
        self._edit_fresh = False
        self._status_before_edit = None
        for key, caption in ROWS:
            self.steppers[key] = theme.Stepper(
                self.root, caption, self._value_text(key),
                position=(-0.62, 0.0), scale=(0.34, 0.052),
                on_step=lambda direction, k=key: self._step(k, direction),
                on_value_click=lambda _stepper, k=key: self._begin_edit(k),
                accent=theme.PALETTE['cyan'])
        self.pause_button = theme.MenuButton(
            self.root, 'PAUSE', position=(-0.62, -0.075),
            scale=(0.16, 0.05), rgb_tuple=theme.PALETTE['amber'],
            on_click=lambda _b: self.toggle_pause())
        self.reset_button = theme.MenuButton(
            self.root, 'RESET', position=(-0.62, -0.075),
            scale=(0.16, 0.05), rgb_tuple=theme.PALETTE['grey'],
            on_click=lambda _b: self.reset())
        self.state_title = Text(parent=self.root, text='BALL STATE  (SI)',
                                origin=(-0.5, 0.5),
                                position=(0, 0, theme.CONTENT_Z),
                                scale=theme.TYPE['tiny'],
                                color=theme.rgb('dim'))
        self.state_text = Text(parent=self.root, text='', origin=(-0.5, 0.5),
                               position=(0, 0, theme.CONTENT_Z),
                               scale=theme.TYPE['tiny'],
                               color=theme.rgb('grey'))
        self.bowl_button = theme.MenuButton(
            self.root, 'BOWL', position=(-0.62, -0.27),
            scale=(0.34, 0.062), rgb_tuple=theme.PALETTE['green'],
            on_click=lambda _b: self.bowl())

        # --- live readout (right) ----------------------------------------
        self.live_panel = theme.panel(self.root, position=(0.62, 0.0),
                                      scale=(0.40, 0.66), alpha=0.74,
                                      hairline=theme.PALETTE['green'])
        self.live_title = Text(parent=self.root, text='LIVE',
                               origin=(-0.5, 0.5), position=(0, 0, 0),
                               scale=theme.TYPE['small'],
                               color=theme.rgb('green'))
        self.live_hint = Text(parent=self.root,
                              text='CLICK A ROW FOR THE EQUATION',
                              origin=(0.5, 0.5), position=(0, 0, 0),
                              scale=theme.TYPE['tiny'],
                              color=theme.rgb('dim'))
        self.live_rows = [LiveRow(self.root, key, label,
                                  on_toggle=self._toggle_row)
                          for key, label, _unit in READOUT]
        self.values = {key: 0.0 for key, _label, _unit in READOUT}

        # --- result banner (under the heading, out of the lane's way) ----
        self.banner = theme.glow_text(self.root, '',
                                      position=(0, 0.372, theme.CONTENT_Z),
                                      scale=theme.TYPE['heading'],
                                      rgb_tuple=theme.PALETTE['white'],
                                      glow=theme.PALETTE['amber'])

        # --- timeline (bottom centre) ------------------------------------
        self.timeline = physics.DeckTimeline()
        self.timeline_index = None
        self.tl_dragging = False
        self.tl_panel = theme.panel(self.root, position=(0, TL_Y),
                                    scale=(0.82, TL_HEIGHT), alpha=0.82,
                                    hairline=theme.PALETTE['amber'])
        self.tl_title = Text(parent=self.root, text='TIMELINE',
                             origin=(-0.5, 0.5), position=(0, 0, 0),
                             scale=theme.TYPE['small'],
                             color=theme.rgb('amber'))
        self.tl_time = Text(parent=self.root, text='t =  0.000 s /  0.000 s',
                            origin=(0, 0.5), position=(0, 0, 0),
                            scale=theme.TYPE['small'],
                            color=theme.rgb('white'))
        self.tl_status = Text(parent=self.root, text='',
                              origin=(0, 0.5), position=(0, 0, 0),
                              scale=theme.TYPE['tiny'],
                              color=theme.rgb('dim'))
        self.tl_track = Entity(parent=self.root, model='quad',
                               position=(0, 0, theme.CONTENT_Z),
                               shader=unlit_shader)
        self.tl_fill = Entity(parent=self.tl_track, model='quad',
                              origin=(-0.5, 0), position=(-0.5, 0, -0.01),
                              color=theme.rgba(theme.COLORS['cyan'], 1.0),
                              shader=unlit_shader)
        self.tl_thumb = Entity(parent=self.tl_track, model='quad', z=-0.02,
                               color=theme.rgba(theme.COLORS['text'], 1.0),
                               shader=unlit_shader)
        self.tl_scrub = ScrubTrack(self)

        self.back_button = theme.MenuButton(
            self.root, 'BACK TO MENU', position=(0.62, -0.455),
            scale=(0.30, 0.056), rgb_tuple=theme.PALETTE['grey'],
            on_click=lambda _b: self.app.go_to_menu())

        self.widgets = (list(self.steppers.values()) + self.live_rows
                        + [self.bowl_button, self.pause_button,
                           self.reset_button, self.back_button,
                           self.tl_scrub])
        self.hovers = list(self.widgets)
        self.buttons = [self.bowl_button, self.pause_button,
                        self.reset_button, self.back_button]
        self.result = None
        self.state = 'idle'
        self.paused = False
        self._timer = 0.0
        self._settle_elapsed = 0.0
        self._frames = 0
        self._hit = False
        self._release_speed = 0.0
        self._layout()

    # ------------------------------------------------------------------ layout
    def _layout(self):
        aspect = window.aspect_ratio
        panel_w = min(0.44, (aspect - 0.24) / 2.0)
        panel_h = 0.66
        left_x = -aspect / 2.0 + panel_w / 2.0 + 0.02
        right_x = aspect / 2.0 - panel_w / 2.0 - 0.02
        self.launch_panel.scale = (panel_w, panel_h)
        self.launch_panel.position = (left_x, 0.0, theme.PANEL_Z)
        self.live_panel.scale = (panel_w, panel_h)
        self.live_panel.position = (right_x, 0.0, theme.PANEL_Z)
        top = panel_h / 2.0
        self.launch_title.position = (left_x - panel_w / 2.0 + 0.030,
                                      top - 0.048, theme.CONTENT_Z)
        self.launch_hint.position = (left_x + panel_w / 2.0 - 0.024,
                                     top - 0.048, theme.CONTENT_Z)
        self.live_title.position = (right_x - panel_w / 2.0 + 0.030,
                                    top - 0.048, theme.CONTENT_Z)
        self.live_hint.position = (right_x + panel_w / 2.0 - 0.024,
                                   top - 0.048, theme.CONTENT_Z)
        row_y = top - 0.115
        for index, (key, _caption) in enumerate(ROWS):
            stepper = self.steppers[key]
            stepper.position = (left_x, row_y - index * 0.072,
                                theme.CONTENT_Z + 0.02)
            stepper.resize((panel_w - 0.06, 0.052))
        inner = panel_w - 0.06
        half = (inner - 0.02) / 2.0
        self.pause_button.resize((half, 0.05))
        self.pause_button.position = (left_x - inner / 2.0 + half / 2.0,
                                      -0.075, theme.BUTTON_Z)
        self.reset_button.resize((half, 0.05))
        self.reset_button.position = (left_x + inner / 2.0 - half / 2.0,
                                      -0.075, theme.BUTTON_Z)
        self.state_title.position = (left_x - inner / 2.0, -0.113,
                                     theme.CONTENT_Z)
        self.state_text.position = (left_x - inner / 2.0, -0.137,
                                    theme.CONTENT_Z)
        self.bowl_button.position = (left_x, -top + 0.055, theme.BUTTON_Z)
        self.bowl_button.resize((panel_w - 0.06, 0.062))
        # The live rows flow down from the title; an open row pushes the rows
        # below it down by its equation block, which is why only one may be
        # open at a time.
        y = top - 0.115
        for row in self.live_rows:
            row.resize(panel_w - 0.06, ROW_HEIGHT)
            row.set_position(right_x, y)
            y -= ROW_PITCH
            if row.open:
                y -= DETAIL_HEIGHT
        self.back_button.position = (right_x, -0.455, theme.BUTTON_Z)
        self.back_button.resize((panel_w - 0.06, 0.056))
        self._layout_timeline(left_x + panel_w / 2.0,
                              right_x - panel_w / 2.0)

    def _layout_timeline(self, center_left, center_right):
        """Lay the bottom bar out inside the gap between the two panels."""
        gap = center_right - center_left
        width = max(0.30, min(0.86, gap - 0.03))
        self.tl_panel.scale = (width, TL_HEIGHT)
        self.tl_panel.position = (0, TL_Y, theme.PANEL_Z)
        top = TL_Y + TL_HEIGHT / 2.0
        margin = 0.03
        self.tl_title.position = (-width / 2.0 + margin, top - 0.035,
                                  theme.CONTENT_Z)
        self.tl_time.position = (0.0, top - 0.035, theme.CONTENT_Z)
        # The scrub track: a hairline with a cyan fill and a white thumb.
        track_w = max(0.20, width - 2 * margin)
        self.tl_track.scale = (track_w, TRACK_HEIGHT)
        self.tl_track.position = (0.0, top - 0.085, theme.CONTENT_Z)
        track_px = track_w * theme.REFERENCE_HEIGHT / max(theme.ui_scale(), 1e-6)
        self.tl_track.texture = rounded_mask_texture(track_px,
                                                     TRACK_HEIGHT
                                                     * theme.REFERENCE_HEIGHT
                                                     / max(theme.ui_scale(),
                                                           1e-6),
                                                     3)
        self.tl_track.color = theme.rgba(theme.COLORS['hairline'], 1.0)
        self.tl_fill.texture = self.tl_track.texture
        self.tl_thumb.texture = rounded_mask_texture(16, 16, 8)
        self.tl_scrub.position = (0.0, top - 0.085)
        self.tl_scrub.size = (track_w + 0.02, 0.05)
        self.tl_status.position = (0.0, top - 0.125, theme.CONTENT_Z)

    # ------------------------------------------------------------------ steppers
    def _value_text(self, key):
        setup = self.setup
        value = getattr(setup, key)
        if key == 'speed':
            return f'{format_value(value)} m/s'
        if key == 'lateral':
            return f'{format_value(value, signed=True)} m'
        if key == 'angle':
            return f'{format_value(value, signed=True)} deg'
        return f'{format_value(value, signed=True)} rad/s'

    def _step(self, key, direction):
        value = getattr(self.setup, key) + STEPS[key] * direction
        floor = FLOORS.get(key)
        if floor is not None:
            value = max(floor, value)
        setattr(self.setup, key, value)
        self.steppers[key].set_value(self._value_text(key))
        self.app.play('menu_move')

    # ----------------------------------------------------------- typed entry
    def _edit_text(self, key):
        """The current value as a bare number (no unit, no padding)."""
        return f'{getattr(self.setup, key):g}'

    def _begin_edit(self, key):
        """Clicking a value starts typing; the first key replaces the number."""
        if self.editing_key == key:
            return
        self._finish_edit(commit=True)
        self.editing_key = key
        self.edit_buffer = self._edit_text(key)
        self._edit_fresh = True
        self._status_before_edit = self.tl_status.text
        caption = dict(ROWS)[key]
        self.status(f'typing {caption} - ENTER applies, ESC cancels', warn=True)
        self._render_edit_value()
        self.app.play('menu_move')

    def _render_edit_value(self):
        if self.editing_key is None:
            return
        stepper = self.steppers[self.editing_key]
        stepper.set_value(f'{self.edit_buffer}|')
        stepper.value.set_color(theme.PALETTE['amber'])

    def _edit_key(self, key):
        """Handle one key while a value is being typed (always consumes it)."""
        if key in ('enter', 'return'):
            self._finish_edit(commit=True)
            return True
        if key == 'escape':
            self._finish_edit(commit=False)
            return True
        if key == 'backspace':
            if self._edit_fresh:
                self.edit_buffer = ''
                self._edit_fresh = False
            else:
                self.edit_buffer = self.edit_buffer[:-1]
            self._render_edit_value()
            return True
        character = theme.key_to_character(key)
        if character is None:
            return True
        if character == ',':
            character = '.'
        if character not in '0123456789.+-':
            return True
        if self._edit_fresh:
            self.edit_buffer = character
            self._edit_fresh = False
        else:
            self.edit_buffer += character
        self._render_edit_value()
        return True

    def _finish_edit(self, commit):
        """Apply or discard the typed text and restore the row's readout."""
        key = self.editing_key
        if key is None:
            return
        value = None
        if commit:
            try:
                value = float(self.edit_buffer)
            except (TypeError, ValueError):
                value = None
        self.editing_key = None
        self._edit_fresh = False
        stepper = self.steppers[key]
        stepper.value.set_color(stepper.value_colour)
        if value is not None and math.isfinite(value):
            floor = FLOORS.get(key)
            if floor is not None:
                value = max(floor, value)
            setattr(self.setup, key, value)
            self.app.play('menu_move')
        # Invalid text (or ESC) simply snaps back to the last accepted number.
        stepper.set_value(self._value_text(key))
        if self._status_before_edit is not None:
            self.status(self._status_before_edit)
            self._status_before_edit = None

    # ------------------------------------------------------------------ lifecycle
    def on_show(self, match=None, throw=None, **kwargs):
        self._layout()
        if throw is not None:
            self._load_throw(throw)
        self._begin()

    def _load_throw(self, throw):
        """Seed the steppers with a real throw (the last one of a match)."""
        self.setup.speed = max(0.0, throw.speed)
        self.setup.lateral = throw.lateral_position
        self.setup.angle = math.degrees(throw.launch_angle)
        self.setup.spin = throw.spin_omega
        for key in self.steppers:
            self.steppers[key].set_value(self._value_text(key))

    def hide(self):
        super().hide()
        self._finish_edit(commit=False)
        # Leave the hall as the player found it: standing pins, no recorder
        # attached to the shared deck and the wide camera shot.
        game = self.app.game
        deck = game.pins.deck
        deck.substep_listener = None
        deck.record_trajectory = False
        deck.trajectory = []
        game.pins.reset()
        fov_reset()
        self.paused = False
        self.tl_dragging = False
        self.timeline.clear()
        self.timeline_index = None

    def _begin(self):
        """Return the whole experiment to its initial state.

        Fresh rack, the ball standing at the foul line, an empty timeline and
        no simulation running: the ball will not move until BOWL is clicked.
        """
        self._finish_edit(commit=True)
        game = self.app.game
        deck = game.pins.deck
        deck.substep_listener = None
        deck.record_trajectory = False
        deck.trajectory = []
        game.pins.reset()
        game.ball.reset(lateral=self.setup.lateral)
        game.ball.visible = True
        game.ball.shadow.visible = True
        fov_reset()
        self.result = None
        self.state = 'idle'
        self.paused = False
        self._timer = 0.0
        self._settle_elapsed = 0.0
        self._frames = 0
        self._hit = False
        self._release_speed = 0.0
        self.timeline.clear()
        self.timeline_index = None
        self.tl_dragging = False
        self.banner.set_text('')
        self.status('ready - click BOWL to start the run')
        self.sync_controls()
        self._render_readout()
        self._update_timeline_ui()

    # ------------------------------------------------------------------ run
    def bowl(self):
        """Start a fresh run with the current setup (the manual launch).

        BOWL always resets first, so a paused or inspected run is replaced by
        the new one, and the ball only ever leaves the line from this click.
        """
        if self.state in ('rolling', 'settling') and not self.paused:
            return
        self._begin()
        game = self.app.game
        game.pins.begin_roll()
        throw = ThrowData(**self.setup.as_kwargs(), source='script')
        game.ball.launch(throw)
        deck = game.pins.deck
        deck.record_start()
        self.timeline.clear()
        deck.substep_listener = self.timeline.record
        self.timeline.record(deck)          # t = 0: the release state
        self._release_speed = throw.speed
        self.timeline_index = 0
        self._frames = 0
        self._hit = False
        self.state = 'rolling'
        self.paused = False
        self.status('rolling - pause or drag the timeline any time')
        self.sync_controls()
        self.app.play('release')

    def reset(self):
        """RESET: back to the initial state (the ball waits for BOWL again)."""
        self._begin()
        self.app.play('menu_move')

    def pause(self):
        """Freeze the simulation where it is (no sub-steps while paused)."""
        if not self._pause_available():
            return
        self.paused = True
        self.status('paused - drag the timeline to inspect a moment')
        self.sync_controls()

    def resume(self):
        """Continue the run from the selected state.

        If the timeline was dragged back, the recorded future is dropped and
        the simulation continues from the state being inspected - the same
        fixed sub-step sequence the deck would have run, from that exact
        state.
        """
        if not self.paused:
            return
        game = self.app.game
        deck = game.pins.deck
        if self.timeline_index is not None \
                and self.timeline_index < len(self.timeline) - 1:
            self.timeline.truncate(self.timeline_index)
            self.result = None
            self.banner.set_text('')
            if deck.record_trajectory:
                del deck.trajectory[self.timeline_index:]
            if deck.ball.rolling:
                self.state = 'rolling'
            else:
                self.state = 'settling'
                self._settle_elapsed = 0.0
                self._timer = (0.05 if game.pins.deck_quiet()
                               else config.SETTLE_DELAY)
            self._hit = deck.first_contact_time is not None
        self.paused = False
        self.status('rolling' if self.state == 'rolling'
                    else 'settling - the pins are still falling')
        self.sync_controls()

    def toggle_pause(self):
        self.resume() if self.paused else self.pause()

    def _pause_available(self):
        """True when PAUSE/RESUME has something to act on."""
        if not len(self.timeline):
            return False
        return self.paused or self.state in ('rolling', 'settling')

    # ------------------------------------------------------------------ timeline
    def timeline_available(self):
        return bool(len(self.timeline))

    def scrub_pointer(self, x):
        """Drag the scrubber to the pointer's x position."""
        if not self.timeline_available():
            return
        left = self.tl_scrub.position[0] - self.tl_scrub.size[0] / 2.0
        fraction = (x - left) / max(1e-6, self.tl_scrub.size[0])
        fraction = max(0.0, min(1.0, fraction))
        index = self.timeline.index_at(fraction * self.timeline.duration())
        self.scrub_to(index)

    def scrub_to(self, index):
        """Restore the recorded state at ``index`` and inspect it (paused)."""
        if not self.timeline_available():
            return
        game = self.app.game
        deck = game.pins.deck
        index = self.timeline.restore(deck, index)
        self.timeline_index = index
        self.paused = True
        game.ball.finished = deck.ball_done
        game.ball._sync()
        if deck.first_contact_time is not None:
            fov_push_in()
        else:
            fov_reset()
        self._render_readout()
        self._update_timeline_ui()
        self.sync_controls()
        self.status('paused - drag the timeline to inspect a moment')

    def status(self, text, warn=False):
        text = str(text)
        if self.tl_status.text == text:
            return
        self.tl_status.text = text
        self.tl_status.color = theme.rgb('amber' if warn else 'dim')

    # ------------------------------------------------------------------ controls
    def sync_controls(self):
        """Refresh the BOWL / PAUSE labels for the current state (on change)."""
        moving = self.state in ('rolling', 'settling') and not self.paused
        if moving:
            self._button(self.bowl_button, 'ROLLING...', enabled=False)
        elif self.state == 'idle':
            self._button(self.bowl_button, 'BOWL', enabled=True)
        else:
            self._button(self.bowl_button,
                         'BOWL AGAIN' if len(self.timeline) else 'BOWL',
                         enabled=True)
        self._button(self.pause_button,
                     'RESUME' if self.paused else 'PAUSE',
                     enabled=self._pause_available())

    @staticmethod
    def _button(button, label, enabled):
        if button.label != label:
            button.set_label(label)
        if button.enabled != enabled:
            button.set_enabled(enabled)

    # ------------------------------------------------------------------ per frame
    def on_update(self, pointer_x, pointer_y):
        game = self.app.game
        ball = game.ball
        # The lab owns the ball while it is on screen (the app hides the play
        # ball whenever the play screen is not active).
        ball.visible = True
        ball.shadow.visible = True
        dt = self.dt
        if not self.paused:
            if self.state == 'rolling':
                self._advance_rolling(dt)
            elif self.state == 'settling':
                self._advance_settling(dt)
        self._update_camera(ball)
        self._render_readout()
        self._update_timeline_ui()

    def _advance_rolling(self, dt):
        game = self.app.game
        ball = game.ball
        game.pins.advance(ball, dt)
        self._frames += 1
        deck = game.pins.deck
        if not self._hit and deck.first_contact_time is not None:
            self._hit = True
            self.app.play('pin')
            fov_push_in()
        if ball.finished or deck.ball_done:
            self.state = 'settling'
            self._settle_elapsed = 0.0
            self._timer = config.SETTLE_DELAY
            self.sync_controls()
        self.timeline_index = len(self.timeline) - 1

    def _advance_settling(self, dt):
        game = self.app.game
        game.pins.settle(dt)
        self._frames += 1
        self._timer -= dt
        self._settle_elapsed += dt
        if self._timer <= 0.0 and (game.pins.deck_quiet()
                                   or self._settle_elapsed
                                   >= config.SETTLE_MAX_TIME):
            self._resolve()
        self.timeline_index = len(self.timeline) - 1

    def _update_camera(self, ball):
        if self.state == 'idle':
            update_camera(ball, 'ready')
        elif self.paused:
            update_camera(ball, 'rolling' if ball.physics.rolling
                          else 'settling')
        elif self.state == 'rolling':
            update_camera(ball, 'rolling')
        else:
            update_camera(ball, 'settling')

    def _resolve(self):
        """Record the finished roll and hold the result until the next BOWL."""
        deck = self.app.game.pins.deck
        self.result = physics.RollResult(deck, self._frames,
                                         self._release_speed)
        pins = self.result.knockdowns
        if pins >= 10:
            self.banner.set_text('STRIKE', colour=theme.PALETTE['green'])
            self.app.play('strike')
        elif pins <= 0:
            self.banner.set_text('GUTTER', colour=theme.PALETTE['red'])
            self.app.play('gutter')
        else:
            self.banner.set_text(f'{pins} PINS',
                                 colour=theme.PALETTE['amber'])
            self.app.play('pin')
        self.state = 'done'
        self.paused = False
        self.timeline_index = len(self.timeline) - 1
        self.status('run complete - drag the timeline or bowl again')
        self.sync_controls()

    def _update_timeline_ui(self):
        """Refresh the time, the scrubber and the sample count (every frame)."""
        total = self.timeline.duration()
        current = self.app.game.pins.deck.elapsed
        fraction = (current / total) if total > 0.0 else 0.0
        fraction = max(0.0, min(1.0, fraction))
        self.tl_fill.scale = (max(0.001, fraction), 1.0)
        thumb = theme.px(16)
        self.tl_thumb.position = (-0.5 + fraction, 0.0, -0.02)
        self.tl_thumb.scale = (thumb / max(1e-6, self.tl_track.scale[0]),
                               thumb / max(1e-6, self.tl_track.scale[1]), 1.0)
        self.tl_time.text = (f't = {current:6.3f} s / {total:6.3f} s'
                             + ('   (paused)' if self.paused else ''))
        self.tl_time.color = theme.rgb('amber' if self.paused else 'white')

    # ------------------------------------------------------------------ readout
    def _toggle_row(self, row):
        """Open one equation dropdown and close every other one."""
        opened = not row.open
        for other in self.live_rows:
            other.set_open(False)
        row.set_open(opened)
        self._layout()
        self._render_readout()
        self.app.play('menu_move')

    def _row_value_text(self, key, values):
        value = values[key]
        if key == 'pins':
            return f'{int(value):d}'
        unit = UNITS.get(key, '')
        text = f'{value:5.2f}'
        return f'{text} {unit}' if unit else text

    def _equation_context(self, ball, deck, values):
        """Everything the equation lines substitute into their formulas."""
        rolling = ball.rolling and not ball.stopped
        if not rolling:
            friction, regime = 0.0, 'rest'
        elif ball.in_gutter:
            friction, regime = config.GUTTER_FRICTION, 'gutter'
        elif ball.slip_speed() > config.SLIP_TOLERANCE:
            friction, regime = config.SLIDING_FRICTION, 'skid'
        else:
            friction, regime = config.ROLLING_FRICTION, 'roll'
        vx, _vy, vz = ball.velocity
        wx, wy, wz = ball.angular_velocity
        substep = max(config.PHYSICS_SUBSTEP, 1e-9)
        return {
            't': deck.elapsed,
            'steps': int(round(deck.elapsed / config.PHYSICS_SUBSTEP)),
            'dt_label': f'1/{int(round(1.0 / substep))}',
            'v': values['v'], 'vx': vx, 'vz': vz,
            'heading': math.degrees(math.atan2(vx, vz)) if (vx or vz) else 0.0,
            'a': values['a'], 'friction': friction, 'regime': regime,
            'wx': wx, 'wy': wy, 'wz': wz, 'spin': values['spin'],
            'p': values['p'], 'k': values['k'], 'pins': values['pins'],
            'standing': self.app.game.pins.standing_count(),
            'count': config.PIN_COUNT,
            'mass': config.BALL_MASS, 'gravity': config.GRAVITY,
        }

    def _render_readout(self):
        """Refresh the live values from the simulation, equations included.

        When the timeline is being inspected the deck has been restored to the
        selected moment, so every number here describes that moment - not the
        moment the run was paused.
        """
        game = self.app.game
        ball = game.ball.physics
        deck = game.pins.deck
        rolling = ball.rolling and not ball.stopped
        speed = ball.speed if rolling else 0.0
        acceleration = 0.0
        if rolling:
            ax, _ay, az = ball.last_acceleration
            acceleration = -math.hypot(ax, az)
        spin = (math.sqrt(sum(component * component
                              for component in ball.angular_velocity))
                if rolling else 0.0)
        values = {
            't': deck.elapsed,
            'v': speed,
            'a': acceleration,
            'vx': ball.velocity[0] if rolling else 0.0,
            'spin': spin,
            'p': config.BALL_MASS * speed,
            'k': 0.5 * config.BALL_MASS * speed * speed,
            'pins': float(game.pins.knockdown_count()),
        }
        self.values = values
        context = self._equation_context(ball, deck, values)
        for row in self.live_rows:
            row.set_value(self._row_value_text(row.key, values))
            if row.open:
                symbolic, substituted = equation_lines(row.key, context)
                row.set_equations(symbolic, substituted)
        self._render_state_block(ball, rolling)

    def _render_state_block(self, ball, rolling):
        """The compact vector readout under the launch steppers."""
        x, y, z = ball.position
        vx, vy, vz = ball.velocity
        wx, wy, wz = ball.angular_velocity
        torque = ball.last_torque if rolling else (0.0, 0.0, 0.0)
        tau = math.hypot(torque[0], torque[2])
        momentum = ball.inertia * math.sqrt(wx * wx + wy * wy + wz * wz)
        self.state_text.text = (
            f'POS m   {x:+.3f}  {y:.3f}  {z:+.3f}\n'
            f'VEL m/s {vx:+.2f}  {vy:+.2f}  {vz:+.2f}\n'
            f'OMG r/s {wx:+.2f}  {wy:+.2f}  {wz:+.2f}\n'
            f'L {momentum:.2f}  TAU {tau:.2f}  I {ball.inertia:.4f}')

    # ------------------------------------------------------------------ input
    def on_click(self, x, y):
        """Commit typed text before any other control acts on the click."""
        if self.editing_key is not None:
            # Clicking the number being edited again keeps the field open.
            if self.steppers[self.editing_key].value_hit(x, y):
                return True
            self._finish_edit(commit=True)
        return super().on_click(x, y)

    def on_key(self, key):
        if self.editing_key is not None:
            return self._edit_key(key)
        if key in ('escape', 'b'):
            self.app.go_to_menu()
            return True
        if key == 'r':
            self.reset()
            return True
        if key == 'p':
            self.toggle_pause()
            return True
        if key in ('space', 'enter', 'return'):
            self.bowl()
            return True
        return super().on_key(key)
