"""Screenshot tour: drive the real game and save a PNG of every screen.

Used for visual verification of the UI (layout, clipping, palette) without a
human at the keyboard. It never opens a webcam: it forces mouse input and
fakes the webcam source.

    python tools/screenshot_tour.py [--out docs/screens] [--frames 90]

Each shot is written as ``<name>.png`` (plus Ursina's own numbering). The script
prints the path of every file it wrote, so a run is self-documenting.
"""
import argparse
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
os.chdir(PROJECT_ROOT)

from ursina import Ursina, application, color, time, window   # noqa: E402

import config                                                 # noqa: E402
import main as game_main                                       # noqa: E402
from game.audio import AudioSystem                            # noqa: E402
from game.settings import Settings                            # noqa: E402
from input.mouse_input import MouseInput, ThrowData           # noqa: E402
from tests.test_game_modes import FakeWebcamInput             # noqa: E402
from ui.app import App                                        # noqa: E402

FIXED_DT = 1.0 / 60.0


class Tour:
    def __init__(self, out_dir, frames):
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.frames = frames
        self.shots = []
        application.calculate_dt = False
        self.base = Ursina(title='Hells Balls (tour)', size=config.WINDOW_SIZE,
                           development_mode=False, show_ursina_splash=False,
                           icon='')
        window.color = color.rgb32(*config.WINDOW_BACKGROUND)
        settings = Settings(path=PROJECT_ROOT / 'settings.json')
        settings.load()
        settings.update(input_mode='mouse', hand_menu_navigation=False)
        self.mouse = MouseInput(pointer=lambda: (0.0, 0.0))
        self.webcam = FakeWebcamInput()
        self.audio = AudioSystem(directory=PROJECT_ROOT / 'assets' / 'audio')
        self.app = App(settings=settings, audio=self.audio,
                       inputs={'mouse': self.mouse, 'webcam': self.webcam})
        # Drive the game through the *real* module-level hook, exactly as
        # Ursina does when the game runs for a player.
        game_main.app = self.app
        game_main.game = self.app.game
        game_main.application = self.base

    def step(self, frames=None, dt=FIXED_DT):
        for _ in range(frames if frames is not None else self.frames):
            time.dt = dt
            time.dt_unscaled = dt
            game_main.update()
            application.base.step()

    def key(self, key, frames=3):
        """Send a key through the game's real input hook."""
        game_main.input(key)
        self.step(frames)

    def shot(self, name):
        """Render a couple of frames, then save the window's current frame.

        Ursina's own ``application.screenshot`` queues the save through its
        update task, which lands one or more frames later and made a tour
        capture the *previous* screen. Saving the window directly right after a
        rendered frame is immediate and unambiguous.
        """
        from panda3d.core import Filename

        self.step(2)
        path = self.out_dir / f'{name}.png'
        written = application.base.win.saveScreenshot(
            Filename.fromOsSpecific(str(path.resolve())))
        self.shots.append((name, str(path)))
        print(f'shot: {name} -> {path} ({bool(written)})', flush=True)

    def run(self):
        # 1. splash
        self.app.screens.set('splash')
        self.step()
        self.shot('01_splash')
        # 2. main menu
        self.app.go_to_menu()
        self.step()
        self.shot('02_menu')
        # 3. mode picker (every mode selected, so each ball is inspected)
        self.app.go_to_modes()
        picker = self.app.screens.active
        for index, mode in enumerate(picker.mode_list):
            picker.select_ball(index)
            self.step(12)
            if index in (0, 1, 3, 4):
                self.shot(f'03_modes_{mode.id}')
        # 4. how to play (all pages)
        self.app.go_to_help()
        help_screen = self.app.screens.active
        for page in range(len(help_screen.PAGES)):
            self.step(10)
            self.shot(f'04_howto_{page + 1}')
            help_screen._flip(1)
        # 5. settings
        self.app.open_settings()
        self.step()
        self.shot('05_settings')
        self.app.leave_settings()
        # 6. physics lab: BOWL must be clicked; capture the mid-replay
        self.app.go_to_lab()
        self.step(10)
        self.app.screens.active.bowl()
        self.step(90)
        self.shot('06_lab')
        # 7. classic bowling: ready, then a real shot, then the result
        self.app.start_match('classic', [{'name': 'PLAYER 1'}])
        self.step(40)
        self.shot('07_classic_ready')
        self.mouse.lateral = 0.18
        self.mouse.aim_offset = 0.05
        self.app.game.launch(ThrowData(speed=7.6, lateral_position=0.18,
                                       launch_angle=0.010, spin_omega=-1.6,
                                       source='script'))
        self.step(150)
        self.shot('08_classic_rolling')
        for _ in range(600):
            self.step(1)
            if self.app.game.state in ('result', 'handoff', 'game_over'):
                break
        self.step(30)
        self.shot('09_classic_result')
        # 8. pause overlay
        self.app.game.pause()
        self.step()
        self.shot('10_pause')
        self.app.game.resume()
        # 9. trivia question + correct answer + feedback
        self.app.start_match('trivia', [{'name': 'STUDENT'}])
        self.step(20)
        self.shot('11_trivia_question')
        game = self.app.game
        question = game.current_question
        game.answer_text = str(question.answer) if question.is_numeric \
            else str(question.answer)
        game.on_key('enter')
        self.step(20)
        self.shot('12_trivia_feedback')
        # 10. Equation Mode: the challenge panel, a miss, a solve, a solution
        self.app.start_match('equations', [{'name': 'STUDENT'}])
        self.step(20)
        self.shot('13_equation_challenge')
        game = self.app.game
        game.challenge_input = '0'
        game.on_key('enter')
        for _ in range(2400):
            self.step(1)
            if game.state == 'challenge' and game.challenge_result is not None:
                break
        self.step(20)
        self.shot('13b_equation_missed')
        game.challenge_input = f'{game.challenge.answer:.2f}'
        game.on_key('enter')
        for _ in range(2400):
            self.step(1)
            if (game.state == 'challenge'
                    and game.challenge_result is not None
                    and game.challenge_result.solved):
                break
        self.step(30)
        self.shot('13c_equation_solved')
        game.on_key('enter')
        self.step(20)
        game.show_challenge_solution()
        self.step(20)
        self.shot('13d_equation_solution')
        # 11. local multiplayer handoff: bowl ALICE's frame out, then wait
        self.app.start_match('local', [{'name': 'ALICE'}, {'name': 'BOB'}])
        self.step(20)
        throw = 0
        while game.state != 'handoff' and throw < 4:
            throw += 1
            game.launch(ThrowData(speed=7.6, lateral_position=0.20,
                                  launch_angle=0.012, spin_omega=-1.6,
                                  source='script'))
            for _ in range(1200):
                self.step(1)
                if game.state in ('ready', 'handoff', 'game_over'):
                    break
            self.step(60)
        self.step(40)
        self.shot('14_local_handoff')
        # 12. BowlRush ready
        self.app.start_match('bowlrush', [{'name': 'RED'}, {'name': 'BLUE'}],
                             duration=180.0)
        self.step(30)
        self.shot('15_bowlrush_ready')
        # 13. final results: play a very short match (all gutter balls)
        self.app.start_match('classic', [{'name': 'PLAYER 1'}])
        game = self.app.game
        for _ in range(20):
            if game.state == 'game_over':
                break
            if game.state == 'ready':
                game.launch(ThrowData(speed=2.2, lateral_position=0.0,
                                      source='script'))
            self.step(1)
            for _ in range(2000):
                self.step(1)
                if game.state in ('ready', 'game_over', 'result'):
                    break
            self.step(200)
        self.step(30)
        self.shot('16_results')
        print(f'\n{len(self.shots)} screenshots written')
        for name, path in self.shots:
            print(' ', name, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default=str(PROJECT_ROOT / 'docs' / 'screens'))
    parser.add_argument('--frames', type=int, default=45)
    args = parser.parse_args()
    tour = Tour(args.out, args.frames)
    try:
        tour.run()
    finally:
        tour.app.shutdown()


if __name__ == '__main__':
    main()
