"""The non-gameplay screens: splash, main menu, mode picker, help, settings.

All of them share the design system in :mod:`ui.theme`. Every control here is
real: a button starts the screen it names, a row changes a value the game
actually reads, and the mode picker only shows modes that lead to a complete
gameplay flow.

Design rules used by every screen in this file (the UI pass brief):

* one full-screen dim (#0B0820 at 55%) plus a vignette behind everything -
  there are no extra dark wrapper boxes behind panels,
* one title style: 40px bold white, +2px tracking, the pink double glow, at a
  fixed 32px from the top of the screen,
* one spacing scale (8/16/24/32/48), 64px side margins, 32px top/bottom,
  panels with 32px of inner padding and a 1px cyan->pink gradient border,
* nothing is ever shrunk to fit: the container is made wide enough instead.
"""
import math

from ursina import Entity, color, window
from ursina.shaders import unlit_shader

import game.modes as modes
from game.settings import DIFFICULTIES, INPUT_MODES, RUSH_DURATIONS
from game.session import PLAYER_COLORS
from motion import MOTION
from scene.textures import (glow_texture, gradient_bar_texture,
                            panel_texture, rounded_mask_texture, sign_texture,
                            vertical_fade_texture)
from ui import theme
from ui.layout import wrap_text
from ui.screens import Screen


class MenuScreen(Screen):
    """Shared base: the one backdrop, the one title and small layout helpers."""

    BRAND = 'HELLS BALLS'

    def __init__(self, app):
        super().__init__(app)
        self.logo = None
        self.brand_glow = None
        self.brand_rgb = tuple(theme.COLORS['pink'])
        self.brand_alpha = 0.34
        self._brand_time = 0.0

    # ------------------------------------------------------------------ pieces
    def make_logo(self, position=(0, 0.30), width=0.66, height=0.165,
                  text=None, rgb=None):
        """The Neon sign plate (Pillow-drawn), with a glow-text fallback."""
        text = text or self.BRAND
        rgb = tuple(rgb or self.brand_rgb)
        texture = sign_texture(text, rgb=rgb)
        if texture is not None:
            self.logo = Entity(parent=self.root, model='quad',
                               texture=texture,
                               position=(position[0], position[1],
                                         theme.CONTENT_Z - 0.02),
                               scale=(width, height), color=color.white)
        else:
            self.logo = theme.glow_text(self.root, text, position=position,
                                        scale=width * 2.2, glow=rgb)
        return self.logo

    def make_brand(self, position=(0, 0.30), width=0.64, height=0.160,
                   bloom=(1.85, 3.3), rgb=None, alpha=0.34):
        """The sign plus its bloom: the front screens' one hero element."""
        rgb = tuple(rgb or self.brand_rgb)
        self.brand_rgb = rgb
        self.brand_alpha = float(alpha)
        self.brand_glow = Entity(
            parent=self.root, model='quad',
            texture=glow_texture(rgb, size=128, power=2.1),
            position=(position[0], position[1] - 0.004,
                      theme.BACKDROP_Z - 0.22),
            scale=(width * bloom[0], height * bloom[1]),
            color=theme.rgba(rgb, self.brand_alpha))
        self.brand_bloom = (width * bloom[0], height * bloom[1])
        self.make_logo(position=position, width=width, height=height, rgb=rgb)
        return self.logo

    def place_brand(self, center_px, width=0.62, height=0.155):
        """Move the sign (and its bloom) to a reference-pixel position."""
        position = theme.screen_pos(*center_px)
        if self.logo is not None:
            self.logo.position = (position[0], position[1],
                                  theme.CONTENT_Z - 0.02)
        if self.brand_glow is not None:
            self.brand_glow.position = (position[0], position[1] - 0.004,
                                        theme.BACKDROP_Z - 0.22)
        self.brand_center_px = center_px
        return self.logo

    def _update_brand(self, dt, speed=2.2, depth=0.10):
        """Breathe the sign's bloom (skipped when motion is reduced)."""
        if self.brand_glow is None:
            return
        self._brand_time += dt
        wave = (1.0 if MOTION.reduce_motion else
                1.0 + depth * math.sin(self._brand_time * speed))
        self.brand_glow.color = theme.rgba(self.brand_rgb,
                                           self.brand_alpha * wave)

    def make_backdrop(self, alpha=None):
        """The one full-screen dim plus the rim vignette (see the brief)."""
        self.dim, self.vignette = theme.dim_layer(self.root)
        return self.dim

    def make_header(self, title, subtitle='', y=None, accent=None):
        """The standard screen title, fixed at 32px from the top."""
        self.title = theme.screen_title(self.root, title)
        self.page_title = self.title
        self.subtitle_entity = None
        return self.title

    def place_title(self, text):
        """Update the fixed title without moving it."""
        self.title.set_text(text)
        return self.title


class SplashScreen(MenuScreen):
    """Title screen: the city, the sign, and one clear way in.

    It is deliberately short: the sign and the prompt are on screen from the
    first frame, any key or click goes straight to the menu, and the screen
    also advances on its own after a few seconds so nobody waits for it.
    """

    name = 'splash'
    camera_view = 'splash'
    AUTO_ADVANCE = 6.0

    def build(self):
        super().build()
        self.make_backdrop()
        self.make_brand(position=theme.screen_pos(640, 290),
                        width=0.70, height=0.175)
        theme.arrow_row(self.root, theme.screen_pos(640, 566)[1], count=9,
                        spacing=0.055, size=0.026,
                        rgb_tuple=theme.COLORS['cyan'], alpha=0.38)
        self.prompt = theme.ArcadeButton(
            self.root, 'PLAY', position=theme.screen_pos(640, 424),
            size_px=(theme.SIZES['primary_w'], theme.SIZES['primary_h']),
            variant='primary', accent=theme.COLORS['pink'],
            font_px=theme.SIZES['primary_font'],
            tracking=theme.SIZES['primary_tracking'], key_hint='ENTER',
            on_click=lambda _b: self.app.go_to_menu())
        self.cta = theme.TextSprite(
            self.root, 'OR CLICK ANYWHERE TO START',
            position=theme.screen_pos(640, 505),
            size_px=theme.SIZES['hint_font'],
            rgb_tuple=theme.COLORS['text_dim'], tracking=2.0,
            z=theme.CONTENT_Z)
        self.buttons = [self.prompt]
        self.widgets = [self.prompt]
        self.hovers = [self.prompt]
        self.hint = theme.HintBar(self.root, (
            ('key', 'ENTER'), ('text', 'play'),
            ('break', None),
            ('key', 'S'), ('text', 'settings'),
            ('break', None),
            ('key', 'F12'), ('text', 'screenshot'),
        ))
        self._elapsed = 0.0
        self._blink = 0.0

    def on_show(self, **kwargs):
        self._blink = 0.0
        self._elapsed = 0.0
        self.place_brand((640, 300))
        self.hint.relayout()

    def on_update(self, pointer_x, pointer_y):
        self._blink += self.dt
        self._elapsed += self.dt
        self._update_brand(self.dt)
        wave = 0.5 + 0.5 * math.sin(self._blink * 2.8)
        if MOTION.reduce_motion:
            wave = 0.55
        self.prompt.set_pulse(0.16 * wave)
        self.cta.set_color(theme.COLORS['text_dim'], 0.45 + 0.55 * wave)
        if self._elapsed >= self.AUTO_ADVANCE:
            self.app.go_to_menu()

    def on_key(self, key):
        if key in ('enter', 'return', 'space', 'left mouse down'):
            self.app.go_to_menu()
            return True
        return False

    def on_click(self, x, y):
        self.app.go_to_menu()
        return True


