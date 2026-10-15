"""Tests for Equation Mode's interactive challenges.

Two layers, both required by the redesign:

* **The model** (:mod:`game.challenges`) is checked against formulas written
  independently here, from the values the challenge publishes (``given_values``)
  - so a displayed number can never disagree with the answer it is marked
  against. Pure Python, milliseconds.
* **The engine** (:mod:`physics`) is the judge: every challenge's expected
  value is launched through the real ``Deck`` on the challenge's own rack, and
  the target pin must actually fall (or the measured speed must pass). A
  clearly wrong value must fail, and the flagship spin challenge must show the
  three outcomes the design promises: insufficient spin misses, the right spin
  hits, excessive spin gutters.

Run with:  ``python -m unittest tests.test_challenges -v``
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
import physics
from game import challenges as ch

R = config.BALL_RADIUS
MU_K = config.SLIDING_FRICTION
MU_R = config.ROLLING_FRICTION
G = config.GRAVITY
DRIFT_K1 = (2.0 / 7.0) * R                        # m/s per rad/s
DRIFT_K2 = (2.0 / 49.0) * R ** 2 / (MU_K * G)     # m per (rad/s)^2
INERTIA = (2.0 / 5.0) * config.BALL_MASS * R ** 2


def _spin_for(drift, speed, distance):
    """Independent inverse of the drift model (written from the textbook form)."""
    b = DRIFT_K1 * (distance / speed)
    root = math.sqrt(b * b - 4.0 * DRIFT_K2 * abs(drift))
    magnitude = (b - root) / (2.0 * DRIFT_K2)
    return -math.copysign(magnitude, drift)


def _pin_speed_constant():
    """(1 + e) / (m_p (1/m + 2/m_p)): the engine's ball-speed -> pin-speed."""
    inverse = 1.0 / config.BALL_MASS + 2.0 / config.PIN_MASS
    return (1.0 + config.RESTITUTION_BALL_PIN) / inverse / config.PIN_MASS


class TestBankIntegrity(unittest.TestCase):
    def test_ten_challenges_in_progressive_order(self):
        self.assertEqual(len(ch.CHALLENGES), 10)
        ids = [challenge.id for challenge in ch.CHALLENGES]
        self.assertEqual(len(ids), len(set(ids)))
        cases = [challenge.case for challenge in ch.CHALLENGES]
        self.assertEqual(cases, sorted(cases, key=cases.index),
                         'challenges leave and re-enter a case')
        self.assertEqual(cases[0], ch.CASE_AIM)
        self.assertEqual(cases[-1], ch.CASE_IMPACT)

    def test_every_challenge_is_complete(self):
        for challenge in ch.CHALLENGES:
            self.assertTrue(challenge.title.strip(), challenge.id)
            self.assertTrue(challenge.brief.strip(), challenge.id)
            self.assertTrue(challenge.target.strip(), challenge.id)
            self.assertTrue(challenge.equation.strip(), challenge.id)
            self.assertTrue(challenge.given, challenge.id)
            self.assertTrue(challenge.steps, challenge.id)
            self.assertTrue(challenge.working.strip(), challenge.id)
            self.assertTrue(challenge.rack, challenge.id)

    def test_the_answer_is_something_the_player_can_type(self):
        for challenge in ch.CHALLENGES:
            control = challenge.control
            self.assertLess(control.low, control.high, challenge.id)
            self.assertGreaterEqual(challenge.answer, control.low - 1e-9,
                                    challenge.id)
            self.assertLessEqual(challenge.answer, control.high + 1e-9,
                                 challenge.id)
            self.assertTrue(control.unit.strip(), challenge.id)
            self.assertTrue(control.label.strip(), challenge.id)

    def test_targets_reference_the_rack(self):
        for challenge in ch.CHALLENGES:
            for index in challenge.targets:
                self.assertTrue(0 <= index < len(challenge.rack),
                                challenge.id)
            self.assertGreater(challenge.aim_z(), config.HEAD_PIN_Z - 1e-6,
                               challenge.id)

    def test_racks_use_regulation_positions(self):
        """Challenges stand real pins in real spots, never invented ones."""
        regulation = {(round(x, 4), round(z, 4))
                      for _label, x, z in ch.PIN_SLOTS}
        for challenge in ch.CHALLENGES:
            for _label, x, z in challenge.rack:
                self.assertIn((round(x, 4), round(z, 4)), regulation,
                              f'{challenge.id} uses a non-regulation pin spot')

    def test_the_speed_challenges_state_their_thresholds(self):
        for challenge in ch.CHALLENGES:
            if challenge.kind in ('arrival', 'pin_speed'):
                self.assertGreater(challenge.threshold, 0.0, challenge.id)
                self.assertTrue(challenge.targets, challenge.id)

    def test_the_model_values_are_the_ones_on_screen(self):
        """Every number the answer is computed from must be shown to the player."""
        for challenge in ch.CHALLENGES:
            shown = ' '.join(value for _name, value in challenge.given)
            shown += ' ' + challenge.brief + ' ' + challenge.equation_note
            for key, value in challenge.given_values.items():
                if not isinstance(value, (int, float)):
                    continue
                candidates = {f'{value:g}', f'{value:.1f}', f'{value:.2f}',
                              f'{value:.3f}', f'{value:.4f}', f'{value:.5f}'}
                if abs(value) < 1e-9:
                    candidates.add('0')
                self.assertTrue(
                    any(candidate in shown for candidate in candidates),
                    f'{challenge.id}: {key}={value} is not shown to the player')

    def test_every_challenge_ties_its_equation_to_the_simulation(self):
        """The model equations must name a mechanism the engine implements."""
        for challenge in ch.CHALLENGES:
            self.assertIn('=', challenge.equation, challenge.id)
            text = (challenge.equation + ' ' + challenge.equation_note).lower()
            self.assertTrue(
                any(word in text for word in
                    ('skid', 'friction', 'mu_', 'impulse', 'moment of inertia',
                     'resistance', 'atan', 'omega', 'tau', 'straight',
                     'rolling')),
                f'{challenge.id}: no physical mechanism named')


