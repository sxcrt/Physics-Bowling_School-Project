// The Physics Lab (ported from ui/lab_screen.py): one throw studied on the real lane.
import * as config from '../config.js';
import { DeckTimeline, RollResult } from '../physics.js';
import { fovPushIn, fovReset, updateCamera } from '../scene/camera.js';
import { setShadowFocus } from '../scene/shadow.js';
import { COLORS, css, cssA, wrapText } from './theme.js';
import { div, el, button as makeButton } from './dom.js';
import { iconNode } from './icons.js';
import { Screen } from './screens.js';
import { clampLaunchValue, parseLaunchValue } from './number_field.js';

const READOUT = [
  ['t', 't', 's'], ['v', 'v', 'm/s'], ['a', 'a', 'm/s2'], ['vx', 'vx', 'm/s'],
  ['spin', 'spin', 'rad/s'], ['p', 'p', 'kg m/s'], ['k', 'K', 'J'], ['pins', 'pins', ''],
];
const ROWS = [['speed', 'SPEED'], ['lateral', 'START X'], ['angle', 'AIM'], ['spin', 'HOOK']];
const STEPS = { speed: 0.25, lateral: 0.05, angle: 0.2, spin: 0.5 };
const UNITS = { speed: 'm/s', lateral: 'm', angle: 'deg', spin: 'rad/s' };

// Show up to three decimals without trailing zeros, so a typed 11.37 stays
// 11.37 instead of being rounded to the old two/one-decimal display.
function formatValue(value, signed = false) {
  let text = value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  if (text === '-0') text = '0';
  return signed && value >= 0 ? `+${text}` : text;
}

export function equationLines(key, ctx) {
  if (key === 't') return ['t = steps x dt', `= ${ctx.steps} x ${ctx.dt_label} s = ${ctx.t.toFixed(2)} s`];
  if (key === 'v') return ['v = sqrt(vx^2 + vz^2)', `= sqrt(${ctx.vx.toFixed(2)}^2 + ${ctx.vz.toFixed(2)}^2) = ${ctx.v.toFixed(2)} m/s`];
  if (key === 'a') {
    if (ctx.regime === 'rest') return ['a = -mu g', '= 0.00 m/s2 (ball at rest)'];
    return [`a = -mu g   (${ctx.regime})`, `= -${ctx.friction.toFixed(2)} x ${ctx.gravity.toFixed(2)} = ${ctx.a.toFixed(2)} m/s2`];
  }
  if (key === 'vx') return ['vx = v sin(theta)', `= ${ctx.v.toFixed(2)} sin(${ctx.heading.toFixed(1)} deg) = ${ctx.vx.toFixed(2)} m/s`];
  if (key === 'spin') return ['spin = |(wx, wy, wz)|', `= |(${ctx.wx.toFixed(1)}, ${ctx.wy.toFixed(1)}, ${ctx.wz.toFixed(1)})| = ${ctx.spin.toFixed(1)} rad/s`];
  if (key === 'p') return ['p = m v', `= ${ctx.mass.toFixed(2)} x ${ctx.v.toFixed(3)} = ${ctx.p.toFixed(1)} kg m/s`];
  if (key === 'k') return ['K = 0.5 m v^2', `= 0.5 x ${ctx.mass.toFixed(2)} x ${ctx.v.toFixed(3)}^2 = ${ctx.k.toFixed(1)} J`];
  return [`pins = ${ctx.count} - standing`, `= ${ctx.count} - ${ctx.standing} = ${Math.round(ctx.pins)}`];
}

