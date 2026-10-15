"""Interactive overlays for the play screen: pause, results and the turn
handoff banner.

Each overlay owns its entities, lays itself out from the window aspect ratio,
and exposes the same small surface so the play screen can drive it without
knowing which overlay it is:

* ``visible``           - whether it is on screen
* ``buttons``           - clickable :class:`ui.theme.MenuButton` list
* ``update_widgets(x, y, dt)`` - per-frame hover refresh
* ``click(x, y)``       - returns True when a button consumed the click
* ``move_selection(step)`` / ``activate()`` - keyboard navigation
"""
from ursina import Entity, Text, camera, color, window

from ui import theme
from ui.layout import fit_text, wrap_text


class Overlay:
    """Common behaviour: a centred panel with a title and menu buttons.

    The body text is laid out line by line (wrapped to the panel width) rather
    than as one shrunken block, so a five-line results table stays readable.
    ``animate_in`` is a hook the motion system sets (see :mod:`motion.director`)
    to play the panel's entrance; without it the overlay simply appears.
    """

    MAX_LINES = 12
    TOP_RESERVE = 0.0        # extra space under the heading (the final score)

    def __init__(self, title, width=0.62, height=0.40, accent=None,
                 backdrop=True, parent=None):
        self.accent = tuple(accent or theme.PALETTE['cyan'])
        self.root = Entity(parent=parent if parent is not None else camera.ui,
                           enabled=False)
        self.width = width
        self.height = height
        self.animate_in = None
        self.backdrop = None
        if backdrop:
            self.backdrop = Entity(parent=self.root, model='quad',
                                   position=(0, 0, theme.OVERLAY_Z + 0.06),
                                   color=theme.rgba(theme.PALETTE['ink'], 0.55))
        self.panel = Entity(parent=self.root, model='quad',
                            position=(0, 0, theme.OVERLAY_Z + 0.02),
                            color=theme.rgba(theme.PALETTE['panel'], 0.95))
        self.hairline = Entity(parent=self.root, model='quad',
                               position=(0, 0, theme.OVERLAY_Z + 0.01),
                               color=theme.rgba(self.accent, 0.9))
        self.heading = theme.glow_text(self.root, title, origin=(0, 0.5),
                                       scale=theme.TYPE['title'],
                                       rgb_tuple=theme.PALETTE['white'],
                                       glow=self.accent)
        self.body = Text(parent=self.root, text='', origin=(0, 0.5),
                         scale=theme.TYPE['body'], color=theme.rgb('grey'),
                         z=theme.OVERLAY_Z)
        self.body_lines = [
            Text(parent=self.root, text='', origin=(-0.5, 0.5),
                 scale=theme.TYPE['body'], color=theme.rgb('grey'),
                 z=theme.OVERLAY_Z)
            for _ in range(self.MAX_LINES)
        ]
        self.buttons = []
        self.selected = 0

    # ------------------------------------------------------------------ state
    @property
    def visible(self):
        return self.root.enabled

    def hide(self):
        self.root.enabled = False

    def show(self):
        self.root.enabled = True
        if callable(self.animate_in):
            # The motion system plays the panel in (scale from 0.95, the
            # backdrop dimming over 250 ms, the scoreboard expanding ...).
            self.animate_in(self)

    # ------------------------------------------------------------------ layout
    def layout(self):
        """Lay the heading, body lines and buttons out inside the panel.

        Top to bottom: heading, the wrapped body lines, then the button stack
        pinned to the bottom of the panel. Everything is measured, so the body
        can never be drawn over a button (which is what made the first pause
        menu unreadable) and a long line wraps instead of shrinking to nothing.
        """
        aspect = window.aspect_ratio
        width = min(self.width, aspect - 0.20)
        height = self.height
        self.panel.scale = (width, height)
        self.panel.position = (0, 0.0, theme.OVERLAY_Z + 0.02)
        self.hairline.scale = (width, 0.005)
        self.hairline.position = (0, height / 2.0 - 0.0025,
                                  theme.OVERLAY_Z + 0.01)
        if self.backdrop is not None:
            self.backdrop.scale = (aspect, 1.0)
            self.backdrop.position = (0, 0, theme.OVERLAY_Z + 0.06)

        top = height / 2.0
        self.heading.position = (0, top - 0.055, theme.OVERLAY_Z - 0.01)

        # Buttons pinned to the bottom of the panel.
        count = len(self.buttons)
        button_height = 0.056
        gap = 0.014
        total = count * button_height + max(0, count - 1) * gap
        bottom = -height / 2.0 + 0.028
        cursor = bottom + total - button_height / 2.0
        for button in self.buttons:
            button.resize((width * 0.76, button_height))
            button.position = (0, cursor, theme.OVERLAY_Z - 0.02)
            cursor -= button_height + gap

        # Body lines fill the space between the heading and the buttons.
        char_width = max(24, int((width - 0.07) / 0.0082))
        wrapped = []
        for raw in self.body_text().split('\n'):
            wrapped.extend(wrap_text(raw, char_width) if raw.strip() else [''])
        body_top = top - 0.125 - self.TOP_RESERVE
        body_bottom = bottom + total + 0.030
        available = max(0.06, body_top - body_bottom)
        # Never let the text run into the buttons: cap the lines so each one
        # gets at least a readable leading, whatever the panel height is.
        max_lines = max(1, int(available / 0.030))
        count_lines = min(len(wrapped), len(self.body_lines), max_lines)
        leading = min(0.040, available / max(1, count_lines))
        for index, entity in enumerate(self.body_lines):
            if index < count_lines:
                text = wrapped[index]
                entity.text = text
                scale = theme.TYPE['body'] if index == 0 else theme.TYPE['small']
                fit_text(entity, text, scale, width - 0.07, min_scale=0.44)
                entity.position = (-width / 2.0 + 0.045,
                                   body_top - index * leading,
                                   theme.OVERLAY_Z)
                entity.visible = True
            else:
                entity.visible = False
        self.body.visible = False

    def body_text(self):
        return ''

    def layout_buttons(self, width):
        """Kept for callers that only want the button stack re-laid out."""
        self.layout()

    # ------------------------------------------------------------------ input
    def update_widgets(self, x, y, dt):
        for button in self.buttons:
            button.update_widget(x, y, dt)

    def click(self, x, y):
        for button in self.buttons:
            if button.click(x, y):
                return True
        return False

    def move_selection(self, step):
        if not self.buttons:
            return
        count = len(self.buttons)
        for _ in range(count):
            self.selected = (self.selected + step) % count
            if self.buttons[self.selected].enabled:
                break
        self.refresh()

    def refresh(self):
        for index, button in enumerate(self.buttons):
            button.set_selected(index == self.selected)

    def activate(self):
        if not self.buttons:
            return False
        button = self.buttons[self.selected % len(self.buttons)]
        if button.enabled:
            button.click(button.position[0], button.position[1])
            return True
        return False


