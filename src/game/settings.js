// Persisted player settings (ported from game/settings.py). In the browser the
// store is localStorage instead of settings.json; validation is identical.
import * as config from '../config.js';
import { AudioSettings } from './audio.js';

export const DEFAULTS = {
  input_mode: 'mouse',
  throwing_arm: 'auto',
  camera_index: null,
  master_volume: 0.7,
  sfx_volume: 0.8,
  music_volume: 0.35,
  muted: false,
  hand_menu_navigation: false,
  player_name: 'PLAYER 1',
  bot_difficulty: 'medium',
  rush_duration: 180.0,
  show_physics_readout: true,
  debug_diagnostics: false,
  reduce_motion: false,
};

export const INPUT_MODES = ['mouse', 'webcam'];
export const ARMS = ['auto', 'left', 'right'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
export const RUSH_DURATIONS = [60.0, 120.0, 180.0, 300.0];

const STORAGE_KEY = 'hells-balls-settings';

export class Settings {
  constructor(values = null) {
    this.values = { ...DEFAULTS };
    if (values) Object.assign(this.values, values);
    this.load_error = null;
  }

  load() {
    try {
      if (typeof localStorage === 'undefined') return this;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return this;
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          if (key in DEFAULTS) this.values[key] = value;
        }
      }
    } catch (e) {
      this.load_error = `${STORAGE_KEY}: ${e}`;
      return this;
    }
    this.validate();
    return this;
  }

  save() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
      }
      return true;
    } catch (e) { this.load_error = String(e); return false; }
  }

  validate() {
    const values = this.values;
    if (!INPUT_MODES.includes(values.input_mode)) values.input_mode = DEFAULTS.input_mode;
    if (!ARMS.includes(values.throwing_arm)) values.throwing_arm = DEFAULTS.throwing_arm;
    if (!DIFFICULTIES.includes(values.bot_difficulty)) values.bot_difficulty = DEFAULTS.bot_difficulty;
    for (const key of ['master_volume', 'sfx_volume', 'music_volume']) {
      try { values[key] = Math.max(0.0, Math.min(1.0, parseFloat(values[key]))); }
      catch (_e) { values[key] = DEFAULTS[key]; }
    }
    values.muted = !!values.muted;
    values.hand_menu_navigation = !!values.hand_menu_navigation;
    values.show_physics_readout = !!values.show_physics_readout;
    values.debug_diagnostics = !!values.debug_diagnostics;
    values.reduce_motion = !!values.reduce_motion;
    try {
      const index = values.camera_index;
      values.camera_index = index === null || index === undefined ? null : parseInt(index, 10);
    } catch (_e) { values.camera_index = null; }
    let duration = null;
    try { duration = parseFloat(values.rush_duration); } catch (_e) { duration = null; }
    if (!RUSH_DURATIONS.includes(duration)) values.rush_duration = DEFAULTS.rush_duration;
    let name = String(values.player_name || '').trim();
    values.player_name = name ? name.slice(0, config.MAX_NAME_LENGTH) : DEFAULTS.player_name;
    return this;
  }

  get(key, def = null) { return key in this.values ? this.values[key] : def; }
  update(changes) { Object.assign(this.values, changes); this.validate(); return this; }
  set(key, value) { this.values[key] = value; this.validate(); }

  cycle(key, options) {
    const current = this.values[key];
    const list = Array.from(options);
    const index = list.indexOf(current);
    const value = list[(index + 1) % list.length];
    this.values[key] = value;
    return value;
  }

  audioSettings() {
    // Returns a live AudioSettings (see game/audio.py's audio_settings()).
    return new AudioSettings(
      parseFloat(this.values.master_volume),
      parseFloat(this.values.sfx_volume),
      parseFloat(this.values.music_volume),
      !!this.values.muted);
  }
}