class MainMenuScreen(MenuScreen):
    """The front door: the sign, PLAY, three secondary screens, QUIT.

    The stack is centred: the sign, a 48px gap, the 380x72 PLAY plate, a 24px
    gap, the three 220x56 secondary buttons with 16px gaps, a 32px gap and the
    input toggle (a 14px INPUT label 8px above the segmented control). QUIT is
    32px from the bottom-right corner; the hint line sits on a 72px gradient
    strip at the bottom edge, clear of the bowler.
    """

    name = 'menu'
    camera_view = 'menu'

    HINT_ITEMS = (
        ('icon', 'arrow_left'), ('icon', 'arrow_right'),
        ('text', 'menu'),
        ('break', None),
        ('key', 'ENTER'), ('text', 'select'),
        ('break', None),
        ('key', 'A'), ('key', 'D'), ('text', 'move your feet'),
        ('break', None),
        ('text', 'drag the ball to throw'),
    )

    def build(self):
        super().build()
        self.make_backdrop()
        self.make_brand(position=theme.screen_pos(640, 96), width=0.62,
                        height=0.155)

        self.play_button = theme.ArcadeButton(
            self.root, 'PLAY', position=theme.screen_pos(640, 236),
            size_px=(theme.SIZES['primary_w'], theme.SIZES['primary_h']),
            variant='primary', accent=theme.COLORS['pink'],
            font_px=theme.SIZES['primary_font'],
            tracking=theme.SIZES['primary_tracking'], key_hint='ENTER',
            on_click=lambda _b: self._activate(self.app.go_to_modes,
                                               cue='confirm'))

        secondary = (
            ('HOW TO PLAY', self.app.go_to_help),
            ('PHYSICS LAB', self.app.go_to_lab),
            ('SETTINGS', self.app.open_settings),
        )
        self.secondary_buttons = []
        for index, (label, action) in enumerate(secondary):
            x = 640 + (index - 1) * (theme.SIZES['secondary_w']
                                     + theme.SIZES['secondary_gap'])
            button = theme.ArcadeButton(
                self.root, label, position=theme.screen_pos(x, 324),
                size_px=(theme.SIZES['secondary_w'],
                         theme.SIZES['secondary_h']),
                variant='secondary', accent=theme.COLORS['cyan'],
                font_px=theme.SIZES['secondary_font'],
                on_click=lambda _b, a=action: self._activate(a),
                index=index + 1)
            self.secondary_buttons.append(button)

        self.input_label = theme.TextSprite(
            self.root, 'INPUT', position=theme.screen_pos(640, 394),
            size_px=theme.SIZES['input_label_font'],
            rgb_tuple=theme.COLORS['text_dim'],
            tracking=theme.SIZES['label_tracking'], z=theme.CONTENT_Z)
        self.input_stepper = theme.SegmentedControl(
            self.root,
            [(mode, mode.upper()) for mode in INPUT_MODES],
            position=theme.screen_pos(640, 432),
            value=self._input_value(), on_change=self._set_input)

        self.quit_button = theme.ArcadeButton(
            self.root, 'QUIT',
            position=theme.screen_pos(
                1280 - theme.SIZES['quit_margin'] - theme.SIZES['quit_w'] / 2.0,
                720 - theme.SIZES['quit_margin'] - theme.SIZES['quit_h'] / 2.0),
            size_px=(theme.SIZES['quit_w'], theme.SIZES['quit_h']),
            variant='ghost', accent=theme.COLORS['coral'],
            font_px=theme.SIZES['quit_font'],
            on_click=lambda _b: self._activate(self.app.quit))

        self.hint_strip = theme.bottom_strip(
            self.root, height_px=theme.SIZES['hint_strip'],
            alpha=theme.SIZES['hint_strip_alpha'])
        self.hint = theme.HintBar(self.root, self.HINT_ITEMS)

        self.buttons = ([self.play_button] + self.secondary_buttons
                        + [self.quit_button])
        self.widgets = list(self.buttons) + [self.input_stepper]
        self.hovers = list(self.widgets)
        self._keyboard_focus = False
        self._layout_key = None
        self._play_time = 0.0
        self._layout()
        self.refresh_selection()

    # --------------------------------------------------------------- layout
    def _window_key(self):
        try:
            return (round(window.aspect_ratio, 4), tuple(window.size))
        except Exception:                              # pragma: no cover
            return None

    def _layout(self):
        """(Re)place everything from the reference-pixel grid."""
        self._layout_key = self._window_key()
        sizes = theme.SIZES
        self.place_brand((640, 96))
        theme.place(self.play_button, 640, 236)
        for index, button in enumerate(self.secondary_buttons):
            x = 640 + (index - 1) * (sizes['secondary_w']
                                     + sizes['secondary_gap'])
            theme.place(button, x, 324)
        theme.place(self.input_label, 640, 394)
        theme.place(self.input_stepper, 640, 432)
        theme.place(self.quit_button,
                    1280 - sizes['quit_margin'] - sizes['quit_w'] / 2.0,
                    720 - sizes['quit_margin'] - sizes['quit_h'] / 2.0)
        for widget in self.widgets:
            widget.relayout()
        self.input_label.relayout()
        self.hint.relayout()
        if self.hint_strip is not None:
            self.hint_strip.scale = (window.aspect_ratio,
                                     theme.px(sizes['hint_strip']))
            self.hint_strip.y = (-0.5
                                 + theme.px(sizes['hint_strip']) / 2.0)

    # ------------------------------------------------------------------ input
    def _input_value(self):
        return str(self.app.settings.get('input_mode', 'mouse'))

    def _set_input(self, value):
        if str(value) == str(self.app.settings.get('input_mode')):
            return
        self.app.settings['input_mode'] = value
        self.app.apply_settings()
        self.app.play('menu_move')

    def _activate(self, action, cue='menu_select'):
        self.app.play(cue)
        action()

    # ------------------------------------------------------------- selection
    def move_selection(self, step):
        self._keyboard_focus = True
        super().move_selection(step)
        self.refresh_selection()

    def refresh_selection(self):
        for index, button in enumerate(self.buttons):
            button.set_selected(self._keyboard_focus and index == self.selected)

    def on_click(self, x, y):
        handled = super().on_click(x, y)
        if handled and self._keyboard_focus:
            self._keyboard_focus = False
            self.refresh_selection()
        return handled

    def on_show(self, **kwargs):
        self.input_stepper.set_value(self._input_value())
        self._layout()
        self.refresh_selection()

    def on_update(self, pointer_x, pointer_y):
        self._update_brand(self.dt)
        if self._window_key() != self._layout_key:
            self._layout()
        if MOTION.reduce_motion:
            self.play_button.set_pulse(0.0)
        else:
            self._play_time += self.dt
            self.play_button.set_pulse(
                0.05 + 0.05 * (0.5 + 0.5 * math.sin(self._play_time * 1.7)))

    def on_key(self, key):
        if key == 'escape':
            return False
        handled = super().on_key(key)
        if handled and key in ('up arrow', 'down arrow', 'left arrow',
                               'right arrow', 'up', 'down'):
            self.refresh_selection()
        return handled


