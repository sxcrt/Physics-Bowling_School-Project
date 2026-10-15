// The Equation Mode challenge panel (ported from ui/challenge_panel.py).
import { COLORS, TYPE_PX, SIZES, css, cssA, wrapText, LAYOUT } from './theme.js';
import { div, el, button as makeButton, fitLines } from './dom.js';
import { drawLaneDiagram } from './diagram.js';

const GREEN = [120, 230, 120];
const AMBER = [255, 214, 130];
const RED = [240, 110, 110];
const GRAY = [186, 194, 214];
const WHITE = [242, 242, 248];
const CYAN = COLORS.cyan;
const LINE_GAP = 6;

export function makeChallengeView(data = {}) {
  return {
    challenge: null, progress: '', input_text: '', result: null, attempts: 0,
    hints_unlocked: 0, solution: '', show_solution: false, caret: true,
    path: [], pins: [], launched: false, gutter_x: null, error: '', ...data,
  };
}

export class ChallengePanel {
  constructor(parent) {
    this.root = div('challenge-panel', parent);
    this.root.style.position = 'absolute';
    this.root.style.left = '0';
    this.root.style.top = '0';
    this.root.style.width = '1280px';
    this.root.style.height = '720px';
    this.root.style.display = 'none';
    this.visible = false;
    this.on_primary = null;
    this.on_solution = null;
    this.action = 'bowl';

    this.body = div('panel', this.root);
    this.body.style.position = 'absolute';
    this.body.style.borderRadius = '16px';
    this.body.style.background = cssA(COLORS.panel, 0.92);
    this.body.style.border = '1px solid transparent';
    this.body.style.borderImage = 'linear-gradient(90deg, rgba(62,201,232,0.6), rgba(255,61,139,0.6)) 1';

    this.heading = this._label('', { px: SIZES.challenge_header, rgb: CYAN, bold: true, tracking: 2 });
    this.caseLabel = this._label('', { px: SIZES.challenge_header, rgb: COLORS.text_dim, align: 'right' });
    this.headRule = this._rule();
    this.title = this._label('', { px: SIZES.challenge_title, rgb: COLORS.text, bold: true, lefttop: true });
    this.brief = this._label('', { px: SIZES.challenge_body, rgb: COLORS.text_dim, lefttop: true, lineHeight: 1.3 });
    this.targetLabel = this._label('YOUR TASK', { px: SIZES.challenge_header, rgb: AMBER, bold: true, tracking: 2, lefttop: true });
    this.target = this._label('', { px: TYPE_PX.body, rgb: COLORS.text, lefttop: true });
    this.givenLabel = this._label('GIVEN', { px: SIZES.challenge_header, rgb: CYAN, bold: true, tracking: 2, lefttop: true });
    this.given = this._label('', { px: TYPE_PX.body_small, rgb: COLORS.text, lefttop: true });
    this.equationLabel = this._label('GOVERNING EQUATION', { px: SIZES.challenge_header, rgb: CYAN, bold: true, tracking: 2, lefttop: true });
    this.equation = this._label('', { px: TYPE_PX.body, rgb: GREEN, lefttop: true });

    this.diagram = document.createElement('canvas');
    this.diagram.width = SIZES.challenge_diagram_w;
    this.diagram.height = SIZES.challenge_diagram_h;
    this.diagram.style.position = 'absolute';
    this.root.appendChild(this.diagram);

    this.fieldBody = div('field-body', this.root);
    this.fieldBody.style.position = 'absolute';
    this.fieldBody.style.background = cssA(COLORS.card, 1);
    this.fieldBody.style.borderRadius = `${SIZES.challenge_input_radius}px`;
    this.fieldEdge = div('field-edge', this.root);
    this.fieldEdge.style.position = 'absolute';
    this.fieldEdge.style.borderRadius = `${SIZES.challenge_input_radius}px`;
    this.fieldEdge.style.border = `${SIZES.challenge_border}px solid ${cssA(COLORS.hairline, 1)}`;
    this.fieldLabel = this._label('', { px: TYPE_PX.body, rgb: COLORS.text_dim });
    this.field = this._label('', { px: TYPE_PX.heading, rgb: WHITE, bold: true });
    this.unitLabel = this._label('', { px: TYPE_PX.body, rgb: COLORS.text_dim });
    this.caret = div('caret', this.root);
    this.caret.style.position = 'absolute';
    this.caret.style.background = cssA(CYAN, 0.9);

    this.feedbackHeadline = this._label('', { px: TYPE_PX.heading, bold: true, lefttop: true });
    this.feedbackLines = [];
    for (let i = 0; i < SIZES.challenge_feedback_lines; i++) {
      this.feedbackLines.push(this._label('', { px: TYPE_PX.chip, lefttop: true }));
    }
    this.footer = this._label('', { px: TYPE_PX.label, rgb: COLORS.text_dim, lefttop: true });

    this.primaryButton = makeButton(this.root, 'BOWL IT', {
      w: SIZES.challenge_button_w, h: SIZES.challenge_button_h, radius: 12,
      accent: COLORS.pink, variant: 'primary', fontPx: SIZES.nav_font, tracking: 1,
      onClick: () => this._primary(),
    });
    this.solutionButton = makeButton(this.root, 'SHOW SOLUTION', {
      w: SIZES.challenge_button_w, h: SIZES.challenge_button_h, radius: 12,
      accent: CYAN, variant: 'ghost', fontPx: SIZES.nav_font - 2, tracking: 1,
      onClick: () => this._solution(),
    });
  }

