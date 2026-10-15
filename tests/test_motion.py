"""Unit tests for the animation core: easings, tweens, timelines, board state.

Everything here is pure Python (no window, no entities), which is why the
whole of :mod:`motion.ease`, :mod:`motion.tween`, :mod:`motion.config` and
:mod:`motion.score_fx` keep the engine out: the maths is the part that has to
be exactly right, and it can be checked in milliseconds.

The runtime behaviour (triggers, pooled effects, the scene hooks) is covered
by ``tests/test_motion_runtime.py``.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motion import ease                                  # noqa: E402
from motion.config import MOTION, MotionConfig           # noqa: E402
from motion.score_fx import ScorecardMotion               # noqa: E402
from motion.tween import Motion, Timeline, Tween          # noqa: E402


class TestEasing(unittest.TestCase):
    """The two curves from the design spec, and the helpers around them."""

    def test_standard_curve_is_fast_out_and_soft_in(self):
        self.assertEqual(ease.STANDARD(0.0), 0.0)
        self.assertEqual(ease.STANDARD(1.0), 1.0)
        # Fast out: a quarter of the time has already covered most of the way.
        self.assertGreater(ease.STANDARD(0.25), 0.55)
        # Soft landing: the last quarter adds little.
        self.assertLess(ease.STANDARD(0.75), 1.0)
        self.assertGreater(ease.STANDARD(0.5), ease.STANDARD(0.5) * 0.9)
        # Monotonic.
        values = [ease.STANDARD(i / 20.0) for i in range(21)]
        self.assertEqual(values, sorted(values))

    def test_overshoot_curve_goes_past_one_then_settles(self):
        self.assertEqual(ease.OVERSHOOT(0.0), 0.0)
        self.assertEqual(ease.OVERSHOOT(1.0), 1.0)
        peak = max(ease.OVERSHOOT(i / 100.0) for i in range(101))
        self.assertGreater(peak, 1.05)
        self.assertLess(peak, 1.25)

    def test_control_points_match_the_spec(self):
        self.assertEqual(ease.STANDARD.control_points, (0.22, 1.0, 0.36, 1.0))
        self.assertEqual(ease.OVERSHOOT.control_points, (0.34, 1.56, 0.64, 1.0))

    def test_named_easings_resolve(self):
        self.assertIs(ease.resolve('standard'), ease.STANDARD)
        self.assertIs(ease.resolve('overshoot'), ease.OVERSHOOT)
        self.assertIs(ease.resolve(None), ease.STANDARD)
        built = ease.resolve((0.1, 0.2, 0.3, 0.4))
        self.assertTrue(callable(built))

    def test_ramp_and_mix(self):
        pop = ease.ramp(0.0, (0.0, 0.6), (0.5, 1.15), (1.0, 1.0))
        self.assertAlmostEqual(pop, 0.6)
        self.assertAlmostEqual(ease.ramp(1.0, (0.0, 0.6), (0.5, 1.15),
                                         (1.0, 1.0)), 1.0)
        self.assertAlmostEqual(ease.mix_rgb((0, 0, 0), (10, 20, 30), 0.5),
                               (5, 10, 15))
        self.assertEqual(ease.clamp01(-2), 0.0)
        self.assertEqual(ease.clamp01(2), 1.0)


class TestTween(unittest.TestCase):
    """The tween primitive: delay, looping, cancellation, completion."""

    def test_a_tween_reaches_its_end_and_completes_once(self):
        seen = []
        done = []
        tween = Tween(0.5, seen.append, on_complete=lambda: done.append(True))
        for _ in range(40):
            tween.update(1.0 / 60.0)
        self.assertTrue(tween.finished)
        self.assertAlmostEqual(seen[-1], 1.0)
        self.assertEqual(done, [True])
        self.assertFalse(tween.update(1.0 / 60.0))

    def test_delay_holds_the_tween_back_without_losing_time(self):
        seen = []
        tween = Tween(0.2, seen.append, delay=0.1, easing='linear')
        tween.update(0.05)
        self.assertEqual(seen, [])                  # still inside the delay
        tween.update(0.10)                          # crossing the delay
        self.assertTrue(seen)
        self.assertAlmostEqual(seen[0], 0.25, places=3)   # only the spill-over

    def test_zero_duration_completes_immediately(self):
        seen = []
        tween = Tween(0.0, seen.append)
        tween.update(0.016)
        self.assertEqual(seen, [1.0])
        self.assertTrue(tween.finished)

    def test_a_long_tween_is_capped_to_the_ui_rule(self):
        tween = Tween(5.0, lambda _p: None)
        self.assertAlmostEqual(tween.duration, MOTION.ui_max_duration)
        celebration = Tween(5.0, lambda _p: None, celebrate=True)
        self.assertAlmostEqual(celebration.duration, 5.0)

    def test_loop_and_yoyo(self):
        seen = []
        tween = Tween(0.2, seen.append, loop=True, yoyo=True)
        for _ in range(60):
            tween.update(1.0 / 60.0)
        self.assertFalse(tween.finished)
        self.assertTrue(any(value < 0.1 for value in seen))

    def test_cancel_stops_the_callback(self):
        seen = []
        tween = Tween(1.0, seen.append, celebrate=True)
        tween.update(0.1)
        count = len(seen)
        tween.cancel()
        tween.update(0.1)
        self.assertEqual(len(seen), count)

    def test_a_failing_callback_never_breaks_the_frame(self):
        def explode(_progress):
            raise RuntimeError('boom')
        tween = Tween(0.2, explode)
        tween.update(0.1)                        # must not raise
        self.assertTrue(tween.finished or tween.cancelled)


class TestTimeline(unittest.TestCase):
    """Ordered waits, tweens and callbacks."""

    def test_steps_run_in_order(self):
        log = []
        timeline = Timeline([
            {'type': 'call', 'value': lambda: log.append('a')},
            {'type': 'wait', 'value': 0.1},
            {'type': 'call', 'value': lambda: log.append('b')},
            {'type': 'tween', 'tween': Tween(0.1, lambda _p: None,
                                             celebrate=True)},
            {'type': 'call', 'value': lambda: log.append('c')},
        ])
        for _ in range(30):
            timeline.update(1.0 / 60.0)
        self.assertEqual(log, ['a', 'b', 'c'])
        self.assertTrue(timeline.finished)

    def test_complete_runs_the_rest_immediately(self):
        log = []
        timeline = Timeline([{'type': 'wait', 'value': 5.0},
                             {'type': 'call', 'value': lambda: log.append('x')}])
        timeline.update(0.016)
        timeline.complete()
        self.assertEqual(log, ['x'])


class TestMotion(unittest.TestCase):
    """The runner: many tweens, count-ups and tag cancellation."""

    def test_tweens_are_pruned_when_finished(self):
        motion = Motion()
        for _ in range(3):
            motion.tween(0.1, lambda _p: None)
        self.assertEqual(len(motion.tweens), 3)
        for _ in range(10):
            motion.update(1.0 / 60.0)
        self.assertEqual(motion.tweens, [])
        self.assertFalse(motion.busy)

    def test_cancel_by_tag_and_owner(self):
        motion = Motion()
        motion.tween(1.0, lambda _p: None, tag='glow', celebrate=True)
        motion.tween(1.0, lambda _p: None, tag='other', celebrate=True)
        motion.cancel(tag='glow')
        self.assertEqual([t.tag for t in motion.tweens], ['other'])
        motion.cancel()
        self.assertEqual(motion.tweens, [])

    def test_count_up_reports_every_step_and_lands_exactly(self):
        motion = Motion()
        seen = []
        motion.count_up(0, 100, 0.5, seen.append, formatter=str)
        for _ in range(40):
            motion.update(1.0 / 60.0)
        self.assertEqual(seen[-1], '100')
        self.assertEqual(seen[0], '0')              # the start value is emitted
        numbers = [int(v) for v in seen]
        self.assertEqual(numbers, sorted(numbers))
        self.assertLess(numbers[1], 100)

    def test_a_linear_count_up_steps_through_every_number(self):
        motion = Motion()
        seen = []
        motion.count_up(0, 5, 0.5, seen.append, easing='linear')
        for _ in range(40):
            motion.update(1.0 / 60.0)
        self.assertEqual(seen[0], 0)
        self.assertEqual(seen[-1], 5)
        self.assertEqual(seen, sorted(seen))
        self.assertTrue(all(0 <= value <= 5 for value in seen))

    def test_dt_is_clamped_so_a_hitch_cannot_jump_an_animation(self):
        motion = Motion()
        seen = []
        motion.tween(1.0, seen.append, easing='linear', celebrate=True)
        motion.update(10.0)
        self.assertLessEqual(max(seen), 0.25)


class TestMotionConfig(unittest.TestCase):
    """One config object, tunable and round-trippable."""

    def test_reduce_motion_switches_the_three_triggers_off(self):
        MOTION.reduce_motion = False
        self.assertTrue(MOTION.allow_shake())
        self.assertTrue(MOTION.allow_flash())
        self.assertTrue(MOTION.allow_pulse())
        MOTION.reduce_motion = True
        self.assertFalse(MOTION.allow_shake())
        self.assertFalse(MOTION.allow_flash())
        self.assertFalse(MOTION.allow_pulse())
        MOTION.reduce_motion = False

    def test_particle_counts_scale_with_quality_and_intensity(self):
        MOTION.particle_budget = 1.0
        MOTION.master_intensity = 1.0
        self.assertEqual(MOTION.scaled_count(40), 40)
        MOTION.particle_budget = 0.5
        self.assertEqual(MOTION.scaled_count(40), 20)
        MOTION.particle_budget = 0.01              # never drops to nothing
        self.assertEqual(MOTION.scaled_count(40), 1)
        MOTION.particle_budget = 1.0

    def test_to_dict_and_load(self):
        config = MotionConfig()
        data = config.to_dict()
        self.assertIn('board_stagger', data)
        self.assertIn('reduce_motion', data)
        config.load({'board_stagger': 0.021, 'not_a_key': 5})
        self.assertAlmostEqual(config.board_stagger, 0.021)
        self.assertFalse(hasattr(config, 'not_a_key'))


class TestScorecardMotion(unittest.TestCase):
    """The board's state machine: reveal, highlight, stamps, count-ups."""

    def setUp(self):
        self.motion = Motion()
        self.board = ScorecardMotion(self.motion)

    def test_reveal_staggers_the_frames(self):
        self.board.start_reveal()
        first = self.board.cell_transform(0)['alpha']
        last = self.board.cell_transform(9)['alpha']
        self.assertLessEqual(first, last)
        self.assertLess(first, 1.0)                # still falling in
        for _ in range(90):
            self.motion.update(1.0 / 60.0)
        self.assertAlmostEqual(self.board.cell_transform(9)['alpha'], 1.0)
        self.assertAlmostEqual(self.board.cell_transform(0)['dy'], 0.0)

    def test_active_frame_breathes_and_scales(self):
        self.board.set_active(3)
        for _ in range(30):
            self.motion.update(1.0 / 60.0)
        transform = self.board.cell_transform(3)
        self.assertTrue(transform['active'])
        self.assertGreaterEqual(transform['glow'],
                                MOTION.frame_pulse_min - 1e-6)
        self.assertGreater(transform['scale'], 1.0)

    def test_frame_change_fades_the_old_glow_and_slides_the_new_one(self):
        self.board.set_active(0)
        for _ in range(30):
            self.motion.update(1.0 / 60.0)
        self.board.set_active(1)
        # The new highlight starts offset and slides in.
        slide = self.board.cell_transform(1)['glow_slide']
        self.assertGreater(slide, 0.0)
        for _ in range(30):
            self.motion.update(1.0 / 60.0)
        self.assertAlmostEqual(self.board.cell_transform(1)['glow_slide'], 0.0,
                               places=3)
        # The old frame's glow is gone.
        self.assertEqual(self.board.cell_transform(0)['glow'], 0.0)

    def test_score_entry_pops_and_flashes(self):
        self.board.score_entry(2)
        self.board.update(1.0 / 60.0)
        peak = 0.0
        flash_seen = False
        for _ in range(30):
            self.motion.update(1.0 / 60.0)
            transform = self.board.cell_transform(2)
            peak = max(peak, transform['mark_scale'])
            flash_seen = flash_seen or transform['flash'] > 0.05
        self.assertGreater(peak, 1.05)             # it overshoots
        self.assertTrue(flash_seen)
        self.assertAlmostEqual(self.board.cell_transform(2)['mark_scale'], 1.0,
                               places=2)

    def test_mark_stamp_scales_down_and_rotates_settling_to_zero(self):
        self.board.mark_stamp(4)
        self.board.update(1.0 / 60.0)
        start = self.board.cell_transform(4)
        self.assertGreater(start['mark_scale'], 1.5)
        self.assertLess(start['rotation'], 0.0)
        for _ in range(40):
            self.motion.update(1.0 / 60.0)
        end = self.board.cell_transform(4)
        self.assertAlmostEqual(end['mark_scale'], 1.0, places=2)
        self.assertAlmostEqual(end['rotation'], 0.0, places=2)

    def test_total_counts_up_and_then_hands_back_to_the_scorer(self):
        self.board.count_total(1, 10, 40)
        self.assertEqual(self.board.displayed_total(1), 10)
        seen = []
        for _ in range(40):
            self.motion.update(1.0 / 60.0)
            value = self.board.displayed_total(1)
            if value is not None:
                seen.append(value)
        self.assertEqual(seen[-1], 40)
        self.assertLess(seen[len(seen) // 2], 40)
        # Once the count is over the caller's own (authoritative) value wins.
        self.assertIsNone(self.board.displayed_total(1))

    def test_final_frame_pulses_larger(self):
        self.board.final_frame(9)
        self.board.set_active(9)
        peak = 0.0
        for _ in range(40):
            self.motion.update(1.0 / 60.0)
            peak = max(peak, self.board.cell_transform(9)['scale'])
        self.assertGreaterEqual(peak, MOTION.frame_scale)

    def test_reduce_motion_softens_the_stamp(self):
        MOTION.reduce_motion = True
        try:
            self.board.mark_stamp(0)
            self.board.update(1.0 / 60.0)
            transform = self.board.cell_transform(0)
            self.assertAlmostEqual(transform['mark_scale'], 1.0)
            self.assertAlmostEqual(transform['rotation'], 0.0)
        finally:
            MOTION.reduce_motion = False

    def test_reset_clears_every_cell(self):
        self.board.set_active(5)
        self.board.score_entry(5, 0, 12)
        for _ in range(5):
            self.motion.update(1.0 / 60.0)
        self.board.reset()
        transform = self.board.cell_transform(5)
        self.assertEqual(transform['scale'], 1.0)
        self.assertEqual(transform['flash'], 0.0)
        self.assertIsNone(self.board.displayed_total(5))


class TestRotateAboutCentre(unittest.TestCase):
    """The stamp's pivot maths: the glyph's middle must stay put."""

    def test_centre_stays_fixed(self):
        import math

        from motion.score_fx import rotate_about_centre
        pivot = (0.0, 0.5)
        centre = (0.0, 0.4)
        moved = rotate_about_centre(pivot, centre, 8.0)
        # The vector from the centre to the pivot, rotated by +8 degrees.
        expected = (-0.1 * math.sin(math.radians(8.0)),
                    0.1 * math.cos(math.radians(8.0)))
        self.assertAlmostEqual(moved[0], centre[0] + expected[0], places=6)
        self.assertAlmostEqual(moved[1], centre[1] + expected[1], places=6)

    def test_no_rotation_means_no_offset(self):
        from motion.score_fx import rotate_about_centre
        self.assertEqual(rotate_about_centre((1.0, 2.0), (0.5, 1.5), 0.0),
                         (1.0, 2.0))


if __name__ == '__main__':
    unittest.main(verbosity=2)
