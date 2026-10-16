// Heads-up display: the mode-aware gameplay readout (ported from ui/hud.py).
import { COLORS, TYPE_PX, SIZES, LAYOUT, css, cssA, wrapText } from './theme.js';
import { MOTION } from '../motion/config.js';
import { div, el, button as makeButton, fitLines } from './dom.js';
import { Scorecard } from './scorecard.js';
import { ChallengePanel } from './challenge_panel.js';
const GREEN = [120, 230, 120];
const YELLOW = [235, 210, 90];
const RED = [240, 110, 110];
const GRAY = [186, 194, 214];
const WHITE = [242, 242, 248];
const SCORE_COLOR = [255, 221, 130];
const AMBER = [255, 214, 130];
const PIN_UP_COLOR = [250, 250, 255];
const PIN_DOWN_COLOR = [70, 76, 104];
const PANEL_RGB = [10, 8, 22];
const CELL_BG = [20, 17, 46];
const SCORE_BAR = [180, 1096, 8, 76];   // (left, right, top, bottom) of the frame card

export function webcamFeedbackLines(status) {
  if (!status) return [];
  if (status.error) return [[`Webcam: unavailable - ${status.error}`, RED]];
  if (!status.running) return [['Webcam: starting camera...', GRAY]];
  let lines;
  if (status.tracked) {
    lines = [['Webcam: tracking', GREEN],
             [`Phase: ${status.phase_label}`, status.phase === 'ready' ? YELLOW : GREEN]];
  } else if (!status.frame_count) {
    // The camera is open but the pose model has not produced a frame yet:
    // saying "no person detected" here would blame the player for a camera
    // that is still starting.
    const message = String(status.message || '');
    const label = message.includes('loading pose model')
      ? 'camera connected - loading pose model...'
      : (message.includes('starting camera')
        ? 'starting camera - allow access if the browser asks...'
        : 'camera connected - waiting for the first frame...');
    lines = [[`Webcam: ${label}`, GRAY],
             [`Phase: ${status.phase_label}`, GRAY]];
  } else {
    const lost = status.lost_seconds === null || status.lost_seconds === undefined;
    lines = [[lost ? 'Webcam: no person detected - stand in view'
      : `Webcam: tracking lost (${status.lost_seconds.toFixed(1)}s) - step back into view`, RED],
             [`Phase: ${status.phase_label}`, GRAY]];
  }
  const arm = String(status.arm || 'auto').toUpperCase();
  lines.push([`Throwing arm: ${arm}  (C to change)`, [140, 145, 160]]);
  // The classifier reports its state and the reason the ready pose is not
  // established yet; notices (a rejected swing with its cause) take priority
  // through status.hint for a few seconds.
  let hint = status.hint;
  if (status.tracked && status.phase === 'tracking' && status.tracking_reason
      && (!hint || hint === status.tracking_reason)) {
    hint = status.tracking_reason;
  }
  if (status.tracked && status.phase === 'ready' && (!hint || hint === 'Ready: swing your arm back, then forward and up.')) {
    hint = 'Ready: swing your arm back, then forward and up.';
  }
  if (hint) lines.push([hint, GRAY]);
  return lines;
}

export class QuestionPanel {
  constructor(parent) {
    this.root = div('question-panel', parent);
    this.root.style.position = 'absolute';
    this.root.style.left = '0';
    this.root.style.top = '0';
    this.root.style.width = '1280px';
    this.root.style.height = '720px';
    this.root.style.display = 'none';
    this.visible = false;
    this.WIDTH = SIZES.question_w;
    this.TOP = SIZES.question_y;
    this.PAD = SIZES.question_pad;
    this.GAP = SIZES.question_gap;
    this.LINE_GAP = 6.0;

    this.body = div('panel', this.root);
    this.body.style.position = 'absolute';
    this.body.style.borderRadius = '16px';
    this.body.style.background = cssA(COLORS.panel, 0.92);
    this.body.style.border = '1px solid transparent';
    this.body.style.borderImage = 'linear-gradient(90deg, rgba(62,201,232,0.6), rgba(255,61,139,0.6)) 1';

    this.heading = this._label(COLORS.cyan, SIZES.question_header, true, 2);
    this.headRule = div('rule', this.root);
    this.headRule.style.position = 'absolute';
    this.headRule.style.background = cssA(COLORS.hairline, 1);
    this.caseLabel = this._label(COLORS.text_dim, SIZES.question_header, false, 0, 'right');
    this.prompt = this._label(COLORS.text, SIZES.question_text, true, 0, 'left', true);
    this.givenLabel = this._label(COLORS.cyan, SIZES.question_header, true, 2, 'left', true);
    this.given = this._label(COLORS.text, TYPE_PX.body_small, false, 0, 'left', true);
    this.equationLabel = this._label(COLORS.cyan, SIZES.question_header, true, 2, 'left', true);
    this.equation = this._label(COLORS.text, TYPE_PX.body, false, 0, 'left', true);
    this.unknown = this._label(COLORS.amber, SIZES.question_header, false, 0, 'right');

    this.fieldBody = div('field-body', this.root);
    this.fieldBody.style.position = 'absolute';
    this.fieldBody.style.background = cssA(COLORS.card, 1);
    this.fieldBody.style.borderRadius = `${SIZES.question_input_radius}px`;
    this.fieldEdge = div('field-edge', this.root);
    this.fieldEdge.style.position = 'absolute';
    this.fieldEdge.style.borderRadius = `${SIZES.question_input_radius}px`;
    this.fieldEdge.style.border = `${SIZES.question_border}px solid ${cssA(COLORS.cyan, 1)}`;
    this.fieldLabel = this._label(COLORS.text_dim, SIZES.question_body, false, 0);
    this.field = this._label(COLORS.text, SIZES.question_body, false, 0);
    this.caret = div('caret', this.root);
    this.caret.style.position = 'absolute';
    this.caret.style.background = cssA(COLORS.cyan, 0.9);

    this.feedbackLines = [];
    for (let i = 0; i < 10; i++) this.feedbackLines.push(this._label(WHITE, TYPE_PX.chip, false, 0, 'left', true));
    this.footer = this._label(COLORS.text_dim, TYPE_PX.label, false, 0, 'left', true);

    this.submitButton = makeButton(this.root, 'SUBMIT', {
      w: SIZES.question_button_w, h: SIZES.question_button_h, radius: 12, accent: COLORS.pink,
      variant: 'primary', fontPx: SIZES.nav_font, tracking: 1, onClick: () => this._submit(),
    });
    this.continueButton = makeButton(this.root, 'CONTINUE', {
      w: SIZES.question_button_w, h: SIZES.question_button_h, radius: 12, accent: COLORS.pink,
      variant: 'primary', fontPx: SIZES.nav_font, tracking: 1, onClick: () => this._continue(),
    });
    this.on_submit = null; this.on_continue = null;
    this.hide();
  }

