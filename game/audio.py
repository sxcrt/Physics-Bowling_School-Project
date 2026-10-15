"""Audio: small original sound effects, synthesised with the standard library.

There are no shipped audio files and no downloaded assets: every effect is
generated as a 16-bit PCM WAV by this module on first use (into
``assets/audio/``), so the sounds are original and free of licensing problems.
Generation uses only ``math``, ``struct`` and ``wave``.

Design notes
------------
* Each effect is built from simple, recognisable elements: a menu blip is a
  short sine, a strike is a rising arpeggio with a noise burst, a pin hit is a
  filtered noise knock, a gutter ball is a low descending slide.
* Every buffer is enveloped so nothing clicks, and peak-normalised so the
  volume sliders mean the same thing for every sound.
* Volume and mute live in :class:`AudioSettings` and are applied through
  Ursina's ``Audio.volume``. If the mixer or a file is unavailable the whole
  system degrades to silent no-ops: the game never depends on audio.

``tools/make_sounds.py`` can regenerate the folder without launching the game.
"""
import math
import random
import struct
import wave
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 22050
PEAK = 0.82                       # headroom below full scale
PROJECT_ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = PROJECT_ROOT / 'assets' / 'audio'

# name -> (kind, parameters) used by the synthesiser below.
_SOUND_SPECS = {
    'menu_move': ('blip', 660.0, 0.055, 0.5),
    'menu_select': ('blip', 990.0, 0.085, 0.6),
    'menu_back': ('blip', 440.0, 0.075, 0.5),
    'confirm': ('fanfare', (659.25, 987.77), 0.22),
    'ball_release': ('whoosh', 0.34),
    'ball_roll': ('roll', 0.5),
    'pin_hit': ('knock', 220.0, 0.20, 1.0),
    'pin_light': ('knock', 320.0, 0.12, 0.7),
    'gutter': ('slide', 0.7),
    'strike': ('fanfare', (523.25, 659.25, 783.99, 1046.5), 0.85),
    'spare': ('fanfare', (392.0, 523.25, 659.25), 0.65),
    'correct': ('fanfare', (587.33, 880.0), 0.30),
    'wrong': ('buzz', 0.34),
    'countdown': ('blip', 880.0, 0.07, 0.45),
    'victory': ('fanfare', (523.25, 659.25, 783.99, 1046.5, 1318.5), 1.25),
    'defeat': ('fanfare', (392.0, 329.63, 261.63), 1.0),
    'handoff': ('blip', 740.0, 0.10, 0.45),
    'music': ('music', 8.0),
}

# Music: a slow minor arpeggio pad, quiet by design (it is a bed, not a tune
# the player has to listen to).
_MUSIC_CHORDS = (
    (220.00, 261.63, 329.63),        # A minor
    (174.61, 220.00, 261.63),        # F major
    (196.00, 246.94, 293.66),        # G major
    (164.81, 196.00, 246.94),        # E minor
)


def _envelope(index, total, attack=0.01, release=0.3):
    """Simple attack/release envelope in [0, 1]."""
    attack_samples = max(1, int(total * attack))
    release_samples = max(1, int(total * release))
    if index < attack_samples:
        return index / attack_samples
    if index > total - release_samples:
        return max(0.0, (total - index) / release_samples)
    return 1.0


def _synth_blip(frequency, duration, brightness):
    total = int(SAMPLE_RATE * duration)
    data = []
    for i in range(total):
        t = i / SAMPLE_RATE
        value = math.sin(2 * math.pi * frequency * t)
        value += 0.35 * brightness * math.sin(4 * math.pi * frequency * t)
        data.append(value * _envelope(i, total, 0.02, 0.55))
    return data


def _synth_whoosh(duration):
    total = int(SAMPLE_RATE * duration)
    rng = random.Random(7)
    data = []
    previous = 0.0
    for i in range(total):
        fraction = i / total
        # A short filtered noise burst rising then falling: the ball leaving
        # the hand and rolling away.
        noise = rng.uniform(-1.0, 1.0)
        previous = previous * 0.75 + noise * 0.25
        tone = 0.25 * math.sin(2 * math.pi * (150 + 240 * fraction) *
                               (i / SAMPLE_RATE))
        data.append((previous * 0.8 + tone) * _envelope(i, total, 0.05, 0.7))
    return data


def _synth_roll(duration):
    total = int(SAMPLE_RATE * duration)
    rng = random.Random(11)
    data = []
    previous = 0.0
    for i in range(total):
        noise = rng.uniform(-1.0, 1.0)
        previous = previous * 0.92 + noise * 0.08
        hum = 0.3 * math.sin(2 * math.pi * 48 * (i / SAMPLE_RATE))
        data.append((previous + hum) * _envelope(i, total, 0.15, 0.5))
    return data