class PauseOverlay(Overlay):
    """Esc pause menu: resume, restart the match, settings, or back to menu.

    A compact panel with just the title and the buttons: the "simulation is
    frozen" paragraph said what the word PAUSED already says.
    """

    def __init__(self, on_resume, on_restart, on_menu, on_settings=None,
                 parent=None):
        super().__init__('PAUSED', width=0.46, height=0.40,
                         accent=theme.PALETTE['amber'], parent=parent)
        self.on_resume = on_resume
        self.buttons = [
            theme.MenuButton(self.root, 'RESUME', rgb_tuple=theme.PALETTE['green'],
                             on_click=lambda _b: on_resume()),
            theme.MenuButton(self.root, 'RESTART MATCH',
                             rgb_tuple=theme.PALETTE['cyan'],
                             on_click=lambda _b: on_restart()),
        ]
        if on_settings is not None:
            self.buttons.append(theme.MenuButton(
                self.root, 'SETTINGS', rgb_tuple=theme.PALETTE['magenta'],
                on_click=lambda _b: on_settings()))
        self.buttons.append(theme.MenuButton(
            self.root, 'QUIT TO MENU', rgb_tuple=theme.PALETTE['red'],
            on_click=lambda _b: on_menu()))

    def show(self):
        self.root.enabled = True
        self.selected = 0
        self.refresh()
        self.layout()
        if callable(self.animate_in):
            self.animate_in(self)


