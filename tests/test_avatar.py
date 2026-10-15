"""Tests for the original bowling character.

The pose maths is a pure function (no engine objects), so the animation can be
checked directly; one offscreen test then builds the real character to confirm
that the model assembles and animates inside Ursina.

The important design rule these tests protect: the avatar only *shows* what is
happening. Feeding it a swing position must never touch the simulation.
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from avatar import character
from avatar.character import ALL_STATES, POSES, REST, pose_for


class TestPoseMaths(unittest.TestCase):
    def test_every_state_has_a_complete_finite_pose(self):
        for state in ALL_STATES:
            pose = pose_for(state)
            self.assertEqual(set(pose), set(REST), state)
            for key, value in pose.items():
                self.assertIsInstance(value, float, f'{state}.{key}')
                self.assertTrue(math.isfinite(value), f'{state}.{key}')

    def test_states_are_distinguishable(self):
        """Every posed state must differ from the plain rest pose."""
        idle = pose_for(character.IDLE)
        for state in ALL_STATES:
            if state == character.IDLE:
                continue
            pose = pose_for(state)
            self.assertNotEqual(pose, idle, state)

    def test_backswing_raises_the_arm_behind_the_body(self):
        ready = pose_for(character.READY)
        back = pose_for(character.BACKSWING)
        forward = pose_for(character.FORWARD)
        self.assertGreater(back['r_arm_rx'], ready['r_arm_rx'])
        self.assertLess(forward['r_arm_rx'], ready['r_arm_rx'])

    def test_swing_offset_drives_the_throwing_arm(self):
        low = pose_for(character.READY, swing=-1.0, arm='right')
        mid = pose_for(character.READY, swing=0.0, arm='right')
        high = pose_for(character.READY, swing=1.0, arm='right')
        self.assertLess(low['r_arm_rx'], mid['r_arm_rx'])
        self.assertLess(mid['r_arm_rx'], high['r_arm_rx'])
        # Only the throwing arm moves.
        self.assertEqual(low['l_arm_rx'], high['l_arm_rx'])

    def test_throwing_arm_switch_moves_the_other_arm(self):
        right = pose_for(character.READY, swing=1.0, arm='right')
        left = pose_for(character.READY, swing=1.0, arm='left')
        self.assertNotEqual(right['r_arm_rx'], left['r_arm_rx'])
        self.assertNotEqual(right['l_arm_rx'], left['l_arm_rx'])

    def test_celebration_raises_both_arms(self):
        celebrate = pose_for(character.CELEBRATE)
        idle = pose_for(character.IDLE)
        self.assertLess(celebrate['l_arm_rx'], idle['l_arm_rx'])
        self.assertLess(celebrate['r_arm_rx'], idle['r_arm_rx'])

    def test_dejection_lowers_the_head(self):
        self.assertGreater(pose_for(character.DEFEAT)['head_rx'],
                           pose_for(character.IDLE)['head_rx'])

    def test_release_pose_follows_the_ball_down_the_lane(self):
        release = pose_for(character.RELEASE)
        ready = pose_for(character.READY)
        self.assertGreater(release['ball_z'], ready['ball_z'])

    def test_every_state_is_used_by_the_character(self):
        self.assertTrue(set(POSES).issubset(set(ALL_STATES)))


class TestBowlerModel(unittest.TestCase):
    """Offscreen: the model builds, animates and never touches the physics."""

    harness = None

    @classmethod
    def setUpClass(cls):
        try:
            from ursina import Ursina, application
            application.calculate_dt = False
            cls.app = Ursina(title='avatar test', size=(640, 360),
                             window_type='offscreen', development_mode=True,
                             show_ursina_splash=False, icon='')
        except Exception as exc:                 # pragma: no cover
            raise unittest.SkipTest(f'could not create offscreen app: {exc}')

    def make(self, rgb=(120, 220, 255)):
        from avatar.character import Bowler
        return Bowler(rgb=rgb, position=(0, 0, 0))

    def test_model_assembles_with_the_expected_parts(self):
        bowler = self.make()
        for name in ('head', 'skull', 'hips', 'torso', 'chest', 'left_shoulder',
                     'right_shoulder', 'left_elbow', 'right_elbow', 'ball',
                     'shadow'):
            self.assertTrue(hasattr(bowler, name), name)
        self.assertFalse(bowler.ball.visible)

    def test_the_character_is_attached_to_the_render_graph(self):
        """The avatar must actually be in the scene, not a detached node.

        ``Bowler(parent=None)`` used to pass an explicit ``None`` to ursina's
        ``Entity``, which leaves the node out of the render graph: the
        character was built, animated and reported as visible, and never drawn
        anywhere. This test fails if that regresses.
        """
        from ursina import scene
        bowler = self.make()
        parent = str(bowler.getParent())
        self.assertIn('scene', parent,
                      f'the avatar is not in the scene graph: {parent!r}')
        for part in (bowler.hips, bowler.torso, bowler.head, bowler.chest,
                     bowler.left_shoulder, bowler.right_elbow, bowler.ball,
                     bowler.shadow):
            self.assertIn('scene', str(part.getParent()),
                          f'{part} is detached: {part.getParent()}')
            self.assertTrue(scene is not None)

    def test_animation_moves_the_joints_towards_the_pose(self):
        from ursina import time
        time.dt = 1 / 60.0
        bowler = self.make()
        bowler.set_state(character.BACKSWING)
        for _ in range(30):
            bowler.update()
        back_rotation = bowler.right_shoulder.rotation_x
        bowler.set_state(character.FORWARD)
        for _ in range(30):
            bowler.update()
        forward_rotation = bowler.right_shoulder.rotation_x
        self.assertGreater(back_rotation, forward_rotation,
                           'the arm must swing forward after the backswing')

    def test_swing_input_moves_the_arm_continuously(self):
        from ursina import time
        time.dt = 1 / 60.0
        bowler = self.make()
        bowler.set_state(character.READY)
        bowler.set_swing(-1.0)
        for _ in range(20):
            bowler.update()
        low = bowler.right_shoulder.rotation_x
        bowler.set_swing(1.0)
        for _ in range(20):
            bowler.update()
        high = bowler.right_shoulder.rotation_x
        self.assertLess(low, high)

    def test_colours_can_be_changed_per_player(self):
        bowler = self.make()
        before = tuple(bowler.chest.color.rgb)
        bowler.set_colors((240, 90, 90))
        self.assertNotEqual(tuple(bowler.chest.color.rgb), before)

    def test_place_moves_the_character(self):
        bowler = self.make()
        bowler.place(-1.2, -0.5)
        self.assertAlmostEqual(bowler.position[0], -1.2)
        self.assertAlmostEqual(bowler.position[2], -0.5)

    def test_avatar_does_not_import_or_touch_the_physics(self):
        import physics
        self.assertFalse(hasattr(physics, 'Bowler'))
        source = open(character.__file__, encoding='utf-8').read()
        self.assertNotIn('import physics', source)
        self.assertNotIn('from physics', source)


if __name__ == '__main__':
    unittest.main(verbosity=2)
