"""Dump ORIGINAL Python results for scoring, the challenge bank and questions.

Run from the project root:  python tools/fidelity_dump2.py tools/logic_py.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import scoring
from game import challenges as ch
from game import questions as q


ROLL_SEQUENCES = [
    [10] * 12,
    [9, 0] * 9 + [9, 0],
    [1] * 20,
    [0] * 20,
    [7, 3, 10, 4, 6, 5, 5, 8, 2, 10, 9, 1, 6, 2, 10, 10, 7, 3],
    [3, 4] * 10,
    [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
    [0, 10, 10, 5, 5, 0, 0, 10, 2, 8, 10, 4, 6, 10],
]


def dump_scoring():
    out = []
    for rolls in ROLL_SEQUENCES:
        game = scoring.BowlingGame()
        try:
            for pins in rolls:
                game.record_roll(pins)
                if game.is_complete:
                    break
        except Exception as exc:                 # noqa: BLE001 - report, don't fail
            out.append({'rolls': rolls, 'error': str(exc)})
            continue
        out.append({
            'rolls': game.rolls,
            'frames': [game.frame_rolls(f) for f in range(1, 11)],
            'marks': [game.frame_marks(f) for f in range(1, 11)],
            'scores': game.frame_score(1) is not None and [
                (None if s is None else s) for s in game.cumulative_scores()],
            'cumulative': [None if s is None else s for s in game.cumulative_scores()],
            'current': game.current_score,
            'total': game.total_score,
            'complete': game.is_complete,
            'current_frame': game.current_frame_number,
            'standing': game.standing_pins(),
        })
    return out


def dump_challenges():
    out = []
    for challenge in ch.CHALLENGES:
        out.append({
            'id': challenge.id,
            'answer': round(challenge.answer, 9),
            'expected': challenge.expected_text(),
            'targets': list(challenge.targets),
            'rack': [list(pin) for pin in challenge.rack],
            'aim_x': round(challenge.aim_x(), 9),
            'aim_z': round(challenge.aim_z(), 9),
            'launch_values': [round(v, 9) for v in challenge.launch_values(challenge.answer)],
            'equation': challenge.equation,
            'working': challenge.working,
            'brief': challenge.brief,
            'steps': list(challenge.steps),
        })
    return out


def dump_questions():
    samples = [
        ('momentum', 'momentum'), ('newton', 'newton'), ('0', '0 m/s^2'),
        ('backwards', 'backward'), ('2 kg ball', 'the 2 kg ball'), ('equal', 'equal'),
        ('6', '18/3'), ('acceleration', 'a'), ('2.0', '2 m/s^2'), ('p', 'impulse'),
    ]
    out = []
    for text, label in samples:
        question = q.TRIVIA_QUESTIONS[len(out) % len(q.TRIVIA_QUESTIONS)]
        feedback = q.check_answer(question, text)
        out.append({
            'label': label,
            'correct': feedback.correct,
            'summary': feedback.summary,
            'expected': feedback.expected,
            'detail': feedback.detail,
        })
    return out


def main():
    payload = {
        'scoring': dump_scoring(),
        'challenges': dump_challenges(),
        'questions': dump_questions(),
    }
    target = sys.argv[1] if len(sys.argv) > 1 else None
    text = json.dumps(payload, indent=1)
    if target:
        with open(target, 'w', encoding='utf-8') as handle:
            handle.write(text)
    else:
        sys.stdout.write(text)


if __name__ == '__main__':
    main()
