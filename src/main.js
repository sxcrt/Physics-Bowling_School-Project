import * as THREE from 'three';
// The application: screens, settings, audio and global input routing
// (ported from ui/app.py + main.py).
import * as config from './config.js';
import { Settings } from './game/settings.js';
import { AudioSystem } from './game/audio.js';
import { Game } from './game/play.js';
import { MOTION } from './motion/config.js';
import { setView, updateCameraFixed, setupCamera } from './scene/camera.js';
import { manager, renderer, scene } from './scene/renderer.js';
import { buildLane } from './scene/lane.js';
import { Bowler, IDLE, READY, CELEBRATE } from './scene/avatar.js';
import { ScreenManager } from './ui/screens.js';
import { SplashScreen, MainMenuScreen, ModeSelectScreen, HowToPlayScreen, SettingsScreen } from './ui/menu.js';
import { LabScreen } from './ui/lab.js';
import { attachPointer, uiPointer, uiFromClient } from './input/pointer.js';
import { attachKeyboard, heldKeys } from './input/keyboard.js';
import { ballTexture } from './scene/textures.js';
import { unlitMaterial } from './scene/shader.js';

const DWELL_TIME = 1.0;
const DWELL_COOLDOWN = 0.8;

class App {
  constructor() {
    this.settings = new Settings().load();
    MOTION.reduce_motion = !!this.settings.get('reduce_motion', false);
    this.audio = new AudioSystem(this.settings.audioSettings());
    this.audio.load();
    this.dt = 1 / 60;
    this.cameraView = 'menu';
    this._previousScreen = null;
    this._lastRushTick = null;

    const stage = document.getElementById('stage');
    this.stage = stage;
    this._fitStage();
    window.addEventListener('resize', () => this._fitStage());
    const uiRoot = document.getElementById('ui-root');
    this.uiRoot = uiRoot;
    const canvasHost = document.getElementById('canvas-host');
    canvasHost.appendChild(renderer.domElement);

    buildLane();
    setupCamera();
    attachPointer(stage);
    attachKeyboard();

    this.game = new Game({ audio: this.audio, settings: this.settings, app: this, uiRoot });
    this.screens = new ScreenManager(this);
    this.screens.register(this.game);
    this.screens.register(new SplashScreen(this));
    this.screens.register(new MainMenuScreen(this));
    this.screens.register(new ModeSelectScreen(this));
    this.screens.register(new HowToPlayScreen(this));
    this.screens.register(new SettingsScreen(this));
    this.screens.register(new LabScreen(this));

    this.showcaseBall = new THREE.Mesh(new THREE.SphereGeometry(config.BALL_DIAMETER * 0.8, 32, 24),
      unlitMaterial(0xffffff, ballTexture()));
    this.showcaseBall.position.set(0, config.BALL_DIAMETER * 0.8, 1.6);
    scene.add(this.showcaseBall);
    this.showcaseBall.visible = false;

    this.menuBowler = new Bowler([96, 226, 255], [-2.05, 0.0, -1.30], 1.0, 'menu_bowler');
    this.menuBowler.rotation_y = 198.0;
    this.menuBowler.setBallVisible(true);
    this._menuPoseTimer = 0.0;
    this._menuPoseIndex = 0;
    this._menuPoses = [IDLE, READY, IDLE, CELEBRATE];

    this._handCursor = null;
    this._dwell = 0.0;
    this._dwellCooldown = 0.0;
    this._handLast = null;

    this.screens.set('splash');
    this._startMusicIfWanted();
    this._unlocked = false;
    const unlock = () => {
      if (this._unlocked) return;
      this._unlocked = true;
      this.audio.unlock();
      this.audio.load().then(() => {
        if (this.settings.get('music_volume', 0) > 0 && !this.settings.get('muted')) this.audio.startMusic();
      });
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });

