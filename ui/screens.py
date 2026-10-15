"""Screens and the screen manager.

A screen owns one root entity under ``camera.ui`` (plus whatever it puts in the
3D world) and is shown or hidden by the :class:`ScreenManager`. Every screen
receives the same calls:

* ``show(**kwargs)`` - build on first use, then make visible and refresh
* ``hide()``         - stop drawing and stop reacting to input
* ``update()``       - once per frame while visible
* ``on_key(key)``    - a key or mouse-button event
* ``on_click(x, y)`` - a left-click at a UI-space point

The manager keeps exactly one screen active, so no screen can leak input into
another one, and the play screen is only updated while it is on top - which is
what stops a webcam swing from ever reaching the menus.
"""
from ursina import Entity, camera, window

from input.pointer import ui_pointer
from ui import theme


class Screen:
    """Base class: a root entity, a camera view, and hover widgets."""

    name = 'screen'
    camera_view = 'menu'          # which scene camera shot to hold
    title = ''

    def __init__(self, app):
        self.app = app
        self.root = Entity(parent=camera.ui, enabled=False)
        self.widgets = []             # anything with a ``click`` method
        self.hovers = []              # anything with ``update_widget``
        self.buttons = []             # MenuButton list for keyboard navigation
        self.selected = 0
        self.built = False
        self._entering = False
        self._enter_time = 0.0
        self._hover_widget = None

    # ------------------------------------------------------------------ build
    def build(self):
        """Create this screen's entities (called once, on first show)."""
        self.built = True

    def show(self, **kwargs):
        if not self.built:
            self.build()
        self.root.enabled = True
        self.app.set_camera_view(self.camera_view)
        self.begin_enter()
        self.on_show(**kwargs)

    def hide(self):
        self.root.enabled = False

    def on_show(self, **kwargs):
        """Hook for per-visit refresh (default: nothing)."""

    # ------------------------------------------------------------- entrance
    def begin_enter(self):
        """180ms fade + 12px slide up; off when Reduce Motion is on."""
        from motion import MOTION

        self._enter_time = 0.0
        self._entering = not MOTION.reduce_motion
        if self._entering:
            self.root.y = -theme.px(theme.SIZES['screen_enter_rise'])
            starter = getattr(self.app, 'begin_screen_fade', None)
            if callable(starter):
                starter()
        else:
            self.root.y = 0.0

    def _update_enter(self, dt):
        if not self._entering:
            return
        self._enter_time += dt
        duration = max(1e-3, theme.SIZES['screen_enter'])
        t = min(1.0, self._enter_time / duration)
        ease = 1.0 - (1.0 - t) ** 2
        self.root.y = -theme.px(theme.SIZES['screen_enter_rise']) * (1.0 - ease)
        if t >= 1.0:
            self._entering = False
            self.root.y = 0.0

    # ------------------------------------------------------------- per frame
    @property
    def aspect(self):
        return window.aspect_ratio

    @property
    def half_width(self):
        return window.aspect_ratio / 2.0

    def update(self):
        x, y = ui_pointer()
        dt = self.dt
        self._update_enter(dt)
        for widget in self.hovers:
            update = getattr(widget, 'update_widget', None)
            if callable(update):
                update(x, y, dt)
        self._hover_tick(x, y)
        self.on_update(x, y)

    def _hover_tick(self, x, y):
        """A short tick the moment the pointer lands on a new control."""
        hovered = None
        for widget in self.hovers:
            contains = getattr(widget, 'contains', None)
            if callable(contains) and theme.widget_active(widget) \
                    and contains(x, y):
                hovered = widget
                break
        if hovered is not None and hovered is not self._hover_widget:
            self.app.play('menu_move')
        self._hover_widget = hovered

    def on_update(self, pointer_x, pointer_y):
        """Hook for per-frame logic beyond widget hovering."""

    @property
    def dt(self):
        from ursina import time
        try:
            return max(0.0, min(0.1, float(time.dt)))
        except Exception:                     # pragma: no cover
            return 1.0 / 60.0

    # ---------------------------------------------------------------- input
    def on_key(self, key):
        if key == 'left mouse down':
            x, y = ui_pointer()
            if self.on_click(x, y):
                return True
        if key in ('up arrow', 'up'):
            self.move_selection(-1)
            return True
        if key in ('down arrow', 'down'):
            self.move_selection(1)
            return True
        if key in ('enter', 'return', 'space') and self.buttons:
            button = self.buttons[self.selected % max(1, len(self.buttons))]
            if button.enabled:
                button.click(*self.center_of(button))
                return True
        return False

    def on_click(self, x, y):
        """Route a click to the widgets; returns True when one handled it."""
        for widget in self.widgets:
            if widget.click(x, y):
                return True
        return False

    def center_of(self, widget):
        return (widget.position[0], widget.position[1])

    # ------------------------------------------------------- keyboard support
    def move_selection(self, step):
        if not self.buttons:
            return
        count = len(self.buttons)
        start = self.selected
        for _ in range(count):
            self.selected = (self.selected + step) % count
            if self.buttons[self.selected].enabled:
                break
        if self.selected != start:
            self.app.play('menu_move')
        for index, button in enumerate(self.buttons):
            button.set_selected(index == self.selected)

    def refresh_selection(self):
        for index, button in enumerate(self.buttons):
            button.set_selected(index == self.selected)


class ScreenManager:
    """Holds every screen and shows exactly one at a time."""

    def __init__(self, app):
        self.app = app
        self.screens = {}
        self.active = None

    def register(self, screen):
        self.screens[screen.name] = screen
        return screen

    def get(self, name):
        return self.screens.get(name)

    def set(self, name, **kwargs):
        """Activate ``name`` (hiding the previous screen)."""
        screen = self.screens.get(name)
        if screen is None:
            raise KeyError(f'unknown screen {name!r}')
        if self.active is screen:
            # Re-entering the same screen still has to refresh it (and build it
            # on the very first show), so route it through show().
            screen.show(**kwargs)
            return screen
        if self.active is not None:
            self.active.hide()
        self.active = screen
        screen.show(**kwargs)
        return screen

    def update(self):
        if self.active is not None:
            self.active.update()

    def on_key(self, key):
        if self.active is None:
            return False
        # Mouse clicks are routed through ``on_click`` for *every* screen, so a
        # screen that overrides ``on_key`` (Settings, the mode picker, the play
        # screen) cannot accidentally stop receiving them - which is exactly
        # how the Settings and mode-picker buttons used to ignore the mouse.
        if key == 'left mouse down':
            handler = getattr(self.active, 'on_click', None)
            if callable(handler):
                x, y = ui_pointer()
                if handler(x, y):
                    return True
        return self.active.on_key(key)


def background_panel(parent, aspect, rgb=None, alpha=0.55):
    """A full-screen wash used behind text-heavy screens."""
    return Entity(parent=parent, model='quad', position=(0, 0, -0.5),
                  scale=(aspect, 1.0),
                  color=theme.rgba(rgb or theme.PALETTE['bg'], alpha))