class TestModelFormulas(unittest.TestCase):
    """Each answer recomputed here from the published givens."""

    def expected(self, challenge):
        formulas = {
            'angle-to-pin': lambda g: math.degrees(
                math.atan2(g['x_pin'] - g['x0'], g['d'])),
            'release-position': lambda g: g['x_pin'] - g['d'] * math.tan(
                math.radians(g['angle_deg'])),
            'arrival-speed': lambda g: math.sqrt(g['v'] ** 2 + 2 * g['a']
                                                 * g['d']),
            'speed-to-curve': lambda g: (
                DRIFT_K1 * abs(g['spin']) * g['d']
                / (abs(g['D']) + DRIFT_K2 * g['spin'] ** 2)),
            'spin-to-pin': lambda g: _spin_for(g['D'], g['v'], g['d']),
            'spin-to-corner': lambda g: _spin_for(g['D'], g['v'], g['d']),
            'spin-to-left': lambda g: _spin_for(g['D'], g['v'], g['d']),
            'spin-up-torque': lambda g: (
                INERTIA * abs(_spin_for(abs(ch.SLOTS['7'][0]), 6.0,
                                        ch.SLOTS['7'][1])) / g['dt']),
            'pin-speed': lambda g: math.sqrt(
                (g['target'] * g['m_p'] * (1.0 / g['m'] + 2.0 / g['m_p'])
                 / (1.0 + g['e'])) ** 2
                + 2 * MU_R * G * g['d']),
        }
        return formulas.get(challenge.id)

    def test_answers_match_independent_formulas(self):
        for challenge in ch.CHALLENGES:
            formula = self.expected(challenge)
            if formula is None:
                # angular-momentum is checked in its own test below (it needs
                # the spin that solves the drift first).
                self.assertEqual(challenge.id, 'angular-momentum')
                continue
            expected = formula(challenge.given_values)
            self.assertAlmostEqual(
                challenge.answer, expected,
                delta=max(1e-6, abs(expected) * 0.005),
                msg=f'{challenge.id}: {challenge.answer} != {expected}')

    def test_angular_momentum_challenge(self):
        challenge = ch.challenge_by_id('angular-momentum')
        givens = challenge.given_values
        spin = _spin_for(abs(ch.SLOTS['10'][0]), 6.0, ch.SLOTS['10'][1])
        self.assertAlmostEqual(givens['L'], INERTIA * abs(spin),
                               delta=abs(spin) * 0.001)
        self.assertLess(challenge.answer, 0.0,
                        'the 10 pin is right of centre: the spin must be negative')

    def test_spin_for_drift_inverts_the_drift_model(self):
        for spin in (-5.0, -3.0, -1.0, 1.0, 2.5, 4.0):
            drift = ch.hook_drift(spin, 7.0, 18.79)
            recovered = ch.spin_for_drift(drift, 7.0, 18.79)
            self.assertAlmostEqual(recovered, spin, delta=1e-6)

    def test_drift_is_linear_in_spin_at_small_values(self):
        """D proportional to omega to first order, and monotone in |omega|."""
        previous = 0.0
        for spin in (1.0, 2.0, 3.0, 4.0, 5.0):
            drift = ch.hook_drift(-spin, 7.0, 18.29)
            self.assertGreater(drift, previous)
            previous = drift
        small = ch.hook_drift(-1.0, 7.0, 18.29)
        self.assertAlmostEqual(small, DRIFT_K1 * (18.29 / 7.0), delta=0.01)

    def test_curvature_depends_on_more_than_spin(self):
        """The same spin curves differently at different speeds (design rule)."""
        slow = ch.hook_drift(-4.0, 5.0, 18.29)
        fast = ch.hook_drift(-4.0, 9.0, 18.29)
        self.assertGreater(slow, fast)
        self.assertGreater(abs(slow - fast), 0.15)

    def test_slip_and_pin_speed_relations(self):
        self.assertAlmostEqual(
            ch.pin_speed_from_impact(3.0), _pin_speed_constant() * 3.0)
        self.assertAlmostEqual(
            ch.impact_speed_for_pin_speed(2.5),
            2.5 / _pin_speed_constant())
        self.assertAlmostEqual(
            ch.spin_from_torque(ch.torque_for_spin(4.71, 0.2), 0.2), 4.71)

    def test_the_angle_challenge_does_not_depend_on_speed(self):
        challenge = ch.challenge_by_id('angle-to-pin')
        positions = challenge.positions()
        _position, _speed, angle, _spin = challenge.launch_values(
            challenge.answer)
        expected = math.degrees(math.atan2(
            positions[0][0], positions[0][1]))
        self.assertAlmostEqual(angle, expected, delta=0.01)