    this._bindKeys();
    manager.setFrameCallback((dt) => this.update(dt));
    manager.start();
  }

  // ==== Services ====
  _fitStage() {
    // The stage is a fixed 1280x720 reference grid; scale it as a whole to fit
    // the window (letterboxed) so the layout never distorts or clips. The
    // pointer mapping reads the stage's bounding rect, so it follows the
    // transform automatically.
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    this.stage.style.transform = scale === 1 ? 'none' : `scale(${scale})`;
  }

  play(cue) {
    const method = this.audio[cue];
    if (typeof method === 'function') { try { method.call(this.audio); } catch (_e) {} }
  }

  saveSettings() { return this.settings.save(); }

  applySettings() {
    this.audio.settings = this.settings.audioSettings();
    MOTION.reduce_motion = !!this.settings.get('reduce_motion', false);
    const mode = this.settings.get('input_mode', 'mouse');
    if (this.screens.active === this.game) {
      this.game.set_input_mode(mode, false);
      this._applyArm();
    }
    this.audio.applySettings();
  }

  _startMusicIfWanted() {
    if (this.settings.get('music_volume', 0.0) > 0.0 && !this.settings.get('muted')) this.audio.startMusic();
  }

  _applyArm() {
    const arm = this.settings.get('throwing_arm', 'auto');
    const webcam = this.game.inputs.webcam;
    if (webcam && webcam.setPreferredArm) webcam.setPreferredArm(arm);
  }

  playerName(index, def = null) {
    if (index === 0) return this.settings.get('player_name') || (def || 'PLAYER 1');
    return this.settings.get(`player_name_${index}`, def || `PLAYER ${index + 1}`);
  }
  setPlayerName(index, name) {
    name = String(name || '').trim().slice(0, config.MAX_NAME_LENGTH);
    if (!name) return;
    if (index === 0) this.settings.set('player_name', name);
    else this.settings.set(`player_name_${index}`, name);
    this.saveSettings();
  }

  // ==== Screen routing ====
  setCameraView(name) {
    this.cameraView = name;
    setView(name);
    this._updateShowcase();
  }

  _updateShowcase() {
    // The play ball and the match avatars belong to the play screen (or the lab).
    // Only the current player's avatar may be visible: the other slots keep
    // their own visibility (set by the play screen), so a leftover avatar from
    // an earlier match can never stand on the lane.
    const active = this.screens.active;
    const inPlay = active === this.game;
    const inLab = active === this.screens.get('lab');
    this.showcaseBall.visible = false;
    for (const [index, avatar] of Object.entries(this.game._avatars)) {
      const current = this.game.match ? this.game.match.current_player.index : -1;
      avatar.visible = inPlay && Number(index) === current;
    }
    this.menuBowler.visible = this._menuBowlerVisible();
    if (inPlay) {
      this.game.ball.visible = true;
      this.game.ball.shadow.visible = true;
    } else if (!inLab) {
      this.game.ball.visible = false;
      this.game.ball.shadow.visible = false;
    }
  }

  goToMenu() { this.screens.set('menu'); this._applyArm(); }
  goToModes() { this.screens.set('modes'); }
  goToHelp() { this.screens.set('howto'); }
  goToLab(match = null, throwData = null) { this.screens.set('lab', { match, throw: throwData }); }
  open_settings(fromGame = false) {
    this._previousScreen = fromGame ? 'play' : 'menu';
    this.screens.set('settings');
  }
  leaveSettings() {
    if (this._previousScreen === 'play') this.screens.set('play');
    else this.screens.set('menu');
    this._previousScreen = null;
  }
  startMatch(modeId, playerSpecs = null, duration = null) {
    this.game.configure(modeId, playerSpecs, duration);
    this.game.set_input_mode(this.settings.get('input_mode', 'mouse'), false);
    this._applyArm();
    this.screens.set('play');
  }
  quit() {
    window.close();
  }

  // ==== Hand menu navigation (experimental) ====
  get handNavigationEnabled() { return !!this.settings.get('hand_menu_navigation'); }

  _ensureHandCursor() {
    if (this._handCursor) return;
    const cursor = document.createElement('div');
    cursor.style.cssText = `position:absolute;width:14px;height:14px;border-radius:7px;background:${'rgba(96,226,255,0.85)'};display:none;pointer-events:none;`;
    this.uiRoot.appendChild(cursor);
    const ring = document.createElement('div');
    ring.style.cssText = 'position:absolute;width:36px;height:36px;border-radius:18px;background:rgba(255,181,71,0.35);display:none;pointer-events:none;';
    this.uiRoot.appendChild(ring);
    this._handCursor = cursor;
    this._handRing = ring;
  }

  _updateHandNavigation() {
    if (!this.handNavigationEnabled || this.screens.active === this.game) {
      if (this._handCursor) { this._handCursor.style.display = 'none'; this._handRing.style.display = 'none'; }
      return;
    }
    const webcam = this.game.inputs.webcam;
    if (!webcam) return;
    if (webcam.setGameReady) webcam.setGameReady(false);
    const snapshot = webcam.latestSnapshot();
    let wrist = null;
    if (snapshot && snapshot.tracked) {
      for (const name of ['right_wrist', 'left_wrist']) {
        const lm = snapshot.landmarks[name];
        if (lm && lm.visibility >= 0.4) { wrist = lm; break; }
      }
    }
    this._ensureHandCursor();
    if (!wrist) {
      this._handCursor.style.display = 'none';
      this._handRing.style.display = 'none';
      this._handLast = null;
      this._dwell = 0.0;
      return;
    }
    const xPx = (0.5 - wrist.x) * 1280 * 1.4 + 640 - 640;
    const yPx = (wrist.y) * 720;
    const x = Math.max(20, Math.min(1260, 640 + (0.5 - wrist.x) * 900));
    const y = Math.max(20, Math.min(700, wrist.y * 720));
    this._handCursor.style.display = 'block';
    this._handCursor.style.left = `${x}px`;
    this._handCursor.style.top = `${y}px`;
    this._handRing.style.display = 'block';
    this._handRing.style.left = `${x - 11}px`;
    this._handRing.style.top = `${y - 11}px`;
    this._dwellCooldown = Math.max(0.0, this._dwellCooldown - this.dt);
    const target = document.elementFromPoint(
      this.stage.getBoundingClientRect().left + (x / 1280) * this.stage.getBoundingClientRect().width,
      this.stage.getBoundingClientRect().top + (y / 720) * this.stage.getBoundingClientRect().height);
    const moved = this._handLast !== null && Math.abs(x - this._handLast[0]) > 40;
    this._handLast = [x, y];
    if (!target || this._dwellCooldown > 0.0) { this._dwell = 0.0; return; }
    this._dwell += this.dt;
    const progress = Math.min(1.0, this._dwell / DWELL_TIME);
    this._handRing.style.transform = `scale(${1 + 0.6 * progress})`;
    if (progress >= 1.0) {
      this._dwell = 0.0;
      this._dwellCooldown = DWELL_COOLDOWN;
      this.play('menu_select');
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  }

  // ==== Per-frame ====
  update(dt) {
    this.dt = Math.max(0.0, Math.min(0.1, dt));
    const active = this.screens.active;
    if (active === this.game) this.game.update(this.dt);
    else {
      this.screens.update(this.dt);
      updateCameraFixed(this.dt, this.cameraView);
      this._updateHandNavigation();
    }
    if (this.showcaseBall.visible) this.showcaseBall.rotation.y += 24.0 * this.dt;
    this._updateMenuBowler();
  }

  _menuBowlerVisible() {
    const active = this.screens.active;
    if (active === this.game) return false;
    const textScreens = ['lab', 'howto', 'settings'];
    return !textScreens.some((name) => active === this.screens.get(name));
  }

  _updateMenuBowler() {
    const visible = this._menuBowlerVisible();
    this.menuBowler.visible = visible;
    this.menuBowler.enabled = visible;
    if (!visible) return;
    this._menuPoseTimer += this.dt;
    if (this._menuPoseTimer >= 4.0) {
      this._menuPoseTimer = 0.0;
      this._menuPoseIndex = (this._menuPoseIndex + 1) % this._menuPoses.length;
      this.menuBowler.setState(this._menuPoses[this._menuPoseIndex]);
    }
    this.menuBowler.update(this.dt);
  }

  // ==== Input ====
  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const key = normalizeKey(e.key);
      if (key === null) return;
      if (key === 'f12') { this._screenshot(); e.preventDefault(); return; }
      const handled = this.onKey(key);
      if (handled || ['space', 'tab', 'up arrow', 'down arrow', 'left arrow', 'right arrow'].includes(key)) e.preventDefault();
    });
    // Real mouse clicks are routed to the active screen's on_click, mirroring
    // the original's ``left mouse down`` handling (splash click-to-start,
    // handoff click-to-confirm, ...). DOM buttons stop propagation so they
    // never double-fire through this route.
    window.addEventListener('click', (e) => {
      if (e.button !== 0) return;
      const [x, y] = uiFromClient(e.clientX, e.clientY, this.stage);
      this.screens.onClick(x, y);
    });
  }

  onKey(key) {
    const handled = this.screens.onKey(key);
    if (!handled && key === 'escape' && this.screens.active !== this.game) { this.screens.set('menu'); return true; }
    return handled;
  }

  _screenshot() {
    try {
      const url = renderer.domElement.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = url;
      link.download = `hells_balls_${Date.now()}.png`;
      link.click();
    } catch (_e) {}
  }
}

function normalizeKey(key) {
  const map = {
    ArrowLeft: 'left arrow', ArrowRight: 'right arrow', ArrowUp: 'up arrow',
    ArrowDown: 'down arrow', ' ': 'space', Enter: 'enter', Escape: 'escape',
    Tab: 'tab', Backspace: 'backspace', F12: 'f12', Shift: 'left shift',
  };
  if (map[key]) return map[key];
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase();
}

// ==== Bootstrap ====
function boot() {
  const app = new App();
  window.__hellsBalls = app;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
