"""An original, procedurally built bowling character with simple animation.

The character is assembled from engine primitives (spheres, cubes, generated
textures), so it needs no imported art and nothing about it is copied from
another game: a rounded friendly face, a bowling shirt in the player's colour,
shoes and a ball. It stands on the approach beside the lane and animates
between poses by easing its joint rotations towards a target - a keyframe
blend, kept tiny enough to read.

**The avatar never decides anything physical.** It displays what the player (or
the bot) is doing:

* :meth:`Bowler.set_state` picks the animation, and
* :meth:`Bowler.set_swing` feeds it the measured swing position, so the arm
  follows the player's real (webcam) or simulated (mouse drag) motion.

The throw itself is decided by the simulation; the character only communicates
it.

Channel names in a pose (all angles in radians, lengths in metres):

``hips_y`` ``hips_rx`` vertical offset and lean of the pelvis,
``torso_rx`` ``torso_rz`` lean and side-bend of the chest,
``head_rx`` ``head_y`` nod and height of the head,
``l_arm_rx`` ``l_arm_rz`` ``r_arm_rx`` ``r_arm_rz`` shoulder swing,
``l_elbow_rx`` ``r_elbow_rx`` elbow bend,
``l_leg_rx`` ``r_leg_rx`` hip rotation of each leg,
``ball_x`` ``ball_y`` ``ball_z`` where the ball is held.
"""
import math

from ursina import Entity, color, scene
from ursina.shaders import unlit_shader

import config
from scene.geometry import disc, low_poly_sphere, tapered_box
from scene.shaders import soft_lighting_shader
from scene.textures import ball_texture, glow_texture

# Animation states.
IDLE = 'idle'
READY = 'ready'
BACKSWING = 'backswing'
FORWARD = 'forward'
RELEASE = 'release'
FOLLOW = 'follow'
WAIT = 'wait'
CELEBRATE = 'celebrate'
DISAPPOINTED = 'disappointed'
VICTORY = 'victory'
DEFEAT = 'defeat'
ALL_STATES = (IDLE, READY, BACKSWING, FORWARD, RELEASE, FOLLOW, WAIT,
              CELEBRATE, DISAPPOINTED, VICTORY, DEFEAT)

# Ease speed (1/s) for the joint blend, and the frame-delta cap.
EASE = 9.0
MAX_BLEND_STEP = 0.05
SHADOW_ALPHA = 0.45

REST = {
    'hips_y': 0.0,
    'hips_rx': 0.0,
    'torso_rx': 0.0,
    'torso_rz': 0.0,
    'head_rx': 0.0,
    'head_y': 0.0,
    'l_arm_rx': 0.14,
    'l_arm_rz': -0.06,
    'r_arm_rx': 0.14,
    'r_arm_rz': 0.06,
    'l_elbow_rx': 0.18,
    'r_elbow_rx': 0.18,
    'l_leg_rx': 0.0,
    'r_leg_rx': 0.0,
    'ball_x': 0.30,
    'ball_y': 0.24,
    'ball_z': 0.26,
}

