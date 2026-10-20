// The Physics Lab: a rotational/kinematics simulator and equation solver
// docked beside the real 3D lane.
//
// The calculator is one field list, not an INPUTS/RESULTS split. A field is
// KNOWN when the player typed it, SOLVED when an equation determined it, or
// NEED when the system is underdetermined. Constants are constraints too.
// BOWL launches the real rigid-body simulation with the solved launch values;
// the timeline is a recording of that run, not a second analytical model.
import * as config from '../config.js';
import { DeckTimeline, RollResult } from '../physics.js';
import { fovPushIn, fovReset, updateCamera } from '../scene/camera.js';
import { setShadowFocus } from '../scene/shadow.js';
import { div, el } from './dom.js';
import { Screen } from './screens.js';
import { decelerationToScale } from './lab_model.js';
import {
  CONST_FIELDS, VAR_FIELDS,
  INITIAL_TYPED, CONSTANT_DEFAULTS,
  solveSystem, fmt, equationSheet, HOOK_MODEL_DESCRIPTION,
} from './lab_solver.js';

const DEBOUNCE_MS = 200;

const BADGE_TEXT = {
  known: 'KNOWN',
  solved: 'SOLVED',
  auto: 'AUTO',
  missing: 'NEED',
  // "CONFLICT" does not fit the compact state chip; the red chip, the note and
  // the WORK header all spell out the full state.
  conflict: 'CLASH',
};

const WORK_ORDER = {
  accel: 0, time: 1, sideways: 2, momentum: 3, energy: 4,
  mass: 5, mu: 6, gravity: 7, length: 8, aim: 9,
};

const ASSUMPTIONS = [
  'Level, straight lane; the analytical travel runs from the foul line to the head pin over L.',
  'Constant signed acceleration with a ≤ 0. The lane can decelerate the ball but cannot push it.',
  'Rolling resistance only: a = −μ·g. Collisions, skid, and pin contact are outside the solver.',
  'BOWL uses the real rigid-body lane and collision simulation; the solver supplies the launch plan.',
  'm, μ, g and L are analytical constraints. The 3D ball keeps the game mass (6 kg) and the lane keeps its 18.29 m geometry; changing L changes the solved travel time, not the rendered lane. μ and g flow into the BOWL rolling-deceleration scale through a.',
  'Start X, Aim and Hook are direct throw inputs. A blank one uses its documented default (0.20 m, -0.4°, -1.6 rad/s) because the requested equations do not determine it.',
  'Aim can still be solved from vx and speed when both are known; it is only defaulted after the equations have had their chance.',
  'p and K use translational speed only; rotational kinetic energy is not included.',
  'The hook model is a_lat = k·hook. k is a display/analysis constant, not a retuning of the 3D lane.',
  'Values display to 4 decimals; full precision is kept internally.',
  'Contradictions use a 2×10⁻⁴ relative tolerance so 4-decimal display rounding does not create false conflicts.',
];

export class LabScreen extends Screen {
  constructor(app) {
    super(app);
    this.name = 'lab';
    this.camera_view = 'game';
  }

