// The Physics Lab: a multi-mode simulator and calculator docked beside the
// real 3D lane.
//
// Bowling keeps the existing rotational solver and the real rigid-body run.
// Free Fall, Straight Line and Journey share lab_suvat.js, a constant
// acceleration solver, and lab_scene.js, their 2D scene renderer. Each mode is
// a config object in lab_modes.js; the sidebar reads that config and the
// solver never branches on a mode id.
//
// The sidebar is a calculator, not an input/output table. Rows are added on
// demand; a blank row is the unknown, a typed row is a fixed value, and the
// solver fills in the rest. Constants live in a collapsed Settings section and
// always have a value, so they are settings rather than unknowns.
//
// BOWL launches the real rigid-body simulation with the solved launch values;
// the timeline is a recording of that run, not a second analytical model. RUN
// plays the 2D mode's analytical scene against the same timeline bar.
import * as config from '../config.js';
import { DeckTimeline, RollResult } from '../physics.js';
import { fovPushIn, fovReset, updateCamera } from '../scene/camera.js';
import { setShadowFocus } from '../scene/shadow.js';
import { div, el } from './dom.js';
import { Screen } from './screens.js';
import { decelerationToScale } from './lab_model.js';
import {
  CONST_FIELDS, VAR_FIELDS, FIELD_BY_KEY,
  CONSTANT_DEFAULTS, fmt,
} from './lab_solver.js';
import {
  MODES, MODE_BY_ID, DEFAULT_MODE, newModeState, variablesFor,
  LABS, LAB_BY_ID, LINEAR_MODES,
} from './lab_modes.js';
import {
  solveJourney, runLabValidation, JOURNEY_RESULTS, SUVAT_META,
} from './lab_suvat.js';
import { solveBowling } from './lab_bowling.js';
import { solveLinear, addLinearExtras } from './lab_linear.js';
import { solveProjectile } from './lab_projectile.js';
import { solveRotational } from './lab_rotational.js';
import { solveTorque } from './lab_torque.js';
import { solveInertia, SHAPES } from './lab_inertia.js';
import { guidance } from './lab_engine.js';
import { runNewLabValidation } from './lab_validation.js';
import { LabScene } from './lab_scene.js';

const LAB_DESCRIPTIONS = {
  bowling: 'Roll a ball down the lane',
  linear: 'Falling, braking and journeys',
  projectile: 'Throws, kicks and launches',
  rotational: 'Spinning wheels and fans',
  torque: 'Twisting forces and balance',
  inertia: 'Spin, shape and angular momentum',
};

const LAB_ICONS = {
  bowling: 'bowl',
  linear: 'falling',
  projectile: 'arc',
  rotational: 'wheel',
  torque: 'torque',
  inertia: 'inertia',
};

const DEBOUNCE_MS = 200;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

const ICONS = {
  grid: '<rect x="4" y="4" width="6" height="6" rx="1.4"/><rect x="14" y="4" width="6" height="6" rx="1.4"/><rect x="4" y="14" width="6" height="6" rx="1.4"/><rect x="14" y="14" width="6" height="6" rx="1.4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  check: '<path d="M5 12.5l4.4 4.4L19 7.2"/>',
  play: '<path d="M8 5.5l10 6.5-10 6.5z"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  skipBack: '<path d="M6 6v12"/><path d="M18 6l-8 6 8 6z"/>',
  skipForward: '<path d="M18 6v12"/><path d="M6 6l8 6-8 6z"/>',
  ellipsis: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  search: '<circle cx="11" cy="11" r="6.2"/><path d="M16 16l4 4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  falling: '<path d="M12 4v13"/><path d="M7 12l5 5 5-5"/><path d="M5 21h14"/>',
  arc: '<path d="M4 20C4 10 10 5 20 5"/><circle cx="20" cy="5" r="1.8"/><path d="M4 20h16"/>',
  wheel: '<circle cx="12" cy="12" r="7"/><path d="M12 5v7l5 3"/><path d="M3 20h18"/>',
  torque: '<path d="M5 18a10 10 0 0 1 14 0"/><path d="M19 18l-2.4-1.2M19 18l1.2-2.4"/><circle cx="5" cy="18" r="1.6"/>',
  inertia: '<circle cx="12" cy="12" r="6"/><path d="M12 6v6l4 2"/><path d="M19 5l1 1M20 11h-1M18 18l-1-1"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3-1-6z"/><path d="M12 13v7"/>',
  bowl: '<circle cx="12" cy="15" r="4.2"/><path d="M8 7l1.5 3M12 5v5M16 7l-1.5 3"/><path d="M4 20h16"/>',
};

