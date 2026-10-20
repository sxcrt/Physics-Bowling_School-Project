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

Next to the lane is the calculator. While the ball is waiting, the panel shows
the **plan** the current throw would produce (time to the head pin, speed,
deceleration, sideways speed, momentum, kinetic energy). During a run the same
panel switches to **LIVE** and shows the real simulation state.

The plan is editable and lockable: click a value and type a new one, and the
calculator solves the throw that makes it true. An edit changes only the
variable it must - momentum or energy change the speed, sideways speed changes
the aim, time changes the speed or the friction - and every other plan value
is frozen exactly. Lock a value first and it stays fixed while another one is
changed; locks fall back to their alternative variable (a locked speed makes a
new time solve the friction, for example) and are refused by name when they
cannot hold. The left THROW panel always shows the concrete solution. Zero
momentum/energy is a valid at-rest plan, a time that cannot be reached because
the ball stops short reads "never", and a unit typed beside a number is
accepted. The pins count is the run's outcome rather than an input. Every
readout row is also a dropdown: click the label and the panel shows the
equation behind the number, symbolically and with the current values
substituted.

The launch steppers step in both directions and have no upper limit: the lab
may explore past the match ranges (the ball simply ends up in the gutter, or
the throw leaves at whatever speed was dialled in). A throw's speed only has a
floor at zero, because the simulation clamps it there and the readout would
otherwise show a number the physics is not using. Clicking the number itself
lets the player type an exact value (Enter applies it, Escape cancels), so an
11.37 m/s release no longer has to be reached arrow-step by arrow-step.

