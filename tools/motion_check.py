"""Motion check: drive the play screen and print what every trigger did.

A development aid for tuning the animation system (see
``docs/ANIMATION.md``): it boots the game offscreen, plays a 7-pin roll, a
spare, a strike and a gutter, pauses, toggles the physics panel and ends the
match, printing the state of each effect as it goes. It asserts nothing - the
assertions live in ``tests/test_motion_runtime.py``.

    python tools/motion_check.py
"""
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
os.chdir(PROJECT_ROOT)

from ursina import Ursina, application, camera, color, time, window  # noqa: E402

import config                                                        # noqa: E402
from game.settings import Settings                                   # noqa: E402
from input.mouse_input import MouseInput, ThrowData                  # noqa: E402
from motion import MOTION                                            # noqa: E402
from scene import camera as scene_camera                             # noqa: E402
from ui.app import App                                               # noqa: E402

FIXED_DT = 1.0 / 60.0


def make_app():
    application.calculate_dt = False
    root = Ursina(title='Hells Balls (motion check)', size=(1280, 720),
                  window_type='offscreen', development_mode=True,
                  show_ursina_splash=False, icon='')
    window.color = color.rgb32(*config.WINDOW_BACKGROUND)
    held = {'down': False, 'x': 0.0, 'y': 0.0}
    mouse = MouseInput(pointer=lambda: (held['x'], held['y']),
                       button=lambda: held['down'])
    app = App(settings=Settings(path=PROJECT_ROOT / 'settings.json'),
              audio=None, inputs={'mouse': mouse, 'webcam': None})
    return root, app, held


