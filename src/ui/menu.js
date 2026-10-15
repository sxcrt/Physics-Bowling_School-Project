// The non-gameplay screens: splash, main menu, mode picker, help, settings
// (ported from ui/menu_screens.py).
import * as modes from '../game/modes.js';
import { DIFFICULTIES, INPUT_MODES, RUSH_DURATIONS } from '../game/settings.js';
import { PLAYER_COLORS } from '../game/session.js';
import { COLORS, LAYOUT, SIZES, TYPE_PX, PALETTE, css, cssA, brighten } from './theme.js';
import { div, el, button as makeButton } from './dom.js';
import { Screen } from './screens.js';

function backdrop(parent) {
  const dim = div('screen-dim', parent);
  dim.style.cssText = `position:absolute;left:0;top:0;width:1280px;height:720px;background:${cssA(COLORS.veil, 0.55)};`;
  const vignette = div('screen-vignette', parent);
  vignette.style.cssText = 'position:absolute;left:0;top:0;width:1280px;height:720px;'
    + 'background:radial-gradient(circle at 50% 50%, transparent 45%, rgba(11,8,32,0.7) 100%);';
  return dim;
}

export class MenuScreen extends Screen {
  build() {
    super.build();
    backdrop(this.root);
  }
  brand(x = 640, y = 96, widthPx = 620, heightPx = 112) {
    const glow = div('brand-glow', this.root);
    glow.style.cssText = `position:absolute;left:${x - widthPx * 0.95}px;top:${y - heightPx * 1.65}px;`
      + `width:${widthPx * 1.9}px;height:${heightPx * 3.3}px;border-radius:50%;`
      + `background:radial-gradient(ellipse at center, ${cssA(COLORS.pink, 0.34)} 0%, transparent 65%);`;
    const sign = el('div', 'brand', this.root, 'HELLS BALLS');
    sign.style.cssText = `position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%);`
      + `font-size:${heightPx * 0.62}px;font-weight:900;letter-spacing:2px;`
      + `color:#fff;text-shadow:0 0 8px ${cssA(COLORS.pink, 0.95)},0 0 26px ${cssA(COLORS.pink, 0.8)},0 0 60px ${cssA(COLORS.pink, 0.5)};`;
    return sign;
  }
  title(text, y = LAYOUT.title_y) {
    const node = el('div', 'screen-title', this.root, text);
    node.style.cssText = `position:absolute;left:640px;top:${y}px;transform:translateX(-50%);font-size:40px;font-weight:900;letter-spacing:2px;`
      + `color:#fff;text-shadow:0 0 12px ${cssA(COLORS.pink, 0.8)},0 0 32px ${cssA(COLORS.pink, 0.4)};`;
    this.titleNode = node;
    return node;
  }
  hintBar(items, y = 720 - 30) {
    const bar = el('div', 'hint-bar', this.root, items.map((item) => item.text).join('   '));
    bar.style.cssText = `position:absolute;left:640px;top:${y}px;transform:translateX(-50%);font-size:15px;color:${css(COLORS.text_dim)};white-space:nowrap;`;
    return bar;
  }
}

export class SplashScreen extends MenuScreen {
  constructor(app) { super(app); this.name = 'splash'; this.camera_view = 'splash'; this.AUTO_ADVANCE = 6.0; }
  build() {
    super.build();
    this.brand(640, 300, 700, 126);
    this.prompt = makeButton(this.root, 'PLAY', {
      x: 640, y: 424, w: SIZES.primary_w, h: SIZES.primary_h, radius: 14,
      accent: COLORS.pink, variant: 'primary', fontPx: SIZES.primary_font, tracking: 2,
      keyHint: 'ENTER', onClick: () => this.app.goToMenu(),
    });
    const cta = el('div', '', this.root, 'OR CLICK ANYWHERE TO START');
    cta.style.cssText = `position:absolute;left:640px;top:505px;transform:translateX(-50%);font-size:15px;letter-spacing:2px;color:${css(COLORS.text_dim)};`;
    this.hintBar([{ text: 'ENTER  play' }, { text: 'S  settings' }]);
    this._elapsed = 0.0;
  }
  onShow() { this._elapsed = 0.0; }
  onUpdate(dt) {
    this._elapsed += dt;
    if (this._elapsed >= this.AUTO_ADVANCE) this.app.goToMenu();
  }
  onKey(key) {
    if (['enter', 'space'].includes(key)) { this.app.goToMenu(); return true; }
    if (key === 's') { this.app.open_settings(); return true; }
    return false;
  }
  on_click() { this.app.goToMenu(); return true; }
}