def _synth_knock(frequency, duration, weight):
    total = int(SAMPLE_RATE * duration)
    rng = random.Random(int(frequency))
    data = []
    previous = 0.0
    for i in range(total):
        # Impact: a click of noise plus a damped wooden resonance.
        noise = rng.uniform(-1.0, 1.0)
        previous = previous * 0.55 + noise * 0.45
        decay = math.exp(-6.0 * (i / total))
        resonance = math.sin(2 * math.pi * frequency * (i / SAMPLE_RATE)) \
            + 0.4 * math.sin(2 * math.pi * frequency * 2.7 * (i / SAMPLE_RATE))
        data.append((0.7 * previous + 0.5 * weight * resonance * decay)
                    * _envelope(i, total, 0.005, 0.6))
    return data


def _synth_slide(duration):
    total = int(SAMPLE_RATE * duration)
    rng = random.Random(3)
    data = []
    for i in range(total):
        fraction = i / total
        frequency = 300.0 * (1.0 - 0.8 * fraction)
        tone = math.sin(2 * math.pi * frequency * (i / SAMPLE_RATE))
        noise = rng.uniform(-1.0, 1.0) * 0.25 * (1.0 - fraction)
        data.append((0.6 * tone + noise) * _envelope(i, total, 0.05, 0.6))
    return data


def _synth_fanfare(notes, duration):
    total = int(SAMPLE_RATE * duration)
    data = [0.0] * total
    per_note = total / len(notes)
    for index, frequency in enumerate(notes):
        start = int(index * per_note)
        length = int(per_note * 2.2) if index == len(notes) - 1 else int(per_note)
        for offset in range(min(length, total - start)):
            i = start + offset
            t = offset / SAMPLE_RATE
            value = math.sin(2 * math.pi * frequency * t)
            value += 0.3 * math.sin(4 * math.pi * frequency * t)
            data[i] += value * _envelope(offset, length, 0.02, 0.5) * 0.55
    # A quiet shimmer on top so a strike does not sound like a phone keypad.
    rng = random.Random(5)
    for i in range(total):
        data[i] += rng.uniform(-1.0, 1.0) * 0.03 * _envelope(i, total, 0.1, 0.6)
    return data


def _synth_buzz(duration):
    total = int(SAMPLE_RATE * duration)
    data = []
    for i in range(total):
        fraction = i / total
        frequency = 180.0 - 60.0 * fraction
        value = math.sin(2 * math.pi * frequency * (i / SAMPLE_RATE))
        value += 0.5 * math.sin(2 * math.pi * frequency * 1.5 * (i / SAMPLE_RATE))
        data.append(0.7 * value * _envelope(i, total, 0.02, 0.5))
    return data


def _synth_music(duration):
    """A slow four-chord arpeggio pad, quiet enough to sit under gameplay."""
    total = int(SAMPLE_RATE * duration)
    data = [0.0] * total
    per_chord = total / len(_MUSIC_CHORDS)
    for index, chord in enumerate(_MUSIC_CHORDS):
        start = int(index * per_chord)
        length = int(per_chord)
        for step in range(8):
            note = chord[step % len(chord)]
            note_start = start + int(step * length / 8.0)
            note_length = int(length / 5.0)
            for offset in range(min(note_length, total - note_start)):
                i = note_start + offset
                t = offset / SAMPLE_RATE
                value = math.sin(2 * math.pi * note * t)
                value += 0.4 * math.sin(2 * math.pi * note * 2.0 * t)
                value += 0.2 * math.sin(2 * math.pi * note * 0.5 * t)
                data[i] += value * _envelope(offset, note_length, 0.15, 0.7) * 0.18
    return data


def _write_wav(path, samples):
    peak = max(1e-9, max(abs(value) for value in samples))
    scale = PEAK / peak
    frames = bytearray()
    for value in samples:
        clipped = max(-1.0, min(1.0, value * scale))
        frames += struct.pack('<h', int(clipped * 32767))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(bytes(frames))


def synthesise(name):
    """Build the sample list for one named effect."""
    spec = _SOUND_SPECS[name]
    kind = spec[0]
    if kind == 'blip':
        return _synth_blip(spec[1], spec[2], spec[3])
    if kind == 'whoosh':
        return _synth_whoosh(spec[1])
    if kind == 'roll':
        return _synth_roll(spec[1])
    if kind == 'knock':
        return _synth_knock(spec[1], spec[2], spec[3])
    if kind == 'slide':
        return _synth_slide(spec[1])
    if kind == 'fanfare':
        return _synth_fanfare(spec[1], spec[2])
    if kind == 'buzz':
        return _synth_buzz(spec[1])
    if kind == 'music':
        return _synth_music(spec[1])
    raise KeyError(f'unknown sound kind {kind!r}')


def ensure_sounds(directory=None, force=False):
    """Generate every missing sound file; returns a name -> path mapping."""
    directory = Path(directory) if directory is not None else AUDIO_DIR
    paths = {}
    for name in _SOUND_SPECS:
        path = directory / f'{name}.wav'
        if force or not path.exists():
            try:
                _write_wav(path, synthesise(name))
            except Exception as exc:            # pragma: no cover - disk issues
                print(f'[strike-lab] could not write {path}: {exc}')
                continue
        paths[name] = path
    return paths


