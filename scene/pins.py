"""Bowling pins: the ten-pin rack, its collisions, and its state machine.

Each pin is an Entity whose origin is the physics body's centre of mass, drawn
with the smooth lathe mesh from :mod:`scene.pin_mesh` and driven by
``physics.PinPhysics``. The collision model is unchanged: the pin's base, tilt
axis and belly radius are the same values the physics always used, so the
visual mesh and the collision body stay aligned.

The stepping itself lives in :class:`physics.Deck`, which owns the ball, the
pins, the fixed sub-step clock and every contact resolution. This module only
wraps those bodies in Entities and mirrors their pose, so the rack on screen,
the bot's headless predictions and the Physics Lab all run the *same*
simulation code.

Pin states
----------
Every pin is in exactly one rack state:

* **in play** - standing on the deck and part of the current rack. It can be
  hit, knocked down and counted.
* **down** (``physics.down``) - knocked over during the current roll. It is
  counted once by that roll and swept before the next one.
* **swept** (``physics.removed``) - cleared from the deck: invisible, no
  longer a target, and never counted again until a full rack reset.

A roll owns a *set* of knocked-down pins collected from those states while it
runs, minus every pin that was already down or swept when the roll began.
Counting a set is what makes double counting impossible: a pin contributes at
most one to a roll however far it slides, whatever it hits, and however often
it is struck again.
"""
import math

from ursina import Entity

import config
from physics import Deck, PinPhysics, rack_positions
from scene.pin_mesh import pin_model, pin_texture
from scene.shaders import soft_lighting_shader


def pin_positions():
    """Return ``(x, z)`` base positions for the ten pins, head pin first."""
    return rack_positions()


class Pin(Entity):
    """One pin: an Entity whose origin is the physics body's centre of mass.

    The physics layer supplies both the position and the orientation, so the
    mesh and the rigid body cannot drift apart. The mesh is a single lathe of
    the regulation silhouette (see :mod:`scene.pin_mesh`) centred on the
    origin, so it lines up with the collision body without any offset.
    """

    def __init__(self, x, z):
        super().__init__(model=pin_model(), texture=pin_texture(),
                         shader=soft_lighting_shader,
                         position=(x, config.PIN_HEIGHT / 2.0, z))
        self.base_position = (x, 0.0, z)
        self.physics = PinPhysics()
        self.physics.set_base(x, z)
        # Presentation-only animation values, written by
        # motion/scene_fx.RackResetFX (the staggered drop-in). They never
        # touch the physics pose, which stays the single source of truth.
        self.fx_offset = 0.0        # metres above the rack position
        self.fx_scale = 1.0         # multiplier
        self.fx_visible = True

    def reset(self):
        """Put the pin back in the rack, standing and in play."""
        self.physics.reset()
        self.physics.set_base(self.base_position[0], self.base_position[2])
        self.position = (self.base_position[0], config.PIN_HEIGHT / 2.0,
                         self.base_position[2])
        self.rotation = (0, 0, 0)
        self.fx_offset = 0.0
        self.fx_scale = 1.0
        self.fx_visible = True
        self.scale = (1.0, 1.0, 1.0)
        self.visible = True

    def update(self):
        """Mirror the physics pose, then apply the presentation offset.

        The entity's origin is the pin's centre of mass, so its position is
        the physics centre and its rotation is the exact tip pair composed
        with the spin about the pin's own axis. The animation layer only adds
        a vertical offset and a scale on top (the reset drop-in); a swept pin
        stays hidden whatever the animation asks for.
        """
        physics = self.physics
        if physics.hit:
            self.position = physics.center_position
            tip_x, tip_z = physics.tip_components()
            self.rotation = (math.degrees(tip_x), math.degrees(physics.spin),
                             math.degrees(tip_z))
        elif self.fx_offset or self.fx_scale != 1.0:
            self.position = (self.base_position[0],
                             config.PIN_HEIGHT / 2.0 + self.fx_offset,
                             self.base_position[2])
            self.rotation = (0, 0, 0)
        if self.fx_scale != 1.0:
            self.scale = (self.fx_scale, self.fx_scale, self.fx_scale)
        self.visible = self.fx_visible and not physics.removed