class TestMarking(unittest.TestCase):
    """The outcome text and flags for synthetic measurements."""

    def measurement(self, challenge, **kwargs):
        defaults = dict(value=0.0, launch_x=challenge.fixed.get('position', 0.0),
                        path=())
        defaults.update(kwargs)
        return ch.RollMeasurement(**defaults)

    def test_hit_challenge_solved_and_missed(self):
        challenge = ch.challenge_by_id('spin-to-pin')
        solved = challenge.evaluate(self.measurement(
            challenge, value=challenge.answer,
            targets_down=(True,), pins_down=(True,), knockdowns=1,
            landing_x=challenge.aim_x(), pass_error=0.01))
        self.assertTrue(solved.solved)
        self.assertIn('DOWN', solved.headline)
        missed = challenge.evaluate(self.measurement(
            challenge, value=0.0, targets_down=(False,), pins_down=(False,),
            knockdowns=0, landing_x=0.0, pass_error=0.305))
        self.assertFalse(missed.solved)
        self.assertIn('MISSED', missed.headline)
        self.assertTrue(any('under' in line.lower() for line in missed.lines),
                        'the miss must explain that the spin was too small')

    def test_gutter_is_reported_as_excessive_spin(self):
        challenge = ch.challenge_by_id('spin-to-corner')
        outcome = challenge.evaluate(self.measurement(
            challenge, value=-8.0, targets_down=(False,), pins_down=(False,),
            knockdowns=0, gutter=True, gutter_z=15.4))
        self.assertFalse(outcome.solved)
        self.assertIn('GUTTER', outcome.headline)
        self.assertTrue(any('spin' in line.lower() for line in outcome.lines))

    def test_arrival_threshold(self):
        challenge = ch.challenge_by_id('arrival-speed')
        good = challenge.evaluate(self.measurement(
            challenge, value=challenge.answer, targets_down=(True,),
            pins_down=(True,), knockdowns=1, impact_speed=6.3))
        self.assertTrue(good.solved)
        slow = challenge.evaluate(self.measurement(
            challenge, value=5.0, targets_down=(True,), pins_down=(True,),
            knockdowns=1, impact_speed=5.4))
        self.assertFalse(slow.solved)
        self.assertIn('SLOW', slow.headline)

    def test_pin_speed_threshold(self):
        challenge = ch.challenge_by_id('pin-speed')
        good = challenge.evaluate(self.measurement(
            challenge, value=challenge.answer, targets_down=(True,),
            pins_down=(True,), knockdowns=1, impact_speed=3.6,
            pin_speed=2.6))
        self.assertTrue(good.solved)
        soft = challenge.evaluate(self.measurement(
            challenge, value=4.0, targets_down=(True,), pins_down=(True,),
            knockdowns=1, impact_speed=3.0, pin_speed=2.0))
        self.assertFalse(soft.solved)
        self.assertIn('SOFT', soft.headline)

    def test_torque_derives_the_spin_it_reports(self):
        challenge = ch.challenge_by_id('spin-up-torque')
        text = challenge.derived_text(challenge.answer)
        self.assertIn('omega', text)
        self.assertIn('tau', text)
        spin = ch.spin_from_torque(challenge.answer, challenge.spin_up_time)
        self.assertIn(f'{spin:.3g}', text)