  _label(rgb, px, bold, tracking, align = 'left', lefttop = false) {
    const node = el('div', '', this.root);
    node.style.position = 'absolute';
    node.style.fontSize = `${px}px`;
    node.style.fontWeight = bold ? 700 : 400;
    node.style.letterSpacing = `${tracking}px`;
    node.style.color = css(rgb);
    if (align === 'right') node.style.transform = 'translateX(-100%)';
    if (lefttop) node.style.whiteSpace = 'pre-wrap';
    return node;
  }

  hide() { this.visible = false; this.root.style.display = 'none'; }
  show() { this.visible = true; this.root.style.display = 'block'; }
  _submit() { if (this.on_submit) this.on_submit(); }
  _continue() { if (this.on_continue) this.on_continue(); }
  setCallbacks(onSubmit, onContinue) { this.on_submit = onSubmit; this.on_continue = onContinue; }
  updateWidgets() {}
  click() { return false; }

  update(question, answerText, feedback, progress, modeTitle, showCaret = true, hintsUnlocked = 0, attemptsLeft = 0, throwEarned = false) {
    const W = this.WIDTH;
    const TOP = this.TOP;
    const PAD = this.PAD;
    const GAP = this.GAP;
    const LINE_GAP = this.LINE_GAP;
    const contentW = W - 2 * PAD;
    const left = 640 - W / 2 + PAD;
    const right = 640 + W / 2 - PAD;
    const maxBottom = 720 - LAYOUT.margin_bottom;
    const buttonH = SIZES.question_button_h;
    const fieldH = SIZES.question_input_h;
    const marking = feedback !== null;
    const solved = marking && feedback.correct;
    const exhausted = marking && !feedback.correct && attemptsLeft <= 0;

    // ==== measure ==========================================================
    this.heading.textContent = progress.toUpperCase();
    this.caseLabel.textContent = question.case || '';
    this.caseLabel.style.display = question.case ? 'block' : 'none';
    const headerH = Math.max(SIZES.question_header, this.heading.offsetHeight || 16,
      this.caseLabel.offsetHeight || 16);

    this.prompt.style.maxWidth = `${contentW}px`;
    // While marked the statement is trimmed to two lines (it has been read by
    // then) so the feedback and solution have room - ui/hud.py: max_lines = 2.
    fitLines(this.prompt, question.prompt || '', marking ? 2 : 0);
    const promptH = this.prompt.offsetHeight;

    const givenText = question.given && question.given.length
      ? question.given.map(([n, v]) => `${n} = ${v}`).join('    ') : (question.assumptions || '');
    const hasGiven = !!givenText && !marking;
    if (hasGiven) {
      this.given.textContent = givenText;
      this.given.style.maxWidth = `${contentW}px`;
    }
    const givenH = hasGiven ? this.given.offsetHeight : 0;

    const eqText = question.equation || '';
    const hasEquation = !!eqText;
    if (hasEquation) {
      this.equation.textContent = eqText;
      this.equation.style.maxWidth = `${contentW - 200}px`;
      this.unknown.textContent = question.unknown ? `UNKNOWN: ${question.unknown}` : '';
    }
    const eqH = hasEquation ? this.equation.offsetHeight : 0;

    const fixedH = headerH + GAP + promptH
      + (hasGiven ? GAP + SIZES.question_header + LINE_GAP + givenH : 0)
      + (hasEquation ? GAP + SIZES.question_header + LINE_GAP + eqH : 0)
      + GAP + (marking ? 0 : fieldH) + GAP + buttonH;
    const budget = maxBottom - TOP - 2 * PAD;
    const available = Math.max(0, budget - fixedH);

    const entries = [];
    if (marking) {
      const [lines, colours] = feedbackLines(question, feedback, hintsUnlocked, attemptsLeft);
      let used = 0;
      for (let i = 0; i < lines.length && i < this.feedbackLines.length; i++) {
        const sprite = this.feedbackLines[i];
        // Show before measuring: a display:none sprite measures 0 high.
        sprite.style.display = 'block';
        sprite.style.maxWidth = `${contentW}px`;
        sprite.textContent = lines[i];
        const spriteH = sprite.offsetHeight || 16;
        const extra = spriteH + (entries.length ? LINE_GAP : 0);
        if (entries.length && used + extra > available) break;
        used += extra;
        entries.push([sprite, colours[i], spriteH]);
      }
    }
    let usedH = 0;
    entries.forEach(([, , spriteH], i) => { usedH += spriteH + (i ? LINE_GAP : 0); });

    const height = Math.min(maxBottom - TOP, fixedH + usedH + 2 * PAD);
    this.body.style.left = `${640 - W / 2}px`;
    this.body.style.top = `${TOP}px`;
    this.body.style.width = `${W}px`;
    this.body.style.height = `${height}px`;

    // ==== place ============================================================
    let y = TOP + PAD;
    const headerMid = y + headerH / 2;
    this.heading.style.left = `${left}px`;
    this.heading.style.top = `${headerMid - this.heading.offsetHeight / 2}px`;
    this.caseLabel.style.left = `${right}px`;
    this.caseLabel.style.top = `${headerMid - this.caseLabel.offsetHeight / 2}px`;
    const ruleLeft = left + (this.heading.offsetWidth || 80) + 16;
    const caseW = question.case ? (this.caseLabel.offsetWidth || 0) : 0;
    const ruleRight = right - (caseW + 16);
    if (ruleRight > ruleLeft + 16) {
      this.headRule.style.display = 'block';
      this.headRule.style.left = `${ruleLeft}px`;
      this.headRule.style.top = `${headerMid}px`;
      this.headRule.style.width = `${ruleRight - ruleLeft}px`;
      this.headRule.style.height = '1px';
    } else this.headRule.style.display = 'none';
    y += headerH + GAP;

    this.prompt.style.left = `${left}px`;
    this.prompt.style.top = `${y}px`;
    y += promptH;

    if (hasGiven) {
      y += GAP;
      this.givenLabel.style.left = `${left}px`; this.givenLabel.style.top = `${y}px`;
      y += SIZES.question_header + LINE_GAP;
      this.given.style.left = `${left}px`; this.given.style.top = `${y}px`;
      y += givenH;
    }
    this.givenLabel.style.display = hasGiven ? 'block' : 'none';
    this.given.style.display = hasGiven ? 'block' : 'none';

    if (hasEquation) {
      y += GAP;
      this.equationLabel.style.left = `${left}px`; this.equationLabel.style.top = `${y}px`;
      y += SIZES.question_header + LINE_GAP;
      this.equation.style.left = `${left}px`; this.equation.style.top = `${y}px`;
      this.unknown.style.left = `${right}px`;
      this.unknown.style.top = `${y + eqH / 2 - this.unknown.offsetHeight / 2}px`;
      y += eqH;
    } else this.unknown.style.display = 'none';
    this.equationLabel.style.display = hasEquation ? 'block' : 'none';
    this.equation.style.display = hasEquation ? 'block' : 'none';
    if (hasEquation) this.unknown.style.display = question.unknown ? 'block' : 'none';

    // The buttons sit on the panel's own bottom edge (ui/hud.py).
    const buttonCentre = TOP + height - PAD - buttonH / 2;
    const buttonX = right - SIZES.question_button_w / 2;
    const buttonTop = buttonCentre - buttonH / 2;

    if (marking) {
      this.fieldBody.style.display = 'none'; this.fieldEdge.style.display = 'none';
      this.fieldLabel.style.display = 'none'; this.field.style.display = 'none';
      this.caret.style.display = 'none';
      this.submitButton.style.display = 'none';
      this.continueButton.style.display = 'flex';
      this.continueButton.style.left = `${buttonX - SIZES.question_button_w / 2}px`;
      this.continueButton.style.top = `${buttonTop}px`;
      y += GAP;
      for (const [sprite, colour, spriteH] of entries) {
        sprite.style.display = 'block';
        sprite.style.color = css(colour);
        sprite.style.left = `${left}px`; sprite.style.top = `${y}px`;
        y += spriteH + LINE_GAP;
      }
      for (const sprite of this.feedbackLines.slice(entries.length)) sprite.style.display = 'none';
      const footer = feedbackFooter(solved, exhausted, throwEarned);
      this.footer.style.display = footer ? 'block' : 'none';
      if (footer) {
        this.footer.textContent = footer;
        this.footer.style.left = `${left}px`;
        this.footer.style.top = `${buttonTop + 8}px`;
      }
    } else {
      y += GAP;
      const fieldY = y;
      this.fieldBody.style.display = 'block'; this.fieldEdge.style.display = 'block';
      this.fieldBody.style.left = `${left}px`; this.fieldBody.style.top = `${y}px`;
      this.fieldBody.style.width = `${contentW}px`; this.fieldBody.style.height = `${fieldH}px`;
      this.fieldEdge.style.left = `${left}px`; this.fieldEdge.style.top = `${y}px`;
      this.fieldEdge.style.width = `${contentW - 2 * SIZES.question_border}px`; this.fieldEdge.style.height = `${fieldH - 2 * SIZES.question_border}px`;
      this.fieldEdge.style.borderColor = cssA(showCaret ? COLORS.cyan : COLORS.hairline, 1);
      const pad = SIZES.question_input_pad;
      const text = answerText || '';
      this.field.style.display = text ? 'block' : 'none';
      this.field.textContent = text;
      this.field.style.left = `${left + pad}px`;
      this.field.style.top = `${fieldY + fieldH / 2 - this.field.offsetHeight / 2}px`;
      this.fieldLabel.style.display = text ? 'none' : 'block';
      this.fieldLabel.textContent = 'Type your answer, then press ENTER';
      this.fieldLabel.style.left = `${left + pad}px`;
      this.fieldLabel.style.top = `${fieldY + fieldH / 2 - this.fieldLabel.offsetHeight / 2}px`;
      this.caret.style.display = showCaret ? 'block' : 'none';
      if (showCaret) {
        this.caret.style.left = `${left + pad + (this.field.offsetWidth || 0) + 6}px`;
        this.caret.style.top = `${fieldY + fieldH * 0.23}px`;
        this.caret.style.width = '2px';
        this.caret.style.height = `${fieldH * 0.54}px`;
      }
      this.submitButton.style.display = 'flex';
      this.continueButton.style.display = 'none';
      for (const sprite of this.feedbackLines) sprite.style.display = 'none';
      this.footer.style.display = 'none';
      this.submitButton.style.left = `${buttonX - SIZES.question_button_w / 2}px`;
      this.submitButton.style.top = `${buttonTop}px`;
    }
  }
}