class PinRack:
    """All ten pins, with ball/pin collisions, pin/pin collisions and sweep.

    ``advance`` owns the physics integration while the ball is rolling: it
    delegates to a :class:`physics.Deck`, whose fixed-size sub-step
    accumulator (``PHYSICS_SUBSTEP``) makes the outcome independent of the
    rendered frame rate. ``settle`` runs the same clock with the ball held
    still, so a pin that is still toppling when the ball stops finishes its
    fall instead of freezing in mid-air - a frozen pin used to be re-stood for
    the next ball, which let the same pin be knocked down twice.
    """

    def __init__(self):
        self.pins = [Pin(x, z) for (x, z) in pin_positions()]
        self.deck = Deck(pins=[pin.physics for pin in self.pins])

    # ------------------------------------------------------------ rack states
    def reset(self):
        """Rebuild the full rack at the regulation spots.

        The pins' home positions are re-seated from :func:`pin_positions` (not
        from their own last ``base_position``), so a mode that moved pins for a
        custom lay - Equation Mode's challenge racks - always returns to the
        regulation triangle for the next classic frame.
        """
        for pin, (x, z) in zip(self.pins, pin_positions()):
            pin.base_position = (x, 0.0, z)
            pin.reset()
        self.deck._accumulator = 0.0
        self.begin_roll()

    def set_layout(self, positions):
        """Stand only the given ``(x, z)`` spots and hide the rest.

        Equation Mode's challenges are built on real leaves (a lone 10 pin, a
        single head pin, ...), so the rack is a *subset* of the regulation
        positions. The first pins in this rack take the given positions in
        order; the rest are marked removed and swept, so they cannot be hit or
        counted. The physics side is handled by ``Deck.set_rack``, which is the
        same call the classic modes use for a partial rack.
        """
        positions = [(float(x), float(z)) for x, z in positions]
        for index, pin in enumerate(self.pins):
            if index < len(positions):
                x, z = positions[index]
                pin.base_position = (x, 0.0, z)
                pin.reset()
            else:
                pin.fx_offset = 0.0
                pin.fx_scale = 1.0
        self.deck.set_rack(positions)
        for index, pin in enumerate(self.pins):
            if index >= len(positions):
                pin.visible = False
        self.deck._accumulator = 0.0
        self.begin_roll()

    def begin_roll(self):
        """Freeze the rack as the starting state of the next roll."""
        self.deck.begin_roll()

    def sweep(self):
        """Clear the pins this roll knocked down: hidden and out of play."""
        for pin in self.pins:
            if pin.physics.down:
                pin.physics.removed = True
                pin.visible = False

    def restore_survivors(self):
        """Re-stand the pins still in play for the next roll of the frame."""
        for pin in self.pins:
            if pin.physics.standing:
                pin.reset()

    def knockdown_count(self):
        """Pins knocked down by the current roll (swept pins excluded)."""
        return self.deck.knockdown_count()

    def standing_count(self):
        """Pins currently standing in the rack."""
        return sum(1 for pin in self.pins if pin.physics.standing)

    def deck_quiet(self):
        """True once no pin is still translating, tipping or spinning."""
        return self.deck.quiet()

    # ------------------------------------------------------------- simulation
    def advance(self, ball, dt):
        """Integrate one frame of the roll: ball and pins together."""
        self.deck.ball = ball.physics
        self.deck.advance(dt)
        if self.deck.ball_done:
            ball.finished = True

    def settle(self, dt):
        """Integrate one frame of pin-only motion after the ball has stopped.

        Called while the game counts the roll: the ball is finished, but the
        deck is not, and a pin that is still falling must be allowed to fall
        so it can be counted (or re-stood) from its final pose.
        """
        self.deck.settle(dt)