@dataclass
class AudioSettings:
    """Live audio preferences (persisted by :mod:`game.settings`)."""

    master: float = 0.7
    sfx: float = 0.8
    music: float = 0.35
    muted: bool = False

    def volume_for(self, name):
        if self.muted:
            return 0.0
        base = self.master * (self.music if name == 'music' else self.sfx)
        return max(0.0, min(1.0, base))


@dataclass
class _Voice:
    name: str
    handle: object
    loop: bool = False


class AudioSystem:
    """Loads the generated effects and plays them through Ursina.

    Every call is defensive: if Ursina's audio (or the WAV loader) is
    unavailable, :meth:`play` does nothing at all, so the game is fully
    playable and testable without a mixer.
    """

    def __init__(self, settings=None, directory=None, enabled=True,
                 preload=True):
        self.settings = settings if settings is not None else AudioSettings()
        self.directory = directory
        self.enabled = enabled
        self._paths = {}
        self._cache = {}
        self._ready = False
        self._music = None
        self.last_error = None
        self.played = []                 # names, for tests / diagnostics
        if preload and enabled:
            self.load()

    # ------------------------------------------------------------------ setup
    def _candidate_names(self, path):
        """What to hand Ursina's loader, most likely first.

        Ursina's ``Audio`` loads a :class:`pathlib.Path` directly (which works
        for an absolute path) but treats a *string* as a name to glob under the
        asset folder - and an absolute Windows path matches nothing. So the
        Path object is tried first, then the bare file name (which the loader
        finds anywhere under the asset folder), then the relative path.
        """
        candidates = [path, path.name]
        parent = path.parent.name
        if parent:
            candidates.append(f'{parent}/{path.name}')
        return candidates

    def load(self):
        """Generate (if needed) and load every effect. Safe to call twice."""
        if self._ready or not self.enabled:
            return self
        try:
            self._paths = ensure_sounds(self.directory)
            from ursina import Audio
            for name, path in self._paths.items():
                for candidate in self._candidate_names(path):
                    try:
                        handle = Audio(candidate, autoplay=False,
                                       loop=(name == 'music'))
                    except Exception as exc:         # pragma: no cover
                        self.last_error = f'{name}: {exc}'
                        continue
                    if getattr(handle, 'clip', None) is not None:
                        self._cache[name] = handle
                        break
                    self.last_error = f'{name}: no audio clip for {candidate}'
            self._ready = True
            if not self._cache:
                self.enabled = False
        except Exception as exc:                    # pragma: no cover
            self.enabled = False
            self.last_error = str(exc)
        return self

    @property
    def ready(self):
        return self._ready and bool(self._cache)

    @property
    def available(self):
        """Names that produced a loaded sound."""
        return sorted(self._cache)

    # ---------------------------------------------------------------- playback
    def play(self, name, volume_scale=1.0):
        """Play ``name`` once (a no-op when audio is off or missing)."""
        self.played.append(name)
        if not self.enabled:
            return None
        if not self._ready:
            self.load()
        handle = self._cache.get(name)
        if handle is None:
            return None
        try:
            handle.volume = min(1.0, self.settings.volume_for(name)
                                * volume_scale)
            handle.loop = (name == 'music')
            handle.play()
            return handle
        except Exception as exc:                    # pragma: no cover
            self.last_error = str(exc)
            return None

    def start_music(self):
        if self._music is not None:
            return self._music
        self._music = self.play('music')
        return self._music

    def stop_music(self):
        handle = self._music
        self._music = None
        if handle is not None:
            try:
                handle.stop()
            except Exception:                       # pragma: no cover
                pass

    def apply_settings(self):
        """Re-apply volumes after the player changes a slider."""
        if self._music is not None:
            try:
                self._music.volume = self.settings.volume_for('music')
            except Exception:                       # pragma: no cover
                pass
        if self.settings.muted or self.settings.music <= 0.0:
            self.stop_music()
        elif self._music is None:
            self.start_music()

    # Named helpers keep the call sites readable.
    def menu_move(self):
        self.play('menu_move')

    def menu_select(self):
        self.play('menu_select')

    def confirm(self):
        """The short rising confirmation used by START and PLAY."""
        self.play('confirm')

    def release(self):
        self.play('ball_release')

    def pin(self, count):
        self.play('pin_hit' if count >= 4 else 'pin_light')

    def gutter(self):
        self.play('gutter')

    def strike(self):
        self.play('strike')

    def spare(self):
        self.play('spare')

    def correct(self):
        self.play('correct')

    def wrong(self):
        self.play('wrong')

    def tick(self):
        self.play('countdown')

    def victory(self):
        self.play('victory')

    def defeat(self):
        self.play('defeat')

    def handoff(self):
        self.play('handoff')