function feedbackFooter(solved, exhausted, throwEarned) {
  if (solved && throwEarned) return 'Correct - the throw is yours. ENTER moves on.';
  if (solved) return 'Correct. The throw for this question is gone; ENTER moves on.';
  if (exhausted) return 'All hints are unlocked and the solution is above.';
  return 'Try again, or ENTER to move on.';
}

function feedbackLines(question, feedback, hintsUnlocked = 0, attemptsLeft = 0) {
  const lines = [feedback.summary];
  const colours = [feedback.correct ? GREEN : RED];
  if (feedback.detail) { lines.push(feedback.detail); colours.push(WHITE); }
  const hints = question.hints || [];
  if (!feedback.correct) {
    for (let i = 0; i < Math.min(hintsUnlocked, hints.length); i++) {
      lines.push(`Step ${i + 1}:  ${hints[i]}`);
      colours.push(AMBER);
    }
    if (hintsUnlocked < hints.length) {
      const left = hints.length - hintsUnlocked;
      lines.push(`(${left} more hint ${left === 1 ? 'step' : 'steps'} left)`);
      colours.push(GRAY);
    }
  }
  if (feedback.working && (feedback.correct || attemptsLeft <= 0)) {
    lines.push('Worked solution:');
    colours.push(AMBER);
    for (const chunk of wrapText(feedback.working, 104).slice(0, 2)) { lines.push(chunk); colours.push(GRAY); }
  }
  if (!feedback.correct && attemptsLeft <= 0 && feedback.expected) {
    lines.push(`Expected answer: ${feedback.expected}`);
    colours.push(AMBER);
  }
  return [lines, colours];
}

