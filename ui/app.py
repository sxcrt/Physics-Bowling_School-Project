"""The application: screens, settings, audio and global input routing.

``App`` owns everything that outlives a single screen: the loaded settings, the
audio system, the play screen (one instance, reconfigured per match), the menu
screens and the camera view. Key and mouse events are routed to exactly one
screen, so a webcam swing can only ever reach the play screen while it is
actually waiting for a throw - the menus cannot be trigger-happy.

Hand menu navigation (optional, off by default) is implemented here as well:
when enabled, the tracked hand moves a cursor and a one-second dwell clicks
whatever is under it. It is deliberately separate from the bowling detector.
"""
from ursina import Entity, camera, color, window
from ursina.shaders import unlit_shader

import config
from avatar import character as avatar_states
from avatar.character import Bowler
from game.audio import AudioSystem
from game.play import Game
from game.settings import Settings
from motion import MOTION
from scene.camera import set_view, update_camera_fixed
from scene.textures import ball_texture
from ui import theme
from ui.lab_screen import LabScreen
from ui.menu_screens import (HowToPlayScreen, MainMenuScreen, ModeSelectScreen,
                             SettingsScreen, SplashScreen)
from ui.screens import ScreenManager

DWELL_TIME = 1.0              # s the hand must hold over a control to click it
DWELL_COOLDOWN = 0.8          # s after a click before the next one can start


