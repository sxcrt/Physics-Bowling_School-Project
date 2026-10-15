"""Dump the ORIGINAL Python physics results for the fidelity comparison.

Run from the project root:  python tools/fidelity_dump.py > physics_py.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import physics

CASES = [
    # (name, speed, lateral, launch_angle_deg, spin)
    ('centre_7.5', 7.5, 0.0, 0.0, 0.0),
    ('centre_8', 8.0, 0.0, 0.0, 0.0),
    ('angle_to_pin', 7.0, 0.0, 1.37, 0.0),
    ('spin_to_corner', 6.0, 0.0, 0.0, -4.71),
    ('spin_to_left', 6.0, 0.0, 0.0, 4.71),
    ('pocket', 7.5, 0.15, -1.0, -1.6),
    ('speed_to_curve', 6.352, 0.0, 0.0, -5.0),
    ('pin_speed', 4.42, 0.0, 0.0, 0.0),
    ('max_speed', 12.0, 0.0, 0.0, 0.0),
    ('min_speed', 2.0, 0.0, 0.0, 0.0),
    ('mixed', 7.5, -0.3, -2.0, 3.0),
    ('gutter', 8.0, 0.0, 2.0, -5.0),
]


def main():
    out = {}
    for name, speed, lateral, angle_deg, spin in CASES:
        result = physics.simulate_roll(
            speed=speed, lateral_position=lateral,
            launch_angle=math_radians(angle_deg), spin_omega=spin, record=True)
        deck = result.deck
        out[name] = {
            'knockdowns': result.knockdowns,
            'standing_after': result.standing_after,
            'elapsed': round(deck.elapsed, 6),
            'first_contact_time': (None if deck.first_contact_time is None
                                   else round(deck.first_contact_time, 6)),
            'impact_speed': (None if deck.impact_speed is None
                             else round(deck.impact_speed, 6)),
            'ball_x': round(deck.ball.position[0], 6),
            'ball_z': round(deck.ball.position[2], 6),
            'roll_down': sorted(deck.roll_down),
            'kickback_hits': sum(p.kickback_hits for p in deck.pins),
            'trajectory': [[round(t, 4), round(x, 6), round(z, 6)]
                           for t, x, z in deck.trajectory[::40]],
        }
    target = sys.argv[1] if len(sys.argv) > 1 else None
    text = json.dumps(out, indent=1)
    if target:
        with open(target, 'w', encoding='utf-8') as handle:
            handle.write(text)
    else:
        sys.stdout.write(text)


def math_radians(deg):
    import math
    return math.radians(deg)


if __name__ == '__main__':
    main()