  // ==== Construction ======================================================
  build() {
    super.build();
    this.root.classList.add('lab-root');
    // The app's global keyboard router suppresses Tab on game screens. Once
    // focus is inside the lab, stop Tab at the screen root so the browser's
    // normal focus navigation works; onShow() moves focus here on entry.
    this.root.tabIndex = -1;
    this.root.style.outline = 'none';
    this.root.setAttribute('role', 'main');
    this.root.setAttribute('aria-label', 'Physics Lab simulator');
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') event.stopPropagation();
    });
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.root.focus({ preventScroll: true });
    });

    this.given = { ...INITIAL_TYPED };
    this.solution = null;
    this.rows = {};
    this.timeline = new DeckTimeline();
    this.timelineIndex = null;
    this.tlDragging = false;
    this.state = 'idle';
    this.paused = false;
    this.result = null;
    this.setup = {
      speed: 7.5,
      lateral: 0.2,
      angle: -0.4,
      spin: -1.6,
    };
    this.deceleration = -config.ROLLING_FRICTION * config.GRAVITY;
    this._timer = 0.0;
    this._settleElapsed = 0.0;
    this._frames = 0;
    this._hit = false;
    this._releaseSpeed = 0.0;
    this._solveTimer = null;
    this._controlsKey = '';
    this._lastCommitted = {};
    this.solverOpen = false;

    this._buildSidebar();
    this._buildTitle();
    this._buildTimeline();
    this._buildGhostButtons();
    this._buildDrawer();
    this._buildSolverModal();

    this._mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 900px)') : null;
    if (this._mobileQuery) {
      this._mobileQueryListener = () => this._syncDrawerA11y();
      if (this._mobileQuery.addEventListener) {
        this._mobileQuery.addEventListener('change', this._mobileQueryListener);
      } else if (this._mobileQuery.addListener) {
        this._mobileQuery.addListener(this._mobileQueryListener);
      }
    }
    this._syncDrawerA11y();

    this._solveNow();
    this._updateTimelineUi();
  }


  _button(label, className, parent, onClick, options = {}) {
    const node = el('button', `ui-button ${className}`, parent, label);
    node.type = 'button';
    if (options.title) node.title = options.title;
    if (options.ariaLabel) node.setAttribute('aria-label', options.ariaLabel);
    node.addEventListener('pointerdown', (event) => event.stopPropagation());
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick(event);
    });
    // Keep the browser's native Space/Enter activation from also reaching the
    // global shortcut handler; all other keys (P, R, B, Escape) still bubble so
    // the lab's keyboard shortcuts work while a button has focus.
    node.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    return node;
  }

  _iconButton(parent, label, onClick, ariaLabel) {
    const node = el('button', 'lab-clear', parent, label);
    node.type = 'button';
    if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
    node.addEventListener('pointerdown', (event) => event.stopPropagation());
    node.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick(event);
    });
    return node;
  }

  _buildSidebar() {
    this.sidebar = el('aside', 'lab-sidebar', this.root);
    this.sidebar.id = 'lab-sidebar';
    this.sidebar.setAttribute('aria-label', 'Physics simulator controls');

    const head = div('lab-side-head', this.sidebar);
    const titles = div('', head);
    el('div', 'lab-side-title', titles, 'PHYSICS LAB');
    el('div', 'lab-side-sub', titles, 'SIMULATOR + SOLVER');
    this.statusPill = div('lab-status-pill', head, 'SOLVED');
    this.statusPill.dataset.state = 'solved';
    this.drawerClose = el('button', 'lab-drawer-close', head, '×');
    this.drawerClose.type = 'button';
    this.drawerClose.setAttribute('aria-label', 'Close calculator drawer');
    this.drawerClose.addEventListener('click', (event) => {
      event.stopPropagation();
      this._closeDrawer();
    });

    const helper = div('lab-helper', this.sidebar);
    helper.id = 'lab-helper';
    div('lab-helper-dot', helper);
    const helperText = el('span', '', helper);
    helperText.append('blank = ');
    const auto = el('b', '', helperText, 'auto');
    auto.title = 'A blank field is solved from the equations, or uses the documented direct-input default.';
    helperText.append(' · type to lock a value');

    this.note = div('lab-note', this.sidebar);
    this.note.id = 'lab-note';
    this.note.setAttribute('role', 'status');
    this.note.setAttribute('aria-live', 'polite');

    // Constants
    const constants = el('section', 'lab-constants', this.sidebar);
    constants.setAttribute('aria-label', 'Constants');
    constants.title = 'm mass · μ friction · g gravity · L lane length · k hook model';
    this._sectionHead(constants, 'CONSTANTS', 'm · μ · g · L · k');
    const constGrid = div('lab-const-grid', constants);
    for (const field of CONST_FIELDS) this._buildConstantRow(constGrid, field);

    // Variables
    const fields = el('section', 'lab-fields', this.sidebar);
    fields.setAttribute('aria-label', 'Variables');
    this._sectionHead(fields, 'VARIABLES', 'known or solved');
    const list = div('lab-field-list', fields);
    for (const field of VAR_FIELDS) this._buildFieldRow(list, field);

    // Actions
    const actions = div('lab-actions', this.sidebar);
    const secondary = div('lab-secondary-row', actions);
    this.pauseButton = this._button('PAUSE', 'lab-secondary', secondary,
      () => this.togglePause(), { ariaLabel: 'Pause or resume the run' });
    this.resetButton = this._button('RESET', 'lab-secondary', secondary,
      () => this.reset(), { ariaLabel: 'Reset the lane and clear the timeline' });
    this.clearButton = this._button('CLEAR ALL', 'lab-secondary', secondary,
      () => this.clearGiven(), { ariaLabel: 'Clear all variable fields and keep the constants' });
    this.bowlButton = this._button('BOWL', 'lab-bowl', actions,
      () => this.bowl(), { ariaLabel: 'Bowl using the solved launch values' });

    // Work
    const work = el('section', 'lab-work', this.sidebar);
    work.setAttribute('aria-label', 'Equation working');
    this._sectionHead(work, 'WORK', '');
    this.workCount = work.querySelector('.lab-section-hint');
    this.workCount.classList.add('lab-work-count');
    this.workList = div('lab-work-list', work);

    // Built before the title/timeline so it is the first focus stop on mobile
    // once the closed sidebar is inert.
    this.drawerToggle = this._button('CALCULATOR', 'lab-ghost lab-drawer-toggle', this.root,
      () => this._toggleDrawer(), { ariaLabel: 'Open the calculator drawer' });
    this.drawerToggle.setAttribute('aria-controls', 'lab-sidebar');
    this.drawerToggle.setAttribute('aria-expanded', 'false');
  }

  _sectionHead(parent, title, hint) {
    const head = div('lab-section-head', parent);
    el('span', '', head, title);
    const hintEl = el('span', 'lab-section-hint', head, hint);
    return hintEl;
  }

  _buildFieldRow(parent, field) {
    const row = div('lab-field', parent);
    row.dataset.key = field.key;
    row.dataset.state = 'missing';

    const label = el('label', 'lab-field-label', row, field.label);
    label.htmlFor = `lab-field-${field.key}`;
    label.title = field.help;

    el('span', 'lab-field-unit', row, field.unit || '');

    const input = el('input', 'lab-field-input', row);
    input.type = 'number';
    input.id = `lab-field-${field.key}`;
    input.step = String(field.step);
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'auto';
    input.setAttribute('aria-describedby', 'lab-helper lab-note');
    input.title = field.help;
    input.dataset.key = field.key;
    this._bindInput(input, field);

    const badge = el('span', 'lab-field-state', row, 'NEED');
    badge.setAttribute('aria-hidden', 'true');

    const clear = this._iconButton(row, '×', () => this._clearField(field.key),
      `Clear ${field.messageLabel}`);

    this.rows[field.key] = {
      row, input, badge, clear, field, kind: 'field',
    };
  }

  _buildConstantRow(parent, field) {
    const row = div('lab-const', parent);
    row.dataset.key = field.key;
    row.dataset.state = 'known';

    const label = el('label', 'lab-const-label', row, field.symbol);
    label.htmlFor = `lab-const-${field.key}`;
    label.title = `${field.messageLabel} — ${field.help}`;

    const input = el('input', 'lab-const-input', row);
    input.type = 'number';
    input.id = `lab-const-${field.key}`;
    input.step = String(field.step);
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'auto';
    input.setAttribute('aria-label',
      `${field.messageLabel}${field.unit ? `, in ${field.unit}` : ''}`);
    input.setAttribute('aria-describedby', 'lab-helper lab-note');
    input.title = `${field.messageLabel} — ${field.help}`;
    input.dataset.key = field.key;
    this._bindInput(input, field);

    el('span', 'lab-const-unit', row, field.unit || '');

    const clear = this._iconButton(row, '×', () => this._clearField(field.key),
      `Clear ${field.messageLabel}`);
    clear.style.width = '17px';
    clear.style.height = '17px';

    this.rows[field.key] = {
      row, input, badge: null, clear, field, kind: 'const',
    };
  }

  _bindInput(input, field) {
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('focus', () => {
      this._lastCommitted[field.key] = Number.isFinite(this.given[field.key])
        ? this.given[field.key] : null;
      window.setTimeout(() => {
        if (document.activeElement === input) input.select();
      }, 0);
    });
    input.addEventListener('input', () => this._onInput(field.key, input));
    input.addEventListener('change', () => this._commitInput(field.key, input));
    input.addEventListener('blur', () => {
      if (input._skipBlurCommit) {
        input._skipBlurCommit = false;
        return;
      }
      this._commitInput(field.key, input);
      this._solveNow();
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        const last = this._lastCommitted[field.key];
        if (Number.isFinite(last)) this.given[field.key] = last;
        else delete this.given[field.key];
        input.value = Number.isFinite(last) ? fmt(last) : '';
        this._solveNow();
        input._skipBlurCommit = true;
        input.blur();
      }
    });
  }

  _buildTitle() {
    const wrap = div('lab-title-wrap', this.root);
    const title = el('h1', 'lab-title', wrap, 'PHYSICS LAB');
    title.setAttribute('aria-label', 'Physics Lab');
    el('div', 'lab-subtitle', wrap, 'ROTATIONAL / KINEMATICS SIMULATOR');

    this.banner = div('lab-banner', this.root);
    this.banner.setAttribute('role', 'status');
    this.banner.setAttribute('aria-live', 'polite');
  }

  _buildTimeline() {
    this.tlPanel = div('lab-timeline', this.root);
    this.tlPanel.setAttribute('role', 'group');
    this.tlPanel.setAttribute('aria-label', 'Run timeline');

    const top = div('lab-timeline-top', this.tlPanel);
    this.tlTime = el('span', 'lab-timeline-time', top, 't = 0.0000 s / 0.0000 s');
    this.tlStatus = el('span', 'lab-timeline-status', top, 'ready — press BOWL to start the run');
    this.tlStatus.setAttribute('role', 'status');
    this.tlStatus.setAttribute('aria-live', 'polite');

    this.tlTrack = div('lab-timeline-track', this.tlPanel);
    this.tlTrack.setAttribute('role', 'slider');
    this.tlTrack.setAttribute('tabindex', '0');
    this.tlTrack.setAttribute('aria-label', 'Timeline scrubber');
    this.tlTrack.setAttribute('aria-valuemin', '0');
    this.tlTrack.setAttribute('aria-valuemax', '0');
    this.tlTrack.setAttribute('aria-valuenow', '0');
    this.tlTrack.setAttribute('aria-valuetext', 'no run recorded');
    this.tlTrack.setAttribute('aria-disabled', 'true');

    const rail = div('lab-track-rail', this.tlTrack);
    this.tlFill = div('lab-track-fill', rail);
    this.tlThumb = div('lab-timeline-thumb', this.tlTrack);
    this._bindScrub();

    const metrics = div('lab-timeline-metrics', this.tlPanel);
    this.tlPos = this._metric(metrics, 'POS');
    this.tlVel = this._metric(metrics, 'VEL');
    this.tlSpin = this._metric(metrics, 'SPIN');
    this.tlPins = this._metric(metrics, 'PINS', '--');
    this.tlPins.dataset.kind = '';
  }

  _metric(parent, label, initial = '0.000') {
    const wrap = el('span', '', parent);
    el('b', '', wrap, label);
    const value = el('span', '', wrap, initial);
    return value;
  }

  _bindScrub() {
    const scrubFromEvent = (event) => {
      if (!this.timelineAvailable()) return;
      const rect = this.tlTrack.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const index = this.timeline.indexAt(fraction * this.timeline.duration());
      this.scrubTo(index);
    };

    this.tlTrack.addEventListener('pointerdown', (event) => {
      if (!this.timelineAvailable()) return;
      event.preventDefault();
      event.stopPropagation();
      this.tlTrack.focus({ preventScroll: true });
      this.tlDragging = true;
      if (this.tlTrack.setPointerCapture) {
        try { this.tlTrack.setPointerCapture(event.pointerId); } catch (_e) { /* not capturable */ }
      }
      scrubFromEvent(event);
    });
    this.tlTrack.addEventListener('pointermove', (event) => {
      if (this.tlDragging) scrubFromEvent(event);
    });
    const end = (event) => {
      this.tlDragging = false;
      if (this.tlTrack.releasePointerCapture) {
        try { this.tlTrack.releasePointerCapture(event.pointerId); } catch (_e) { /* already released */ }
      }
    };
    this.tlTrack.addEventListener('pointerup', end);
    this.tlTrack.addEventListener('pointercancel', end);
    this.tlTrack.addEventListener('lostpointercapture', () => { this.tlDragging = false; });

    this.tlTrack.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.stopPropagation();
        return;
      }
      if (!this.timelineAvailable()) return;
      const count = this.timeline.length;
      let index = this.timelineIndex === null ? count - 1 : this.timelineIndex;
      if (event.key === 'ArrowLeft') index -= 1;
      else if (event.key === 'ArrowRight') index += 1;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = count - 1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      this.scrubTo(Math.max(0, Math.min(count - 1, index)));
    });
  }

  _buildGhostButtons() {
    this.solverButton = this._button('SOLVER', 'lab-ghost lab-solver-btn', this.root,
      () => this.openSolver(), { ariaLabel: 'Open the solver model and equations' });
    this.backButton = this._button('BACK TO MENU', 'lab-ghost lab-back-btn', this.root,
      () => this.app.goToMenu(), { ariaLabel: 'Return to the main menu' });
    this.backButton.dataset.role = 'back';
  }

  _buildDrawer() {
    this.drawerBackdrop = div('lab-drawer-backdrop', this.root);
    this.drawerBackdrop.addEventListener('click', () => this._closeDrawer());
  }

  _syncDrawerA11y() {
    if (!this.sidebar || !this.drawerToggle) return;
    const mobile = this._mobileQuery ? this._mobileQuery.matches : false;
    const open = this.root.classList.contains('drawer-open');
    const hidden = mobile && !open;
    if (hidden && this.sidebar.contains(document.activeElement)) {
      this.root.focus({ preventScroll: true });
    }
    this.sidebar.inert = hidden;
    this.sidebar.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    // While the mobile drawer is open, the rest of the stage sits behind the
    // backdrop; keep those controls out of the keyboard order too.
    const trap = mobile && open;
    for (const node of [this.tlPanel, this.solverButton, this.backButton, this.drawerToggle]) {
      if (node) node.inert = trap;
    }
    this.drawerToggle.setAttribute('aria-expanded', String(open));
    this.drawerToggle.setAttribute('aria-label',
      open ? 'Close the calculator drawer' : 'Open the calculator drawer');
  }

  _toggleDrawer(force) {
    const open = force === undefined
      ? !this.root.classList.contains('drawer-open')
      : !!force;
    this.root.classList.toggle('drawer-open', open);
    this._syncDrawerA11y();
    if (open) {
      this.app.play('menu_move');
      window.setTimeout(() => {
        if (this.root.classList.contains('drawer-open')) {
          this.drawerClose.focus({ preventScroll: true });
        }
      }, 0);
    }
  }

  _closeDrawer(focusToggle = true) {
    if (!this.root.classList.contains('drawer-open')) return;
    this.root.classList.remove('drawer-open');
    // Sync first: it moves focus to the root if it was inside the drawer and
    // clears the toggle's inert state, so the toggle can receive focus next.
    this._syncDrawerA11y();
    if (focusToggle && this.drawerToggle) {
      this.drawerToggle.focus({ preventScroll: true });
    }
  }

  // ==== Solver model modal ================================================
  _buildSolverModal() {
    this.modalBackdrop = div('lab-modal-backdrop', this.root);
    this.modal = div('lab-modal', this.modalBackdrop);
    this.modal.setAttribute('role', 'dialog');
    this.modal.setAttribute('aria-modal', 'true');
    this.modal.setAttribute('aria-labelledby', 'lab-modal-title');
    this.modal.setAttribute('aria-describedby', 'lab-modal-sub');
    this.modal.setAttribute('tabindex', '-1');

    this.modalBackdrop.addEventListener('click', (event) => {
      if (event.target === this.modalBackdrop) this.closeSolver();
    });
    this.modal.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...this.modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((node) => !node.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    const head = div('lab-modal-head', this.modal);
    const headText = div('', head);
    el('div', 'lab-modal-eyebrow', headText, 'SOLVER MODEL');
    const title = el('h2', 'lab-modal-title', headText, 'Equations & assumptions');
    title.id = 'lab-modal-title';
    this.modalSub = el('div', 'lab-modal-sub', headText, '');
    this.modalSub.id = 'lab-modal-sub';
    this.modalClose = el('button', 'lab-modal-close', head, '×');
    this.modalClose.type = 'button';
    this.modalClose.setAttribute('aria-label', 'Close solver model');
    this.modalClose.addEventListener('click', (event) => {
      event.stopPropagation();
      this.closeSolver();
    });

    const body = div('lab-modal-body', this.modal);
    body.tabIndex = 0;
    body.setAttribute('aria-label', 'Solver equations and assumptions');
    body.addEventListener('keydown', (event) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
        event.stopPropagation();
      }
    });
    const left = div('', body);
    el('div', 'lab-modal-heading', left, 'EQUATIONS USED');
    for (const eq of equationSheet()) this._buildEquationItem(left, eq);

    const right = div('', body);
    el('div', 'lab-modal-heading', right, 'CONSTANTS');
    this.modalConstants = div('', right);
    el('div', 'lab-modal-heading', right, 'ASSUMPTIONS').style.marginTop = '12px';
    for (const text of ASSUMPTIONS) {
      const item = el('p', 'lab-assumption', right, text);
      item.style.margin = '0 0 5px';
    }

    const foot = div('lab-modal-foot', this.modal);
    this.modalResolve = el('button', 'lab-modal-btn', foot, 'RE-SOLVE NOW');
    this.modalResolve.type = 'button';
    this.modalResolve.addEventListener('click', () => {
      this._solveNow();
      this._renderModal();
      this.app.play('menu_move');
    });
    const close = el('button', 'lab-modal-btn', foot, 'CLOSE');
    close.type = 'button';
    close.addEventListener('click', () => this.closeSolver());
  }

  _buildEquationItem(parent, eq) {
    const item = div('lab-eq', parent);
    el('div', 'lab-eq-name', item, eq.name);
    el('div', 'lab-eq-formula', item, eq.formula);
    el('div', 'lab-eq-note', item, eq.note);
    const solves = el('div', 'lab-eq-solves', item, `Solves for: ${eq.solves}`);
    solves.title = 'Any of these variables can be the unknown in this equation.';
  }

  openSolver() {
    this._closeDrawer();
    this.solverOpen = true;
    this.modalBackdrop.classList.add('open');
    this._renderModal();
    this.app.play('menu_move');
    window.setTimeout(() => {
      if (this.solverOpen && this.modalClose) this.modalClose.focus();
    }, 0);
  }

  closeSolver() {
    if (!this.solverOpen) return;
    this.solverOpen = false;
    this.modalBackdrop.classList.remove('open');
    if (this.solverButton) this.solverButton.focus();
  }

  _renderModal() {
    if (!this.solution) return;
    const status = this.solution.status.toUpperCase();
    this.modalSub.textContent = this.solution.message
      ? `${status} · ${this.solution.message}`
      : `${status} · ${this.solution.knownCount} known · ${this.solution.solvedCount} solved · full precision kept internally`;

    this.modalConstants.innerHTML = '';
    for (const field of CONST_FIELDS) {
      const state = this.solution.conflictKeys.has(field.key)
        ? 'conflict' : this.solution.sources[field.key];
      const value = this.solution.values[field.key];
      const row = div('lab-modal-const', this.modalConstants);
      row.dataset.state = state;
      el('span', 'lab-modal-const-sym', row, field.symbol);
      const unit = field.unit ? ` ${field.unit}` : '';
      el('span', 'lab-modal-const-val', row,
        Number.isFinite(value) ? `${fmt(value)}${unit}` : '—');
      el('span', 'lab-modal-const-state', row, state);
    }
  }

  // ==== Input plumbing ====================================================
  _onInput(key, input) {
    if (input.validity && input.validity.badInput) return;
    const raw = input.value;
    if (raw.trim() === '') {
      delete this.given[key];
      this._setRowState(key, 'missing');
      this._scheduleSolve();
      return;
    }
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) return;
    this.given[key] = value;
    this._setRowState(key, 'known');
    this._scheduleSolve();
  }

  _commitInput(key, input) {
    if (input.validity && input.validity.badInput) {
      const last = this._lastCommitted[key];
      if (Number.isFinite(last)) {
        this.given[key] = last;
        input.value = fmt(last);
      } else {
        delete this.given[key];
        input.value = '';
      }
      this._setRowState(key, Number.isFinite(last) ? 'known' : 'missing');
      return;
    }
    const raw = input.value.trim();
    if (raw === '') {
      delete this.given[key];
      this._setRowState(key, 'missing');
      return;
    }
    const value = input.valueAsNumber;
    if (Number.isFinite(value)) {
      this.given[key] = value;
      input.value = fmt(value);
      this._lastCommitted[key] = value;
      this._setRowState(key, 'known');
    }
  }

  _clearField(key) {
    if (!this._editable()) return;
    delete this.given[key];
    this._lastCommitted[key] = null;
    const row = this.rows[key];
    if (row) row.input.value = '';
    this._solveNow();
    if (row) row.input.focus();
    this.app.play('menu_move');
  }

  _setRowState(key, state, value = null) {
    const row = this.rows[key];
    if (!row) return;
    row.row.dataset.state = state;
    if (row.badge) row.badge.textContent = BADGE_TEXT[state] || 'BLANK';
    const fullLabel = `${row.field.messageLabel}${row.field.unit ? `, in ${row.field.unit}` : ''}`;
    const autoNote = state === 'auto' && Number.isFinite(value)
      ? `, auto value ${fmt(value)}${row.field.unit ? ` ${row.field.unit}` : ''}`
      : '';
    row.input.setAttribute('aria-label', `${fullLabel}, state ${state}${autoNote}`);
  }

  _scheduleSolve() {
    if (this._solveTimer) window.clearTimeout(this._solveTimer);
    this._solveTimer = window.setTimeout(() => {
      this._solveTimer = null;
      this._solve();
    }, DEBOUNCE_MS);
  }

  _solveNow() {
    if (this._solveTimer) {
      window.clearTimeout(this._solveTimer);
      this._solveTimer = null;
    }
    this._solve();
  }

  _solve() {
    this.solution = solveSystem(this.given);

    if (this.solution.ok) {
      const values = this.solution.values;
      this.setup = {
        speed: values.speed,
        lateral: values.start,
        angle: values.aim,
        spin: values.hook,
      };
      this.deceleration = values.accel;
      this._releaseSpeed = values.speed;
      if (this.state === 'idle' && this.app.game && this.app.game.ball) {
        const ball = this.app.game.ball;
        ball.reset(this.setup.lateral);
        ball.physics.friction_scale = decelerationToScale(this.deceleration);
        ball.visible = true;
        ball.shadow.visible = true;
      }
    }

    this._renderSolution();
    this.syncControls();
    if (this.solverOpen) this._renderModal();
  }

  _renderSolution() {
    if (!this.solution) return;
    const solution = this.solution;
    const status = solution.status;

    this.statusPill.dataset.state = status;
    this.statusPill.textContent = status === 'solved'
      ? 'SOLVED'
      : status === 'conflict' ? 'CONFLICT' : 'UNDERDETERMINED';
    this.statusPill.title = solution.message || `${solution.knownCount} known, ${solution.solvedCount} solved`;

    if (status === 'solved') {
      this.note.textContent = '';
      this.note.dataset.state = '';
    } else {
      this.note.textContent = solution.message;
      this.note.dataset.state = status === 'conflict' ? 'conflict' : 'underdetermined';
    }

    const editable = this._editable();
    for (const [key, row] of Object.entries(this.rows)) {
      const source = solution.sources[key];
      const value = solution.values[key];
      let state = 'missing';
      if (solution.conflictKeys.has(key) && Number.isFinite(value)) state = 'conflict';
      else if (source === 'known') state = 'known';
      else if (source === 'solved') state = 'solved';
      else if (source === 'auto') state = 'auto';

      this._setRowState(key, state, value);
      const input = row.input;
      input.disabled = !editable;
      input.setAttribute('aria-invalid', state === 'conflict' ? 'true' : 'false');
      const unit = row.field.unit ? ` ${row.field.unit}` : '';
      const autoNote = state === 'auto' && Number.isFinite(value)
        ? ` Auto value: ${fmt(value)}${unit}.` : '';
      input.title = `${row.field.help} State: ${state}.${autoNote}`;

      if (document.activeElement !== input) {
        if (state === 'auto') {
          input.value = '';
          input.placeholder = 'auto';
        } else if (Number.isFinite(value)) {
          input.value = fmt(value);
          input.placeholder = 'auto';
        } else {
          input.value = '';
          input.placeholder = 'auto';
        }
        this._lastCommitted[key] = Number.isFinite(value) ? value : null;
      }
      row.clear.disabled = !editable;
    }

    this._renderWork();
    this._updatePins();
  }

  _renderWork() {
    const solution = this.solution;
    const previousScroll = this.workList.scrollTop;
    this.workList.innerHTML = '';

    const addItem = (kind, head, equation, calc, note = '') => {
      const item = div('lab-work-item', this.workList);
      item.dataset.kind = kind;
      const headEl = div('lab-work-head', item);
      el('span', '', headEl, head);
      if (equation) el('span', 'lab-work-equation', headEl, equation);
      if (calc) el('div', 'lab-work-calc', item, calc);
      if (note) el('div', 'lab-work-note', item, note);
      return item;
    };

    if (solution.status === 'conflict') {
      addItem('conflict', 'CONFLICT', '', solution.message,
        'Clear one of the red fields or a constant and the solver will re-balance.');
    } else if (solution.status === 'underdetermined') {
      addItem('missing', 'UNDERDETERMINED', '', solution.message,
        'Any highlighted blank field can be the next input. Constants can be cleared and solved too.');
    }

    const sorted = [...solution.work].sort((a, b) => {
      const orderA = WORK_ORDER[a.key] === undefined ? 99 : WORK_ORDER[a.key];
      const orderB = WORK_ORDER[b.key] === undefined ? 99 : WORK_ORDER[b.key];
      return orderA - orderB;
    });

    for (const entry of sorted) {
      const unit = entry.unit ? ` ${entry.unit}` : '';
      const calc = `${entry.symbol} = ${entry.expr} = ${entry.sub} = ${fmt(entry.value)}${unit}`;
      addItem('step', entry.label, entry.equation, calc, entry.note || '');
    }

    const autoDirect = VAR_FIELDS.filter((field) => (
      ['start', 'aim', 'hook'].includes(field.key)
      && solution.sources[field.key] === 'auto'
      && Number.isFinite(solution.values[field.key])
    ));
    if (autoDirect.length) {
      const parts = autoDirect.map((field) => (
        `${field.symbol} = ${fmt(solution.values[field.key])}${field.unit ? ` ${field.unit}` : ''}`
      ));
      addItem('model', 'DIRECT INPUTS', 'launch defaults', parts.join(' · '),
        'Blank Start X, Aim or Hook use the documented direct-input defaults; type a value to lock it.');
    }

    if (solution.hook) {
      const hook = solution.hook;
      const kNote = solution.sources.hookK === 'auto'
        ? 'k was blank, so the documented default is used. '
        : '';
      addItem('model', 'HOOK MODEL', 'a_lat = k·hook',
        `a_lat = ${fmt(hook.k)}·(${fmt(hook.hook)}) = ${fmt(hook.lateralAccel)} m/s²`,
        `${kNote}${HOOK_MODEL_DESCRIPTION} Positive hook curves the ball right. This is a display model, not a retuning of the 3D lane.`);
    }

    if (!solution.work.length && solution.status === 'solved') {
      const hint = el('div', 'lab-work-hint', this.workList,
        'All values are known, so no equation needs to be rearranged. Clear a field (or a constant) to watch the solver work.');
      hint.style.paddingLeft = '8px';
    }

    const count = solution.work.length;
    this.workCount.textContent = `${count} step${count === 1 ? '' : 's'}${count > 2 ? ' · scroll' : ''}`;
    this.workList.scrollTop = previousScroll;
  }

  // ==== Lifecycle =========================================================
  onShow(kwargs = {}) {
    this.app.stage.classList.add('lab-active');
    this.app.setCameraView('game');
    setShadowFocus(0.0, 9.0, 10.4);
    this.closeSolver();
    this._closeDrawer();
    this._syncDrawerA11y();
    this.given = { ...INITIAL_TYPED };
    if (kwargs.throw) {
      const throwData = kwargs.throw;
      if (Number.isFinite(throwData.lateral_position)) this.given.start = throwData.lateral_position;
      if (Number.isFinite(throwData.launch_angle)) {
        this.given.aim = throwData.launch_angle * 180 / Math.PI;
      }
      if (Number.isFinite(throwData.spin_omega)) this.given.hook = throwData.spin_omega;
      if (Number.isFinite(throwData.speed)) this.given.speed = throwData.speed;
    }
    this._controlsKey = '';
    this._solveNow();
    this._begin();
    // Entry focus belongs to the new screen, not to a menu control that has
    // just been hidden. It is a plain container focus, so no keyboard opens.
    this.root.focus({ preventScroll: true });
  }

  hide() {
    // Close transient UI while the screen is still visible, so focus can move
    // out of the drawer/modal before the root is hidden.
    this._closeDrawer(false);
    this.closeSolver();
    super.hide();
    this.app.stage.classList.remove('lab-active');
    if (this._solveTimer) {
      window.clearTimeout(this._solveTimer);
      this._solveTimer = null;
    }
    const game = this.app.game;
    const deck = game.pins.deck;
    deck.substep_listener = null;
    deck.record_trajectory = false;
    deck.trajectory = [];
    game.pins.reset();
    game.ball.physics.friction_scale = 1.0;
    fovReset();
    this.paused = false;
    this.tlDragging = false;
    this.timeline.clear();
    this.timelineIndex = null;
  }

  _editable() {
    return this.state === 'idle' || this.state === 'done';
  }

  _begin() {
    const game = this.app.game;
    const deck = game.pins.deck;
    deck.substep_listener = null;
    deck.record_trajectory = false;
    deck.trajectory = [];
    game.pins.reset();
    game.ball.reset(this.setup.lateral);
    game.ball.physics.friction_scale = decelerationToScale(this.deceleration);
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
    this._releaseSpeed = this.setup.speed;
    this.timeline.clear();
    this.timelineIndex = null;
    this.tlDragging = false;
    this.banner.textContent = '';
    this.banner.dataset.kind = '';
    if (this.solution && !this.solution.ok) this.status(this.solution.message, true);
    else this.status('ready — press BOWL to start the run');
    this._controlsKey = '';
    this.syncControls();
    this._renderSolution();
    this._updateTimelineUi();
  }

  // ==== Run ===============================================================
  bowl() {
    if (['rolling', 'settling'].includes(this.state) && !this.paused) return;
    this._solveNow();
    if (!this.solution || !this.solution.ok) {
      this.status(`cannot bowl: ${this.solution ? this.solution.message : 'no solution'}`, true);
      this.app.play('menu_back');
      return;
    }

    const values = this.solution.values;
    this.setup = {
      speed: values.speed,
      lateral: values.start,
      angle: values.aim,
      spin: values.hook,
    };
    this.deceleration = values.accel;

    this._begin();
    const game = this.app.game;
    game.pins.beginRoll();
    const throwData = {
      lateral_position: this.setup.lateral,
      launch_angle: this.setup.angle * Math.PI / 180,
      speed: this.setup.speed,
      spin_omega: this.setup.spin,
      source: 'script',
      confidence: 1.0,
    };
    game.ball.physics.friction_scale = decelerationToScale(this.deceleration);
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
    this.status('rolling — pause or drag the timeline any time');
    this.syncControls();
    this.app.play('release');
  }

  reset() {
    this._solveNow();
    this._begin();
    this.app.play('menu_move');
  }

  clearGiven() {
    if (!this._editable()) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      document.activeElement.blur();
    }
    this.given = { ...CONSTANT_DEFAULTS };
    this._solveNow();
    this._begin();
    this.status('variables cleared — constants kept; add one motion value');
    this.app.play('menu_move');
  }

  pause() {
    if (!this._pauseAvailable()) return;
    this.paused = true;
    this.status('paused — drag the timeline to inspect a moment');
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
      this.banner.dataset.kind = '';
      if (deck.record_trajectory) deck.trajectory.length = this.timelineIndex;
      if (deck.ball.rolling) {
        this.state = 'rolling';
      } else {
        this.state = 'settling';
        this._settleElapsed = 0.0;
        this._timer = game.pins.deckQuiet() ? 0.05 : config.SETTLE_DELAY;
      }
      this._hit = deck.first_contact_time !== null;
    }
    this.paused = false;
    this.status(this.state === 'rolling' ? 'rolling' : 'settling — the pins are still falling');
    this.syncControls();
  }

  togglePause() {
    if (this.paused) this.resume();
    else this.pause();
  }

  _pauseAvailable() {
    if (!this.timeline.length) return false;
    return this.paused || ['rolling', 'settling'].includes(this.state);
  }

  timelineAvailable() {
    return !!this.timeline.length;
  }

  scrubTo(index) {
    if (!this.timelineAvailable()) return;
    const game = this.app.game;
    const deck = game.pins.deck;
    index = this.timeline.restore(deck, index);
    this.timelineIndex = index;
    this.paused = true;
    game.ball.finished = deck.ball_done;
    if (deck.first_contact_time !== null) fovPushIn();
    else fovReset();
    this._updateTimelineUi();
    this._updatePins();
    this.syncControls();
    this.status('paused — drag the timeline to inspect a moment');
  }

  status(text, warn = false) {
    const message = String(text || '');
    if (this.tlStatus.textContent !== message) this.tlStatus.textContent = message;
    this.tlStatus.title = message;
    this.tlStatus.style.color = warn ? '#ff9cc2' : '#b9b6d6';
  }

  syncControls() {
    if (!this.solution || !this.pauseButton) return;
    const moving = ['rolling', 'settling'].includes(this.state) && !this.paused;
    const editable = this._editable();
    const bowlLabel = moving ? 'ROLLING…' : (this.timeline.length ? 'BOWL AGAIN' : 'BOWL');
    const bowlDisabled = moving || !this.solution.ok;
    const pauseAvailable = this._pauseAvailable();
    const key = [this.state, this.paused, bowlLabel, bowlDisabled,
      pauseAvailable, editable, this.solution.status, this.solution.message].join('|');
    if (key === this._controlsKey) return;
    this._controlsKey = key;

    this.bowlButton.textContent = bowlLabel;
    this.bowlButton.disabled = bowlDisabled;
    this.bowlButton.setAttribute('aria-disabled', String(bowlDisabled));
    this.bowlButton.title = bowlDisabled && !moving
      ? (this.solution.message || 'Solve the launch before bowling')
      : 'Run the solved launch on the 3D lane';

    this.pauseButton.textContent = this.paused ? 'RESUME' : 'PAUSE';
    this.pauseButton.disabled = !pauseAvailable;
    this.pauseButton.setAttribute('aria-disabled', String(!pauseAvailable));

    this.resetButton.disabled = false;
    this.clearButton.disabled = !editable;
    this.clearButton.setAttribute('aria-disabled', String(!editable));

    for (const row of Object.values(this.rows)) {
      row.input.disabled = !editable;
      row.clear.disabled = !editable;
    }

    this.tlTrack.setAttribute('aria-disabled', String(!this.timelineAvailable()));
  }

  // ==== Per-frame =========================================================
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

    if (this.state !== 'idle') {
      this._updateTimelineUi();
      this._updatePins();
      this.syncControls();
    }
  }

  _advanceRolling(dt) {
    const game = this.app.game;
    game.pins.advance(game.ball, dt);
    this._frames += 1;
    const deck = game.pins.deck;
    if (!this._hit && deck.first_contact_time !== null) {
      this._hit = true;
      this.app.play('pin');
      fovPushIn();
    }
    if (game.ball.finished || deck.ball_done) {
      this.state = 'settling';
      this._settleElapsed = 0.0;
      this._timer = config.SETTLE_DELAY;
      this._controlsKey = '';
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
    if (this._timer <= 0.0
        && (game.pins.deckQuiet() || this._settleElapsed >= config.SETTLE_MAX_TIME)) {
      this._resolve();
    }
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
    if (pins >= 10) {
      this.banner.textContent = 'STRIKE — 10 PINS';
      this.banner.dataset.kind = 'strike';
      this.app.play('strike');
    } else if (pins <= 0) {
      this.banner.textContent = 'GUTTER — 0 PINS';
      this.banner.dataset.kind = 'gutter';
      this.app.play('gutter');
    } else {
      this.banner.textContent = `${pins} PIN${pins === 1 ? '' : 'S'}`;
      this.banner.dataset.kind = '';
      this.app.play('pin');
    }
    this.state = 'done';
    this.paused = false;
    this.timelineIndex = this.timeline.length - 1;
    this.status('run complete — drag the timeline or bowl again');
    this._controlsKey = '';
    this.syncControls();
    this._updateTimelineUi();
    this._updatePins();
  }

  _updatePins() {
    if (!this.tlPins) return;
    const deck = this.app.game.pins.deck;
    let count = null;
    if (this.state === 'idle') count = null;
    else if (this.paused) count = deck.knockdownCount();
    else if (this.state === 'done' && this.result) count = this.result.knockdowns;
    else count = deck.knockdownCount();

    const text = count === null ? '--' : String(count);
    if (this.tlPins.textContent !== text) this.tlPins.textContent = text;
    const kind = count === 10 ? 'strike' : (count === 0 && this.state === 'done' ? 'gutter' : '');
    if (this.tlPins.dataset.kind !== kind) this.tlPins.dataset.kind = kind;
  }

  _setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  _updateTimelineUi() {
    if (!this.solution) return;
    const game = this.app.game;
    if (!game || !game.ball) return;
    const deck = game.pins.deck;
    const total = this.timeline.duration();
    const currentRaw = Number.isFinite(deck.elapsed) ? deck.elapsed : 0.0;
    const current = Math.max(0, Math.min(currentRaw, total > 0 ? total : currentRaw));
    const fraction = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;

    this.tlFill.style.width = `${(fraction * 100).toFixed(2)}%`;
    this.tlThumb.style.left = `${(fraction * 100).toFixed(2)}%`;
    this._setText(this.tlTime, `t = ${current.toFixed(4)} s / ${total.toFixed(4)} s`);
    this.tlTrack.setAttribute('aria-valuemax', total > 0 ? total.toFixed(4) : '0');
    this.tlTrack.setAttribute('aria-valuenow', current.toFixed(4));
    this.tlTrack.setAttribute('aria-valuetext', total > 0
      ? `${current.toFixed(2)} of ${total.toFixed(2)} seconds`
      : 'no run recorded');

    const physics = game.ball.physics;
    this._setText(this.tlPos, `${(physics.z || 0).toFixed(3)} m`);
    this._setText(this.tlVel, `${(physics.speed || 0).toFixed(3)} m/s`);
    this._setText(this.tlSpin, `${(physics.spin_omega || 0).toFixed(2)} rad/s`);
  }

  // ==== Keyboard ==========================================================
  onKey(key) {
    const active = document.activeElement;
    if (active && active.tagName === 'BUTTON' && (key === 'space' || key === 'enter')) {
      active.click();
      return true;
    }
    if (this.solverOpen) {
      if (key === 'escape') this.closeSolver();
      return true;
    }
    if (this.root.classList.contains('drawer-open') && key === 'escape') {
      this._closeDrawer();
      return true;
    }
    if (key === 'escape' || key === 'b') { this.app.goToMenu(); return true; }
    if (key === 'r') { this.reset(); return true; }
    if (key === 'p') { this.togglePause(); return true; }
    if (key === 'space' || key === 'enter') { this.bowl(); return true; }
    return false;
  }
}
