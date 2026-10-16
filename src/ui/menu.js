// The non-gameplay screens: splash, main menu, mode picker, help, settings
// (ported from ui/menu_screens.py).
import * as modes from '../game/modes.js';
import { DIFFICULTIES, INPUT_MODES, RUSH_DURATIONS } from '../game/settings.js';
import { PLAYER_COLORS } from '../game/session.js';
import { COLORS, LAYOUT, SIZES, TYPE_PX, PALETTE, MODE_ICONS, css, cssA, brighten } from './theme.js';
import { div, el, button as makeButton } from './dom.js';
import { iconNode } from './icons.js';
import { Screen } from './screens.js';

function backdrop(parent) {
  // The 3D alley is atmosphere behind the menus, not a competitor to the text:
  // a firm veil plus a vignette keeps every label legible over the bright lane
  // wood without hiding the scene.
  const dim = div('screen-dim', parent);
  dim.style.cssText = `position:absolute;left:0;top:0;width:1280px;height:720px;background:${cssA(COLORS.veil, 0.72)};`;
  const vignette = div('screen-vignette', parent);
  vignette.style.cssText = 'position:absolute;left:0;top:0;width:1280px;height:720px;'
    + 'background:radial-gradient(circle at 50% 42%, transparent 34%, rgba(9,7,24,0.82) 100%);';
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
  hintBar(items) {
    // The bottom hint row sits on a 72px fade strip, centred, with real key
    // caps (ui/theme.py HintBar + Keycap). Items are {key}, {text} or {gap}.
    const strip = div('hint-strip', this.root);
    strip.style.cssText = `position:absolute;left:0;bottom:0;width:1280px;height:${SIZES.hint_strip}px;`
      + `background:linear-gradient(to top, ${cssA(COLORS.veil, SIZES.hint_strip_alpha)} 0%, transparent 100%);`
      + 'pointer-events:none;';
    const bar = div('hint-bar', this.root);
    bar.style.cssText = `position:absolute;left:640px;bottom:${SIZES.hint_bottom}px;transform:translateX(-50%);`
      + `display:flex;align-items:center;gap:${SIZES.hint_gap}px;white-space:nowrap;font-size:${SIZES.hint_font}px;`
      + `color:${css(COLORS.text_dim)};`;
    for (const item of items) {
      if (item.gap) {
        const spacer = div('', bar);
        spacer.style.cssText = `width:${SIZES.hint_group - SIZES.hint_gap}px;`;
        continue;
      }
      if (item.icon !== undefined) {
        const tile = el('div', 'hint-icon', bar);
        tile.style.cssText = `height:${SIZES.keycap_h}px;min-width:${SIZES.keycap_min_w}px;padding:0 6px;`
          + `border-radius:${SIZES.keycap_radius}px;background:rgba(255,255,255,0.20);border:1px solid rgba(255,255,255,0.50);`
          + 'color:#fff;display:flex;align-items:center;justify-content:center;box-sizing:border-box;';
        tile.appendChild(iconNode(item.icon, { size: SIZES.keycap_h - 8, color: '#fff' }));
        continue;
      }
      if (item.key !== undefined) {
        const cap = el('div', 'keycap', bar, item.key);
        cap.style.cssText = `height:${SIZES.keycap_h}px;min-width:${SIZES.keycap_min_w}px;padding:0 ${SIZES.keycap_pad}px;`
          + `border-radius:${SIZES.keycap_radius}px;background:rgba(255,255,255,0.20);border:1px solid rgba(255,255,255,0.50);`
          + `color:#fff;font-size:${SIZES.keycap_font}px;font-weight:700;display:flex;align-items:center;`
          + 'justify-content:center;box-sizing:border-box;line-height:1;';
        continue;
      }
      el('div', '', bar, item.text);
    }
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
    const fullscreenButton = makeButton(this.root, 'FULLSCREEN', {
      x: 640, y: 566, w: 220, h: 40, radius: 10, accent: COLORS.cyan,
      variant: 'ghost', fontPx: 14, tracking: 2,
      onClick: () => this.app.toggleFullscreen(),
    });
    this.app.trackFullscreenControl(fullscreenButton);
    this.hintBar([
      { key: 'ENTER' }, { text: 'play' }, { gap: true },
      { key: 'S' }, { text: 'settings' }, { gap: true },
      { key: 'F12' }, { text: 'screenshot' },
    ]);
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
    const fullscreenButton = makeButton(this.root, 'FULLSCREEN', {
      x: 1176, y: 30, w: 176, h: 36, radius: 10, accent: COLORS.cyan,
      variant: 'ghost', fontPx: 14, tracking: 2,
      onClick: () => { this.app.play('menu_select'); this.app.toggleFullscreen(); },
    });
    this.app.trackFullscreenControl(fullscreenButton);
    this.hintBar([
      { icon: 'arrow_left' }, { icon: 'arrow_right' }, { text: 'menu' }, { gap: true },
      { key: 'ENTER' }, { text: 'select' }, { gap: true },
      { key: 'A' }, { key: 'D' }, { text: 'move your feet' }, { gap: true },
      { text: 'drag the ball to throw' },
    ]);
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
        b._active = active;
        b.style.background = active ? cssA(COLORS.cyan, 0.9) : 'transparent';
        b.style.color = active ? css(COLORS.ink) : css(COLORS.text_dim);
      });
    };
    for (const option of options) {
      const b = el('div', '', node, option.toUpperCase());
      b.style.cssText = 'padding:8px 18px;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;'
        + 'letter-spacing:1px;transition:background 0.12s ease,color 0.12s ease,transform 0.1s ease;';
      b.addEventListener('pointerenter', () => {
        if (!b._active) b.style.background = 'rgba(255,255,255,0.08)';
      });
      b.addEventListener('pointerleave', () => {
        if (!b._active) b.style.background = 'transparent';
      });
      b.addEventListener('pointerdown', () => { b.style.transform = 'scale(0.97)'; });
      const settle = () => { b.style.transform = 'none'; };
      b.addEventListener('pointerup', settle);
      b.addEventListener('pointercancel', settle);
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
        + `border:1px solid ${cssA(COLORS.hairline, 1)};`
        + 'transition:transform 0.12s ease,background 0.12s ease,border-color 0.12s ease,box-shadow 0.14s ease;';
      const tile = div('mode-tile', row);
      const accent = modes.pickerModes()[index].ball_rgb;
      tile.style.cssText = `width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;`
        + `background:${cssA([20, 16, 46], 1)};box-shadow:inset 0 0 0 2px ${cssA(accent, 0.7)};`;
      tile.appendChild(iconNode(MODE_ICONS[mode.id] || 'pin', { size: 24, color: css(accent) }));
      const label = el('div', '', row, mode.title);
      label.style.cssText = 'font-size:18px;font-weight:700;color:#fff;letter-spacing:1px;';
      // The selected row carries a filled check at its right edge
      // (ui/theme.py ModeRow).
      const badge = el('div', '', row);
      badge.style.cssText = `margin-left:auto;width:20px;height:20px;border-radius:10px;flex:none;`
        + `display:flex;align-items:center;justify-content:center;`
        + `background:${css(mode.ball_rgb)};color:${css(COLORS.ink)};visibility:hidden;`
        + 'transition:transform 0.14s ease,opacity 0.14s ease;transform:scale(0.6);opacity:0;';
      badge.appendChild(iconNode('check', { size: 13, color: css(COLORS.ink) }));
      row._badge = badge;
      row.addEventListener('pointerenter', () => {
        if (index === this.selectedBall) return;
        row.style.background = cssA(COLORS.card_high, 0.9);
        row.style.borderColor = cssA(mode.ball_rgb, 0.6);
        row.style.transform = 'translateX(2px)';
      });
      row.addEventListener('pointerleave', () => {
        if (index === this.selectedBall) return;
        row.style.background = cssA(COLORS.card, 0.9);
        row.style.borderColor = cssA(COLORS.hairline, 1);
        row.style.transform = 'none';
      });
      row.addEventListener('pointerdown', () => {
        if (index === this.selectedBall) return;
        row.style.transform = 'translateX(2px) scale(0.99)';
      });
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
      + `padding:${SIZES.detail_pad}px;box-sizing:border-box;overflow:hidden;`;
    this.detailTitle = el('div', '', this.detail, '');
    this.detailTitle.style.cssText = 'font-size:32px;font-weight:900;color:#fff;line-height:1.05;';
    this.detailTagline = el('div', '', this.detail, '');
    this.detailTagline.style.cssText = `font-size:18px;color:${css(COLORS.cyan)};margin-top:8px;line-height:1.05;`;
    this.detailDesc = el('div', '', this.detail, '');
    this.detailDesc.style.cssText = `font-size:17px;color:${css(COLORS.text_dim)};margin-top:12px;line-height:1.3;`;
    this.detailRules = el('div', '', this.detail, '');
    this.detailRules.style.cssText = 'margin-top:18px;display:flex;flex-wrap:wrap;gap:6px;align-content:flex-start;';
    this.detailRule = div('mode-detail-rule', this.detail);
    this.detailRule.style.cssText = `margin-top:18px;height:1px;flex:none;background:${cssA(COLORS.hairline, 1)};`;
    this.setupHeading = el('div', '', this.detail, '');
    this.setupHeading.style.cssText = `font-size:14px;font-weight:700;letter-spacing:3px;color:${css(COLORS.cyan)};margin-top:18px;line-height:1.05;flex:none;`;
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
      if (row._badge) {
        row._badge.style.visibility = selected ? 'visible' : 'hidden';
        row._badge.style.transform = selected ? 'scale(1)' : 'scale(0.6)';
        row._badge.style.opacity = selected ? '1' : '0';
      }
    });
    this.detailTitle.textContent = mode.title;
    this.detailTagline.textContent = mode.subtitle;
    this.detailDesc.textContent = mode.description;
    this._fitDetail();
  }

  // Lay the detail panel out top-to-bottom, squeezing only as far as needed
  // (ui/menu_screens.py `_relayout_detail`): the section gaps tighten
  // 18 -> 12, the setup rows shrink 44 -> 36, and the trailing rule chips are
  // dropped rather than clipped or allowed to escape the panel. Text itself is
  // never shrunk.
  _fitDetail() {
    const mode = this.mode;
    const panel = this.detail;
    const chips = (mode.rules || []).slice(0, 5);
    const measurable = panel.offsetParent !== null && panel.clientHeight > 0;
    const attempts = [
      { gap: 18, rowH: 44, rowGap: 16 },
      { gap: 16, rowH: 40, rowGap: 8 },
      { gap: 14, rowH: 38, rowGap: 8 },
      { gap: 12, rowH: 36, rowGap: 6 },
    ];
    for (const attempt of attempts) {
      this._applyDetailGaps(attempt.gap, attempt.rowGap);
      let count = chips.length;
      for (;;) {
        this._renderDetailChips(chips.slice(0, Math.max(1, count)));
        this._renderSetup(mode, attempt.rowH);
        if (!measurable || this._detailOverflow() <= 0.5 || count <= 1) break;
        count -= 1;
      }
      if (!measurable || this._detailOverflow() <= 0.5) break;
    }
  }

  _applyDetailGaps(gap, rowGap) {
    this.detailDesc.style.marginTop = `${Math.max(10, gap - 4)}px`;
    this.detailRules.style.marginTop = `${gap}px`;
    this.detailRule.style.marginTop = `${gap}px`;
    this.setupHeading.style.marginTop = `${gap}px`;
    this.setupBox.style.marginTop = '16px';
    this.setupBox.style.gap = `${rowGap}px`;
  }

  _detailOverflow() {
    const panelRect = this.detail.getBoundingClientRect();
    if (panelRect.height <= 0) return 0;
    // The stage is CSS-scaled to the window, so the design-pixel padding has to
    // be converted with the panel's own scale for the comparison to behave the
    // same at every window size.
    const scale = panelRect.width > 0 ? panelRect.width / SIZES.detail_w : 1;
    const pad = SIZES.detail_pad * scale;
    let bottom = panelRect.top + pad;
    for (const child of this.detail.children) {
      const rect = child.getBoundingClientRect();
      if (rect.height > 0) bottom = Math.max(bottom, rect.bottom);
    }
    return bottom - (panelRect.bottom - pad);
  }

  _renderDetailChips(rules) {
    this.detailRules.innerHTML = '';
    for (const rule of rules) {
      const chip = el('div', 'mode-rule-chip', this.detailRules, rule);
      chip.style.cssText = `font-size:14px;line-height:1.25;color:${css(COLORS.amber)};padding:4px 10px;`
        + `border-radius:8px;max-width:100%;box-sizing:border-box;white-space:normal;`
        + `background:${cssA(COLORS.amber, 0.10)};border:1px solid ${cssA(COLORS.amber, 0.25)};align-self:flex-start;`;
    }
  }

  _renderSetup(mode, rowHeight) {
    // setup
    this.setupBox.innerHTML = '';
    this.setupHeading.textContent = 'MATCH SETUP';
    const [low, high] = mode.player_range;
    if (high > low && mode.id !== 'pvbot') {
      this.setupBox.appendChild(this._stepper('PLAYERS', String(this._effectivePlayers()), (dir) => {
        this.playerCount = Math.max(low, Math.min(high, this.playerCount + dir));
        this.app.play('menu_move');
        this._sync();
      }, COLORS.cyan, rowHeight));
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
      }, COLORS.purple, rowHeight));
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
      }, COLORS.amber, rowHeight));
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
        entry.setAttribute('autocomplete', 'off');
        entry.setAttribute('aria-label', `Player ${i + 1} name`);
        const def = mode.allow_bot && i === 0 ? 'YOU' : `PLAYER ${i + 1}`;
        entry.value = this.app.playerName(i, def);
        entry.style.cssText = `flex:1 1 0;min-width:0;height:${Math.max(32, rowHeight - 6)}px;padding:0 14px;box-sizing:border-box;`
          + `border-radius:10px;font-size:16px;background:${cssA(COLORS.card, 1)};`
          + `border:1px solid ${cssA(COLORS.hairline, 1)};color:#fff;outline:none;`;
        entry.addEventListener('change', () => this.app.setPlayerName(i, entry.value));
        names.push(entry);
      }
      // Two name fields per row (ui/menu_screens.py: _setup_rows).
      for (let i = 0; i < names.length; i += 2) {
        const row = div('name-row', this.setupBox);
        row.style.cssText = 'display:flex;gap:10px;';
        row.appendChild(names[i]);
        if (names[i + 1]) row.appendChild(names[i + 1]);
      }
    } else if (!this.setupBox.children.length) {
      // The "no extra setup" state: a gear inline with one dim line.
      const note = div('setup-empty', this.setupBox);
      note.style.cssText = `display:flex;align-items:center;gap:16px;padding:4px;min-height:${Math.max(26, rowHeight - 14)}px;`
        + 'color:#cfcbea;font-size:16px;';
      note.appendChild(iconNode('gear', { size: 20, color: css(COLORS.text_dim) }));
      el('div', '', note, 'No extra setup. Press START to bowl.');
    }
  }
  _durationText() {
    const minutes = Math.floor(this.duration / 60);
    const seconds = Math.floor(this.duration - minutes * 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  _stepper(label, value, onStep, accent = COLORS.cyan, rowHeight = 44) {
    const row = div('stepper', this.setupBox);
    row.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:0 16px;box-sizing:border-box;`
      + `min-height:${rowHeight}px;border-radius:12px;`
      + `background:${cssA(COLORS.card, 1)};border:1px solid ${cssA(COLORS.hairline, 1)};`;
    const name = el('div', '', row, label);
    name.style.cssText = 'font-size:16px;color:#fff;';
    const right = div('', row);
    right.style.cssText = 'display:flex;align-items:center;gap:10px;';
    const left = el('div', '', right);
    left.style.cssText = `cursor:pointer;display:flex;color:${css(accent)};`;
    left.appendChild(iconNode('arrow_left', { size: 13, color: css(accent) }));
    const val = el('div', '', right, value);
    val.style.cssText = `font-size:16px;font-weight:700;color:${css(accent)};min-width:70px;text-align:center;`;
    const rightArrow = el('div', '', right);
    rightArrow.style.cssText = `cursor:pointer;display:flex;color:${css(accent)};`;
    rightArrow.appendChild(iconNode('arrow_right', { size: 13, color: css(accent) }));
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
    this.title('BASICS');
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
    this.prevButton = makeButton(this.root, 'PREVIOUS', {
      x: 1184 - SIZES.tab_w - SIZES.tab_gap - SIZES.tab_w / 2, y: 720 - SIZES.nav_bottom - SIZES.nav_h / 2,
      w: SIZES.tab_w, h: SIZES.nav_h, radius: 10, accent: COLORS.text_dim, variant: 'ghost',
      fontPx: SIZES.nav_font, onClick: () => { if (this.page > 0) this._flip(-1); },
    });
    this.nextButton = makeButton(this.root, 'NEXT', {
      x: 1184 - SIZES.tab_w / 2, y: 720 - SIZES.nav_bottom - SIZES.nav_h / 2,
      w: SIZES.tab_w, h: SIZES.nav_h, radius: 10, accent: COLORS.cyan, variant: 'secondary',
      fontPx: SIZES.nav_font, onClick: () => this._next(),
    });
    this.page = 0;
    this._render();
  }
  _flip(step) {
    if (step < 0 && this.page <= 0) return;
    this.page = (this.page + step + this.pages.length) % this.pages.length;
    this._render();
    this.app.play('menu_move');
  }
  _next() {
    if (this.page >= this.pages.length - 1) { this.app.play('menu_back'); this.app.goToMenu(); return; }
    this._flip(1);
  }
  _render() {
    const [name] = this.pages[this.page];
    this.titleNode.textContent = name;
    this.tabs.forEach(({ tab, underline }, index) => {
      const active = index === this.page;
      tab.style.color = css(active ? COLORS.cyan : COLORS.text_dim);
      underline.style.display = active ? 'block' : 'none';
    });
    const last = this.page >= this.pages.length - 1;
    const first = this.page <= 0;
    this.nextButton.textContent = last ? 'DONE' : 'NEXT';
    this.prevButton.style.opacity = first ? '0.45' : '1';
    this.prevButton.style.cursor = first ? 'default' : 'pointer';
    this.content.innerHTML = '';
    const [, rows] = this.pages[this.page];
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
    if (['enter', 'return'].includes(key)) { this._next(); return true; }
    if (key === 'escape' || key === 'space') { this.app.goToMenu(); return true; }
    return false;
  }
}

export class SettingsScreen extends MenuScreen {
  constructor(app) { super(app); this.name = 'settings'; this.camera_view = 'menu'; }
  build() {
    super.build();
    this.title('SETTINGS');
    const sizes = SIZES;
    const panelW = sizes.settings_w;
    const gap = sizes.settings_gap;
    const total = panelW * 2 + gap;
    this._leftX = 640 - total / 2;
    this._rightX = this._leftX + panelW + gap;
    this._panelTop = sizes.settings_y;
    const pad = sizes.settings_pad;
    this._pad = pad;

    this.leftPanel = this._panel(this._leftX);
    this.rightPanel = this._panel(this._rightX);
    this.leftHeading = this._heading(this.leftPanel, 'CONTROLS AND GAMEPLAY');
    this.rightHeading = this._heading(this.rightPanel, 'AUDIO AND DISPLAY');
    this.leftRule = this._rule(this.leftPanel);
    this.rightRule = this._rule(this.rightPanel);

    makeButton(this.root, 'BACK', {
      x: 64 + 100, y: 720 - sizes.nav_bottom - sizes.nav_h / 2, w: 200, h: sizes.nav_h,
      radius: 10, accent: COLORS.text_dim, variant: 'ghost', fontPx: sizes.nav_font,
      onClick: () => this.app.leaveSettings(),
    });
    this.note = el('div', '', this.root, 'Changes are saved automatically');
    this.note.style.cssText = `position:absolute;left:640px;top:${720 - sizes.nav_bottom - sizes.nav_h / 2}px;transform:translate(-50%,-50%);`
      + `font-size:14px;color:${css(COLORS.text_dim)};`;
    this._buildRows();
  }

  _panel(x) {
    const node = div('settings-panel', this.root);
    node.style.cssText = `position:absolute;left:${x}px;top:${this._panelTop}px;width:${SIZES.settings_w}px;`
      + `border-radius:16px;background:${cssA(COLORS.panel, 0.94)};padding:${this._pad}px;box-sizing:border-box;`
      + 'border:1px solid transparent;border-image:linear-gradient(90deg, rgba(62,201,232,0.6), rgba(255,61,139,0.6)) 1;';
    return node;
  }

  _heading(panel, text) {
    const node = el('div', '', panel, text);
    node.style.cssText = `font-size:${SIZES.settings_heading}px;font-weight:700;letter-spacing:${SIZES.settings_head_track}px;color:${css(COLORS.cyan)};`;
    return node;
  }

  _rule(panel) {
    const node = div('', panel);
    node.style.cssText = `margin-top:${SIZES.settings_rule_gap}px;height:1px;background:${cssA(COLORS.hairline, 1)};`;
    return node;
  }

  _stack(panel) {
    const node = div('settings-rows', panel);
    node.style.cssText = `margin-top:${SIZES.settings_first_gap}px;display:flex;flex-direction:column;gap:${SIZES.settings_row_gap}px;`;
    return node;
  }

  _rowBase(parent, helper) {
    const row = div('settings-row', parent);
    row.style.cssText = `min-height:${helper ? SIZES.settings_row_h_help : SIZES.settings_row_h}px;border-radius:12px;`
      + `background:${cssA(COLORS.card, 1)};border:1px solid ${cssA(COLORS.hairline, 1)};`
      + 'display:flex;align-items:center;justify-content:space-between;padding:0 20px;box-sizing:border-box;cursor:pointer;'
      + 'transition:background 0.12s ease,border-color 0.12s ease,transform 0.1s ease;';
    row.addEventListener('pointerenter', () => {
      row.style.background = cssA(COLORS.card_high, 1);
      row.style.borderColor = cssA(COLORS.cyan, 0.45);
    });
    row.addEventListener('pointerleave', () => {
      row.style.background = cssA(COLORS.card, 1);
      row.style.borderColor = cssA(COLORS.hairline, 1);
      row.style.transform = 'none';
    });
    row.addEventListener('pointerdown', () => { row.style.transform = 'scale(0.995)'; });
    row.addEventListener('pointerup', () => { row.style.transform = 'none'; });
    row.addEventListener('pointercancel', () => { row.style.transform = 'none'; });
    row._left = div('', row);
    row._right = div('', row);
    row._right.style.cssText = 'display:flex;align-items:center;';
    row._helper = helper;
    return row;
  }

  _label(row, text) {
    const name = el('div', '', row._left, text);
    name.style.cssText = `font-size:${SIZES.settings_label}px;color:#fff;`;
    if (row._helper) {
      const help = el('div', '', row._left, row._helper);
      help.style.cssText = `font-size:${SIZES.settings_helper}px;color:${css(COLORS.text_dim)};margin-top:2px;`;
    }
    return name;
  }

  _stepperRow(parent, label, valueText, onStep, helper = '', accent = COLORS.cyan) {
    const row = this._rowBase(parent, helper);
    this._label(row, label);
    const leftArrow = el('div', '', row._right);
    leftArrow.style.cssText = `margin-right:10px;color:${css(accent)};cursor:pointer;display:flex;`;
    leftArrow.appendChild(iconNode('arrow_left', { size: 13, color: css(accent) }));
    const val = el('div', '', row._right, valueText);
    val.style.cssText = `min-width:70px;text-align:center;font-size:${SIZES.settings_value}px;font-weight:700;color:${css(accent)};`;
    const rightArrow = el('div', '', row._right);
    rightArrow.style.cssText = `margin-left:10px;color:${css(accent)};cursor:pointer;display:flex;`;
    rightArrow.appendChild(iconNode('arrow_right', { size: 13, color: css(accent) }));
    leftArrow.addEventListener('click', (e) => { e.stopPropagation(); onStep(-1); });
    rightArrow.addEventListener('click', (e) => { e.stopPropagation(); onStep(1); });
    row.addEventListener('click', () => onStep(1));
    return row;
  }

  _toggleRow(parent, label, valueText, onFlip, helper = '', accent = COLORS.cyan) {
    const row = this._rowBase(parent, helper);
    this._label(row, label);
    const on = String(valueText).toUpperCase() === 'ON';
    const chip = el('div', '', row._right, String(valueText).toUpperCase());
    chip.style.cssText = `padding:4px 14px;border-radius:14px;font-size:16px;font-weight:700;cursor:pointer;`
      + `background:${cssA(on ? COLORS.cyan : COLORS.hairline, 1)};color:${css(on ? COLORS.ink : COLORS.text_dim)};`;
    const flip = (e) => { if (e) e.stopPropagation(); onFlip(); };
    chip.addEventListener('click', flip);
    row.addEventListener('click', () => onFlip());
    return row;
  }

  _sliderRow(parent, label, value, onChange) {
    const row = this._rowBase(parent, '');
    this._label(row, label);
    // The track: 6px hairline with a cyan fill and an 18px white thumb; the
    // value column stays right-aligned at 56px (ui/theme.py Slider).
    const right = div('', row._right);
    right.style.cssText = 'display:flex;align-items:center;gap:12px;flex:0 0 auto;';
    const track = div('', right);
    track.style.cssText = `position:relative;width:${SIZES.settings_w - 2 * this._pad - SIZES.settings_label_col - SIZES.settings_value_col - SIZES.settings_row_pad - 16}px;height:6px;`
      + `border-radius:3px;background:${cssA(COLORS.hairline, 1)};cursor:pointer;`;
    const fill = div('', track);
    fill.style.cssText = `position:absolute;left:0;top:0;height:100%;border-radius:3px;background:${css(COLORS.cyan)};width:${Math.round(value * 100)}%;`;
    const thumb = div('', track);
    thumb.style.cssText = `position:absolute;top:50%;width:18px;height:18px;border-radius:9px;background:#fff;transform:translate(-50%,-50%);left:${Math.round(value * 100)}%;`;
    const valueText = el('div', '', right, `${Math.round(value * 100)}%`);
    valueText.style.cssText = `min-width:${SIZES.settings_value_col}px;text-align:right;font-size:${SIZES.settings_value}px;font-weight:700;color:${css(COLORS.cyan)};`;
    row._slider = {
      setValue(next) {
        const pct = Math.round(Math.max(0, Math.min(1, next)) * 100);
        fill.style.width = `${pct}%`;
        thumb.style.left = `${pct}%`;
        valueText.textContent = `${pct}%`;
      },
    };
    this._sliders.push(row._slider);
    const apply = (clientX) => {
      const rect = track.getBoundingClientRect();
      const next = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      row._slider.setValue(next);
      onChange(next);
    };
    let dragging = false;
    track.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      apply(e.clientX);
    });
    window.addEventListener('mousemove', (e) => { if (dragging) apply(e.clientX); });
    window.addEventListener('mouseup', () => { dragging = false; });
    return row;
  }

  _cycleSetting(key, options, accent, rebuild = true) {
    return (dir) => {
      const current = this.app.settings.get(key);
      const list = Array.from(options);
      const index = list.indexOf(current);
      const next = list[(index + dir + list.length) % list.length];
      this.app.settings.set(key, next);
      this.app.settings.save();
      this.app.applySettings();
      if (rebuild) this._buildRows();
      this.app.play('menu_move');
    };
  }

  _buildRows() {
    const settings = this.app.settings;
    this._sliders = [];
    for (const panel of [this.leftPanel, this.rightPanel]) {
      for (const node of [...panel.querySelectorAll('.settings-rows')]) node.remove();
    }
    const left = this._stack(this.leftPanel);
    const right = this._stack(this.rightPanel);

    this._stepperRow(left, 'INPUT METHOD', String(settings.get('input_mode')).toUpperCase(),
      this._cycleSetting('input_mode', INPUT_MODES, COLORS.cyan),
      'Mouse is always available; webcam needs a camera.', COLORS.cyan);
    this._stepperRow(left, 'THROWING ARM', String(settings.get('throwing_arm')).toUpperCase(),
      this._cycleSetting('throwing_arm', ['auto', 'left', 'right'], COLORS.cyan),
      '', COLORS.cyan);
    this._stepperRow(left, 'CAMERA INDEX', this._cameraText(),
      (dir) => {
        const options = [null, 0, 1, 2, 3];
        const current = settings.get('camera_index');
        const index = Math.max(0, options.indexOf(current));
        settings.set('camera_index', options[(index + dir + options.length) % options.length]);
        settings.save(); this.app.applySettings(); this._buildRows(); this.app.play('menu_move');
      }, '', COLORS.cyan);
    this._toggleRow(left, 'HAND MENU NAVIGATION', settings.get('hand_menu_navigation') ? 'ON' : 'OFF',
      () => this._flip('hand_menu_navigation'), 'Experimental; needs the webcam', COLORS.cyan);
    this._toggleRow(left, 'SHOW PHYSICS READOUT', settings.get('show_physics_readout') ? 'ON' : 'OFF',
      () => this._flip('show_physics_readout'), 'H shows it while you play', COLORS.cyan);
    this._toggleRow(left, 'REDUCE MOTION', settings.get('reduce_motion') ? 'ON' : 'OFF',
      () => this._flip('reduce_motion'), 'No shake, flashes or pulsing effects', COLORS.cyan);

    this._sliderRow(right, 'MASTER VOLUME', settings.get('master_volume'), (value) => {
      settings.set('master_volume', value); settings.save(); this.app.applySettings(); this._syncSliderValues();
    });
    this._sliderRow(right, 'SFX VOLUME', settings.get('sfx_volume'), (value) => {
      settings.set('sfx_volume', value); settings.save(); this.app.applySettings(); this._syncSliderValues();
    });
    this._sliderRow(right, 'MUSIC VOLUME', settings.get('music_volume'), (value) => {
      settings.set('music_volume', value); settings.save(); this.app.applySettings(); this._syncSliderValues();
    });
    this._toggleRow(right, 'MUTE', settings.get('muted') ? 'ON' : 'OFF',
      () => this._flip('muted'), '', COLORS.cyan);
    this._toggleRow(right, 'DEVELOPER DIAGNOSTICS', settings.get('debug_diagnostics') ? 'ON' : 'OFF',
      () => this._flip('debug_diagnostics'), 'Webcam tracking detail in the readout (H)', COLORS.cyan);

    // Panels share one height (the taller stack), as in ui/menu_screens.py.
    const leftH = left.offsetHeight;
    const rightH = right.offsetHeight;
    const headingH = this.leftHeading.offsetHeight + SIZES.settings_rule_gap + 1 + SIZES.settings_first_gap;
    const panelH = Math.min(720 - SIZES.nav_bottom - SIZES.nav_h - 24 - this._panelTop,
      headingH + Math.max(leftH, rightH) + 2 * this._pad);
    this.leftPanel.style.height = `${panelH}px`;
    this.rightPanel.style.height = `${panelH}px`;
    this._syncSliderValues();
  }

  _syncSliderValues() {
    // Values are rewritten on rebuild; the drag path updates the row itself.
  }

  _cameraText() {
    const index = this.app.settings.get('camera_index');
    return index === null || index === undefined ? 'DEFAULT' : String(index);
  }

  _flip(key) {
    this.app.settings.set(key, !this.app.settings.get(key));
    this.app.settings.save();
    this.app.applySettings();
    this._buildRows();
    this.app.play('menu_move');
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