def main():
    root, app, held = make_app()

    def step(frames=1):
        for _ in range(frames):
            time.dt = FIXED_DT
            time.dt_unscaled = FIXED_DT
            app.update()
            root._update()

    def force_roll(count):
        """Knock ``count`` pins down and run the roll through to 'result'."""
        game = app.game
        game.launch(ThrowData(speed=7.5, source='script'))
        step(2)
        standing = [p for p in game.pins.pins
                    if not p.physics.down and not p.physics.removed]
        for pin in standing[:count]:
            pin.physics.down = True
            pin.physics.hit = True
            pin.physics.angle = 1.6
        game.ball.physics.rolling = False
        game.ball.finished = True
        for _ in range(600):
            step(1)
            if game.state in ('result', 'game_over'):
                break

    def finish_roll():
        game = app.game
        for _ in range(600):
            step(1)
            if game.state in ('ready', 'handoff', 'game_over'):
                break
        if game.state == 'handoff':
            game.on_key('enter')
            for _ in range(600):
                step(1)
                if game.state == 'ready':
                    break

    app.start_match('classic', [{'name': 'MOTION'}])
    game = app.game
    motion = game.motion

    # Watch the live pin pops: the director fires one per pin (or per group of
    # pins that fall together), and the dev aid records what it shouted.
    from motion.celebrate import pins_popup_text
    pop_log = []
    _on_pin_drop = motion.onPinDrop

    def _spy_pin_drop(count, delta):
        _on_pin_drop(count, delta)
        pop_log.append(pins_popup_text(delta))

    motion.onPinDrop = _spy_pin_drop

    def take_pops():
        """The pop texts fired since the last call."""
        texts = list(pop_log)
        pop_log.clear()
        return texts

    step(3)
    print('board revealed:', motion.hud.scoreboard.revealed,
          '| active frame:', motion.hud.scoreboard.active_index)
    print('rack standing:', motion.hud.pins.standing)

    # A real drag: the meter fills from the stroke, the guide is live.
    held['down'] = True
    held['y'] = -0.25
    step(4)
    for _ in range(8):
        held['y'] -= 0.03
        step(1)
    for _ in range(18):
        held['y'] += 0.055
        step(1)
    print('meter visible:', motion.hud.meter.visible,
          '| power:', round(motion.hud.meter.power, 2),
          '| guide dashes:', sum(1 for d in motion.guide.dashes if d.visible))
    held['down'] = False
    step(4)
    print('meter released: flash', round(motion.hud.meter.flash, 2))

    force_roll(7)
    print('result card:', _visible_card(motion).text.text,
          '| shake left from the pin thud:', round(motion.shake.amplitude, 4))
    print('pin pops fired:', take_pops())
    finish_roll()
    print('frame now:', game.score.current_frame_number,
          '| total:', game.hud.total_score.text)

    force_roll(3)
    print('result card:', _visible_card(motion).text.text, '(spare)',
          '| sub-line:', _visible_card(motion).sub.text,
          '| ring live:', _visible_card(motion).ring.enabled)
    print('pin pops fired:', take_pops())
    finish_roll()
    print('cell 1:', game.hud.scorecard.cells[0]['marks'].text,
          game.hud.scorecard.cells[0]['score'].text)

    force_roll(10)
    print('result card:', _visible_card(motion).text.text,
          '| shake:', round(motion.shake.amplitude, 4),
          '| slow-mo:', motion.slow_motion_scale(),
          '| fov target:', scene_camera._FOV_TARGET,
          '| strip spike:', round(motion.strips.spike_level, 2),
          '| pin-triangle peak:', round(max(motion.hud.pins.flashes), 2))
    print('pin pops fired:', take_pops())
    finish_roll()

    # The impact scale: a hard hit shakes, rings and flashes; a soft one only
    # dusts the deck (see motion/celebrate.py).
    motion.shake.amplitude = 0.0
    motion.onPinImpact(position=(0.0, 0.3, 17.6), speed=8.6)
    print('hard impact (8.6 m/s): shake', round(motion.shake.amplitude, 4),
          '| rings', len(motion.rings.active),
          '| flash', motion.flash.entity.enabled)
    motion.shake.amplitude = 0.0
    motion.flash.reset()
    motion.rings.clear()
    motion.onPinImpact(position=(0.0, 0.3, 17.6), speed=2.0)
    print('soft impact (2.0 m/s): shake', round(motion.shake.amplitude, 4),
          '| rings', len(motion.rings.active),
          '| flash', motion.flash.entity.enabled)

    from motion.celebrate import combo_label, impact_shake_px, pins_result_text
    print('combo labels:', [combo_label(i) for i in range(1, 6)])
    print('pin counts:', [pins_result_text(n) for n in (1, 3, 8, 10)])
    print('impact shake px at 6 / 9 m/s:',
          round(impact_shake_px(6.0), 2), round(impact_shake_px(9.0), 2))

    game.toggle_pause()
    step(12)
    print('paused:', game.paused, '| dim:', motion.vignette.entity.enabled,
          '| panel scale:', round(float(game.pause_overlay.panel.scale[0]), 3))
    game.toggle_pause()
    step(4)

    game.toggle_physics_panel()
    step(4)
    print('physics panel offset:', round(motion.hud.physics_offset, 3))
    game.toggle_physics_panel()
    step(30)

    MOTION.reduce_motion = True
    motion.flash.trigger()
    print('reduce motion: flash stays off:',
          not motion.flash.entity.enabled)
    MOTION.reduce_motion = False

    game._finish_match()
    step(6)
    print('results visible:', game.results_overlay.visible)
    print('award tier:', motion._award_tier,
          '| banner:', repr(game.results_overlay.award_text),
          '| sub:', repr(game.results_overlay.achievement_sub.text))
    step(140)
    print('final score:', game.results_overlay.total_score.text,
          '(the match total is',
          game.match.current_player.bowling.current_score, ')')
    # The biggest award path (a perfect game) is played directly: the labels,
    # the confetti budget and the extra beats the results screen earns.
    motion.onGameEnd(total=300, start_from=0,
                     overlay=game.results_overlay, perfect=True)
    step(4)
    print('perfect game: banner', repr(game.results_overlay.award_text),
          '| tier', motion._award_tier,
          '| confetti', len(motion.hud.particles.particles),
          '| extra beats', sum(1 for t in motion.motion.timelines
                               if t.tag == 'award_beats'
                               for step in t.steps
                               if step.get('type') == 'call'))
    _ = camera
    app.shutdown()
    print('MOTION CHECK OK')


def _last_pop(motion):
    """The most recently configured pin pop's text (or '-')."""
    pops = [pop for pop in motion.pops.pops if pop.visible]
    return pops[0].text.text if pops else '-'


def _visible_card(motion):
    for card in motion.cards.cards:
        if card.visible:
            return card
    return motion.cards.cards[0]


if __name__ == '__main__':
    main()
