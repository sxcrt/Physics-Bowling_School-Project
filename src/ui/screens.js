// Screens and the screen manager (ported from ui/screens.py).
import { div } from './dom.js';

export class Screen {
  constructor(app) {
    this.app = app;
    this.name = 'screen';
    this.camera_view = 'menu';
    this.root = div('screen', app.uiRoot);
    this.root.style.cssText = 'position:absolute;left:0;top:0;width:1280px;height:720px;display:none;pointer-events:auto;';
    this.widgets = [];
    this.buttons = [];
    this.selected = 0;
    this.built = false;
    this._enterTime = 0.0;
    this._entering = false;
  }
  build() { this.built = true; }
  show(kwargs = {}) {
    if (!this.built) this.build();
    this.root.style.display = 'block';
    this.app.setCameraView(this.camera_view);
    this.beginEnter();
    this.onShow(kwargs);
  }
  hide() { this.root.style.display = 'none'; }
  onShow() {}
  beginEnter() {
    this._enterTime = 0.0;
    this._entering = true;
    this.root.style.opacity = '0';
  }
  updateEnter(dt) {
    if (!this._entering) return;
    this._enterTime += dt;
    const t = Math.min(1.0, this._enterTime / 0.18);
    this.root.style.opacity = String(t);
    if (t >= 1.0) { this._entering = false; this.root.style.opacity = '1'; }
  }
  update(dt) { this.updateEnter(dt); this.onUpdate(dt); }
  onUpdate() {}
  onKey(key) {
    if (key === 'up arrow' || key === 'up') { this.moveSelection(-1); return true; }
    if (key === 'down arrow' || key === 'down') { this.moveSelection(1); return true; }
    if (key === 'enter' || key === 'return' || key === 'space') {
      if (!this.buttons.length) return false;
      const button = this.buttons[this.selected % this.buttons.length];
      if (button && button.onClick && button.enabled !== false) { button.onClick(); return true; }
    }
    return false;
  }
  on_click(x, y) { return false; }
  moveSelection(step) {
    if (!this.buttons.length) return;
    this._keyboardFocus = true;
    this.selected = (this.selected + step + this.buttons.length) % this.buttons.length;
    this.refreshSelection();
  }
  refreshSelection() {
    this.buttons.forEach((button, index) => {
      if (typeof button.setSelected === 'function') {
        button.setSelected(index === this.selected && this._keyboardFocus !== false);
      }
    });
  }
  get dt() { return this.app.dt; }
}

export class ScreenManager {
  constructor(app) {
    this.app = app;
    this.screens = {};
    this.active = null;
  }
  register(screen) { this.screens[screen.name] = screen; return screen; }
  get(name) { return this.screens[name]; }
  set(name, kwargs = {}) {
    const screen = this.screens[name];
    if (!screen) throw new Error(`unknown screen ${name}`);
    if (this.active === screen) { screen.show(kwargs); return screen; }
    if (this.active) this.active.hide();
    this.active = screen;
    screen.show(kwargs);
    return screen;
  }
  update(dt) { if (this.active) this.active.update(dt); }
  onKey(key) { if (!this.active) return false; return this.active.onKey(key); }
  onClick(x, y) {
    if (!this.active) return false;
    const handler = this.active.on_click;
    if (typeof handler === 'function') return !!handler.call(this.active, x, y);
    return false;
  }
}