Changing the plan's deceleration scales the ball's friction for the next run,
so the calculator's surface and the replay's surface are the same. Everything
shown during a run comes from the simulation: nothing there is a canned
animation. The throw is described by the same launch conditions a real release
produces (speed, start position, aim angle, hook spin).
"""
import math
import re

from ursina import Entity, Text, window
from ursina.shaders import unlit_shader

import config
import physics
from input.mouse_input import ThrowData
from scene.camera import fov_push_in, fov_reset, update_camera
from scene.textures import icon_texture, rounded_mask_texture
from ui import lab_model
from ui import physics_equations
from ui import theme
from ui.layout import wrap_text
from ui.screens import Screen

# The live readout: (key, label, unit). The values come from the deck in a
# run, and from the calculator's plan while the lab is idle.
READOUT = (
    ('t', 't', 's'),
    ('v', 'v', 'm/s'),
    ('a', 'a', 'm/s2'),
    ('vx', 'vx', 'm/s'),
    ('p', 'p', 'kg m/s'),
    ('k', 'K', 'J'),
    ('pins', 'pins', ''),
)
UNITS = {key: unit for key, _label, unit in READOUT}
EDITABLE_READOUT = ('t', 'v', 'a', 'vx', 'p', 'k')
MODEL_KEY = {'k': 'K'}
LAUNCH_TO_MODEL = {'speed': 'v', 'lateral': 'lateral',
                   'angle': 'angle', 'spin': 'hook'}
DEFAULT_DECELERATION = -config.ROLLING_FRICTION * config.GRAVITY
DEFAULT_FIND = {
    'uniform_motion': 't', 'velocity_time': 'a',
    'displacement_time': 't', 'velocity_displacement': 'v',
    'force': 'a', 'work': 'W', 'kinetic_energy': 'v', 'torque': 'tau',
    'angular_velocity': 'omega', 'friction_deceleration': 'a',
    'stopping_distance': 'd', 'stopping_time': 't',
    'sideways_velocity': 'theta',
}
UNIT_FACTORS = {
    'm': {'m': 1.0, 'cm': 0.01, 'mm': 0.001, 'km': 1000.0},
    's': {'s': 1.0, 'min': 60.0, 'h': 3600.0},
    'm/s': {'m/s': 1.0, 'km/h': 1.0 / 3.6, 'mph': 0.44704},
    'm/s2': {'m/s2': 1.0, 'm/s^2': 1.0},
    'kg': {'kg': 1.0, 'g': 0.001},
    'N': {'N': 1.0, 'kN': 1000.0},
    'J': {'J': 1.0, 'kJ': 1000.0},
    'N m': {'nm': 1.0, 'knm': 1000.0},
    'rad/s': {'rad/s': 1.0},
    'deg': {'deg': 1.0, 'rad': 180.0 / math.pi},
}

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


def format_value(value, signed=False, decimals=3):
    """Show up to ``decimals`` places without trailing zeros.

    A typed launch number has to stay readable: the old one-/two-decimal
    display would turn an entered ``-3.25`` into ``-3.2`` even though the
    simulation used the typed value.
    """
    text = f'{value:.{decimals}f}'.rstrip('0').rstrip('.')
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
        if ctx.get('plan'):
            if not math.isfinite(ctx['t']):
                return ('t = (v - sqrt(v^2 - 2 mu g d)) / (mu g)',
                        '= never - the ball stops short')
            return ('t = (v - sqrt(v^2 - 2 mu g d)) / (mu g)',
                    f'= {ctx["t"]:.2f} s to the head pin '
                    f'({ctx["distance"]:.2f} m)')
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
    if ctx.get('plan'):
        return ('pins = the run outcome', '= bowl to measure it')
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

    def __init__(self, parent, key, label, on_toggle, on_value_click=None,
                 on_lock=None):
        self.key = key
        self.label = label
        self.on_toggle = on_toggle
        self.on_value_click = on_value_click
        self.on_lock = on_lock
        self.locked = False
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
        self.lock = None
        if callable(on_lock):
            self.lock = Entity(parent=self.entity, model='quad',
                               texture=icon_texture('unlock'),
                               color=theme.rgba(theme.COLORS['text_dim'], 1.0),
                               scale=(theme.px(12), theme.px(12), 1.0),
                               z=0.02, shader=unlit_shader)
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
        value_right = theme.px(14) if self.lock is None else theme.px(34)
        self.value_text.position = (width / 2.0 - value_right, 0.0, -0.01)
        if self.lock is not None:
            self.lock.position = (width / 2.0 - theme.px(14), 0.0, 0.02)
        block_top = -height / 2.0 - theme.px(7)
        self.equation_text.position = (left + theme.px(14), block_top, -0.01)
        self.result_text.position = (left + theme.px(14),
                                     block_top - LINE_HEIGHT, -0.01)

    def set_locked(self, locked):
        locked = bool(locked)
        if getattr(self, '_lock_visual', None) == locked:
            return self
        self._lock_visual = locked
        self.locked = locked
        if self.lock is None:
            return self
        self.lock.texture = icon_texture('lock' if self.locked else 'unlock')
        self.lock.color = theme.rgba(
            theme.PALETTE['amber'] if self.locked else theme.COLORS['text_dim'],
            1.0)
        self.ring.color = theme.rgba(
            theme.PALETTE['amber'] if self.locked
            else theme.COLORS['hairline'],
            0.85 if self.locked else 1.0)
        return self

    def lock_rect(self):
        if self.lock is None:
            return None
        return (self.position[0] + self.lock.position[0],
                self.position[1], theme.px(24), self.size[1] * 0.9)

    def value_rect(self):
        left = -self.size[0] / 2.0
        right = self.size[0] / 2.0 - (
            theme.px(34) if self.lock is not None else theme.px(10))
        # The number is right-aligned; the right-hand half is its hit area so
        # clicking the label or the middle of the row still opens the equation.
        x0 = left + self.size[0] * 0.52
        width = max(theme.px(30), right - x0)
        return (self.position[0] + (x0 + right) / 2.0, self.position[1],
                width, self.size[1] * 0.9)

    def value_hit(self, x, y):
        vx, vy, vw, vh = self.value_rect()
        return theme.pointer_in((vx, vy), (vw, vh), x, y)

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
        lock_rect = self.lock_rect()
        if lock_rect is not None:
            if theme.pointer_in((lock_rect[0], lock_rect[1]),
                                (lock_rect[2], lock_rect[3]), x, y):
                if callable(self.on_lock):
                    self.on_lock(self)
                return True
        if callable(self.on_value_click) and self.value_hit(x, y):
            self.on_value_click(self)
            return True
        if callable(self.on_toggle):
            self.on_toggle(self)
        return True

    def update_widget(self, x, y, dt):
        hovered = theme.pointer_in(self.position, self.size, x, y)
        hover_value = (callable(self.on_value_click)
                       and self.value_hit(x, y))
        if hovered or hover_value:
            self.body.color = theme.rgba(
                theme.brighten(theme.COLORS['card'], 0.04), 1.0)
            self.ring.color = theme.rgba(theme.COLORS['cyan'], 0.85)
        else:
            self.body.color = theme.rgba(theme.COLORS['card'], 1.0)
            self.ring.color = theme.rgba(
                theme.PALETTE['amber'] if self.locked
                else theme.COLORS['hairline'],
                0.85 if self.locked else 1.0)
        self.chevron.color = theme.rgba(
            theme.COLORS['cyan'], 1.0 if (hovered or self.open) else 0.85)
        if self.lock is not None:
            if hover_value:
                self.lock.color = theme.rgba(theme.COLORS['cyan'], 1.0)
            else:
                self.lock.color = theme.rgba(
                    theme.PALETTE['amber'] if self.locked
                    else theme.COLORS['text_dim'], 1.0)


class SolverRow:
    """One optional GIVEN value in the inverse-solver overlay."""

    HEIGHT = 0.042

    def __init__(self, parent, on_value_click):
        self.on_value_click = on_value_click
        self.position = (0.0, 0.0)
        self.size = (0.42, self.HEIGHT)
        self.symbol = None
        self.missing = False
        self.entity = Entity(parent=parent, position=(0, 0, theme.CONTENT_Z))
        self.body = Entity(parent=self.entity, model='quad', z=0.03,
                           shader=unlit_shader)
        self.ring = Entity(parent=self.entity, model='quad', z=0.025,
                           shader=unlit_shader)
        self.label_text = Text(parent=self.entity, text='', origin=(-0.5, 0.5),
                               scale=theme.TYPE['tiny'],
                               color=theme.rgb('grey'))
        self.value_text = Text(parent=self.entity, text='unknown',
                               origin=(0.5, 0.5), scale=theme.TYPE['small'],
                               color=theme.rgb('white'))
        self.resize(self.size[0], self.size[1])

    def set_symbol(self, symbol):
        self.symbol = symbol
        meta = physics_equations.VARIABLES[symbol]
        unit = f' ({meta["unit"]})' if meta.get('unit') else ''
        self.label_text.text = f'{meta["label"]} ({symbol}){unit}'

    def set_value(self, text, colour=None, missing=False):
        self.value_text.text = str(text)
        self.missing = bool(missing)
        self.value_text.color = theme.rgb(
            'amber' if missing else (colour or 'white'))
        self.ring.color = theme.rgba(
            theme.PALETTE['amber'] if missing else theme.COLORS['hairline'],
            0.9 if missing else 1.0)

    def set_position(self, x, y):
        self.position = (float(x), float(y))
        self._place()
        return self

    def resize(self, width, height):
        self.size = (float(width), float(height))
        width_px = self.size[0] * theme.REFERENCE_HEIGHT \
            / max(theme.ui_scale(), 1e-6)
        height_px = self.size[1] * theme.REFERENCE_HEIGHT \
            / max(theme.ui_scale(), 1e-6)
        for plate in (self.body, self.ring):
            plate.scale = self.size
        self.body.texture = rounded_mask_texture(width_px, height_px,
                                                 theme.SIZES['settings_row_radius'])
        self.body.color = theme.rgba(theme.COLORS['card'], 1.0)
        self.ring.texture = rounded_mask_texture(width_px, height_px,
                                                 theme.SIZES['settings_row_radius'], 1)
        self.ring.color = theme.rgba(theme.COLORS['hairline'], 1.0)
        self._place()
        return self

    def _place(self):
        x, y = self.position
        width, height = self.size
        self.entity.position = (x, y, theme.CONTENT_Z)
        self.label_text.position = (-width / 2.0 + theme.px(12), 0.0, -0.01)
        self.value_text.position = (width / 2.0 - theme.px(12), 0.0, -0.01)

    def contains(self, x, y):
        return theme.pointer_in(self.position, self.size, x, y)

    def click(self, x, y):
        if not theme.widget_active(self.entity):
            return False
        if not self.contains(x, y):
            return False
        if callable(self.on_value_click):
            self.on_value_click(self)
        return True

    def update_widget(self, x, y, dt):
        hovered = self.contains(x, y)
        self.body.color = theme.rgba(
            theme.brighten(theme.COLORS['card'], 0.04 if hovered else 0.0), 1.0)


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
        self.launch_hint = Text(parent=self.root, text='TYPE A VALUE',
                                origin=(0.5, 0.5),
                                position=(0, 0, theme.CONTENT_Z),
                                scale=theme.TYPE['tiny'],
                                color=theme.rgb('dim'))
        self.setup = ThrowSetup()
        self.deceleration = DEFAULT_DECELERATION
        self.locks = {key: False for key in EDITABLE_READOUT}
        self.steppers = {}
        self.editing_key = None
        self.edit_buffer = ''
        self._edit_fresh = False
        self._status_before_edit = None
        self.live_editing_key = None
        self.live_edit_buffer = ''
        self._live_edit_fresh = False
        self._live_status_before_edit = None
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
        self.bowl_button = theme.MenuButton(
            self.root, 'BOWL', position=(-0.62, -0.21),
            scale=(0.34, 0.062), rgb_tuple=theme.PALETTE['green'],
            on_click=lambda _b: self.bowl())

        # --- live readout (right) ----------------------------------------
        self.live_panel = theme.panel(self.root, position=(0.62, 0.0),
                                      scale=(0.40, 0.66), alpha=0.74,
                                      hairline=theme.PALETTE['green'])
        self.live_title = Text(parent=self.root, text='CALCULATOR',
                               origin=(-0.5, 0.5), position=(0, 0, 0),
                               scale=theme.TYPE['small'],
                               color=theme.rgb('cyan'))
        self.live_hint = Text(parent=self.root,
                              text='TYPE A VALUE; LOCK TO HOLD',
                              origin=(0.5, 0.5), position=(0, 0, 0),
                              scale=theme.TYPE['tiny'],
                              color=theme.rgb('dim'))
        self.live_rows = [
            LiveRow(self.root, key, label,
                    on_toggle=self._toggle_row,
                    on_value_click=(
                        (lambda _row, k=key: self._begin_live_edit(k))
                        if key in EDITABLE_READOUT else None),
                    on_lock=(
                        (lambda _row, k=key: self._toggle_lock(k))
                        if key in EDITABLE_READOUT else None))
            for key, label, _unit in READOUT
        ]
        self.values = {key: 0.0 for key, _label, _unit in READOUT}
        self.live_values = dict(self.values)
        self.plan_values = None

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
        self.solver_button = theme.MenuButton(
            self.root, 'SOLVER', position=(0.74, 0.37),
            scale=(0.18, 0.045), rgb_tuple=theme.PALETTE['cyan'],
            on_click=lambda _b: self.open_solver())
        self.solver_open = False
        self.solver_equation_id = 'uniform_motion'
        self.solver_find = 't'
        self.solver_given = {}
        self.solver_result = None
        self.solver_inputs = {}
        self.solver_editing_symbol = None
        self.solver_edit_buffer = ''
        self.solver_edit_fresh = False

        self.widgets = (list(self.steppers.values()) + self.live_rows
                        + [self.bowl_button, self.pause_button,
                           self.reset_button, self.back_button,
                           self.solver_button, self.tl_scrub])
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
        self._build_solver()

    # ------------------------------------------------------------------ solver
    def _build_solver(self):
        self.solver_root = Entity(parent=self.root, position=(0, 0, -0.6))
        self.solver_root.enabled = False
        Entity(parent=self.solver_root, model='quad', position=(0, 0, 0.50),
               scale=(window.aspect_ratio, 1.0),
               color=theme.rgba(theme.COLORS['shade'], 0.86))
        theme.panel(self.solver_root, position=(0, 0), scale=(1.30, 0.84),
                    alpha=0.98, hairline=theme.PALETTE['cyan'])

        title = Text(parent=self.solver_root, text='PHYSICS SOLVER',
                     origin=(-0.5, 0.5), position=(-0.58, 0.36, theme.CONTENT_Z),
                     scale=theme.TYPE['heading'], color=theme.rgb('white'))
        subtitle = Text(parent=self.solver_root,
                        text='Analytical model, not a simulation measurement.',
                        origin=(-0.5, 0.5), position=(-0.58, 0.322, theme.CONTENT_Z),
                        scale=theme.TYPE['tiny'], color=theme.rgb('dim'))

        self.solver_equation_stepper = theme.Stepper(
            self.solver_root, 'EQUATION', '', position=(-0.40, 0.275),
            scale=(0.42, 0.044),
            on_step=lambda direction: self._solver_cycle_equation(direction),
            accent=theme.PALETTE['cyan'])
        self.solver_find_stepper = theme.Stepper(
            self.solver_root, 'FIND', '', position=(-0.40, 0.215),
            scale=(0.42, 0.044),
            on_step=lambda direction: self._solver_cycle_find(direction),
            accent=theme.PALETTE['green'])
        Text(parent=self.solver_root,
             text='GIVEN  (leave a value blank if unknown)',
             origin=(-0.5, 0.5), position=(-0.58, 0.160, theme.CONTENT_Z),
             scale=theme.TYPE['tiny'], color=theme.rgb('cyan'))

        self.solver_rows = []
        for index in range(3):
            row = SolverRow(self.solver_root, self._begin_solver_edit)
            row.set_position(-0.40, 0.105 - index * 0.048)
            self.solver_rows.append(row)

        self.solver_hint = Text(parent=self.solver_root, text='',
                                origin=(-0.5, 0.5),
                                position=(-0.58, -0.10, theme.CONTENT_Z),
                                scale=theme.TYPE['tiny'], color=theme.rgb('dim'))

        self.solver_solve_button = theme.MenuButton(
            self.solver_root, 'SOLVE', position=(-0.52, -0.35),
            scale=(0.15, 0.045), rgb_tuple=theme.PALETTE['green'],
            on_click=lambda _b: self._solve_solver())
        self.solver_apply_button = theme.MenuButton(
            self.solver_root, 'APPLY TO SHOT', position=(-0.31, -0.35),
            scale=(0.21, 0.045), rgb_tuple=theme.PALETTE['amber'],
            on_click=lambda _b: self._apply_solver_result())
        self.solver_close_button = theme.MenuButton(
            self.solver_root, 'CLOSE', position=(-0.09, -0.35),
            scale=(0.14, 0.045), rgb_tuple=theme.PALETTE['grey'],
            on_click=lambda _b: self.close_solver())

        theme.panel(self.solver_root, position=(0.33, 0.045),
                    scale=(0.58, 0.70), alpha=0.55, hairline=None,
                    z=theme.CONTENT_Z - 0.02)
        self.solver_result_text = Text(
            parent=self.solver_root, text='', origin=(-0.5, 0.5),
            position=(0.07, 0.345, theme.CONTENT_Z - 0.04),
            scale=theme.TYPE['tiny'], color=theme.rgb('grey'))

        self.solver_widgets = (
            [self.solver_equation_stepper, self.solver_find_stepper]
            + self.solver_rows
            + [self.solver_solve_button, self.solver_apply_button,
               self.solver_close_button])
        self._sync_solver_form()

    def open_solver(self):
        self.solver_open = True
        self.solver_root.enabled = True
        self._sync_solver_form()
        self.app.play('menu_move')

    def close_solver(self):
        if self.solver_editing_symbol is not None:
            self._finish_solver_edit(commit=True)
        self.solver_open = False
        self.solver_editing_symbol = None
        if getattr(self, 'solver_root', None) is not None:
            self.solver_root.enabled = False

    def _solver_equation(self):
        for equation in physics_equations.EQUATIONS:
            if equation['id'] == self.solver_equation_id:
                return equation
        return physics_equations.EQUATIONS[0]

    def _solver_cycle_equation(self, direction):
        equations = physics_equations.EQUATIONS
        index = next((i for i, equation in enumerate(equations)
                      if equation['id'] == self.solver_equation_id), 0)
        index = (index + direction) % len(equations)
        self.solver_equation_id = equations[index]['id']
        self.solver_find = DEFAULT_FIND.get(self.solver_equation_id,
                                            equations[index]['variables'][0])
        self.solver_result = None
        self._sync_solver_form()
        self.app.play('menu_move')

    def _solver_cycle_find(self, direction):
        equation = self._solver_equation()
        variables = list(equation['variables'])
        index = variables.index(self.solver_find) \
            if self.solver_find in variables else 0
        index = (index + direction) % len(variables)
        self.solver_find = variables[index]
        self.solver_result = None
        self._sync_solver_form()
        self.app.play('menu_move')

    def _sync_solver_form(self):
        if getattr(self, 'solver_root', None) is None:
            return
        equation = self._solver_equation()
        if self.solver_find not in equation['variables']:
            self.solver_find = DEFAULT_FIND.get(equation['id'],
                                                equation['variables'][0])
        self.solver_equation_stepper.set_value(equation['name'])
        meta = physics_equations.VARIABLES[self.solver_find]
        self.solver_find_stepper.set_value(
            f'{meta["label"]} ({self.solver_find})')
        self.solver_inputs = {}
        symbols = [symbol for symbol in equation['variables']
                   if symbol != self.solver_find]
        for index, row in enumerate(self.solver_rows):
            if index < len(symbols):
                symbol = symbols[index]
                row.set_symbol(symbol)
                row.entity.enabled = True
                meta = physics_equations.VARIABLES[symbol]
                value = self.solver_given.get(symbol)
                if value is None and meta.get('default') is not None:
                    value = meta['default']
                if value is None:
                    row.set_value('unknown', colour='dim')
                else:
                    row.set_value(self._solver_format(value))
                self.solver_inputs[symbol] = row
            else:
                row.entity.enabled = False
        self._render_solver_result()

    @staticmethod
    def _solver_format(value):
        return f'{value:g}'

    def _begin_solver_edit(self, row):
        self.solver_editing_symbol = row.symbol
        meta = physics_equations.VARIABLES[row.symbol]
        value = self.solver_given.get(row.symbol, meta.get('default'))
        self.solver_edit_buffer = '' if value is None else self._solver_format(value)
        self.solver_edit_fresh = True
        self.solver_hint.text = (f'typing {row.symbol} - ENTER applies, '
                                 'ESC cancels')
        self.solver_hint.color = theme.rgb('amber')
        row.set_value(f'{self.solver_edit_buffer}|')

    def _solver_edit_key(self, key):
        if key in ('enter', 'return'):
            self._finish_solver_edit(commit=True)
            return True
        if key == 'escape':
            self._finish_solver_edit(commit=False)
            return True
        if key == 'backspace':
            if self.solver_edit_fresh:
                self.solver_edit_buffer = ''
                self.solver_edit_fresh = False
            else:
                self.solver_edit_buffer = self.solver_edit_buffer[:-1]
            self._render_solver_edit_value()
            return True
        character = theme.key_to_character(key)
        if character is None:
            return True
        if character == ',':
            character = '.'
        if not (character.isalnum() or character in '.+-/^* '):
            return True
        if self.solver_edit_fresh:
            self.solver_edit_buffer = character
            self.solver_edit_fresh = False
        else:
            self.solver_edit_buffer += character
        self._render_solver_edit_value()
        return True

    def _render_solver_edit_value(self):
        if self.solver_editing_symbol is None:
            return
        row = self.solver_inputs.get(self.solver_editing_symbol)
        if row is not None:
            row.set_value(f'{self.solver_edit_buffer}|')

    def _finish_solver_edit(self, commit):
        symbol = self.solver_editing_symbol
        if symbol is None:
            return
        value = None
        if commit and not self.solver_edit_fresh:
            value = self._parse_solver_value(symbol, self.solver_edit_buffer)
        self.solver_editing_symbol = None
        self.solver_edit_fresh = False
        self.solver_hint.text = ''
        self.solver_hint.color = theme.rgb('dim')
        changed = False
        if value is not None and math.isfinite(value):
            if self.solver_given.get(symbol) != value:
                changed = True
            self.solver_given[symbol] = value
        elif commit and not self.solver_edit_fresh:
            if symbol in self.solver_given:
                changed = True
            self.solver_given.pop(symbol, None)
        row = self.solver_inputs.get(symbol)
        if row is not None:
            current = self.solver_given.get(symbol)
            if current is None:
                meta = physics_equations.VARIABLES[symbol]
                if meta.get('default') is not None:
                    row.set_value(self._solver_format(meta['default']))
                else:
                    row.set_value('unknown', colour='dim')
            else:
                row.set_value(self._solver_format(current))
        if changed:
            self.solver_result = None
            self._render_solver_result()

    def _parse_solver_value(self, symbol, text):
        raw = str(text if text is not None else '').strip()
        if not raw:
            return None
        match = re.match(r'^([+-]?(?:\d+\.?\d*|\.\d+))\s*(.*)$', raw)
        if match is None:
            return None
        try:
            value = float(match.group(1))
        except ValueError:
            return None
        suffix = ''.join(match.group(2).split()).lower()
        if not suffix:
            return value
        canonical = physics_equations.VARIABLES[symbol].get('unit', '')
        factor = UNIT_FACTORS.get(canonical, {}).get(suffix)
        return None if factor is None else value * factor

    def _solve_solver(self):
        self.solver_result = physics_equations.solve_equation(
            self.solver_equation_id, self.solver_find, self.solver_given)
        self._render_solver_result()
        self.app.play('menu_move' if self.solver_result['ok'] else 'menu_back')

    def _render_solver_result(self):
        if getattr(self, 'solver_result_text', None) is None:
            return
        result = self.solver_result
        lines = []
        if result is None:
            lines = [
                'Pick an equation, enter what you know, choose the one value',
                'to find, then press SOLVE.',
                '',
                'Blank values are unknown. If the selected equation needs',
                'one of them, the solver will say exactly what is missing.',
            ]
        elif not result.get('ok'):
            lines = ['CANNOT SOLVE YET', '', result.get('message', '')]
            if result.get('formula'):
                lines += ['', f'FORMULA: {result["formula"]}']
            if result.get('missing'):
                lines += ['', 'NEEDED:']
                for symbol in result['missing']:
                    meta = physics_equations.VARIABLES[symbol]
                    lines.append(f'  {meta["label"]} ({symbol}) - add a value above.')
            if result.get('assumptions'):
                lines += ['', 'ASSUMPTIONS:']
                lines += [f'  {item}' for item in result['assumptions']]
            if result.get('note'):
                lines += ['', result['note']]
        else:
            lines = [result['equationName'].upper(),
                     'Analytical result - exact under the assumptions.',
                     '', 'KNOWN VALUES:']
            used = next((equation for equation in physics_equations.EQUATIONS
                         if equation['id'] == result['equationId']), None)
            if used is not None:
                for symbol in used['variables']:
                    if symbol == result['find']:
                        continue
                    value = result.get('given', {}).get(symbol)
                    if value is None or not math.isfinite(value):
                        continue
                    meta = physics_equations.VARIABLES[symbol]
                    lines.append(f'  {meta["label"]} ({symbol}) = '
                                 f'{physics_equations.fmt(value)} {meta["unit"]}')
            lines += ['', f'FORMULA: {result["formula"]}',
                      f'REARRANGED: {result["rearranged"]}',
                      f'SUBSTITUTION: {result["substitution"]}',
                      '', 'CALCULATION:']
            lines += [f'  {item}' for item in result.get('steps', [])]
            lines += ['', f'ANSWER: {result["answer"]}']
            if result.get('note'):
                lines += ['', result['note']]
            if result.get('alternatives'):
                lines += ['', 'OTHER VALID SOLUTIONS:']
                for alternative in result['alternatives']:
                    lines.append(f'  {result["find"]} = '
                                 f'{physics_equations.fmt(alternative["value"])}'
                                 f' {result.get("unit", "")} '
                                 f'({alternative.get("note", "")})')
            if result.get('assumptions'):
                lines += ['', 'ASSUMPTIONS:']
                lines += [f'  {item}' for item in result['assumptions']]
            if result.get('requestedEquationId') \
                    and result['requestedEquationId'] != result['equationId']:
                lines += ['', result.get('note', '')]
            apply = result.get('apply') or {}
            if apply.get('unsupported'):
                lines += ['', 'SIMULATION:', f'  {apply["unsupported"]}']
            elif apply:
                lines += ['', 'APPLY TO SHOT:']
                if apply.get('speed') is not None:
                    lines.append(f'  speed = {physics_equations.fmt(apply["speed"])} m/s')
                if apply.get('deceleration') is not None:
                    lines.append('  lane deceleration = '
                                 f'{physics_equations.fmt(apply["deceleration"])} m/s2')
                if apply.get('aim') is not None:
                    lines.append(f'  aim = {physics_equations.fmt(apply["aim"])} deg')
                lines.append('  Lane distance and start position are unchanged.')
            else:
                lines += ['', 'SIMULATION:',
                          '  This result is analytical only; it does not set',
                          '  a shot parameter.']
        wrapped = []
        for line in lines:
            if not line:
                wrapped.append('')
                continue
            wrapped.extend(wrap_text(line, 54))
        self.solver_result_text.text = '\n'.join(wrapped)

    def _apply_solver_result(self):
        result = self.solver_result
        if not result or not result.get('ok'):
            return
        apply = result.get('apply') or {}
        if apply.get('unsupported'):
            self.status(apply['unsupported'], warn=True)
            return
        changed = False
        if apply.get('speed') is not None:
            self.setup.speed = max(0.0, apply['speed'])
            changed = True
        if apply.get('deceleration') is not None:
            self.deceleration = min(0.0, apply['deceleration'])
            changed = True
        if apply.get('friction') is not None:
            gravity = result.get('given', {}).get('g') or config.GRAVITY
            self.deceleration = -abs(apply['friction'] * gravity)
            changed = True
        if apply.get('aim') is not None:
            self.setup.angle = apply['aim']
            changed = True
        if not changed:
            self.status('this result does not set a shot parameter', warn=True)
            return
        self._sync_launch_inputs()
        self._begin()
        self.close_solver()
        self.status('solver values applied - press BOWL')
        self.app.play('menu_move')

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
        self.bowl_button.position = (left_x, -0.21, theme.BUTTON_Z)
        self.bowl_button.resize((panel_w - 0.06, 0.062))
        self.solver_button.position = (aspect / 2.0 - 0.14, 0.37,
                                       theme.BUTTON_Z)
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
        self._apply_plan(LAUNCH_TO_MODEL[key], value)

    # ------------------------------------------------------- calculator model
    def _plan_values(self):
        values = lab_model.plan_derived({
            'v': self.setup.speed, 'angle': self.setup.angle,
            'hook': self.setup.spin, 'a': self.deceleration,
            'lateral': self.setup.lateral,
        })
        values['k'] = values['K']
        return values

    def _display_values(self):
        if self.state == 'idle':
            return dict(self._plan_values(), pins=None)
        return dict(self.values)

    def _format_readout(self, key, value):
        if key == 'pins':
            return '--' if value is None else str(int(round(value)))
        if value is None or not math.isfinite(value):
            return 'never' if key == 't' else '--'
        unit = UNITS.get(key, '')
        text = format_value(value, decimals=2)
        return f'{text} {unit}' if unit else text

    def _sync_launch_inputs(self):
        for key, stepper in self.steppers.items():
            stepper.set_value(self._value_text(key))

    def _sync_readout_inputs(self, display):
        for row in self.live_rows:
            if row.key == self.live_editing_key:
                continue
            row.set_value(self._format_readout(row.key, display.get(row.key)))

    def _sync_lock_icons(self):
        for row in self.live_rows:
            row.set_locked(self.locks.get(row.key, False))

    def _toggle_lock(self, key):
        if key not in self.locks:
            return
        if self.state != 'idle':
            self._begin()
        plan = self._plan_values()
        model_key = MODEL_KEY.get(key, key)
        if not math.isfinite(plan[model_key]):
            self.status(f'{key.upper()} has no finite plan - cannot lock it',
                        warn=True)
            return
        self.locks[key] = not self.locks[key]
        self._sync_lock_icons()
        self._render_readout()
        self.app.play('menu_move')

    def _apply_plan(self, model_key, value):
        """Set one value and solve the rest of the plan around the locks."""
        try:
            value = float(value)
        except (TypeError, ValueError):
            self._sync_launch_inputs()
            return False
        if not math.isfinite(value):
            self._sync_launch_inputs()
            return False

        if model_key == 'lateral':
            self.setup.lateral = value
            self._sync_launch_inputs()
            self._begin()
            self.app.play('menu_move')
            return True

        previous = {
            'v': self.setup.speed, 'angle': self.setup.angle,
            'hook': self.setup.spin, 'a': self.deceleration,
            'lateral': self.setup.lateral,
        }
        plan = self._plan_values()
        ui_key = 'k' if model_key == 'K' else model_key
        if self.locks.get(ui_key):
            self.locks[ui_key] = False
            self._sync_lock_icons()

        if model_key == 'a':
            value = -abs(value) if abs(value) > 0.0 else 0.0
        elif model_key == 'v':
            value = max(0.0, value)
        elif model_key == 't':
            if value <= 0.0:
                self._sync_launch_inputs()
                self.status('T must be greater than zero', warn=True)
                return False
        elif model_key in ('p', 'K'):
            if value < 0.0:
                self._sync_launch_inputs()
                self.status(f'{ui_key.upper()} cannot be negative',
                            warn=True)
                return False
            value = abs(value)
        elif model_key == 'spin':
            if value <= 0.0:
                self._sync_launch_inputs()
                self.status('SPIN must be greater than zero', warn=True)
                return False
            value = abs(value)

        # The edited value is offered first, then the locks. The solver
        # backtracks over the candidates, so an edited t can fall back to
        # solving the deceleration when speed is locked.
        targets = {model_key: value}
        for key, locked in self.locks.items():
            if not locked:
                continue
            mk = MODEL_KEY.get(key, key)
            locked_value = plan[mk]
            if not math.isfinite(locked_value):
                self._sync_launch_inputs()
                self._render_readout()
                self.status(f'{key.upper()} is locked but has no finite plan '
                            '- unlock it', warn=True)
                return False
            targets[mk] = locked_value

        result = lab_model.solve_plan(previous, targets)
        if not result['ok']:
            self._sync_launch_inputs()
            self._render_readout()
            conflict = result.get('conflict') or ui_key
            label = 'K' if conflict in ('k', 'K') else str(conflict).upper()
            self.status(f'no solution: {label} cannot move with those locks',
                        warn=True)
            self.app.play('menu_back')
            return False

        core = result['core']
        self.setup.speed = max(0.0, core['v'])
        self.setup.angle = core['angle']
        self.setup.spin = core['hook']
        self.deceleration = core['a']
        self._sync_launch_inputs()
        self._begin()
        self.app.play('menu_move')
        return True

    # ----------------------------------------------------------- typed entry
    def _edit_text(self, key):
        """The current value as a bare number (no unit, no padding)."""
        return f'{getattr(self.setup, key):g}'

    def _begin_edit(self, key):
        """Clicking a value starts typing; the first key replaces the number."""
        if self.editing_key == key:
            return
        self._finish_edit(commit=True)
        self._finish_live_edit(commit=True)
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
        """Handle one key while a throw value is being typed."""
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
        """Apply or discard the typed throw value."""
        key = self.editing_key
        if key is None:
            return
        value = None
        if commit and not self._edit_fresh:
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
            if self._apply_plan(LAUNCH_TO_MODEL[key], value):
                return
            self._sync_launch_inputs()
            return
        # Invalid text (or ESC) snaps back to the last accepted number.
        stepper.set_value(self._value_text(key))
        if self._status_before_edit is not None:
            self.status(self._status_before_edit)
            self._status_before_edit = None

    # ----------------------------------------------------- typed readout entry
    def _live_edit_text(self, key):
        value = self._display_values().get(key)
        if value is None or not math.isfinite(value):
            return ''
        return format_value(value, decimals=2)

    def _begin_live_edit(self, key):
        if key == 'pins' or self.live_editing_key == key:
            return
        self._finish_edit(commit=True)
        self._finish_live_edit(commit=True)
        self.live_editing_key = key
        self.live_edit_buffer = self._live_edit_text(key)
        self._live_edit_fresh = True
        self._live_status_before_edit = self.tl_status.text
        self.status(f'typing {key.upper()} - ENTER solves, ESC cancels',
                    warn=True)
        self._render_live_edit_value()
        self.app.play('menu_move')

    def _render_live_edit_value(self):
        if self.live_editing_key is None:
            return
        row = self._row(self.live_editing_key)
        row.set_value(f'{self.live_edit_buffer}|')
        row.value_text.color = theme.rgb('amber')

    def _live_edit_key(self, key):
        if key in ('enter', 'return'):
            self._finish_live_edit(commit=True)
            return True
        if key == 'escape':
            self._finish_live_edit(commit=False)
            return True
        if key == 'backspace':
            if self._live_edit_fresh:
                self.live_edit_buffer = ''
                self._live_edit_fresh = False
            else:
                self.live_edit_buffer = self.live_edit_buffer[:-1]
            self._render_live_edit_value()
            return True
        character = theme.key_to_character(key)
        if character is None:
            return True
        if character == ',':
            character = '.'
        # Readout fields accept a trailing unit too ("5kg/ms", "0m/s^2").
        if not (character.isalnum() or character in '.+-/^* '):
            return True
        if self._live_edit_fresh:
            self.live_edit_buffer = character
            self._live_edit_fresh = False
        else:
            self.live_edit_buffer += character
        self._render_live_edit_value()
        return True

    def _finish_live_edit(self, commit):
        key = self.live_editing_key
        if key is None:
            return
        value = None
        if commit and not self._live_edit_fresh:
            value = lab_model.parse_readout_value(key, self.live_edit_buffer)
        self.live_editing_key = None
        self._live_edit_fresh = False
        row = self._row(key)
        row.value_text.color = theme.rgb('white')
        if value is not None and math.isfinite(value):
            if self._apply_plan(MODEL_KEY.get(key, key), value):
                return
            row.set_value(self._format_readout(
                key, self._display_values().get(key)))
            return
        row.set_value(self._format_readout(key,
                                           self._display_values().get(key)))
        if self._live_status_before_edit is not None:
            self.status(self._live_status_before_edit)
            self._live_status_before_edit = None

    # ------------------------------------------------------------------ lifecycle
    def on_show(self, match=None, throw=None, **kwargs):
        self._layout()
        self.close_solver()
        for key in self.locks:
            self.locks[key] = False
        if throw is not None:
            self._load_throw(throw)
        self._begin()

    def _load_throw(self, throw):
        """Seed the steppers with a real throw (the last one of a match)."""
        self.setup.speed = max(0.0, throw.speed)
        self.setup.lateral = throw.lateral_position
        self.setup.angle = math.degrees(throw.launch_angle)
        self.setup.spin = throw.spin_omega
        self.deceleration = DEFAULT_DECELERATION
        for key in self.locks:
            self.locks[key] = False
        self._sync_launch_inputs()
        self._sync_lock_icons()

    def hide(self):
        super().hide()
        self._finish_edit(commit=False)
        self._finish_live_edit(commit=False)
        # Leave the hall as the player found it: standing pins, no recorder
        # attached to the shared deck and the wide camera shot.
        game = self.app.game
        deck = game.pins.deck
        deck.substep_listener = None
        deck.record_trajectory = False
        deck.trajectory = []
        game.pins.reset()
        game.ball.physics.friction_scale = 1.0
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
        self._finish_edit(commit=False)
        self._finish_live_edit(commit=False)
        game = self.app.game
        deck = game.pins.deck
        deck.substep_listener = None
        deck.record_trajectory = False
        deck.trajectory = []
        game.pins.reset()
        game.ball.reset(lateral=self.setup.lateral)
        game.ball.physics.friction_scale = \
            lab_model.deceleration_to_scale(self.deceleration)
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
        game.ball.physics.friction_scale = \
            lab_model.deceleration_to_scale(self.deceleration)
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
        if self.solver_open:
            for row in getattr(self, 'solver_rows', ()):
                if row.entity.enabled:
                    row.update_widget(pointer_x, pointer_y, self.dt)
            for widget in getattr(self, 'solver_widgets', ()):
                update = getattr(widget, 'update_widget', None)
                if callable(update):
                    update(pointer_x, pointer_y, self.dt)
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
    def _row(self, key):
        return [row for row in self.live_rows if row.key == key][0]

    def _toggle_row(self, row):
        """Open one equation dropdown and close every other one."""
        opened = not row.open
        for other in self.live_rows:
            other.set_open(False)
        row.set_open(opened)
        self._layout()
        self._render_readout()
        self.app.play('menu_move')

    def _equation_context(self, ball, deck, values):
        """Everything the live equation lines substitute into their formulas."""
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
            'plan': False,
        }

    def _plan_equation_context(self, plan):
        """The same substitutions, filled from the calculator's plan."""
        return {
            't': plan['t'], 'steps': 0, 'dt_label': '',
            'v': plan['v'], 'vx': plan['vx'], 'vz': plan['vz'],
            'heading': self.setup.angle, 'a': plan['a'],
            'friction': (-plan['a'] / config.GRAVITY
                         if plan['a'] < 0 else 0.0),
            'regime': 'roll',
            'wx': plan['angular'][0], 'wy': 0.0, 'wz': plan['angular'][2],
            'spin': plan['spin'], 'p': plan['p'], 'k': plan['k'],
            'pins': 0.0, 'standing': config.PIN_COUNT,
            'count': config.PIN_COUNT,
            'mass': config.BALL_MASS, 'gravity': config.GRAVITY,
            'plan': True, 'distance': config.LANE_LENGTH,
        }

    def _render_readout(self):
        """Refresh the calculator (idle) or the live run's numbers.

        While the lab is idle the panel is the plan the calculator solved;
        during a run it is the real simulation state. The equations explain
        whichever values are on screen.
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
        self.live_values = {
            't': deck.elapsed,
            'v': speed,
            'a': acceleration,
            'vx': ball.velocity[0] if rolling else 0.0,
            'spin': spin,
            'p': config.BALL_MASS * speed,
            'k': 0.5 * config.BALL_MASS * speed * speed,
            'pins': float(game.pins.knockdown_count()),
        }

        plan_mode = self.state == 'idle'
        self.plan_values = self._plan_values()
        display = (dict(self.plan_values, pins=None) if plan_mode
                   else self.live_values)
        self.values = display
        context = (self._plan_equation_context(self.plan_values) if plan_mode
                   else self._equation_context(ball, deck, self.live_values))

        self.live_title.text = 'CALCULATOR' if plan_mode else 'LIVE'
        self.live_title.color = theme.rgb('cyan' if plan_mode else 'green')
        self.live_hint.text = ('TYPE A VALUE; LOCK TO HOLD' if plan_mode
                               else 'TYPE A VALUE TO RECALCULATE')

        self._sync_readout_inputs(display)
        for row in self.live_rows:
            if row.open:
                symbolic, substituted = equation_lines(row.key, context)
                row.set_equations(symbolic, substituted)
        self._sync_lock_icons()

    # ------------------------------------------------------------------ input
    def on_click(self, x, y):
        """Commit typed text before any other control acts on the click."""
        if self.solver_open:
            if self.solver_editing_symbol is not None:
                row = self.solver_inputs.get(self.solver_editing_symbol)
                if row is not None and row.contains(x, y):
                    return True
                self._finish_solver_edit(commit=True)
            for widget in self.solver_widgets:
                if widget.click(x, y):
                    return True
            return True
        if self.editing_key is not None:
            # Clicking the number being edited again keeps the field open.
            if self.steppers[self.editing_key].value_hit(x, y):
                return True
            self._finish_edit(commit=True)
        if self.live_editing_key is not None:
            if self._row(self.live_editing_key).value_hit(x, y):
                return True
            self._finish_live_edit(commit=True)
        return super().on_click(x, y)

    def on_key(self, key):
        if self.solver_open:
            if self.solver_editing_symbol is not None:
                return self._solver_edit_key(key)
            if key in ('escape', 'b'):
                self.close_solver()
            return True
        if self.editing_key is not None:
            return self._edit_key(key)
        if self.live_editing_key is not None:
            return self._live_edit_key(key)
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
