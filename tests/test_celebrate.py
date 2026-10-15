"""Unit tests for the celebration rules: wording, escalation and impact maths.

Everything here is engine-free (see ``motion/celebrate.py``): the labels, the
pop-up text, the streak escalation and the impact scale are the parts that have
to be exactly right, and they can be checked in milliseconds. The rendering of
these values is covered by ``tests/test_motion_feedback.py``.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motion import celebrate                                  # noqa: E402
from motion.config import MOTION                              # noqa: E402
from motion.director import result_spec                       # noqa: E402


class TestPinText(unittest.TestCase):
    def test_a_single_pin_is_singular(self):
        self.assertEqual(celebrate.pins_popup_text(1), '+1 PIN!')
        self.assertEqual(celebrate.pins_result_text(1), '1 PIN DOWN!')

    def test_a_multi_pin_drop_reads_as_a_count(self):
        self.assertEqual(celebrate.pins_popup_text(3), '+3 PINS!')
        self.assertEqual(celebrate.pins_result_text(8), '8 PINS DOWN!')
        self.assertEqual(celebrate.pins_result_text(9), '9 PINS DOWN!')

    def test_zero_never_produces_a_broken_string(self):
        self.assertEqual(celebrate.pins_popup_text(0), '+1 PIN!')
        self.assertEqual(celebrate.pins_result_text(0), '0 PINS DOWN!')

    def test_a_heavy_count_is_held_longer_than_a_tap(self):
        self.assertGreater(celebrate.pins_hold_scale(9),
                           celebrate.pins_hold_scale(3))
        self.assertLess(celebrate.pins_hold_scale(0),
                        celebrate.pins_hold_scale(1))


class TestComboLabels(unittest.TestCase):
    def test_the_first_strike_has_no_shout(self):
        self.assertEqual(celebrate.combo_label(0), '')
        self.assertEqual(celebrate.combo_label(1), '')

    def test_the_named_streaks(self):
        self.assertEqual(celebrate.combo_label(2), 'DOUBLE!')
        self.assertEqual(celebrate.combo_label(3), 'TURKEY!')
        self.assertEqual(celebrate.combo_label(4), 'FOUR-BAGGER!')
        self.assertEqual(celebrate.combo_label(5), 'FIVE-BAGGER!')
        self.assertEqual(celebrate.combo_label(6), 'SIX-BAGGER!')

    def test_beyond_the_names_it_counts(self):
        self.assertEqual(celebrate.combo_label(7), '7 IN A ROW!')
        self.assertEqual(celebrate.combo_label(11), '11 IN A ROW!')

    def test_the_spare_has_its_own_sub_line(self):
        self.assertEqual(celebrate.spare_label(), MOTION.spare_sub_text)
        self.assertTrue(celebrate.spare_label())


class TestComboEscalation(unittest.TestCase):
    def test_intensity_grows_then_caps(self):
        first = celebrate.streak_intensity(1)
        second = celebrate.streak_intensity(2)
        self.assertAlmostEqual(first, 1.0)
        self.assertGreater(second, first)
        self.assertLessEqual(celebrate.streak_intensity(50),
                             MOTION.combo_intensity_max)

    def test_the_fx_tier_climbs(self):
        self.assertEqual(celebrate.streak_tier(1), 0)
        self.assertEqual(celebrate.streak_tier(2), 1)
        self.assertEqual(celebrate.streak_tier(3), 2)
        self.assertEqual(celebrate.streak_tier(9), 3)


class TestImpactMaths(unittest.TestCase):
    def test_below_the_soft_speed_there_is_no_shake(self):
        self.assertEqual(celebrate.impact_intensity(None), 0.0)
        self.assertEqual(celebrate.impact_intensity(1.0), 0.0)
        self.assertEqual(celebrate.impact_shake_px(1.0), 0.0)

    def test_the_shake_grows_with_the_speed_and_caps(self):
        soft = celebrate.impact_shake_px(MOTION.impact_soft_speed + 1e-3)
        strong = celebrate.impact_shake_px(MOTION.impact_reference_speed)
        self.assertAlmostEqual(soft, MOTION.impact_shake_min, places=2)
        self.assertAlmostEqual(strong, MOTION.impact_shake_max, places=3)
        self.assertLess(celebrate.impact_shake_px(6.0),
                        celebrate.impact_shake_px(8.0))
        self.assertLessEqual(celebrate.impact_shake_px(40.0),
                            MOTION.impact_shake_max)

    def test_only_a_hard_hit_flashes_the_screen(self):
        self.assertEqual(celebrate.impact_flash_alpha(5.0), 0.0)
        self.assertGreater(celebrate.impact_flash_alpha(9.0), 0.0)
        self.assertLessEqual(celebrate.impact_flash_alpha(9.0),
                            MOTION.impact_flash_alpha)

    def test_a_multi_pin_drop_thuds_but_never_hammers(self):
        self.assertGreater(celebrate.pindrop_shake_px(1), 0.0)
        self.assertGreater(celebrate.pindrop_shake_px(3),
                           celebrate.pindrop_shake_px(1))
        self.assertLessEqual(celebrate.pindrop_shake_px(10),
                            MOTION.pindrop_shake_max)

    def test_the_pop_grows_with_a_multi_pin_drop_and_caps(self):
        self.assertAlmostEqual(celebrate.pindrop_pop_scale(1),
                               MOTION.pinpop_scale)
        self.assertGreater(celebrate.pindrop_pop_scale(3),
                           celebrate.pindrop_pop_scale(1))
        self.assertLessEqual(celebrate.pindrop_pop_scale(10),
                             MOTION.pinpop_scale_max)


class TestAchievements(unittest.TestCase):
    def test_the_biggest_award_wins(self):
        award = celebrate.achievement(perfect=True, best=True, won=True)
        self.assertEqual(award[0], celebrate.ACHIEVEMENT_PERFECT)
        self.assertGreater(award[3], 2)
        award = celebrate.achievement(best=True, won=True)
        self.assertEqual(award[0], celebrate.ACHIEVEMENT_BEST)
        award = celebrate.achievement(won=True)
        self.assertEqual(award[0], celebrate.ACHIEVEMENT_WIN)

    def test_nothing_to_celebrate_returns_none(self):
        self.assertIsNone(celebrate.achievement())

    def test_the_best_award_names_the_score_it_beat(self):
        award = celebrate.achievement(best=True, total=231, previous=180)
        self.assertEqual(award[1], MOTION.best_text)
        self.assertIn('231', award[2])
        self.assertIn('180', award[2])

    def test_the_celebration_grows_with_the_tier(self):
        self.assertGreater(celebrate.achievement_confetti(3),
                           celebrate.achievement_confetti(1))
        self.assertGreater(celebrate.achievement_confetti(2),
                           celebrate.achievement_confetti(0))
        self.assertGreater(celebrate.achievement_flashes(3),
                           celebrate.achievement_flashes(0))
        self.assertGreater(celebrate.achievement_event_count(3),
                           celebrate.achievement_event_count(1))


class TestResultSpec(unittest.TestCase):
    """The result specs carry the words and the media the director plays."""

    def test_a_plain_count_names_the_pins(self):
        spec = result_spec('pins', 4)
        self.assertEqual(spec['text'], '4 PINS DOWN!')
        self.assertEqual(spec['sub'], '')
        self.assertFalse(spec['ring'])

    def test_a_big_count_earns_the_ring(self):
        self.assertTrue(result_spec('pins', 8)['ring'])
        self.assertTrue(result_spec('pins', 9)['ring'])
        self.assertGreater(result_spec('pins', 9)['particles'],
                           result_spec('pins', 3)['particles'])

    def test_a_strike_carries_its_combo_label(self):
        self.assertEqual(result_spec('strike', 10, streak=1)['sub'], '')
        self.assertEqual(result_spec('strike', 10, streak=2)['sub'], 'DOUBLE!')
        self.assertEqual(result_spec('strike', 10, streak=3)['sub'], 'TURKEY!')

    def test_the_turkey_does_not_repeat_its_own_name(self):
        spec = result_spec('turkey', 10, streak=3)
        self.assertEqual(spec['text'], MOTION.turkey_text)
        self.assertEqual(spec['sub'], '')
        self.assertEqual(result_spec('turkey', 10, streak=4)['sub'],
                         'FOUR-BAGGER!')

    def test_a_streak_escalates_the_media(self):
        first = result_spec('strike', 10, streak=1)
        third = result_spec('strike', 10, streak=3)
        self.assertGreater(third['particles'], first['particles'])
        self.assertGreater(third['hold'], first['hold'])
        self.assertGreaterEqual(third['flashes'], first['flashes'])
        self.assertGreater(third['shake'], first['shake'])

    def test_a_spare_is_named_a_conversion(self):
        spec = result_spec('spare', 3)
        self.assertEqual(spec['text'], 'SPARE')
        self.assertEqual(spec['sub'], MOTION.spare_sub_text)
        self.assertTrue(spec['ring'])

    def test_every_style_has_the_keys_the_timeline_reads(self):
        wanted = {'text', 'sub', 'rgb', 'glow', 'scale', 'hold', 'particles',
                  'dust', 'shake', 'flashes', 'flash_colors', 'position',
                  'slam_from', 'rotate', 'ring', 'in_time'}
        for style, pins in (('strike', 10), ('turkey', 10), ('spare', 3),
                            ('gutter', 0), ('pins', 1), ('pins', 8)):
            spec = result_spec(style, pins)
            self.assertTrue(wanted.issubset(spec.keys()),
                            f'{style}: missing {wanted - set(spec.keys())}')


class TestFeedbackConfig(unittest.TestCase):
    """The new knobs exist, are positive and scale the right way."""

    def test_the_new_keys_are_present_and_sane(self):
        numeric = ('pinpop_time', 'pinpop_scale', 'pinpop_rise',
                   'pindrop_shake_px', 'pindrop_shake_max',
                   'result_slam_time', 'result_slam_scale',
                   'result_pulse_period', 'result_sub_gap', 'result_ring_time',
                   'combo_intensity_step', 'combo_intensity_max',
                   'impact_soft_speed', 'impact_reference_speed',
                   'impact_shake_min', 'impact_shake_max',
                   'impact_ring_time', 'award_in_time')
        for key in numeric:
            self.assertTrue(hasattr(MOTION, key), f'MOTION.{key} is missing')
            self.assertGreater(float(getattr(MOTION, key)), 0.0, key)
        for key in ('perfect_text', 'best_text', 'win_text',
                    'perfect_sub_text', 'best_sub_text', 'win_sub_text'):
            self.assertTrue(str(getattr(MOTION, key)).strip(), f'{key} empty')

    def test_the_scale_of_the_new_effects_is_ordered(self):
        self.assertGreater(MOTION.impact_reference_speed,
                           MOTION.impact_soft_speed)
        self.assertGreater(MOTION.impact_shake_max, MOTION.impact_shake_min)
        self.assertLess(MOTION.pindrop_shake_max, MOTION.impact_shake_max)
        self.assertGreater(MOTION.pinpop_scale_max, MOTION.pinpop_scale)
        self.assertGreater(MOTION.result_slam_scale, 1.0)
        self.assertGreater(MOTION.result_ring_scale, 1.0)
        self.assertLess(MOTION.pinpop_y, 0.0)
        self.assertLess(MOTION.pinpop_fade_at, 1.0)

    def test_the_new_keys_survive_a_round_trip(self):
        data = MOTION.to_dict()
        self.assertIn('pinpop_time', data)
        self.assertIn('perfect_text', data)
        twin = MOTION.__class__().load(data)
        self.assertEqual(twin.pinpop_time, MOTION.pinpop_time)
        self.assertEqual(twin.perfect_text, MOTION.perfect_text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
