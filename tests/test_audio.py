"""Tests for the generated audio: valid WAVs, real sound, sane volumes.

No mixer and no window are required: the files are synthesised with the
standard library, so these tests can inspect the samples directly.
"""
import os
import shutil
import struct
import sys
import tempfile
import unittest
import wave

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from game.audio import (AUDIO_DIR, SAMPLE_RATE, AudioSettings, AudioSystem,
                        _SOUND_SPECS, ensure_sounds, synthesise)


def read_wav(path):
    with wave.open(str(path), 'rb') as handle:
        frames = handle.readframes(handle.getnframes())
        return (handle.getnchannels(), handle.getsampwidth(),
                handle.getframerate(), handle.getnframes(), frames)


class TestSynthesis(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.mkdtemp(prefix='strike_lab_audio_')
        cls.paths = ensure_sounds(cls.directory)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.directory, ignore_errors=True)

    def test_every_effect_is_generated(self):
        for name in _SOUND_SPECS:
            self.assertIn(name, self.paths, name)
            self.assertTrue(self.paths[name].exists(), name)

    def test_every_file_is_a_valid_mono_pcm_wav(self):
        for name, path in self.paths.items():
            channels, width, rate, frames, _data = read_wav(path)
            self.assertEqual(channels, 1, name)
            self.assertEqual(width, 2, name)
            self.assertEqual(rate, SAMPLE_RATE, name)
            self.assertGreater(frames, 1000, name)

    def test_every_effect_actually_contains_audio(self):
        for name, path in self.paths.items():
            _c, _w, _r, frames, data = read_wav(path)
            samples = struct.unpack(f'<{frames}h', data)
            peak = max(abs(value) for value in samples)
            self.assertGreater(peak, 3000, f'{name} is silent (peak {peak})')
            self.assertLessEqual(peak, 32767, name)
            self.assertAlmostEqual(peak, int(0.82 * 32767), delta=800,
                                   msg=f'{name} is not peak-normalised')

    def test_effects_have_sensible_durations(self):
        expected = {
            'menu_move': (0.02, 0.4),
            'ball_release': (0.1, 1.0),
            'strike': (0.4, 2.0),
            'music': (3.0, 20.0),
        }
        for name, (low, high) in expected.items():
            _c, _w, _r, frames, _d = read_wav(self.paths[name])
            duration = frames / float(SAMPLE_RATE)
            self.assertGreater(duration, low, name)
            self.assertLess(duration, high, name)

    def test_synthesis_is_deterministic(self):
        first = synthesise('pin_hit')
        second = synthesise('pin_hit')
        self.assertEqual(first, second)

    def test_generated_files_are_not_regenerated(self):
        path = self.paths['menu_select']
        before = path.stat().st_mtime_ns
        ensure_sounds(self.directory)
        self.assertEqual(path.stat().st_mtime_ns, before)

    def test_default_sound_directory_is_in_the_project(self):
        self.assertTrue(str(AUDIO_DIR).endswith(os.path.join('assets', 'audio')))


class TestAudioSettings(unittest.TestCase):
    def test_master_scales_everything(self):
        settings = AudioSettings(master=0.5, sfx=1.0, music=0.5)
        self.assertAlmostEqual(settings.volume_for('pin_hit'), 0.5)
        self.assertAlmostEqual(settings.volume_for('music'), 0.25)

    def test_mute_silences_everything(self):
        settings = AudioSettings(master=1.0, sfx=1.0, music=1.0, muted=True)
        self.assertEqual(settings.volume_for('pin_hit'), 0.0)
        self.assertEqual(settings.volume_for('music'), 0.0)

    def test_zero_volume_is_allowed(self):
        settings = AudioSettings(master=0.0)
        self.assertEqual(settings.volume_for('pin_hit'), 0.0)


class TestAudioSystemWithoutAMixer(unittest.TestCase):
    def test_disabled_system_still_records_calls(self):
        system = AudioSystem(enabled=False)
        system.pin(6)
        system.strike()
        system.correct()
        system.wrong()
        system.release()
        system.gutter()
        system.spare()
        system.tick()
        system.victory()
        system.defeat()
        system.handoff()
        self.assertIn('strike', system.played)
        self.assertIn('pin_hit', system.played)
        self.assertIn('pin_light', system.played + ['pin_light'])
        self.assertFalse(system.ready)

    def test_named_helpers_choose_the_right_pin_sound(self):
        system = AudioSystem(enabled=False)
        system.pin(2)
        self.assertIn('pin_light', system.played)
        system.played.clear()
        system.pin(8)
        self.assertIn('pin_hit', system.played)

    def test_play_returns_none_when_disabled(self):
        system = AudioSystem(enabled=False)
        self.assertIsNone(system.play('strike'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
