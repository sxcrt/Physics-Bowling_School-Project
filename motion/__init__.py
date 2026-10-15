"""The neon-alley motion system: one tween utility, one config, pooled effects.

The package is layered so the pure logic can be tested without the engine:

* :mod:`motion.config` - ``MOTION``: every timing, intensity and toggle in one
  object (:data:`motion.config.MOTION`), including the reduce-motion flag.
* :mod:`motion.ease`   - the shared easing set (the two cubic-beziers from the
  design spec plus a few helpers). No engine import: pure maths.
* :mod:`motion.tween`  - :class:`~motion.tween.Motion` (tween/timeline manager),
  :class:`~motion.tween.Tween`, :class:`~motion.tween.Timeline` and
  :func:`~motion.tween.count_up`. No engine import: pure Python.
* :mod:`motion.celebrate` - the feedback rules (no engine import): the
  "+1 PIN!" pop text, the combo labels (``DOUBLE!``, ``TURKEY!``,
  ``FOUR-BAGGER!``), the impact scale and the end-of-match awards.
* :mod:`motion.effects` - pooled UI effects: screen flashes, neon particles,
  result pop-ups and pin pops, vignette, light sweeps and the camera-shake
  buffer.
* :mod:`motion.score_fx` - the scoreboard's shot-by-shot animation state
  (stagger-in, active-frame pulse, score pops, mark stamps, final shimmer).
* :mod:`motion.hud_fx`  - the HUD's animation state (status prompt, power meter,
  pin icons and their celebration wave, game-end card).
* :mod:`motion.scene_fx` - the 3D presentation layer (neon strips, pin glow,
  ball trail and puffs, impact shockwaves, sweeper/drop-in reset, aim guide).
* :mod:`motion.director` - :class:`~motion.director.MotionDirector`, the single
  object the game talks to; it owns every effect and exposes the trigger
  functions (``onThrowRelease``, ``onPinDrop``, ``onPinImpact``,
  ``onPinsResolved``, ``onFrameAdvance``, ``onGameEnd``, ...).

Typical wiring (see ``game/play.py``):

.. code-block:: python

    from motion import MOTION, MotionDirector
    director = MotionDirector(hud=hud, ball=ball, pins=pins)
    director.update(dt)                      # once per frame (+ pin watching)
    director.onThrowRelease(throw)           # launch()
    director.onPinImpact(position, speed)     # the deck's first contact
    director.onPinsResolved(self.knockdowns) # _resolve_roll()
    director.onFrameAdvance(frame, total)    # the scorer moved on
    director.onGameEnd(final_score)          # _finish_match()
"""
from motion.config import MOTION, MotionConfig
from motion.ease import OVERSHOOT, STANDARD, EASE, cubic_bezier
from motion.tween import Motion, Timeline, Tween
from motion.director import MotionDirector

__all__ = [
    'MOTION', 'MotionConfig',
    'STANDARD', 'OVERSHOOT', 'EASE', 'cubic_bezier',
    'Motion', 'Timeline', 'Tween',
    'MotionDirector',
]