class App:
    """The game application (screen manager + services)."""

    def __init__(self, settings=None, audio=None, inputs=None):
        self.settings = settings if settings is not None else Settings().load()
        # The animation system's reduce-motion switch follows the settings.
        MOTION.reduce_motion = bool(self.settings.get('reduce_motion', False))
        audio_settings = self.settings.to_audio_settings()
        self.audio = audio if audio is not None else AudioSystem(audio_settings)
        self.inputs = inputs
        self.game = Game(inputs=inputs, audio=self.audio, settings=self.settings,
                         app=self)
        self.screens = ScreenManager(self)
        self.screens.register(self.game)
        self.screens.register(SplashScreen(self))
        self.screens.register(MainMenuScreen(self))
        self.screens.register(ModeSelectScreen(self))
        self.screens.register(HowToPlayScreen(self))
        self.screens.register(SettingsScreen(self))
        self.screens.register(LabScreen(self))
        self._previous_screen = None
        self.camera_view = 'menu'
        self.showcase_ball = Entity(model='sphere',
                                    scale=(config.BALL_DIAMETER * 1.6,) * 3,
                                    position=(0, config.BALL_DIAMETER * 0.8, 1.6),
                                    texture=ball_texture(),
                                    shader=unlit_shader, color=color.white)
        self.showcase_pins = None
        # A character stands beside the lane on the menu screens so the front
        # door is the game, not a form. It animates on its own (idle -> ready ->
        # a short celebration) and, like every avatar, decides nothing physical.
        self.menu_bowler = Bowler(rgb=theme.PALETTE['cyan'],
                                  position=(-2.05, 0.0, -1.30),
                                  name='menu_bowler')
        self.menu_bowler.rotation_y = 198.0
        self.menu_bowler.set_ball_visible(True)
        self._menu_pose_timer = 0.0
        self._menu_pose_index = 0
        self._menu_poses = (avatar_states.IDLE, avatar_states.READY,
                            avatar_states.IDLE, avatar_states.CELEBRATE)
        self._hand_cursor = Entity(parent=camera.ui, model='quad',
                                   scale=(0.014, 0.014),
                                   color=theme.rgba(theme.PALETTE['cyan'], 0.85),
                                   enabled=False, z=-0.02)
        self._hand_ring = Entity(parent=camera.ui, model='quad',
                                 position=(0, 0, 0.01),
                                 scale=(0.05, 0.05),
                                 color=theme.rgba(theme.PALETTE['amber'], 0.35),
                                 enabled=False)
        # The one screen-entry fade: a full-screen veil in the dim colour that
        # fades out over 180ms (the slide half of the transition is the
        # screen's own root, see ui.screens.Screen.begin_enter).
        self._veil = Entity(parent=camera.ui, model='quad',
                            position=(0, 0, theme.OVERLAY_Z - 0.06),
                            scale=(window.aspect_ratio, 1.0),
                            color=theme.rgba(theme.COLORS['veil'], 0.0),
                            enabled=False)
        self._fade_time = 0.0
        self._fade_duration = float(theme.SIZES['screen_enter'])
        self._dwell = 0.0
        self._dwell_cooldown = 0.0
        self._hand_last = None
        self.screens.set('splash')
        self._start_music_if_wanted()

    # ==================================================================
    # Services
    # ==================================================================
    def play(self, cue):
        """Play a named sound (never raises)."""
        if self.audio is None:
            return
        method = getattr(self.audio, cue, None)
        if callable(method):
            try:
                method()
            except Exception:                    # pragma: no cover
                pass

    # ==================================================================
    # Screen entry fade
    # ==================================================================
    def begin_screen_fade(self):
        """Start the 180ms entry fade (skipped when Reduce Motion is on)."""
        if MOTION.reduce_motion:
            return
        self._fade_time = self._fade_duration
        self._veil.enabled = True
        self._veil.color = theme.rgba(theme.COLORS['veil'], 1.0)

    def _update_fade(self, dt):
        if self._fade_time <= 0.0:
            if self._veil.enabled:
                self._veil.enabled = False
            return
        self._fade_time = max(0.0, self._fade_time - dt)
        t = self._fade_time / max(1e-3, self._fade_duration)
        self._veil.color = theme.rgba(theme.COLORS['veil'], t)
        if self._fade_time <= 0.0:
            self._veil.enabled = False

    def save_settings(self):
        return self.settings.save()

    def apply_settings(self):
        """Push the current settings into the live systems."""
        self.audio.settings = self.settings.to_audio_settings()
        self.audio.apply_settings()
        # The one switch the whole animation system reads (see motion/config).
        MOTION.reduce_motion = bool(self.settings.get('reduce_motion', False))
        mode = self.settings.get('input_mode', 'mouse')
        if self.screens.active is self.game:
            self.game.set_input_mode(mode, announce=False)
            self._apply_arm()
        self._update_hand_navigation()
        self._update_showcase()

    def _start_music_if_wanted(self):
        if self.settings.get('music_volume', 0.0) > 0.0 \
                and not self.settings.get('muted'):
            self.audio.start_music()

    def _apply_arm(self):
        arm = self.settings.get('throwing_arm', 'auto')
        setter = getattr(self.game.inputs.get('webcam'), 'set_preferred_arm',
                         None)
        if callable(setter):
            setter(arm)

    def player_name(self, index, default=None):
        if index == 0:
            return self.settings.get('player_name') or (default or 'PLAYER 1')
        return self.settings.get(f'player_name_{index}', default
                                 or f'PLAYER {index + 1}')

    def set_player_name(self, index, name):
        name = (name or '').strip()[:config.MAX_NAME_LENGTH]
        if not name:
            return
        if index == 0:
            self.settings['player_name'] = name
        else:
            self.settings[f'player_name_{index}'] = name
        self.save_settings()

    # ==================================================================
    # Screen routing
    # ==================================================================
    def set_camera_view(self, name):
        self.camera_view = name
        set_view(name)
        self._update_showcase()

    def go_to_menu(self):
        self.audio.stop_music() if False else None
        self.screens.set('menu')
        self._apply_arm()

    def go_to_modes(self):
        self.screens.set('modes')

    def go_to_help(self):
        self.screens.set('howto')

    def go_to_lab(self, match=None, throw=None):
        self.screens.set('lab', match=match, throw=throw)

    def open_settings(self, from_game=False):
        self._previous_screen = 'play' if from_game else 'menu'
        self.screens.set('settings')

    def leave_settings(self):
        if self._previous_screen == 'play':
            self.screens.set('play')
        else:
            self.screens.set('menu')
        self._previous_screen = None

    def start_match(self, mode_id, player_specs=None, duration=None):
        """Configure and enter a match."""
        self.game.configure(mode_id, player_specs, duration)
        self.game.set_input_mode(self.settings.get('input_mode', 'mouse'),
                                announce=False)
        self._apply_arm()
        self.screens.set('play')
        self._update_showcase()

    def quit(self):
        try:
            from ursina import application
            application.quit()
        except Exception:                        # pragma: no cover
            window.close()

    # ==================================================================
    # Per-frame
    # ==================================================================
    def update(self):
        from ursina import time
        self._update_fade(time.dt)
        active = self.screens.active
        if active is self.game:
            self.game.update()
        else:
            self.screens.update()
            update_camera_fixed(self.camera_view)
            self._update_hand_navigation()
        if self.showcase_ball.visible:
            self.showcase_ball.rotation_y += 24.0 * time.dt
        self._update_menu_bowler()

    def _menu_bowler_visible(self):
        """The menu character shows on the city screens, not on text screens."""
        active = self.screens.active
        if active is self.game:
            return False
        text_screens = ('lab', 'howto', 'settings')
        return not any(active is self.screens.get(name)
                       for name in text_screens)

    def _update_menu_bowler(self):
        """Animate the menu character between a few calm poses."""
        from ursina import time
        visible = self._menu_bowler_visible()
        self.menu_bowler.enabled = visible
        if not visible:
            return
        self._menu_pose_timer += time.dt
        if self._menu_pose_timer >= 4.0:
            self._menu_pose_timer = 0.0
            self._menu_pose_index = (self._menu_pose_index + 1) % len(
                self._menu_poses)
            self.menu_bowler.set_state(self._menu_poses[self._menu_pose_index])
        self.menu_bowler.update()

    def _update_showcase(self):
        """The play ball and the match avatars belong to the play screen.

        The old decorative ball sat at the centre of the lane and collided
        with the menu's input control, so the menu now uses the character (who
        holds a ball of its own) instead. The match avatars are scene entities
        and are switched off whenever the play screen is not on top.
        """
        in_play = self.screens.active is self.game
        self.showcase_ball.visible = False
        for avatar in self.game._avatars.values():
            avatar.enabled = in_play
        self.menu_bowler.enabled = self._menu_bowler_visible()
        if in_play:
            self.game.ball.visible = True
        else:
            self.game.ball.visible = False
            self.game.ball.shadow.visible = False

    def on_key(self, key):
        if key == 'f12':
            return False
        handled = self.screens.on_key(key)
        if not handled and key == 'escape' and self.screens.active is not self.game:
            self.screens.set('menu')
        return handled

    # ==================================================================
    # Optional hand navigation (experimental, off by default)
    # ==================================================================
    @property
    def hand_navigation_enabled(self):
        return bool(self.settings.get('hand_menu_navigation'))

    def _update_hand_navigation(self):
        if not self.hand_navigation_enabled or self.screens.active is self.game:
            self._hand_cursor.enabled = False
            self._hand_ring.enabled = False
            return
        from ursina import time
        webcam = self.game.inputs.get('webcam')
        if webcam is None:
            return
        set_ready = getattr(webcam, 'set_game_ready', None)
        if callable(set_ready):
            set_ready(False)
        snapshot = webcam.latest_snapshot()
        wrist = None
        if snapshot is not None and getattr(snapshot, 'tracked', False):
            for name in ('right_wrist', 'left_wrist'):
                landmark = snapshot.landmarks.get(name)
                if landmark is not None and landmark.visibility >= 0.4:
                    wrist = landmark
                    break
        if wrist is None:
            self._hand_cursor.enabled = False
            self._hand_ring.enabled = False
            self._hand_last = None
            self._dwell = 0.0
            return
        # Image coordinates -> UI space (mirrored, like the webcam preview),
        # with a small dead zone in the middle of the frame.
        x = (0.5 - wrist.x) * window.aspect_ratio * 1.4
        y = (0.5 - wrist.y) * 1.4
        x = max(-window.aspect_ratio / 2.0 + 0.02,
                min(window.aspect_ratio / 2.0 - 0.02, x))
        y = max(-0.48, min(0.48, y))
        self._hand_cursor.enabled = True
        self._hand_cursor.position = (x, y, -0.02)
        self._hand_ring.enabled = True
        self._hand_ring.position = (x, y, -0.01)
        self._dwell_cooldown = max(0.0, self._dwell_cooldown - time.dt)
        target = self._hovered_widget(x, y)
        moved = (self._hand_last is not None
                 and abs(x - self._hand_last[0]) > 0.05)
        self._hand_last = (x, y)
        if target is None:
            self._dwell = 0.0
            self._hand_ring.scale = (0.05, 0.05)
            return
        if self._dwell_cooldown > 0.0:
            return
        self._dwell += time.dt
        progress = min(1.0, self._dwell / DWELL_TIME)
        self._hand_ring.scale = (0.05 + 0.03 * progress, 0.05 + 0.03 * progress)
        self._hand_ring.color = theme.rgba(
            theme.PALETTE['green'] if progress >= 1.0 else theme.PALETTE['amber'],
            0.35 + 0.5 * progress)
        if progress >= 1.0:
            self._dwell = 0.0
            self._dwell_cooldown = DWELL_COOLDOWN
            self.play('menu_select')
            self.screens.active.on_click(x, y)

    def _hovered_widget(self, x, y):
        screen = self.screens.active
        if screen is None:
            return None
        for widget in getattr(screen, 'widgets', []):
            contains = getattr(widget, 'contains', None)
            if callable(contains) and contains(x, y):
                return widget
            if hasattr(widget, 'position') and hasattr(widget, 'scale') \
                    and theme.pointer_in((widget.position[0], widget.position[1]),
                                         widget.scale, x, y):
                return widget
        for button in getattr(screen, 'buttons', []):
            if button.contains(x, y):
                return button
        return None

    # ==================================================================
    # Shutdown
    # ==================================================================
    def shutdown(self):
        self.game.shutdown()
        if self.audio is not None:
            self.audio.stop_music()
        self.save_settings()