  _label(text, opts) {
    const node = el('div', '', this.root, text);
    node.style.position = 'absolute';
    node.style.fontSize = `${opts.px || 16}px`;
    node.style.fontWeight = opts.bold ? 700 : 400;
    node.style.letterSpacing = `${opts.tracking || 0}px`;
    node.style.color = css(opts.rgb || COLORS.text);
    if (opts.align === 'right') node.style.transform = 'translateX(-100%)';
    if (opts.lefttop) node.style.whiteSpace = 'pre-wrap';
    if (opts.lineHeight) node.style.lineHeight = String(opts.lineHeight);
    node.style.maxWidth = '100%';
    return node;
  }

  _rule() {
    const node = div('rule', this.root);
    node.style.position = 'absolute';
    node.style.background = cssA(COLORS.hairline, 1);
    return node;
  }

  setCallbacks(onPrimary, onSolution = null) { this.on_primary = onPrimary; this.on_solution = onSolution; }
  _primary() { if (this.on_primary) this.on_primary(this.action); }
  _solution() { if (this.on_solution) this.on_solution(); }

  hide() { this.visible = false; this.root.style.display = 'none'; }
  show() { this.visible = true; this.root.style.display = 'block'; }

  click(x, y) {
    if (!this.visible) return false;
    // Buttons are real DOM elements; their own click handlers fire. Return true to
    // prevent the game's click handler from also firing.
    const r = this.root.getBoundingClientRect();
    const scale = 1280 / r.width;
    const px = (x * 720 + 640) * 1;
    return false;
  }

  updateWidgets(x, y, dt) {}

