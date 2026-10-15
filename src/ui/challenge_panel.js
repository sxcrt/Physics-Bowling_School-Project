// The Equation Mode challenge panel (ported from ui/challenge_panel.py).
import { COLORS, TYPE_PX, SIZES, css, cssA, wrapText, LAYOUT } from './theme.js';
import { div, el, button as makeButton } from './dom.js';
import { drawLaneDiagram } from './diagram.js';

const GREEN = [120, 230, 120];
const AMBER = [255, 214, 130];
const RED = [240, 110, 110];
const GRAY = [186, 194, 214];
const WHITE = [242, 242, 248];
const CYAN = COLORS.cyan;

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
    const LINE_GAP = 6;
    const DIAGRAM_W = SIZES.challenge_diagram_w;
    const DIAGRAM_H = SIZES.challenge_diagram_h;
    const contentW = W - 2 * PAD;
    const left = 640 - W / 2 + PAD;
    const right = 640 + W / 2 - PAD;
    const maxBottom = 720 - LAYOUT.margin_bottom;
    const marking = view.result !== null || !!view.solution;
    const solved = !!(view.result && view.result.solved);

    const headerH = SIZES.challenge_header + 6;
    this.heading.textContent = view.progress.toUpperCase();
    this.heading.style.left = `${left}px`; this.heading.style.top = `${TOP + PAD}px`;
    this.caseLabel.textContent = challenge.case || '';
    this.caseLabel.style.left = `${right}px`; this.caseLabel.style.top = `${TOP + PAD}px`;

    let y = TOP + PAD + headerH + 4;
    this.title.textContent = challenge.title;
    this.title.style.left = `${left}px`; this.title.style.top = `${y}px`;
    y += SIZES.challenge_title + 8;

    this.brief.textContent = challenge.brief;
    this.brief.style.left = `${left}px`; this.brief.style.top = `${y}px`;
    this.brief.style.maxWidth = `${contentW - DIAGRAM_W - GAP}px`;
    this.brief.style.maxHeight = `${SIZES.challenge_body * 4 * 1.3 + 4}px`;
    this.brief.style.overflow = 'hidden';
    this.diagram.style.left = `${right - DIAGRAM_W}px`;
    this.diagram.style.top = `${y}px`;
    drawLaneDiagram(this.diagram, {
      pins: view.pins, path: view.path, startX: view.path.length ? view.path[0][0] : (challenge.fixed.position ?? 0),
      aimX: challenge.aimX(), solved, launched: view.launched, gutterX: view.gutter_x,
    });
    y += DIAGRAM_H + 12;

    this.targetLabel.style.left = `${left}px`; this.targetLabel.style.top = `${y}px`;
    const labelW = this.targetLabel.offsetWidth + 12;
    this.target.textContent = challenge.target;
    this.target.style.left = `${left + labelW}px`; this.target.style.top = `${y}px`;
    this.target.style.maxWidth = `${contentW - labelW}px`;
    y += SIZES.challenge_header + 10;

    this.givenLabel.style.left = `${left}px`; this.givenLabel.style.top = `${y}px`;
    y += SIZES.challenge_header + 4;
    const givenText = challenge.given.map(([n, v]) => `${n} = ${v}`).join('    ') || challenge.assumptions;
    this.given.textContent = givenText;
    this.given.style.left = `${left}px`; this.given.style.top = `${y}px`;
    this.given.style.maxWidth = `${contentW}px`;
    y += SIZES.challenge_header + 10;

    this.equationLabel.style.left = `${left}px`; this.equationLabel.style.top = `${y}px`;
    y += SIZES.challenge_header + 4;
    let eqText = challenge.equation || '';
    if (challenge.equation_note) eqText = eqText ? eqText + '\n' + challenge.equation_note : challenge.equation_note;
    this.equation.textContent = eqText;
    this.equation.style.left = `${left}px`; this.equation.style.top = `${y}px`;
    this.equation.style.maxWidth = `${contentW}px`;
    y += (eqText.includes('\n') ? SIZES.challenge_header * 3 : SIZES.challenge_header * 2) + 12;

    const fieldH = SIZES.challenge_input_h;
    const buttonW = SIZES.challenge_button_w;
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
      this.field.style.left = `${left + pad}px`; this.field.style.top = `${fieldY}px`;
      this.field.style.color = marking ? css(AMBER) : css(WHITE);
      this.unitLabel.style.display = 'block';
      this.unitLabel.textContent = challenge.control.unit;
      this.unitLabel.style.left = `${left + pad + this.field.offsetWidth + 8}px`;
      this.unitLabel.style.top = `${fieldY}px`;
    } else {
      this.field.style.display = 'none';
      this.fieldLabel.style.display = 'block';
      this.fieldLabel.textContent = `${challenge.control.label}  (${challenge.control.unit})`;
      this.fieldLabel.style.left = `${left + pad}px`; this.fieldLabel.style.top = `${fieldY}px`;
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

    y += fieldH + LINE_GAP;
    const entries = this._feedbackEntries(view, contentW);
    if (view.error) {
      this.feedbackHeadline.style.display = 'block';
      this.feedbackHeadline.textContent = view.error;
      this.feedbackHeadline.style.color = css(RED);
      this.feedbackHeadline.style.left = `${left}px`; this.feedbackHeadline.style.top = `${y}px`;
      y += TYPE_PX.heading + LINE_GAP;
    } else if (marking) {
      this.feedbackHeadline.style.display = 'block';
      const headline = view.result ? view.result.headline : 'WORKED SOLUTION';
      this.feedbackHeadline.textContent = headline;
      this.feedbackHeadline.style.color = css(solved ? GREEN : RED);
      this.feedbackHeadline.style.left = `${left}px`; this.feedbackHeadline.style.top = `${y}px`;
      y += TYPE_PX.heading + LINE_GAP;
    } else this.feedbackHeadline.style.display = 'none';

    for (const [sprite, colour] of entries) {
      sprite.style.display = 'block';
      sprite.textContent = (sprite._text || '');
      sprite.style.color = css(colour);
      sprite.style.left = `${left}px`; sprite.style.top = `${y}px`;
      sprite.style.maxWidth = `${contentW}px`;
      y += (sprite._h || 16) + LINE_GAP;
    }
    for (const sprite of this.feedbackLines.slice(entries.length)) sprite.style.display = 'none';

    const footerText = this._footerText(view, solved, marking);
    this.footer.style.display = footerText ? 'block' : 'none';
    if (footerText) {
      this.footer.textContent = footerText;
      this.footer.style.left = `${left}px`; this.footer.style.top = `${y}px`;
      this.footer.style.maxWidth = `${contentW}px`;
      y += TYPE_PX.label + LINE_GAP;
    }
    const height = Math.min(maxBottom - TOP, y - TOP + PAD);
    this.body.style.left = `${640 - W / 2}px`;
    this.body.style.top = `${TOP}px`;
    this.body.style.width = `${W}px`;
    this.body.style.height = `${height}px`;
  }

  _feedbackEntries(view, contentW) {
    const entries = [];
    if (view.solution) {
      const lines = wrapText(view.solution, 118).slice(0, 4);
      for (const chunk of lines) {
        const sprite = this.feedbackLines[entries.length];
        sprite._text = `Worked solution: ${chunk}`; sprite._h = 16;
        entries.push([sprite, GRAY]);
      }
    } else if (view.result) {
      const outcome = view.result;
      const lines = outcome.lines.slice();
      if (view.challenge.control.key === 'torque' && view.input_text) {
        const value = parseFloat(view.input_text);
        if (!Number.isNaN(value)) {
          const derived = view.challenge.derivedText(value);
          if (derived) lines.splice(1, 0, derived);
        }
      }
      lines.forEach((text) => {
        const sprite = this.feedbackLines[entries.length];
        sprite._text = text; sprite._h = 16;
        entries.push([sprite, GRAY]);
      });
      const steps = view.challenge.steps || [];
      for (let i = 0; i < Math.min(view.hints_unlocked, steps.length); i++) {
        const sprite = this.feedbackLines[entries.length];
        sprite._text = `Step ${i + 1}:  ${steps[i]}`; sprite._h = 16;
        entries.push([sprite, AMBER]);
      }
    }
    // Torque derived line colour when inserted.
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
