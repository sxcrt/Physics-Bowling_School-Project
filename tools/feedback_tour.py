"""Feedback tour: render the new pinfall / strike / award feedback to PNGs.

A development aid for the feedback pass (see ``docs/ANIMATION.md``): it drives
the real play screen offscreen and captures one frame of every new celebration
moment, so the effects can be inspected without a human at the keyboard:

* the live "+n PIN!" pop as pins fall;
* the roll summary card ("8 PINS DOWN!") with its plate, outline and ring;
* STRIKE! with its combo sub-line and the escalating doubles / turkeys;
* the results screen with an award banner ("NEW PERSONAL BEST!", "PERFECT
  GAME!") and the confetti it earns.

It asserts nothing; the assertions live in ``tests/test_motion_feedback.py``.

    python tools/feedback_tour.py [--out DIR]
"""
import argparse
import os
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
os.chdir(PROJECT_ROOT)

from ursina import Ursina, application, color, time, window   # noqa: E402

import config                                                 # noqa: E402
import main as game_main                                      # noqa: E402
from game.settings import Settings                            # noqa: E402
from input.mouse_input import MouseInput, ThrowData           # noqa: E402
from ui.app import App                                        # noqa: E402

FIXED_DT = 1.0 / 60.0


class FeedbackTour:
    def __init__(self, out_dir):
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.shots = []
        application.calculate_dt = False
        self.base = Ursina(title='Hells Balls (feedback tour)',
                           size=(1280, 720), window_type='offscreen',
                           development_mode=False, show_ursina_splash=False,
                           icon='')
        window.color = color.rgb32(*config.WINDOW_BACKGROUND)
        settings = Settings(path=PROJECT_ROOT / 'settings.json')
        settings.load()
        settings.update(input_mode='mouse', hand_menu_navigation=False)
        self.mouse = MouseInput(pointer=lambda: (0.0, 0.0))
        self.app = App(settings=settings, audio=None,
                       inputs={'mouse': self.mouse, 'webcam': None})
        game_main.app = self.app
        game_main.game = self.app.game
        game_main.application = self.base

    # ------------------------------------------------------------------ driving
    def step(self, frames=1, dt=FIXED_DT):
        for _ in range(frames):
            time.dt = dt
            time.dt_unscaled = dt
            game_main.update()
            application.base.step()

    def shot(self, name):
        from panda3d.core import Filename

        self.step(1)
        path = self.out_dir / f'{name}.png'
        written = application.base.win.saveScreenshot(
            Filename.fromOsSpecific(str(path.resolve())))
        self.shots.append((name, str(path)))
        print(f'shot: {name} -> {path} ({bool(written)})', flush=True)

    def knock(self, count):
        """Mark ``count`` standing pins as knocked down (presentation only)."""
        game = self.app.game
        standing = [pin for pin in game.pins.pins
                    if not pin.physics.down and not pin.physics.removed]
        for pin in standing[:count]:
            pin.physics.down = True
            pin.physics.hit = True
            pin.physics.angle = 1.6

    def roll(self, count, mid=None, result=None, mid_frames=10,
             result_frames=14):
        """Bowl a scripted roll that takes ``count`` pins down.

        ``mid`` is captured while the pins are still falling (the live pops
        are up), ``result`` after the roll has been counted and the card has
        had ``result_frames`` frames to land.
        """
        game = self.app.game
        game.launch(ThrowData(speed=7.5, source='script'))
        self.step(4)
        self.knock(count)
        self.step(mid_frames)
        if mid:
            self.shot(mid)
        for _ in range(1200):
            self.step(1)
            if game.state in ('result', 'game_over'):
                break
        if result:
            self.step(result_frames)
            self.shot(result)

    def finish_roll(self, frames=200):
        game = self.app.game
        for _ in range(1200):
            self.step(1)
            if game.state in ('ready', 'handoff', 'game_over'):
                break
        self.step(frames)

    # -------------------------------------------------------------------- scenes
    def run(self):
        app = self.app
        # 1. the live pin pop, mid-roll; then a finished frame
        app.start_match('classic', [{'name': 'PLAYER 1'}])
        self.step(40)
        self.shot('01_ready')
        self.roll(3, mid='02_pin_pops')
        self.finish_roll()
        self.roll(0)                      # frame 1 closes on 3
        self.finish_roll()
        # 2. the roll summary with a ring (8 pins on a fresh rack is a big ball)
        self.roll(8, result='03_eight_pins', result_frames=44)
        self.finish_roll()
        self.roll(0)                      # close the open frame
        self.finish_roll()
        # 3. STRIKE! (first strike: no combo label yet)
        self.roll(10, result='04_strike', result_frames=34)
        self.finish_roll()
        # 4. a second strike: the DOUBLE! sub-line
        self.roll(10, result='05_double', result_frames=70)
        self.finish_roll()
        # 5. a third: TURKEY! (with the lane-light sequence)
        self.roll(10, result='06_turkey', result_frames=34)
        self.finish_roll()
        # 6. a fourth: FOUR-BAGGER! under the TURKEY! card
        self.roll(10, result='07_four_bagger', result_frames=70)
        self.finish_roll()
        # 7. a gutter ball (the quiet case)
        self.roll(0, result='08_gutter', result_frames=20)
        self.finish_roll()
        # 8. game end with a personal best
        game = app.game
        game._best_scores['classic'] = 3
        game._finish_match()
        self.step(30)
        self.shot('09_results_best')
        self.step(50)
        self.shot('10_results_best_late')
        # 9. a perfect game (played directly: the award path, not the physics)
        game.motion.onGameEnd(total=300, start_from=0,
                              overlay=game.results_overlay, perfect=True)
        self.step(24)
        self.shot('11_perfect_game')
        self.step(40)
        self.shot('12_perfect_game_late')
        print(f'\n{len(self.shots)} screenshots written')
        for name, path in self.shots:
            print(' ', name, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default=str(Path(tempfile.gettempdir())
                                             / 'bowling_feedback'))
    args = parser.parse_args()
    tour = FeedbackTour(args.out)
    try:
        tour.run()
    finally:
        tour.app.shutdown()


if __name__ == '__main__':
    main()