# Poses: what each state looks like (only the channels it changes).
POSES = {
    IDLE: {'l_arm_rx': 0.10, 'r_arm_rx': 0.10},
    WAIT: {'torso_rx': 0.05, 'l_arm_rx': 0.20, 'r_arm_rx': 0.20,
           'ball_x': 0.30, 'ball_y': 0.20},
    READY: {'hips_y': -0.02, 'torso_rx': 0.10, 'r_arm_rx': 0.55,
            'r_elbow_rx': 0.35, 'l_arm_rx': 0.12,
            'ball_x': 0.30, 'ball_y': 0.22},
    BACKSWING: {'hips_y': -0.03, 'hips_rx': 0.12, 'torso_rx': 0.22,
                'head_rx': 0.10, 'r_arm_rx': 1.95, 'r_arm_rz': 0.16,
                'r_elbow_rx': 0.06, 'l_arm_rx': -0.16,
                'ball_x': 0.26, 'ball_y': 0.05, 'ball_z': -0.10},
    FORWARD: {'hips_y': -0.01, 'hips_rx': -0.10, 'torso_rx': -0.16,
              'head_rx': -0.06, 'r_arm_rx': -0.55, 'r_arm_rz': -0.05,
              'r_elbow_rx': -0.22, 'l_arm_rx': 0.26,
              'ball_x': 0.24, 'ball_y': 0.26, 'ball_z': 0.34},
    RELEASE: {'hips_y': -0.02, 'hips_rx': -0.18, 'torso_rx': -0.26,
              'head_rx': -0.10, 'r_arm_rx': -1.15, 'r_arm_rz': -0.10,
              'r_elbow_rx': -0.30, 'l_arm_rx': 0.40,
              'ball_x': 0.22, 'ball_y': 0.30, 'ball_z': 0.46},
    FOLLOW: {'hips_y': -0.05, 'hips_rx': -0.30, 'torso_rx': -0.42,
             'head_rx': -0.16, 'r_arm_rx': -1.85, 'r_arm_rz': -0.16,
             'r_elbow_rx': -0.20, 'l_arm_rx': 0.62, 'l_arm_rz': 0.10,
             'l_leg_rx': 0.20, 'ball_x': 0.10, 'ball_y': 0.05, 'ball_z': 0.20},
    CELEBRATE: {'hips_y': 0.02, 'torso_rx': -0.14,
                'l_arm_rx': -2.60, 'r_arm_rx': -2.60,
                'l_arm_rz': -0.30, 'r_arm_rz': 0.30,
                'l_elbow_rx': -0.30, 'r_elbow_rx': -0.30},
    VICTORY: {'hips_y': 0.04, 'torso_rx': -0.20, 'head_rx': -0.10,
              'l_arm_rx': -2.80, 'r_arm_rx': -2.80,
              'l_arm_rz': -0.45, 'r_arm_rz': 0.45,
              'l_elbow_rx': -0.20, 'r_elbow_rx': -0.20},
    DISAPPOINTED: {'hips_y': -0.04, 'torso_rx': 0.34, 'head_rx': 0.42,
                   'l_arm_rx': 0.34, 'r_arm_rx': 0.34,
                   'l_elbow_rx': 0.30, 'r_elbow_rx': 0.30},
    DEFEAT: {'hips_y': -0.07, 'torso_rx': 0.52, 'head_rx': 0.55,
             'l_arm_rx': 0.30, 'l_arm_rz': 0.20, 'r_arm_rx': 0.30,
             'r_arm_rz': -0.20},
}


def pose_for(state, swing=0.0, arm='right'):
    """Return the full channel dict for a state (pure, no engine objects).

    ``swing`` (-1 backswing .. +1 forward) is added to the throwing arm's
    shoulder rotation on top of the state's pose, which is what makes the
    character follow a live mouse drag or a tracked (webcam) arm.
    """
    values = dict(REST)
    values.update(POSES.get(state, POSES[IDLE]))
    if state in (READY, BACKSWING, FORWARD, RELEASE) and swing:
        key = 'r_arm_rx' if arm == 'right' else 'l_arm_rx'
        values[key] = values[key] + swing * 2.1
        values['ball_x'] = 0.30 + swing * 0.10
        values['ball_y'] = values['ball_y'] - swing * 0.14
        values['ball_z'] = values['ball_z'] + swing * 0.30
    return values