export class MainMenuScreen extends MenuScreen {
  constructor(app) { super(app); this.name = 'menu'; this.camera_view = 'menu'; }
  build() {
    super.build();
    this.brand(640, 100, 560, 108);
    this.playButton = makeButton(this.root, 'PLAY', {
      x: 640, y: 236, w: SIZES.primary_w, h: SIZES.primary_h, radius: 14,
      accent: COLORS.pink, variant: 'primary', fontPx: SIZES.primary_font, tracking: 2,
      keyHint: 'ENTER', onClick: () => { this.app.play('confirm'); this.app.goToModes(); },
    });
    const secondary = [
      ['HOW TO PLAY', () => this.app.goToHelp()],
      ['PHYSICS LAB', () => this.app.goToLab()],
      ['SETTINGS', () => this.app.open_settings()],
    ];
    this.secondaryButtons = secondary.map(([label, action], index) => makeButton(this.root, label, {
      x: 640 + (index - 1) * (SIZES.secondary_w + SIZES.secondary_gap), y: 324,
      w: SIZES.secondary_w, h: SIZES.secondary_h, radius: 12, accent: COLORS.cyan,
      variant: 'secondary', fontPx: SIZES.secondary_font,
      onClick: () => { this.app.play('menu_select'); action(); },
    }));
    const inputLabel = el('div', '', this.root, 'INPUT');
    inputLabel.style.cssText = `position:absolute;left:640px;top:386px;transform:translateX(-50%);font-size:14px;letter-spacing:1px;color:${css(COLORS.text_dim)};`;
    this.inputControl = this._segmented(640, 432, INPUT_MODES, this.app.settings.get('input_mode', 'mouse'),
      (value) => {
        if (value === this.app.settings.get('input_mode')) return;
        this.app.settings.set('input_mode', value);
        this.app.applySettings();
        this.app.play('menu_move');
      });
    makeButton(this.root, 'QUIT', {
      x: 1280 - SIZES.quit_margin - SIZES.quit_w / 2,
      y: 720 - SIZES.quit_margin - SIZES.quit_h / 2,
      w: SIZES.quit_w, h: SIZES.quit_h, radius: 10, accent: COLORS.coral,
      variant: 'ghost', fontPx: SIZES.quit_font, onClick: () => this.app.quit(),
    });
    this.hintBar([{ text: '← →  menu' }, { text: 'ENTER  select' }, { text: 'A D  move your feet' }, { text: 'drag the ball to throw' }]);
    this.buttons = [this.playButton, ...this.secondaryButtons];
    this._keyboardFocus = false;
  }
  onShow() {
    this.selected = 0;
    this._keyboardFocus = false;
    this.refreshSelection();
  }
  onKey(key) {
    if (key === 'escape') return false;
    return super.onKey(key);
  }
  _segmented(x, y, options, value, onChange) {
    const node = div('segmented', this.root);
    node.style.cssText = `position:absolute;left:${x}px;top:${y}px;transform:translateX(-50%);display:flex;gap:6px;`
      + `padding:4px;border-radius:10px;background:${cssA(COLORS.card, 0.9)};border:1px solid ${cssA(COLORS.hairline, 1)};`;
    const buttons = [];
    const sync = (current) => {
      buttons.forEach((b, i) => {
        const active = options[i] === current;
        b.style.background = active ? cssA(COLORS.cyan, 0.9) : 'transparent';
        b.style.color = active ? css(COLORS.ink) : css(COLORS.text_dim);
      });
    };
    for (const option of options) {
      const b = el('div', '', node, option.toUpperCase());
      b.style.cssText = 'padding:8px 18px;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;letter-spacing:1px;';
      b.addEventListener('click', () => { onChange(option); sync(option); });
      buttons.push(b);
    }
    sync(value);
    node.setValue = (v) => sync(v);
    return node;
  }
}