class ResultsOverlay(Overlay):
    """End-of-match results with a rematch and a way back to the menu.

    The final score appears large above the table and counts up from the
    start of the match (:meth:`show` receives the values), while the panel
    itself expands out of the top bar's score block - the motion hook set by
    :class:`motion.director.MotionDirector`.

    An optional **award banner** (``NEW PERSONAL BEST!`` / ``PERFECT GAME!`` /
    ``YOU WIN!``) sits between the total and the table; the director sets it
    through :meth:`set_achievement` and animates it in.
    """

    def __init__(self, on_rematch, on_menu, on_lab=None, parent=None):
        super().__init__('RESULTS', width=0.74, height=0.62,
                         accent=theme.PALETTE['amber'], parent=parent)
        self.lines = []
        self.total = None
        self.show_total = False
        self.award_text = ''
        self.award_sub = ''
        self.total_caption = Text(parent=self.root, text='FINAL SCORE',
                                  origin=(0, 0.5), scale=theme.TYPE['small'],
                                  color=theme.rgb('grey'), z=theme.OVERLAY_Z)
        self.total_glow = Text(parent=self.root, text='', origin=(0, 0.5),
                               scale=theme.TYPE['hero'],
                               color=color.rgba32(96, 226, 255, 90),
                               z=theme.OVERLAY_Z + 0.01)
        self.total_score = Text(parent=self.root, text='', origin=(0, 0.5),
                                scale=theme.TYPE['hero'],
                                color=theme.rgb('amber'),
                                z=theme.OVERLAY_Z)
        # The award banner (glow text: a crisp line over four halo copies).
        self.achievement = theme.glow_text(
            self.root, '', origin=(0, 0.5), scale=theme.TYPE['title'],
            rgb_tuple=theme.PALETTE['amber'], glow=theme.PALETTE['cyan'],
            glow_alpha=0.0)
        self.achievement.position = (0, 0.0, theme.OVERLAY_Z - 0.01)
        self.achievement_sub = Text(parent=self.root, text='', origin=(0, 0.5),
                                    scale=theme.TYPE['small'],
                                    color=theme.rgb('grey'),
                                    z=theme.OVERLAY_Z)
        self.buttons = [
            theme.MenuButton(self.root, 'REMATCH',
                             rgb_tuple=theme.PALETTE['green'],
                             on_click=lambda _b: on_rematch()),
        ]
        if on_lab is not None:
            self.buttons.append(theme.MenuButton(
                self.root, 'OPEN PHYSICS LAB', rgb_tuple=theme.PALETTE['cyan'],
                on_click=lambda _b: on_lab()))
        self.buttons.append(theme.MenuButton(
            self.root, 'MAIN MENU', rgb_tuple=theme.PALETTE['magenta'],
            on_click=lambda _b: on_menu()))

    def set_lines(self, lines):
        self.lines = list(lines)

    def set_achievement(self, title, subtitle='', rgb=None, glow=None):
        """Set (or clear, with ``title=''``) the award banner."""
        self.award_text = str(title or '')
        self.award_sub = str(subtitle or '')
        self.achievement.set_text(self.award_text)
        if self.award_text:
            theme.set_glow_colours(self.achievement, rgb, glow)
        else:
            self.achievement.main.color = theme.rgba(theme.PALETTE['amber'], 0.0)
            for copy in self.achievement.copies:
                copy.color = theme.rgba(theme.PALETTE['cyan'], 0.0)
        self.achievement_sub.text = self.award_sub
        self.achievement_sub.visible = bool(self.award_sub)

    def set_total(self, total, start_value=None):
        """Show (and later count) the final score above the table."""
        self.total = total
        self.show_total = total is not None
        # Reserve the total's block, plus the award banner when there is one.
        reserve = 0.115 + (0.062 if self.award_text else 0.0)
        self.TOP_RESERVE = reserve if self.show_total else 0.0
        start = total if start_value is None else start_value
        self.total_score.text = str(start)
        self.total_glow.text = str(start)
        self.total_caption.visible = self.show_total
        self.total_score.visible = self.show_total
        self.total_glow.visible = self.show_total

    def body_text(self):
        return '\n'.join(self.lines)

    def layout(self):
        super().layout()
        if not self.show_total:
            return
        top = self.height / 2.0
        self.total_caption.position = (0, top - 0.105, theme.OVERLAY_Z)
        self.total_score.position = (0, top - 0.170, theme.OVERLAY_Z)
        self.total_glow.position = (0, top - 0.170, theme.OVERLAY_Z + 0.01)
        self.achievement.position = (0, top - 0.232, theme.OVERLAY_Z - 0.01)
        self.achievement_sub.position = (0, top - 0.266, theme.OVERLAY_Z)

    def show(self, total=None, start_from=None):
        # Enable, lay out, and *then* play the entrance: the animation is a
        # perturbation of the final layout, so it must run after it.
        self.root.enabled = True
        self.set_total(total, start_value=start_from)
        self.selected = 0
        self.refresh()
        self.layout()
        if callable(self.animate_in):
            self.animate_in(self)

    def hide(self):
        self.total = None
        self.show_total = False
        # Clear the banner as well: the next match must not open with the last
        # one's award still written on the panel.
        self.award_text = ''
        self.award_sub = ''
        self.set_achievement('')
        super().hide()


