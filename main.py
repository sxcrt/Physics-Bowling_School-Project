"""Hells Balls - an original motion-controlled 3D physics bowling game.

Entry point:  ``python main.py``

The module owns the Ursina application, the module-level ``update`` / ``input``
hooks Ursina calls, and the app object (:class:`ui.app.App`) that routes work
to the active screen. The bowling itself lives in :class:`game.play.Game`
(the play screen), the shared simulation in :mod:`physics` and the rules in
:mod:`game.modes` / :mod:`game.session`.

Input modes (switch inside the game, or in Settings):
  * MOUSE   - mouse + keyboard (default), always available
  * WEBCAM  - body tracking drives a bowling swing; press TAB to toggle, or
              1 / 2 to select mouse / webcam directly. The camera is only
              active while webcam mode is selected and is released whenever
              the mode is left or the game exits.

Set ``STRIKE_LAB_SCENE_DEBUG=1`` to print the startup scene/entity dump used
for troubleshooting, and ``STRIKE_LAB_SKIP_SPLASH=1`` to boot straight to the
main menu (used by the runtime checks).
"""
import os

from ursina import Ursina, color, scene, camera, window

import config
from game.play import Game                    # re-exported for the tests
from ui.app import App

game = None
app = None
application = None


def print_scene_debug():
    """Print every scene entity's model/position/scale/color plus the camera.

    Colours are shown as 0-255 so they are easy to sanity-check.
    """
    print('=' * 66)
    print('STARTUP SCENE DEBUG')
    print('=' * 66)
    for e in scene.entities:
        model = getattr(e, 'model', None)
        pos = getattr(e, 'position', None)
        scale = getattr(e, 'scale', None)
        col = getattr(e, 'color', None)
        if col is not None and hasattr(col, 'rgb'):
            col = tuple(round(v * 255) for v in col.rgb[:3])
        pos = tuple(round(v, 3) for v in pos) if pos is not None else None
        scale = tuple(round(v, 3) for v in scale) if scale is not None else None
        print(f'  model={str(model):>8} | pos={pos} | scale={scale} | color={col}')
    print('-' * 66)
    print(f'  camera.position = {tuple(round(v, 3) for v in camera.position)}')
    print(f'  camera.rotation = {tuple(round(v, 3) for v in camera.rotation)}')
    print(f'  camera.fov      = {camera.fov}')
    print('=' * 66)


def update():
    # Ursina calls this module-level hook every frame.
    if app is not None:
        app.update()


def input(key):
    # Ursina calls this module-level hook on every key / mouse event.
    if key == 'f12':
        if application is not None:
            filename = application.screenshot(namePrefix='hells_balls')
            print('Screenshot saved to:', filename)
        return
    if app is not None:
        app.on_key(key)


def build_app(skip_splash=False):
    """Create the Ursina app and the game application; returns the App."""
    global app, game, application
    application = Ursina(title=config.WINDOW_TITLE, size=config.WINDOW_SIZE,
                         development_mode=False)
    window.color = color.rgb32(*config.WINDOW_BACKGROUND)
    app = App()
    game = app.game                      # the play screen (also module-global)
    if skip_splash or os.environ.get('STRIKE_LAB_SKIP_SPLASH') == '1':
        app.go_to_menu()
    return app


def main():
    app_instance = build_app()
    if os.environ.get('STRIKE_LAB_SCENE_DEBUG') == '1':
        print_scene_debug()
    try:
        application.run()
    finally:
        # Covers window close, Alt+F4 and normal quits: never leave the
        # webcam running (or settings unsaved) after the window is gone.
        if app_instance is not None:
            app_instance.shutdown()


if __name__ == '__main__':
    main()