export class HudMotion {
  constructor(hud) {
    this.hud = hud;
    this.displayed = 0;
    this._official = null;
    this._meter = 0.0;
    this._meterTarget = 0.0;
    this._pulse = 0;
    this._confettiTimer = 0;
    this._physicsVisible = true;
  }
  onShow() { this.displayed = 0; this._official = null; this._meter = 0; }
  update(dt, meter) {
    if (meter) { this._meterTarget = meter[1]; }
    const smoothing = Math.min(1.0, Math.max(0.05, MOTION.meter_fill_smoothing));
    this._meter += (this._meterTarget - this._meter) * smoothing;
    if (Math.abs(this._meterTarget - this._meter) < 0.002) this._meter = this._meterTarget;
    if (this.hud.meterFill) {
      this.hud.meterFill.style.width = `${Math.max(0, Math.min(1, this._meter)) * 100}%`;
    }
    if (this.hud.meterRoot) {
      const on = !!(meter && meter[0]);
      this.hud.meterRoot.style.opacity = on ? '1' : '0';
    }
  }
  officialChanged(from, to) {
    this._countFrom = from; this._countTo = to; this._countT = 0;
    if (this.hud.totalScore) this.hud.totalScore.style.color = css(AMBER);
  }
  displayScore(official) {
    if (this._countT !== undefined && this._countT < 1 && this._countFrom !== undefined) {
      this._countT = Math.min(1, (this._countT || 0) + 0.08);
      const value = Math.round(this._countFrom + (this._countTo - this._countFrom) * this._countT);
      this.displayed = value;
    } else { this.displayed = official; }
    return this.displayed;
  }
  rollRecorded() {}
  frameChanged(index) { if (this.hud.score) this.hud.scoreCurrentFrame = index + 1; }
  markStamp(index) {}
  pinsCelebrate(style) { if (this.hud.pinsRow) { this.hud.pinsRow.style.filter = 'brightness(1.4)'; setTimeout(() => { if (this.hud.pinsRow) this.hud.pinsRow.style.filter = 'none'; }, 450); } }
  confetti(count = 120) {
    // The particle pool lives on the director (wired when it is built).
    const director = this.director || (this.hud && this.hud.director);
    if (director && director.particles) {
      for (let i = 0; i < Math.min(count, 80); i += 8) {
        director.particles.burst(Math.random() * 1280, -10, 8,
          [[255, 214, 130], [96, 226, 255], [232, 72, 168], [255, 255, 255]], 0.4, -Math.PI / 2, -1.2, 2.2);
      }
    }
  }
  setPhysicsVisible(visible) {
    this._physicsVisible = visible;
    if (this.hud.readout) this.hud.readout.style.display = visible && this.hud._readoutHasData ? 'block' : 'none';
  }
  meterReleased() { if (this.hud.meterRoot) { this.hud.meterRoot.style.opacity = '0'; } }
  prompt() {}
}