  update(view) {
    const challenge = view.challenge;
    if (!challenge) { this.hide(); return; }
    this.show();
    const W = SIZES.challenge_w;
    const TOP = SIZES.challenge_y;
    const PAD = SIZES.challenge_pad;
    const GAP = SIZES.challenge_gap;
    const DIAGRAM_W = SIZES.challenge_diagram_w;
    const DIAGRAM_H = SIZES.challenge_diagram_h;
    const contentW = W - 2 * PAD;
    const left = 640 - W / 2 + PAD;
    const right = 640 + W / 2 - PAD;
    const maxBottom = 720 - LAYOUT.margin_bottom;
    const marking = view.result !== null || !!view.solution;
    const solved = !!(view.result && view.result.solved);
    const headerH = SIZES.challenge_header + 6;

    // ==== measure ==========================================================
    this.heading.textContent = view.progress.toUpperCase();
    this.caseLabel.textContent = challenge.case || '';
    this.title.textContent = challenge.title;
    this.title.style.maxWidth = `${contentW}px`;
    const titleH = this.title.offsetHeight || SIZES.challenge_title;

    this.brief.style.maxWidth = `${contentW - DIAGRAM_W - GAP}px`;
    fitLines(this.brief, challenge.brief || '', 4);
    const briefH = this.brief.offsetHeight;

    this.targetLabel.textContent = 'YOUR TASK';
    const labelW = this.targetLabel.offsetWidth + 12;
    this.target.textContent = challenge.target;
    this.target.style.maxWidth = `${contentW - labelW}px`;
    const targetH = Math.max(this.targetLabel.offsetHeight, this.target.offsetHeight);

    const givenText = (challenge.given || []).map(([n, v]) => `${n} = ${v}`).join('    ') || challenge.assumptions || '';
    this.given.textContent = givenText;
    this.given.style.maxWidth = `${contentW}px`;
    const givenH = this.given.offsetHeight;

    let eqText = challenge.equation || '';
    if (challenge.equation_note) eqText = eqText ? `${eqText}\n${challenge.equation_note}` : challenge.equation_note;
    this.equation.textContent = eqText;
    this.equation.style.maxWidth = `${contentW}px`;
    const eqH = this.equation.offsetHeight;

    const fieldH = SIZES.challenge_input_h;
    const buttonW = SIZES.challenge_button_w;
    const mainH = Math.max(briefH, DIAGRAM_H);
    const headlineReserve = (marking || view.error) ? (TYPE_PX.heading + LINE_GAP) : 0;
    const budget = maxBottom - TOP - 2 * PAD;
    const fixed = headerH + 4 + titleH + 8 + mainH + 12 + targetH + 10
      + SIZES.challenge_header + 4 + givenH + 10
      + SIZES.challenge_header + 4 + eqH + 12 + fieldH;
    const available = Math.max(0, budget - fixed - headlineReserve);

    // ==== feedback entries (capped to the room left) =======================
    const entries = this._feedbackEntries(view, contentW, available);
    let used = 0;
    entries.forEach(([, , spriteH], i) => { used += spriteH + (i ? LINE_GAP : 0); });

    const footerText = this._footerText(view, solved, marking);
    this.footer.textContent = footerText;
    this.footer.style.maxWidth = `${contentW}px`;
    this.footer.style.display = footerText ? 'block' : 'none';
    const footerH = footerText ? this.footer.offsetHeight : 0;
    this.body.style.left = `${640 - W / 2}px`;
    this.body.style.top = `${TOP}px`;
    this.body.style.width = `${W}px`;
    this.body.style.height = '120px';

    // ==== place ============================================================
    let y = TOP + PAD;
    const headerMid = y + headerH / 2;
    this.heading.style.left = `${left}px`;
    this.heading.style.top = `${headerMid - this.heading.offsetHeight / 2}px`;
    this.caseLabel.style.left = `${right}px`;
    this.caseLabel.style.top = `${headerMid - this.caseLabel.offsetHeight / 2}px`;
    const ruleLeft = left + (this.heading.offsetWidth || 80) + 16;
    const caseW = challenge.case ? (this.caseLabel.offsetWidth || 0) : 0;
    const ruleRight = right - (caseW + 16);
    if (ruleRight > ruleLeft + 16) {
      this.headRule.style.display = 'block';
      this.headRule.style.left = `${ruleLeft}px`;
      this.headRule.style.top = `${headerMid}px`;
      this.headRule.style.width = `${ruleRight - ruleLeft}px`;
      this.headRule.style.height = '1px';
    } else this.headRule.style.display = 'none';
    y += headerH + 4;

    this.title.style.left = `${left}px`; this.title.style.top = `${y}px`;
    y += titleH + 8;

    this.brief.style.left = `${left}px`; this.brief.style.top = `${y}px`;
    this.diagram.style.left = `${right - DIAGRAM_W}px`;
    this.diagram.style.top = `${y}px`;
    drawLaneDiagram(this.diagram, {
      pins: view.pins, path: view.path, startX: view.path.length ? view.path[0][0] : (challenge.fixed.position ?? 0),
      aimX: challenge.aimX(), solved, launched: view.launched, gutterX: view.gutter_x,
    });
    y += mainH + 12;

    this.targetLabel.style.left = `${left}px`; this.targetLabel.style.top = `${y}px`;
    this.target.style.left = `${left + labelW}px`; this.target.style.top = `${y}px`;
    y += targetH + 10;

    this.givenLabel.style.left = `${left}px`; this.givenLabel.style.top = `${y}px`;
    y += SIZES.challenge_header + 4;
    this.given.style.left = `${left}px`; this.given.style.top = `${y}px`;
    y += givenH + 10;

    this.equationLabel.style.left = `${left}px`; this.equationLabel.style.top = `${y}px`;
    y += SIZES.challenge_header + 4;
    this.equation.style.left = `${left}px`; this.equation.style.top = `${y}px`;
    y += eqH + 12;

    // ==== input row ========================================================
    const fieldW = contentW - buttonW - 12;
    const interactive = !solved && !view.solution;
    const fieldY = y + fieldH / 2;
    this.fieldBody.style.left = `${left}px`; this.fieldBody.style.top = `${y}px`;
    this.fieldBody.style.width = `${fieldW}px`; this.fieldBody.style.height = `${fieldH}px`;
    this.fieldEdge.style.left = `${left}px`; this.fieldEdge.style.top = `${y}px`;
    this.fieldEdge.style.width = `${fieldW - SIZES.challenge_border * 2}px`; this.fieldEdge.style.height = `${fieldH - SIZES.challenge_border * 2}px`;
    const edgeColour = !interactive ? COLORS.hairline : (view.error ? RED : (view.caret ? CYAN : COLORS.hairline));
    this.fieldEdge.style.borderColor = cssA(edgeColour, 1);

    const pad = SIZES.challenge_input_pad;
    const text = view.input_text || '';
    if (text) {
      this.field.style.display = 'block';
      this.fieldLabel.style.display = 'none';
      this.field.textContent = text;
      this.field.style.left = `${left + pad}px`;
      this.field.style.top = `${fieldY - this.field.offsetHeight / 2}px`;
      this.field.style.color = marking ? css(AMBER) : css(WHITE);
      this.unitLabel.style.display = 'block';
      this.unitLabel.textContent = challenge.control.unit;
      this.unitLabel.style.left = `${left + pad + this.field.offsetWidth + 8}px`;
      this.unitLabel.style.top = `${fieldY - this.unitLabel.offsetHeight / 2}px`;
    } else {
      this.field.style.display = 'none';
      this.fieldLabel.style.display = 'block';
      this.fieldLabel.textContent = `${challenge.control.label}  (${challenge.control.unit})`;
      this.fieldLabel.style.left = `${left + pad}px`;
      this.fieldLabel.style.top = `${fieldY - this.fieldLabel.offsetHeight / 2}px`;
      this.unitLabel.style.display = 'none';
    }
    this.caret.style.display = (interactive && view.caret) ? 'block' : 'none';
    if (this.caret.style.display === 'block') {
      const caretX = text ? left + pad + this.field.offsetWidth + 8 + (this.unitLabel.style.display !== 'none' ? this.unitLabel.offsetWidth + 10 : 0) : left + pad;
      this.caret.style.left = `${Math.min(caretX, left + fieldW - 12)}px`;
      this.caret.style.top = `${fieldY - fieldH * 0.26}px`;
      this.caret.style.width = '2px';
      this.caret.style.height = `${fieldH * 0.52}px`;
    }

    const buttonX = right - buttonW / 2;
    const primaryLabel = view.solution ? 'CONTINUE' : (solved ? 'NEXT CHALLENGE' : (view.result !== null ? 'BOWL AGAIN' : 'BOWL IT'));
    this.action = view.solution || solved ? 'continue' : 'bowl';
    this.primaryButton.textContent = primaryLabel;
    this.primaryButton.style.left = `${buttonX - buttonW / 2}px`;
    this.primaryButton.style.top = `${fieldY - SIZES.challenge_button_h / 2}px`;
    this.solutionButton.style.display = (view.show_solution && interactive) ? 'flex' : 'none';
    this.solutionButton.style.left = `${buttonX - buttonW / 2 - 12 - buttonW}px`;
    this.solutionButton.style.top = `${fieldY - SIZES.challenge_button_h / 2}px`;

    // ==== feedback ==========================================================
    y += fieldH + LINE_GAP;
    this.feedbackHeadline.style.display = 'none';
    if (view.error) {
      this.feedbackHeadline.style.display = 'block';
      this.feedbackHeadline.textContent = view.error;
      this.feedbackHeadline.style.color = css(RED);
      this.feedbackHeadline.style.left = `${left}px`; this.feedbackHeadline.style.top = `${y}px`;
      y += this.feedbackHeadline.offsetHeight + LINE_GAP;
    } else if (marking) {
      this.feedbackHeadline.style.display = 'block';
      const headline = view.result ? view.result.headline : 'WORKED SOLUTION';
      this.feedbackHeadline.textContent = headline;
      this.feedbackHeadline.style.color = css(solved ? GREEN : RED);
      this.feedbackHeadline.style.left = `${left}px`; this.feedbackHeadline.style.top = `${y}px`;
      y += this.feedbackHeadline.offsetHeight + LINE_GAP;
    }

    for (const [sprite, colour, spriteH] of entries) {
      sprite.style.display = 'block';
      sprite.style.color = css(colour);
      sprite.style.left = `${left}px`; sprite.style.top = `${y}px`;
      y += spriteH + LINE_GAP;
    }
    for (const sprite of this.feedbackLines.slice(entries.length)) sprite.style.display = 'none';

    this.footer.style.display = footerText ? 'block' : 'none';
    if (footerText) {
      this.footer.style.left = `${left}px`; this.footer.style.top = `${y}px`;
    }
    // The plate must contain everything that was placed (the size the original
    // computes up front; computing it from the final cursor is exact).
    const contentBottom = footerText
      ? y + this.footer.offsetHeight
      : y - (entries.length ? LINE_GAP : 0);
    const height = Math.max(120, Math.min(maxBottom - TOP, contentBottom + PAD - TOP));
    this.body.style.height = `${height}px`;
  }