class ModeSelectScreen(MenuScreen):
    """The mode picker: a 6-row list on the left, the detail panel on the right.

    Left list: x=96, y=112, 400 wide; seven 60px rows with 8px gaps, each with
    a 40px icon tile and the mode title. Right panel: x=536, y=112, 648 wide,
    the same height as the list, with 32px of padding; it holds the title,
    tagline, description, rule chips, a 1px divider and MATCH SETUP. BACK and
    START are 200x56, 32px from the bottom corners (left edge at 96, right
    edge at 1184), at least 24px below the panel.
    """

    name = 'modes'
    camera_view = 'modes'

    # Reference-pixel geometry (1280x720).
    LIST_X = 96.0
    LIST_Y = 112.0
    DETAIL_X = 536.0
    DETAIL_Y = 112.0

    def build(self):
        super().build()
        self.make_backdrop()
        self.make_header('CHOOSE YOUR GAME')

        sizes = theme.SIZES
        self.list_width = sizes['list_w']
        self.list_height = (len(modes.picker_modes()) * sizes['row_h']
                            + (len(modes.picker_modes()) - 1) * sizes['row_gap'])
        self.detail_width = sizes['detail_w']
        self.detail_height = self.list_height

        # --- left list ----------------------------------------------------
        self.mode_list = modes.picker_modes()
        self.cards = []
        for index, mode in enumerate(self.mode_list):
            row = theme.ModeRow(
                self.root, mode.title, on_click=lambda clicked: self._row_clicked(
                    clicked), index=index,
                icon=theme.MODE_ICONS.get(mode.id),
                accent=theme.MODE_ACCENTS.get(mode.id, mode.ball_rgb))
            self.cards.append(row)

        # --- detail panel --------------------------------------------------
        self.info_panel = theme.Panel(self.root, self.detail_width,
                                      self.detail_height)
        self.detail_title = theme.TextSprite(
            self.root, '', size_px=sizes['detail_title'],
            rgb_tuple=theme.COLORS['text'], bold=True, anchor='lefttop',
            z=theme.CONTENT_Z)
        self.detail_tagline = theme.TextSprite(
            self.root, '', size_px=sizes['detail_tagline'],
            rgb_tuple=theme.COLORS['cyan'], anchor='lefttop',
            z=theme.CONTENT_Z)
        self.detail_desc = theme.TextSprite(
            self.root, '', size_px=sizes['detail_desc'],
            rgb_tuple=theme.COLORS['text_dim'], anchor='lefttop',
            line_spacing=round(sizes['detail_desc'] * 0.33),
            z=theme.CONTENT_Z)
        self.info_title = self.detail_title        # kept name
        self.info_subtitle = self.detail_tagline   # kept name
        self.info_text = self.detail_desc          # kept name
        self.info_rules = theme.ChipFlow(self.root, max_width_px=1.0, count=5)
        for chip in self.info_rules.chips:
            chip.pad_x = 10.0
            chip.pad_y = 6.0
        self.detail_rule = Entity(parent=self.root, model='quad',
                                  color=theme.rgba(theme.COLORS['hairline'],
                                                   1.0), shader=unlit_shader)
        self.setup_heading = theme.TextSprite(
            self.root, 'MATCH SETUP', size_px=sizes['setup_heading'],
            rgb_tuple=theme.COLORS['cyan'], bold=True,
            tracking=sizes['setup_tracking'], anchor='lefttop',
            z=theme.CONTENT_Z)
        self.empty_setup = theme.EmptySetup(self.root)

        self.players_stepper = theme.Stepper(
            self.root, 'PLAYERS', '1', on_step=lambda _d: self._step(
                self.players_stepper, _d), accent=theme.COLORS['cyan'],
            value_colour=theme.COLORS['cyan'])
        self.difficulty_stepper = theme.Stepper(
            self.root, 'BOT LEVEL', 'MEDIUM', on_step=lambda _d: self._step(
                self.difficulty_stepper, _d), accent=theme.COLORS['purple'],
            value_colour=theme.COLORS['purple'])
        self.duration_stepper = theme.Stepper(
            self.root, 'DURATION', '3:00', on_step=lambda _d: self._step(
                self.duration_stepper, _d), accent=theme.COLORS['amber'],
            value_colour=theme.COLORS['amber'])
        self.setup_note = None
        self.name_entries = []
        for index in range(4):
            entry = theme.SetupEntry(
                self.root, placeholder=f'PLAYER {index + 1}',
                on_submit=self._commit_names)
            self.name_entries.append(entry)

        # --- navigation ----------------------------------------------------
        self.back_button = theme.ArcadeButton(
            self.root, 'BACK', size_px=(sizes['nav_w'], sizes['nav_h']),
            variant='ghost', accent=theme.COLORS['text_dim'],
            font_px=sizes['nav_font'],
            on_click=lambda _b: self.app.go_to_menu())
        self.start_button = theme.ArcadeButton(
            self.root, 'START', size_px=(sizes['nav_w'], sizes['nav_h']),
            variant='primary', accent=theme.COLORS['pink'],
            font_px=sizes['nav_font'], tracking=1.0,
            on_click=lambda _b: self._start())

        self.widgets = ([self.start_button, self.back_button,
                         self.players_stepper, self.difficulty_stepper,
                         self.duration_stepper] + self.name_entries)
        self.hovers = list(self.widgets) + list(self.cards)
        self.buttons = [self.start_button, self.back_button]
        self.selected = 0
        self.selected_ball = 0
        self.player_count = 1
        self.difficulty = self.app.settings.get('bot_difficulty', 'medium')
        self.duration = self.app.settings.get('rush_duration', 180.0)
        self._keyboard_focus = False
        self._layout_key = None
        self._detail_rows = []
        self._layout()
        self._sync_selection()

    # --------------------------------------------------------------- layout
    def _window_key(self):
        try:
            return (round(window.aspect_ratio, 4), tuple(window.size))
        except Exception:                              # pragma: no cover
            return None

    def _layout(self):
        """(Re)place the fixed parts; the detail panel then sizes to content."""
        self._layout_key = self._window_key()
        sizes = theme.SIZES
        self.title.place()
        self.title.relayout()
        self.list_width = sizes['list_w']
        self.detail_width = sizes['detail_w']
        self._layout_list()
        self.back_button.relayout()
        theme.place(self.back_button,
                    self.LIST_X + sizes['nav_w'] / 2.0,
                    720 - sizes['nav_bottom'] - sizes['nav_h'] / 2.0)
        theme.place(self.start_button,
                    1184 - sizes['nav_w'] / 2.0,
                    720 - sizes['nav_bottom'] - sizes['nav_h'] / 2.0)
        self._relayout_detail()

    def _layout_list(self):
        sizes = theme.SIZES
        height = (len(self.cards) * sizes['row_h']
                  + max(0, len(self.cards) - 1) * sizes['row_gap'])
        self.list_height = height
        self.detail_height = height
        self.info_panel.set_size(height, self.detail_width)
        for index, row in enumerate(self.cards):
            row.relayout()
            row.place(theme.screen_pos(self.LIST_X + self.list_width / 2.0,
                                       self.LIST_Y + sizes['row_h'] / 2.0
                                       + index * (sizes['row_h']
                                                  + sizes['row_gap'])))

    # --------------------------------------------------------------- detail
    def _measure_rows(self, rows, row_h, row_gap):
        """Height of a stack of (widgets) rows."""
        if not rows:
            return 0.0
        return len(rows) * row_h + (len(rows) - 1) * row_gap

    def _setup_rows(self, left, width, row_h):
        """The visible setup controls, grouped into rows."""
        steppers = [stepper for stepper in
                    (self.players_stepper, self.difficulty_stepper,
                     self.duration_stepper) if stepper.visible]
        entries = [entry for entry in self.name_entries if entry.visible]
        rows = [[(stepper, left, width)] for stepper in steppers]
        gap = theme.LAYOUT['gap_min']
        for index in range(0, len(entries), 2):
            pair = entries[index:index + 2]
            if len(pair) == 1:
                rows.append([(pair[0], left, width)])
            else:
                cell = (width - gap) / 2.0
                rows.append([(pair[0], left, cell),
                             (pair[1], left + cell + gap, cell)])
        return rows

    def _relayout_detail(self):
        """Lay out the detail panel top-to-bottom, squeezing only when needed.

        The panel has a fixed height (the list's), so a mode with a lot of
        content is laid out with the same blocks but tighter section gaps
        (24 -> 16, never below the 16px minimum) and shorter setup rows. Text
        itself is never shrunk or clipped.
        """
        sizes = theme.SIZES
        mode = self.mode
        pad = sizes['detail_pad']
        panel_left = self.DETAIL_X
        panel_top = self.DETAIL_Y
        panel_height = self.detail_height
        self.info_panel.set_size(panel_height, self.detail_width)
        self.info_panel.set_center((panel_left + self.detail_width / 2.0,
                                    panel_top + panel_height / 2.0))
        self.detail_height = panel_height
        left = panel_left + pad
        width = self.detail_width - 2 * pad
        top = panel_top + pad
        bottom = panel_top + panel_height - pad
        budget = bottom - top

        # Text content (measured, never shrunk).
        self.detail_title.set_text(mode.title)
        self.detail_tagline.set_text(mode.subtitle)
        self.detail_desc.max_width_px = width
        self.detail_desc.set_text(mode.description)
        self.setup_heading.set_text('MATCH SETUP')

        steppers = [stepper for stepper in
                    (self.players_stepper, self.difficulty_stepper,
                     self.duration_stepper) if stepper.visible]
        entries = [entry for entry in self.name_entries if entry.visible]

        has_setup = bool(steppers or entries)
        self.empty_setup.visible = not has_setup

        setup_left = left
        setup_width = width
        fixed_text = (self.detail_title.height_px + 8.0
                      + self.detail_tagline.height_px + 16.0
                      + self.detail_desc.height_px)
        # Try the roomiest layout first and tighten only as far as needed: the
        # section gaps go 24 -> 16 (never below the 16px minimum), the setup
        # rows 44 -> 36 and their gap 16 -> 8. If the rules still need more
        # room than the panel has, the last rules are dropped rather than
        # clipped or overlapped (4 of 5 chips fit for the busiest mode).
        layout = None
        for gap_section, row_h, row_gap in ((24.0, 44.0, 16.0),
                                            (24.0, 40.0, 8.0),
                                            (16.0, 40.0, 8.0),
                                            (16.0, 36.0, 8.0)):
            rows = self._setup_rows(setup_left, setup_width, row_h)
            setup_h = self._measure_rows(rows, row_h, row_gap)
            if not has_setup:
                setup_h = 24.0
            tail = (gap_section + 1.0 + gap_section
                    + self.setup_heading.height_px + 16.0 + setup_h)
            space_for_chips = budget - fixed_text - tail
            texts = self._fit_chips(mode.rules, width, space_for_chips)
            chips_h = self.info_rules.height_px
            total = fixed_text + gap_section + chips_h + tail
            layout = (gap_section, row_h, row_gap, rows, setup_h, texts,
                      chips_h)
            if total <= budget:
                break

        gap_section, row_h, row_gap, rows, setup_h, texts, chips_h = layout

        y = top
        # Anchor-'lefttop' sprites address their top edge, so ``y`` is the top.
        theme.place(self.detail_title, left, y)
        self.detail_title.relayout()
        y += self.detail_title.height_px + 8.0
        theme.place(self.detail_tagline, left, y)
        self.detail_tagline.relayout()
        y += self.detail_tagline.height_px + 16.0
        theme.place(self.detail_desc, left, y)
        self.detail_desc.relayout()
        y += self.detail_desc.height_px + gap_section
        # ChipFlow's origin is the top-left of its first row, so it is placed
        # by its top edge, not its centre.
        theme.place(self.info_rules, left, y)
        self.info_rules.position = (self.info_rules.position[0],
                                    self.info_rules.position[1], theme.CONTENT_Z)
        y += chips_h + gap_section
        self.detail_rule.scale = (theme.px(width), theme.px(1))
        theme.place(self.detail_rule, left + width / 2.0, y + 0.5)
        y += 1.0 + gap_section
        theme.place(self.setup_heading, left, y)
        self.setup_heading.relayout()
        y += self.setup_heading.height_px + 16.0

        self._detail_rows = rows
        if has_setup:
            for row in rows:
                for widget, row_left, row_width in row:
                    widget.set_size_px((row_width, row_h))
                    theme.place(widget, row_left + row_width / 2.0,
                                y + row_h / 2.0)
                y += row_h + row_gap
        else:
            self.empty_setup.place(left, y + 12.0)

    def _fit_chips(self, rules, width, space_for_chips):
        """Show as many rule chips as fit the space; never clip or overlap."""
        chips = self.info_rules.chips
        available = list(rules)[:len(chips)]
        if not available:
            self.info_rules.set_texts([])
            return []
        while True:
            self.info_rules.max_width_px = width
            self.info_rules.set_texts(available)
            if self.info_rules.height_px <= space_for_chips \
                    or len(available) <= 1:
                return available
            available = available[:-1]

    # --------------------------------------------------------------- selection
    @property
    def mode(self):
        return self.mode_list[self.selected_ball]

    def on_show(self, **kwargs):
        self._layout()
        self._sync_selection()

    def select_ball(self, index):
        self.selected_ball = index % len(self.mode_list)
        mode = self.mode
        low, high = mode.player_range
        self.player_count = max(low, min(high, self.player_count))
        self._sync_selection()

    def _effective_players(self):
        mode = self.mode
        low, high = mode.player_range
        if mode.id == 'pvbot':
            return 2
        if low == high:
            return low
        return max(low, min(high, self.player_count))

    def _row_clicked(self, row):
        self.select_ball(row.index)
        self._keyboard_focus = False
        self.app.play('menu_move')

    def _sync_selection(self):
        mode = self.mode
        for index, row in enumerate(self.cards):
            row.set_selected(index == self.selected_ball)
            row.set_focus(self._keyboard_focus
                          and index == self.selected_ball)
            row.update_widget(-9.0, -9.0, 0.0)
        # Setup: only what this mode actually uses.
        low, high = mode.player_range
        show_players = high > low and mode.id != 'pvbot'
        self.players_stepper.visible = show_players
        self.difficulty_stepper.visible = mode.allow_bot
        self.duration_stepper.visible = mode.timed
        players = self._effective_players()
        self.players_stepper.set_value(str(players))
        self.difficulty_stepper.set_value(self.difficulty.upper())
        minutes = int(self.duration // 60)
        seconds = int(self.duration - minutes * 60)
        self.duration_stepper.set_value(f'{minutes}:{seconds:02d}')

        editable = mode.allow_bot or high > low
        for index, entry in enumerate(self.name_entries):
            entry.visible = editable and index < players - (1 if mode.allow_bot
                                                             else 0)
            if entry.visible:
                default = ('YOU' if mode.allow_bot and index == 0
                           else f'PLAYER {index + 1}')
                entry.set_text(self.app.player_name(index, default))
            else:
                entry.focus(False)
        self._relayout_detail()

    # ------------------------------------------------------------------ steppers
    def _step(self, stepper, direction):
        mode = self.mode
        self.app.play('menu_move')
        if stepper is self.players_stepper:
            low, high = mode.player_range
            self.player_count = max(low, min(high, self.player_count + direction))
        elif stepper is self.difficulty_stepper:
            order = list(DIFFICULTIES)
            index = (order.index(self.difficulty) + direction) % len(order)
            self.difficulty = order[index]
            self.app.settings['bot_difficulty'] = self.difficulty
        elif stepper is self.duration_stepper:
            options = list(RUSH_DURATIONS)
            index = options.index(self.duration) if self.duration in options else 0
            self.duration = options[(index + direction) % len(options)]
            self.app.settings['rush_duration'] = self.duration
        self.app.save_settings()
        self._sync_selection()

    def _commit_names(self, _text=None):
        for index, entry in enumerate(self.name_entries):
            if entry.visible:
                self.app.set_player_name(index, entry.text.strip())

    # --------------------------------------------------------------------- start
    def _player_specs(self):
        mode = self.mode
        players = self._effective_players()
        specs = []
        for index in range(players):
            is_bot = mode.allow_bot and index > 0
            name = ('BOT' if is_bot else self.app.player_name(
                index, f'PLAYER {index + 1}'))
            specs.append({'name': name,
                          'rgb': PLAYER_COLORS[index % len(PLAYER_COLORS)],
                          'is_bot': is_bot,
                          'difficulty': self.difficulty})
        return specs

    def _start(self):
        self._commit_names()
        self.app.play('confirm')
        duration = self.duration if self.mode.timed else None
        self.app.start_match(self.mode.id, self._player_specs(),
                             duration=duration)

    # ------------------------------------------------------------------- input
    def on_update(self, pointer_x, pointer_y):
        if self._window_key() != self._layout_key:
            self._layout()
            self._sync_selection()

    def on_key(self, key):
        for entry in self.name_entries:
            if entry.focused:
                result = entry.on_key(key)
                if result is not None:
                    return True
        if key in ('left arrow', 'up arrow', 'a', 'w'):
            self._move_ball(-1)
            return True
        if key in ('right arrow', 'down arrow', 'd', 's'):
            self._move_ball(1)
            return True
        if key in ('enter', 'return'):
            self._start()
            return True
        if key == 'escape':
            self.app.go_to_menu()
            return True
        digits = '1234567'
        if key in digits:
            index = digits.index(key)
            if index < len(self.mode_list):
                self.select_ball(index)
                self.app.play('menu_move')
            return True
        return False

    def _move_ball(self, step):
        self._keyboard_focus = True
        self.select_ball(self.selected_ball + step)
        self.app.play('menu_move')

    def on_click(self, x, y):
        for widget in self.widgets:
            if widget.click(x, y):
                return True
        for row in self.cards:
            if row.click(x, y):
                return True
        return False


class HelpRow:
    """One How to Play paragraph: a 150px label chip column, then the body.

    The chip carries the paragraph's "WORD:" prefix (MOUSE cyan, WEBCAM pink,
    KEYS amber, everything else cyan) or a 1-2 word caps label; the body keeps
    its original text at 17px with 1.5 line height.
    """

    BODY_LINE_SPACING = 5.5        # 17px * 1.5 line height

    def __init__(self, parent, z=theme.CONTENT_Z):
        self.root = Entity(parent=parent, z=z)
        self.chip_plate = Entity(parent=self.root, model='quad', z=0.02,
                                 shader=unlit_shader)
        self.chip_label = theme.TextSprite(self.root, '', size_px=15,
                                           rgb_tuple=theme.COLORS['cyan'],
                                           anchor='lefttop', z=0.01)
        self.body = theme.TextSprite(self.root, '',
                                     size_px=theme.TYPE_PX['body'],
                                     rgb_tuple=theme.COLORS['text_dim'],
                                     anchor='lefttop',
                                     line_spacing=self.BODY_LINE_SPACING,
                                     z=0.0)
        self.height_px = 0.0

    def place(self, left_px, top_px, chip_col=150.0, chip_pad=14.0,
              chip_gap=16.0):
        chip_plate_w = min(chip_col,
                           self.chip_label.width_px + 2 * chip_pad)
        chip_h = self.chip_label.height_px + 2 * 8.0
        self.chip_plate.texture = rounded_mask_texture(
            max(4.0, chip_plate_w), max(4.0, chip_h), 8.0)
        self.chip_plate.scale = (theme.px(chip_plate_w), theme.px(chip_h))
        self.chip_plate.color = theme.rgba(self.chip_rgb, 0.20)
        chip_x, chip_y = theme.screen_pos(left_px + chip_plate_w / 2.0,
                                          top_px + chip_h / 2.0)
        self.chip_plate.position = (chip_x, chip_y, 0.02)
        label_x, label_y = theme.screen_pos(left_px + chip_pad,
                                            top_px + 8.0)
        self.chip_label.position = (label_x, label_y, 0.01)
        self.chip_label.relayout()
        body_x, body_y = theme.screen_pos(left_px + chip_col + chip_gap,
                                          top_px)
        self.body.position = (body_x, body_y, 0.0)
        self.body.relayout()
        self.height_px = max(chip_h, self.body.height_px)
        return self.height_px

    def set(self, label, body, rgb_tuple, body_width_px, chip_width_px):
        """Set the row's content and measure it (never shrinks the text)."""
        self.chip_label.max_width_px = max(40.0, chip_width_px)
        self.chip_label.set_text(label)
        self.chip_label.set_color(rgb_tuple)
        self.chip_rgb = tuple(rgb_tuple)
        self.body.max_width_px = body_width_px
        self.body.set_text(body)
        self.body.set_color(theme.COLORS['text_dim'])
        self.height_px = max(self.chip_label.height_px + 16.0,
                             self.body.height_px)
        return self.height_px

    def visible(self, show):
        self.root.visible = bool(show)


class HowToPlayScreen(MenuScreen):
    """The manual: four tabs, each a list of labelled paragraphs.

    Tab row at y=104 (four 160x44 tabs, 16px gaps, centred); the content panel
    runs from y=168 to 24px above the footer. Every paragraph is one row: a
    150px label chip and the body text at 17px. Content taller than the panel
    scrolls with the mouse wheel and the arrow keys, with a 6px cyan scrollbar
    and a 24px fade at the bottom edge.
    """

    name = 'howto'
    camera_view = 'menu'

    CYAN = theme.COLORS['cyan']
    PINK = theme.COLORS['pink']
    AMBER = theme.COLORS['amber']

    # (tab title, rows). Each row is (chip label, chip colour, body text).
    PAGES = (
        ('BASICS', (
            ('THE GAME', CYAN,
             'HELLS BALLS is bowling first: you throw a ball down a real '
             '18.29 m lane and the pins fall because the simulation was hit, '
             'not because a result was chosen.'),
            ('MOUSE', CYAN,
             'A and D move where you stand on the approach. The mouse\'s '
             'left/right position aims the shot at the arrows 4.6 m down the '
             'lane, and the aim marker on the lane shows it.'),
            ('THE THROW', CYAN,
             'Hold the left button, drag back and then stroke forward, and '
             'release. The fastest part of the stroke sets the speed; the '
             'direction of the stroke bends the release (left or right) and '
             'its sideways speed adds hook, so the ball curves.'),
            ('WEBCAM', PINK,
             'stand so your upper body is in view, hold your arms down until '
             'the game says READY, then swing your arm forward and up. TAB or '
             '2 switches to the webcam, 1 switches back to the mouse.'),
            ('KEYS', AMBER,
             'ESC pauses. R re-stands the rack before a throw. H shows or '
             'hides the physics readout.'),
        )),
        ('MODES', (
            ('CLASSIC BOWLING', CYAN,
             'ten frames, standard scoring, strikes and spares with the '
             'correct bonus rolls.'),
            ('PHYSICS TRIVIA', CYAN,
             'a knowledge test: answer a concept question to earn a throw at a '
             'full rack; a wrong answer costs that throw and explains the idea. '
             'The ball itself is thrown normally - this mode tests '
             'understanding, not calculation.'),
            ('EQUATION CHALLENGE', CYAN,
             'an interactive physics problem: a real leave on the deck, the '
             'variables, the governing equation and one value to work out - '
             'hook spin, speed, angle or torque. Bowl it and watch the '
             'simulation curve the ball; tune the value until the pin falls. '
             'Unlimited attempts, every result measured.'),
            ('LOCAL MULTIPLAYER', CYAN,
             'two to four people share the computer and alternate frames.'),
            ('PLAYER VS BOT', CYAN,
             'the bot picks its own line, speed and hook and bowls through the '
             'same physics you do. Three difficulties.'),
            ('BOWLRUSH', CYAN,
             'timed match, fresh rack every throw, most pins wins.'),
        )),
        ('SCORING', (
            ('STRIKES AND SPARES', CYAN,
             'A strike (10 on the first ball) scores 10 plus your next two '
             'rolls. A spare (10 over two balls) scores 10 plus your next '
             'roll. Otherwise the frame scores what you knocked down.'),
            ('THE SCORECARD', CYAN,
             'Because a strike borrows the next two rolls, its frame score '
             'cannot be written down yet - but the scorecard stamps the X '
             'straight away, so the strike still reads as counted. In '
             'multiplayer the player strip highlights whoever is up, and each '
             'player\'s chip shows their own pins.'),
            ('TENTH FRAME', CYAN,
             'The tenth frame gives you bonus balls for a strike or a spare, '
             'and the rack resets when a bonus ball is earned.'),
            ('TURN ORDER', CYAN,
             'you keep bowling until your frame is finished, then the next '
             'player bowls their frame. In BowlRush players alternate every '
             'throw.'),
            ('TRIVIA AND EQUATIONS', CYAN,
             'score total pins knocked down: every correct answer earns one '
             'throw at a fresh rack.'),
        )),
        ('PHYSICS', (
            ('THE BALL', CYAN,
             'The ball is a 6 kg solid sphere whose release conditions - '
             'position, speed, launch angle and hook spin - go into a '
             'fixed-substep rigid-body simulation.'),
            ('ROLLING', CYAN,
             'a = mu_r g opposes the motion (mu_r = 0.020). While the contact '
             'point slips, kinetic friction acts against the slip; a hook '
             'release makes that slip sideways, which is what bends the path. '
             'Once the ball rolls without slipping, omega = v / R.'),
            ('THE PINS', CYAN,
             'Pins are rods with a belly: they topple about their centre, skid '
             'on the deck, hit each other and rebound off the kickbacks. '
             'Nothing decides a pin count in advance.'),
            ('THE LAB', CYAN,
             'The PHYSICS LAB (main menu) replays a single throw through the '
             'same simulation. Its numbers update live, and clicking any row '
             'opens the equation with the current values substituted.'),
        )),
    )

    def build(self):
        super().build()
        self.make_backdrop()
        self.make_header('BASICS')

        sizes = theme.SIZES
        # --- tab row --------------------------------------------------------
        self.tab_buttons = []
        self.tabs = []
        for index, (title, _rows) in enumerate(self.PAGES):
            x = 640 + (index - (len(self.PAGES) - 1) / 2.0) * (
                sizes['tab_w'] + sizes['tab_gap'])
            tab = {'x': x, 'title': title,
                   'label': theme.TextSprite(
                       self.root, title, size_px=sizes['tab_font'],
                       rgb_tuple=theme.COLORS['text_dim'],
                       tracking=sizes['tab_tracking'],
                       position=theme.screen_pos(x, sizes['tab_y']
                                                 + sizes['tab_h'] / 2.0),
                       z=theme.CONTENT_Z),
                   'underline': Entity(parent=self.root, model='quad',
                                       position=theme.screen_pos(
                                           x, sizes['tab_y'] + sizes['tab_h']
                                           + sizes['tab_underline'] / 2.0),
                                       scale=(theme.px(sizes['tab_w']),
                                              theme.px(
                                                  sizes['tab_underline'])),
                                       texture=gradient_bar_texture(
                                           theme.COLORS['cyan'],
                                           theme.COLORS['cyan'],
                                           width=160, height=3, glow=8),
                                       color=theme.rgba(theme.COLORS['cyan'],
                                                        1.0),
                                       shader=unlit_shader),
                   'rect': (x - sizes['tab_w'] / 2.0,
                            sizes['tab_y'], sizes['tab_w'], sizes['tab_h'])}
            self.tab_buttons.append(tab)
            self.tabs.append(tab)

        # --- content panel ---------------------------------------------------
        footer_top = 720 - sizes['nav_bottom'] - sizes['nav_h']
        self.panel_left = sizes['howto_x']
        self.panel_top = sizes['howto_y']
        self.panel_width = sizes['howto_w']
        self.panel_bottom = footer_top - 24.0
        self.panel_height = self.panel_bottom - self.panel_top
        self.panel = theme.panel_plate(self.root, self.panel_width,
                                        self.panel_height, z=theme.PANEL_Z)
        self.panel.position = theme.screen_pos(
            self.panel_left + self.panel_width / 2.0,
            self.panel_top + self.panel_height / 2.0) + (theme.PANEL_Z,)

        pad = theme.LAYOUT['pad']
        self.view_left = self.panel_left + pad
        self.view_top = self.panel_top + pad
        self.view_right = self.panel_left + self.panel_width - pad
        self.view_bottom = self.panel_bottom - pad
        self.chip_col = sizes['howto_chip_col']
        self.body_left = self.view_left + self.chip_col + 16.0
        self.body_width = self.view_right - self.body_left

        self.rows = [HelpRow(self.root) for _ in range(8)]

        # The 24px fade at the bottom edge of the panel (in front of the text).
        fade = Entity(parent=self.root, model='quad',
                      position=theme.screen_pos(
                          self.panel_left + self.panel_width / 2.0,
                          self.panel_bottom - sizes['howto_fade'] / 2.0)
                      + (theme.CONTENT_Z - 0.02,),
                      texture=vertical_fade_texture(theme.COLORS['panel'],
                                                    alpha=0.98, height=64),
                      color=color.white, shader=unlit_shader)
        fade.scale = (theme.px(self.panel_width),
                      theme.px(sizes['howto_fade']))
        self.fade = fade

        # The 6px cyan scrollbar, drawn only when the content scrolls.
        self.scrollbar = Entity(parent=self.root, model='quad',
                                color=theme.rgba(theme.COLORS['cyan'], 0.85),
                                shader=unlit_shader)
        self.scrollbar_track = Entity(
            parent=self.root, model='quad',
            color=theme.rgba(theme.COLORS['hairline'], 0.6),
            shader=unlit_shader)
        self.scrollbar.visible = False
        self.scrollbar_track.visible = False

        # --- footer ----------------------------------------------------------
        self.back_button = theme.ArcadeButton(
            self.root, 'BACK', size_px=(sizes['nav_w'], sizes['nav_h']),
            variant='ghost', accent=theme.COLORS['text_dim'],
            font_px=sizes['nav_font'],
            on_click=lambda _b: self.app.go_to_menu())
        self.prev_button = theme.ArcadeButton(
            self.root, 'PREVIOUS', size_px=(sizes['tab_w'], sizes['nav_h']),
            variant='ghost', accent=theme.COLORS['text_dim'],
            font_px=sizes['nav_font'],
            on_click=lambda _b: self._flip(-1))
        self.next_button = theme.ArcadeButton(
            self.root, 'NEXT', size_px=(sizes['tab_w'], sizes['nav_h']),
            variant='secondary', accent=theme.COLORS['cyan'],
            font_px=sizes['nav_font'],
            on_click=lambda _b: self._next())

        for button in (self.back_button, self.prev_button, self.next_button):
            button.relayout()
        self._layout_footer()

        self.widgets = [self.next_button, self.prev_button, self.back_button]
        self.hovers = list(self.widgets)
        self.buttons = list(self.widgets)
        self.page = 0
        self.scroll = 0.0
        self._stops = [0.0]
        self._content_height = 0.0
        self._rows_cache = {}

    # --------------------------------------------------------------- layout
    def _layout_footer(self):
        sizes = theme.SIZES
        y = 720 - sizes['nav_bottom'] - sizes['nav_h'] / 2.0
        theme.place(self.back_button, sizes['howto_x'] + sizes['nav_w'] / 2.0,
                    y)
        right = 1184.0
        theme.place(self.next_button, right - sizes['tab_w'] / 2.0, y)
        theme.place(self.prev_button,
                    right - sizes['tab_w'] - sizes['tab_gap']
                    - sizes['tab_w'] / 2.0, y)
        self.next_button.relayout()
        self.prev_button.relayout()
        self.back_button.relayout()

    def on_show(self, **kwargs):
        self.page = 0
        self.scroll = 0.0
        self._render(force=True)

    def _flip(self, step):
        self.page = (self.page + step) % len(self.PAGES)
        self.scroll = 0.0
        self.app.play('menu_move')
        self._render(force=True)

    def _next(self):
        if self.page >= len(self.PAGES) - 1:
            self.app.play('menu_back')
            self.app.go_to_menu()
            return
        self._flip(1)

    # ------------------------------------------------------------------ render
    def _build_page(self, page):
        """Measure every row of a page; returns the row data and total height."""
        title, rows = self.PAGES[page]
        chip_pad = 14.0
        data = []
        total = 0.0
        for index, (label, rgb_tuple, body) in enumerate(rows):
            if index < len(self.rows):
                row = self.rows[index]
            else:
                row = HelpRow(self.root)
                self.rows.append(row)
            height = row.set(label, body, rgb_tuple, self.body_width,
                             self.chip_col - 2 * chip_pad)
            entry = {'row': row, 'label': label, 'rgb': rgb_tuple,
                     'body': body, 'height': height}
            data.append(entry)
            total += height
        total += max(0, len(data) - 1) * theme.SIZES['howto_row_gap']
        return title, data, total

    def _render(self, force=False):
        title, data, total = self._build_page(self.page)
        self.title.set_text(title)
        self._content_height = total
        view_h = self.view_bottom - self.view_top
        max_scroll = max(0.0, total - view_h)
        # Scroll stops: the top of each row, then the clamped bottom.
        stops = [0.0]
        offset = 0.0
        for index, entry in enumerate(data):
            if index:
                offset += entry['height'] + theme.SIZES['howto_row_gap']
            if 0.0 < offset <= max_scroll:
                stops.append(offset)
        if max_scroll > 0.0 and stops[-1] < max_scroll:
            stops.append(max_scroll)
        self._stops = stops
        self.scroll = max(0.0, min(self.scroll, max_scroll))

        for index, entry in enumerate(data):
            row = entry['row']
            row.visible(True)
            entry['top'] = 0.0
        # Lay the rows out from the content top, then hide what is outside.
        y = self.view_top - self.scroll
        for index, entry in enumerate(data):
            entry['top'] = y
            visible = (y >= self.view_top - 0.5
                       and y + entry['height'] <= self.view_bottom + 0.5)
            entry['row'].visible(visible)
            if visible:
                entry['row'].place(self.view_left, y,
                                   chip_col=self.chip_col)
            y += entry['height'] + theme.SIZES['howto_row_gap']
        for index in range(len(data), len(self.rows)):
            self.rows[index].visible(False)
        self._update_scrollbar(max_scroll)
        self._update_tabs()
        self._update_footer()

    def _update_tabs(self):
        for index, tab in enumerate(self.tabs):
            active = index == self.page
            tab['label'].set_color(theme.COLORS['cyan'] if active
                                   else theme.COLORS['text_dim'])
            tab['underline'].visible = active

    def _update_footer(self):
        last = self.page >= len(self.PAGES) - 1
        first = self.page <= 0
        self.next_button.set_label('DONE' if last else 'NEXT')
        self.prev_button.disabled = first
        self.prev_button._sync()
        self.next_button.relayout()
        self.prev_button.relayout()

    def _update_scrollbar(self, max_scroll):
        view_h = self.view_bottom - self.view_top
        show = max_scroll > 0.5
        self.scrollbar.visible = show
        self.scrollbar_track.visible = show
        if not show:
            return
        width = theme.SIZES['howto_scroll_w']
        x = self.panel_left + self.panel_width - 10.0 - width / 2.0
        track_h = view_h
        self.scrollbar_track.scale = (theme.px(width), theme.px(track_h))
        self.scrollbar_track.position = theme.screen_pos(
            x, self.view_top + track_h / 2.0) + (theme.CONTENT_Z,)
        fraction = min(1.0, view_h / max(1e-6, self._content_height))
        thumb_h = max(28.0, track_h * fraction)
        travel = track_h - thumb_h
        ratio = self.scroll / max(1e-6, max_scroll)
        top = self.view_top + travel * ratio
        self.scrollbar.scale = (theme.px(width), theme.px(thumb_h))
        self.scrollbar.position = theme.screen_pos(
            x, top + thumb_h / 2.0) + (theme.CONTENT_Z - 0.01,)

    # ------------------------------------------------------------------ scroll
    def scroll_by(self, steps):
        if not self._stops:
            return
        view_h = self.view_bottom - self.view_top
        max_scroll = max(0.0, self._content_height - view_h)
        if max_scroll <= 0.0:
            return
        index = _nearest_stop(self._stops, self.scroll)
        index = max(0, min(len(self._stops) - 1, index + steps))
        self.scroll = self._stops[index]
        self._render()

    def scroll_to_bottom(self):
        view_h = self.view_bottom - self.view_top
        self.scroll = max(0.0, self._content_height - view_h)
        self._render()

    # ------------------------------------------------------------------- input
    def on_key(self, key):
        if key in ('right arrow', 'd'):
            self._flip(1)
            return True
        if key in ('left arrow', 'a'):
            self._flip(-1)
            return True
        if key in ('down arrow', 'down', 'scroll down'):
            self.scroll_by(1)
            return True
        if key in ('up arrow', 'up', 'scroll up'):
            self.scroll_by(-1)
            return True
        if key in ('enter', 'return'):
            self._next()
            return True
        if key in ('escape', 'space'):
            self.app.go_to_menu()
            return True
        return False

    def on_click(self, x, y):
        px_x, px_y = _ui_to_px_x(x), _ui_to_px_y(y)
        for index, tab in enumerate(self.tabs):
            rect = tab['rect']
            if (rect[0] <= px_x <= rect[0] + rect[2]
                    and rect[1] <= px_y <= rect[1] + rect[3]):
                if index != self.page:
                    self.page = index
                    self.scroll = 0.0
                    self.app.play('menu_move')
                    self._render(force=True)
                return True
        return super().on_click(x, y)


def _ui_to_px_x(x):
    return 640.0 + x * theme.REFERENCE_HEIGHT / max(theme.ui_scale(), 1e-6)


def _ui_to_px_y(y):
    return 360.0 - y * theme.REFERENCE_HEIGHT / max(theme.ui_scale(), 1e-6)


def _nearest_stop(stops, value):
    best = 0
    for index, stop in enumerate(stops):
        if stop <= value + 0.5:
            best = index
    return best


class SettingsScreen(MenuScreen):
    """Live settings in two calm panels: controls, and audio/display.

    Both panels are 560 wide with a 32px gap and start at y=104, with 24px of
    padding; each row is a 52px (64px with helper text) card with a 1px
    #3A3270 border and 10px gaps, and every label/value pair shares one centre
    line. The note at the bottom is centred on the same line as BACK.
    """

    name = 'settings'
    camera_view = 'menu'

    def build(self):
        super().build()
        self.make_backdrop()
        self.make_header('SETTINGS')

        sizes = theme.SIZES
        self.panel_w = sizes['settings_w']
        self.panel_gap = sizes['settings_gap']
        self.panel_top = sizes['settings_y']
        self.left_panel = theme.panel_plate(self.root, self.panel_w, 100.0)
        self.right_panel = theme.panel_plate(self.root, self.panel_w, 100.0)
        self.heading_left = theme.TextSprite(
            self.root, 'CONTROLS AND GAMEPLAY', size_px=sizes['settings_heading'],
            rgb_tuple=theme.COLORS['cyan'], bold=True,
            tracking=sizes['settings_head_track'], anchor='lefttop',
            z=theme.CONTENT_Z)
        self.heading_right = theme.TextSprite(
            self.root, 'AUDIO AND DISPLAY', size_px=sizes['settings_heading'],
            rgb_tuple=theme.COLORS['cyan'], bold=True,
            tracking=sizes['settings_head_track'], anchor='lefttop',
            z=theme.CONTENT_Z)
        self.rule_left = Entity(parent=self.root, model='quad',
                                color=theme.rgba(theme.COLORS['hairline'], 1.0),
                                shader=unlit_shader)
        self.rule_right = Entity(parent=self.root, model='quad',
                                 color=theme.rgba(theme.COLORS['hairline'], 1.0),
                                 shader=unlit_shader)

        settings = self.app.settings
        self.input_stepper = theme.Stepper(
            self.root, 'INPUT METHOD', settings.get('input_mode').upper(),
            on_step=self._cycle_input, accent=theme.COLORS['cyan'],
            value_colour=theme.COLORS['cyan'])
        self.arm_stepper = theme.Stepper(
            self.root, 'THROWING ARM', settings.get('throwing_arm').upper(),
            on_step=self._cycle_arm, accent=theme.COLORS['cyan'],
            value_colour=theme.COLORS['cyan'])
        self.camera_stepper = theme.Stepper(
            self.root, 'CAMERA INDEX', self._camera_text(),
            on_step=self._cycle_camera, accent=theme.COLORS['cyan'],
            value_colour=theme.COLORS['cyan'])
        self.hand_toggle = theme.Toggle(
            self.root, 'HAND MENU NAVIGATION',
            self._onoff(settings.get('hand_menu_navigation')),
            on_flip=self._flip_hand, accent=theme.COLORS['cyan'],
            helper='Experimental; needs the webcam')
        self.readout_toggle = theme.Toggle(
            self.root, 'SHOW PHYSICS READOUT',
            self._onoff(settings.get('show_physics_readout')),
            on_flip=self._flip_readout, accent=theme.COLORS['cyan'],
            helper='H shows it while you play')
        self.motion_toggle = theme.Toggle(
            self.root, 'REDUCE MOTION',
            self._onoff(settings.get('reduce_motion')),
            on_flip=self._flip_motion, accent=theme.COLORS['cyan'],
            helper='No shake, flashes or pulsing effects')

        self.master_slider = theme.Slider(
            self.root, 'MASTER VOLUME', settings.get('master_volume'),
            on_change=self._set_master)
        self.sfx_slider = theme.Slider(
            self.root, 'SFX VOLUME', settings.get('sfx_volume'),
            on_change=self._set_sfx)
        self.music_slider = theme.Slider(
            self.root, 'MUSIC VOLUME', settings.get('music_volume'),
            on_change=self._set_music)
        self.mute_toggle = theme.Toggle(
            self.root, 'MUTE', self._onoff(settings.get('muted')),
            on_flip=self._flip_mute, accent=theme.COLORS['cyan'])

        self.note = theme.TextSprite(
            self.root, 'Changes are saved automatically',
            size_px=sizes['settings_note'],
            rgb_tuple=theme.COLORS['text_dim'], z=theme.CONTENT_Z)
        self.back_button = theme.MenuButton(
            self.root, 'BACK', scale=(0.28, 0.078),
            font_px=sizes['nav_font'],
            rgb_tuple=theme.COLORS['text_dim'],
            on_click=lambda _b: self._back())

        self.left_rows = [self.input_stepper, self.arm_stepper,
                          self.camera_stepper, self.hand_toggle,
                          self.readout_toggle, self.motion_toggle]
        self.right_rows = [self.master_slider, self.sfx_slider,
                           self.music_slider, self.mute_toggle]
        self.widgets = ([self.back_button] + self.left_rows + self.right_rows)
        self.hovers = list(self.widgets)
        self.buttons = [self.back_button]
        self._layout_key = None
        self._layout()

    # ------------------------------------------------------------------ layout
    def _window_key(self):
        try:
            return (round(window.aspect_ratio, 4), tuple(window.size))
        except Exception:                              # pragma: no cover
            return None

    def _layout(self):
        sizes = theme.SIZES
        self._layout_key = self._window_key()
        pad = sizes['settings_pad']
        gap = self.panel_gap
        total = self.panel_w * 2 + gap
        left_x = 640 - total / 2.0
        right_x = left_x + self.panel_w + gap
        self.left_x, self.right_x = left_x, right_x
        self.title.place()
        self.title.relayout()

        inner = self.panel_w - 2 * pad
        button_top = 720 - sizes['nav_bottom'] - sizes['nav_h']
        bottom = button_top - 24.0
        available = bottom - self.panel_top - 2 * pad
        # Row heights: 52px, 64px with a helper; squeeze to 48px only if the
        # taller stack genuinely does not fit (the gaps never go below 10px).
        for row_h, help_h in ((sizes['settings_row_h'],
                               sizes['settings_row_h_help']), (48.0, 60.0)):
            left_h = self._stack_height(self.left_rows, row_h, help_h)
            heading_h = (self.heading_left.height_px
                         + sizes['settings_rule_gap'] + 1.0
                         + sizes['settings_first_gap'])
            if heading_h + left_h <= available:
                break
        right_h = self._stack_height(self.right_rows, row_h, help_h)
        panel_h = (heading_h + max(left_h, right_h)
                   + 2 * pad)
        panel_h = min(panel_h, bottom - self.panel_top)
        self.panel_h = panel_h
        for panel, x in ((self.left_panel, left_x), (self.right_panel, right_x)):
            panel.scale = (theme.px(self.panel_w), theme.px(panel_h))
            panel.texture = panel_texture(
                self.panel_w, panel_h, sizes['panel_radius'],
                fill_rgb=theme.COLORS['panel'],
                fill_alpha=theme.ALPHA['panel_solid'],
                border_left_rgb=theme.COLORS['cyan'],
                border_right_rgb=theme.COLORS['pink'], border_alpha=0.60)
            panel.position = theme.screen_pos(x + self.panel_w / 2.0,
                                              self.panel_top + panel_h / 2.0) \
                + (theme.PANEL_Z,)

        for heading, rule, x in ((self.heading_left, self.rule_left, left_x),
                                 (self.heading_right, self.rule_right,
                                  right_x)):
            theme.place(heading, x + pad, self.panel_top + pad)
            heading.relayout()
            rule.scale = (theme.px(inner), theme.px(1))
            theme.place(rule, x + pad + inner / 2.0,
                        self.panel_top + pad + heading.height_px
                        + sizes['settings_rule_gap'] + 0.5)

        first_y = (self.panel_top + pad + heading_h)
        self._place_stack(self.left_rows, left_x + pad, first_y, inner, row_h,
                          help_h, gap_px=sizes['settings_row_gap'])
        self._place_stack(self.right_rows, right_x + pad, first_y, inner,
                          row_h, help_h, gap_px=sizes['settings_row_gap'])

        y = 720 - sizes['nav_bottom'] - sizes['nav_h'] / 2.0
        theme.place(self.back_button, 64 + self.back_button.size[0] / 2.0, y)
        theme.place(self.note, 640, y)
        self.note.relayout()

    def _row_height(self, widget, row_h, help_h):
        return help_h if getattr(widget, 'helper', '') else row_h

    def _stack_height(self, rows, row_h, help_h):
        height = sum(self._row_height(row, row_h, help_h) for row in rows)
        return height + max(0, len(rows) - 1) * theme.SIZES['settings_row_gap']

    def _place_stack(self, rows, left, top, width, row_h, help_h, gap_px):
        y = top
        for row in rows:
            height = self._row_height(row, row_h, help_h)
            row.set_size_px((width, height))
            theme.place(row, left + width / 2.0, y + height / 2.0)
            y += height + gap_px

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def _onoff(value):
        return 'ON' if value else 'OFF'

    def _camera_text(self):
        index = self.app.settings.get('camera_index')
        return 'DEFAULT' if index is None else str(index)

    def _cycle_input(self, _direction):
        self.app.settings.cycle('input_mode', ('mouse', 'webcam'))
        self.input_stepper.set_value(self.app.settings.get('input_mode').upper())
        self.app.apply_settings()
        self._save()

    def _cycle_arm(self, _direction):
        self.app.settings.cycle('throwing_arm', ('auto', 'left', 'right'))
        self.arm_stepper.set_value(
            self.app.settings.get('throwing_arm').upper())
        self.app.apply_settings()
        self._save()

    def _cycle_camera(self, direction):
        options = [None, 0, 1, 2, 3]
        current = self.app.settings.get('camera_index')
        index = options.index(current) if current in options else 0
        self.app.settings['camera_index'] = options[(index + direction)
                                                    % len(options)]
        self.camera_stepper.set_value(self._camera_text())
        self.app.apply_settings()
        self._save()

    def _set_master(self, value):
        self.app.settings['master_volume'] = value
        self.app.apply_settings()
        self._save()

    def _set_sfx(self, value):
        self.app.settings['sfx_volume'] = value
        self.app.apply_settings()
        self._save()

    def _set_music(self, value):
        self.app.settings['music_volume'] = value
        self.app.apply_settings()
        self._save()

    def _flip_mute(self, _toggle):
        muted = not bool(self.app.settings.get('muted'))
        self.app.settings['muted'] = muted
        self.mute_toggle.set_value(self._onoff(muted))
        self.app.apply_settings()
        self._save()

    def _flip_hand(self, _toggle):
        value = not bool(self.app.settings.get('hand_menu_navigation'))
        self.app.settings['hand_menu_navigation'] = value
        self.hand_toggle.set_value(self._onoff(value))
        self.app.apply_settings()
        self._save()

    def _flip_readout(self, _toggle):
        value = not bool(self.app.settings.get('show_physics_readout'))
        self.app.settings['show_physics_readout'] = value
        self.readout_toggle.set_value(self._onoff(value))
        self._save()

    def _flip_motion(self, _toggle):
        value = not bool(self.app.settings.get('reduce_motion'))
        self.app.settings['reduce_motion'] = value
        self.motion_toggle.set_value(self._onoff(value))
        self.app.apply_settings()
        self._save()

    def _save(self):
        self.app.save_settings()

    def on_show(self, **kwargs):
        settings = self.app.settings
        self.input_stepper.set_value(settings.get('input_mode').upper())
        self.arm_stepper.set_value(settings.get('throwing_arm').upper())
        self.camera_stepper.set_value(self._camera_text())
        self.master_slider.set_value(settings.get('master_volume'))
        self.sfx_slider.set_value(settings.get('sfx_volume'))
        self.music_slider.set_value(settings.get('music_volume'))
        self.mute_toggle.set_value(self._onoff(settings.get('muted')))
        self.hand_toggle.set_value(self._onoff(
            settings.get('hand_menu_navigation')))
        self.readout_toggle.set_value(self._onoff(
            settings.get('show_physics_readout')))
        self.motion_toggle.set_value(self._onoff(
            settings.get('reduce_motion')))
        self._layout()

    def on_update(self, pointer_x, pointer_y):
        if self._window_key() != self._layout_key:
            self._layout()

    def _back(self):
        self.app.play('menu_select')
        self.app.save_settings()
        self.app.leave_settings()

    def on_key(self, key):
        if key in ('escape', 'enter', 'return'):
            self._back()
            return True
        if key == 'left arrow':
            self.master_slider.nudge(-0.05)
            return True
        if key == 'right arrow':
            self.master_slider.nudge(0.05)
            return True
        return False


def _wrap(text, width):
    """Kept for callers that used the old private helper."""
    return wrap_text(text, width)