# ---------------------------------------------------------------------------
# The engine layer: the real Deck is the judge
# ---------------------------------------------------------------------------
def simulate(challenge, value, track_pin=False):
    """Run the challenge's own launch through the shared simulator.

    With ``track_pin=True`` the peak linear speed of any pin during the roll is
    measured at the physics sub-step rate and returned alongside the deck (the
    pin has long since stopped by the time the roll settles).
    """
    position, speed, angle, spin = challenge.launch_values(value)
    deck = physics.Deck()
    deck.set_rack(list(challenge.positions()))
    deck.begin_roll()
    deck.ball.launch(speed=speed, lateral_position=position,
                     launch_angle=math.radians(angle), spin_omega=spin)
    deck.record_start()
    peak = 0.0
    time = 0.0
    while time < 25.0:
        if deck.ball_done:
            if deck.quiet():
                break
            deck.settle(config.PHYSICS_SUBSTEP)
        else:
            deck.advance(config.PHYSICS_SUBSTEP)
        if track_pin:
            peak = max(peak, *(math.hypot(pin.velocity[0], pin.velocity[2])
                               for pin in deck.pins))
        time += config.PHYSICS_SUBSTEP
    if track_pin:
        return deck, peak
    return deck


def targets_down(deck, challenge):
    return tuple(index in deck.roll_down for index in challenge.targets)


