"""The Physics Lab calculator model: derivation, locks and conflicts."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from ui import lab_model

CORE = {'v': 7.5, 'angle': -0.4, 'hook': -1.6,
        'a': -0.1962, 'lateral': 0.2}


class TestPlanDerivation(unittest.TestCase):

    def test_the_plan_derives_the_launch_quantities(self):
        plan = lab_model.plan_derived(CORE)
        self.assertAlmostEqual(plan['t'], 2.521852, places=5)
        self.assertAlmostEqual(plan['vx'], -0.052359, places=5)
        self.assertAlmostEqual(plan['spin'], 68.82594, places=4)
        self.assertAlmostEqual(plan['p'], 45.0)
        self.assertAlmostEqual(plan['K'], 168.75)
        self.assertAlmostEqual(plan['friction_scale'], 1.0, places=9)

    def test_head_pin_time_and_its_edge_cases(self):
        self.assertAlmostEqual(lab_model.head_pin_time(7.5, -0.1962),
                               2.521852, places=5)
        self.assertEqual(lab_model.head_pin_time(0.0, -0.1962),
                         float('inf'))
        self.assertGreater(lab_model.head_pin_time(2.0, -1.0),
                           lab_model.head_pin_time(7.5, -1.0))

    def test_the_friction_scale_is_the_deceleration_ratio(self):
        self.assertAlmostEqual(
            lab_model.deceleration_to_scale(-config.ROLLING_FRICTION
                                            * config.GRAVITY), 1.0, places=9)
        self.assertEqual(lab_model.deceleration_to_scale(0.0), 0.0)
        self.assertAlmostEqual(
            lab_model.scale_to_deceleration(1.0),
            -config.ROLLING_FRICTION * config.GRAVITY, places=9)


class TestPlanSolver(unittest.TestCase):

    def test_momentum_and_energy_both_solve_the_speed(self):
        momentum = lab_model.solve_plan(CORE, {'p': 60.0})
        self.assertTrue(momentum['ok'])
        self.assertAlmostEqual(momentum['core']['v'], 10.0, places=9)
        self.assertAlmostEqual(momentum['derived']['K'], 300.0, places=6)
        energy = lab_model.solve_plan(CORE, {'K': 300.0})
        self.assertTrue(energy['ok'])
        self.assertAlmostEqual(energy['core']['v'], 10.0, places=9)
        self.assertAlmostEqual(energy['derived']['p'], 60.0, places=6)

    def test_a_locked_deceleration_lets_time_solve_the_speed(self):
        out = lab_model.solve_plan(CORE, {'a': -0.1962, 't': 3.0})
        self.assertTrue(out['ok'])
        self.assertAlmostEqual(out['derived']['t'], 3.0, places=5)
        self.assertAlmostEqual(out['core']['v'], 6.390967, places=4)

    def test_a_locked_speed_lets_time_solve_the_deceleration(self):
        out = lab_model.solve_plan(CORE, {'v': 7.5, 't': 3.0})
        self.assertTrue(out['ok'])
        self.assertAlmostEqual(out['derived']['t'], 3.0, places=5)
        self.assertAlmostEqual(out['core']['a'], -0.935555, places=4)

    def test_sideways_speed_solves_the_aim_when_speed_is_locked(self):
        out = lab_model.solve_plan(CORE, {'v': 7.5, 'vx': 0.5})
        self.assertTrue(out['ok'])
        self.assertAlmostEqual(out['derived']['vx'], 0.5, places=5)
        self.assertAlmostEqual(out['core']['angle'], 3.822554, places=4)

    def test_total_spin_solves_the_hook_when_speed_is_locked(self):
        out = lab_model.solve_plan(CORE, {'v': 7.5, 'spin': 80.0})
        self.assertTrue(out['ok'])
        self.assertAlmostEqual(out['derived']['spin'], 80.0, places=3)
        self.assertAlmostEqual(out['core']['hook'], -40.81106, places=3)

    def test_incompatible_locks_are_reported(self):
        self.assertFalse(lab_model.solve_plan(
            CORE, {'v': 7.5, 't': 2.5, 'a': -0.4})['ok'])
        self.assertFalse(lab_model.solve_plan(
            CORE, {'p': 45.0, 'K': 200.0})['ok'])

    def test_a_typed_core_value_is_kept_verbatim(self):
        out = lab_model.solve_plan(CORE, {'v': 11.37})
        self.assertTrue(out['ok'])
        self.assertEqual(out['core']['v'], 11.37)
        out = lab_model.solve_plan(CORE, {'angle': -3.25})
        self.assertEqual(out['core']['angle'], -3.25)

    def test_readout_values_accept_the_unit_printed_beside_them(self):
        self.assertEqual(lab_model.parse_readout_value('t', '3 s'), 3.0)
        self.assertEqual(lab_model.parse_readout_value('v', '33m/s'), 33.0)
        self.assertEqual(lab_model.parse_readout_value('a', '-0.2m/s^2'),
                         -0.2)
        self.assertEqual(lab_model.parse_readout_value('a', '-0.2m/s2'), -0.2)
        self.assertEqual(lab_model.parse_readout_value('p', '5kg/ms'), 5.0)
        self.assertEqual(lab_model.parse_readout_value('p', '5 kg m/s'), 5.0)
        self.assertEqual(lab_model.parse_readout_value('K', '10 J'), 10.0)
        self.assertIsNone(lab_model.parse_readout_value('v', '5 bananas'))
        self.assertIsNone(lab_model.parse_readout_value('t', 's'))

    def test_a_single_edit_freezes_every_other_core_value(self):
        momentum = lab_model.solve_plan(CORE, {'p': 5.0})
        self.assertTrue(momentum['ok'])
        self.assertEqual(momentum['core']['v'], 5.0 / config.BALL_MASS)
        self.assertEqual(momentum['core']['angle'], CORE['angle'])
        self.assertEqual(momentum['core']['hook'], CORE['hook'])
        self.assertEqual(momentum['core']['a'], CORE['a'])
        self.assertEqual(momentum['derived']['t'], float('inf'))

        friction = lab_model.solve_plan(CORE, {'a': 0.0})
        self.assertTrue(friction['ok'])
        self.assertEqual(friction['core']['v'], CORE['v'])
        self.assertEqual(friction['core']['angle'], CORE['angle'])
        self.assertEqual(friction['core']['hook'], CORE['hook'])
        self.assertEqual(friction['core']['a'], 0.0)
        self.assertAlmostEqual(friction['derived']['t'], 2.4386667,
                               places=5)

    def test_edits_compose_without_losing_the_earlier_hold(self):
        first = lab_model.solve_plan(CORE, {'a': 0.0})
        second = lab_model.solve_plan(first['core'], {'p': 5.0})
        self.assertTrue(second['ok'])
        self.assertEqual(second['core']['a'], 0.0)
        self.assertAlmostEqual(second['core']['v'], 5.0 / config.BALL_MASS)
        self.assertAlmostEqual(second['derived']['t'], 21.948, places=3)

    def test_sideways_speed_changes_the_aim_only_and_spin_the_hook_only(self):
        sideways = lab_model.solve_plan(CORE, {'vx': 0.5})
        self.assertTrue(sideways['ok'])
        self.assertEqual(sideways['core']['v'], CORE['v'])
        self.assertEqual(sideways['core']['hook'], CORE['hook'])
        self.assertEqual(sideways['core']['a'], CORE['a'])
        self.assertAlmostEqual(sideways['derived']['vx'], 0.5, places=9)

        spin = lab_model.solve_plan(CORE, {'spin': 80.0})
        self.assertTrue(spin['ok'])
        self.assertEqual(spin['core']['v'], CORE['v'])
        self.assertEqual(spin['core']['angle'], CORE['angle'])
        self.assertEqual(spin['core']['a'], CORE['a'])
        self.assertAlmostEqual(spin['derived']['spin'], 80.0, places=6)

    def test_zero_momentum_and_energy_are_at_rest_plans(self):
        for key in ('p', 'K'):
            out = lab_model.solve_plan(CORE, {key: 0.0})
            self.assertTrue(out['ok'], key)
            self.assertEqual(out['core']['v'], 0.0, key)
            self.assertEqual(out['derived']['t'], float('inf'), key)

    def test_locks_fall_back_to_the_alternative_core_value(self):
        speed_held = lab_model.solve_plan(CORE, {'t': 3.0, 'v': 7.5})
        self.assertTrue(speed_held['ok'])
        self.assertEqual(speed_held['core']['v'], 7.5)
        self.assertAlmostEqual(speed_held['core']['a'], -0.9355556,
                               places=6)
        time_held = lab_model.solve_plan(CORE, {'v': 9.0, 't': 3.0})
        self.assertTrue(time_held['ok'])
        self.assertEqual(time_held['core']['v'], 9.0)
        self.assertAlmostEqual(time_held['derived']['t'], 3.0, places=6)
        decel_held = lab_model.solve_plan(CORE, {'t': 3.0, 'a': -0.4})
        self.assertTrue(decel_held['ok'])
        self.assertEqual(decel_held['core']['a'], -0.4)
        self.assertAlmostEqual(decel_held['derived']['t'], 3.0, places=6)

    def test_a_lock_that_cannot_be_honoured_names_the_target(self):
        out = lab_model.solve_plan(CORE, {'v': 7.5, 'p': 5.0})
        self.assertFalse(out['ok'])
        self.assertEqual(out['conflict'], 'p')
        self.assertEqual(out['core']['v'], CORE['v'])


if __name__ == '__main__':
    unittest.main()