function iconSvg(name, size = 20) {
  return `<svg class="lab-icon" width="${size}" height="${size}" viewBox="0 0 24 24" `
    + 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" '
    + `stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.grid}</svg>`;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function symbolHtml(symbol) {
  const text = String(symbol || '');
  if (!text) return '';
  if (text.includes('_')) {
    const index = text.indexOf('_');
    return `${escapeHtml(text.slice(0, index))}<sub>${escapeHtml(text.slice(index + 1))}</sub>`;
  }
  const match = text.match(/^(.*?)(\d+)$/);
  if (match && match[1]) {
    return `${escapeHtml(match[1])}<sub>${escapeHtml(match[2])}</sub>`;
  }
  return escapeHtml(text);
}

const VAR_NAMES = {
  start: 'Start X',
  aim: 'Aim',
  hook: 'Hook',
  speed: 'Speed',
  time: 'Time',
  accel: 'Accel',
  sideways: 'Sideways',
  momentum: 'Momentum',
  energy: 'Energy',
};

const CONST_NAMES = {
  mass: 'Ball mass (kg)',
  mu: 'Lane friction (μ)',
  gravity: 'Gravity (m/s²)',
  length: 'Lane length (m)',
  hookK: 'Hook strength',
};

const LAUNCH_KEYS = ['speed', 'start', 'aim', 'hook', 'accel'];

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
      if (event.key === 'Escape' && this._closeTopLayer()) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.root.focus({ preventScroll: true });
    });

    this.modeId = DEFAULT_MODE;
    this.labId = 'bowling';
    this.linearModeId = 'freefall';
    this.modeStore = Object.fromEntries(MODES.map((mode) => [mode.id, newModeState(mode)]));
    this.given = this.modeStore.bowling.given;
    this.rowKeys = this.modeStore.bowling.rowKeys;
    this.openFormulas = this.modeStore.bowling.openFormulas;
    this._lastCommitted = this.modeStore.bowling.lastCommitted;
    this._lastEditedKey = this.modeStore.bowling.lastEditedKey;
    this._lastAddedKey = null;
    this._modeFields = variablesFor(MODE_BY_ID.bowling);
    this.constants = { ...CONSTANT_DEFAULTS };
    this.constantDirty = new Set();
    this.rows = {};
    this.constRows = {};
    this.journeyRows = [];
    this.forcesRows = [];
    this.showAllWork = false;
    this.settingsOpen = false;
    this.editMode = false;
    this.addSearchTerm = '';
    this.addOpen = false;
    this.examplesOpen = false;
    this.snapshotOpen = false;
    this.snapshotPinned = null;
    this.snapshotKeys = {};
    this.solution = null;
    this._conflictCache = null;
    this._reducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

    this.timeline = new DeckTimeline();
    this.timelineIndex = null;
    this.tlDragging = false;
    this.state = 'idle';
    this.paused = false;
    this.simTime = 0;
    this.simDuration = 0;
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
    this._lastCommitted = this.modeStore.bowling.lastCommitted;

    this._buildSidebar();
    this._buildTitle();
    this._buildTimeline();
    this._buildSceneCanvas();
    this._buildLabsLauncher();
    this._buildTimeline();
    this._buildSnapshot();
    this._buildGhostButtons();
    this._buildDrawer();

    this._mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 900px)') : null;
    if (this._mobileQuery) {
      this._mobileQueryListener = () => {
        this._syncDrawerA11y();
        this._resizeScene();
      };
      if (this._mobileQuery.addEventListener) {
        this._mobileQuery.addEventListener('change', this._mobileQueryListener);
      } else if (this._mobileQuery.addListener) {
        this._mobileQuery.addListener(this._mobileQueryListener);
      }
    }
    this._windowResizeListener = () => this._resizeScene();
    window.addEventListener('resize', this._windowResizeListener);
    this._syncDrawerA11y();
    this._syncLabUi();
    this._renderSettings();
    this._renderExamples();

    // A silent dev check. It is visible in the console but never blocks play.
    try {
      const checks = [...runLabValidation(), ...runNewLabValidation()];
      const failed = checks.filter((check) => !check.pass);
      if (failed.length) {
        console.warn('[Physics Lab] validation failures', failed);
      } else {
        console.info(`[Physics Lab] ${checks.length} validation checks passed.`);
      }
    } catch (error) {
      console.warn('[Physics Lab] validation could not run', error);
    }

    this._solveNow();
    this._updateTimelineUi();

    // Dev-only layout audit used by the verification pass.
    if (typeof window !== 'undefined') {
      window.__labLayoutCheck = () => this._layoutCheck();
    }
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

  _icon(name, size = 20) {
    const span = el('span', 'lab-icon-wrap');
    span.innerHTML = iconSvg(name, size);
    return span;
  }

  _buildSidebar() {
    this.sidebar = el('aside', 'lab-sidebar', this.root);
    this.sidebar.id = 'lab-sidebar';
    this.sidebar.setAttribute('aria-label', 'Physics calculator');
    this.sidebar.setAttribute('role', 'region');

    const head = div('lab-side-head', this.sidebar);
    this.sideTitle = el('div', 'lab-side-title', head, 'PHYSICS LAB');
    const headActions = div('lab-head-actions', head);
    this.examplesButton = el('button', 'lab-head-btn', headActions);
    this.examplesButton.type = 'button';
    this.examplesButton.innerHTML = iconSvg('list', 20);
    this.examplesButton.title = 'Examples';
    this.examplesButton.setAttribute('aria-label', 'Examples');
    this.examplesButton.setAttribute('aria-haspopup', 'dialog');
    this.examplesButton.setAttribute('aria-expanded', 'false');
    this.examplesButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.examplesButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this._toggleExamples();
    });
    this.settingsButton = el('button', 'lab-head-btn', headActions);
    this.settingsButton.type = 'button';
    this.settingsButton.innerHTML = iconSvg('gear', 20);
    this.settingsButton.title = 'Settings';
    this.settingsButton.setAttribute('aria-label', 'Settings');
    this.settingsButton.setAttribute('aria-haspopup', 'dialog');
    this.settingsButton.setAttribute('aria-expanded', 'false');
    this.settingsButton.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.settingsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this._openSettings();
    });
    this.drawerClose = el('button', 'lab-drawer-close', head);
    this.drawerClose.type = 'button';
    this.drawerClose.innerHTML = iconSvg('chevron', 18);
    this.drawerClose.setAttribute('aria-label', 'Close calculator');
    this.drawerClose.addEventListener('click', (event) => {
      event.stopPropagation();
      this._closeDrawer();
    });

    // Mode switcher: one full-width segmented control under the title.
    this.modeSwitcher = div('lab-mode-switch', this.sidebar);
    this.modeSwitcher.setAttribute('role', 'tablist');
    this.modeSwitcher.setAttribute('aria-label', 'Physics Lab mode');
    this.modeIndicator = div('lab-mode-indicator', this.modeSwitcher);
    this.modeIndicator.setAttribute('aria-hidden', 'true');
    this.modeTabs = {};
    for (const mode of MODES.filter((item) => LINEAR_MODES.includes(item.id))) {
      const tab = el('button', 'lab-mode-tab', this.modeSwitcher, mode.label);
      tab.type = 'button';
      tab.id = `lab-tab-${mode.id}`;
      tab.dataset.mode = mode.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'lab-mode-panel');
      tab.setAttribute('aria-selected', 'false');
      tab.tabIndex = -1;
      tab.addEventListener('pointerdown', (event) => event.stopPropagation());
      tab.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const ids = LINEAR_MODES;
        const index = ids.indexOf(this.modeId);
        let next = index;
        if (event.key === 'ArrowLeft') next = (index - 1 + ids.length) % ids.length;
        else if (event.key === 'ArrowRight') next = (index + 1) % ids.length;
        else if (event.key === 'Home') next = 0;
        else next = ids.length - 1;
        this._switchMode(ids[next]);
        this.modeTabs[ids[next]].focus({ preventScroll: true });
      });
      tab.addEventListener('click', (event) => {
        event.stopPropagation();
        this._switchMode(mode.id);
        this.app.play('menu_move');
      });
      this.modeTabs[mode.id] = tab;
    }

    // Kept as a compatibility hook for labs whose controls moved into rows.
    this.modeControls = div('lab-mode-controls', this.sidebar);
    this.modeControls.hidden = true;

    const vars = el('section', 'lab-vars', this.sidebar);
    vars.id = 'lab-mode-panel';
    vars.setAttribute('role', 'tabpanel');
    vars.setAttribute('aria-label', 'Values');
    this.valuesCard = div('lab-values-card', vars);
    const valuesHead = div('lab-values-head', this.valuesCard);
    el('span', 'lab-values-title', valuesHead, 'Values');
    this.editButton = el('button', 'lab-edit-btn', valuesHead, 'Edit');
    this.editButton.type = 'button';
    this.editButton.setAttribute('aria-pressed', 'false');
    this.editButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this._toggleEdit();
    });
    this.fieldList = div('lab-field-list', this.valuesCard);

    this.addWrap = div('lab-add-row-wrap', this.fieldList);
    this.addButton = this._button('Add value', 'lab-add lab-add-row', this.addWrap,
      () => this._toggleAddMenu(), { ariaLabel: 'Add value' });
    this.addButton.prepend(this._icon('plus', 18));

    this.calcStatus = div('lab-calc-status', this.sidebar);
    this.calcStatus.id = 'lab-calc-status';
    this.calcStatus.setAttribute('role', 'status');
    this.calcStatus.setAttribute('aria-live', 'polite');
    this.calcStatus.dataset.state = 'underdetermined';

    this.footer = div('lab-footer', this.sidebar);
    this.bowlButton = this._button('BOWL', 'lab-bowl', this.footer,
      () => this.bowl(), { ariaLabel: 'BOWL — bowl using the solved launch values' });
    const secondary = div('lab-secondary-row', this.footer);
    this.pauseButton = this._button('PAUSE', 'lab-secondary', secondary,
      () => this.togglePause(), { title: 'Pause or resume the run' });
    this.resetButton = this._button('RESET', 'lab-secondary', secondary,
      () => this.reset(), { title: 'Reset the scene to the start without changing values' });
    this.clearButton = this._button('CLEAR', 'lab-secondary', secondary,
      () => this.clearValues(), { title: 'Clear all variable values and keep the rows' });

    // Settings sheet.
    this.settingsSheet = div('lab-sheet-backdrop', this.root);
    this.settingsSheet.hidden = true;
    this.settingsSheet.setAttribute('role', 'dialog');
    this.settingsSheet.setAttribute('aria-modal', 'true');
    this.settingsSheet.setAttribute('aria-labelledby', 'lab-settings-title');
    const settingsPanel = div('lab-sheet lab-settings-sheet', this.settingsSheet);
    const settingsHead = div('lab-sheet-head', settingsPanel);
    const settingsTitle = el('h2', 'lab-sheet-title', settingsHead, 'Settings');
    settingsTitle.id = 'lab-settings-title';
    const settingsClose = el('button', 'lab-icon-btn', settingsHead);
    settingsClose.type = 'button';
    settingsClose.innerHTML = iconSvg('x', 20);
    settingsClose.setAttribute('aria-label', 'Close settings');
    settingsClose.addEventListener('click', () => this._closeSettings());
    this.settingsBody = div('lab-settings-body', settingsPanel);
    this.settingsBody.id = 'lab-settings-body';
    this.constList = div('lab-const-list', this.settingsBody);
    this.extraSettings = div('lab-extra-settings', this.settingsBody);
    const settingsFoot = div('lab-settings-foot', this.settingsBody);
    this.resetDefaultsButton = el('button', 'lab-sheet-action', settingsFoot, 'Reset to defaults');
    this.resetDefaultsButton.type = 'button';
    this.resetDefaultsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.resetConstants();
    });
    const showAll = el('label', 'lab-check', settingsFoot);
    this.showAllInput = el('input', '', showAll);
    this.showAllInput.type = 'checkbox';
    el('span', '', showAll, 'Show all work');
    this.showAllInput.addEventListener('change', () => {
      this.showAllWork = !!this.showAllInput.checked;
      this._renderSolution();
    });
    settingsClose.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
    this.settingsSheet.addEventListener('keydown', (event) => {
      this._sheetKeydown(event, this.settingsSheet, () => this._closeSettings(), this.settingsButton);
    });
    this.settingsSheet.addEventListener('pointerdown', (event) => {
      if (event.target === this.settingsSheet) this._closeSettings();
    });

    // Examples popover.
    this.examplesMenu = div('lab-popover lab-examples-popover', this.root);
    this.examplesMenu.hidden = true;
    this.examplesMenu.setAttribute('role', 'dialog');
    this.examplesMenu.setAttribute('aria-label', 'Examples');
    this.examplesMenu.addEventListener('keydown', (event) => {
      this._sheetKeydown(event, this.examplesMenu, () => this._closeExamples(), this.examplesButton);
    });

    // Add-value popover.
    this.addMenu = div('lab-popover lab-add-popover', this.root);
    this.addMenu.hidden = true;
    this.addMenu.setAttribute('role', 'dialog');
    this.addMenu.setAttribute('aria-label', 'Add a value');
    this.addMenu.addEventListener('keydown', (event) => {
      this._sheetKeydown(event, this.addMenu, () => this._closeAddMenu(), this.addButton);
    });

    // Unit popover.
    this.unitMenu = div('lab-popover lab-unit-popover', this.root);
    this.unitMenu.hidden = true;
    this.unitMenu.setAttribute('role', 'dialog');
    this.unitMenu.setAttribute('aria-label', 'Choose unit');
    this.unitMenu.addEventListener('keydown', (event) => {
      this._sheetKeydown(event, this.unitMenu, () => this._closeUnitMenu(), this._unitTrigger);
    });

    this.drawerToggle = this._button('Calculator', 'lab-ghost lab-drawer-toggle', this.root,
      () => this._toggleDrawer(), { ariaLabel: 'Open calculator' });
    this.drawerToggle.prepend(this._icon('chevron', 18));
    this.drawerToggle.setAttribute('aria-controls', 'lab-sidebar');
    this.drawerToggle.setAttribute('aria-expanded', 'false');

    this._documentPointerHandler = (event) => {
      if (this.addOpen && !this.addMenu.contains(event.target)
          && !this.addButton.contains(event.target)) this._closeAddMenu();
      if (this.examplesOpen && !this.examplesMenu.contains(event.target)
          && !this.examplesButton.contains(event.target)) this._closeExamples();
      if (this.unitMenuOpen && !this.unitMenu.contains(event.target)
          && !this._unitTrigger?.contains(event.target)) this._closeUnitMenu();
      if (this.pickerMenu && !this.pickerMenu.hidden
          && !this.pickerMenu.contains(event.target)
          && !this._pickerTrigger?.contains(event.target)) this.pickerMenu.hidden = true;
    };
    document.addEventListener('pointerdown', this._documentPointerHandler, true);

    this._renderRows();
  }

  _fieldFor(key) {
    const displayKey = this._rowKeyFor(key);
    const field = this._modeFields[displayKey];
    if (field) return field;
    const fallback = FIELD_BY_KEY[displayKey];
    if (fallback) {
      return {
        ...fallback,
        label: VAR_NAMES[displayKey] || fallback.label,
        decimals: 4,
        signed: fallback.min === undefined || fallback.min < 0,
      };
    }
    return {
      key: displayKey, label: displayKey, unit: '', symbol: displayKey, step: 1, decimals: 4, signed: true, help: '',
    };
  }

  _rowKeyFor(key) {
    if (this.modeId === 'freefall' && key === 's') return 'h';
    return key;
  }

  _unitFactor(key) {
    const row = this.rows[key];
    if (!row || !row.field.unitOptions || !row.field.unitOptions.length) return 1;
    const option = row.field.unitOptions[row.unitIndex || 0];
    return option && Number.isFinite(option.factor) ? option.factor : 1;
  }

  _displayNumber(key, value) {
    return value * this._unitFactor(key);
  }

  _baseNumber(key, displayValue) {
    const factor = this._unitFactor(key);
    return Math.abs(factor) > 1e-12 ? displayValue / factor : displayValue;
  }

  _buildFieldRow(parent, key) {
    const field = this._fieldFor(key);
    const wrap = div('lab-field', parent);
    wrap.dataset.key = key;
    wrap.dataset.state = 'missing';

    const main = div('lab-field-main', wrap);

    const label = el('label', 'lab-field-label', main);
    const name = el('span', 'lab-label-name', label, field.label);
    name.title = field.help || '';
    const sym = el('span', 'lab-label-symbol', label);
    sym.innerHTML = symbolHtml(field.symbol);
    const labelNote = el('span', 'lab-label-note', label);
    labelNote.hidden = true;
    const lock = el('span', 'lab-lock', label);
    lock.hidden = true;
    lock.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`;
    label.htmlFor = `lab-field-${key}`;
    label.title = field.help || '';

    const isSelect = field.type === 'select' && Array.isArray(field.options);
    const input = isSelect
      ? el('select', 'lab-field-input lab-select', main)
      : el('input', 'lab-field-input', main);
    input.id = `lab-field-${key}`;
    if (isSelect) {
      for (const option of field.options) {
        const labelText = typeof option === 'object' ? option.label : option;
        const value = typeof option === 'object' ? option.value : option;
        const node = el('option', '', input, labelText);
        node.value = String(value);
      }
    } else {
      input.type = 'number';
      input.step = String(field.step || 0.1);
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = '?';
    }
    input.setAttribute('aria-describedby', 'lab-calc-status');
    input.setAttribute('aria-label',
      `${field.label}${field.unit ? `, in ${field.unit}` : ''}`);
    input.title = field.help || '';
    input.dataset.key = key;

    const unit = field.unitOptions && field.unitOptions.length
      ? el('button', 'lab-field-unit lab-unit-toggle', main, field.unitOptions[0].unit)
      : el('span', 'lab-field-unit', main, field.unit || '');
    if (field.unitOptions && field.unitOptions.length) {
      unit.type = 'button';
      unit.title = 'Change the display unit for this row';
      unit.setAttribute('aria-label', `${field.unitOptions[0].unit} — change unit for ${field.label}`);
      unit.appendChild(this._icon('chevron', 14));
      unit.addEventListener('pointerdown', (event) => event.stopPropagation());
      unit.addEventListener('click', (event) => {
        event.stopPropagation();
        this._openUnitMenu(key, unit);
      });
    }

    const how = el('button', 'lab-how', main, 'How?');
    how.type = 'button';
    how.hidden = true;
    how.title = 'How was this calculated?';
    how.setAttribute('aria-label', `How was ${field.label} calculated?`);
    how.setAttribute('aria-expanded', 'false');
    how.setAttribute('aria-controls', `lab-formula-${key}`);
    how.addEventListener('pointerdown', (event) => event.stopPropagation());
    how.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    how.addEventListener('click', (event) => {
      event.stopPropagation();
      this._toggleFormula(key);
    });

    const remove = el('button', 'lab-remove', main);
    remove.type = 'button';
    remove.innerHTML = iconSvg('minus', 16);
    remove.hidden = true;
    remove.title = 'Remove this row';
    remove.setAttribute('aria-label', `Remove ${field.label}`);
    remove.addEventListener('pointerdown', (event) => event.stopPropagation());
    remove.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      this._removeRow(key);
    });

    const note = div('lab-field-note', wrap);
    note.hidden = true;

    const formula = div('lab-formula', wrap);
    formula.id = `lab-formula-${key}`;
    formula.setAttribute('role', 'note');
    formula.hidden = true;

    this.rows[key] = {
      wrap, main, label, input, unit, how, remove, formula, note, field, isSelect,
      unitIndex: 0, labelNote, lock,
    };

    if (isSelect) {
      this._bindSelectField(input, key);
    } else {
      this._bindInput(input, key);
    }
  }

  _bindSelectField(select, key) {
    select.addEventListener('pointerdown', (event) => event.stopPropagation());
    select.addEventListener('change', () => {
      this.given[key] = select.value;
      this._lastEditedKey = key;
      this._setRowState(key, 'known');
      this._scheduleSolve();
    });
    select.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        this.bowl();
      }
    });
  }

  _buildConstantRow(parent, field) {
    const row = div('lab-const', parent);
    row.dataset.key = field.key;
    row.dataset.state = 'default';

    const main = div('lab-field-main', row);
    const label = el('label', 'lab-field-label lab-const-label', main,
      CONST_NAMES[field.key] || field.label);
    label.htmlFor = `lab-const-${field.key}`;
    label.title = field.help;

    const input = el('input', 'lab-field-input lab-const-input', main);
    input.type = 'number';
    input.id = `lab-const-${field.key}`;
    input.step = String(field.step);
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = fmt(field.default);
    input.setAttribute('aria-label', CONST_NAMES[field.key] || field.label);
    input.setAttribute('aria-describedby', 'lab-calc-status');
    input.title = `${field.help} Leave blank to use ${fmt(field.default)}.`;
    input.dataset.key = field.key;

    // Units are already parenthesised in the plain-English labels. These two
    // columns keep the inputs aligned with the variable rows.
    el('span', 'lab-field-unit', main, '');
    el('span', 'lab-how', main, '');
    el('span', 'lab-remove', main, '');

    this.constRows[field.key] = { row, main, label, input, field };
    this._bindConstantInput(input, field.key);
  }

  _bindInput(input, key) {
    input.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      // A click on an already-focused calculated input must still unlock it:
      // focus alone will not fire twice for the same element. A value locked
      // by the mode (dropped u = 0, at-highest v = 0) never unlocks.
      if (input.readOnly && input.dataset.locked !== 'true') input.readOnly = false;
    });
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('focus', () => {
      this._lastCommitted[key] = Number.isFinite(this.given[key]) ? this.given[key] : null;
      input._labDirty = false;
      input._skipBlur = false;
      // A calculated value becomes editable only after the player activates
      // it. Until then it is a read-only answer.
      if (input.readOnly && input.dataset.locked !== 'true') input.readOnly = false;
      window.setTimeout(() => {
        if (document.activeElement === input) input.select();
      }, 0);
    });
    input.addEventListener('input', () => {
      if (input.validity && input.validity.badInput) return;
      input._labDirty = true;
      this._onInput(key, input);
    });
    input.addEventListener('change', () => {
      if (input._labDirty) this._commitInput(key, input);
    });
    input.addEventListener('blur', () => {
      if (input._skipBlur) {
        input._skipBlur = false;
        input._labDirty = false;
        return;
      }
      if (input._labDirty) this._commitInput(key, input);
      input._labDirty = false;
      this._solveNow();
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (this.editMode && input.value.trim() === '') {
          event.preventDefault();
          this._removeRow(key);
          return;
        }
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (input._labDirty) this._commitInput(key, input);
        input._labDirty = false;
        const index = this.rowKeys.indexOf(key);
        const nextKey = this.rowKeys[index + 1];
        const nextRow = nextKey ? this.rows[nextKey] : null;
        if (nextRow) {
          nextRow.input.focus({ preventScroll: true });
          if (nextRow.input.select) nextRow.input.select();
        } else {
          input.blur();
          this.bowl();
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        const last = this._lastCommitted[key];
        if (Number.isFinite(last)) this.given[key] = last;
        else delete this.given[key];
        input.value = Number.isFinite(last) ? fmt(this._displayNumber(key, last)) : '';
        input._skipBlur = true;
        input._labDirty = false;
        this._solveNow();
        input.blur();
      }
    });
  }

  _bindConstantInput(input, key) {
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('input', () => {
      if (input.validity && input.validity.badInput) return;
      const raw = input.value.trim();
      if (raw === '') {
        this.constantDirty.delete(key);
        this.constants[key] = CONSTANT_DEFAULTS[key];
      } else {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value)) return;
        this.constantDirty.add(key);
        this.constants[key] = value;
        this._lastEditedKey = key;
      }
      this._scheduleSolve();
    });
    input.addEventListener('blur', () => {
      if (input.value.trim() === '') {
        this.constantDirty.delete(key);
        this.constants[key] = CONSTANT_DEFAULTS[key];
      } else if (Number.isFinite(input.valueAsNumber)) {
        input.value = fmt(input.valueAsNumber);
      }
      this._solveNow();
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
        this.bowl();
      }
    });
  }

  _buildTitle() {
    const wrap = div('lab-title-wrap', this.root);
    this.titleWrap = wrap;
    this.titleNode = el('h1', 'lab-title', wrap, 'PHYSICS LAB');
    this.titleNode.setAttribute('aria-label', 'Physics Lab');

    this.banner = div('lab-banner', this.root);
    this.banner.setAttribute('role', 'status');
    this.banner.setAttribute('aria-live', 'polite');
  }

  _buildSceneCanvas() {
    this.sceneCanvas = el('canvas', 'lab-scene-canvas', this.root);
    this.sceneCanvas.setAttribute('aria-hidden', 'true');
    this.scene2d = new LabScene(this.sceneCanvas);
  }

  _buildTimeline() {
    this.tlPanel = div('lab-playback', this.root);
    this.tlPanel.setAttribute('role', 'group');
    this.tlPanel.setAttribute('aria-label', 'Playback');

    const transport = (name, label, onClick) => {
      const button = el('button', 'lab-transport-btn', this.tlPanel);
      button.type = 'button';
      button.innerHTML = iconSvg(name, 20);
      button.setAttribute('aria-label', label);
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
      });
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
      });
      return button;
    };
    this.skipBackButton = transport('skipBack', 'Jump to start', () => this._jumpToMoment('start'));
    this.playPauseButton = transport('pause', 'Play', () => {
      if (this._isMoving() || this.paused) this.togglePause();
      else this.bowl();
    });

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

    this.skipForwardButton = transport('skipForward', 'Jump to end', () => this._jumpToMoment('end'));

    this.tlTimeWrap = el('span', 'lab-timeline-time', this.tlPanel);
    el('span', 'lab-time-prefix', this.tlTimeWrap, 't =');
    this.tlTimeInput = el('input', 'lab-time-input', this.tlTimeWrap);
    this.tlTimeInput.type = 'number';
    this.tlTimeInput.step = '0.1';
    this.tlTimeInput.min = '0';
    this.tlTimeInput.inputMode = 'decimal';
    this.tlTimeInput.autocomplete = 'off';
    this.tlTimeInput.spellcheck = false;
    this.tlTimeInput.setAttribute('aria-label', 'Timeline time in seconds');
    this.tlTimeTotal = el('span', 'lab-time-total', this.tlTimeWrap, '/ 0.0000 s');
    this.tlTimeInput.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.tlTimeInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        this._commitTimeInput();
        this.tlTimeInput.blur();
      }
    });
    this.tlTimeInput.addEventListener('change', () => this._commitTimeInput());

    this.detailsToggle = el('button', 'lab-transport-btn lab-details-toggle', this.tlPanel);
    this.detailsToggle.type = 'button';
    this.detailsToggle.innerHTML = iconSvg('chevron', 20);
    this.detailsToggle.setAttribute('aria-label', 'Show snapshot details');
    this.detailsToggle.setAttribute('aria-expanded', 'false');
    this.detailsToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this._toggleDetails();
    });
    this.tlPanel.insertBefore(this.skipForwardButton, this.tlTrack);
  }

  _buildLabsLauncher() {
    this.labsButton = this._button('Labs', 'lab-ghost lab-labs-pill', this.root,
      () => this._openLabs(), { ariaLabel: 'Labs' });
    this.labsButton.prepend(this._icon('grid', 20));
    this.labsButton.setAttribute('aria-haspopup', 'dialog');
    this.labsButton.setAttribute('aria-expanded', 'false');

    this.labsSheet = div('lab-sheet-backdrop', this.root);
    this.labsSheet.hidden = true;
    this.labsSheet.setAttribute('role', 'dialog');
    this.labsSheet.setAttribute('aria-modal', 'true');
    this.labsSheet.setAttribute('aria-labelledby', 'lab-labs-title');
    this.labsPanel = div('lab-sheet lab-labs-sheet', this.labsSheet);
    const head = div('lab-sheet-head', this.labsPanel);
    const title = el('h2', 'lab-sheet-title', head, 'Labs');
    title.id = 'lab-labs-title';
    const close = el('button', 'lab-icon-btn', head);
    close.type = 'button';
    close.innerHTML = iconSvg('x', 20);
    close.setAttribute('aria-label', 'Close labs');
    close.addEventListener('click', () => this._closeLabs());
    this.labsBody = div('lab-labs-body', this.labsPanel);
    this.labsSheet.addEventListener('keydown', (event) => {
      this._sheetKeydown(event, this.labsSheet, () => this._closeLabs(), this.labsButton);
      if (event.key === 'Enter') {
        const tile = document.activeElement;
        if (tile && tile.classList.contains('lab-tile')) {
          event.preventDefault();
          tile.click();
        }
      }
    });
    this.labsSheet.addEventListener('pointerdown', (event) => {
      if (event.target === this.labsSheet) this._closeLabs();
    });
    this._renderLabsSheet();
  }

  _renderLabsSheet() {
    if (!this.labsBody) return;
    this.labsBody.innerHTML = '';
    const sections = [
      { label: 'Start here', labs: LABS.filter((lab) => lab.id === 'bowling') },
      { label: 'Worksheet labs', labs: LABS.filter((lab) => lab.id !== 'bowling') },
    ];
    this.labTiles = [];
    for (const section of sections) {
      el('div', 'lab-labs-section', this.labsBody, section.label);
      const grid = div('lab-labs-grid', this.labsBody);
      for (const lab of section.labs) {
        const current = lab.id === this.labId;
        const tile = el('button', 'lab-tile', grid);
        tile.type = 'button';
        tile.dataset.lab = lab.id;
        tile.setAttribute('aria-current', current ? 'true' : 'false');
        const icon = el('span', 'lab-tile-icon', tile);
        icon.innerHTML = iconSvg(LAB_ICONS[lab.id] || 'grid', 24);
        const copy = div('lab-tile-copy', tile);
        el('span', 'lab-tile-name', copy, lab.label);
        el('span', 'lab-tile-desc', copy, LAB_DESCRIPTIONS[lab.id] || '');
        if (current) {
          const badge = el('span', 'lab-tile-check', tile);
          badge.innerHTML = iconSvg('check', 18);
        }
        tile.addEventListener('pointerdown', (event) => event.stopPropagation());
        tile.addEventListener('click', (event) => {
          event.stopPropagation();
          this._closeLabs();
          this._switchLab(lab.id);
          this.app.play('menu_move');
        });
        tile.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            this._closeLabs();
            return;
          }
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const index = this.labTiles.indexOf(tile);
          let next = index;
          if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
          else if (event.key === 'ArrowRight') next = Math.min(this.labTiles.length - 1, index + 1);
          else if (event.key === 'ArrowUp') next = Math.max(0, index - 2);
          else next = Math.min(this.labTiles.length - 1, index + 2);
          this.labTiles[next].focus();
        });
        this.labTiles.push(tile);
      }
    }
  }

  _openLabs() {
    this._renderLabsSheet();
    this.labsSheet.hidden = false;
    this.labsButton.setAttribute('aria-expanded', 'true');
    this.app.play('menu_move');
    const current = this.labTiles.find((tile) => tile.dataset.lab === this.labId);
    (current || this.labTiles[0])?.focus({ preventScroll: true });
  }

  _closeLabs(focusButton = true) {
    this.labsSheet.hidden = true;
    this.labsButton.setAttribute('aria-expanded', 'false');
    if (focusButton) this.labsButton.focus({ preventScroll: true });
  }

  _updateLabsPill() {
    if (!this.labsButton) return;
    this.labsButton.setAttribute('aria-label', `Labs — current lab ${LAB_BY_ID[this.labId].label}`);
  }

  _buildSnapshot() {
    this.detailsCard = div('lab-details', this.root);
    this.detailsCard.hidden = true;
    this.detailsCard.setAttribute('role', 'region');
    this.detailsCard.setAttribute('aria-label', 'Snapshot details');
    const head = div('lab-details-head', this.detailsCard);
    this.snapshotLabel = el('span', 'lab-snapshot-label', head, 'At t = 0.00 s');
    this.snapshotLabel.setAttribute('aria-live', 'polite');
    this.moreButton = el('button', 'lab-icon-btn lab-more-btn', head);
    this.moreButton.type = 'button';
    this.moreButton.innerHTML = iconSvg('ellipsis', 20);
    this.moreButton.setAttribute('aria-label', 'More snapshot actions');
    this.moreButton.setAttribute('aria-haspopup', 'dialog');
    this.moreButton.setAttribute('aria-expanded', 'false');
    this.moreButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this._toggleMoreMenu();
    });
    this.snapshotGrid = div('lab-details-grid', this.detailsCard);

    this.moreMenu = div('lab-popover lab-more-menu', this.root);
    this.moreMenu.hidden = true;
    this.moreMenu.setAttribute('role', 'dialog');
    this.moreMenu.setAttribute('aria-label', 'Snapshot actions');
    this.moreMenu.addEventListener('keydown', (event) => {
      this._sheetKeydown(event, this.moreMenu, () => this._closeMoreMenu(), this.moreButton);
    });

    this.statMenu = div('lab-popover lab-stat-menu', this.root);
    this.statMenu.hidden = true;
    this.statMenu.setAttribute('role', 'dialog');
    this.statMenu.setAttribute('aria-label', 'Choose snapshot stats');
    this.statMenu.addEventListener('keydown', (event) => {
      this._sheetKeydown(event, this.statMenu, () => this._closeStatMenu(), this.addStatButton);
    });
  }



  _bindScrub() {
    const scrubFromEvent = (event) => {
      if (!this.timelineAvailable()) return;
      const rect = this.tlTrack.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      this._scrubFraction(fraction);
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
      if (this.modeId !== 'bowling') {
        const total = this._timelineDuration();
        const step = total / 100;
        let value = this.simTime;
        if (event.key === 'ArrowLeft') value -= step;
        else if (event.key === 'ArrowRight') value += step;
        else if (event.key === 'Home') value = 0;
        else if (event.key === 'End') value = total;
        else return;
        event.preventDefault();
        event.stopPropagation();
        this.simTime = Math.max(0, Math.min(total, value));
        this.paused = true;
        this._drawScene();
        this._updateTimelineUi();
        this.syncControls();
        return;
      }
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
    this.backButton = this._button('BACK TO MENU', 'lab-ghost lab-back-btn', this.root,
      () => this.app.goToMenu(), { ariaLabel: 'BACK TO MENU — return to the main menu' });
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
    for (const node of [this.tlPanel, this.backButton, this.labsButton,
      this.detailsCard, this.drawerToggle]) {
      if (node) node.inert = trap;
    }
    this.drawerToggle.setAttribute('aria-expanded', String(open));
    this.drawerToggle.setAttribute('aria-label',
      open ? 'CALCULATOR — close the calculator drawer'
        : 'CALCULATOR — open the calculator drawer');
  }

  _toggleDrawer(force) {
    const open = force === undefined
      ? !this.root.classList.contains('drawer-open')
      : !!force;
    this.root.classList.toggle('drawer-open', open);
    this._syncDrawerA11y();
    if (open) {
      this._closeAddMenu();
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

  // ==== Rows, settings, and formulas ======================================
  _renderRows() {
    this.fieldList.innerHTML = '';
    this.rows = {};
    this.journeyRows = [];
    this.forcesRows = [];
    this.forceAddButton = null;
    this.customRows = [];
    this.customAddButton = null;
    this._renderPickerRows();
    if (this.modeId === 'journey') {
      this._renderJourneyRows();
    } else {
      for (const key of this.rowKeys) this._buildFieldRow(this.fieldList, key);
      if (this.modeId === 'torque') this._renderForcesList();
      if (this.modeId === 'inertia'
          && this.modeStore.inertia.settings.shape === 'custom'
          && this.modeStore.inertia.settings.submode === 'shape') {
        this._renderCustomPartsList();
      }
    }
    this.fieldList.appendChild(this.addWrap);
    this._renderAddMenu();
    this._updateEditRows();
  }

  _renderCustomPartsList() {
    const store = this.modeStore.inertia;
    if (!Array.isArray(store.customParts)) store.customParts = [{ m: 1, r: 0.5 }];
    const wrap = div('lab-force-wrap', this.fieldList);
    el('div', 'lab-subhead', wrap, 'Custom parts');
    this.customRows = [];
    store.customParts.forEach((part, index) => {
      const card = div('lab-force', wrap);
      const head = div('lab-force-head', card);
      el('span', 'lab-leg-title', head, `Part ${index + 1} (m r²)`);
      const remove = el('button', 'lab-remove', head);
      remove.innerHTML = iconSvg('minus', 16);
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove custom part ${index + 1}`);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        if (store.customParts.length <= 1) return;
        store.customParts.splice(index, 1);
        this._renderRows();
        this._solveNow();
      });
      const grid = div('lab-force-grid lab-custom-grid', card);
      const field = (key, labelText, unit) => {
        const cell = div('lab-leg-field', grid);
        const label = el('label', 'lab-leg-label', cell, labelText);
        const id = `part-${index}-${key}`;
        label.htmlFor = id;
        const input = el('input', 'lab-field-input lab-leg-input', cell);
        input.type = 'number';
        input.step = '0.01';
        input.inputMode = 'decimal';
        input.value = Number.isFinite(part[key]) ? fmt(part[key]) : '';
        el('span', 'lab-leg-unit', cell, unit);
        input.addEventListener('input', () => {
          if (input.validity && input.validity.badInput) return;
          part[key] = input.value.trim() === '' ? null : input.valueAsNumber;
          this._scheduleSolve();
        });
        input.addEventListener('blur', () => {
          if (Number.isFinite(part[key])) input.value = fmt(part[key]);
          this._solveNow();
        });
        return input;
      };
      const m = field('m', 'mass m', 'kg');
      const r = field('r', 'radius r', 'm');
      this.customRows.push({ m, r, remove });
    });
    this.customAddButton = this._button('Add part', 'lab-add lab-add-row', wrap, () => {
      store.customParts.push({ m: 1, r: 0.5 });
      this._renderRows();
      this._solveNow();
    }, { ariaLabel: 'Add part' });
    this.customAddButton.prepend(this._icon('plus', 18));
  }

  _renderForcesList() {
    const store = this.modeStore.torque;
    const wrap = div('lab-force-wrap', this.fieldList);
    el('div', 'lab-subhead', wrap, 'Forces');
    this.forcesRows = [];
    store.forces.forEach((force, index) => {
      const card = div('lab-force', wrap);
      const head = div('lab-force-head', card);
      el('span', 'lab-leg-title', head, `Force ${index + 1}`);
      const remove = el('button', 'lab-remove', head);
      remove.innerHTML = iconSvg('minus', 16);
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove force ${index + 1}`);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        if (store.forces.length <= 1) return;
        store.forces.splice(index, 1);
        this._renderRows();
        this._solveNow();
      });
      const grid = div('lab-force-grid', card);
      const field = (key, labelText, unit, step) => {
        const cell = div('lab-leg-field', grid);
        const label = el('label', 'lab-leg-label', cell, labelText);
        const id = `force-${index}-${key}`;
        label.htmlFor = id;
        const input = el('input', 'lab-field-input lab-leg-input', cell);
        input.type = 'number';
        input.id = id;
        input.step = String(step);
        input.inputMode = 'decimal';
        input.autocomplete = 'off';
        input.value = Number.isFinite(force[key]) ? fmt(force[key]) : '';
        el('span', 'lab-leg-unit', cell, unit);
        input.addEventListener('input', () => {
          if (input.validity && input.validity.badInput) return;
          force[key] = input.value.trim() === '' ? null : input.valueAsNumber;
          this._scheduleSolve();
        });
        input.addEventListener('blur', () => {
          if (Number.isFinite(force[key])) input.value = fmt(force[key]);
          this._solveNow();
        });
        input.addEventListener('keydown', (event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
            this.bowl();
          }
        });
        return { input, label };
      };
      const F = field('F', 'F', 'N', 0.1);
      const r = field('r', 'r', 'm', 0.01);
      const angle = field('angle', 'θ', '°', 0.1);
      const directionCell = div('lab-leg-field', grid);
      const directionLabel = el('label', 'lab-leg-label', directionCell, 'Direction');
      const direction = el('select', 'lab-field-input lab-select lab-leg-select', directionCell);
      directionLabel.htmlFor = `force-${index}-direction`;
      direction.id = `force-${index}-direction`;
      const ccw = el('option', '', direction, 'CCW');
      ccw.value = '1';
      const cw = el('option', '', direction, 'CW');
      cw.value = '-1';
      direction.value = force.direction === -1 ? '-1' : '1';
      direction.addEventListener('change', () => {
        force.direction = direction.value === '-1' ? -1 : 1;
        this._scheduleSolve();
      });
      this.forcesRows.push({ F, r, angle, direction, remove });
    });
    this.forceAddButton = this._button('Add force', 'lab-add lab-add-row', wrap, () => {
      store.forces.push({ F: 10, r: 0.2, angle: 90, direction: 1 });
      this._renderRows();
      this._solveNow();
    }, { ariaLabel: 'Add force' });
    this.forceAddButton.prepend(this._icon('plus', 18));
  }

  _renderModeSwitcher() {
    if (!this.modeSwitcher) return;
    let items = [];
    let current = '';
    let onPick = null;
    if (this.labId === 'linear') {
      items = LINEAR_MODES.map((id) => ({ id, label: MODE_BY_ID[id].label }));
      current = this.modeId;
      onPick = (id) => this._switchMode(id);
    } else if (this.modeId === 'inertia') {
      const settings = this.modeStore.inertia.settings;
      items = [
        { id: 'shape', label: 'Shape' },
        { id: 'conservation', label: 'Conservation' },
        { id: 'collision', label: 'Collision' },
      ];
      current = settings.submode;
      onPick = (id) => {
        settings.submode = id;
        this._applyInertiaRows();
        this._renderRows();
        this._renderModeSwitcher();
        this._solveNow();
      };
    } else if (this.modeId === 'torque') {
      const settings = this.modeStore.torque.settings;
      items = [
        { id: 'door', label: 'Door' },
        { id: 'wrench', label: 'Wrench' },
        { id: 'seesaw', label: 'Seesaw' },
        { id: 'wheel', label: 'Wheel' },
        { id: 'pulley', label: 'Pulley' },
      ];
      current = settings.scene;
      onPick = (id) => {
        settings.scene = id;
        this._renderModeSwitcher();
        this._drawScene();
      };
    } else {
      this.modeSwitcher.hidden = true;
      return;
    }
    this.modeSwitcher.hidden = false;
    this.modeSwitcher.innerHTML = '';
    this.modeTabs = {};
    this.modeIndicator = div('lab-mode-indicator', this.modeSwitcher);
    for (const item of items) {
      const tab = el('button', 'lab-mode-tab', this.modeSwitcher, item.label);
      tab.type = 'button';
      tab.dataset.mode = item.id;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(item.id === current));
      tab.tabIndex = item.id === current ? 0 : -1;
      tab.classList.toggle('active', item.id === current);
      tab.addEventListener('pointerdown', (event) => event.stopPropagation());
      tab.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const index = items.findIndex((entry) => entry.id === current);
        let next = index;
        if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
        else if (event.key === 'ArrowRight') next = (index + 1) % items.length;
        else if (event.key === 'Home') next = 0;
        else next = items.length - 1;
        onPick(items[next].id);
        const focus = this.modeTabs[items[next].id];
        if (focus) focus.focus({ preventScroll: true });
      });
      tab.addEventListener('click', (event) => {
        event.stopPropagation();
        onPick(item.id);
        this.app.play('menu_move');
      });
      this.modeTabs[item.id] = tab;
    }
    this.modeSwitcher.setAttribute('aria-label', 'Lab mode');
    // Position the sliding indicator after the tabs have been laid out.
    const active = this.modeTabs[current];
    if (active) {
      this.modeIndicator.style.width = `${active.offsetWidth}px`;
      this.modeIndicator.style.transform = `translateX(${active.offsetLeft}px)`;
    }
  }


  _renderPickerRows() {
    if (!this.fieldList) return;
    const row = (label, value, onClick, secondary = '') => {
      const node = el('button', 'lab-picker-row', this.fieldList);
      node.type = 'button';
      const copy = div('lab-picker-copy', node);
      el('span', 'lab-picker-label', copy, label);
      if (secondary) el('span', 'lab-picker-secondary', copy, secondary);
      const trailing = div('lab-picker-trailing', node);
      el('span', 'lab-picker-value', trailing, value);
      trailing.appendChild(this._icon('chevronRight', 18));
      node.addEventListener('pointerdown', (event) => event.stopPropagation());
      node.addEventListener('click', onClick);
      return node;
    };

    if (this.modeId === 'freefall') {
      const settings = this.modeStore.freefall.settings;
      const names = { dropped: 'Dropped', down: 'Thrown down', up: 'Thrown up' };
      let directionRow;
      directionRow = row('Direction', names[settings.direction] || 'Dropped', () => {
        this._openPickerMenu(directionRow, 'Direction', [
          { value: 'dropped', label: 'Dropped' },
          { value: 'down', label: 'Thrown down' },
          { value: 'up', label: 'Thrown up' },
        ], settings.direction, (value) => {
          settings.direction = value;
          if (value !== 'up') settings.atHighest = false;
          if (value === 'dropped') this.given.u = 0;
          this._renderRows();
          this._renderModeSwitcher();
          this._solveNow();
        });
      });
      if (settings.direction === 'up') {
        const toggle = el('button', 'lab-toggle-row', this.fieldList);
        toggle.type = 'button';
        const copy = div('lab-picker-copy', toggle);
        el('span', 'lab-picker-label', copy, 'At highest point');
        el('span', 'lab-picker-secondary', copy, 'Freeze the final velocity at zero');
        const sw = el('span', 'lab-switch', toggle);
        sw.dataset.on = String(!!settings.atHighest);
        sw.setAttribute('aria-hidden', 'true');
        toggle.setAttribute('aria-pressed', String(!!settings.atHighest));
        toggle.addEventListener('click', () => {
          settings.atHighest = !settings.atHighest;
          if (settings.atHighest) this.given.v = 0;
          else if (this.given.v === 0) delete this.given.v;
          this._renderRows();
          this._solveNow();
        });
        return;
      }
    }

    if (this.modeId === 'projectile') {
      // Launch type is rendered by _renderModeControls, which also applies the
      // default row set for Ground / Horizontal / From a height.
      return;
    }

    if (this.modeId === 'rotational') {
      const settings = this.modeStore.rotational.settings;
      const toggle = el('button', 'lab-toggle-row', this.fieldList);
      toggle.type = 'button';
      const copy = div('lab-picker-copy', toggle);
      el('span', 'lab-picker-label', copy, 'Rolling wheel');
      el('span', 'lab-picker-secondary', copy, 'Show the wheel rolling, distance = θr');
      const sw = el('span', 'lab-switch', toggle);
      sw.dataset.on = String(!!settings.rolling);
      sw.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-pressed', String(!!settings.rolling));
      toggle.addEventListener('click', () => {
        settings.rolling = !settings.rolling;
        this._renderRows();
        this._drawScene();
      });
      return;
    }

    if (this.modeId === 'inertia' && this.modeStore.inertia.settings.submode === 'shape') {
      const settings = this.modeStore.inertia.settings;
      const definition = SHAPES.find((item) => item.id === settings.shape) || SHAPES[0];
      let shapeRow;
      shapeRow = row('Shape', definition.label, () => {
        this._openPickerMenu(shapeRow, 'Shape', SHAPES.map((shape) => ({
          value: shape.id, label: shape.label, hint: shape.formula,
        })), settings.shape, (value) => {
          settings.shape = value;
          this._applyInertiaRows();
          this._renderRows();
          this._solveNow();
        });
      }, definition.formula);
    }
  }

  _openUnitMenu(key, trigger) {
    const row = this.rows[key];
    if (!row || !row.field.unitOptions) return;
    this.unitMenuOpen = true;
    this._unitTrigger = trigger;
    this.unitMenu.innerHTML = '';
    el('h2', 'lab-popover-title', this.unitMenu, 'Unit');
    for (let index = 0; index < row.field.unitOptions.length; index += 1) {
      const option = row.field.unitOptions[index];
      const button = el('button', 'lab-add-option', this.unitMenu);
      button.type = 'button';
      const copy = div('lab-add-copy', button);
      el('span', 'lab-add-name', copy, option.label || option.unit);
      if (index === (row.unitIndex || 0)) {
        const check = el('span', 'lab-add-unit', button);
        check.innerHTML = iconSvg('check', 18);
      }
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        row.unitIndex = index;
        this.unitMenu.hidden = true;
        this.unitMenuOpen = false;
        const trailing = trigger.querySelector('.lab-icon-wrap');
        trigger.textContent = option.unit;
        if (trailing) trigger.appendChild(trailing);
        trigger.setAttribute('aria-label', `${option.unit} — change unit for ${row.field.label}`);
        this._renderSolution();
      });
    }
    this.unitMenu.hidden = false;
    this._positionPopover(this.unitMenu, trigger, { width: 190, align: 'right' });
    const first = this.unitMenu.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }

  _closeUnitMenu() {
    if (!this.unitMenu) return;
    this.unitMenu.hidden = true;
    this.unitMenuOpen = false;
    if (this._unitTrigger) this._unitTrigger.focus({ preventScroll: true });
  }


  _openPickerMenu(trigger, title, options, current, onSelect) {
    if (!this.pickerMenu) {
      this.pickerMenu = div('lab-popover lab-picker-menu', this.root);
      this.pickerMenu.setAttribute('role', 'dialog');
    }
    this.pickerMenu.innerHTML = '';
    el('h2', 'lab-popover-title', this.pickerMenu, title);
    for (const option of options) {
      const button = el('button', 'lab-picker-option', this.pickerMenu);
      button.type = 'button';
      const copy = div('lab-picker-copy', button);
      el('span', 'lab-picker-label', copy, option.label);
      if (option.hint) el('span', 'lab-picker-secondary', copy, option.hint);
      if (option.value === current) {
        const check = el('span', 'lab-picker-check', button);
        check.innerHTML = iconSvg('check', 18);
      }
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.pickerMenu.hidden = true;
        onSelect(option.value);
      });
    }
    this.pickerMenu.hidden = false;
    this._positionPopover(this.pickerMenu, trigger, { width: 300 });
    this.pickerMenu.onkeydown = (event) => {
      this._sheetKeydown(event, this.pickerMenu, () => {
        this.pickerMenu.hidden = true;
      }, trigger);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.pickerMenu.hidden = true;
        trigger.focus();
      }
    };
    const first = this.pickerMenu.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    this._pickerTrigger = trigger;
  }


  _availableFields() {
    return MODE_BY_ID[this.modeId].variables
      .filter((field) => !this.rowKeys.includes(field.key));
  }

  _positionPopover(popover, trigger, options = {}) {
    const stageRect = this.app.stage.getBoundingClientRect();
    const rect = trigger.getBoundingClientRect();
    const scale = stageRect.width / 1280 || 1;
    const width = options.width || 300;
    let left = (rect.left - stageRect.left) / scale;
    if (options.align === 'right') left = (rect.right - stageRect.left) / scale - width;
    left = Math.max(12, Math.min(1280 - width - 12, left));
    const triggerTop = (rect.top - stageRect.top) / scale;
    const triggerBottom = (rect.bottom - stageRect.top) / scale;
    const desired = Math.min(460, popover.scrollHeight || 360);
    let top = triggerBottom + 6;
    if (top + desired > 708 && triggerTop > desired + 12) {
      top = triggerTop - desired - 6;
    }
    popover.style.width = `${width}px`;
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(12, top)}px`;
    popover.style.maxHeight = `${Math.min(696, Math.max(180, desired))}px`;
  }

  _renderAddMenu() {
    if (!this.addMenu) return;
    if (this.modeId === 'journey') {
      this.addMenu.hidden = true;
      this.addWrap.hidden = false;
      this.addButton.lastChild.textContent = 'Add leg';
      this.addButton.setAttribute('aria-label', 'Add leg');
      this.addButton.disabled = !this._editable();
      this.addButton.setAttribute('aria-disabled', String(!this._editable()));
      this.addButton.setAttribute('aria-haspopup', 'false');
      return;
    }
    const available = this._availableFields();
    this.addWrap.hidden = available.length === 0;
    this.addButton.disabled = available.length === 0;
    if (this.addButton.lastChild) this.addButton.lastChild.textContent = 'Add value';
    this.addButton.setAttribute('aria-label', 'Add value');
    this.addButton.setAttribute('aria-disabled', String(available.length === 0));
    this.addButton.setAttribute('aria-haspopup', 'dialog');
    if (!available.length) {
      this.addMenu.hidden = true;
      return;
    }

    this.addMenu.innerHTML = '';
    const head = div('lab-popover-head', this.addMenu);
    el('h2', 'lab-popover-title', head, 'Add a value');
    const searchWrap = div('lab-search', this.addMenu);
    const search = el('input', 'lab-search-input', searchWrap);
    search.type = 'search';
    search.placeholder = 'Search values';
    search.value = this.addSearchTerm || '';
    search.setAttribute('aria-label', 'Search values');
    searchWrap.prepend(this._icon('search', 18));
    search.addEventListener('input', () => {
      this.addSearchTerm = search.value;
      this._renderAddResults(available, search.value);
    });
    this.addResults = div('lab-add-results', this.addMenu);
    this._renderAddResults(available, search.value);
    search.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        this._closeAddMenu();
        this.addButton.focus();
      }
    });
  }

  _renderAddResults(available, query = '') {
    if (!this.addResults) return;
    this.addResults.innerHTML = '';
    const text = String(query || '').trim().toLowerCase();
    const filtered = available.filter((field) => (
      !text || `${field.label} ${field.help || ''} ${field.unit || ''}`.toLowerCase().includes(text)));
    const groups = [
      { id: 'Given', label: 'Given' },
      { id: 'Derived', label: 'Calculated' },
      { id: 'Optional', label: 'Extra' },
    ];
    let count = 0;
    for (const group of groups) {
      const fields = filtered.filter((field) => (field.group || 'Given') === group.id);
      if (!fields.length) continue;
      el('div', 'lab-add-group', this.addResults, group.label);
      for (const field of fields) {
        count += 1;
        const option = el('button', 'lab-add-option', this.addResults);
        option.type = 'button';
        const copy = div('lab-add-copy', option);
        const name = el('span', 'lab-add-name', copy);
        name.append(field.label);
        const symbol = el('span', 'lab-add-symbol');
        symbol.innerHTML = symbolHtml(field.symbol);
        name.appendChild(symbol);
        el('span', 'lab-add-hint', copy, field.help || '');
        el('span', 'lab-add-unit', option, field.unit || '');
        option.addEventListener('click', (event) => {
          event.stopPropagation();
          this._closeAddMenu();
          this._addRow(field.key);
        });
      }
    }
    if (!count) el('div', 'lab-popover-empty', this.addResults, 'No matching values.');
  }

  _toggleAddMenu(force) {
    if (this.modeId === 'journey') {
      if (this._editable()) this._addLeg();
      return;
    }
    const open = force === undefined ? !this.addOpen : !!force;
    if (open && this.addButton.disabled) return;
    this.addOpen = open;
    this.addMenu.hidden = !open;
    this.addButton.setAttribute('aria-expanded', String(open));
    if (open) {
      this.addSearchTerm = '';
      this._renderAddMenu();
      this._positionPopover(this.addMenu, this.addButton, { width: 320 });
      const search = this.addMenu.querySelector('.lab-search-input');
      if (search) search.focus({ preventScroll: true });
    }
  }

  _closeAddMenu() {
    if (!this.addOpen) return;
    this.addOpen = false;
    this.addMenu.hidden = true;
    this.addButton.setAttribute('aria-expanded', 'false');
  }

  _addRow(key) {
    if (this.rowKeys.includes(key)) {
      const existing = this.rows[key];
      if (existing) existing.input.focus({ preventScroll: true });
      return;
    }
    this.rowKeys.push(key);
    this._lastAddedKey = key;
    if (this.modeId === 'torque' && ['m1', 'r1', 'm2', 'r2'].includes(key)) {
      for (const extra of ['m1', 'r1', 'm2', 'r2']) {
        if (!this.rowKeys.includes(extra)) this.rowKeys.push(extra);
      }
    }
    this._renderRows();
    this._solveNow();
    this.app.play('menu_move');
    window.setTimeout(() => {
      const row = this.rows[key];
      if (!row) return;
      row.input.focus({ preventScroll: true });
      // The row was added so the player can type into it. A calculated value
      // still opens in override mode rather than swallowing the first keys.
      if (row.input.readOnly && row.input.dataset.locked !== 'true') row.input.readOnly = false;
    }, 0);
  }

  _toggleEdit() {
    this.editMode = !this.editMode;
    this._updateEditRows();
  }

  _updateEditRows() {
    if (this.editButton) {
      this.editButton.textContent = this.editMode ? 'Done' : 'Edit';
      this.editButton.setAttribute('aria-pressed', String(this.editMode));
    }
    for (const row of Object.values(this.rows)) {
      if (row.remove) row.remove.hidden = !this.editMode;
    }
    for (const row of this.journeyRows || []) {
      if (row && row.remove) row.remove.hidden = !this.editMode;
    }
    for (const row of this.forcesRows || []) {
      if (row && row.remove) row.remove.hidden = !this.editMode;
    }
    for (const row of this.customRows || []) {
      if (row && row.remove) row.remove.hidden = !this.editMode;
    }
  }

  _removeRow(key) {
    if (!this.rowKeys.includes(key)) return;
    this.rowKeys = this.rowKeys.filter((item) => item !== key);
    delete this.given[key];
    delete this._lastCommitted[key];
    this.openFormulas.delete(key);
    if (this._lastEditedKey === key) this._lastEditedKey = null;
    this._renderRows();
    this._solveNow();
    this.app.play('menu_move');
    this.addButton.focus({ preventScroll: true });
  }

  // ==== Modes =============================================================
  _saveModeState() {
    const store = this.modeStore[this.modeId];
    if (!store) return;
    store.given = this.given;
    store.rowKeys = this.rowKeys;
    store.openFormulas = this.openFormulas;
    store.lastCommitted = this._lastCommitted;
    store.lastEditedKey = this._lastEditedKey;
  }

  _loadModeState(modeId) {
    const store = this.modeStore[modeId];
    this.given = store.given || {};
    this.rowKeys = store.rowKeys || [...MODE_BY_ID[modeId].defaultRows];
    this.openFormulas = store.openFormulas || new Set();
    this._lastCommitted = store.lastCommitted || {};
    this._lastEditedKey = store.lastEditedKey || null;
  }

  _activateMode(modeId) {
    this.modeId = modeId;
    this._modeFields = variablesFor(MODE_BY_ID[modeId]);
    this._loadModeState(modeId);
    this.solution = null;
    this._conflictCache = null;
  }

  _switchMode(modeId, options = {}) {
    if (!LINEAR_MODES.includes(modeId) || modeId === this.modeId) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      document.activeElement.blur();
    }
    this._saveModeState();
    this.linearModeId = modeId;
    this.labId = 'linear';
    this._activateMode(modeId);
    this.editMode = false;
    this._closeAddMenu();
    this._closeExamples();
    this._closeDetails();
    this._closeMoreMenu();
    this._closeStatMenu();
    if (this.unitMenu) this.unitMenu.hidden = true;
    this._syncLabUi();
    this._renderRows();
    this._renderSettings();
    this._renderExamples();
    this._solveNow();
    this._resetSimulation({ silent: true });
    if (!options.silent) {
      this.app.play('menu_move');
      this._syncDrawerA11y();
    }
  }

  _switchLab(labId, options = {}) {
    if (!LAB_BY_ID[labId] || labId === this.labId) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      document.activeElement.blur();
    }
    this._saveModeState();
    this.labId = labId;
    const modeId = labId === 'linear' ? (this.linearModeId || 'freefall') : labId;
    this._activateMode(modeId);
    this.editMode = false;
    if (labId === 'linear') this.linearModeId = modeId;
    this.snapshotPinned = null;
    this._closeAddMenu();
    this._closeExamples();
    this._closeDetails();
    this._closeMoreMenu();
    this._closeStatMenu();
    if (this.unitMenu) this.unitMenu.hidden = true;
    this._syncLabUi();
    this._renderRows();
    this._renderSettings();
    this._renderExamples();
    this._solveNow();
    if (labId === 'bowling') this._begin();
    else this._resetSimulation({ silent: true });
    if (!options.silent) {
      this.app.play('menu_move');
      this._syncDrawerA11y();
    }
  }

  _syncLabUi() {
    const lab = LAB_BY_ID[this.labId] || LAB_BY_ID.bowling;
    if (this.titleNode) {
      this.titleNode.textContent = lab.title;
      this.titleNode.setAttribute('aria-label', lab.title);
      this.titleNode.classList.toggle('long', lab.title.length > 20);
    }
    this._renderModeSwitcher();
    this._updateLabsPill();
    this._syncModeUi();
    this._renderSnapshotKeys();
    this._updateSnapshot();
  }

  _syncModeUi() {
    const mode = MODE_BY_ID[this.modeId];
    const is2d = mode.scene !== 'bowling';
    this.root.classList.toggle('lab-2d', is2d);
    this.app.stage.classList.toggle('lab-2d', is2d);
    this.sceneCanvas.hidden = !is2d;
    this.bowlButton.textContent = mode.actionLabel;
    this.bowlButton.setAttribute('aria-label', mode.actionLabel === 'BOWL'
      ? 'BOWL — bowl using the solved launch values'
      : `${mode.actionLabel} — run the ${mode.label} simulation`);
    this._renderModeControls();
    if (is2d) this._resizeScene();
  }


  _layoutCheck() {
    const box = (node) => {
      if (!node || node.hidden) return null;
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    const nodes = {
      sidebar: this.sidebar,
      title: this.titleWrap,
      labs: this.labsButton,
      playback: this.tlPanel,
      details: this.detailsCard,
      back: this.backButton,
    };
    const boxes = Object.fromEntries(
      Object.entries(nodes).map(([key, node]) => [key, box(node)]));
    const overlaps = [];
    const entries = Object.entries(boxes).filter(([, value]) => value);
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const [a, ra] = entries[i];
        const [b, rb] = entries[j];
        const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (x > 1 && y > 1) overlaps.push({ a, b, overlap: [Math.round(x), Math.round(y)] });
      }
    }
    const result = { ok: overlaps.length === 0, overlaps, boxes };
    if (!result.ok) console.warn('[Physics Lab] layout overlap', result);
    return result;
  }

  _resizeScene() {
    if (this.scene2d && this.modeId !== 'bowling') this.scene2d.resize();
  }


  _renderModeControls() {
    if (!this.modeControls) return;
    this.modeControls.innerHTML = '';
    const mode = MODE_BY_ID[this.modeId];
    const show = this.modeId === 'projectile'
      || (this.modeId === 'straight')
      || (this.modeId === 'rotational');
    this.modeControls.hidden = !show;
    if (!show) return;

    const chip = (label, active, onClick, title = '') => {
      const button = el('button', 'lab-mode-chip', this.modeControls, label);
      button.type = 'button';
      button.dataset.on = String(active);
      button.setAttribute('aria-pressed', String(active));
      if (title) button.title = title;
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
        this.app.play('menu_move');
      });
      return button;
    };

    if (this.modeId === 'projectile') {
      const settings = this.modeStore.projectile.settings;
      el('span', 'lab-mode-control-label', this.modeControls, 'Launch type');
      chip('Ground launch', settings.launchType === 'ground',
        () => this._setLaunchType('ground'), 'Locks launch height to 0 m');
      chip('Horizontal', settings.launchType === 'horizontal',
        () => this._setLaunchType('horizontal'), 'Locks launch angle to 0°');
      chip('From a height', settings.launchType === 'angled',
        () => this._setLaunchType('angled'), 'Launch height is an input');
      return;
    }

    if (this.modeId === 'straight') {
      const settings = this.modeStore.straight.settings;
      chip('Constant speed', !!settings.constantSpeed,
        () => {
          settings.constantSpeed = !settings.constantSpeed;
          this._renderModeControls();
          this._solveNow();
        }, 'Locks acceleration to 0');
      return;
    }

    if (this.modeId === 'rotational') {
      const settings = this.modeStore.rotational.settings;
      chip('Constant speed', !!settings.constantSpeed,
        () => {
          settings.constantSpeed = !settings.constantSpeed;
          this._renderModeControls();
          this._solveNow();
        }, 'Locks angular acceleration to 0');
    }
  }

  _applyLaunchRows(launchType = this.modeStore.projectile.settings.launchType) {
    if (launchType === 'ground') {
      this.rowKeys = ['v0', 'angle', 'R'];
      delete this.given.h0;
    } else if (launchType === 'horizontal') {
      this.rowKeys = ['v0', 'h0', 'R'];
      delete this.given.angle;
    } else {
      this.rowKeys = ['v0', 'angle', 'h0', 'R'];
    }
    this._lastAddedKey = null;
  }

  _setLaunchType(launchType) {
    const settings = this.modeStore.projectile.settings;
    if (settings.launchType === launchType) return;
    settings.launchType = launchType;
    this._applyLaunchRows(launchType);
    this._renderModeControls();
    this._renderRows();
    this._solveNow();
    this._drawScene();
  }

  _applyInertiaRows() {
    const settings = this.modeStore.inertia.settings;
    if (settings.submode === 'conservation') {
      this.rowKeys = ['I1', 'w1', 'I2', 'w2'];
    } else if (settings.submode === 'collision') {
      this.rowKeys = ['I1', 'w1', 'M', 'R', 'I2', 'w2'];
    } else {
      const usesL = ['rodEnd', 'rodCenter'].includes(settings.shape);
      this.rowKeys = settings.shape === 'custom'
        ? ['I', 'w', 'Lm']
        : (usesL ? ['M', 'L', 'I', 'w', 'Lm'] : ['M', 'R', 'I', 'w', 'Lm']);
    }
    this._renderAddMenu();
  }


  _renderSettings() {
    const mode = MODE_BY_ID[this.modeId];
    this.resetDefaultsButton.hidden = false;
    this.extraSettings.innerHTML = '';
    this.constRows = {};

    if (this.modeId === 'bowling') {
      this.constList.hidden = false;
      this.extraSettings.hidden = true;
      this.constList.innerHTML = '';
      el('div', 'lab-settings-group', this.constList, 'Bowling constants');
      for (const field of CONST_FIELDS) this._buildConstantRow(this.constList, field);
      for (const setting of MODE_BY_ID.bowling.settings) {
        if (setting.key === 'laneMode') {
          el('div', 'lab-settings-group', this.constList, 'Lane');
          this._buildSelectSetting(setting, this.constList);
        }
      }
      el('div', 'lab-settings-caption', this.constList,
        'These values feed the analytical launch plan and the lane run.');
      return;
    }

    this.constList.hidden = true;
    this.extraSettings.hidden = false;
    if (!mode.settings.length) {
      this._buildNoteSetting({ text: 'No settings for this lab.' });
      return;
    }
    el('div', 'lab-settings-group', this.extraSettings, 'Lab settings');
    for (const setting of mode.settings) {
      if (setting.type === 'note') {
        this._buildNoteSetting(setting);
        continue;
      }
      if (setting.type === 'checkbox') this._buildCheckboxSetting(setting);
      else if (setting.type === 'select' || setting.type === 'select-number') {
        this._buildSelectSetting(setting);
      } else this._buildNumberSetting(setting);
      if (setting.help) {
        el('div', 'lab-settings-caption', this.extraSettings, setting.help);
      }
    }
  }

  _buildNoteSetting(setting) {
    const note = div('lab-settings-note', this.extraSettings, setting.text || '');
    note.setAttribute('role', 'note');
    return note;
  }

  _buildCheckboxSetting(setting) {
    const label = el('label', 'lab-check lab-mode-setting', this.extraSettings);
    const input = el('input', '', label);
    input.type = 'checkbox';
    input.checked = !!this.modeStore[this.modeId].settings[setting.key];
    input.id = `lab-setting-${setting.key}`;
    el('span', '', label, setting.label);
    input.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    input.addEventListener('change', () => {
      this.modeStore[this.modeId].settings[setting.key] = !!input.checked;
      this._renderModeControls();
      this._solveNow();
    });
    this.constRows[setting.key] = { row: label, input };
  }

  _buildNumberSetting(setting) {
    const row = div('lab-const lab-mode-setting', this.extraSettings);
    row.dataset.key = setting.key;
    const main = div('lab-field-main', row);
    const label = el('label', 'lab-field-label lab-const-label', main, setting.label);
    label.htmlFor = `lab-setting-${setting.key}`;
    const input = el('input', 'lab-field-input lab-const-input', main);
    input.type = 'number';
    input.id = `lab-setting-${setting.key}`;
    input.step = String(setting.step || 0.01);
    if (setting.min !== undefined) input.min = String(setting.min);
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = fmt(this.modeStore[this.modeId].settings[setting.key]);
    input.placeholder = fmt(setting.default);
    input.setAttribute('aria-label', setting.label);
    input.setAttribute('aria-describedby', 'lab-calc-status');
    input.title = setting.help || '';
    el('span', 'lab-field-unit', main, setting.unit || '');
    el('span', 'lab-how', main, '');
    el('span', 'lab-remove', main, '');
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    input.addEventListener('input', () => {
      if (input.validity && input.validity.badInput) return;
      const raw = input.value.trim();
      const store = this.modeStore[this.modeId].settings;
      if (raw === '') {
        store[setting.key] = setting.default;
      } else {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value)) return;
        store[setting.key] = value;
      }
      this._scheduleSolve();
    });
    input.addEventListener('blur', () => {
      const store = this.modeStore[this.modeId].settings;
      const value = Number.isFinite(input.valueAsNumber)
        ? input.valueAsNumber : setting.default;
      store[setting.key] = value;
      input.value = fmt(value);
      this._solveNow();
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
        this.bowl();
      }
    });
    this.constRows[setting.key] = { row, input };
  }

  _buildSelectSetting(setting, parent = this.extraSettings) {
    const row = div('lab-const lab-mode-setting', parent);
    row.dataset.key = setting.key;
    const main = div('lab-field-main', row);
    const label = el('label', 'lab-field-label lab-const-label', main, setting.label);
    label.htmlFor = `lab-setting-${setting.key}`;
    const select = el('select', 'lab-field-input lab-select', main);
    select.id = `lab-setting-${setting.key}`;
    for (const option of setting.options) {
      const labelText = typeof option === 'object' ? option.label : option;
      const value = typeof option === 'object' ? option.value : option;
      const node = el('option', '', select, labelText);
      node.value = String(value);
    }
    const stored = this.modeStore[this.modeId].settings[setting.key];
    select.value = String(stored);
    select.setAttribute('aria-label', setting.label);
    select.title = setting.help || '';
    el('span', 'lab-field-unit', main, '');
    el('span', 'lab-how', main, '');
    el('span', 'lab-remove', main, '');
    select.addEventListener('pointerdown', (event) => event.stopPropagation());
    select.addEventListener('change', () => {
      let value = select.value;
      if (setting.type === 'select-number') value = Number(select.value);
      this.modeStore[this.modeId].settings[setting.key] = value;
      if (setting.key === 'launchType') this._applyLaunchRows(value);
      this._renderModeControls();
      this._renderRows();
      this._solveNow();
      this._drawScene();
      this.app.play('menu_move');
    });
    select.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.stopPropagation();
    });
    this.constRows[setting.key] = { row, input: select };
  }

  // ==== Examples ==========================================================
  _toggleExamples(force) {
    const open = force === undefined ? !this.examplesOpen : !!force;
    if (open && !MODE_BY_ID[this.modeId].presets.length) return;
    this.examplesOpen = open;
    this.examplesMenu.hidden = !open;
    this.examplesButton.setAttribute('aria-expanded', String(open));
    if (open) {
      this._renderExamples();
      this._positionPopover(this.examplesMenu, this.examplesButton, { width: 310, align: 'right' });
      const first = this.examplesMenu.querySelector('button');
      if (first) first.focus({ preventScroll: true });
    }
  }

  _closeExamples() {
    if (!this.examplesOpen) return;
    this.examplesOpen = false;
    this.examplesMenu.hidden = true;
    this.examplesButton.setAttribute('aria-expanded', 'false');
  }

  _renderExamples() {
    if (!this.examplesMenu) return;
    const presets = MODE_BY_ID[this.modeId].presets;
    this.examplesButton.disabled = presets.length === 0;
    this.examplesButton.setAttribute('aria-disabled', String(presets.length === 0));
    this.examplesMenu.innerHTML = '';
    el('h2', 'lab-popover-title', this.examplesMenu, 'Examples');
    if (!presets.length) {
      el('div', 'lab-popover-empty', this.examplesMenu, 'No examples for this lab.');
      return;
    }
    for (const preset of presets) {
      const option = el('button', 'lab-add-option', this.examplesMenu);
      option.type = 'button';
      const copy = div('lab-add-copy', option);
      el('span', 'lab-add-name', copy, preset.label);
      option.appendChild(this._icon('chevronRight', 18));
      option.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          this._closeExamples();
          this.examplesButton.focus();
        }
      });
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        this._closeExamples();
        this._applyPreset(preset);
      });
    }
  }

  _applyPreset(preset) {
    this._saveModeState();
    if (this.modeId === 'journey') {
      const store = this.modeStore.journey;
      store.legs = (preset.legs || []).map((leg) => ({ ...leg }));
      if (!store.legs.length) store.legs = [{ distance: null, direction: 1, time: null }];
      store.typedResults = {};
      this._loadModeState('journey');
      this._renderRows();
    } else {
      this.given = {};
      Object.assign(this.given, preset.values || {});
      const variableKeys = new Set(MODE_BY_ID[this.modeId].variables.map((field) => field.key));
      for (const key of Object.keys(preset.values || {})) {
        if (variableKeys.has(key) && !this.rowKeys.includes(key)) this.rowKeys.push(key);
      }
      if (this.modeId === 'freefall') {
        const settings = this.modeStore.freefall.settings;
        settings.direction = preset.direction || 'dropped';
        settings.atHighest = !!preset.atHighest;
      }
      if (this.modeId === 'projectile') {
        const settings = this.modeStore.projectile.settings;
        if (preset.launchType) settings.launchType = preset.launchType;
        if (preset.barrier) {
          settings.barrierEnabled = !!preset.barrier.enabled;
          settings.barrierDistance = preset.barrier.distance;
          settings.barrierHeight = preset.barrier.height;
        }
        this._applyLaunchRows();
        for (const key of Object.keys(preset.values || {})) {
          if (variableKeys.has(key) && !this.rowKeys.includes(key)
              && !(settings.launchType === 'ground' && key === 'h0')
              && !(settings.launchType === 'horizontal' && key === 'angle')) {
            this.rowKeys.push(key);
          }
        }
      }
      if (this.modeId === 'torque') {
        const store = this.modeStore.torque;
        if (preset.scene) store.settings.scene = preset.scene;
        if (preset.forces) store.forces = preset.forces.map((force) => ({ ...force }));
      }
      if (this.modeId === 'inertia') {
        const settings = this.modeStore.inertia.settings;
        if (preset.submode) settings.submode = preset.submode;
        if (preset.shape) settings.shape = preset.shape;
        this._applyInertiaRows();
      }
      this._lastEditedKey = null;
      this._renderRows();
      this._renderModeControls();
      this._renderModeSwitcher();
    }
    this._resetSimulation({ silent: true });
    this._solveNow();
    this.app.play('menu_move');
  }

  _openSettings() {
    this._renderSettings();
    this.settingsSheet.hidden = false;
    this.settingsButton.setAttribute('aria-expanded', 'true');
    this._activeSheet = this.settingsSheet;
    this._sheetTrigger = this.settingsButton;
    const focusable = this.settingsSheet.querySelector('button, input, select');
    if (focusable) focusable.focus({ preventScroll: true });
    this.app.play('menu_move');
  }

  _closeSettings() {
    this.settingsSheet.hidden = true;
    this.settingsButton.setAttribute('aria-expanded', 'false');
    this._activeSheet = null;
    this.settingsButton.focus({ preventScroll: true });
  }

  _closeTopLayer() {
    if (this.settingsSheet && !this.settingsSheet.hidden) { this._closeSettings(); return true; }
    if (this.labsSheet && !this.labsSheet.hidden) { this._closeLabs(); return true; }
    if (this.addOpen) { this._closeAddMenu(); this.addButton.focus(); return true; }
    if (this.examplesOpen) { this._closeExamples(); this.examplesButton.focus(); return true; }
    if (this.statMenu && !this.statMenu.hidden) { this._closeStatMenu(); return true; }
    if (this.moreMenu && !this.moreMenu.hidden) { this._closeMoreMenu(); return true; }
    if (this.unitMenu && !this.unitMenu.hidden) { this._closeUnitMenu(); return true; }
    if (this.pickerMenu && !this.pickerMenu.hidden) {
      this.pickerMenu.hidden = true;
      if (this._pickerTrigger) this._pickerTrigger.focus();
      return true;
    }
    return false;
  }

  _sheetKeydown(event, container, close, trigger) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      if (trigger) trigger.focus({ preventScroll: true });
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...container.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => node.offsetParent !== null);
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
  }

  _toggleFormula(key) {
    if (this.showAllWork) {
      this.showAllWork = false;
      this.showAllInput.checked = false;
      this.openFormulas = new Set([key]);
    } else if (this.openFormulas.has(key)) {
      this.openFormulas.delete(key);
    } else {
      this.openFormulas.add(key);
    }
    this._renderFormulas();
    this.app.play('menu_move');
  }

  resetConstants() {
    this.constants = { ...CONSTANT_DEFAULTS };
    this.constantDirty.clear();
    const mode = MODE_BY_ID[this.modeId];
    for (const setting of mode.settings) {
      if (setting.type === 'note') continue;
      this.modeStore[this.modeId].settings[setting.key] = setting.default;
    }
    this._lastEditedKey = null;
    this._renderSettings();
    this._renderRows();
    this._solveNow();
    this.app.play('menu_move');
  }

  // ==== Input plumbing ====================================================
  _onInput(key, input) {
    if (input.dataset.locked === 'true') return;
    if (input.validity && input.validity.badInput) return;
    const raw = input.value;
    if (raw.trim() === '') {
      delete this.given[key];
      this._setRowState(key, 'missing');
      this._scheduleSolve();
      return;
    }
    const value = this._baseNumber(key, input.valueAsNumber);
    if (!Number.isFinite(value)) return;
    this.given[key] = value;
    this._lastEditedKey = key;
    this._setRowState(key, 'known');
    this._scheduleSolve();
  }

  _commitInput(key, input) {
    if (input.dataset.locked === 'true') return;
    if (input.validity && input.validity.badInput) {
      const last = this._lastCommitted[key];
      if (Number.isFinite(last)) {
        this.given[key] = last;
        input.value = fmt(this._displayNumber(key, last));
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
    const value = this._baseNumber(key, input.valueAsNumber);
    if (Number.isFinite(value)) {
      this.given[key] = value;
      this._lastEditedKey = key;
      input.value = fmt(this._displayNumber(key, value));
      this._lastCommitted[key] = value;
      this._setRowState(key, 'known');
    }
  }

  _setRowState(key, state, value = null) {
    const row = this.rows[key];
    if (!row) return;
    row.wrap.dataset.state = state;
    const field = row.field;
    const fullLabel = `${field.label}${field.unit ? `, in ${field.unit}` : ''}`;
    const note = Number.isFinite(value) && state !== 'known'
      ? `, ${fmt(value)}${field.unit ? ` ${field.unit}` : ''}` : '';
    row.input.setAttribute('aria-label', `${fullLabel}, state ${state}${note}`);
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
    if (this.modeId === 'journey') {
      this._solveJourney();
      return;
    }
    if (this.modeId === 'projectile') {
      this._solveProjectile();
      return;
    }
    if (this.modeId === 'rotational') {
      this._solveRotational();
      return;
    }
    if (this.modeId === 'torque') {
      this._solveTorque();
      return;
    }
    if (this.modeId === 'inertia') {
      this._solveInertia();
      return;
    }
    if (this.modeId !== 'bowling') {
      this._solveSuvat();
      return;
    }
    this._solveBowling();
  }

  _lockedKeys() {
    const locked = new Set();
    if (this.modeId === 'freefall') {
      const settings = this.modeStore.freefall.settings;
      locked.add('a');
      if (settings.direction === 'dropped') locked.add('u');
      if (settings.direction === 'up' && settings.atHighest) locked.add('v');
    }
    if (this.modeId === 'projectile') {
      const settings = this.modeStore.projectile.settings;
      if (settings.launchType === 'ground') locked.add('h0');
      if (settings.launchType === 'horizontal') locked.add('angle');
    }
    if (this.modeId === 'straight' && this.modeStore.straight.settings.constantSpeed) {
      locked.add('a');
    }
    if (this.modeId === 'rotational' && this.modeStore.rotational.settings.constantSpeed) {
      locked.add('alpha');
    }
    return locked;
  }

  _focusKey() {
    if (Object.keys(this.given).length === 0) return null;
    const locked = this._lockedKeys();
    if (this._lastAddedKey && this.rowKeys.includes(this._lastAddedKey)
        && !Number.isFinite(this.given[this._lastAddedKey])
        && !locked.has(this._lastAddedKey)) {
      return this._lastAddedKey;
    }
    const blank = this.rowKeys.find((key) => (
      !Number.isFinite(this.given[key]) && !locked.has(key) && key !== 'direction'));
    return blank || null;
  }

  _solveBowling() {
    const known = {};
    for (const key of this.constantDirty) known[key] = this.constants[key];
    Object.assign(known, this.given);
    this.solution = solveBowling({
      known,
      constants: this.constants,
      editedKey: this._lastEditedKey,
      focusKey: this._focusKey(),
    });
    this.solution.modeId = this.modeId;

    if (this._launchReady()) {
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
    if (this.state === 'idle') this._syncIdleStatus();
    this.syncControls();
    this._updateTimelineUi();
  }

  _suvatKey(key) {
    return this.modeId === 'freefall' && key === 'h' ? 's' : key;
  }

  _suvatMeta() {
    const meta = {};
    for (const field of MODE_BY_ID[this.modeId].variables) {
      meta[this._suvatKey(field.key)] = {
        key: this._suvatKey(field.key),
        label: field.label,
        unit: field.unit,
        symbol: field.symbol,
      };
    }
    return { ...SUVAT_META, ...meta };
  }

  _suvatFixed() {
    const fixed = {};
    if (this.modeId === 'straight') {
      if (this.modeStore.straight.settings.constantSpeed) {
        fixed.a = { value: 0, caption: 'Set by Constant speed' };
      }
      return fixed;
    }
    if (this.modeId !== 'freefall') return fixed;
    const settings = this.modeStore.freefall.settings;
    const typedGravity = Number(this.given.g);
    const gravity = Number.isFinite(typedGravity)
      ? typedGravity : (Number.isFinite(settings.gravity) ? settings.gravity : 9.8);
    const convention = settings.signConvention || 'notes';
    if (settings.direction === 'up') {
      fixed.a = { value: -gravity, caption: 'Set by Free Fall (a = −g)' };
    } else {
      fixed.a = {
        value: convention === 'notes' ? -gravity : gravity,
        caption: 'Set by Free Fall (a = −g)',
      };
    }
    if (settings.direction === 'dropped') {
      fixed.u = { value: 0, caption: 'Set by Dropped from rest' };
    }
    if (settings.direction === 'up' && settings.atHighest) {
      fixed.v = { value: 0, caption: 'Set by At the highest point' };
    }
    return fixed;
  }

  _suvatKnownValue(key) {
    const value = this.given[key];
    if (!Number.isFinite(value)) return null;
    if (this.modeId !== 'freefall') return value;
    const settings = this.modeStore.freefall.settings;
    const convention = settings.signConvention || 'notes';
    const direction = settings.direction;
    if (convention === 'notes' && (direction === 'down' || direction === 'dropped')) {
      if (key === 'h' || key === 'u' || key === 'v') return -Math.abs(value);
    }
    if (convention === 'travel'
        && (direction === 'down' || direction === 'dropped')
        && (key === 'h' || key === 'u' || key === 'v')) {
      return Math.abs(value);
    }
    if (key === 'u' && direction === 'down') return convention === 'notes' ? -Math.abs(value) : Math.abs(value);
    return value;
  }

  _suvatKnown() {
    const known = {};
    for (const key of this.rowKeys) {
      if (['displacement', 'distance', 'maxHeight', 'tApex', 'avgSpeed', 'avgVelocity'].includes(key)) continue;
      const value = this._suvatKnownValue(key);
      if (Number.isFinite(value)) known[this._suvatKey(key)] = value;
    }
    return known;
  }

  _solveSuvat() {
    const known = this._suvatKnown();
    const edited = this._lastEditedKey
      ? this._suvatKey(this._lastEditedKey) : null;
    this.solution = solveLinear({
      known,
      fixed: this._suvatFixed(),
      editedKey: edited,
      meta: this._suvatMeta(),
      focusKey: this._focusKey() ? this._suvatKey(this._focusKey()) : null,
      gravity: this.modeId === 'freefall'
        ? (Number.isFinite(Number(this.given.g))
          ? Number(this.given.g)
          : Number(this.modeStore.freefall.settings.gravity || 9.8))
        : null,
    });
    this.solution.modeId = this.modeId;
    addLinearExtras(this.solution, this.modeId);

    this._syncSimulationToSolution();
    this._renderSolution();
    if (this.state === 'idle') this._syncIdleStatus();
    this.syncControls();
    this._drawScene();
  }

  _finishGenericSolve() {
    this._syncSimulationToSolution();
    this._renderSolution();
    if (this.state === 'idle') this._syncIdleStatus();
    this.syncControls();
    this._drawScene();
    this._updateSnapshot();
  }

  _solveProjectile() {
    const settings = this.modeStore.projectile.settings;
    const known = {};
    for (const key of this.rowKeys) {
      if (Number.isFinite(this.given[key])) known[key] = this.given[key];
    }
    if (Number.isFinite(settings.barrierDistance) && settings.barrierEnabled
        && !Number.isFinite(known.targetR)) {
      known.targetR = settings.barrierDistance;
    }
    this.solution = solveProjectile({
      known,
      gravity: Number.isFinite(settings.gravity) ? settings.gravity : 9.8,
      editedKey: this._lastEditedKey,
      launchType: settings.launchType,
      focusKey: this._focusKey(),
    });
    this.solution.modeId = 'projectile';
    this.solution.needed = Math.max(1, 2 - Object.keys(known).filter(
      (key) => ['v0', 'angle', 'h0', 'R', 'T', 'H', 'targetR'].includes(key)).length);
    this._finishGenericSolve();
  }

  _solveRotational() {
    const known = {};
    for (const key of this.rowKeys) {
      if (Number.isFinite(this.given[key])) known[key] = this.given[key];
    }
    this.solution = solveRotational({
      known,
      editedKey: this._lastEditedKey,
      constantSpeed: !!this.modeStore.rotational.settings.constantSpeed,
      focusKey: this._focusKey(),
    });
    this.solution.modeId = 'rotational';
    this.solution.needed = Math.max(1, 3 - ['w0', 'w', 'alpha', 't', 'theta', 'revolutions', 'rpm']
      .filter((key) => Number.isFinite(this.solution.values[key])).length);
    this._finishGenericSolve();
  }

  _solveTorque() {
    const store = this.modeStore.torque;
    const known = {};
    for (const key of this.rowKeys) {
      if (key === 'direction' && this.given[key]) known.direction = this.given[key];
      else if (Number.isFinite(this.given[key])) known[key] = this.given[key];
    }
    if (!store.forces.length) store.forces = [{ F: 100, r: 0.2, angle: 90, direction: 1 }];
    // Keep the first force in step with the sidebar rows.
    for (const key of ['F', 'r', 'angle']) {
      if (Number.isFinite(known[key])) store.forces[0][key] = known[key];
    }
    if (known.direction) store.forces[0].direction = known.direction === 'cw' ? -1 : 1;
    this.solution = solveTorque({
      known,
      forces: store.forces,
      editedKey: this._lastEditedKey,
      focusKey: this._focusKey(),
    });
    this.solution.modeId = 'torque';
    this.solution.needed = 1;
    this._finishGenericSolve();
  }

  _solveInertia() {
    const settings = this.modeStore.inertia.settings;
    const known = {};
    for (const key of this.rowKeys) {
      if (Number.isFinite(this.given[key])) known[key] = this.given[key];
    }
    this.solution = solveInertia({
      known,
      submode: settings.submode,
      shape: settings.shape,
      customParts: this.modeStore.inertia.customParts,
      focusKey: this._focusKey(),
    });
    this.solution.modeId = 'inertia';
    this.solution.needed = 1;
    this._finishGenericSolve();
  }

  _solveJourney() {
    const store = this.modeStore.journey;
    this.solution = solveJourney(store.legs, store.typedResults);
    this.solution.modeId = 'journey';
    // Consume a successful back-solve so the legs and results stay in step.
    if (this.solution.solvedLeg) {
      const { index, key, value } = this.solution.solvedLeg;
      if (store.legs[index]) store.legs[index][key] = value;
      this.solution = solveJourney(store.legs, store.typedResults);
      this.solution.solvedLeg = { index, key, value };
    }
    this._syncSimulationToSolution();
    this._renderJourneySolution();
    this._renderStatus();
    if (this.state === 'idle') this._syncIdleStatus();
    this.syncControls();
    this._drawScene();
  }

  _syncSimulationToSolution() {
    const duration = this._modeDuration();
    this.simDuration = duration;
    if (this.state === 'idle' || this.state === 'done') {
      this.simTime = Math.min(this.simTime, duration);
      if (!duration) this.simTime = 0;
    } else if (this.state === 'running') {
      this.simTime = Math.min(this.simTime, duration);
    }
  }

  _modeDuration() {
    if (!this.solution) return 0;
    if (this.modeId === 'journey') {
      return Number.isFinite(this.solution.results.totalTime)
        ? Math.max(0, this.solution.results.totalTime) : 0;
    }
    if (this.modeId === 'projectile') {
      return Number.isFinite(this.solution.values.T) ? Math.max(0, this.solution.values.T) : 0;
    }
    if (this.modeId === 'torque') return 4;
    if (this.modeId === 'inertia') return 6;
    const values = this.solution.values || {};
    if (!Number.isFinite(values.t)) return 0;
    let duration = Math.max(0, values.t);
    if (this.modeId === 'freefall') {
      const settings = this.modeStore.freefall.settings;
      const gravity = settings.gravity || 9.8;
      if (settings.direction === 'up' && Number.isFinite(values.u) && values.u > 0) {
        duration = Math.max(duration, (2 * values.u) / gravity);
      }
    }
    return duration;
  }

  _runReady() {
    if (!this.solution || this.solution.status !== 'solved') return false;
    if (this.modeId === 'journey') {
      return Number.isFinite(this.solution.results.totalTime)
        && this.solution.results.totalTime > 0;
    }
    if (this.modeId === 'projectile') {
      return Number.isFinite(this.solution.values.T) && this.solution.values.T > 0;
    }
    if (this.modeId === 'torque' || this.modeId === 'inertia') return true;
    return Number.isFinite(this.solution.values.t) && this.solution.values.t >= 0;
  }

  _syncIdleStatus() {
    this._renderStatus();
  }

  _launchReady() {
    if (!this.solution || this.solution.status === 'conflict') return false;
    const values = this.solution.values;
    return LAUNCH_KEYS.every((key) => Number.isFinite(values[key]));
  }

  _renderSolution() {
    if (!this.solution) return;
    if (this.modeId === 'journey') {
      this._renderJourneySolution();
      return;
    }
    if (this.modeId !== 'bowling') {
      this._renderSuvatSolution();
      return;
    }
    this._renderBowlingSolution();
  }

  _renderBowlingSolution() {
    if (!this.solution) return;
    const solution = this.solution;
    const editable = this._editable();
    const conflictText = solution.status === 'conflict' ? this._conflictText(solution) : '';

    for (const key of this.rowKeys) {
      const row = this.rows[key];
      if (!row) continue;
      const source = solution.sources[key];
      const value = solution.values[key];
      let state = 'missing';
      // Only a row the player typed can be the contradictory value. A derived
      // row caught in the same equation stays pink/blank; red would imply it
      // is the one that is wrong.
      if (solution.conflictKeys.has(key) && source === 'known') state = 'conflict';
      else if (source === 'locked') state = 'locked';
      else if (source === 'known') state = 'known';
      else if (source === 'solved') state = 'solved';
      else if (source === 'auto') state = 'auto';

      if (row.lock) row.lock.hidden = state !== 'locked';
      this._setRowState(key, state, value);
      row.wrap.dataset.state = state;
      row.input.disabled = !editable;
      row.remove.disabled = !editable;
      row.input.setAttribute('aria-invalid', state === 'conflict' ? 'true' : 'false');
      const calculated = state === 'solved' || state === 'auto';
      // Keep a focused calculated field editable: the focus handler turns it
      // into an override, and re-rendering must not slam that door shut.
      if (document.activeElement !== row.input) row.input.readOnly = calculated;
      row.input.classList.toggle('is-calculated', calculated);

      const unit = row.field.unit ? ` ${row.field.unit}` : '';
      if (state === 'known') {
        row.input.title = `${row.field.help} Typed value. Clear it to calculate.`;
      } else if (state === 'conflict') {
        row.input.title = conflictText || row.field.help;
      } else if (state === 'solved' || state === 'auto') {
        row.input.title = `${row.field.help} Calculated${Number.isFinite(value) ? `: ${fmt(value)}${unit}` : ''}. Click to override.`;
      } else {
        row.input.title = `${row.field.help} Blank: this row can be calculated.`;
      }

      if (document.activeElement !== row.input) {
        if (Number.isFinite(value)) row.input.value = fmt(value);
        else row.input.value = '';
        this._lastCommitted[key] = state === 'known' && Number.isFinite(value) ? value : null;
      }

      this._renderFormula(key);
    }

    for (const field of CONST_FIELDS) {
      const row = this.constRows[field.key];
      if (!row) continue;
      const conflict = solution.conflictKeys.has(field.key) && this.constantDirty.has(field.key);
      const dirty = this.constantDirty.has(field.key);
      row.row.dataset.state = conflict ? 'conflict' : (dirty ? 'known' : 'default');
      row.input.disabled = !editable;
      row.input.setAttribute('aria-invalid', conflict ? 'true' : 'false');
      row.input.placeholder = fmt(field.default);
      if (document.activeElement !== row.input) {
        row.input.value = dirty ? fmt(this.constants[field.key]) : '';
      }
      if (conflict) row.input.title = conflictText || solution.message;
      else row.input.title = `${field.help} Blank uses ${fmt(field.default)}.`;
    }

    this._renderStatus();
    this._updatePins();
  }

  _renderSuvatSolution() {
    if (!this.solution) return;
    const solution = this.solution;
    const editable = this._editable();
    for (const key of this.rowKeys) {
      const row = this.rows[key];
      if (!row) continue;
      const suvatKey = this._suvatKey(key);
      const source = solution.sources[suvatKey] || 'missing';
      const value = solution.values[suvatKey];
      const isLocked = source === 'locked';
      let state = 'missing';
      if (solution.conflictKeys.has(suvatKey)) state = 'conflict';
      else if (isLocked) state = 'locked';
      else if (source === 'known') state = 'known';
      else if (source === 'solved') state = 'solved';
      else if (source === 'auto') state = 'auto';

      if (row.isSelect) {
        row.wrap.dataset.state = state;
        row.input.disabled = !editable;
        row.remove.disabled = !editable;
        row.input.dataset.locked = state === 'locked' ? 'true' : 'false';
        if (document.activeElement !== row.input) {
          row.input.value = typeof value === 'string' ? value : '';
        }
        row.how.hidden = true;
        row.note.hidden = true;
        if (row.lock) row.lock.hidden = true;
        continue;
      }

      this._setRowState(key, state, value);
      row.input.disabled = !editable;
      row.remove.disabled = !editable;
      row.input.setAttribute('aria-invalid', state === 'conflict' ? 'true' : 'false');
      row.input.dataset.locked = state === 'locked' ? 'true' : 'false';
      const calculated = state === 'solved' || state === 'auto';
      if (document.activeElement !== row.input) {
        row.input.readOnly = calculated || state === 'locked';
      }
      row.input.classList.toggle('is-calculated', calculated);

      const unit = row.field.unit ? ` ${row.field.unit}` : '';
      if (state === 'known') {
        row.input.title = `${row.field.help || ''} Typed value. Clear it to calculate.`;
      } else if (state === 'conflict') {
        row.input.title = solution.message || row.field.help || '';
      } else if (state === 'solved' || state === 'auto') {
        row.input.title = `${row.field.help || ''} Calculated${Number.isFinite(value) ? `: ${fmt(value)}${unit}` : ''}. Click to override.`;
      } else if (state === 'locked') {
        const caption = solution.lockedCaptions[suvatKey] || 'Set by this mode';
        row.input.title = `${row.field.help || ''} ${caption}.`;
      } else {
        row.input.title = `${row.field.help || ''} Blank: this row can be calculated.`;
      }

      if (document.activeElement !== row.input) {
        if (Number.isFinite(value)) row.input.value = fmt(this._displayNumber(key, value));
        else row.input.value = '';
        this._lastCommitted[key] = state === 'known' && Number.isFinite(value) ? value : null;
      }

      // The lock icon and its caption live in the label, but only the value is
      // coloured; labels never take the state colour.
      if (row.lock) row.lock.hidden = !isLocked;
      const caption = isLocked
        ? (solution.lockedCaptions[suvatKey] || 'Set by this mode')
        : (this.modeId === 'freefall' && Number.isFinite(value)
          ? this._freeFallShortNote(key, value) : '');
      row.labelNote.hidden = !caption;
      if (caption && row.labelNote.textContent !== caption) row.labelNote.textContent = caption;
      row.labelNote.title = this.modeId === 'freefall' && Number.isFinite(value)
        ? this._freeFallNote(key, value) : caption;
      row.note.hidden = true;

      this._renderFormula(key);
    }

    this._renderStatus();
  }

  _freeFallShortNote(key, value) {
    const settings = this.modeStore.freefall.settings;
    const positiveIsUp = (settings.signConvention || 'notes') !== 'travel'
      || settings.direction === 'up';
    if (key === 'u') {
      if (Math.abs(value) < 1e-9) return 'from rest';
      return value > 0
        ? (positiveIsUp ? 'upward' : 'downward')
        : (positiveIsUp ? 'downward' : 'upward');
    }
    if (key === 'v') {
      if (Math.abs(value) < 1e-9) return 'at rest';
      return value > 0
        ? (positiveIsUp ? 'upward' : 'downward')
        : (positiveIsUp ? 'downward' : 'upward');
    }
    if (key === 'h') {
      if (Math.abs(value) < 1e-9) return 'at release';
      return value > 0
        ? (positiveIsUp ? 'above release' : 'below release')
        : (positiveIsUp ? 'below release' : 'above release');
    }
    return '';
  }

  _freeFallNote(key, value) {
    const settings = this.modeStore.freefall.settings;
    const positiveIsUp = (settings.signConvention || 'notes') !== 'travel'
      || settings.direction === 'up';
    const unit = this._fieldFor(key).unit;
    const velocityWord = (v) => (v > 0
      ? (positiveIsUp ? 'upward' : 'downward')
      : (positiveIsUp ? 'downward' : 'upward'));
    const heightWord = (v) => (v > 0
      ? (positiveIsUp ? 'above the release point' : 'below the release point')
      : (positiveIsUp ? 'below the release point' : 'above the release point'));
    if (key === 't') return '';
    if (key === 'u') {
      if (Math.abs(value) < 1e-9) return '0 m/s from rest';
      return `${fmt(value)} ${unit} (${velocityWord(value)})`;
    }
    if (key === 'v') {
      if (Math.abs(value) < 1e-9) return '0 m/s at rest';
      return `${fmt(value)} ${unit} (${velocityWord(value)})`;
    }
    if (key === 'h') {
      if (Math.abs(value) < 1e-9) return 'at the release point';
      return `${fmt(value)} ${unit} (${heightWord(value)})`;
    }
    return '';
  }

  // ==== Journey sidebar ===================================================
  _journeyBlankCount() {
    let blanks = 0;
    for (const leg of this.modeStore.journey.legs) {
      if (!Number.isFinite(leg.distance)) blanks += 1;
      if (!Number.isFinite(leg.time)) blanks += 1;
    }
    return blanks;
  }

  _journeyResultsVisible() {
    const blanks = this._journeyBlankCount();
    // The block is the completed result summary, and it is also the one place
    // a result can be typed to back-solve a single blank leg value. With more
    // than one blank there is nothing meaningful to show yet.
    return blanks <= 1;
  }

  _renderJourneyRows() {
    const store = this.modeStore.journey;
    const list = div('lab-leg-list', this.fieldList);
    this.journeyRows = [];
    store.legs.forEach((leg, index) => this._buildLegRow(list, leg, index));

    this.journeyResults = div('lab-results', this.fieldList);
    this.journeyResults.setAttribute('role', 'status');
    this.journeyResults.setAttribute('aria-live', 'polite');
    this.resultRows = {};
    this._renderJourneyResults();
  }

  _buildLegRow(parent, leg, index) {
    const card = div('lab-leg', parent);
    const head = div('lab-leg-head', card);
    el('span', 'lab-leg-title', head, `Leg ${index + 1}`);
    const remove = el('button', 'lab-remove lab-leg-remove', head);
    remove.innerHTML = iconSvg('minus', 16);
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove leg ${index + 1}`);
    remove.addEventListener('pointerdown', (event) => event.stopPropagation());
    remove.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      this._removeLeg(index);
    });

    const grid = div('lab-leg-grid', card);
    const distance = this._legField(grid, 'distance', `leg-${index}-distance`,
      'Distance', 'm', leg.distance, 0.1, 0);
    const directionLabel = div('lab-leg-field', grid);
    const directionText = el('label', 'lab-leg-label', directionLabel, 'Direction');
    directionText.htmlFor = `lab-leg-${index}-direction`;
    const direction = el('select', 'lab-field-input lab-select lab-leg-select', directionLabel);
    direction.id = `lab-leg-${index}-direction`;
    const east = el('option', '', direction, 'East');
    east.value = '1';
    const west = el('option', '', direction, 'West');
    west.value = '-1';
    direction.value = leg.direction === -1 ? '-1' : '1';
    direction.setAttribute('aria-label', `Leg ${index + 1} direction`);
    const time = this._legField(grid, 'time', `leg-${index}-time`,
      'Time', 's', leg.time, 0.01, 0);

    direction.addEventListener('keydown', (event) => event.stopPropagation());
    direction.addEventListener('change', () => {
      this.modeStore.journey.legs[index].direction = direction.value === '-1' ? -1 : 1;
      this.modeStore.journey.typedResults = {};
      this._scheduleSolve();
    });

    this.journeyRows[index] = {
      card, distance, direction, time, remove,
    };
  }

  _legField(parent, key, id, labelText, unit, value, step, min) {
    const wrap = div('lab-leg-field', parent);
    const label = el('label', 'lab-leg-label', wrap, labelText);
    label.htmlFor = id;
    const input = el('input', 'lab-field-input lab-leg-input', wrap);
    input.type = 'number';
    input.id = id;
    input.step = String(step);
    if (min !== undefined) input.min = String(min);
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = '?';
    input.value = Number.isFinite(value) ? fmt(value) : '';
    input.setAttribute('aria-label', `${labelText}, in ${unit}`);
    const unitNode = el('span', 'lab-leg-unit', wrap, unit);
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    input.addEventListener('input', () => {
      if (input.validity && input.validity.badInput) return;
      const index = Number(id.split('-')[1]);
      const raw = input.value.trim();
      const store = this.modeStore.journey;
      store.legs[index][key] = raw === '' ? null : input.valueAsNumber;
      if (!Number.isFinite(store.legs[index][key])) store.legs[index][key] = null;
      store.typedResults = {};
      store.lastEditedKey = `leg-${index}-${key}`;
      this._scheduleSolve();
    });
    input.addEventListener('blur', () => {
      const index = Number(id.split('-')[1]);
      const raw = this.modeStore.journey.legs[index][key];
      input.value = Number.isFinite(raw) ? fmt(raw) : '';
      this._solveNow();
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
        this.bowl();
      }
    });
    return { wrap, label, input, unitNode };
  }

  _addLeg() {
    if (!this._editable()) return;
    this.modeStore.journey.legs.push({ distance: null, direction: 1, time: null });
    this.modeStore.journey.typedResults = {};
    this._renderRows();
    this._solveNow();
    this.app.play('menu_move');
    const last = this.journeyRows[this.journeyRows.length - 1];
    if (last) last.distance.input.focus({ preventScroll: true });
  }

  _removeLeg(index) {
    if (!this._editable()) return;
    const store = this.modeStore.journey;
    if (store.legs.length <= 1) {
      store.legs[0] = { distance: null, direction: 1, time: null };
    } else {
      store.legs.splice(index, 1);
    }
    store.typedResults = {};
    this._renderRows();
    this._solveNow();
    this.app.play('menu_move');
    this.addButton.focus({ preventScroll: true });
  }

  _renderJourneyResults() {
    if (!this.journeyResults) return;
    const visible = this._journeyResultsVisible();
    this.journeyResults.hidden = !visible;
    this.journeyResults.innerHTML = '';
    this.resultRows = {};
    if (!visible) {
      this.journeyResults.hidden = true;
      return;
    }
    el('div', 'lab-results-title', this.journeyResults, 'Results');
    for (const item of JOURNEY_RESULTS) this._buildResultRow(item);
  }

  _buildResultRow(item) {
    const row = div('lab-result-row', this.journeyResults);
    row.dataset.key = item.key;
    const main = div('lab-result-main', row);
    const label = el('label', 'lab-result-label', main, item.label);
    label.htmlFor = `lab-result-${item.key}`;
    const input = el('input', 'lab-field-input lab-result-input', main);
    input.type = 'number';
    input.id = `lab-result-${item.key}`;
    input.step = '0.01';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = '?';
    input.setAttribute('aria-describedby', 'lab-calc-status');
    input.setAttribute('aria-label', item.label);
    el('span', 'lab-field-unit', main, item.unit);
    const how = el('button', 'lab-how', main, 'How?');
    how.type = 'button';
    how.tabIndex = -1;
    how.setAttribute('aria-label', `How was ${item.label} calculated?`);
    how.setAttribute('aria-expanded', 'false');
    how.setAttribute('aria-controls', `lab-result-formula-${item.key}`);
    how.addEventListener('pointerdown', (event) => event.stopPropagation());
    how.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    });
    const formula = div('lab-formula', row);
    formula.id = `lab-result-formula-${item.key}`;
    formula.hidden = true;
    const note = div('lab-field-note', row);
    note.hidden = true;

    input.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      if (input.readOnly) input.readOnly = false;
    });
    input.addEventListener('focus', () => {
      input._labDirty = false;
      if (input.readOnly) input.readOnly = false;
    });
    input.addEventListener('input', () => {
      if (input.validity && input.validity.badInput) return;
      input._labDirty = true;
      const raw = input.value.trim();
      const store = this.modeStore.journey;
      if (raw === '') delete store.typedResults[item.key];
      else if (Number.isFinite(input.valueAsNumber)) {
        store.typedResults[item.key] = input.valueAsNumber;
      }
      this._scheduleSolve();
    });
    input.addEventListener('blur', () => {
      input._labDirty = false;
      this._solveNow();
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        if (input._labDirty) input._labDirty = false;
        input.blur();
        this.bowl();
      }
    });
    how.addEventListener('click', (event) => {
      event.stopPropagation();
      const key = `result:${item.key}`;
      if (this.showAllWork) {
        this.showAllWork = false;
        this.showAllInput.checked = false;
        this.openFormulas = new Set([key]);
      } else if (this.openFormulas.has(key)) {
        this.openFormulas.delete(key);
      } else {
        this.openFormulas.add(key);
      }
      this._renderJourneySolution();
      this.app.play('menu_move');
    });
    this.resultRows[item.key] = { row, main, label, input, how, formula, note, item };
  }

  _renderJourneySolution() {
    if (!this.solution) return;
    const store = this.modeStore.journey;
    const editable = this._editable();
    for (let index = 0; index < this.journeyRows.length; index += 1) {
      const row = this.journeyRows[index];
      const leg = store.legs[index];
      if (!row || !leg) continue;
      for (const key of ['distance', 'time']) {
        const input = row[key].input;
        input.disabled = !editable;
        const value = leg[key];
        const missing = !Number.isFinite(value);
        row[key].wrap.dataset.state = missing ? 'missing' : 'known';
        if (document.activeElement !== input) input.value = Number.isFinite(value) ? fmt(value) : '';
      }
      row.direction.disabled = !editable;
      row.remove.disabled = !editable;
    }

    if (!this.journeyResults || this.journeyResults.hidden) this._renderJourneyResults();
    const visible = this._journeyResultsVisible();
    if (this.journeyResults && !this.journeyResults.hidden !== visible) {
      this._renderJourneyResults();
    }
    if (!visible || !this.solution.results) return;

    for (const item of JOURNEY_RESULTS) {
      const row = this.resultRows[item.key];
      if (!row) continue;
      const value = this.solution.results[item.key];
      const source = this.solution.sources[item.key];
      const typedValue = store.typedResults[item.key];
      const display = Number.isFinite(value)
        ? value
        : (Number.isFinite(typedValue) ? typedValue : null);
      const usedTyped = Number.isFinite(typedValue)
        && (!Number.isFinite(value) || source === 'known');
      const conflict = this.solution.conflictKeys.has(item.key);
      const state = conflict ? 'conflict'
        : (!Number.isFinite(display) ? 'missing'
          : ((source === 'known' || usedTyped) ? 'known' : 'solved'));
      row.row.dataset.state = state;
      row.input.disabled = !editable;
      row.input.setAttribute('aria-invalid', conflict ? 'true' : 'false');
      if (document.activeElement !== row.input) {
        row.input.value = Number.isFinite(display) ? fmt(display) : '';
        row.input.readOnly = state === 'solved';
      }
      row.input.classList.toggle('is-calculated', state === 'solved');
      const text = this._journeyResultFormula(item.key);
      const formulaKey = `result:${item.key}`;
      const expanded = !!text && (this.showAllWork || this.openFormulas.has(formulaKey));
      row.how.hidden = !text;
      row.how.classList.toggle('active', expanded);
      row.how.setAttribute('aria-expanded', String(expanded));
      row.formula.hidden = !expanded;
      if (expanded && row.formula.textContent !== text) row.formula.textContent = text;

      let note = '';
      if ((item.key === 'displacement' || item.key === 'avgVelocity') && Number.isFinite(value)) {
        note = `${fmt(Math.abs(value))} ${item.unit} ${value > 0 ? 'east' : (value < 0 ? 'west' : '')}`.trim();
      }
      row.note.hidden = !note;
      if (note && row.note.textContent !== note) row.note.textContent = note;
    }
    this._renderStatus();
  }

  _journeyResultFormula(key) {
    if (!this.solution || !this.solution.results) return '';
    const result = this.solution.results;
    if (!Number.isFinite(result[key])) return '';
    const store = this.modeStore.journey;
    const legs = store.legs;
    if (key === 'totalDistance') {
      const parts = legs.map((leg) => fmt(leg.distance || 0));
      return `Σ |d| = ${parts.join(' + ')} = ${fmt(result.totalDistance)} m`;
    }
    if (key === 'displacement') {
      const parts = legs.map((leg) => `${leg.direction === -1 ? '−' : '+'}${fmt(leg.distance || 0)}`);
      return `Σ direction·d = ${parts.join(' ')} = ${fmt(result.displacement)} m ${result.displacement >= 0 ? 'east' : 'west'}`;
    }
    if (key === 'totalTime') {
      const parts = legs.map((leg) => fmt(leg.time || 0));
      return `Σ t = ${parts.join(' + ')} = ${fmt(result.totalTime)} s`;
    }
    if (key === 'avgSpeed') {
      return `total distance / total time = ${fmt(result.totalDistance)} / ${fmt(result.totalTime)} = ${fmt(result.avgSpeed)} m/s`;
    }
    if (key === 'avgVelocity') {
      return `displacement / total time = ${fmt(result.displacement)} / ${fmt(result.totalTime)} = ${fmt(result.avgVelocity)} m/s ${result.avgVelocity >= 0 ? 'east' : 'west'}`;
    }
    return '';
  }

  _renderFormula(key) {
    const row = this.rows[key];
    if (!row || !this.solution) return;
    const text = this._formulaText(key);
    const expanded = !!text && (this.showAllWork || this.openFormulas.has(key));
    row.how.hidden = !text;
    row.how.classList.toggle('active', expanded);
    row.how.setAttribute('aria-expanded', String(expanded));
    row.formula.hidden = !expanded;
    if (expanded && row.formula.textContent !== text) row.formula.textContent = text;
  }

  _renderFormulas() {
    for (const key of this.rowKeys) this._renderFormula(key);
  }

  _formulaText(key) {
    if (!this.solution) return '';
    const row = this.rows[key];
    if (!row) return '';
    const unit = row.field.unit ? ` ${row.field.unit}` : '';
    if (this.modeId !== 'bowling') {
      const suvatKey = this._suvatKey(key);
      const value = this.solution.values[suvatKey];
      const source = this.solution.sources[suvatKey];
      const label = row.field.label;
      if (source === 'locked' && Number.isFinite(value)) {
        const caption = this.solution.lockedCaptions[suvatKey] || 'Set by this mode';
        return `${label} = ${fmt(value)}${unit} (${caption})`;
      }
      if (source === 'auto' && Number.isFinite(value)) {
        return `${label} = ${fmt(value)}${unit} (soft default)`;
      }
      if (source !== 'solved') return '';
      const entry = this.solution.work.find((item) => item.key === suvatKey);
      if (!entry) return '';
      const notes = [];
      if (entry.note) notes.push(entry.note);
      if (entry.softUsed && entry.softUsed.length) {
        notes.push(`Using the default ${entry.softUsed.map((soft) => this._softLabel(soft)).join(', ')}.`);
      }
      if (this.modeId === 'inertia' && key === 'I') {
        const values = this.solution.values;
        if (Number.isFinite(values.R) && values.R !== 0) {
          notes.push('Radius doubled: I × 4.');
        } else if (Number.isFinite(values.L) && values.L !== 0) {
          notes.push('Length doubled: I × 4.');
        }
      }
      const note = notes.length ? ` — ${notes.join(' ')}` : '';
      return `${label} = ${entry.expr} = ${entry.sub} = ${fmt(entry.value)}${unit}${note}`;
    }
    const value = this.solution.values[key];
    const source = this.solution.sources[key];
    const label = VAR_NAMES[key] || row.field.label;
    if (source === 'auto' && Number.isFinite(value)) {
      return `${label} = default = ${fmt(value)}${unit}`;
    }
    if (source !== 'solved' && source !== 'locked') return '';
    const entry = this.solution.work.find((item) => item.key === key);
    if (!entry) {
      if (source === 'locked') return `${label} = ${fmt(value)}${unit} (${this.solution.lockedCaptions[key] || 'set by the mode'})`;
      return '';
    }
    const notes = [];
    if (entry.note) notes.push(entry.note);
    if (entry.others && entry.others.length) {
      notes.push(`Also valid: ${entry.others.map((other) => `${fmt(other)}${unit}`).join(', ')}.`);
    }
    if (entry.softUsed && entry.softUsed.length) {
      notes.push(`Using the default ${entry.softUsed.map((soft) => this._softLabel(soft)).join(', ')}.`);
    }
    const note = notes.length ? ` — ${notes.join(' ')}` : '';
    return `${entry.label} = ${entry.expr} = ${entry.sub} = ${fmt(entry.value)}${unit}${note}`;
  }

  _softLabel(key) {
    const meta = this._fieldFor(key);
    if (key === 'length') return `lane length ${fmt(this.solution.values.length)} m`;
    if (key === 'g') return `gravity ${fmt(this.solution.values.g)} m/s²`;
    return `${meta.label.toLowerCase()} ${Number.isFinite(this.solution.values[key])
      ? fmt(this.solution.values[key]) : ''}`.trim();
  }

  _renderStatus() {
    if (!this.calcStatus) return;
    const solution = this.solution;
    if (!solution) return;

    if (this.modeId === 'journey') {
      this._renderJourneyStatus(solution);
      return;
    }

    if (solution.status === 'conflict' || solution.status === 'impossible') {
      this._paintStatus('conflict', solution.message || 'These values disagree.', []);
      return;
    }

    if (solution.status === 'solved') {
      let text = 'All values found.';
      const allTyped = solution.work.length === 0 && this.rowKeys.length > 0
        && this.rowKeys.every((key) => {
          const source = solution.sources[this._suvatKey(key)];
          return source === 'known' || source === 'locked';
        });
      if (this.modeId === 'torque') {
        text = solution.seesaw
          ? 'Seesaw balance solved.'
          : (solution.equilibrium
            ? 'Rotational equilibrium: yes — net torque is 0.'
            : `Rotational equilibrium: no — net torque ${fmt(solution.values.netTorque)} N·m.`);
      } else if (allTyped) {
        text = 'All values typed.';
      }
      this._paintStatus('solved', text, solution.noteList || []);
      return;
    }

    const suggestions = solution.suggestions || [];
    const chips = suggestions.map((key) => ({
      key: this._rowKeyFor(key),
      label: this._fieldFor(key).label,
    }));
    const text = guidance(solution, (key) => this._fieldFor(key).label, solution.needed || 1);
    this._paintStatus('underdetermined', text, solution.noteList || [], chips);
  }

  _renderJourneyStatus(solution) {
    let state = 'underdetermined';
    let text = '';
    if (solution.status === 'conflict' || solution.status === 'impossible') {
      state = 'conflict';
      text = solution.message || 'These values disagree.';
    } else if (solution.status === 'solved') {
      state = 'solved';
      const allTyped = JOURNEY_RESULTS.every(
        (item) => solution.sources[item.key] === 'known');
      text = allTyped ? 'All results typed.' : 'Journey results complete.';
    } else {
      const blanks = this._journeyBlankCount();
      text = solution.message || (blanks === 1
        ? 'Type a result to solve the blank, or fill the last leg value.'
        : 'Fill the legs to see results.');
    }
    this._paintStatus(state, text, []);
  }

  _paintStatus(state, text, notes = [], chips = []) {
    if (!this.calcStatus) return;
    this.calcStatus.dataset.state = state;
    this.calcStatus.innerHTML = '';
    const line = div('lab-status-line', this.calcStatus);
    line.textContent = text;
    if (chips.length) {
      const wrap = div('lab-status-chips', this.calcStatus);
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', 'Values that would complete the calculation');
      for (const chip of chips) {
        const button = el('button', 'lab-chip', wrap, chip.label);
        button.type = 'button';
        button.dataset.key = chip.key;
        button.addEventListener('pointerdown', (event) => event.stopPropagation());
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          this._addRow(chip.key);
          this.app.play('menu_move');
        });
      }
    }
    for (const note of notes) {
      const row = div('lab-status-note', this.calcStatus);
      const icon = el('span', 'lab-status-note-icon', row);
      icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.6" r="0.8" fill="currentColor" stroke="none"/></svg>';
      el('span', 'lab-status-note-text', row, note);
    }
    this.calcStatus.title = [text, ...notes].join(' ');
  }

  _conflictText(solution = this.solution) {
    if (!solution || solution.status !== 'conflict') return '';
    return solution.message || 'Values conflict.';
  }

  // ==== Lifecycle =========================================================
  onShow(kwargs = {}) {
    this.app.stage.classList.add('lab-active');
    this.app.setCameraView('game');
    setShadowFocus(0.0, 9.0, 10.4);
    this._closeAddMenu();
    this._closeExamples();
    this._closeLabs(false);
    if (this.settingsSheet) this.settingsSheet.hidden = true;
    this._closeMoreMenu();
    this._closeDetails();
    this._closeDrawer();
    this._syncDrawerA11y();
    this.editMode = false;

    // Bowling is the default mode every time the Lab opens. Per-mode values
    // survive mode switches inside the session, but opening the Lab starts on
    // the lane.
    if (this.labId !== 'bowling') this._switchLab('bowling', { silent: true });
    this._syncLabUi();

    if (kwargs.throw) {
      const throwData = kwargs.throw;
      const incoming = {
        start: throwData.lateral_position,
        aim: Number.isFinite(throwData.launch_angle)
          ? throwData.launch_angle * 180 / Math.PI : undefined,
        hook: throwData.spin_omega,
        speed: throwData.speed,
      };
      let changedRows = false;
      for (const [key, value] of Object.entries(incoming)) {
        if (!Number.isFinite(value)) continue;
        this.given[key] = value;
        if (!this.rowKeys.includes(key)) {
          this.rowKeys.push(key);
          changedRows = true;
        }
      }
      if (changedRows) this._renderRows();
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
    // out of the drawer before the root is hidden.
    this._closeAddMenu();
    this._closeExamples();
    this._closeStatMenu();
    this._closeLabs(false);
    if (this.settingsSheet) this.settingsSheet.hidden = true;
    this._closeMoreMenu();
    this._closeDrawer(false);
    super.hide();
    this.app.stage.classList.remove('lab-active');
    this.app.stage.classList.remove('lab-2d');
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
    this.state = 'idle';
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
    this._controlsKey = '';
    this._renderSolution();
    this._syncIdleStatus();
    this.syncControls();
    this._updateTimelineUi();
  }

  _resetSimulation(options = {}) {
    this.state = 'idle';
    this.paused = false;
    this.simTime = 0;
    this.simDuration = this.modeId === 'bowling' ? 0 : this._modeDuration();
    this.timelineIndex = null;
    if (this.banner) {
      this.banner.textContent = '';
      this.banner.dataset.kind = '';
    }
    this._drawScene();
    this._updateTimelineUi();
    this.syncControls();
    if (!options.silent) {
      this.status(this._runReady()
        ? `ready — press ${MODE_BY_ID[this.modeId].actionLabel} to start`
        : (this.calcStatus ? this.calcStatus.textContent : 'add a value to run'));
    }
  }

  _beginSimulation() {
    this.simDuration = this._modeDuration();
    if (!(this.simDuration > 0)) return false;
    this._closeDetails();
    this._closeMoreMenu();
    this.simTime = 0;
    this.state = 'running';
    this.paused = false;
    this.banner.textContent = '';
    this.banner.dataset.kind = '';
    this._controlsKey = '';
    this.status(`running — ${MODE_BY_ID[this.modeId].label.toLowerCase()} · drag the timeline any time`);
    this._drawScene();
    this._updateTimelineUi();
    this.syncControls();
    return true;
  }

  _updateSimulation(dt) {
    if (this.state === 'running' && !this.paused) {
      this.simTime += dt;
      if (this.simTime >= this.simDuration) {
        this.simTime = this.simDuration;
        this.state = 'done';
        this.paused = false;
        this.banner.textContent = 'RUN COMPLETE';
        this.banner.dataset.kind = '';
        this.status('run complete — drag the timeline or run again');
        this._controlsKey = '';
      }
    }
    this._drawScene();
    this._updateTimelineUi();
    this.syncControls();
  }

  _sceneState() {
    const values = (this.solution && this.solution.values) || {};
    if (this.modeId === 'freefall') {
      const settings = this.modeStore.freefall.settings;
      return {
        direction: settings.direction,
        signConvention: settings.signConvention || 'notes',
        gravity: Number.isFinite(settings.gravity) ? settings.gravity : 9.8,
        u: values.u,
        v: values.v,
        h: values.s,
        t: values.t,
        a: values.a,
      };
    }
    if (this.modeId === 'straight') {
      return {
        u: values.u,
        v: values.v,
        s: values.s,
        t: values.t,
        a: values.a,
        body: this.modeStore.straight.settings.body,
      };
    }
    if (this.modeId === 'journey') {
      return {
        legs: this.modeStore.journey.legs,
        results: (this.solution && this.solution.results) || {},
      };
    }
    if (this.modeId === 'projectile') {
      const settings = this.modeStore.projectile.settings;
      return {
        values,
        gravity: Number.isFinite(settings.gravity) ? settings.gravity : 9.8,
        launchType: settings.launchType,
        targetYTyped: !!(this.solution && this.solution.sources
          && this.solution.sources.yTarget === 'known'),
        barrierEnabled: !!settings.barrierEnabled,
        barrierDistance: settings.barrierDistance,
        barrierHeight: settings.barrierHeight,
      };
    }
    if (this.modeId === 'rotational') {
      return {
        values,
        rolling: !!this.modeStore.rotational.settings.rolling,
      };
    }
    if (this.modeId === 'torque') {
      return {
        values,
        forces: this.modeStore.torque.forces,
        scene: this.modeStore.torque.settings.scene,
        netDirection: this.solution ? this.solution.netDirection : '',
      };
    }
    if (this.modeId === 'inertia') {
      return {
        values,
        submode: this.modeStore.inertia.settings.submode,
        shape: this.modeStore.inertia.settings.shape,
        solution: this.solution,
      };
    }
    return {};
  }

  _drawScene() {
    if (this.modeId === 'bowling' || !this.scene2d) return;
    this.scene2d.render(this.modeId, this._sceneState(), this.simTime, this._reducedMotion);
  }

  _timelineDuration() {
    if (this.modeId === 'bowling') return this.timeline.duration();
    return this.simDuration || this._modeDuration();
  }

  _scrubFraction(fraction) {
    if (this.modeId === 'bowling') {
      const index = this.timeline.indexAt(fraction * this.timeline.duration());
      this.scrubTo(index);
      return;
    }
    const total = this._timelineDuration();
    if (!(total > 0)) return;
    this.simTime = Math.max(0, Math.min(total, fraction * total));
    this.state = 'running';
    this.paused = true;
    this._drawScene();
    this._updateTimelineUi();
    this.syncControls();
    this.status(`PAUSED at t = ${fmt(this.simTime)} s`);
  }

  _timelineCurrentTime() {
    if (this.modeId === 'bowling') {
      const deck = this.app.game ? this.app.game.pins.deck : null;
      return Number.isFinite(deck && deck.elapsed) ? deck.elapsed : 0;
    }
    return this.simTime || 0;
  }

  _scrubToTime(time) {
    const total = this._timelineDuration();
    if (!(total > 0)) {
      this.status('There is no run to scrub yet.', true);
      return;
    }
    if (!Number.isFinite(time) || time < 0 || time > total + 1e-9) {
      this.status(`Time must be between 0 and ${fmt(total)} s.`, true);
      if (this.tlTimeInput) this.tlTimeInput.value = fmt(this._timelineCurrentTime());
      return;
    }
    if (document.activeElement === this.tlTimeInput) this.tlTimeInput.blur();
    if (this.modeId === 'bowling') {
      const index = this.timeline.indexAt(Math.max(0, Math.min(total, time)));
      this.scrubTo(index);
    } else {
      this.simTime = Math.max(0, Math.min(total, time));
      this.state = 'running';
      this.paused = true;
      this._drawScene();
      this._updateTimelineUi();
      this.syncControls();
      this.status(`PAUSED at t = ${fmt(this.simTime)} s`);
    }
    this._updateSnapshot();
  }

  _commitTimeInput() {
    if (!this.tlTimeInput) return;
    const value = this.tlTimeInput.valueAsNumber;
    if (!Number.isFinite(value)) {
      this.tlTimeInput.value = fmt(this._timelineCurrentTime());
      return;
    }
    this._scrubToTime(value);
  }

  _peakTime() {
    if (!this.solution) return null;
    if (this.modeId === 'freefall' && this.modeStore.freefall.settings.direction === 'up') {
      const u = this.solution.values.u;
      const g = this.modeStore.freefall.settings.gravity || 9.8;
      return Number.isFinite(u) && u > 0 ? u / g : null;
    }
    if (this.modeId === 'projectile') {
      const apex = this.solution.values.timeApex;
      return Number.isFinite(apex) ? apex : null;
    }
    return null;
  }

  _jumpToMoment(kind) {
    const total = this._timelineDuration();
    if (!(total > 0)) return;
    let time = 0;
    if (kind === 'end') time = total;
    else if (kind === 'half') time = total / 2;
    else if (kind === 'peak') time = this._peakTime() ?? total / 2;
    this._scrubToTime(time);
  }

  // ==== Snapshot ==========================================================
  _statDefinitions() {
    if (this.modeId === 'bowling') {
      return [
        { key: 'z', label: 'Ball position', unit: 'm' },
        { key: 'speed', label: 'Speed', unit: 'm/s' },
        { key: 'spin', label: 'Spin rate', unit: 'rad/s' },
        { key: 'pins', label: 'Pins down', unit: '' },
        { key: 't', label: 'Time', unit: 's' },
      ];
    }
    if (this.modeId === 'freefall' || this.modeId === 'straight') {
      return [
        { key: 'pos', label: this.modeId === 'freefall' ? 'Height' : 'Position', unit: 'm' },
        { key: 'v', label: 'Velocity', unit: 'm/s' },
        { key: 'a', label: 'Acceleration', unit: 'm/s²' },
        { key: 'speed', label: 'Speed', unit: 'm/s' },
        { key: 'distance', label: 'Distance', unit: 'm' },
        { key: 't', label: 'Time', unit: 's' },
      ];
    }
    if (this.modeId === 'journey') {
      return [
        { key: 'position', label: 'Position', unit: 'm' },
        { key: 'distance', label: 'Distance', unit: 'm' },
        { key: 'leg', label: 'Leg', unit: '' },
        { key: 't', label: 'Time', unit: 's' },
      ];
    }
    if (this.modeId === 'projectile') {
      return [
        { key: 'x', label: 'Horizontal position', unit: 'm' },
        { key: 'y', label: 'Height', unit: 'm' },
        { key: 'vx', label: 'Horizontal velocity', unit: 'm/s' },
        { key: 'vy', label: 'Vertical velocity', unit: 'm/s' },
        { key: 'speed', label: 'Speed', unit: 'm/s' },
        { key: 'dir', label: 'Direction', unit: 'deg' },
        { key: 't', label: 'Time', unit: 's' },
      ];
    }
    if (this.modeId === 'rotational') {
      return [
        { key: 'theta', label: 'Angle', unit: 'rad' },
        { key: 'omega', label: 'Angular velocity', unit: 'rad/s' },
        { key: 'revolutions', label: 'Revolutions', unit: 'rev' },
        { key: 'rpm', label: 'Revolutions per minute', unit: 'rpm' },
        { key: 'v', label: 'Tangential speed', unit: 'm/s' },
        { key: 'at', label: 'Tangential acceleration', unit: 'm/s²' },
        { key: 'ac', label: 'Centripetal acceleration', unit: 'm/s²' },
        { key: 'distance', label: 'Distance', unit: 'm' },
        { key: 't', label: 'Time', unit: 's' },
      ];
    }
    if (this.modeId === 'torque') {
      return [
        { key: 'torque', label: 'Torque', unit: 'N·m' },
        { key: 'netTorque', label: 'Net torque', unit: 'N·m' },
        { key: 'Fperp', label: 'Perpendicular force', unit: 'N' },
        { key: 'Fpar', label: 'Parallel force', unit: 'N' },
        { key: 'leverArm', label: 'Lever arm', unit: 'm' },
        { key: 'alpha', label: 'Angular acceleration', unit: 'rad/s²' },
        { key: 'I', label: 'Moment of inertia', unit: 'kg·m²' },
        { key: 't', label: 'Time', unit: 's' },
      ];
    }
    if (this.modeId === 'inertia') {
      const submode = this.modeStore.inertia.settings.submode;
      if (submode === 'conservation') {
        return [
          { key: 'I1', label: 'Initial moment of inertia', unit: 'kg·m²' },
          { key: 'w1', label: 'Initial angular velocity', unit: 'rad/s' },
          { key: 'I2', label: 'Final moment of inertia', unit: 'kg·m²' },
          { key: 'w2', label: 'Final angular velocity', unit: 'rad/s' },
          { key: 'Lm', label: 'Angular momentum', unit: 'kg·m²/s' },
          { key: 't', label: 'Time', unit: 's' },
        ];
      }
      if (submode === 'collision') {
        return [
          { key: 'I1', label: 'Platform moment of inertia', unit: 'kg·m²' },
          { key: 'w1', label: 'Initial angular velocity', unit: 'rad/s' },
          { key: 'M', label: 'Sandbag mass', unit: 'kg' },
          { key: 'R', label: 'Sandbag radius', unit: 'm' },
          { key: 'I2', label: 'Total moment of inertia', unit: 'kg·m²' },
          { key: 'w2', label: 'Final angular velocity', unit: 'rad/s' },
          { key: 'Lm', label: 'Angular momentum', unit: 'kg·m²/s' },
          { key: 't', label: 'Time', unit: 's' },
        ];
      }
      return [
        { key: 'I', label: 'Moment of inertia', unit: 'kg·m²' },
        { key: 'w', label: 'Angular velocity', unit: 'rad/s' },
        { key: 'Lm', label: 'Angular momentum', unit: 'kg·m²/s' },
        { key: 'M', label: 'Mass', unit: 'kg' },
        { key: 'R', label: 'Radius', unit: 'm' },
        { key: 't', label: 'Time', unit: 's' },
      ];
    }
    return [];
  }

  _snapshotValue(key, time) {
    const solution = this.solution;
    const values = (solution && solution.values) || {};
    if (this.modeId === 'bowling') {
      const deck = this.app.game ? this.app.game.pins.deck : null;
      const physics = this.app.game ? this.app.game.ball.physics : null;
      if (key === 'z') return physics ? physics.z : 0;
      if (key === 'speed') return physics ? physics.speed : 0;
      if (key === 'spin') return physics ? physics.spin_omega : 0;
      if (key === 'pins') return deck ? deck.knockdownCount() : 0;
      if (key === 't') return this._timelineCurrentTime();
      return null;
    }
    if (this.modeId === 'freefall' || this.modeId === 'straight') {
      const u = values.u;
      const a = values.a;
      if (!Number.isFinite(u) || !Number.isFinite(a)) return null;
      const pos = u * time + 0.5 * a * time * time;
      const velocity = u + a * time;
      if (key === 'pos') return pos;
      if (key === 'v') return velocity;
      if (key === 'a') return a;
      if (key === 'speed') return Math.abs(velocity);
      if (key === 'distance') return Math.abs(pos);
      if (key === 't') return time;
      return null;
    }
    if (this.modeId === 'journey') {
      const at = this._journeyAtTime(time);
      if (key === 'position') return at.position;
      if (key === 'distance') return at.distance;
      if (key === 'leg') return at.leg;
      if (key === 't') return time;
      return null;
    }
    if (this.modeId === 'projectile') {
      const g = this.modeStore.projectile.settings.gravity || 9.8;
      const vx = values.vx0;
      const vy0 = values.vy0;
      const h0 = values.h0;
      if (![vx, vy0, h0].every(Number.isFinite)) return null;
      const x = vx * time;
      const y = h0 + vy0 * time - 0.5 * g * time * time;
      const vy = vy0 - g * time;
      if (key === 'x') return x;
      if (key === 'y') return y;
      if (key === 'vx') return vx;
      if (key === 'vy') return vy;
      if (key === 'speed') return Math.hypot(vx, vy);
      if (key === 'dir') return (Math.atan2(vy, vx) * 180) / Math.PI;
      if (key === 't') return time;
      return null;
    }
    if (this.modeId === 'rotational') {
      const w0 = values.w0;
      const alpha = values.alpha;
      if (Number.isFinite(w0) && Number.isFinite(alpha)) {
        const theta = w0 * time + 0.5 * alpha * time * time;
        const omega = w0 + alpha * time;
        if (key === 'theta') return theta;
        if (key === 'omega') return omega;
        if (key === 'revolutions') return theta / (Math.PI * 2);
        if (key === 'rpm') return (omega * 60) / (Math.PI * 2);
        if (key === 'v') return Number.isFinite(values.r) ? omega * values.r : null;
        if (key === 'at') return Number.isFinite(values.r) ? alpha * values.r : null;
        if (key === 'ac') return Number.isFinite(values.r) ? omega * omega * values.r : null;
        if (key === 'distance') return Number.isFinite(values.r) ? theta * values.r : null;
      }
      if (key === 't') return time;
      return null;
    }
    if (this.modeId === 'torque') {
      if (key === 't') return time;
      if (key === 'torque') return values.torque;
      if (key === 'netTorque') return values.netTorque;
      if (key === 'Fperp') return values.Fperp;
      if (key === 'Fpar') return values.Fpar;
      if (key === 'leverArm') return values.leverArm;
      if (key === 'alpha') return values.alpha;
      if (key === 'I') return values.I;
      return null;
    }
    if (this.modeId === 'inertia') {
      if (key === 't') return time;
      if (key === 'I') return values.I;
      if (key === 'w') return values.w;
      if (key === 'Lm') return values.Lm;
      if (key === 'I1') return values.I1;
      if (key === 'w1') return values.w1;
      if (key === 'M') return values.M;
      if (key === 'R') return values.R;
      if (key === 'I2') return values.I2;
      if (key === 'w2') return values.w2;
      return null;
    }
    return null;
  }

  _snapshotStats(time) {
    const defs = this._statDefinitions();
    const selected = this.snapshotKeys[this.modeId];
    return defs
      .filter((def) => !selected || selected.has(def.key))
      .map((def) => ({ ...def, value: this._snapshotValue(def.key, time) }));
  }

  _renderSnapshotKeys() {
    const defs = this._statDefinitions();
    if (!this.snapshotKeys[this.modeId]) {
      this.snapshotKeys[this.modeId] = new Set(defs.map((def) => def.key));
    }
    this._renderStatMenu();
  }

  _toggleDetails(force) {
    const open = force === undefined ? this.detailsCard.hidden : !!force;
    this.detailsCard.hidden = !open;
    this.detailsToggle.setAttribute('aria-expanded', String(open));
    this.detailsToggle.classList.toggle('open', open);
    this.detailsToggle.setAttribute('aria-label', open
      ? 'Hide snapshot details' : 'Show snapshot details');
    if (open) this._updateSnapshot();
    else this._closeMoreMenu();
  }

  _closeDetails() {
    if (!this.detailsCard || this.detailsCard.hidden) return;
    this._toggleDetails(false);
  }

  _buildMoreMenu() {
    if (!this.moreMenu) return;
    this.moreMenu.innerHTML = '';
    el('h2', 'lab-popover-title', this.moreMenu, 'Snapshot');
    const addAction = (label, onClick, icon = 'chevronRight') => {
      const button = el('button', 'lab-add-option', this.moreMenu);
      button.type = 'button';
      const copy = div('lab-add-copy', button);
      el('span', 'lab-add-name', copy, label);
      const trailing = el('span', 'lab-add-unit', button);
      trailing.innerHTML = iconSvg(icon, 18);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
      });
      return button;
    };
    const peak = this._peakTime();
    addAction(peak ? 'Jump to peak' : 'Jump to halfway', () => {
      this._jumpToMoment(peak ? 'peak' : 'half');
      this._closeMoreMenu();
    });
    this.pinMenuItem = addAction(this.snapshotPinned === null ? 'Pin moment' : 'Unpin moment', () => {
      this._togglePin();
    }, 'pin');
    addAction('Use as end time', () => {
      this._useAsEndTime();
      this._closeMoreMenu();
    }, 'check');
    this.addStatButton = addAction('Add stat', () => this._toggleStatMenu(), 'plus');

    const lookup = div('lab-lookup', this.moreMenu);
    el('span', 'lab-lookup-label', lookup, 'Find when…');
    this.lookupKey = el('select', 'lab-field-input lab-select lab-lookup-key', lookup);
    this.lookupKey.setAttribute('aria-label', 'Snapshot quantity to search for');
    for (const def of this._statDefinitions()) {
      if (def.key === 't') continue;
      const option = el('option', '', this.lookupKey, `${def.label} (${def.unit || '—'})`);
      option.value = def.key;
    }
    this.lookupValue = el('input', 'lab-field-input lab-lookup-value', lookup);
    this.lookupValue.type = 'number';
    this.lookupValue.step = '0.1';
    this.lookupValue.inputMode = 'decimal';
    this.lookupValue.placeholder = '= value';
    this.lookupValue.setAttribute('aria-label', 'Value to find');
    this.lookupMessage = el('span', 'lab-lookup-message', lookup, '');
    this.lookupMessage.setAttribute('role', 'status');
    this.lookupMessage.setAttribute('aria-live', 'polite');
    this.lookupButton = this._button('Find', 'lab-sheet-action', lookup, () => this._reverseLookup());
  }

  _toggleMoreMenu(force) {
    const open = force === undefined ? this.moreMenu.hidden : !!force;
    this.moreMenu.hidden = !open;
    this.moreButton.setAttribute('aria-expanded', String(open));
    if (open) {
      if (this.detailsCard.hidden) this._toggleDetails(true);
      this._buildMoreMenu();
      this._positionPopover(this.moreMenu, this.moreButton, { width: 348, align: 'right' });
      const first = this.moreMenu.querySelector('button');
      if (first) first.focus({ preventScroll: true });
    } else {
      this._closeStatMenu();
    }
  }

  _closeMoreMenu() {
    if (!this.moreMenu || this.moreMenu.hidden) return;
    this.moreMenu.hidden = true;
    this.moreButton.setAttribute('aria-expanded', 'false');
    this._closeStatMenu();
  }

  _renderStatMenu() {
    if (!this.statMenu) return;
    const defs = this._statDefinitions();
    const selected = this.snapshotKeys[this.modeId] || new Set();
    this.statMenu.innerHTML = '';
    el('h2', 'lab-popover-title', this.statMenu, 'Add stat');
    for (const def of defs) {
      const option = el('button', 'lab-add-option', this.statMenu);
      option.type = 'button';
      option.setAttribute('aria-pressed', String(selected.has(def.key)));
      const copy = div('lab-add-copy', option);
      el('span', 'lab-add-name', copy, def.label);
      const mark = el('span', 'lab-add-unit', option);
      mark.innerHTML = selected.has(def.key) ? iconSvg('check', 18) : '';
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        if (selected.has(def.key)) selected.delete(def.key);
        else selected.add(def.key);
        this.snapshotKeys[this.modeId] = selected;
        this._renderStatMenu();
        this._updateSnapshot();
      });
    }
  }

  _toggleStatMenu(force) {
    const open = force === undefined ? this.statMenu.hidden : !!force;
    this.statMenu.hidden = !open;
    if (open) {
      this._renderStatMenu();
      this._positionPopover(this.statMenu, this.addStatButton, { width: 260, align: 'right' });
      const first = this.statMenu.querySelector('button');
      if (first) first.focus({ preventScroll: true });
    }
  }

  _closeStatMenu() {
    if (this.statMenu) this.statMenu.hidden = true;
  }

  _togglePin() {
    const current = this._timelineCurrentTime();
    this.snapshotPinned = this.snapshotPinned === null ? current : null;
    this._toggleDetails(true);
    this._buildMoreMenu();
    this._updateSnapshot();
  }

  _useAsEndTime() {
    const time = this.snapshotPinned ?? this._timelineCurrentTime();
    const keyMap = {
      bowling: 'time', freefall: 't', straight: 't', rotational: 't', projectile: 'T',
    };
    const key = keyMap[this.modeId];
    if (!key) {
      this.status('This lab has no single time row to copy into.', true);
      return;
    }
    const clearMap = {
      freefall: ['h', 'v', 'distance', 'maxHeight', 'tApex', 'avgSpeed', 'avgVelocity'],
      straight: ['s', 'v', 'distance', 'avgSpeed', 'avgVelocity'],
      rotational: ['theta', 'w', 'revolutions', 'rpm', 'v', 'distance'],
      projectile: ['R', 'H', 'vy0', 'vx0', 'yTarget', 'landingSpeed', 'timeApex', 'landingAngle'],
    };
    for (const clearKey of clearMap[this.modeId] || []) {
      delete this.given[clearKey];
      delete this._lastCommitted[clearKey];
    }
    if (!this.rowKeys.includes(key)) this.rowKeys.push(key);
    this.given[key] = time;
    this._lastEditedKey = key;
    this._renderRows();
    this._solveNow();
    this.status(`End time set to t = ${fmt(time)} s.`);
  }

  _reverseLookup() {
    const key = this.lookupKey ? this.lookupKey.value : '';
    const target = this.lookupValue ? this.lookupValue.valueAsNumber : NaN;
    const total = this._timelineDuration();
    if (!Number.isFinite(target)) {
      if (this.lookupMessage) this.lookupMessage.textContent = 'Type a value to find.';
      return;
    }
    if (!(total > 0)) {
      if (this.lookupMessage) this.lookupMessage.textContent = 'Run the lab first.';
      return;
    }
    const samples = 600;
    const times = [];
    let previousT = 0;
    let previous = this._snapshotValue(key, 0) - target;
    for (let i = 1; i <= samples; i += 1) {
      const t = (i / samples) * total;
      const value = this._snapshotValue(key, t);
      if (!Number.isFinite(value)) continue;
      const delta = value - target;
      if (Math.abs(delta) < 1e-7) times.push(t);
      else if (Number.isFinite(previous) && previous * delta < 0) {
        let low = previousT;
        let high = t;
        for (let j = 0; j < 40; j += 1) {
          const mid = (low + high) / 2;
          const midDelta = this._snapshotValue(key, mid) - target;
          if (previous * midDelta <= 0) high = mid;
          else low = mid;
        }
        times.push((low + high) / 2);
      }
      previousT = t;
      previous = delta;
    }
    const unique = [];
    for (const value of times) {
      if (!unique.some((other) => Math.abs(other - value) < 0.01)) unique.push(value);
    }
    if (!unique.length) {
      if (this.lookupMessage) this.lookupMessage.textContent = 'That value is not reached in this run.';
      return;
    }
    const first = unique[0];
    if (this.lookupMessage) {
      this.lookupMessage.innerHTML = '';
      for (const time of unique) {
        const button = el('button', 'lab-time-result', this.lookupMessage);
        button.type = 'button';
        button.textContent = `t = ${fmt(time)} s`;
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          this._scrubToTime(time);
        });
      }
    }
    this._scrubToTime(first);
  }

  _updateSnapshot() {
    if (!this.detailsCard) return;
    const pinned = this.snapshotPinned !== null;
    const time = pinned ? this.snapshotPinned : this._timelineCurrentTime();
    this.snapshotLabel.textContent = `${pinned ? 'PINNED · ' : ''}At t = ${fmt(time)} s`;
    this.snapshotLabel.dataset.pinned = String(pinned);
    const stats = this._snapshotStats(time).slice(0, 4);
    this.snapshotGrid.innerHTML = '';
    if (!stats.length) {
      el('span', 'lab-snapshot-empty', this.snapshotGrid, 'No stats selected.');
      return;
    }
    for (const stat of stats) {
      const item = el('span', 'lab-stat', this.snapshotGrid);
      const value = Number.isFinite(stat.value)
        ? `${fmt(stat.value)}${stat.unit ? ` ${stat.unit}` : ''}`
        : '—';
      el('span', 'lab-stat-value', item, value);
      el('span', 'lab-stat-label', item, stat.label);
    }
  }

  // ==== Run ===============================================================
  bowl() {
    if (this.modeId !== 'bowling') {
      this.runPrimary();
      return;
    }
    if (['rolling', 'settling'].includes(this.state) && !this.paused) return;
    this._solveNow();
    if (!this._launchReady()) {
      this._renderStatus();
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

    this._closeDetails();
    this._closeMoreMenu();
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

  runPrimary() {
    this._solveNow();
    if (!this._runReady()) {
      this._renderStatus();
      this.app.play('menu_back');
      return;
    }
    if (this.state === 'running' && !this.paused) return;
    if (!this._beginSimulation()) {
      this.status('Nothing to play yet. Add a value first.');
      this.app.play('menu_back');
      return;
    }
    this.app.play('release');
  }

  reset() {
    // RESET rewinds the run only; typed values and added rows are untouched.
    if (this.modeId !== 'bowling') {
      this._solveNow();
      this._resetSimulation();
      this.app.play('menu_move');
      return;
    }
    this._solveNow();
    this._begin();
    this.app.play('menu_move');
  }

  clearValues() {
    if (!this._editable()) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      document.activeElement.blur();
    }
    if (this.modeId === 'journey') {
      const store = this.modeStore.journey;
      store.legs = store.legs.map(() => ({ distance: null, direction: 1, time: null }));
      store.typedResults = {};
      this.openFormulas.clear();
      this._renderRows();
      this._solveNow();
      this._resetSimulation({ silent: true });
      this.status('values cleared — legs kept');
      this.app.play('menu_move');
      return;
    }
    if (this.modeId !== 'bowling') {
      this.given = {};
      this._lastCommitted = {};
      this.openFormulas.clear();
      this._lastEditedKey = null;
      this._lastAddedKey = null;
      if (this.modeId === 'torque') {
        this.modeStore.torque.forces = [{ F: null, r: null, angle: 90, direction: 1 }];
      }
      if (this.modeId === 'inertia') {
        this.modeStore.inertia.customParts = [{ m: null, r: null }];
      }
      this._renderRows();
      this._solveNow();
      this._resetSimulation({ silent: true });
      this.status('values cleared — rows kept');
      this.app.play('menu_move');
      return;
    }
    this.given = {};
    this._lastCommitted = {};
    this.openFormulas.clear();
    this._lastEditedKey = null;
    this._lastAddedKey = null;
    this._renderRows();
    this._solveNow();
    this._begin();
    this.status('values cleared — rows kept');
    this.app.play('menu_move');
  }

  pause() {
    if (!this._pauseAvailable()) return;
    this.paused = true;
    this.status(`PAUSED at t = ${fmt(this._timelineCurrentTime())} s`);
    this.syncControls();
    this._drawScene();
  }

  resume() {
    if (!this.paused) return;
    if (this.modeId !== 'bowling') {
      this.paused = false;
      if (this.state === 'done') this.state = 'running';
      this.status('running');
      this.syncControls();
      return;
    }
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
    if (this.modeId !== 'bowling') {
      return this.simDuration > 0 && this.state === 'running';
    }
    if (!this.timeline.length) return false;
    return this.paused || ['rolling', 'settling'].includes(this.state);
  }

  timelineAvailable() {
    if (this.modeId !== 'bowling') return this._timelineDuration() > 0;
    return !!this.timeline.length;
  }

  scrubTo(index) {
    if (!this.timelineAvailable()) return;
    if (this.modeId !== 'bowling') {
      this._scrubFraction(Math.max(0, Math.min(1, index)));
      return;
    }
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
    this.status(`PAUSED at t = ${fmt(deck.elapsed || 0)} s`);
  }

  status(text, warn = false) {
    if (!this.calcStatus) return;
    this._paintStatus(warn ? 'conflict' : 'underdetermined', String(text || ''), []);
  }

  _syncModeControls() {
    const mode = MODE_BY_ID[this.modeId];
    const moving = this.state === 'running' && !this.paused;
    const editable = this._editable();
    const ready = this._runReady();
    const label = moving
      ? 'RUNNING…'
      : (this.simTime > 0 || this.state === 'done'
        ? `${mode.actionLabel} AGAIN` : mode.actionLabel);
    const disabled = moving || !ready;
    const pauseAvailable = this._pauseAvailable();
    const key = [this.modeId, this.state, this.paused, label, disabled,
      pauseAvailable, editable, this.solution ? this.solution.status : '',
      this.solution ? this.solution.message : ''].join('|');
    if (key === this._controlsKey) return;
    this._controlsKey = key;

    this.bowlButton.textContent = label;
    this.bowlButton.setAttribute('aria-label', `${label} — ${mode.label} simulation`);
    this.bowlButton.disabled = disabled;
    this.bowlButton.setAttribute('aria-disabled', String(disabled));
    this.bowlButton.title = disabled && !moving
      ? (this.solution && (this.solution.status === 'conflict'
        || this.solution.status === 'impossible')
        ? this.solution.message
        : (this.calcStatus ? this.calcStatus.textContent : 'Add a value to run'))
      : `Run the ${mode.label} scene`;

    this.pauseButton.textContent = this.paused ? 'RESUME' : 'PAUSE';
    this.pauseButton.disabled = !pauseAvailable;
    this.pauseButton.setAttribute('aria-disabled', String(!pauseAvailable));
    this.resetButton.disabled = !(this._timelineDuration() > 0);
    this.clearButton.disabled = !editable;
    this.clearButton.setAttribute('aria-disabled', String(!editable));

    for (const row of Object.values(this.rows)) {
      row.input.disabled = !editable;
      row.remove.disabled = !editable;
    }
    for (const row of this.journeyRows) {
      if (!row) continue;
      row.distance.input.disabled = !editable;
      row.time.input.disabled = !editable;
      row.direction.disabled = !editable;
      row.remove.disabled = !editable;
    }
    for (const row of Object.values(this.resultRows || {})) {
      row.input.disabled = !editable;
    }
    for (const row of this.forcesRows || []) {
      if (!row) continue;
      row.F.input.disabled = !editable;
      row.r.input.disabled = !editable;
      row.angle.input.disabled = !editable;
      row.direction.disabled = !editable;
      row.remove.disabled = !editable;
    }
    if (this.forceAddButton) {
      this.forceAddButton.disabled = !editable;
      this.forceAddButton.setAttribute('aria-disabled', String(!editable));
    }
    for (const row of this.customRows || []) {
      if (!row) continue;
      row.m.disabled = !editable;
      row.r.disabled = !editable;
      row.remove.disabled = !editable;
    }
    if (this.customAddButton) {
      this.customAddButton.disabled = !editable;
      this.customAddButton.setAttribute('aria-disabled', String(!editable));
    }
    for (const row of Object.values(this.constRows)) row.input.disabled = !editable;

    if (this.modeId === 'journey') {
      this.addButton.disabled = !editable;
      this.addButton.setAttribute('aria-disabled', String(!editable));
    } else {
      const available = this._availableFields();
      this.addButton.disabled = !editable || available.length === 0;
      this.addButton.setAttribute('aria-disabled', String(!editable || available.length === 0));
    }
    this.resetDefaultsButton.disabled = !editable;
    this.tlTrack.setAttribute('aria-disabled', String(!this.timelineAvailable()));
    this._updatePlayback();
  }

  syncControls() {
    if (!this.solution || !this.pauseButton) return;
    if (this.modeId !== 'bowling') {
      this._syncModeControls();
      return;
    }
    const moving = ['rolling', 'settling'].includes(this.state) && !this.paused;
    const editable = this._editable();
    const ready = this._launchReady();
    const bowlLabel = moving ? 'ROLLING…' : (this.timeline.length ? 'BOWL AGAIN' : 'BOWL');
    const bowlDisabled = moving || !ready;
    const pauseAvailable = this._pauseAvailable();
    const key = [this.state, this.paused, bowlLabel, bowlDisabled,
      pauseAvailable, editable, this.solution.status, this.solution.message].join('|');
    if (key === this._controlsKey) return;
    this._controlsKey = key;

    this.bowlButton.textContent = bowlLabel;
    this.bowlButton.setAttribute('aria-label', `${bowlLabel} — bowl using the solved launch values`);
    this.bowlButton.disabled = bowlDisabled;
    this.bowlButton.setAttribute('aria-disabled', String(bowlDisabled));
    this.bowlButton.title = bowlDisabled && !moving
      ? (this.solution.status === 'conflict'
        ? this._conflictText(this.solution)
        : this.calcStatus.textContent || 'Add a value to bowl')
      : 'Run the solved launch on the 3D lane';

    this.pauseButton.textContent = this.paused ? 'RESUME' : 'PAUSE';
    this.pauseButton.disabled = !pauseAvailable;
    this.pauseButton.setAttribute('aria-disabled', String(!pauseAvailable));

    this.resetButton.disabled = false;
    this.clearButton.disabled = !editable;
    this.clearButton.setAttribute('aria-disabled', String(!editable));

    for (const row of Object.values(this.rows)) {
      row.input.disabled = !editable;
      row.remove.disabled = !editable;
    }
    for (const row of Object.values(this.constRows)) {
      row.input.disabled = !editable;
    }
    const addAvailable = VAR_FIELDS.some((field) => !this.rowKeys.includes(field.key));
    this.addButton.disabled = !editable || !addAvailable;
    this.addButton.setAttribute('aria-disabled', String(!editable || !addAvailable));
    this.resetDefaultsButton.disabled = !editable;

    this.tlTrack.setAttribute('aria-disabled', String(!this.timelineAvailable()));
    this._updatePlayback();
  }

  // ==== Per-frame =========================================================
  onUpdate(dt) {
    if (this.modeId !== 'bowling') {
      this._updateSimulation(dt);
      return;
    }
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
    const ball = this.app.game.ball;
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
    // Pins are shown in the scene and the details card; the old stat row is gone.
  }


  _updateTimelineUi() {
    this._updatePlayback();
  }

  _isMoving() {
    if (this.modeId === 'bowling') {
      return ['rolling', 'settling'].includes(this.state) && !this.paused;
    }
    return this.state === 'running' && !this.paused;
  }

  _updatePlayback() {
    if (!this.solution || !this.tlTrack) return;
    let total;
    let current;
    if (this.modeId === 'bowling') {
      const game = this.app.game;
      if (!game || !game.ball) return;
      total = this.timeline.duration();
      const raw = Number.isFinite(game.pins.deck.elapsed) ? game.pins.deck.elapsed : 0;
      current = Math.max(0, Math.min(raw, total > 0 ? total : raw));
    } else {
      total = Math.max(0, this._timelineDuration());
      current = Math.max(0, Math.min(total, this.simTime || 0));
    }
    const fraction = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
    this.tlFill.style.width = `${(fraction * 100).toFixed(2)}%`;
    this.tlThumb.style.left = `${(fraction * 100).toFixed(2)}%`;
    this._setTimeDisplay(current, total);
    this.tlTrack.setAttribute('aria-valuemax', total > 0 ? total.toFixed(4) : '0');
    this.tlTrack.setAttribute('aria-valuenow', current.toFixed(4));
    this.tlTrack.setAttribute('aria-valuetext', total > 0
      ? `${current.toFixed(2)} of ${total.toFixed(2)} seconds`
      : 'no run recorded');

    const moving = this._isMoving();
    this.playPauseButton.innerHTML = iconSvg(moving ? 'pause' : 'play', 20);
    this.playPauseButton.setAttribute('aria-label', moving ? 'Pause' : 'Play');
    const canRun = this.modeId === 'bowling' ? this._launchReady() : this._runReady();
    this.playPauseButton.disabled = !moving && !canRun;
    this.skipBackButton.disabled = !(total > 0);
    this.skipForwardButton.disabled = !(total > 0);
    this._updateSnapshot();
  }

  _setTimeDisplay(current, total) {
    if (this.tlTimeInput && document.activeElement !== this.tlTimeInput) {
      this.tlTimeInput.value = fmt(current);
    }
    if (this.tlTimeTotal) this.tlTimeTotal.textContent = `/ ${total.toFixed(4)} s`;
  }

  _journeyAtTime(time) {
    const legs = this.modeStore.journey.legs;
    const count = legs.filter(
      (item) => Number.isFinite(item.distance) && Number.isFinite(item.time)).length;
    let position = 0;
    let clock = 0;
    let distance = 0;
    let leg = 0;
    for (let index = 0; index < legs.length; index += 1) {
      const item = legs[index];
      if (!Number.isFinite(item.distance) || !Number.isFinite(item.time)) continue;
      const direction = item.direction === -1 ? -1 : 1;
      const end = clock + item.time;
      if (time >= end) {
        position += direction * item.distance;
        distance += item.distance;
        leg = index + 1;
      } else if (time >= clock) {
        const fraction = item.time > 0 ? (time - clock) / item.time : 1;
        position += direction * item.distance * clamp01(fraction);
        distance += item.distance * clamp01(fraction);
        leg = index + 1;
        break;
      }
      clock = end;
    }
    return { position, distance, leg, count };
  }

  // ==== Keyboard ==========================================================
  onKey(key) {
    const active = document.activeElement;
    if (active && active.tagName === 'BUTTON' && (key === 'space' || key === 'enter')) {
      active.click();
      return true;
    }
    if (this.addOpen && key === 'escape') {
      this._closeAddMenu();
      this.addButton.focus();
      return true;
    }
    if (this.examplesOpen && key === 'escape') {
      this._closeExamples();
      this.examplesButton.focus();
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