class TestEngineVerification(unittest.TestCase):
    """Every expected answer must solve its challenge in the real engine."""

    def test_expected_values_solve_their_challenges(self):
        for challenge in ch.CHALLENGES:
            deck = simulate(challenge, challenge.answer)
            downs = targets_down(deck, challenge)
            if challenge.kind == 'hit':
                self.assertTrue(all(downs),
                                f'{challenge.id}: the expected value missed')
            elif challenge.kind == 'arrival':
                self.assertIsNotNone(deck.impact_speed, challenge.id)
                self.assertGreaterEqual(
                    deck.impact_speed + 1e-6, challenge.threshold,
                    f'{challenge.id}: arrived slower than the threshold')
                self.assertTrue(all(downs), challenge.id)
            else:
                self.assertIsNotNone(deck.impact_speed, challenge.id)
                pin_speed = ch.pin_speed_from_impact(deck.impact_speed)
                self.assertGreaterEqual(
                    pin_speed + 1e-6, challenge.threshold,
                    f'{challenge.id}: the pin left slower than the threshold')

    def test_wrong_values_fail_clearly(self):
        wrong = {
            'angle-to-pin': 0.0,            # no aim: 0.46 m wide of the pin
            'release-position': 0.30,       # stands far too far right
            'arrival-speed': 5.0,           # arrives below 6.0 m/s
            'speed-to-curve': 4.5,          # too slow: over-curves into the gutter
            'spin-to-pin': 0.0,             # no hook: 0.31 m wide
            'spin-to-corner': 0.0,          # no hook: 0.46 m wide
            'spin-to-left': 0.0,            # no hook
            'angular-momentum': 0.0,        # no spin
            'spin-up-torque': 0.0,          # no torque
            'pin-speed': 4.0,               # pin leaves below 2.5 m/s
        }
        for challenge in ch.CHALLENGES:
            value = wrong[challenge.id]
            deck = simulate(challenge, value)
            downs = targets_down(deck, challenge)
            if challenge.kind == 'hit':
                self.assertFalse(all(downs),
                                 f'{challenge.id}: {value} should miss')
            elif challenge.kind == 'arrival':
                arrived = deck.impact_speed or 0.0
                self.assertLess(arrived, challenge.threshold, challenge.id)
            else:
                pin_speed = (ch.pin_speed_from_impact(deck.impact_speed)
                             if deck.impact_speed is not None else 0.0)
                self.assertLess(pin_speed, challenge.threshold, challenge.id)

    def test_the_flag_example_three_ways(self):
        """Insufficient spin misses, the calculated spin hits, excess gutters."""
        challenge = ch.challenge_by_id('spin-to-corner')
        insufficient = simulate(challenge, -1.5)
        self.assertFalse(all(targets_down(insufficient, challenge)))
        self.assertFalse(insufficient.ball.in_gutter)
        correct = simulate(challenge, challenge.answer)
        self.assertTrue(all(targets_down(correct, challenge)))
        excessive = simulate(challenge, -7.5)
        self.assertFalse(all(targets_down(excessive, challenge)))
        self.assertTrue(excessive.ball.in_gutter,
                        'over-spin must put the ball in the gutter')

    def test_the_pin_speed_challenge_matches_the_measured_pin(self):
        """The model's v_pin must agree with the pin the engine actually moved."""
        challenge = ch.challenge_by_id('pin-speed')
        deck, measured = simulate(challenge, challenge.answer, track_pin=True)
        predicted = ch.pin_speed_from_impact(deck.impact_speed)
        self.assertAlmostEqual(measured, predicted, delta=0.25,
                               msg=f'pin moved at {measured}, model said '
                                   f'{predicted}')

    def test_the_torque_mapping_launches_the_spin_it_implies(self):
        challenge = ch.challenge_by_id('spin-up-torque')
        _position, _speed, _angle, spin = challenge.launch_values(
            challenge.answer)
        self.assertAlmostEqual(
            spin, ch.spin_from_torque(challenge.answer, challenge.spin_up_time),
            places=6)
        deck = simulate(challenge, challenge.answer)
        self.assertAlmostEqual(deck.ball.spin_omega, spin, places=6)

    def test_the_drift_the_challenges_claim_matches_the_engine(self):
        """For every spin/position challenge, the measured drift matches the model."""
        for challenge in ch.CHALLENGES:
            if (challenge.kind != 'hit'
                    or challenge.control.key in ('angle', 'position')):
                continue
            deck = simulate(challenge, challenge.answer)
            if deck.ball.in_gutter:
                continue
            position, speed, _angle, spin = challenge.launch_values(
                challenge.answer)
            model = abs(ch.hook_drift(spin, speed, challenge.aim_z()))
            samples = [x for _t, x, z in deck.trajectory
                       if abs(z - challenge.aim_z()) < 0.12]
            if not samples:
                continue
            measured = abs(max(samples, key=abs) - position)
            self.assertAlmostEqual(measured, model, delta=0.05,
                                   msg=f'{challenge.id}: model {model:.3f} vs '
                                       f'engine {measured:.3f}')


if __name__ == '__main__':
    unittest.main(verbosity=2)
