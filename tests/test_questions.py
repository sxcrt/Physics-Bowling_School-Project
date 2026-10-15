"""Tests for the Physics Trivia bank and the shared answer checking.

Physics Trivia is the *knowledge* mode: concept questions with word or numeric
answers, marked by :func:`game.questions.check_answer`. Equation Mode's
interactive challenges are tested separately in ``tests/test_challenges.py``
(the bank there is marked by the simulation, not by string comparison).

Pure Python: no engine, no window, so these run in milliseconds.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config  # noqa: F401  (imported for the tests' patch targets)
from game import questions
from game.questions import (TRIVIA_QUESTIONS, check_answer, normalise_unit,
                            parse_answer)


class TestTriviaBankIntegrity(unittest.TestCase):
    def test_trivia_bank_has_ten_questions(self):
        self.assertGreaterEqual(len(TRIVIA_QUESTIONS), 10)

    def test_every_question_is_answerable_and_explained(self):
        for question in TRIVIA_QUESTIONS:
            self.assertTrue(question.prompt.strip())
            self.assertTrue(str(question.answer).strip() != '')
            self.assertTrue(question.working.strip(),
                            f'{question.prompt!r} has no explanation')
            if question.is_numeric:
                self.assertTrue(question.unit or question.answer == 0,
                                f'{question.prompt!r} has no unit')

    def test_questions_cover_the_concepts_the_mode_advertises(self):
        """The bank must test concepts, not ask for a bowling calculation."""
        concepts = {question.concept.lower() for question in TRIVIA_QUESTIONS}
        for wanted in ('momentum', 'friction', 'acceleration'):
            self.assertTrue(any(wanted in concept for concept in concepts),
                            f'no question about {wanted}: {sorted(concepts)}')

    def test_no_question_asks_the_player_to_steer_the_ball(self):
        """Trivia answers unlock a throw; they never become launch data."""
        for question in TRIVIA_QUESTIONS:
            for field in ('spin', 'torque', 'drift'):
                self.assertNotIn(field, question.prompt.lower(),
                                 f'{question.prompt!r} reads like a challenge')


class TestNumericAnswers(unittest.TestCase):
    question = TRIVIA_QUESTIONS[6]      # "18 m in 3 s" -> 6 m/s

    def test_exact_value(self):
        self.assertTrue(check_answer(self.question, '6'))

    def test_equivalent_forms(self):
        for text in ('6', '6.0', '6.00', '6 m/s', '6.0 m/s', ' 6   m/s ',
                     '6.00 m/s', '6.0m/s'):
            self.assertTrue(check_answer(self.question, text),
                            f'{text!r} should be accepted')

    def test_scientific_notation(self):
        self.assertTrue(check_answer(self.question, '6.0e0 m/s'))

    def test_rounding_inside_the_tolerance(self):
        tight = questions.Question(prompt='p', answer=64.22, unit='rad/s',
                                   tolerance=0.03, working='w')
        self.assertTrue(check_answer(tight, '64.2 rad/s'))
        self.assertTrue(check_answer(tight, '64.0 rad/s'))

    def test_wrong_value_is_rejected(self):
        self.assertFalse(check_answer(self.question, '7'))
        self.assertFalse(check_answer(self.question, '60'))
        self.assertFalse(check_answer(self.question, '-6'))

    def test_wrong_unit_is_rejected(self):
        feedback = check_answer(self.question, '6 seconds')
        self.assertFalse(feedback.correct)
        self.assertIn('unit', feedback.summary.lower())

    def test_missing_number_is_rejected(self):
        self.assertFalse(check_answer(self.question, 'about six'))

    def test_empty_answer_is_rejected(self):
        self.assertFalse(check_answer(self.question, '   '))

    def test_zero_question_accepts_zero_only(self):
        zero = TRIVIA_QUESTIONS[2]      # constant speed -> a = 0
        self.assertTrue(check_answer(zero, '0'))
        self.assertTrue(check_answer(zero, '0 m/s^2'))
        self.assertFalse(check_answer(zero, '0.5 m/s^2'))


class TestUnitNormalisation(unittest.TestCase):
    def test_equivalent_unit_spellings_are_the_same(self):
        forms = ('kg*m/s', 'kg m/s', 'kg·m/s', 'kgm/s', 'kg m s^-1')
        normalised = {normalise_unit(form) for form in forms}
        self.assertEqual(len(normalised), 1, normalised)

    def test_speed_unit_forms_are_accepted_by_the_question(self):
        speed = TRIVIA_QUESTIONS[6]
        for text in ('6 m/s', '6 m s^-1', '6 ms-1'):
            self.assertTrue(check_answer(speed, text), text)

    def test_parse_answer_splits_value_and_unit(self):
        value, unit = parse_answer('  42 kg m/s ')
        self.assertAlmostEqual(value, 42.0)
        self.assertEqual(unit, normalise_unit('kg m/s'))

    def test_negative_values_are_parsed(self):
        value, unit = parse_answer('-3.5 m/s')
        self.assertAlmostEqual(value, -3.5)
        self.assertEqual(unit, 'm/s')


class TestTextAnswers(unittest.TestCase):
    def test_exact_and_alias_forms(self):
        question = TRIVIA_QUESTIONS[0]    # momentum
        for text in ('momentum', 'Momentum', ' MOMENTUM ', 'linear momentum',
                     'p'):
            self.assertTrue(check_answer(question, text), f'{text!r}')
        for text in ('energy', 'speed', 'mass velocity', 'force'):
            self.assertFalse(check_answer(question, text), f'{text!r}')

    def test_kinetic_energy_comparison_question(self):
        question = TRIVIA_QUESTIONS[4]
        self.assertTrue(check_answer(question, '2 kg'))
        self.assertTrue(check_answer(question, 'the 2kg ball'))
        self.assertFalse(check_answer(question, '6 kg ball'))


class TestFeedbackContent(unittest.TestCase):
    def test_correct_feedback_names_the_answer(self):
        feedback = check_answer(TRIVIA_QUESTIONS[6], '6')
        self.assertTrue(feedback.correct)
        self.assertIn('6', feedback.summary)

    def test_wrong_feedback_shows_the_answer_and_the_reason(self):
        feedback = check_answer(TRIVIA_QUESTIONS[6], '12')
        self.assertFalse(feedback.correct)
        self.assertTrue(feedback.working)
        self.assertIn('6', feedback.expected)


if __name__ == '__main__':
    unittest.main(verbosity=2)