export class Hud {
  constructor(parent) {
    this.root = div('hud', parent);
    this.root.style.position = 'absolute';
    this.root.style.left = '0'; this.root.style.top = '0';
    this.root.style.width = '1280px'; this.root.style.height = '720px';
    this.root.style.pointerEvents = 'none';
    this.motion = new HudMotion(this);
    this.scoreCurrentFrame = 1;
    this._readoutHasData = false;

    // top bar
    this._topBar = div('top-bar', this.root);
    this._topBar.style.cssText = 'position:absolute;left:0;top:0;width:1280px;height:84px;'
      + `background:linear-gradient(180deg, ${cssA([16, 13, 40], 0.985)}, ${cssA(PANEL_RGB, 0.97)});`;
    this._topHairline = div('top-hairline', this.root);
    this._topHairline.style.cssText = `position:absolute;left:0;top:83px;width:1280px;height:2px;`
      + `background:linear-gradient(90deg, ${cssA([86, 190, 255], 0.15)}, ${cssA([86, 190, 255], 0.55)}, ${cssA([86, 190, 255], 0.15)});`;

    this.score = new Scorecard(this.root);

    // Left block: the player's running total.
    this.scoreCaption = el('div', 'score-caption', this.root, 'SCORE');
    this.scoreCaption.style.cssText = `position:absolute;left:20px;top:12px;width:140px;text-align:right;`
      + `font-size:10px;font-weight:700;letter-spacing:3px;color:${cssA(COLORS.text_dim, 0.8)};`;
    this.totalScore = el('div', 'total-score', this.root, '0');
    this.totalScore.style.cssText = `position:absolute;left:20px;top:24px;width:140px;text-align:right;`
      + `font-size:40px;font-weight:900;line-height:1.02;color:${css(AMBER)};letter-spacing:1px;`
      + `text-shadow:0 0 18px ${cssA(AMBER, 0.45)};`;

    // Middle: the mode name when there is no frame card to show.
    this.modeStrip = div('mode-strip', this.root);
    this.modeStrip.style.cssText = 'position:absolute;left:180px;top:8px;width:916px;height:68px;'
      + `border-radius:5px;background:${cssA(CELL_BG, 0.75)};box-shadow:inset 0 0 0 1px ${cssA([58, 52, 108], 0.8)};`
      + 'display:none;align-items:center;justify-content:center;flex-direction:column;';
    this.modeStripTitle = el('div', '', this.modeStrip, '');
    this.modeStripTitle.style.cssText = `font-size:19px;font-weight:800;letter-spacing:4px;color:${css(WHITE)};`;
    this.modeStripSub = el('div', '', this.modeStrip, '');
    this.modeStripSub.style.cssText = `font-size:12px;letter-spacing:2.5px;color:${cssA(COLORS.text_dim, 0.9)};margin-top:4px;`;

    // The SCORE chip: while a question or challenge is up the big number moves
    // into a small panel in the top-right corner (ui/hud.py _update_score_chip).
    this._scoreChip = div('score-chip', this.root);
    this._scoreChip.style.cssText = 'position:absolute;display:none;border-radius:12px;'
      + `background:${cssA([11, 8, 32], 0.80)};box-shadow:inset 0 0 0 1px ${cssA(COLORS.hairline, 1)};`;
    this.chipCaption = el('div', 'chip-caption', this.root, 'SCORE');
    this.chipCaption.style.cssText = `position:absolute;display:none;font-size:13px;color:${css(COLORS.text_dim)};text-align:right;`;
    this.chipValue = el('div', 'chip-value', this.root, '0');
    this.chipValue.style.cssText = `position:absolute;display:none;font-size:28px;font-weight:800;`
      + `color:${css(AMBER)};text-align:right;`;

    // pin rack (triangle of 10 dots)
    this.pinsRow = div('pins-row', this.root);
    this.pinsRow.style.position = 'absolute';
    this.pinsLabel = el('div', 'pins-label', this.root, '');
    this.pinsLabel.style.cssText = `position:absolute;text-align:right;font-size:10px;font-weight:700;`
      + `letter-spacing:2px;color:${cssA(COLORS.text_dim, 0.8)};`;

    this.status = el('div', 'status', this.root, 'Ready to throw');
    this.status.style.cssText = `position:absolute;font-size:22px;font-weight:800;color:${css(WHITE)};text-align:center;`
      + `letter-spacing:1px;text-shadow:0 2px 10px rgba(0,0,0,0.85), 0 0 18px rgba(0,0,0,0.6);`;

    // player chips
    this.chips = [];
    for (let i = 0; i < 4; i++) {
      const chip = div('player-chip', this.root);
      chip.style.position = 'absolute';
      chip.style.display = 'none';
      chip.style.borderRadius = '8px';
      chip.style.textAlign = 'center';
      const name = el('div', '', chip); name.style.cssText = 'font-size:14px;line-height:18px;';
      const score = el('div', '', chip); score.style.cssText = 'font-size:20px;font-weight:700;line-height:23px;';
      const detail = el('div', '', chip); detail.style.cssText = 'font-size:12px;line-height:15px;';
      this.chips.push({ chip, name, score, detail });
    }

    // timer
    this._timerPanel = div('timer-panel', this.root);
    this._timerPanel.style.cssText = `position:absolute;width:126px;height:40px;border-radius:8px;background:${cssA([40, 12, 24], 0.82)};display:none;`;
    this.timerValue = el('div', 'timer', this.root, '');
    this.timerValue.style.cssText = `position:absolute;font-size:22px;font-weight:700;color:${css(AMBER)};text-align:center;`;
    this.timerValue.style.display = 'none';

    // webcam chip: bottom-left, stacked clear above the feed panel (which is at
    // most 216x162 for the 640x480 capture the constraints ask for) so it never
    // overlaps the preview or the lane's horizon.
    this._webcamPanel = div('webcam-chip', this.root);
    this._webcamPanel.style.cssText = `position:absolute;left:21px;bottom:242px;padding:8px;`
      + `border-radius:8px;background:${cssA([11, 8, 32], 0.85)};display:none;`;
    this.webcamLines = [];
    for (let i = 0; i < 5; i++) {
      const line = el('div', '', this._webcamPanel);
      line.style.cssText = 'font-size:13px;white-space:nowrap;line-height:1.4;';
      this.webcamLines.push(line);
    }

    // physics readout
    this.readout = el('div', 'readout', this.root, '');
    this.readout.style.cssText = `position:absolute;right:20px;bottom:14px;font-size:13px;color:${css(GRAY)};`
      + `text-align:right;white-space:pre;padding:10px 14px;border-radius:8px;background:${cssA(PANEL_RGB, 0.62)};display:none;`;
    // message + results
    this.message = el('div', 'message', this.root, '');    this.message.style.cssText = `position:absolute;left:640px;top:360px;transform:translate(-50%,-50%);font-size:22px;font-weight:700;color:${css(YELLOW)};text-align:center;display:none;white-space:pre-wrap;`;
    this.results = el('div', 'results-inline', this.root, '');
    this.results.style.cssText = `position:absolute;left:640px;top:360px;transform:translate(-50%,-50%);font-size:26px;font-weight:700;color:${css(YELLOW)};text-align:center;display:none;white-space:pre-wrap;`;

    // question + challenge panels
    this.question_panel = new QuestionPanel(this.root);
    this.challenge_panel = new ChallengePanel(this.root);

    // power meter
    this.meterRoot = div('power-meter', this.root);
    this.meterRoot.style.cssText = 'position:absolute;left:640px;bottom:40px;transform:translateX(-50%);width:420px;height:14px;'
      + `border-radius:7px;background:${cssA([11, 8, 32], 0.8)};opacity:0;transition:opacity 0.15s;overflow:hidden;`;
    this.meterFill = div('power-meter-fill', this.meterRoot);
    this.meterFill.style.cssText = 'width:0%;height:100%;border-radius:7px;background:linear-gradient(90deg,#60e2ff,#ffd682,#e848a8);';
  }

