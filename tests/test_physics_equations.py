"""The inverse physics engine: every equation in every direction."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ui import lab_model
from ui import physics_equations as pe

SAMPLES = {
    'uniform_motion': {'d': 18.3, 'v': 7.5, 't': 18.3 / 7.5},
    'velocity_time': {'u': 2.0, 'v': 10.0, 'a': 2.0, 't': 4.0},
    'displacement_time': {'d': 18.29, 'u': 7.5, 'a': -0.1962,
                          't': 2.521852035647966},
    'velocity_displacement': {'u': 2.0, 'v': 10.0, 'a': 2.0, 'd': 24.0},
    'force': {'F': 12.0, 'm': 4.0, 'a': 3.0},
    'work': {'W': 12.0, 'F': 4.0, 'd': 3.0},
    'kinetic_energy': {'K': 168.75, 'm': 6.0, 'v': 7.5},
    'torque': {'tau': 12.0, 'F': 4.0, 'r': 3.0},
    'angular_velocity': {'v': 12.0, 'omega': 4.0, 'r': 3.0},
    'friction_deceleration': {'a': 0.1962, 'mu': 0.02, 'g': 9.81},
    'stopping_distance': {'d': 56.25 / (2 * 0.02 * 9.81), 'v': 7.5,
                          'mu': 0.02, 'g': 9.81},
    'stopping_time': {'t': 7.5 / (0.02 * 9.81), 'v': 7.5,
                      'mu': 0.02, 'g': 9.81},
    'sideways_velocity': {'vx': 0.5, 'v': 7.5,
                          'theta': math.degrees(math.asin(0.5 / 7.5))},
}


class TestEveryEquation(unittest.TestCase):

    def test_every_equation_solves_in_every_direction(self):
        for equation in pe.EQUATIONS:
            sample = SAMPLES[equation['id']]
            for find in equation['variables']:
                given = {symbol: sample[symbol]
                         for symbol in equation['variables'] if symbol != find}
                result = pe.solve_equation(equation['id'], find, given)
                self.assertTrue(result['ok'],
                                f'{equation["id"]}.{find}: {result.get("message")}')
                self.assertTrue(math.isfinite(result['value']),
                                f'{equation["id"]}.{find}')
                self.assertAlmostEqual(
                    result['value'], sample[find],
                    delta=1e-3 * max(1.0, abs(sample[find])),
                    msg=f'{equation["id"]}.{find}')
                self.assertTrue(result['formula'])
                self.assertTrue(result['rearranged'])
                self.assertTrue(result['substitution'])
                self.assertTrue(result['answer'].startswith(f'{find} ='))

    def test_the_user_facing_example(self):
        result = pe.solve_equation('uniform_motion', 't',
                                   {'d': 18.3, 'v': 7.5})
        self.assertTrue(result['ok'])
        self.assertEqual(result['rearranged'], 't = d / v')
        self.assertEqual(result['substitution'], 't = 18.3 / 7.5')
        self.assertEqual(result['answer'], 't = 2.44 s')

    def test_missing_information_is_named(self):
        result = pe.solve_equation('force', 'a', {'F': 12})
        self.assertFalse(result['ok'])
        self.assertEqual(result['missing'], ['m'])
        self.assertIn('Mass (m) is required', result['message'])

    def test_a_fallback_equation_is_used(self):
        result = pe.solve_equation('stopping_time', 't',
                                   {'d': 18.3, 'v': 7.5})
        self.assertTrue(result['ok'])
        self.assertEqual(result['equationId'], 'uniform_motion')
        self.assertEqual(result['requestedEquationId'], 'stopping_time')
        self.assertIn('Used Uniform motion', result['note'])

    def test_apply_hints_are_conservative(self):
        speed = pe.solve_equation('kinetic_energy', 'v',
                                  {'K': 168.75, 'm': 6})
        self.assertEqual(speed['apply']['speed'], 7.5)
        aim = pe.solve_equation('sideways_velocity', 'theta',
                                {'vx': 0.5, 'v': 7.5})
        self.assertAlmostEqual(aim['apply']['aim'], 3.82255, places=4)
        decel = pe.solve_equation('displacement_time', 'a',
                                  {'d': 18.29, 'u': 7.5, 't': 3.0})
        self.assertAlmostEqual(decel['apply']['deceleration'],
                               -0.9355556, places=6)
        positive = pe.solve_equation('velocity_time', 'a',
                                     {'u': 2.0, 'v': 10.0, 't': 4.0})
        self.assertIn('unsupported', positive['apply'])
        analytical = pe.solve_equation('uniform_motion', 't',
                                       {'d': 18.3, 'v': 7.5})
        self.assertEqual(analytical['apply'], {})

    def test_analytical_time_agrees_with_the_lab_plan(self):
        for accel in (0.0, -0.1962, -0.5):
            plan = lab_model.head_pin_time(7.5, accel)
            result = pe.solve_equation(
                'displacement_time', 't',
                {'d': 18.29, 'u': 7.5, 'a': accel})
            self.assertTrue(result['ok'])
            self.assertAlmostEqual(result['value'], plan, places=3)

    def test_undefined_divisions_and_impossible_travel_are_reported(self):
        zero = pe.solve_equation('uniform_motion', 't', {'d': 18.3, 'v': 0})
        self.assertFalse(zero['ok'])
        stopped = pe.solve_equation('displacement_time', 't',
                                    {'d': 40, 'u': 2, 'a': -1})
        self.assertFalse(stopped['ok'])
        self.assertTrue('never reaches' in stopped['message']
                        or 'No positive' in stopped['message'])

    def test_physically_invalid_negatives_are_rejected(self):
        mass = pe.solve_equation('force', 'a', {'F': 12, 'm': -4})
        self.assertFalse(mass['ok'])
        self.assertIn('greater than zero', mass['message'])
        friction = pe.solve_equation('friction_deceleration', 'mu',
                                     {'a': -0.2, 'g': 9.81})
        self.assertFalse(friction['ok'])
        energy = pe.solve_equation('kinetic_energy', 'v',
                                   {'K': -1, 'm': 6})
        self.assertFalse(energy['ok'])
        radius = pe.solve_equation('torque', 'r', {'tau': -1, 'F': 1})
        self.assertFalse(radius['ok'])

    def test_multiple_positive_times_are_reported(self):
        # u = 10, a = -2, d = 20 => roots 2.76... and 7.23... s.
        result = pe.solve_equation('displacement_time', 't',
                                   {'d': 20, 'u': 10, 'a': -2})
        self.assertTrue(result['ok'])
        self.assertGreaterEqual(len(result['alternatives']), 1)
        self.assertNotAlmostEqual(result['value'],
                                  result['alternatives'][0]['value'])


if __name__ == '__main__':
    unittest.main()