export class LabScreen extends Screen {
  constructor(app) { super(app); this.name = 'lab'; this.camera_view = 'game'; }
  build() {
    super.build();
    this.setup = { speed: 7.5, lateral: 0.20, angle: -0.4, spin: -1.6 };
    this.timeline = new DeckTimeline();
    this.timelineIndex = null;
    this.tlDragging = false;
    this.state = 'idle';
    this.paused = false;
    this.result = null;
    this._timer = 0.0;
    this._settleElapsed = 0.0;
    this._frames = 0;
    this._hit = false;
    this._releaseSpeed = 0.0;
    this.values = Object.fromEntries(READOUT.map(([key]) => [key, 0.0]));
    this.openRow = null;

    const title = el('div', '', this.root, 'PHYSICS LAB');
    title.style.cssText = `position:absolute;left:640px;top:20px;transform:translateX(-50%);font-size:40px;font-weight:900;letter-spacing:2px;color:#fff;`
      + `text-shadow:0 0 12px ${cssA(COLORS.pink, 0.8)};`;

    // left panel: throw controls
    this.launchPanel = this._panel(-0.6489, 0.0, 0.44, 0.66);
    const launchHead = div('', this.launchPanel);
    launchHead.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;';
    const launchTitle = el('div', '', launchHead, 'THROW');
    launchTitle.style.cssText = `font-size:14px;font-weight:700;letter-spacing:1px;color:${css(COLORS.cyan)};`;
    const launchHint = el('div', '', launchHead, 'CLICK A VALUE TO TYPE IT');
    launchHint.style.cssText = `font-size:12px;color:${css(COLORS.dim)};`;
    this.steppers = {};
    for (const [key, caption] of ROWS) {
      this.steppers[key] = this._stepper(key, caption, (dir) => this._step(key, dir));
    }
    this.pauseButton = makeButton(this.root, 'PAUSE', {
      x: 100.8, y: 414, w: 129, h: 36, radius: 10, accent: [255, 214, 130], variant: 'secondary', fontPx: 15,
      onClick: () => this.togglePause(),
    });
    this.resetButton = makeButton(this.root, 'RESET', {
      x: 244.8, y: 414, w: 129, h: 36, radius: 10, accent: [176, 184, 210], variant: 'secondary', fontPx: 15,
      onClick: () => this.reset(),
    });
    const stateTitle = el('div', '', this.launchPanel, 'BALL STATE  (SI)');
    stateTitle.style.cssText = `position:absolute;left:20px;top:319px;font-size:13px;color:${css(COLORS.dim)};`;
    this.stateText = el('div', '', this.launchPanel, '');
    this.stateText.style.cssText = `position:absolute;left:20px;top:337px;font-size:13px;color:${css(COLORS.grey)};white-space:pre;font-family:monospace;`;
    this.bowlButton = makeButton(this.root, 'BOWL', {
      x: 172.8, y: 558, w: 273, h: 44, radius: 12, accent: [74, 222, 128], variant: 'primary', fontPx: 18,
      onClick: () => this.bowl(),
    });

    // right panel: live readout
    this.livePanel = this._panel(0.6489, 0.0, 0.44, 0.66);
    const liveHead = div('', this.livePanel);
    liveHead.style.cssText = 'display:flex;align-items:baseline;justify-content:space-between;';
    const liveTitle = el('div', '', liveHead, 'LIVE');
    liveTitle.style.cssText = `font-size:14px;font-weight:700;letter-spacing:1px;color:${css([120, 230, 140])};`;
    const liveHint = el('div', '', liveHead, 'CLICK A ROW FOR THE EQUATION');
    liveHint.style.cssText = `font-size:12px;color:${css(COLORS.dim)};`;
    this.liveRows = {};
    for (const [key, label, _unit] of READOUT) {
      const row = div('live-row', this.livePanel);
      row.style.cssText = `display:flex;justify-content:space-between;padding:8px 12px;border-radius:10px;`
        + `background:${cssA(COLORS.card, 1)};border:1px solid ${cssA(COLORS.hairline, 1)};cursor:pointer;margin-top:6px;`
        + 'transition:background 0.12s ease,border-color 0.12s ease,transform 0.1s ease;';
      row.addEventListener('pointerenter', () => {
        row.style.background = cssA(COLORS.card_high, 1);
        row.style.borderColor = cssA(COLORS.cyan, 0.5);
      });
      row.addEventListener('pointerleave', () => {
        row.style.background = cssA(COLORS.card, 1);
        row.style.borderColor = cssA(COLORS.hairline, 1);
        row.style.transform = 'none';
      });
      row.addEventListener('pointerdown', () => { row.style.transform = 'scale(0.99)'; });
      row.addEventListener('pointerup', () => { row.style.transform = 'none'; });
      row.addEventListener('pointercancel', () => { row.style.transform = 'none'; });
      const name = el('div', '', row, label);
      name.style.cssText = `font-size:14px;color:${css(COLORS.grey)};`;
      const value = el('div', '', row, '0.00');
      value.style.cssText = 'font-size:14px;color:#fff;';
      const detail = el('div', '', this.livePanel, '');
      detail.style.cssText = `display:none;padding:6px 12px;font-size:12px;color:${css(COLORS.grey)};white-space:pre-wrap;`;
      row.addEventListener('click', () => {
        if (this.openRow === key) { this.openRow = null; }
        else this.openRow = key;
        this._renderReadout();
        this.app.play('menu_move');
      });
      this.liveRows[key] = { row, value, detail };
    }
    makeButton(this.root, 'BACK TO MENU', {
      x: 1107.2, y: 687.6, w: 273, h: 40, radius: 10, accent: [176, 184, 210], variant: 'ghost', fontPx: 16,
      onClick: () => this.app.goToMenu(),
    }).dataset.role = 'back';

    this.banner = el('div', '', this.root, '');
    this.banner.style.cssText = `position:absolute;left:640px;top:81px;transform:translateX(-50%);font-size:18px;font-weight:900;color:#fff;`
      + `text-shadow:0 0 18px ${cssA([255, 214, 130], 0.8)};`;

    // timeline
    this.tlPanel = this._panel(0, -0.415, 0.828, 0.16);
    this.tlPanel.style.height = '115px';
    this.tlStatus = el('div', '', this.root, 'ready - click BOWL to start the run');
    this.tlStatus.style.cssText = `position:absolute;left:640px;bottom:16px;transform:translateX(-50%);font-size:12px;color:${css(COLORS.dim)};`;
    const tlTitle = el('div', '', this.root, 'TIMELINE');
    tlTitle.style.cssText = `position:absolute;left:366px;top:617px;font-size:16px;font-weight:700;color:${css([255, 214, 130])};`;
    this.tlTime = el('div', '', this.root, 't =  0.000 s /  0.000 s');
    this.tlTime.style.cssText = `position:absolute;left:640px;top:617px;transform:translateX(-50%);font-size:14px;color:#fff;`;
    this.tlTrack = div('tl-track', this.root);
    this.tlTrack.style.cssText = `position:absolute;left:364px;top:656px;width:553px;height:8px;border-radius:4px;`
      + `background:${cssA(COLORS.hairline, 1)};cursor:pointer;`;
    this.tlFill = div('tl-fill', this.tlTrack);
    this.tlFill.style.cssText = 'width:0%;height:100%;border-radius:4px;background:#3ec9e8;';
    this.tlThumb = div('tl-thumb', this.tlTrack);
    this.tlThumb.style.cssText = 'position:absolute;top:-6px;left:0;width:20px;height:20px;border-radius:10px;background:#fff;transform:translateX(-50%);';
    this._bindScrub();
  }
  _panel(xUi, yUi, wUi, hUi) {
    const panel = div('lab-panel', this.root);
    const w = wUi * 720, h = hUi * 720;
    panel.style.cssText = `position:absolute;left:${640 + xUi * 720 - w / 2}px;top:${360 - yUi * 720 - h / 2}px;`
      + `width:${w}px;height:${h}px;border-radius:16px;background:${cssA(COLORS.panel, 0.85)};padding:20px;box-sizing:border-box;`
      + 'border:1px solid transparent;border-image:linear-gradient(90deg, rgba(62,201,232,0.5), rgba(255,61,139,0.5)) 1;overflow:auto;';
    return panel;
  }
  _stepper(key, caption, onStep) {
    const row = div('lab-stepper', this.launchPanel);
    row.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-radius:10px;`
      + `background:${cssA(COLORS.card, 1)};border:1px solid ${cssA(COLORS.hairline, 1)};margin-top:8px;cursor:pointer;`;
    const name = el('div', '', row, caption);
    name.style.cssText = `font-size:15px;color:${css(COLORS.cyan)};`;
    const right = div('', row);
    right.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const left = el('div', '', right);
    left.style.cssText = `color:${css(COLORS.cyan)};display:flex;flex:none;`;
    left.appendChild(iconNode('arrow_left', { size: 13, color: css(COLORS.cyan) }));
    // The number itself is a real text field, so the player can type an exact
    // launch (7.63 m/s, -1.25 deg) instead of being limited to the arrow step.
    // The unit sits beside it and is never part of what gets parsed.
    const val = el('input', 'lab-value', right);
    val.type = 'text';
    val.inputMode = 'decimal';
    val.autocomplete = 'off';
    val.spellcheck = false;
    val.setAttribute('aria-label', `${caption} - type a value and press Enter`);
    val.style.cssText = `width:74px;padding:2px 6px;border:1px solid transparent;border-radius:6px;`
      + `background:transparent;color:#fff;font:700 15px/1.25 inherit;text-align:center;`
      + 'outline:none;user-select:text;';
    val.value = this._valueText(key);
    const unit = el('div', '', right, UNITS[key]);
    unit.style.cssText = `flex:none;min-width:38px;font-size:12px;color:${css(COLORS.dim)};`;
    const rightArrow = el('div', '', right);
    rightArrow.style.cssText = `color:${css(COLORS.cyan)};display:flex;flex:none;`;
    rightArrow.appendChild(iconNode('arrow_right', { size: 13, color: css(COLORS.cyan) }));
    left.addEventListener('click', (e) => { e.stopPropagation(); onStep(-1); });
    rightArrow.addEventListener('click', (e) => { e.stopPropagation(); onStep(1); });
    row.addEventListener('click', () => onStep(1));
    // Typing must not also trigger the row's step, and the game's global key
    // handler already ignores INPUT targets, so the field owns its keys.
    val.addEventListener('pointerdown', (e) => e.stopPropagation());
    val.addEventListener('click', (e) => e.stopPropagation());
    val.addEventListener('focus', () => {
      val.style.borderColor = cssA(COLORS.cyan, 0.7);
      val.style.background = cssA(COLORS.cyan, 0.10);
      // Select the whole number so the first keystroke replaces it, and do it
      // after the click finishes (a mouseup would otherwise collapse the
      // selection back to a caret).
      window.setTimeout(() => { if (document.activeElement === val) val.select(); }, 0);
    });
    val.addEventListener('blur', () => {
      val.style.borderColor = 'transparent';
      val.style.background = 'transparent';
      this._commitValue(key, val);
    });
    val.addEventListener('change', () => this._commitValue(key, val));
    val.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); val.blur(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        val.value = this._valueText(key);
        val.blur();
      }
    });
    return { row, val, valueText: () => this._valueText(key) };
  }
  _bindScrub() {
    const scrub = (e) => {
      const rect = this.tlTrack.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (!this.timeline.length) return;
      const index = this.timeline.indexAt(fraction * this.timeline.duration());
      this.scrubTo(index);
    };
    this.tlTrack.addEventListener('mousedown', (e) => { this.tlDragging = true; scrub(e); });
    window.addEventListener('mousemove', (e) => { if (this.tlDragging) scrub(e); });
    window.addEventListener('mouseup', () => { this.tlDragging = false; });
  }
  _valueText(key) {
    const s = this.setup;
    if (key === 'speed') return formatValue(s.speed);
    if (key === 'lateral') return formatValue(s.lateral, true);
    if (key === 'angle') return formatValue(s.angle, true);
    return formatValue(s.spin, true);
  }
  _commitValue(key, input) {
    const value = parseLaunchValue(key, input.value);
    if (value !== null && value !== this.setup[key]) {
      this.setup[key] = value;
      this.app.play('menu_move');
    }
    // Invalid text simply snaps back to the last accepted number.
    input.value = this._valueText(key);
  }
  _step(key, direction) {
    this.setup[key] = clampLaunchValue(key, this.setup[key] + STEPS[key] * direction);
    for (const k of Object.keys(this.steppers)) {
      const input = this.steppers[k].val;
      if (document.activeElement !== input) input.value = this._valueText(k);
    }
    this.app.play('menu_move');
  }
  onShow(kwargs = {}) {
    this.app.setCameraView('game');
    // The lab frames the whole alley, so the shadow frustum opens out to cover
    // the approach, the lane and the deck together.
    setShadowFocus(0.0, 9.0, 10.4);
    if (kwargs.throw) this._loadThrow(kwargs.throw);
    this._begin();
  }
  _loadThrow(throwData) {
    this.setup.speed = Math.max(0, throwData.speed);
    this.setup.lateral = throwData.lateral_position;
    this.setup.angle = throwData.launch_angle * 180 / Math.PI;
    this.setup.spin = throwData.spin_omega;
    for (const k of Object.keys(this.steppers)) this.steppers[k].val.value = this._valueText(k);
  }
  hide() {
    super.hide();
    const game = this.app.game;
    const deck = game.pins.deck;
    deck.substep_listener = null;
    deck.record_trajectory = false;
    deck.trajectory = [];
    game.pins.reset();
    fovReset();
    this.paused = false;
    this.tlDragging = false;
    this.timeline.clear();
    this.timelineIndex = null;
  }
  _begin() {
    const game = this.app.game;
    const deck = game.pins.deck;
    deck.substep_listener = null;
    deck.record_trajectory = false;
    deck.trajectory = [];
    game.pins.reset();
    game.ball.reset(this.setup.lateral);
    game.ball.visible = true;
    game.ball.shadow.visible = true;
    fovReset();
    this.result = null;
    this.state = 'idle';
    this.paused = false;
    this._timer = 0.0;
    this._settleElapsed = 0.0;
    this._frames = 0;
    this._hit = false;
    this._releaseSpeed = 0.0;
    this.timeline.clear();
    this.timelineIndex = null;
    this.tlDragging = false;
    this.banner.textContent = '';
    this.status('ready - click BOWL to start the run');
    this.syncControls();
    this._renderReadout();
    this._updateTimelineUi();
  }
  bowl() {
    if (['rolling', 'settling'].includes(this.state) && !this.paused) return;
    this._begin();
    const game = this.app.game;
    game.pins.beginRoll();
    const throwData = {
      lateral_position: this.setup.lateral, launch_angle: this.setup.angle * Math.PI / 180,
      speed: this.setup.speed, spin_omega: this.setup.spin, source: 'script', confidence: 1.0,
    };
    game.ball.launch(throwData);
    const deck = game.pins.deck;
    deck.recordStart();
    this.timeline.clear();
    deck.substep_listener = (d) => this.timeline.record(d);
    this.timeline.record(deck);
    this._releaseSpeed = throwData.speed;
    this.timelineIndex = 0;
    this._frames = 0;
    this._hit = false;
    this.state = 'rolling';
    this.paused = false;
    this.status('rolling - pause or drag the timeline any time');
    this.syncControls();
    this.app.play('release');
  }
  reset() { this._begin(); this.app.play('menu_move'); }
  pause() {
    if (!this._pauseAvailable()) return;
    this.paused = true;
    this.status('paused - drag the timeline to inspect a moment');
    this.syncControls();
  }
  resume() {
    if (!this.paused) return;
    const game = this.app.game;
    const deck = game.pins.deck;
    if (this.timelineIndex !== null && this.timelineIndex < this.timeline.length - 1) {
      this.timeline.truncate(this.timelineIndex);
      this.result = null;
      this.banner.textContent = '';
      if (deck.record_trajectory) deck.trajectory.length = this.timelineIndex;
      if (deck.ball.rolling) this.state = 'rolling';
      else {
        this.state = 'settling';
        this._settleElapsed = 0.0;
        this._timer = game.pins.deckQuiet() ? 0.05 : config.SETTLE_DELAY;
      }
      this._hit = deck.first_contact_time !== null;
    }
    this.paused = false;
    this.status(this.state === 'rolling' ? 'rolling' : 'settling - the pins are still falling');
    this.syncControls();
  }
  togglePause() { if (this.paused) this.resume(); else this.pause(); }
  _pauseAvailable() {
    if (!this.timeline.length) return false;
    return this.paused || ['rolling', 'settling'].includes(this.state);
  }
  timelineAvailable() { return !!this.timeline.length; }
  scrubTo(index) {
    if (!this.timelineAvailable()) return;
    const game = this.app.game;
    const deck = game.pins.deck;
    index = this.timeline.restore(deck, index);
    this.timelineIndex = index;
    this.paused = true;
    game.ball.finished = deck.ball_done;
    if (deck.first_contact_time !== null) fovPushIn(); else fovReset();
    this._renderReadout();
    this._updateTimelineUi();
    this.syncControls();
    this.status('paused - drag the timeline to inspect a moment');
  }
  status(text, warn = false) {
    if (this.tlStatus.textContent === text) return;
    this.tlStatus.textContent = text;
    this.tlStatus.style.color = css(warn ? [255, 214, 130] : COLORS.dim);
  }
  syncControls() {
    const moving = ['rolling', 'settling'].includes(this.state) && !this.paused;
    const label = moving ? 'ROLLING...' : (this.state === 'idle' ? 'BOWL' : (this.timeline.length ? 'BOWL AGAIN' : 'BOWL'));
    this.bowlButton.textContent = label;
    this.bowlButton.style.opacity = moving ? '0.5' : '1';
    this.pauseButton.textContent = this.paused ? 'RESUME' : 'PAUSE';
  }
  onUpdate(dt) {
    const game = this.app.game;
    if (!game || !game.ball) return;
    game.ball.visible = true;
    game.ball.shadow.visible = true;
    if (!this.paused) {
      if (this.state === 'rolling') this._advanceRolling(dt);
      else if (this.state === 'settling') this._advanceSettling(dt);
    }
    this._updateCamera();
    game.pins.update();
    game.ball.update();
    this._renderReadout();
    this._updateTimelineUi();
  }
  _advanceRolling(dt) {
    const game = this.app.game;
    game.pins.advance(game.ball, dt);
    this._frames += 1;
    const deck = game.pins.deck;
    if (!this._hit && deck.first_contact_time !== null) { this._hit = true; this.app.play('pin'); fovPushIn(); }
    if (game.ball.finished || deck.ball_done) {
      this.state = 'settling';
      this._settleElapsed = 0.0;
      this._timer = config.SETTLE_DELAY;
      this.syncControls();
    }
    this.timelineIndex = this.timeline.length - 1;
  }
  _advanceSettling(dt) {
    const game = this.app.game;
    game.pins.settle(dt);
    this._frames += 1;
    this._timer -= dt;
    this._settleElapsed += dt;
    if (this._timer <= 0.0 && (game.pins.deckQuiet() || this._settleElapsed >= config.SETTLE_MAX_TIME)) this._resolve();
    this.timelineIndex = this.timeline.length - 1;
  }
  _updateCamera() {
    const game = this.app.game;
    const ball = game.ball;
    const dt = this.dt;
    if (this.state === 'idle') updateCamera(ball, 'ready', dt);
    else if (this.paused) updateCamera(ball, ball.physics.rolling ? 'rolling' : 'settling', dt);
    else if (this.state === 'rolling') updateCamera(ball, 'rolling', dt);
    else updateCamera(ball, 'settling', dt);
  }
  _resolve() {
    const deck = this.app.game.pins.deck;
    this.result = new RollResult(deck, this._frames, this._releaseSpeed);
    const pins = this.result.knockdowns;
    if (pins >= 10) { this.banner.textContent = 'STRIKE'; this.banner.style.color = css([120, 230, 140]); this.app.play('strike'); }
    else if (pins <= 0) { this.banner.textContent = 'GUTTER'; this.banner.style.color = css([226, 58, 40]); this.app.play('gutter'); }
    else { this.banner.textContent = `${pins} PINS`; this.banner.style.color = css([255, 214, 130]); this.app.play('pin'); }
    this.state = 'done';
    this.paused = false;
    this.timelineIndex = this.timeline.length - 1;
    this.status('run complete - drag the timeline or bowl again');
    this.syncControls();
  }
  _updateTimelineUi() {
    const total = this.timeline.duration();
    const current = this.app.game.pins.deck.elapsed;
    const fraction = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
    this.tlFill.style.width = `${Math.max(0.1, fraction * 100)}%`;
    this.tlThumb.style.left = `${fraction * 100}%`;
    this.tlTime.textContent = `t = ${current.toFixed(3)} s / ${total.toFixed(3)} s` + (this.paused ? '   (paused)' : '');
    this.tlTime.style.color = css(this.paused ? [255, 214, 130] : [255, 255, 255]);
  }
  _equationContext(ball, deck, values) {
    const rolling = ball.rolling && !ball.stopped;
    let friction, regime;
    if (!rolling) { friction = 0.0; regime = 'rest'; }
    else if (ball.in_gutter) { friction = config.GUTTER_FRICTION; regime = 'gutter'; }
    else if (ball.slipSpeed() > config.SLIP_TOLERANCE) { friction = config.SLIDING_FRICTION; regime = 'skid'; }
    else { friction = config.ROLLING_FRICTION; regime = 'roll'; }
    const [vx, _vy, vz] = ball.velocity;
    const [wx, wy, wz] = ball.angular_velocity;
    const substep = Math.max(config.PHYSICS_SUBSTEP, 1e-9);
    return {
      t: deck.elapsed, steps: Math.round(deck.elapsed / config.PHYSICS_SUBSTEP),
      dt_label: `1/${Math.round(1.0 / substep)}`, v: values.v, vx, vz,
      heading: (vx || vz) ? Math.atan2(vx, vz) * 180 / Math.PI : 0.0,
      a: values.a, friction, regime, wx, wy, wz, spin: values.spin,
      p: values.p, k: values.k, pins: values.pins, count: config.PIN_COUNT,
      standing: this.app.game.pins.standingCount(),
      mass: config.BALL_MASS, gravity: config.GRAVITY,
    };
  }
  _renderReadout() {
    const game = this.app.game;
    const ball = game.ball.physics;
    const deck = game.pins.deck;
    const rolling = ball.rolling && !ball.stopped;
    const speed = rolling ? ball.speed : 0.0;
    const acceleration = rolling ? -Math.hypot(ball.last_acceleration[0], ball.last_acceleration[2]) : 0.0;
    const spin = rolling ? Math.sqrt(ball.angular_velocity.reduce((s, c) => s + c * c, 0)) : 0.0;
    this.values = {
      t: deck.elapsed, v: speed, a: acceleration, vx: rolling ? ball.velocity[0] : 0.0,
      spin, p: config.BALL_MASS * speed, k: 0.5 * config.BALL_MASS * speed * speed,
      pins: this.app.game.pins.knockdownCount(),
    };
    const context = this._equationContext(ball, deck, this.values);
    for (const [key, _label, _unit] of READOUT) {
      const row = this.liveRows[key];
      const value = this.values[key];
      row.value.textContent = key === 'pins' ? String(Math.round(value)) : `${value.toFixed(2)}${_unit ? ' ' + _unit : ''}`;
      if (this.openRow === key) {
        const [symbolic, substituted] = equationLines(key, context);
        row.detail.style.display = 'block';
        row.detail.textContent = `${symbolic}\n${substituted}`;
      } else row.detail.style.display = 'none';
    }
    const [x, y, z] = ball.position;
    const [vx, vy, vz] = ball.velocity;
    const [wx, wy, wz] = ball.angular_velocity;
    const torque = rolling ? ball.last_torque : [0, 0, 0];
    const tau = Math.hypot(torque[0], torque[2]);
    const momentum = ball.inertia * Math.sqrt(wx * wx + wy * wy + wz * wz);
    this.stateText.textContent =
      `POS m   ${x >= 0 ? '+' : ''}${x.toFixed(3)}  ${y.toFixed(3)}  ${z >= 0 ? '+' : ''}${z.toFixed(3)}\n`
      + `VEL m/s ${vx >= 0 ? '+' : ''}${vx.toFixed(2)}  ${vy.toFixed(2)}  ${vz >= 0 ? '+' : ''}${vz.toFixed(2)}\n`
      + `OMG r/s ${wx >= 0 ? '+' : ''}${wx.toFixed(2)}  ${wy.toFixed(2)}  ${wz >= 0 ? '+' : ''}${wz.toFixed(2)}\n`
      + `L ${momentum.toFixed(2)}  TAU ${tau.toFixed(2)}  I ${ball.inertia.toFixed(4)}`;
  }
  onKey(key) {
    if (key === 'escape' || key === 'b') { this.app.goToMenu(); return true; }
    if (key === 'r') { this.reset(); return true; }
    if (key === 'p') { this.togglePause(); return true; }
    if (key === 'space' || key === 'enter') { this.bowl(); return true; }
    return false;
  }
}