class Bowler(Entity):
    """One original bowling character, parented to its own root entity."""

    def __init__(self, rgb=None, position=(0, 0, 0), scale=1.0, name='bowler',
                 parent=None):
        # ``parent=None`` must mean "the scene", not "no parent": ursina's
        # Entity treats an explicit None as a missing parent and leaves the
        # node detached from the render graph - which is exactly how the
        # character ended up invisible in every earlier build.
        super().__init__(parent=scene if parent is None else parent,
                         position=position, scale=scale)
        self.name = name
        self.accent = tuple(rgb) if rgb else (120, 220, 255)
        self.state = IDLE
        self.swing = 0.0
        self.throw_arm = 'right'
        self._pose = pose_for(IDLE)
        self._bounce_time = 0.0
        self._breath_time = 0.0

        # A restrained palette: skin, hair, a two-tone shirt and dark trousers.
        skin = (238, 196, 168)
        skin_shadow = (206, 162, 134)
        hair = (44, 34, 52)
        trouser = (46, 52, 84)
        trouser_dark = (34, 38, 62)
        shoe = (232, 236, 244)
        shoe_sole = (150, 156, 176)
        shirt_light = _mix(self.accent, (255, 255, 255), 0.30)
        shirt_dark = _mix(self.accent, (18, 20, 40), 0.35)
        self.shirt_parts = []

        def part(**kwargs):
            kwargs.setdefault('parent', self)
            kwargs.setdefault('shader', soft_lighting_shader)
            return Entity(**kwargs)

        # --- legs (pivot at the hips) ------------------------------------
        # Each leg is a thigh, a knee and a shin, so the silhouette bends
        # where a leg bends instead of being one slab.
        self.hips = Entity(parent=self, position=(0, 0.66, 0))
        self.left_leg = part(parent=self.hips, model=tapered_box(
            bottom=(0.155, 0.165), top=(0.135, 0.150), height=0.30,
            bevel=0.022, down=True),
            position=(-0.115, -0.02, 0), color=_rgb(trouser))
        self.right_leg = part(parent=self.hips, model=tapered_box(
            bottom=(0.135, 0.150), top=(0.150, 0.160), height=0.30,
            bevel=0.022, down=True),
            position=(0.115, -0.02, 0), color=_rgb(trouser))
        for side, x in (('left', -0.115), ('right', 0.115)):
            part(parent=self.hips, model=low_poly_sphere(
                0.070, rings=4, segments=8, squash=(1.0, 0.95, 1.0)),
                position=(x, -0.325, 0), color=_rgb(trouser))
        self.left_shin = part(parent=self.hips, model=tapered_box(
            bottom=(0.105, 0.115), top=(0.130, 0.140), height=0.30,
            bevel=0.018, down=True),
            position=(-0.115, -0.325, 0), color=_rgb(trouser_dark))
        self.right_shin = part(parent=self.hips, model=tapered_box(
            bottom=(0.105, 0.115), top=(0.130, 0.140), height=0.30,
            bevel=0.018, down=True),
            position=(0.115, -0.325, 0), color=_rgb(trouser_dark))
        # Shoes: a low wedge with a raised heel and a sole, toes forward.
        for x in (-0.115, 0.115):
            part(parent=self.hips, model=tapered_box(
                bottom=(0.150, 0.300), top=(0.120, 0.230), height=0.070,
                bevel=0.030),
                position=(x, -0.660, 0.030), color=_rgb(shoe))
            part(parent=self.hips, model=tapered_box(
                bottom=(0.155, 0.305), top=(0.140, 0.290), height=0.022,
                bevel=0.030),
                position=(x, -0.682, 0.030), color=_rgb(shoe_sole))
            part(parent=self.hips, model=tapered_box(
                bottom=(0.115, 0.075), top=(0.100, 0.060), height=0.075,
                bevel=0.022),
                position=(x, -0.640, -0.070), color=_rgb(shoe_sole))

        # --- pelvis, torso and shirt -------------------------------------
        self.torso = Entity(parent=self.hips, position=(0, 0.10, 0))
        self.pelvis = part(parent=self.hips, model=tapered_box(
            bottom=(0.300, 0.230), top=(0.330, 0.245), height=0.140,
            bevel=0.045), position=(0, -0.045, 0), color=_rgb(trouser))
        self.belt = part(parent=self.hips, model=tapered_box(
            bottom=(0.335, 0.250), top=(0.335, 0.250), height=0.036,
            bevel=0.045), position=(0, 0.088, 0), color=_rgb((58, 44, 40)))
        self.chest = part(parent=self.torso, model=tapered_box(
            bottom=(0.320, 0.225), top=(0.470, 0.260), height=0.440,
            bevel=0.055), position=(0, 0.000, 0), color=_rgb(self.accent))
        self.shirt_parts.append(self.chest)
        # Shoulder caps round the top of the torso off.
        for x in (-0.200, 0.200):
            cap = part(parent=self.torso, model=low_poly_sphere(
                0.072, rings=4, segments=8, squash=(1.0, 0.80, 0.95)),
                position=(x, 0.418, 0), color=_rgb(self.accent))
            self.shirt_parts.append(cap)
        # Placket and collar give the shirt some structure.
        self.placket = part(parent=self.torso, model=tapered_box(
            bottom=(0.050, 0.012), top=(0.060, 0.012), height=0.330,
            bevel=0.008), position=(0, 0.040, 0.128),
            color=_rgb(shirt_light))
        self.shirt_parts.append(self.placket)
        self.collar = part(parent=self.torso, model=tapered_box(
            bottom=(0.165, 0.150), top=(0.130, 0.135), height=0.055,
            bevel=0.025), position=(0, 0.432, 0.006), color=_rgb(shirt_dark))
        self.shirt_parts.append(self.collar)
        self.belly = part(parent=self.torso, model=low_poly_sphere(
            0.150, rings=4, segments=8, squash=(1.15, 0.95, 0.85)),
            position=(0, 0.050, 0.010), color=_rgb(self.accent))
        self.shirt_parts.append(self.belly)

        # --- head ---------------------------------------------------------
        self.head = Entity(parent=self.torso, position=(0, 0.500, 0))
        self.neck = part(parent=self.torso, model=low_poly_sphere(
            0.062, rings=3, segments=8, squash=(0.9, 1.6, 0.9)),
            position=(0, 0.448, 0), color=_rgb(skin_shadow))
        self.skull = part(parent=self.head, model=low_poly_sphere(
            0.150, rings=6, segments=10, squash=(1.0, 1.10, 1.02)),
            position=(0, 0.0, 0), color=_rgb(skin))
        self.jaw = part(parent=self.head, model=tapered_box(
            bottom=(0.128, 0.155), top=(0.250, 0.250), height=0.098,
            bevel=0.035), position=(0, -0.146, 0.004), color=_rgb(skin))
        self.hair = part(parent=self.head, model=low_poly_sphere(
            0.157, rings=5, segments=10, squash=(1.0, 0.96, 1.0)),
            position=(0, 0.026, -0.016), color=_rgb(hair))
        self.fringe = part(parent=self.head, model=tapered_box(
            bottom=(0.275, 0.060), top=(0.250, 0.046), height=0.058,
            bevel=0.018), position=(0, 0.062, 0.098), color=_rgb(hair))
        for x in (-0.150, 0.150):
            part(parent=self.head, model=low_poly_sphere(
                0.036, rings=3, segments=6, squash=(0.7, 1.30, 0.9)),
                position=(x, -0.018, 0.008), color=_rgb(skin_shadow))
        self.eyes = []
        for x in (-0.058, 0.058):
            eye = part(parent=self.head, model=low_poly_sphere(
                0.026, rings=3, segments=6, squash=(1.0, 1.15, 0.55)),
                position=(x, 0.016, 0.130), color=_rgb((248, 250, 255)))
            pupil = part(parent=eye, model=low_poly_sphere(
                0.014, rings=3, segments=6, squash=(1.0, 1.0, 0.6)),
                position=(0, 0, 0.019), color=_rgb((26, 24, 38)))
            brow = part(parent=self.head, model=tapered_box(
                bottom=(0.062, 0.020), top=(0.062, 0.020), height=0.016,
                bevel=0.005), position=(x, 0.070, 0.126), color=_rgb(hair))
            self.eyes.append((eye, pupil, brow))
        self.nose = part(parent=self.head, model=low_poly_sphere(
            0.026, rings=3, segments=6, squash=(0.75, 1.05, 1.25)),
            position=(0, -0.026, 0.148), color=_rgb(skin_shadow))
        self.mouth = part(parent=self.head, model=tapered_box(
            bottom=(0.076, 0.018), top=(0.058, 0.018), height=0.016,
            bevel=0.005), position=(0, -0.096, 0.130),
            color=_rgb((168, 92, 96)))

        # --- arms: shoulder pivot -> upper arm; elbow pivot -> forearm -----
        self.left_shoulder = Entity(parent=self.torso, position=(-0.245, 0.400, 0))
        self.right_shoulder = Entity(parent=self.torso, position=(0.245, 0.400, 0))
        for shoulder in (self.left_shoulder, self.right_shoulder):
            sleeve = part(parent=shoulder, model=tapered_box(
                bottom=(0.118, 0.122), top=(0.140, 0.145), height=0.205,
                bevel=0.026, down=True), position=(0, 0.010, 0),
                color=_rgb(self.accent))
            self.shirt_parts.append(sleeve)
            part(parent=shoulder, model=low_poly_sphere(
                0.056, rings=3, segments=8, squash=(1.0, 0.95, 1.0)),
                position=(0, -0.200, 0), color=_rgb(skin))
        self.left_elbow = Entity(parent=self.left_shoulder, position=(0, -0.32, 0))
        self.right_elbow = Entity(parent=self.right_shoulder, position=(0, -0.32, 0))
        for side, elbow in (('left', self.left_elbow), ('right', self.right_elbow)):
            part(parent=elbow, model=tapered_box(
                bottom=(0.082, 0.086), top=(0.098, 0.102), height=0.200,
                bevel=0.018, down=True), position=(0, 0.012, 0),
                color=_rgb(skin))
            hand = part(parent=elbow, model=low_poly_sphere(
                0.058, rings=4, segments=8, squash=(0.85, 1.15, 0.95)),
                position=(0, -0.225, 0.004), color=_rgb(skin))
            part(parent=hand, model=tapered_box(
                bottom=(0.032, 0.046), top=(0.026, 0.040), height=0.050,
                bevel=0.010, down=True),
                position=(0.042 if side == 'right' else -0.042, 0.018, 0.008),
                color=_rgb(skin))

        # The ball the character holds while preparing (world-space position,
        # so it stays under the throwing hand).
        self.ball = part(model='sphere', scale=(config.BALL_DIAMETER,) * 3,
                         position=(0.30, 0.24, 0.26), texture=ball_texture(),
                         shader=unlit_shader, color=color.white)
        self.ball.visible = False

        # Contact shadow, so the character is grounded on the approach.
        self.shadow = Entity(
            parent=self, model=disc(0.42, segments=20), shader=unlit_shader,
            texture=glow_texture((6, 4, 10), size=64, power=1.6),
            color=color.rgba32(255, 255, 255, int(SHADOW_ALPHA * 255)),
            position=(0, 0.004, 0), scale=(2.3, 1.0, 1.5))

        self._apply_pose(self._pose)

    # ------------------------------------------------------------------- state
    def set_state(self, state):
        """Switch animation state (a no-op when already in it)."""
        if state == self.state:
            return
        self.state = state

    def set_swing(self, value):
        """Feed the measured swing position (``-1`` back, ``+1`` forward)."""
        self.swing = max(-1.0, min(1.0, float(value)))

    def set_throw_arm(self, arm):
        if arm in ('left', 'right'):
            self.throw_arm = arm

    def set_ball_visible(self, visible):
        self.ball.visible = bool(visible)

    def set_colors(self, rgb):
        """Re-tint the outfit (used when a player picks a colour)."""
        self.accent = tuple(rgb)
        shirt = color.rgb32(*self.accent)
        for part in getattr(self, 'shirt_parts', ()):
            part.color = shirt
        if hasattr(self, 'collar'):
            self.collar.color = color.rgb32(
                *_mix(self.accent, (18, 20, 40), 0.35))
        if hasattr(self, 'placket'):
            self.placket.color = color.rgb32(
                *_mix(self.accent, (255, 255, 255), 0.30))

    # -------------------------------------------------------------- animation
    def update(self):
        """Ease every channel towards the current pose (Ursina calls this)."""
        dt = min(MAX_BLEND_STEP, max(0.0, _delta_time()))
        if self.state in (CELEBRATE, VICTORY):
            self._bounce_time += dt * 3.2
        if self.state in (IDLE, READY, WAIT):
            # Idle breathing: a slow sway of the hips and the chest, plus a
            # little rise and fall. It is what keeps the character alive
            # between throws without drawing attention (section 6).
            self._breath_time += dt * 1.15
            breath = math.sin(self._breath_time)
        else:
            self._breath_time += dt * 1.15
            breath = 0.0
        target = pose_for(self.state, self.swing, self.throw_arm)
        blend = min(1.0, EASE * dt)
        for key, value in target.items():
            current = self._pose.get(key, value)
            self._pose[key] = current + (value - current) * blend
        if self.state in (CELEBRATE, VICTORY):
            self._pose['hips_y'] = (self._pose.get('hips_y', 0.0)
                                    + 0.035 * abs(math.sin(self._bounce_time)))
        if breath:
            self._pose['hips_y'] = self._pose.get('hips_y', 0.0) \
                + 0.006 * breath
            self._pose['torso_rx'] = self._pose.get('torso_rx', 0.0) \
                + 0.012 * breath
            self._pose['head_rx'] = self._pose.get('head_rx', 0.0) \
                - 0.008 * breath
        self._apply_pose(self._pose)

    def _apply_pose(self, pose):
        """Map the channel values onto the entity transforms."""
        self.hips.position = (0.0, 0.66 + pose['hips_y'], 0.0)
        self.hips.rotation_x = math.degrees(pose['hips_rx'])
        self.torso.rotation_x = math.degrees(pose['torso_rx'])
        self.torso.rotation_z = math.degrees(pose['torso_rz'])
        self.head.rotation_x = math.degrees(pose['head_rx'])
        self.head.position = (0.0, 0.50 + pose['head_y'], 0.0)
        self.left_shoulder.rotation_x = math.degrees(pose['l_arm_rx'])
        self.left_shoulder.rotation_z = math.degrees(pose['l_arm_rz'])
        self.right_shoulder.rotation_x = math.degrees(pose['r_arm_rx'])
        self.right_shoulder.rotation_z = math.degrees(pose['r_arm_rz'])
        self.left_elbow.rotation_x = math.degrees(pose['l_elbow_rx'])
        self.right_elbow.rotation_x = math.degrees(pose['r_elbow_rx'])
        self.left_leg.rotation_x = math.degrees(pose['l_leg_rx'])
        self.right_leg.rotation_x = math.degrees(pose['r_leg_rx'])
        self.ball.position = (pose['ball_x'], pose['ball_y'], pose['ball_z'])

    # ------------------------------------------------------------- convenience
    def place(self, x, z, rotation_y=0.0):
        """Stand the character on the approach at ``(x, z)``."""
        self.position = (x, 0.0, z)
        self.rotation_y = rotation_y


def _rgb(rgb):
    return color.rgb32(*rgb)


def _mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _delta_time():
    """Ursina's frame delta, with a safe fallback for tests."""
    try:
        from ursina import time
        return float(time.dt)
    except Exception:                        # pragma: no cover
        return 1.0 / 60.0
