"""The visual bowling ball, wrapping BallPhysics so rendering stays out of physics."""
from ursina import Entity, color
from ursina.shaders import unlit_shader

import config
from physics import BallPhysics, euler_degrees
from scene.geometry import disc
from scene.textures import ball_texture, glow_texture

SHADOW_TEXTURE_ALPHA = 0.55
SHADOW_RADIUS = config.BALL_RADIUS * 3.4


class Ball(Entity):
    """A sphere that owns its own physics state and mirrors it visually.

    The physics integration happens in ``PinRack.advance`` (fixed sub-steps),
    so this entity only draws the current physics state; that keeps the ball
    and pin simulation on one clock.

    The skin is a generated energy-crackle texture (see
    :func:`scene.textures.ball_texture`), which also makes the roll readable:
    the filaments wheel around as the ball travels. A soft unlit disc travels
    under the ball as a contact shadow, which is what actually grounds it on
    the lane without paying for a shadow map.
    """

    def __init__(self):
        super().__init__(
            model='sphere',
            scale=(2 * config.BALL_RADIUS,) * 3,   # sphere primitive has diameter 1
            position=(0, config.BALL_RADIUS, config.FOUL_LINE_Z),
            texture=ball_texture(),
            shader=unlit_shader,                   # a glowing energy ball
        )
        self.physics = BallPhysics()
        self.finished = False
        self.shadow = Entity(
            model=disc(SHADOW_RADIUS, segments=24), shader=unlit_shader,
            texture=glow_texture((6, 4, 10), size=64, power=1.6),
            color=color.rgba32(255, 255, 255, int(SHADOW_TEXTURE_ALPHA * 255)),
        )
        self._sync()

    def reset(self, lateral=0.0):
        self.physics.reset()
        self.physics.x = lateral
        self.position = (lateral, config.BALL_RADIUS, config.FOUL_LINE_Z)
        self.rotation = (0, 0, 0)
        self.finished = False
        self.visible = True
        self.shadow.visible = True
        self._sync()

    def launch(self, throw_data):
        self.physics.launch(
            speed=throw_data.speed,
            lateral_position=throw_data.lateral_position,
            launch_angle=throw_data.launch_angle,
            spin_omega=throw_data.spin_omega,
        )
        self.position = (throw_data.lateral_position, config.BALL_RADIUS, config.FOUL_LINE_Z)
        self.rotation = (0, 0, 0)
        self.finished = False
        self._sync()

    def _sync(self):
        physics = self.physics
        self.position = (physics.x, config.BALL_RADIUS, physics.z)
        # The physics layer returns engine-agnostic Euler degrees for the
        # accumulated axis-angle rotation, so the texture follows the real
        # roll (and any sideways spin) instead of a single axis.
        self.rotation = euler_degrees(physics.orientation)
        self.shadow.position = (physics.x, 0.0025, physics.z)

    def update(self):
        """Draw the current physics state (integration lives in PinRack)."""
        if self.finished and not self.physics.rolling:
            return
        self._sync()
