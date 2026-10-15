"""Persisted player settings (a small JSON file next to the game).

Loads defensively: a missing, unreadable or corrupt file falls back to the
defaults, and unknown keys are ignored, so a settings file from another
version can never stop the game from starting.
"""
import json
from pathlib import Path

import config

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SETTINGS_PATH = PROJECT_ROOT / 'settings.json'

DEFAULTS = {
    'input_mode': 'mouse',        # 'mouse' | 'webcam'
    'throwing_arm': 'auto',       # 'auto' | 'left' | 'right'
    'camera_index': None,         # None = the default device in config
    'master_volume': 0.7,
    'sfx_volume': 0.8,
    'music_volume': 0.35,
    'muted': False,
    'hand_menu_navigation': False,   # experimental: hand cursor in the menus
    'player_name': 'PLAYER 1',
    'bot_difficulty': 'medium',
    'rush_duration': 180.0,
    'show_physics_readout': True,
    'reduce_motion': False,       # no shake, no flashes, no pulsing loops
}

INPUT_MODES = ('mouse', 'webcam')
ARMS = ('auto', 'left', 'right')
DIFFICULTIES = ('easy', 'medium', 'hard')
RUSH_DURATIONS = (60.0, 120.0, 180.0, 300.0)


class Settings:
    """Mutable settings with ``load`` / ``save`` and validation."""

    def __init__(self, path=None, values=None):
        self.path = Path(path) if path is not None else SETTINGS_PATH
        self.values = dict(DEFAULTS)
        if values:
            self.values.update(values)
        self.load_error = None

    # ------------------------------------------------------------------ file
    def load(self):
        """Read the file, keeping defaults for anything missing or invalid."""
        try:
            if not self.path.exists():
                return self
            raw = json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError, ValueError) as exc:
            self.load_error = f'{self.path.name}: {exc}'
            return self
        if isinstance(raw, dict):
            for key, value in raw.items():
                if key in DEFAULTS:
                    self.values[key] = value
        self.validate()
        return self

    def save(self):
        """Write the file; returns True on success."""
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.values, indent=2),
                                 encoding='utf-8')
            return True
        except OSError as exc:                      # pragma: no cover
            self.load_error = str(exc)
            return False

    def validate(self):
        """Force every value into its supported range."""
        values = self.values
        if values.get('input_mode') not in INPUT_MODES:
            values['input_mode'] = DEFAULTS['input_mode']
        if values.get('throwing_arm') not in ARMS:
            values['throwing_arm'] = DEFAULTS['throwing_arm']
        if values.get('bot_difficulty') not in DIFFICULTIES:
            values['bot_difficulty'] = DEFAULTS['bot_difficulty']
        for key in ('master_volume', 'sfx_volume', 'music_volume'):
            try:
                values[key] = max(0.0, min(1.0, float(values.get(key, 0))))
            except (TypeError, ValueError):
                values[key] = DEFAULTS[key]
        values['muted'] = bool(values.get('muted', False))
        values['hand_menu_navigation'] = bool(
            values.get('hand_menu_navigation', False))
        values['show_physics_readout'] = bool(
            values.get('show_physics_readout', True))
        values['reduce_motion'] = bool(values.get('reduce_motion', False))
        try:
            index = values.get('camera_index')
            values['camera_index'] = None if index is None else int(index)
        except (TypeError, ValueError):
            values['camera_index'] = None
        duration = None
        try:
            duration = float(values.get('rush_duration'))
        except (TypeError, ValueError):
            duration = None
        if duration not in RUSH_DURATIONS:
            values['rush_duration'] = DEFAULTS['rush_duration']
        name = str(values.get('player_name', '')).strip()
        values['player_name'] = (name[:config.MAX_NAME_LENGTH]
                                 if name else DEFAULTS['player_name'])
        return self

    # --------------------------------------------------------------- accessors
    def __getitem__(self, key):
        return self.values[key]

    def __setitem__(self, key, value):
        self.values[key] = value
        self.validate()

    def get(self, key, default=None):
        return self.values.get(key, default)

    def update(self, **changes):
        self.values.update(changes)
        self.validate()
        return self

    # ------------------------------------------------------------- convenience
    def cycle(self, key, options):
        """Move a value to the next entry of ``options``; returns the value."""
        current = self.values.get(key)
        try:
            index = list(options).index(current)
        except ValueError:
            index = -1
        value = list(options)[(index + 1) % len(options)]
        self.values[key] = value
        return value

    def audio_settings(self):
        """Build the :class:`game.audio.AudioSettings` this file describes."""
        from game.audio import AudioSettings

        return AudioSettings(master=float(self.values['master_volume']),
                             sfx=float(self.values['sfx_volume']),
                             music=float(self.values['music_volume']),
                             muted=bool(self.values['muted']))

    def to_audio_settings(self):
        return self.audio_settings()
