"""Offscreen tests for the application shell: screens, menus and settings.

These build the real :class:`ui.app.App` in an offscreen Ursina window (no
camera is ever opened: the webcam is a duck-typed fake) and check that the
menu tree leads to real gameplay and that the settings the player changes
reach the systems that use them.
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ursina import Ursina, application, color, time, window

import config
from game.settings import Settings
from input.mouse_input import MouseInput
from tests.test_game_modes import FakeWebcamInput
from ui.app import App


def make_app():
    settings = Settings(path=os.path.join(tempfile.mkdtemp(prefix='strike_lab_'),
                                          'settings.json'))
    try:
        application.calculate_dt = False
        app_root = Ursina(title='Hells Balls (screen tests)', size=(1280, 720),
                          window_type='offscreen', development_mode=True,
                          show_ursina_splash=False, icon='')
    except Exception as exc:                    # pragma: no cover - env issue
        raise unittest.SkipTest(f'could not create offscreen Ursina app: {exc}')
    window.color = color.rgb32(*config.WINDOW_BACKGROUND)
    mouse = MouseInput(pointer=lambda: (0.0, 0.0))
    webcam = FakeWebcamInput()
    app = App(settings=settings, audio=None,
              inputs={'mouse': mouse, 'webcam': webcam})
    return app_root, app


class AppTestCase(unittest.TestCase):
    app_root = None
    app = None

    @classmethod
    def setUpClass(cls):
        cls.app_root, cls.app = make_app()

    def setUp(self):
        self.app.screens.set('menu')
        self.app.settings.update(input_mode='mouse', hand_menu_navigation=False)

    def step(self, frames=1):
        for _ in range(frames):
            time.dt = 1.0 / 60.0
            time.dt_unscaled = 1.0 / 60.0
            self.app.update()
            self.app_root._update()


class TestMenuTree(AppTestCase):
    def test_splash_then_menu(self):
        self.app.screens.set('splash')
        self.assertTrue(self.app.screens.active.root.enabled)
        self.app.screens.active.on_key('enter')
        self.assertEqual(self.app.screens.active.name, 'menu')

    def test_menu_buttons_start_the_screens_they_name(self):
        menu = self.app.screens.get('menu')
        menu.show()
        labels = [button.label for button in menu.buttons]
        self.assertEqual(labels, ['PLAY', 'HOW TO PLAY', 'PHYSICS LAB',
                                  'SETTINGS', 'QUIT'])
        for button in menu.buttons:
            if button.label == 'PLAY':
                button.click(button.position[0], button.position[1])
                self.assertEqual(self.app.screens.active.name, 'modes')
        self.app.screens.set('menu')
        menu.show()
        self.app.screens.get('menu').buttons[1].click(
            *self._center(self.app.screens.get('menu').buttons[1]))
        self.assertEqual(self.app.screens.active.name, 'howto')

    def _center(self, button):
        return (button.position[0], button.position[1])

    def test_help_pages_turn_and_do_not_break(self):
        self.app.go_to_help()
        help_screen = self.app.screens.active
        for _ in range(len(help_screen.PAGES) + 1):
            self.step()
            help_screen.on_key('right arrow')
        self.assertEqual(self.app.screens.active.name, 'howto')
        help_screen.on_key('escape')
        self.assertEqual(self.app.screens.active.name, 'menu')

    def test_mode_picker_selects_every_mode(self):
        self.app.go_to_modes()
        picker = self.app.screens.active
        self.step()
        self.assertEqual(len(picker.mode_list), 6)
        for index in range(len(picker.mode_list)):
            picker.select_ball(index)
            self.assertEqual(picker.mode.id, picker.mode_list[index].id)
            self.assertTrue(picker.mode.title)
            self.assertTrue(picker.info_text.text)

    def test_keyboard_selection_moves_between_modes(self):
        self.app.go_to_modes()
        picker = self.app.screens.active
        start = picker.selected_ball
        picker.on_key('right arrow')
        self.assertEqual(picker.selected_ball, (start + 1) % 6)
        picker.on_key('left arrow')
        self.assertEqual(picker.selected_ball, start)
        picker.on_key('3')
        self.assertEqual(picker.selected_ball, 2)

    def test_starting_a_mode_enters_play_with_that_mode(self):
        self.app.start_match('classic', [{'name': 'TESTER'}])
        self.assertEqual(self.app.screens.active.name, 'play')
        self.assertEqual(self.app.game.mode.id, 'classic')
        self.assertEqual(self.app.game.match.current_player.name, 'TESTER')
        self.step(3)
        self.assertEqual(self.app.game.state, 'ready')

    def test_lab_screen_replays_the_simulation(self):
        self.app.go_to_lab()
        lab = self.app.screens.active
        # The lab waits for BOWL: opening it must not roll anything.
        self.step(60)
        self.assertEqual(lab.state, 'idle')
        self.assertFalse(self.app.game.ball.physics.rolling)
        lab.bowl_button.click(*self._center(lab.bowl_button))
        self.assertEqual(lab.state, 'rolling')
        start_z = self.app.game.ball.physics.z
        self.step(30)
        self.assertGreater(self.app.game.ball.physics.z, start_z)
        self.assertGreater(lab.values['v'], 0.0)
        # The roll resolves through the real deck and reports a real count.
        for _ in range(1800):
            self.step(1)
            if lab.result is not None:
                break
        self.assertIsNotNone(lab.result)
        self.assertIn(lab.result.knockdowns, range(0, 11))
        # R (reset) returns the experiment to the waiting state.
        lab.on_key('r')
        self.assertEqual(lab.state, 'idle')
        lab.on_key('escape')
        self.assertEqual(self.app.screens.active.name, 'menu')


class TestSettingsScreen(AppTestCase):
    def test_volume_sliders_reach_the_audio_settings(self):
        self.app.screens.set('settings')
        screen = self.app.screens.active
        screen.sfx_slider.set_value(0.25, notify=True)
        self.assertAlmostEqual(self.app.settings.get('sfx_volume'), 0.25)
        self.assertAlmostEqual(self.app.audio.settings.sfx, 0.25)

    def test_input_and_arm_steppers_change_the_settings(self):
        self.app.screens.set('settings')
        screen = self.app.screens.active
        screen._cycle_input(1)
        self.assertIn(self.app.settings.get('input_mode'), ('mouse', 'webcam'))
        screen._cycle_arm(1)
        self.assertIn(self.app.settings.get('throwing_arm'),
                      ('auto', 'left', 'right'))
        screen._cycle_camera(1)
        self.assertIn(self.app.settings.get('camera_index'), (None, 0, 1, 2, 3))

    def test_toggles_flip_and_persist(self):
        self.app.screens.set('settings')
        screen = self.app.screens.active
        before = self.app.settings.get('show_physics_readout')
        screen.readout_toggle.click(*self._center(screen.readout_toggle))
        self.assertNotEqual(self.app.settings.get('show_physics_readout'),
                            before)
        self.assertTrue(self.app.settings.path.exists())

    def _center(self, widget):
        return (widget.position[0], widget.position[1])

    def test_back_returns_to_the_previous_screen(self):
        self.app.open_settings(from_game=False)
        self.app.screens.active._back()
        self.assertEqual(self.app.screens.active.name, 'menu')
        self.app.start_match('classic', [{'name': 'A'}])
        self.app.open_settings(from_game=True)
        self.app.screens.active._back()
        self.assertEqual(self.app.screens.active.name, 'play')


class TestSettingsPersistence(AppTestCase):
    def test_round_trip_through_the_file(self):
        path = self.app.settings.path
        self.app.settings.update(master_volume=0.42, input_mode='webcam',
                                 player_name='TESTER')
        self.app.save_settings()
        loaded = Settings(path=path).load()
        self.assertAlmostEqual(loaded.get('master_volume'), 0.42)
        self.assertEqual(loaded.get('input_mode'), 'webcam')
        self.assertEqual(loaded.get('player_name'), 'TESTER')

    def test_corrupt_file_falls_back_to_defaults(self):
        path = os.path.join(tempfile.mkdtemp(prefix='strike_lab_'),
                            'settings.json')
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write('{not json at all')
        settings = Settings(path=path)
        settings.load()
        self.assertEqual(settings.get('input_mode'), 'mouse')
        self.assertIsNotNone(settings.load_error)

    def test_unknown_keys_are_ignored_and_values_clamped(self):
        path = os.path.join(tempfile.mkdtemp(prefix='strike_lab_'),
                            'settings.json')
        with open(path, 'w', encoding='utf-8') as handle:
            json.dump({'master_volume': 5.0, 'nonsense': 1,
                       'rush_duration': 7.0}, handle)
        settings = Settings(path=path).load()
        self.assertEqual(settings.get('master_volume'), 1.0)
        self.assertNotIn('nonsense', settings.values)
        self.assertEqual(settings.get('rush_duration'), 180.0)

    def test_settings_save_does_not_break_on_a_bad_path(self):
        settings = Settings(path=os.path.join('Z:\\', 'nope', 'settings.json'))
        self.assertFalse(settings.save())
        self.assertIsNotNone(settings.load_error)


class TestHandNavigationSafety(AppTestCase):
    def test_hand_navigation_is_off_by_default(self):
        self.assertFalse(self.app.hand_navigation_enabled)

    def test_menus_never_arm_the_throw_detector(self):
        """The webcam must be told 'not ready' whenever a menu is on top."""
        self.app.settings['hand_menu_navigation'] = True
        self.app.screens.set('menu')
        self.step(3)
        self.assertIn(False, self.app.game.inputs['webcam'].ready_log)
        self.app.settings['hand_menu_navigation'] = False


if __name__ == '__main__':
    unittest.main(verbosity=2)
