// Interactive overlays for the play screen (ported from ui/overlays.py):
// pause, results and the turn handoff banner.
import { COLORS, PALETTE, TYPE_PX, css, cssA, wrapText } from './theme.js';
import { div, el, button as makeButton } from './dom.js';

class Overlay {
  constructor(parent, { fullWidth = 0.62, height = 0.40, accent = COLORS.cyan, backdrop = true } = {}) {
    this.fullWidth = fullWidth;
    this.height = height;
    this.accent = accent;
    this.root = div('overlay', parent);
    this.root.style.position = 'absolute';
    this.root.style.left = '0'; this.root.style.top = '0';
    this.root.style.width = '1280px'; this.root.style.height = '720px';
    this.root.style.display = 'none';
    this.animateIn = null;
    this.buttons = [];
    this.selected = 0;
    if (backdrop) {
      this.backdrop = div('overlay-backdrop', this.root);
      this.backdrop.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;background:${cssA(PALETTE.ink, 0.55)};`;
    }
    const widthPx = fullWidth * 720;
    const heightPx = height * 720;
    this.panel = div('overlay-panel', this.root);
    this.panel.style.cssText = `position:absolute;left:${640 - widthPx / 2}px;top:${360 - heightPx / 2}px;`
      + `width:${widthPx}px;height:${heightPx}px;border-radius:16px;background:${cssA(PALETTE.panel, 0.95)};`
      + `box-shadow:0 0 40px rgba(0,0,0,0.6);`;
    this.hairline = div('overlay-hairline', this.root);
    this.hairline.style.cssText = `position:absolute;left:${640 - widthPx / 2}px;top:${360 - heightPx / 2}px;`
      + `width:${widthPx}px;height:4px;background:${cssA(accent, 0.9)};`;
    this.heading = el('div', 'overlay-heading', this.root, '');
    this.heading.style.cssText = `position:absolute;left:640px;top:${360 - heightPx / 2 + 24}px;transform:translateX(-50%);`
      + `font-size:40px;font-weight:900;color:${css(PALETTE.white)};text-align:center;`
      + `text-shadow:0 0 18px ${cssA(accent, 0.8)},0 0 40px ${cssA(accent, 0.4)};`;
    this.bodyLines = [];
    for (let i = 0; i < 12; i++) {
      const line = el('div', '', this.root);
      line.style.cssText = 'position:absolute;font-size:16px;color:rgb(176,184,210);white-space:pre;display:none;';
      this.bodyLines.push(line);
    }
    this._widthPx = widthPx;
    this._heightPx = heightPx;
  }

  get visible() { return this.root.style.display !== 'none'; }
  hide() { this.root.style.display = 'none'; }
  show() {
    this.root.style.display = 'block';
    this.layout();
    if (this.animateIn) this.animateIn(this);
  }

  bodyText() { return ''; }

  layout() {
    const heightPx = this._heightPx;
    const top = 360 - heightPx / 2;
    this.heading.style.top = `${top + 24}px`;
    const buttonH = 0.056 * 720;
    const gap = 0.014 * 720;
    const count = this.buttons.length;
    const total = count * buttonH + Math.max(0, count - 1) * gap;
    const bottom = top + heightPx - 20;
    let cursor = bottom - total;
    for (const button of this.buttons) {
      const widthPx = this._widthPx * 0.76;
      button.style.width = `${widthPx}px`;
      button.style.height = `${buttonH}px`;
      button.style.left = `${640 - widthPx / 2}px`;
      button.style.top = `${cursor}px`;
      cursor += buttonH + gap;
    }
    const bodyTop = top + 0.125 * 720;
    const bodyBottom = bottom - total - 22;
    const available = Math.max(40, bodyBottom - bodyTop);
    const wrapped = [];
    for (const raw of this.bodyText().split('\n')) {
      if (!raw.trim()) wrapped.push('');
      else wrapped.push(...wrapText(raw, Math.max(24, Math.floor((this._widthPx - 50) / 8))));
    }
    const maxLines = Math.max(1, Math.floor(available / 22));
    const countLines = Math.min(wrapped.length, this.bodyLines.length, maxLines);
    for (let i = 0; i < this.bodyLines.length; i++) {
      const line = this.bodyLines[i];
      if (i < countLines) {
        line.style.display = 'block';
        line.textContent = wrapped[i];
        line.style.left = `${640 - this._widthPx / 2 + 32}px`;
        line.style.top = `${bodyTop + i * 22}px`;
      } else line.style.display = 'none';
    }
  }

  click() { return false; }
  updateWidgets() {}
  moveSelection(step) {
    if (!this.buttons.length) return;
    this.selected = (this.selected + step + this.buttons.length) % this.buttons.length;
  }
  activate() {
    if (!this.buttons.length) return false;
    const button = this.buttons[this.selected % this.buttons.length];
    if (button.onClick) button.onClick();
    return true;
  }
}

export class PauseOverlay extends Overlay {
  constructor(parent, { onResume, onRestart, onMenu, onSettings = null }) {
    super(parent, { fullWidth: 0.46, height: 0.46, accent: PALETTE.amber });
    this.heading.textContent = 'PAUSED';
    const mk = (label, accent, fn) => makeButton(this.root, label, {
      w: this._widthPx * 0.76, h: 40, radius: 10, accent, variant: 'secondary', fontPx: 16, onClick: fn,
    });
    this.buttons = [mk('RESUME', PALETTE.green, onResume), mk('RESTART MATCH', PALETTE.cyan, onRestart)];
    if (onSettings) this.buttons.push(mk('SETTINGS', PALETTE.magenta, onSettings));
    this.buttons.push(mk('QUIT TO MENU', PALETTE.red, onMenu));
  }
  click() { return false; }
}

export class ResultsOverlay extends Overlay {
  constructor(parent, { onRematch, onMenu, onLab = null }) {
    super(parent, { fullWidth: 0.74, height: 0.68, accent: PALETTE.amber });
    this.heading.textContent = 'RESULTS';
    this.lines = [];
    this.total = null;
    this.awardText = '';
    this.awardSub = '';
    this.totalCaption = el('div', '', this.root, 'FINAL SCORE');
    this.totalCaption.style.cssText = `position:absolute;left:640px;transform:translateX(-50%);font-size:14px;color:rgb(176,184,210);`;
    this.totalScore = el('div', '', this.root, '');
    this.totalScore.style.cssText = `position:absolute;left:640px;transform:translateX(-50%);font-size:52px;font-weight:900;color:${css(PALETTE.amber)};`
      + `text-shadow:0 0 24px ${cssA([96, 226, 255], 0.5)};`;
    this.achievement = el('div', '', this.root, '');
    this.achievement.style.cssText = `position:absolute;left:640px;transform:translateX(-50%);font-size:32px;font-weight:900;color:${css(PALETTE.amber)};display:none;`;
    this.achievementSub = el('div', '', this.root, '');
    this.achievementSub.style.cssText = `position:absolute;left:640px;transform:translateX(-50%);font-size:15px;color:rgb(176,184,210);display:none;`;

    const mk = (label, accent, fn) => makeButton(this.root, label, {
      w: this._widthPx * 0.76, h: 40, radius: 10, accent, variant: 'secondary', fontPx: 16, onClick: fn,
    });
    this.buttons = [mk('REMATCH', PALETTE.green, onRematch)];
    if (onLab) this.buttons.push(mk('OPEN PHYSICS LAB', PALETTE.cyan, onLab));
    this.buttons.push(mk('MAIN MENU', PALETTE.magenta, onMenu));
    this._topReserve = 0;
  }

  setLines(lines) { this.lines = lines.slice(); }
  setAchievement(title, subtitle = '', rgb = null, glow = null) {
    this.awardText = title || '';
    this.awardSub = subtitle || '';
    this.achievement.textContent = this.awardText;
    this.achievement.style.display = this.awardText ? 'block' : 'none';
    if (rgb) this.achievement.style.color = css(rgb);
    this.achievement.style.textShadow = glow ? `0 0 20px ${cssA(glow, 0.8)}` : 'none';
    this.achievementSub.textContent = this.awardSub;
    this.achievementSub.style.display = this.awardSub ? 'block' : 'none';
  }
  setTotal(total, startValue = null) {
    this.total = total;
    this.showTotal = total !== null && total !== undefined;
    this._topReserve = this.showTotal ? (0.115 + (this.awardText ? 0.062 : 0)) * 720 : 0;
    if (this.showTotal) {
      this.totalScore.textContent = String(startValue !== null ? startValue : total);
      this.totalCaption.style.display = 'block';
      this.totalScore.style.display = 'block';
    } else {
      this.totalCaption.style.display = 'none';
      this.totalScore.style.display = 'none';
    }
  }
  bodyText() { return this.lines.join('\n'); }
  layout() {
    super.layout();
    const top = 360 - this._heightPx / 2;
    this.totalCaption.style.top = `${top + 75}px`;
    this.totalScore.style.top = `${top + 92}px`;
    this.achievement.style.top = `${top + 156}px`;
    this.achievementSub.style.top = `${top + 192}px`;
  }
  show(total = null, startFrom = null) {
    this.setTotal(total, startFrom);
    this.selected = 0;
    super.show();
  }
  hide() {
    this.total = null;
    this.showTotal = false;
    this.setAchievement('');
    super.hide();
  }
}

export class HandoffBanner {
  constructor(parent) {
    this.root = div('handoff', parent);
    this.root.style.position = 'absolute';
    this.root.style.left = '0'; this.root.style.top = '0';
    this.root.style.width = '1280px'; this.root.style.height = '720px';
    this.root.style.display = 'none';
    this.backdrop = div('handoff-backdrop', this.root);
    this.backdrop.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;background:${cssA(PALETTE.ink, 0.45)};`;
    this.panel = div('handoff-panel', this.root);
    this.panel.style.cssText = 'position:absolute;left:272px;top:180px;width:736px;height:216px;border-radius:16px;'
      + `background:${cssA(PALETTE.panel, 0.94)};`;
    this.hairline = div('handoff-hairline', this.root);
    this.hairline.style.cssText = `position:absolute;left:272px;top:180px;width:736px;height:4px;background:${cssA(PALETTE.cyan, 0.9)};`;
    this.heading = el('div', '', this.root, 'NEXT BOWLER');
    this.heading.style.cssText = `position:absolute;left:640px;top:200px;transform:translateX(-50%);font-size:24px;font-weight:900;color:${css(PALETTE.white)};`
      + `text-shadow:0 0 16px ${cssA(PALETTE.cyan, 0.8)};`;
    this.name = el('div', '', this.root, '');
    this.name.style.cssText = `position:absolute;left:640px;top:236px;transform:translateX(-50%);font-size:30px;font-weight:900;color:${css(PALETTE.amber)};`
      + `text-shadow:0 0 16px ${cssA(PALETTE.amber, 0.8)};`;
    this.instructions = el('div', '', this.root, '');
    this.instructions.style.cssText = 'position:absolute;left:640px;top:284px;transform:translateX(-50%);font-size:15px;color:rgb(176,184,210);text-align:center;white-space:pre-line;';
    this.status = el('div', '', this.root, '');
    this.status.style.cssText = 'position:absolute;left:640px;top:352px;transform:translateX(-50%);font-size:15px;color:#fff;';
    this._track = div('handoff-track', this.root);
    this._track.style.cssText = `position:absolute;left:640px;top:376px;transform:translateX(-50%);width:440px;height:12px;border-radius:6px;background:${cssA(PALETTE.panel_dark, 0.9)};overflow:hidden;`;
    this._fill = div('handoff-fill', this._track);
    this._fill.style.cssText = `width:0%;height:100%;background:${cssA(PALETTE.green, 0.85)};`;
  }
  get visible() { return this.root.style.display !== 'none'; }
  hide() { this.root.style.display = 'none'; }
  show() { this.root.style.display = 'block'; }
  update(name, lines, progress, accent = null, colour = null) {
    this.show();
    this.name.textContent = name;
    this.name.style.color = css(accent || PALETTE.amber);
    this.instructions.textContent = lines.join('\n');
    this.status.textContent = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    this._fill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
    this._fill.style.background = cssA(colour || PALETTE.green, 0.9);
  }
}