export class ModeSelectScreen extends MenuScreen {
  constructor(app) { super(app); this.name = 'modes'; this.camera_view = 'modes'; }
  build() {
    super.build();
    this.title('CHOOSE YOUR GAME');
    this.modeList = modes.pickerModes();
    this.selectedBall = 0;
    this.playerCount = 1;
    this.difficulty = this.app.settings.get('bot_difficulty', 'medium');
    this.duration = this.app.settings.get('rush_duration', 180.0);
    this.cards = [];
    this.modeList.forEach((mode, index) => {
      const row = div('mode-row', this.root);
      row.style.cssText = `position:absolute;left:${SIZES.list_x}px;top:${SIZES.list_y + index * (SIZES.row_h + SIZES.row_gap)}px;`
        + `width:${SIZES.list_w}px;height:${SIZES.row_h}px;border-radius:12px;display:flex;align-items:center;`
        + `padding:0 16px;gap:16px;cursor:pointer;box-sizing:border-box;background:${cssA(COLORS.card, 0.9)};`
        + `border:1px solid ${cssA(COLORS.hairline, 1)};`;
      const tile = div('mode-tile', row);
      tile.style.cssText = `width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;`
        + `font-size:15px;font-weight:900;color:${css(modes.pickerModes()[index].ball_rgb)};`
        + `background:${cssA([20, 16, 46], 1)};box-shadow:inset 0 0 0 2px ${cssA(modes.pickerModes()[index].ball_rgb, 0.7)};`;
      tile.textContent = mode.motif;
      const label = el('div', '', row, mode.title);
      label.style.cssText = 'font-size:18px;font-weight:700;color:#fff;letter-spacing:1px;';
      row.addEventListener('click', () => {
        this.selectedBall = index;
        this.app.play('menu_move');
        this._sync();
      });
      this.cards.push(row);
    });

    // detail panel
    this.detail = div('mode-detail', this.root);
    this.detail.style.cssText = `position:absolute;left:${SIZES.detail_x}px;top:${SIZES.list_y}px;width:${SIZES.detail_w}px;`
      + `height:${this._listHeight()}px;border-radius:16px;background:${cssA(COLORS.panel, 0.92)};`
      + `border:1px solid transparent;border-image:linear-gradient(90deg, rgba(62,201,232,0.6), rgba(255,61,139,0.6)) 1;`
      + `padding:${SIZES.detail_pad}px;box-sizing:border-box;`;
    this.detailTitle = el('div', '', this.detail, '');
    this.detailTitle.style.cssText = 'font-size:32px;font-weight:900;color:#fff;';
    this.detailTagline = el('div', '', this.detail, '');
    this.detailTagline.style.cssText = `font-size:18px;color:${css(COLORS.cyan)};margin-top:8px;`;
    this.detailDesc = el('div', '', this.detail, '');
    this.detailDesc.style.cssText = `font-size:17px;color:${css(COLORS.text_dim)};margin-top:14px;line-height:1.4;`;
    this.detailRules = el('div', '', this.detail, '');
    this.detailRules.style.cssText = 'margin-top:18px;display:flex;flex-direction:column;gap:8px;';
    this.setupHeading = el('div', '', this.detail, '');
    this.setupHeading.style.cssText = `font-size:14px;font-weight:700;letter-spacing:3px;color:${css(COLORS.cyan)};margin-top:22px;`;
    this.setupBox = div('setup-box', this.detail);
    this.setupBox.style.cssText = 'margin-top:10px;display:flex;flex-direction:column;gap:10px;';

    makeButton(this.root, 'BACK', {
      x: SIZES.list_x + SIZES.nav_w / 2, y: 720 - SIZES.nav_bottom - SIZES.nav_h / 2,
      w: SIZES.nav_w, h: SIZES.nav_h, radius: 10, accent: COLORS.text_dim, variant: 'ghost',
      fontPx: SIZES.nav_font, onClick: () => this.app.goToMenu(),
    });
    this.startButton = makeButton(this.root, 'START', {
      x: 1184 - SIZES.nav_w / 2, y: 720 - SIZES.nav_bottom - SIZES.nav_h / 2,
      w: SIZES.nav_w, h: SIZES.nav_h, radius: 10, accent: COLORS.pink, variant: 'primary',
      fontPx: SIZES.nav_font, tracking: 1, onClick: () => this._start(),
    });
    this.buttons = [this.startButton];
    this._sync();
  }
  _listHeight() {
    const count = this.modeList.length;
    return count * SIZES.row_h + (count - 1) * SIZES.row_gap;
  }
  get mode() { return this.modeList[this.selectedBall]; }
  _effectivePlayers() {
    const mode = this.mode;
    const [low, high] = mode.player_range;
    if (mode.id === 'pvbot') return 2;
    if (low === high) return low;
    return Math.max(low, Math.min(high, this.playerCount));
  }
  _sync() {
    const mode = this.mode;
    this.cards.forEach((row, index) => {
      const selected = index === this.selectedBall;
      row.style.background = cssA(selected ? COLORS.card_high : COLORS.card, 0.94);
      row.style.borderColor = cssA(selected ? mode.ball_rgb : COLORS.hairline, 1);
      row.style.transform = selected ? 'translateX(4px)' : 'none';
    });
    this.detailTitle.textContent = mode.title;
    this.detailTagline.textContent = mode.subtitle;
    this.detailDesc.textContent = mode.description;
    this.detailRules.innerHTML = '';
    for (const rule of mode.rules.slice(0, 5)) {
      const chip = el('div', '', this.detailRules, rule);
      chip.style.cssText = `font-size:14px;color:${css(COLORS.amber)};padding:6px 12px;border-radius:8px;`
        + `background:${cssA(COLORS.amber, 0.10)};border:1px solid ${cssA(COLORS.amber, 0.25)};align-self:flex-start;`;
    }
    // setup
    this.setupBox.innerHTML = '';
    this.setupHeading.textContent = 'MATCH SETUP';
    const [low, high] = mode.player_range;
    if (high > low && mode.id !== 'pvbot') {
      this.setupBox.appendChild(this._stepper('PLAYERS', String(this._effectivePlayers()), (dir) => {
        this.playerCount = Math.max(low, Math.min(high, this.playerCount + dir));
        this.app.play('menu_move');
        this._sync();
      }));
    }
    if (mode.allow_bot) {
      this.setupBox.appendChild(this._stepper('BOT LEVEL', this.difficulty.toUpperCase(), (dir) => {
        const order = Array.from(DIFFICULTIES);
        const idx = (order.indexOf(this.difficulty) + dir + order.length) % order.length;
        this.difficulty = order[idx];
        this.app.settings.set('bot_difficulty', this.difficulty);
        this.app.saveSettings();
        this.app.play('menu_move');
        this._sync();
      }, COLORS.purple));
    }
    if (mode.timed) {
      this.setupBox.appendChild(this._stepper('DURATION', this._durationText(), (dir) => {
        const options = Array.from(RUSH_DURATIONS);
        const idx = options.indexOf(this.duration);
        this.duration = options[(idx + dir + options.length) % options.length];
        this.app.settings.set('rush_duration', this.duration);
        this.app.saveSettings();
        this.app.play('menu_move');
        this._sync();
      }, COLORS.amber));
    }
    const editable = mode.allow_bot || high > low;
    if (editable) {
      const players = this._effectivePlayers();
      const names = [];
      const count = mode.allow_bot ? players - 1 : players;
      for (let i = 0; i < count; i++) {
        const entry = document.createElement('input');
        entry.type = 'text';
        entry.maxLength = 12;
        const def = mode.allow_bot && i === 0 ? 'YOU' : `PLAYER ${i + 1}`;
        entry.value = this.app.playerName(i, def);
        entry.style.cssText = `flex:1;padding:10px 14px;border-radius:10px;font-size:16px;background:${cssA(COLORS.card, 1)};`
          + `border:1px solid ${cssA(COLORS.hairline, 1)};color:#fff;outline:none;`;
        entry.addEventListener('change', () => this.app.setPlayerName(i, entry.value));
        names.push(entry);
      }
      const row = div('name-row', this.setupBox);
      row.style.cssText = 'display:flex;gap:10px;';
      for (const entry of names) row.appendChild(entry);
    }
  }
  _durationText() {
    const minutes = Math.floor(this.duration / 60);
    const seconds = Math.floor(this.duration - minutes * 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  _stepper(label, value, onStep, accent = COLORS.cyan) {
    const row = div('stepper', this.setupBox);
    row.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-radius:12px;`
      + `background:${cssA(COLORS.card, 1)};border:1px solid ${cssA(COLORS.hairline, 1)};`;
    const name = el('div', '', row, label);
    name.style.cssText = 'font-size:16px;color:#fff;';
    const right = div('', row);
    right.style.cssText = 'display:flex;align-items:center;gap:10px;';
    const left = el('div', '', right, '◄');
    left.style.cssText = `cursor:pointer;color:${css(accent)};font-size:14px;`;
    const val = el('div', '', right, value);
    val.style.cssText = `font-size:16px;font-weight:700;color:${css(accent)};min-width:70px;text-align:center;`;
    const rightArrow = el('div', '', right, '►');
    rightArrow.style.cssText = `cursor:pointer;color:${css(accent)};font-size:14px;`;
    left.addEventListener('click', () => onStep(-1));
    rightArrow.addEventListener('click', () => onStep(1));
    return row;
  }
  _playerSpecs() {
    const mode = this.mode;
    const players = this._effectivePlayers();
    const specs = [];
    for (let index = 0; index < players; index++) {
      const isBot = mode.allow_bot && index > 0;
      const name = isBot ? 'BOT' : this.app.playerName(index, `PLAYER ${index + 1}`);
      specs.push({ name, rgb: PLAYER_COLORS[index % PLAYER_COLORS.length], is_bot: isBot, difficulty: this.difficulty });
    }
    return specs;
  }
  _start() {
    this.app.play('confirm');
    const duration = this.mode.timed ? this.duration : null;
    this.app.startMatch(this.mode.id, this._playerSpecs(), duration);
  }
  onShow() { this._sync(); }
  onKey(key) {
    if (['left arrow', 'up arrow', 'a', 'w'].includes(key)) { this._move(-1); return true; }
    if (['right arrow', 'down arrow', 'd', 's'].includes(key)) { this._move(1); return true; }
    if (key === 'enter') { this._start(); return true; }
    if (key === 'escape') { this.app.goToMenu(); return true; }
    const digits = '123456';
    if (digits.includes(key)) { this.selectedBall = digits.indexOf(key); this._sync(); return true; }
    return false;
  }
  _move(step) {
    this.selectedBall = (this.selectedBall + step + this.modeList.length) % this.modeList.length;
    this.app.play('menu_move');
    this._sync();
  }
}

export class HowToPlayScreen extends MenuScreen {
  constructor(app) { super(app); this.name = 'howto'; this.camera_view = 'menu'; }
  build() {
    super.build();
    this.title('HOW TO PLAY');
    this.pages = [
      ['BASICS', [
        ['THE GAME', COLORS.cyan, 'HELLS BALLS is bowling first: you throw a ball down a real 18.29 m lane and the pins fall because the simulation was hit, not because a result was chosen.'],
        ['MOUSE', COLORS.cyan, "A and D move where you stand on the approach. The mouse's left/right position aims the shot at the arrows 4.6 m down the lane, and the aim marker on the lane shows it."],
        ['THE THROW', COLORS.cyan, 'Hold the left button, drag back and then stroke forward, and release. The fastest part of the stroke sets the speed; the direction of the stroke bends the release (left or right) and its sideways speed adds hook, so the ball curves.'],
        ['WEBCAM', COLORS.pink, 'stand so your upper body is in view, hold your arms down until the game says READY, then swing your arm forward and up. TAB or 2 switches to the webcam, 1 switches back to the mouse.'],
        ['KEYS', COLORS.amber, 'ESC pauses. R re-stands the rack before a throw. H shows or hides the physics readout.'],
      ]],
      ['MODES', [
        ['CLASSIC BOWLING', COLORS.cyan, 'ten frames, standard scoring, strikes and spares with the correct bonus rolls.'],
        ['PHYSICS TRIVIA', COLORS.cyan, 'a knowledge test: answer a concept question to earn a throw at a full rack; a wrong answer costs that throw and explains the idea. The ball itself is thrown normally - this mode tests understanding, not calculation.'],
        ['EQUATION CHALLENGE', COLORS.cyan, 'an interactive physics problem: a real leave on the deck, the variables, the governing equation and one value to work out - hook spin, speed, angle or torque. Bowl it and watch the simulation curve the ball; tune the value until the pin falls. Unlimited attempts, every result measured.'],
        ['LOCAL MULTIPLAYER', COLORS.cyan, 'two to four people share the computer and alternate frames.'],
        ['PLAYER VS BOT', COLORS.cyan, 'the bot picks its own line, speed and hook and bowls through the same physics you do. Three difficulties.'],
        ['BOWLRUSH', COLORS.cyan, 'timed match, fresh rack every throw, most pins wins.'],
      ]],
      ['SCORING', [
        ['STRIKES AND SPARES', COLORS.cyan, 'A strike (10 on the first ball) scores 10 plus your next two rolls. A spare (10 over two balls) scores 10 plus your next roll. Otherwise the frame scores what you knocked down.'],
        ['THE SCORECARD', COLORS.cyan, 'Because a strike borrows the next two rolls, its frame score cannot be written down yet - but the scorecard stamps the X straight away, so the strike still reads as counted. In multiplayer the player strip highlights whoever is up, and each player\'s chip shows their own pins.'],
        ['TENTH FRAME', COLORS.cyan, 'The tenth frame gives you bonus balls for a strike or a spare, and the rack resets when a bonus ball is earned.'],
        ['TURN ORDER', COLORS.cyan, 'you keep bowling until your frame is finished, then the next player bowls their frame. In BowlRush players alternate every throw.'],
        ['TRIVIA AND EQUATIONS', COLORS.cyan, 'score total pins knocked down: every correct answer earns one throw at a fresh rack.'],
      ]],
      ['PHYSICS', [
        ['THE BALL', COLORS.cyan, 'The ball is a 6 kg solid sphere whose release conditions - position, speed, launch angle and hook spin - go into a fixed-substep rigid-body simulation.'],
        ['ROLLING', COLORS.cyan, 'a = mu_r g opposes the motion (mu_r = 0.020). While the contact point slips, kinetic friction acts against the slip; a hook release makes that slip sideways, which is what bends the path. Once the ball rolls without slipping, omega = v / R.'],
        ['THE PINS', COLORS.cyan, 'Pins are rods with a belly: they topple about their centre, skid on the deck, hit each other and rebound off the kickbacks. Nothing decides a pin count in advance.'],
        ['THE LAB', COLORS.cyan, 'The PHYSICS LAB (main menu) replays a single throw through the same simulation. Its numbers update live, and clicking any row opens the equation with the current values substituted.'],
      ]],
    ];
    this.tabs = [];
    this.pages.forEach(([name], index) => {
      const x = 640 + (index - (this.pages.length - 1) / 2) * (SIZES.tab_w + SIZES.tab_gap);
      const tab = el('div', '', this.root, name);
      tab.style.cssText = `position:absolute;left:${x}px;top:${SIZES.tab_y + SIZES.tab_h / 2}px;transform:translate(-50%,-50%);`
        + `font-size:16px;letter-spacing:1px;cursor:pointer;color:${css(COLORS.text_dim)};`;
      tab.addEventListener('click', () => { this.page = index; this._render(); this.app.play('menu_move'); });
      const underline = div('', this.root);
      underline.style.cssText = `position:absolute;left:${x - SIZES.tab_w / 2}px;top:${SIZES.tab_y + SIZES.tab_h}px;`
        + `width:${SIZES.tab_w}px;height:3px;background:${css(COLORS.cyan)};box-shadow:0 0 10px ${cssA(COLORS.cyan, 0.8)};`;
      this.tabs.push({ tab, underline });
    });
    this.panel = div('howto-panel', this.root);
    this.panel.style.cssText = `position:absolute;left:${SIZES.howto_x}px;top:${SIZES.howto_y}px;width:${SIZES.howto_w}px;`
      + `height:${720 - SIZES.nav_bottom - SIZES.nav_h - 24 - SIZES.howto_y}px;border-radius:16px;background:${cssA(COLORS.panel, 0.92)};`
      + `border:1px solid transparent;border-image:linear-gradient(90deg, rgba(62,201,232,0.6), rgba(255,61,139,0.6)) 1;`
      + 'padding:32px;box-sizing:border-box;overflow-y:auto;';
    this.content = div('howto-content', this.panel);
    this.content.style.cssText = 'display:flex;flex-direction:column;gap:22px;';
    makeButton(this.root, 'BACK', {
      x: SIZES.howto_x + SIZES.nav_w / 2, y: 720 - SIZES.nav_bottom - SIZES.nav_h / 2,
      w: SIZES.nav_w, h: SIZES.nav_h, radius: 10, accent: COLORS.text_dim, variant: 'ghost',
      fontPx: SIZES.nav_font, onClick: () => this.app.goToMenu(),
    });
    makeButton(this.root, 'PREVIOUS', {
      x: 1184 - SIZES.tab_w - SIZES.tab_gap - SIZES.tab_w / 2, y: 720 - SIZES.nav_bottom - SIZES.nav_h / 2,
      w: SIZES.tab_w, h: SIZES.nav_h, radius: 10, accent: COLORS.text_dim, variant: 'ghost',
      fontPx: SIZES.nav_font, onClick: () => this._flip(-1),
    });
    makeButton(this.root, 'NEXT', {
      x: 1184 - SIZES.tab_w / 2, y: 720 - SIZES.nav_bottom - SIZES.nav_h / 2,
      w: SIZES.tab_w, h: SIZES.nav_h, radius: 10, accent: COLORS.cyan, variant: 'secondary',
      fontPx: SIZES.nav_font, onClick: () => this._flip(1),
    });
    this.page = 0;
    this._render();
  }
  _flip(step) { this.page = (this.page + step + this.pages.length) % this.pages.length; this._render(); this.app.play('menu_move'); }
  _render() {
    this.tabs.forEach(({ tab, underline }, index) => {
      const active = index === this.page;
      tab.style.color = css(active ? COLORS.text === undefined ? [255, 255, 255] : COLORS.text : COLORS.text_dim);
      underline.style.display = active ? 'block' : 'none';
    });
    this.content.innerHTML = '';
    const [_name, rows] = this.pages[this.page];
    this.panel.scrollTop = 0;
    for (const [label, rgb, body] of rows) {
      const row = div('help-row', this.content);
      row.style.cssText = 'display:flex;gap:16px;align-items:flex-start;';
      const chip = el('div', '', row, label);
      chip.style.cssText = `min-width:150px;font-size:15px;font-weight:700;color:${css(rgb)};padding:6px 12px;border-radius:8px;`
        + `background:${cssA(rgb, 0.2)};text-align:center;`;
      const text = el('div', '', row, body);
      text.style.cssText = `font-size:17px;line-height:1.5;color:${css(COLORS.text_dim)};flex:1;`;
    }
  }
  onShow() { this.page = 0; this._render(); }
  onKey(key) {
    if (['right arrow', 'd'].includes(key)) { this._flip(1); return true; }
    if (['left arrow', 'a'].includes(key)) { this._flip(-1); return true; }
    if (['down arrow', 'down'].includes(key)) { this.panel.scrollTop += 90; return true; }
    if (['up arrow', 'up'].includes(key)) { this.panel.scrollTop -= 90; return true; }
    if (['enter', 'return'].includes(key)) { this._flip(1); return true; }
    if (key === 'escape' || key === 'space') { this.app.goToMenu(); return true; }
    return false;
  }
}

export class SettingsScreen extends MenuScreen {
  constructor(app) { super(app); this.name = 'settings'; this.camera_view = 'menu'; }
  build() {
    super.build();
    this.title('SETTINGS');
    const width = SIZES.settings_w;
    this.panel = div('settings-panel', this.root);
    this.panel.style.cssText = `position:absolute;left:${640 - width / 2}px;top:${SIZES.settings_y}px;width:${width}px;`
      + `border-radius:16px;background:${cssA(COLORS.panel, 0.94)};padding:24px;box-sizing:border-box;`
      + 'border:1px solid transparent;border-image:linear-gradient(90deg, rgba(62,201,232,0.6), rgba(255,61,139,0.6)) 1;';
    this.rows = div('settings-rows', this.panel);
    this.rows.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
    makeButton(this.root, 'BACK', {
      x: 640, y: 720 - SIZES.nav_bottom - SIZES.nav_h / 2, w: SIZES.nav_w, h: SIZES.nav_h,
      radius: 10, accent: COLORS.text_dim, variant: 'ghost', fontPx: SIZES.nav_font,
      onClick: () => this.app.leaveSettings(),
    });
    this._buildRows();
  }
  _row(label, valueText, onStep, helper = '', accent = COLORS.cyan, isToggle = false) {
    const row = div('settings-row', this.rows);
    row.style.cssText = `min-height:${helper ? 64 : 52}px;border-radius:12px;background:${cssA(COLORS.card, 1)};`
      + `border:1px solid ${cssA(COLORS.hairline, 1)};display:flex;align-items:center;justify-content:space-between;`
      + 'padding:0 20px;box-sizing:border-box;cursor:pointer;';
    const left = div('', row);
    const name = el('div', '', left, label);
    name.style.cssText = 'font-size:17px;color:#fff;';
    if (helper) {
      const help = el('div', '', left, helper);
      help.style.cssText = `font-size:13px;color:${css(COLORS.text_dim)};margin-top:2px;`;
    }
    const right = div('', row);
    if (isToggle) {
      const on = String(valueText).toUpperCase() === 'ON';
      const chip = el('div', '', right, String(valueText).toUpperCase());
      chip.style.cssText = `padding:4px 14px;border-radius:14px;font-size:16px;font-weight:700;cursor:pointer;`
        + `background:${cssA(on ? COLORS.cyan : COLORS.hairline, 1)};color:${css(on ? COLORS.ink : COLORS.text_dim)};`;
      row.addEventListener('click', () => onStep(1));
    } else {
      const leftArrow = el('div', '', right, '◄');
      leftArrow.style.cssText = `display:inline-block;margin-right:10px;color:${css(accent)};cursor:pointer;`;
      const val = el('div', '', right, valueText);
      val.style.cssText = `display:inline-block;min-width:70px;text-align:center;font-size:17px;font-weight:700;color:${css(accent)};`;
      const rightArrow = el('div', '', right, '►');
      rightArrow.style.cssText = `display:inline-block;margin-left:10px;color:${css(accent)};cursor:pointer;`;
      leftArrow.addEventListener('click', (e) => { e.stopPropagation(); onStep(-1); });
      rightArrow.addEventListener('click', (e) => { e.stopPropagation(); onStep(1); });
      row.addEventListener('click', () => onStep(1));
    }
    return row;
  }
  _buildRows() {
    this.rows.innerHTML = '';
    const settings = this.app.settings;
    const cycle = (key, options, accent, isToggle = false, helper = '') => this._row(helper ? key : undefined, '', () => {}, helper);
    // Input mode
    this._row('INPUT METHOD', String(settings.get('input_mode')).toUpperCase(), (dir) => {
      const options = INPUT_MODES;
      const idx = options.indexOf(settings.get('input_mode'));
      settings.set('input_mode', options[(idx + dir + options.length) % options.length]);
      settings.save(); this.app.applySettings(); this._buildRows(); this.app.play('menu_move');
    }, 'Mouse is always available; webcam needs a camera.', COLORS.cyan);
    // Throwing arm
    this._row('THROWING ARM', String(settings.get('throwing_arm')).toUpperCase(), (dir) => {
      const options = ['auto', 'left', 'right'];
      const idx = options.indexOf(settings.get('throwing_arm'));
      settings.set('throwing_arm', options[(idx + dir + options.length) % options.length]);
      settings.save(); this.app.applySettings(); this._buildRows(); this.app.play('menu_move');
    }, '', COLORS.pink);
    // Volumes
    for (const [key, label] of [['master_volume', 'MASTER VOLUME'], ['sfx_volume', 'SFX VOLUME'], ['music_volume', 'MUSIC VOLUME']]) {
      this._row(label, `${Math.round(settings.get(key) * 100)}%`, (dir) => {
        settings.set(key, Math.max(0, Math.min(1, Number(settings.get(key)) + dir * 0.1)));
        settings.save(); this.app.applySettings(); this._buildRows(); this.app.play('menu_move');
      }, '', COLORS.amber);
    }
    this._row('MUTE', settings.get('muted') ? 'ON' : 'OFF', () => {
      settings.set('muted', !settings.get('muted'));
      settings.save(); this.app.applySettings(); this._buildRows(); this.app.play('menu_move');
    }, '', COLORS.coral, true);
    this._row('PHYSICS READOUT', settings.get('show_physics_readout') ? 'ON' : 'OFF', () => {
      settings.set('show_physics_readout', !settings.get('show_physics_readout'));
      settings.save(); this.app.applySettings(); this._buildRows(); this.app.play('menu_move');
    }, 'The compact numbers panel in the bottom-right (H in game).', COLORS.green, true);
    this._row('REDUCE MOTION', settings.get('reduce_motion') ? 'ON' : 'OFF', () => {
      settings.set('reduce_motion', !settings.get('reduce_motion'));
      settings.save(); this.app.applySettings(); this._buildRows(); this.app.play('menu_move');
    }, 'No shake, no flashes, no pulsing loops.', COLORS.purple, true);
    this._row('HAND MENU NAVIGATION', settings.get('hand_menu_navigation') ? 'ON' : 'OFF', () => {
      settings.set('hand_menu_navigation', !settings.get('hand_menu_navigation'));
      settings.save(); this.app.applySettings(); this._buildRows(); this.app.play('menu_move');
    }, 'Experimental: a tracked hand moves a menu cursor (off by default).', COLORS.text_dim, true);
  }
  onShow() { this._buildRows(); }
  onKey(key) {
    const settings = this.app.settings;
    if (key === 'escape' || key === 'enter' || key === 'return') {
      this.app.play('menu_select');
      settings.save();
      this.app.leaveSettings();
      return true;
    }
    if (key === 'left arrow') {
      settings.set('master_volume', Math.max(0, settings.get('master_volume') - 0.05));
      settings.save(); this.app.applySettings(); this._buildRows();
      return true;
    }
    if (key === 'right arrow') {
      settings.set('master_volume', Math.min(1, settings.get('master_volume') + 0.05));
      settings.save(); this.app.applySettings(); this._buildRows();
      return true;
    }
    return false;
  }
}
