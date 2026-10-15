// Audio: plays the original synthesised WAVs (shipped from assets/audio) through
// the Web Audio API. Ported from game/audio.py (which generated the WAVs with the
// stdlib). The browser cannot run the Python synthesiser, so the exact output of
// that synthesiser is shipped as static assets instead — the sounds are the
// original, unchanged audio.
const SOUNDS = [
  'menu_move', 'menu_select', 'menu_back', 'confirm', 'ball_release', 'ball_roll',
  'pin_hit', 'pin_light', 'gutter', 'strike', 'spare', 'correct', 'wrong',
  'countdown', 'victory', 'defeat', 'handoff', 'music',
];

export class AudioSettings {
  constructor(master = 0.7, sfx = 0.8, music = 0.35, muted = false) {
    this.master = master; this.sfx = sfx; this.music = music; this.muted = muted;
  }
  volumeFor(name) {
    if (this.muted) return 0.0;
    const base = this.master * (name === 'music' ? this.music : this.sfx);
    return Math.max(0.0, Math.min(1.0, base));
  }
}

export class AudioSystem {
  constructor(settings = null, enabled = true) {
    this.settings = settings || new AudioSettings();
    this.enabled = enabled;
    this._ctx = null;
    this._buffers = {};
    this._musicGain = null;
    this._musicSource = null;
    this._ready = false;
    this.last_error = null;
    this.played = [];
    this._baseUrl = 'assets/audio';
  }

  get ready() { return this._ready && Object.keys(this._buffers).length > 0; }
  get available() { return Object.keys(this._buffers).sort(); }

  _ensureContext() {
    if (this._ctx) return this._ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this._ctx = new Ctx();
    return this._ctx;
  }

  // Call from a user gesture to satisfy autoplay policies.
  unlock() {
    const ctx = this._ensureContext();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  async load() {
    if (this._ready || !this.enabled) return this;
    const ctx = this._ensureContext();
    if (!ctx) { this.enabled = false; return this; }
    try {
      await Promise.all(SOUNDS.map(async (name) => {
        try {
          const response = await fetch(`${this._baseUrl}/${name}.wav`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          this._buffers[name] = audioBuffer;
        } catch (e) { this.last_error = `${name}: ${e}`; }
      }));
      this._ready = true;
      if (!Object.keys(this._buffers).length) this.enabled = false;
    } catch (e) { this.enabled = false; this.last_error = String(e); }
    return this;
  }

  play(name, volumeScale = 1.0) {
    this.played.push(name);
    if (!this.enabled) return null;
    const ctx = this._ensureContext();
    if (!ctx) return null;
    const buffer = this._buffers[name];
    if (!buffer) return null;
    if (ctx.state === 'suspended') ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = name === 'music';
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1.0, this.settings.volumeFor(name) * volumeScale);
    source.connect(gain).connect(ctx.destination);
    source.start();
    if (name === 'music') {
      if (this._musicSource) { try { this._musicSource.stop(); } catch (_e) {} }
      this._musicSource = source;
      this._musicGain = gain;
    }
    return source;
  }

  startMusic() {
    if (this._musicSource) return this._musicSource;
    this._musicSource = this.play('music');
    return this._musicSource;
  }
  stopMusic() {
    const handle = this._musicSource;
    this._musicSource = null;
    if (handle) { try { handle.stop(); } catch (_e) {} }
  }

  applySettings() {
    if (this._musicGain) {
      try { this._musicGain.gain.value = this.settings.volumeFor('music'); } catch (_e) {}
    }
    if (this.settings.muted || this.settings.music <= 0.0) this.stopMusic();
    else if (!this._musicSource) this.startMusic();
  }

  menuMove() { this.play('menu_move'); }
  menuSelect() { this.play('menu_select'); }
  menuBack() { this.play('menu_back'); }
  // snake_case aliases kept so the ported call sites read like the original
  // (App.play('menu_move'), Game._play('menu_select'), ...).
  menu_move() { this.menuMove(); }
  menu_select() { this.menuSelect(); }
  menu_back() { this.menuBack(); }
  confirm() { this.play('confirm'); }
  release() { this.play('ball_release'); }
  pin(count) { this.play(count >= 4 ? 'pin_hit' : 'pin_light'); }
  gutter() { this.play('gutter'); }
  strike() { this.play('strike'); }
  spare() { this.play('spare'); }
  correct() { this.play('correct'); }
  wrong() { this.play('wrong'); }
  tick() { this.play('countdown'); }
  victory() { this.play('victory'); }
  defeat() { this.play('defeat'); }
  handoff() { this.play('handoff'); }
}