  _feedbackEntries(view, contentW, available) {
    const entries = [];
    let lines = [];
    if (view.solution) {
      lines = wrapText(view.solution, 118).slice(0, 4).map((chunk) => [`Worked solution: ${chunk}`, GRAY]);
    } else if (view.result) {
      const outcome = view.result;
      lines = outcome.lines.map((line) => [line, GRAY]);
      if (view.challenge.control.key === 'torque' && view.input_text) {
        const value = parseFloat(view.input_text);
        if (!Number.isNaN(value)) {
          const derived = view.challenge.derivedText(value);
          if (derived) lines.splice(1, 0, [derived, CYAN]);
        }
      }
      const steps = view.challenge.steps || [];
      for (let i = 0; i < Math.min(view.hints_unlocked, steps.length); i++) {
        lines.push([`Step ${i + 1}:  ${steps[i]}`, AMBER]);
      }
    }
    let used = 0;
    for (const [text, colour] of lines) {
      if (entries.length >= this.feedbackLines.length) break;
      const sprite = this.feedbackLines[entries.length];
      // The sprite may still be hidden from the previous frame; offsetHeight is
      // 0 for a display:none element, so show it before measuring the line.
      sprite.style.display = 'block';
      sprite.style.maxWidth = `${contentW}px`;
      fitLines(sprite, text, 2);
      const spriteH = sprite.offsetHeight || 16;
      const extra = spriteH + (entries.length ? LINE_GAP : 0);
      if (entries.length && used + extra > available) break;
      used += extra;
      entries.push([sprite, colour, spriteH]);
    }
    return entries;
  }

  _footerText(view, solved, marking) {
    if (view.solution) return 'The worked solution is above. Press CONTINUE for the next challenge.';
    if (view.error) return 'Type a number (units optional), then press ENTER.';
    if (solved) return 'Correct - CONTINUE moves to the next challenge.';
    if (marking && view.result) return `${view.result.verdict}  Change the value and press ENTER to bowl again.`;
    if (marking) return 'Change the value and press ENTER to bowl again.';
    if (view.input_text && view.challenge.control.key === 'torque') {
      const value = parseFloat(view.input_text);
      if (!Number.isNaN(value)) {
        const derived = view.challenge.derivedText(value);
        if (derived) return `${derived}  Press ENTER to bowl.`;
      }
    }
    return 'Unlimited attempts: edit the value, press ENTER, watch the simulation.';
  }
}