class HandoffBanner:
    """The between-players panel: who is up, and how to take over.

    It is deliberately not a menu: the play screen keeps control, and this
    only reports the handoff state (with a progress bar for the webcam's
    ready-pose confirmation).
    """

    def __init__(self, parent=None):
        self.root = Entity(parent=parent if parent is not None else camera.ui,
                           enabled=False)
        self.backdrop = Entity(parent=self.root, model='quad',
                               position=(0, 0, theme.OVERLAY_Z + 0.06),
                               color=theme.rgba(theme.PALETTE['ink'], 0.45))
        self.panel = Entity(parent=self.root, model='quad',
                            position=(0, 0, theme.OVERLAY_Z + 0.02),
                            color=theme.rgba(theme.PALETTE['panel'], 0.94))
        self.hairline = Entity(parent=self.root, model='quad',
                               position=(0, 0, theme.OVERLAY_Z + 0.01),
                               color=theme.rgba(theme.PALETTE['cyan'], 0.9))
        self.heading = theme.glow_text(self.root, 'NEXT BOWLER',
                                       origin=(0, 0.5), scale=1.35,
                                       glow=theme.PALETTE['cyan'])
        self.name = theme.glow_text(self.root, 'PLAYER 2', origin=(0, 0.5),
                                    scale=1.7, glow=theme.PALETTE['amber'])
        self.instructions = Text(parent=self.root, text='', origin=(0, 0.5),
                                 scale=0.78, color=theme.rgb('grey'),
                                 z=theme.OVERLAY_Z)
        self.status = Text(parent=self.root, text='', origin=(0, 0.5),
                           scale=0.74, color=theme.rgb('white'),
                           z=theme.OVERLAY_Z)
        self._track = Entity(parent=self.root, model='quad',
                             color=theme.rgba(theme.PALETTE['panel_dark'], 0.9))
        self._fill = Entity(parent=self._track, model='quad', origin=(-0.5, 0),
                            position=(-0.5, 0),
                            color=theme.rgba(theme.PALETTE['green'], 0.85))

    @property
    def visible(self):
        return self.root.enabled

    def hide(self):
        self.root.enabled = False

    def show(self):
        self.root.enabled = True

    def update(self, name, lines, progress, accent=None, colour=None):
        self.heading.set_text('NEXT BOWLER')
        self.name.set_text(name)
        self.name.main.color = theme.rgba(accent or theme.PALETTE['amber'], 1.0)
        self.instructions.text = '\n'.join(lines)
        width = min(0.62, window.aspect_ratio - 0.2)
        height = 0.30
        self.panel.scale = (width, height)
        self.panel.position = (0, 0.10, theme.OVERLAY_Z + 0.02)
        self.hairline.scale = (width, 0.005)
        self.hairline.position = (0, 0.10 + height / 2.0 - 0.0025,
                                  theme.OVERLAY_Z + 0.01)
        self.backdrop.scale = (window.aspect_ratio, 1.0)
        self.backdrop.position = (0, 0, theme.OVERLAY_Z + 0.06)
        self.heading.position = (0, 0.10 + height / 2.0 - 0.05,
                                 theme.OVERLAY_Z - 0.01)
        self.name.position = (0, 0.10 + height / 2.0 - 0.115,
                              theme.OVERLAY_Z - 0.01)
        self.instructions.position = (0, 0.10 - 0.012, theme.OVERLAY_Z)
        fit_text(self.instructions, self.instructions.text, 0.78, width - 0.06,
                 min_scale=0.5)
        self.status.position = (0, 0.10 - 0.098, theme.OVERLAY_Z)
        self.status.text = f'{int(round(max(0.0, min(1.0, progress)) * 100))}%'
        track_width = width * 0.6
        self._track.scale = (track_width, 0.016)
        self._track.position = (0, 0.10 - 0.128, theme.OVERLAY_Z + 0.02)
        self._fill.scale = (max(0.001, min(1.0, progress)), 1.0)
        self._fill.color = theme.rgba(colour or theme.PALETTE['green'], 0.9)
        self.show()