  setVisible(visible) { this.root.style.display = visible ? 'block' : 'none'; }

  update(ball, knockdowns, score, state, opts = {}) {
    const {
      input_mode: inputMode = 'mouse', webcam_status: webcamStatus = null, message = '',
      message_warning: messageWarning = false, match = null, mode = null, paused = false,
      question = null, answer_text: answerText = '', feedback = null, question_progress: questionProgress = '',
      results = null, physics_lines: physicsLines = null, timer = null, rush = false,
      hide_scorecard: hideScorecard = false, standing_pins: standingPins = null,
      score_value: scoreValue = null, hints_unlocked: hintsUnlocked = 0, attempts_left: attemptsLeft = 0,
      throw_earned: throwEarned = false, challenge_state: challengeState = null, handoff_banner: handoffUp = false,
    } = opts;
    // top bar geometry
    const rightX = 1264;
    const usesFrames = mode ? mode.score_style === 'frames' : true;
    const showCard = (match === null || match.player_count === 1) && !hideScorecard && !rush;
    this.score.setVisible(showCard);
    if (showCard) {
      const currentFrame = ['game_over', 'question', 'challenge'].includes(state) ? null : score.current_frame_number;
      this.score.update(score, currentFrame, SCORE_BAR);
    }

    const questionUp = this.question_panel.visible || this.challenge_panel.visible;
    const official = scoreValue !== null ? scoreValue : score.current_score;
    const hudMotion = this.motion;
    if (hudMotion) {
      // Count the cumulative total up instead of snapping (motion/hud_fx.py).
      if (hudMotion._official === null || hudMotion._official === undefined) hudMotion._official = official;
      else if (official !== hudMotion._official) {
        hudMotion.officialChanged(hudMotion._official, official);
        hudMotion._official = official;
      }
      this._scoreText = String(hudMotion.displayScore(official));
    } else {
      this._scoreText = String(official);
    }
    this.totalScore.textContent = this._scoreText;
    this.chipValue.textContent = this._scoreText;
    // The frame card occupies the middle of the bar; modes without frames get a
    // mode strip in the same slot instead of leaving it empty.
    if (!showCard) {
      this.modeStrip.style.display = 'flex';
      this.modeStripTitle.textContent = mode ? String(mode.title).toUpperCase() : '';
      const bits = [];
      if (rush && timer !== null) bits.push(`TIME LEFT ${Math.max(0, Math.floor(timer))}s`);
      if (match) bits.push(`${match.player_count} PLAYER${match.player_count === 1 ? '' : 'S'}`);
      this.modeStripSub.textContent = bits.filter(Boolean).join('   ·   ').toUpperCase();
    } else {
      this.modeStrip.style.display = 'none';
    }
    this.scoreCaption.textContent = usesFrames ? 'SCORE' : 'TOTAL PINS';
    // The corner chip carries the score only while a question or challenge panel
    // covers the bar; the left block keeps it the rest of the time.
    const chipUp = questionUp;
    this._scoreChip.style.display = chipUp ? 'block' : 'none';
    this.chipCaption.style.display = chipUp ? 'block' : 'none';
    this.chipValue.style.display = chipUp ? 'block' : 'none';
    this.totalScore.style.display = chipUp ? 'none' : 'block';
    this.scoreCaption.style.display = chipUp ? 'none' : 'block';
    if (chipUp) {
      const pad = SIZES.score_chip_pad;
      const rightPx = 1280 - LAYOUT.margin_x;
      const topPx = LAYOUT.margin_top;
      const chipW = Math.max(104.0, pad * 2 + 76.0);
      const chipH = 96;
      this._scoreChip.style.left = `${rightPx - chipW}px`;
      this._scoreChip.style.top = `${topPx}px`;
      this._scoreChip.style.width = `${chipW}px`;
      this._scoreChip.style.height = `${chipH}px`;
      this.chipCaption.style.right = `${1280 - rightPx + pad}px`;
      this.chipCaption.style.top = `${topPx + pad - 2}px`;
      this.chipValue.style.right = `${1280 - rightPx + pad}px`;
      this.chipValue.style.top = `${topPx + pad + 20}px`;
    }

    // pin rack
    let remaining;
    if (standingPins !== null) remaining = standingPins;
    else { const standing = score ? score.standing_pins() : 0; remaining = standing === null ? 0 : standing; }
    this._layoutPins(rightX, remaining, questionUp);

    // timer
    const showTimer = timer !== null && timer !== undefined;
    this._timerPanel.style.display = showTimer ? 'block' : 'none';
    this.timerValue.style.display = showTimer ? 'block' : 'none';
    if (showTimer) {
      const seconds = Math.max(0.0, Number(timer));
      const minutes = Math.floor(seconds / 60);
      const remainder = seconds - minutes * 60;
      this._timerPanel.style.left = '20px';
      this._timerPanel.style.top = '92px';
      this.timerValue.textContent = `${minutes}:${remainder < 10 ? '0' : ''}${remainder.toFixed(1)}`;
      this.timerValue.style.color = css(seconds <= 30.0 ? [226, 58, 40] : AMBER);
      this.timerValue.style.left = '20px';
      this.timerValue.style.top = '97px';
      this.timerValue.style.width = '126px';
      this._timerValueKey = `${minutes}:${remainder.toFixed(1)}`;
    }
    this._chipsTop = showTimer ? 144 : 126;

    this._updatePlayers(match, mode);
    this._updateStatus(state, knockdowns, paused, match, handoffUp, webcamStatus, inputMode);
    this._updateWebcam(inputMode, webcamStatus);
    this._updatePhysics(physicsLines, hideScorecard, inputMode === 'webcam');
    this._updateQuestion(question, answerText, feedback, questionProgress, mode, state, hintsUnlocked, attemptsLeft, throwEarned);
    this._updateChallenge(challengeState, state);
    this._updateMessages(message, messageWarning, state);
    this._updateResults(results, state);
  }

