"""Pointer tracking for the menus and the mouse throw controls.

Why this module exists
----------------------
Ursina reads the pointer from Panda3D's mouse watcher, and that watcher
reports "no mouse" whenever the window has not received pointer events -
the pointer sits outside the window, the window is not focused, or a driver
never sets the ``in_window`` flag.  When that happens ``mouse.x`` **and**
``mouse.y`` both return ``0``, which is the *centre of the screen*: every
click lands in the middle of the window (so a menu button anywhere else
appears dead) and ``mouse.velocity`` is forced to zero (so a drag throw
records no speed at all).

This module keeps one UI-space pointer from three layered sources, in order
of trustworthiness:

1. **ursina's pointer** - ``mouse.x`` / ``mouse.y`` when the watcher reports a
   mouse.  Already in the same space as ``camera.ui`` entities.
2. **Panda3D's window pointer** - ``win.get_pointer(0)`` in window pixels,
   converted to UI units, accepted when Panda3D says the pointer is in the
   window *or* when its position has changed since the previous sample.
3. **The operating-system cursor** (Windows only) - ``GetCursorPos`` mapped
   through the window rectangle.  Works even when Panda3D receives no pointer
   events at all, as long as the cursor is over the game window.

If every source fails the last known good position is kept, so a click can
never silently teleport to the middle of the screen.

The left mouse button comes from ursina as well (``mouse.left``), with the
Windows button state as a fallback when the pointer had to come from the OS
cursor - the same failure that hides the position also hides the button.
"""
import time

from ursina import mouse, window

import config

UI_MIN_Y = -0.5
UI_MAX_Y = 0.5


def _clamp(value, low, high):
    return max(low, min(high, value))


def _ursina_pointer():
    """ursina's pointer in UI space, or None when the watcher has no mouse."""
    watcher = getattr(mouse, '_mouse_watcher', None)
    if watcher is not None:
        try:
            if not watcher.has_mouse():
                return None
        except Exception:                        # pragma: no cover - engine quirk
            return None
    try:
        return (float(mouse.x), float(mouse.y))
    except Exception:                            # pragma: no cover - offscreen
        return None


def _window_pointer():
    """Panda3D's window pointer in UI space, or None when unusable."""
    from ursina import application
    base = getattr(application, 'base', None)
    if base is None or getattr(base, 'win', None) is None:
        return None
    try:
        pointer = base.win.get_pointer(0)
        px, py = float(pointer.get_x()), float(pointer.get_y())
    except Exception:                            # pragma: no cover - no window yet
        return None
    size = window.size
    width, height = float(size[0]), float(size[1])
    if width <= 0.0 or height <= 0.0:
        return None
    x = ((px / width) - 0.5) * window.aspect_ratio
    y = -(py / height - 0.5)
    if getattr(pointer, 'in_window', False):
        return (x, y)
    # Not flagged as inside: only trust it when it actually moved, so a stale
    # (0, 0) cannot be mistaken for the centre of the screen.
    if (px, py) != (0.0, 0.0):
        return (_clamp(x, -window.aspect_ratio / 2.0, window.aspect_ratio / 2.0),
                _clamp(y, UI_MIN_Y, UI_MAX_Y))
    return None


def _windows_cursor():
    """The OS cursor in UI space via Win32, or None (non-Windows / outside).

    Returns ``(x, y, inside)``: the mapped UI position and whether the cursor
    is over the game window's rectangle.
    """
    if not getattr(config, 'POINTER_OS_FALLBACK', True):
        return None
    try:
        import ctypes
        from ctypes import wintypes
    except Exception:                            # pragma: no cover - non-Windows
        return None
    try:
        point = wintypes.POINT()
        if not ctypes.windll.user32.GetCursorPos(ctypes.byref(point)):
            return None
        from ursina import application
        base = getattr(application, 'base', None)
        if base is None or getattr(base, 'win', None) is None:
            return None
        properties = base.win.get_properties()
        origin_x = float(properties.get_x_origin())
        origin_y = float(properties.get_y_origin())
        size = window.size
        width, height = float(size[0]), float(size[1])
        if width <= 0.0 or height <= 0.0:
            return None
        px = float(point.x) - origin_x
        py = float(point.y) - origin_y
        inside = (0.0 <= px <= width and 0.0 <= py <= height)
        if not inside:
            return (0.0, 0.0, False)
        x = ((px / width) - 0.5) * window.aspect_ratio
        y = -(py / height - 0.5)
        return (x, y, True)
    except Exception:                            # pragma: no cover - OS quirk
        return None


def _os_left_button():
    """Win32 left-button state, or None when it cannot be read."""
    if not getattr(config, 'POINTER_OS_FALLBACK', True):
        return None
    try:
        import ctypes
        return bool(ctypes.windll.user32.GetAsyncKeyState(0x01) & 0x8000)
    except Exception:                            # pragma: no cover - non-Windows
        return None


class Pointer:
    """One UI-space pointer with layered sources, velocity and button state."""

    def __init__(self):
        self.position = (0.0, 0.0)
        self.delta = (0.0, 0.0)        # UI units since the previous sample
        self.velocity = (0.0, 0.0)     # UI units per second
        self.source = 'none'
        self.available = False
        self.left = False
        self._prev = None
        self._last_time = None
        self._override = None          # test seam: a callable -> (x, y)

    # ------------------------------------------------------------------ config
    def set_override(self, provider):
        """Inject a pointer provider (used by the headless tests)."""
        self._override = provider

    # ------------------------------------------------------------------ sample
    def sample(self):
        """Refresh the pointer; returns the current UI position."""
        now = time.monotonic()
        dt = (now - self._last_time) if self._last_time is not None else 0.0
        self._last_time = now

        position = None
        source = None
        if self._override is not None:
            try:
                position = self._override()
                source = 'override'
            except Exception:                    # pragma: no cover - test seam
                position = None
        if position is None:
            position = _ursina_pointer()
            source = 'ursina'
        if position is None and getattr(mouse, 'enabled', False):
            position = _window_pointer()
            source = 'window'
        if position is None:
            cursor = _windows_cursor()
            if cursor is not None and cursor[2]:
                position = (cursor[0], cursor[1])
                source = 'os'

        if position is not None:
            self.available = True
            self.source = source
            self.position = (float(position[0]), float(position[1]))
        elif not self.available:
            self.position = (0.0, 0.0)

        if self._prev is not None and dt > 1e-6:
            dx = self.position[0] - self._prev[0]
            dy = self.position[1] - self._prev[1]
            self.delta = (dx, dy)
            self.velocity = (dx / dt, dy / dt)
        else:
            self.delta = (0.0, 0.0)
            self.velocity = (0.0, 0.0)
        self._prev = self.position

        self.left = self._left_state()
        return self.position

    def _left_state(self):
        """The left button: ursina first, the OS as the fallback."""
        try:
            if mouse.left:
                return True
        except Exception:                        # pragma: no cover - engine quirk
            pass
        if self.source == 'os':
            state = _os_left_button()
            if state is not None:
                return state
        return False

    # ----------------------------------------------------------------- queries
    def pointer(self):
        """The pointer in UI space; samples on every call (cheap)."""
        return self.sample()

    def reset(self):
        self._prev = None
        self.velocity = (0.0, 0.0)
        self.delta = (0.0, 0.0)


_INSTANCE = Pointer()


def ui_pointer():
    """The current pointer in UI space (module-level, shared by the UI)."""
    return _INSTANCE.pointer()


def pointer_state():
    """The shared :class:`Pointer` (for input, tests and diagnostics)."""
    return _INSTANCE