  _layoutPins(rightX, remaining, questionUp) {
    if (questionUp) { this.pinsRow.style.display = 'none'; this.pinsLabel.style.display = 'none'; return; }
    this.pinsRow.style.display = 'block';
    this.pinsLabel.style.display = 'block';
    const count = Math.max(0, Math.min(10, Number(remaining) || 0));
    // Rack panel: dots laid out 4-3-2-1 from the back row to the head pin, in
    // the free block at the right-hand end of the top bar.
    const boxW = 132, boxH = 64;
    const boxLeft = rightX - boxW;
    const boxTop = 10;
    const dot = 7;
    const colGap = 14;
    const rowGap = 11;
    const centreX = boxLeft + boxW / 2;
    const topY = boxTop + 16;
    this.pinsRow.style.left = `${centreX}px`;
    this.pinsRow.style.top = `${topY}px`;
    this.pinsRow.style.width = '0px';
    this.pinsRow.style.height = '0px';
    this.pinsRow.innerHTML = '';
    const rows = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]];
    rows.forEach((row, r) => {
      row.forEach((pinNumber, i) => {
        const node = document.createElement('div');
        const up = pinNumber <= count;
        const column = i - (row.length - 1) / 2;
        node.style.cssText = `position:absolute;width:${dot}px;height:${dot}px;border-radius:2px;`
          + `left:${column * colGap - dot / 2}px;top:${r * rowGap - dot / 2}px;`
          + `background:${css(up ? PIN_UP_COLOR : PIN_DOWN_COLOR)};`
          + `opacity:${up ? 0.95 : 0.6};`
          + (up ? `box-shadow:0 0 5px ${cssA(PIN_UP_COLOR, 0.5)};` : '');
        this.pinsRow.appendChild(node);
      });
    });
    this.pinsLabel.textContent = `PINS ${count}/10`;
    this.pinsLabel.style.left = `${boxLeft}px`;
    this.pinsLabel.style.top = `${boxTop}px`;
    this.pinsLabel.style.width = `${boxW}px`;
  }

  _updatePlayers(match, mode) {
    if (!match || match.player_count < 2) {
      for (const chip of this.chips) chip.chip.style.display = 'none';
      return;
    }
    const players = match.players;
    const count = players.length;
    const total = 1244 - 36;
    const gap = 9;
    // A two-player match would otherwise stretch each chip across 600px of empty
    // plate; cap the width and centre the row.
    const width = Math.min(340, (total - gap * (count - 1)) / count);
    const rowWidth = width * count + gap * (count - 1);
    const left = 640 - rowWidth / 2;
    const top = this._chipsTop !== undefined ? this._chipsTop : 126;
    const height = 52;
    for (let i = 0; i < this.chips.length; i++) {
      const chip = this.chips[i];
      if (i >= count) { chip.chip.style.display = 'none'; continue; }
      chip.chip.style.display = 'block';
      const player = players[i];
      chip.chip.style.left = `${left + i * (width + gap)}px`;
      chip.chip.style.top = `${top}px`;
      chip.chip.style.width = `${width}px`;
      chip.chip.style.height = `${height}px`;
      const current = i === match.turn_index;
      const accent = current ? player.rgb : player.rgb.map((c) => Math.round(c * 0.45));
      chip.chip.style.background = cssA(accent, current ? 0.42 : 0.20);
      chip.name.textContent = player.name;
      chip.name.style.color = css(current ? WHITE : GRAY);
      chip.score.textContent = String(match.scoreOf(player));
      chip.score.style.color = css(SCORE_COLOR);
      let detail;
      if (player.is_bot) detail = `BOT ${player.difficulty.toUpperCase()}`;
      else if (mode && mode.score_style === 'frames') detail = `${player.total_pins} pins`;
      else detail = `${player.throws} throws`;
      chip.detail.textContent = detail;
      chip.detail.style.color = css(GRAY);
      chip.score.style.color = css(SCORE_COLOR);
    }
    if (mode && mode.timed) this._markLeader(match);
  }

  _markLeader(match) {
    // BowlRush: the leading player's score turns amber.
    const board = match.scoreboard();
    if (!board.length) return;
    const best = Math.max(...board.map(([, score]) => score));
    for (let i = 0; i < this.chips.length; i++) {
      if (i >= match.players.length) continue;
      const player = match.players[i];
      if (match.scoreOf(player) === best && best > 0) {
        this.chips[i].score.style.color = css(AMBER);
      }
    }
  }

  _updateStatus(state, knockdowns, paused, match, handoffUp = false, webcamStatus = null, inputMode = 'mouse') {
    // The handoff banner is the focused UI while the next bowler confirms; a
    // second "Next bowler" line in the HUD would just be a duplicate.
    this.status.style.display = (['question', 'challenge'].includes(state) || handoffUp) ? 'none' : 'block';
    let text;
    if (paused) text = 'Paused';
    else if (state === 'game_over') text = 'Match over';
    else if (state === 'question') text = 'Answer to earn a throw';
    else if (state === 'challenge') text = 'Solve it, then bowl it';
    else if (state === 'handoff') text = 'Next bowler';
    else if (state === 'rolling') text = 'Ball rolling...';
    else if (state === 'settling') text = 'Counting pins...';
    else if (state === 'result' && knockdowns !== null && knockdowns !== undefined) {
      if (knockdowns === 10) text = 'STRIKE!';
      else if (knockdowns === 0) text = 'No pins';
      else if (knockdowns === 1) text = '1 pin down';
      else text = `${knockdowns} pins down`;
    } else {
      const player = match ? match.current_player : null;
      if (player && match && match.player_count > 1) text = `${player.name} to bowl`;
      else if (player && player.is_bot) text = `${player.name} is preparing...`;
      else text = 'Ready to throw';
    }
    // In webcam mode the throw is armed by the player's pose, so "Ready to
    // throw" may only be shown while the tracker is actually feeding valid
    // measurements - otherwise the line would promise something the input
    // cannot do.
    if (inputMode === 'webcam' && !paused && state === 'ready' && !(match && match.current_player && match.current_player.is_bot)) {
      const status = webcamStatus;
      if (!status || !status.running) text = 'Waiting for the camera...';
      else if (status.error) text = 'Camera unavailable - press TAB for mouse controls';
      else if (!status.tracked) text = 'Step into the camera view';
      else if (status.phase === 'tracking') text = 'Hold still with your arms down';
      else if (status.phase === 'ready') text = 'Ready to throw';
      else text = status.phase_label || 'Ready to throw';
    }
    this.status.textContent = text;
    // Centred across the full stage: the box spans the stage and the text is
    // centred inside it (the original places the line at x=0 in UI space).
    this.status.style.left = '160px';
    this.status.style.top = '96px';
    this.status.style.width = '960px';
    this.status.style.transform = 'none';
    this.status.style.color = css(knockdowns === 10 ? YELLOW : (paused ? GRAY : WHITE));
  }

  _updateWebcam(inputMode, webcamStatus) {
    const lines = inputMode === 'webcam' ? webcamFeedbackLines(webcamStatus) : [];
    if (!lines.length) {
      this._webcamPanel.style.display = 'none';
      for (const line of this.webcamLines) line.textContent = '';
      return;
    }
    this._webcamPanel.style.display = 'block';
    const width = (this.question_panel.visible || this.challenge_panel.visible) ? 190 : 340;
    this._webcamPanel.style.width = `${width}px`;
    this._webcamPanel.style.padding = '8px';
    for (let i = 0; i < this.webcamLines.length; i++) {
      const line = this.webcamLines[i];
      if (i < lines.length) {
        line.style.display = 'block';
        line.textContent = lines[i][0];
        line.style.color = css(lines[i][1]);
      } else line.style.display = 'none';
    }
  }

  _updatePhysics(physicsLines, halt = false, webcamMode = false) {
    if (halt || !physicsLines || !physicsLines.length) {
      this.readout.style.display = 'none';
      this.readout.textContent = '';
      this._readoutHasData = false;
      return;
    }
    const standalone = physicsLines.filter((line) => !line.startsWith('#'));
    // Webcam mode keeps the tracking diagnostics visible (they are prepended);
    // every other mode shows the compact three-line physics summary.
    const text = standalone.slice(0, webcamMode ? 7 : 3).join('\n');
    this.readout.textContent = text;
    const visible = !this.motion || !this.motion.hud || this.motion.hud._physicsVisible !== false;
    this.readout.style.display = visible ? 'block' : 'none';
    this._readoutHasData = true;
    // Keep the webcam chip clear of the readout.
    this.readout.style.bottom = '14px';
  }

  _updateQuestion(question, answerText, feedback, progress, mode, state, hintsUnlocked, attemptsLeft, throwEarned) {
    if (question === null || state !== 'question') { this.question_panel.hide(); return; }
    this.question_panel.show();
    this.question_panel.update(question, answerText, feedback, progress, mode ? mode.title : 'QUIZ',
      feedback === null, hintsUnlocked, attemptsLeft, throwEarned);
  }

  _updateChallenge(challengeState, state) {
    if (!challengeState || state !== 'challenge') { this.challenge_panel.hide(); return; }
    this.challenge_panel.show();
    this.challenge_panel.update(challengeState);
  }

  _updateMessages(message, messageWarning, state) {
    if (message && state !== 'game_over') {
      this.message.style.display = 'block';
      this.message.textContent = message;
      this.message.style.color = css(messageWarning ? RED : YELLOW);
    } else this.message.style.display = 'none';
  }

  _updateResults(results, state) {
    if (results === null || results === undefined) { this.results.style.display = 'none'; return; }
    this.results.style.display = 'block';
    this.results.textContent = Array.isArray(results) ? results.join('\n') : String(results);
  }
}
