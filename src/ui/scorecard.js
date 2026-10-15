// The in-play compact scorecard: ten frame cells along the top bar, each with
// the two roll boxes a bowler reads (three in the tenth) and the running frame
// total underneath. Marks come straight from the game's BowlingGame, so the bar
// and the full card can never disagree.
import { PALETTE, css, cssA } from './theme.js';
import { div, el } from './dom.js';
import { boxCountFor, frameBoxes, isBonusMark } from './cardmodel.js';

const CELL_BG = [20, 17, 46];
const CELL_BG_ALT = [26, 22, 58];
const CELL_LIVE = [26, 62, 96];
const RULE = [58, 52, 108];
const MARK_RGB = [242, 246, 255];
const SCORE_RGB = [255, 214, 130];
const BONUS_RGB = [128, 230, 255];
const LABEL_RGB = [146, 158, 198];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export class Scorecard {
  constructor(parent) {
    this.root = div('scorecard', parent);
    this.root.style.position = 'absolute';
    this.root.style.display = 'none';
    this.cells = [];
    for (let f = 1; f <= 10; f++) {
      const cell = div('score-cell', this.root);
      cell.style.cssText = 'position:absolute;overflow:hidden;';
      const label = el('div', 'cell-label', cell, String(f));
      label.style.cssText = 'position:absolute;left:0;width:100%;text-align:center;font-weight:700;';
      const rolls = div('cell-rolls', cell);
      rolls.style.cssText = 'position:absolute;display:flex;';
      const boxes = [];
      for (let b = 0; b < 3; b++) {
        const box = el('div', 'cell-roll', rolls, '');
        box.style.cssText = 'display:flex;align-items:center;justify-content:center;font-weight:800;';
        boxes.push(box);
      }
      const score = el('div', 'cell-score', cell, '');
      score.style.cssText = 'position:absolute;left:0;width:100%;text-align:center;font-weight:800;';
      this.cells.push({ cell, label, rolls, boxes, score });
    }
    this._visible = false;
  }

  setVisible(visible) {
    this._visible = !!visible;
    this.root.style.display = visible ? 'block' : 'none';
  }

  // area is (left, right, top, bottom) in reference pixels, top < bottom.
  update(score, currentFrame, area) {
    if (!this._visible) return;
    const [left, right, top, bottom] = area;
    const width = right - left;
    const height = bottom - top;
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
    this.root.style.width = `${width}px`;
    this.root.style.height = `${height}px`;

    const numH = clamp(Math.round(height * 0.20), 12, 16);
    const totalH = clamp(Math.round(height * 0.29), 16, 24);
    const rollsH = Math.max(20, height - numH - totalH - 2);
    const markPx = clamp(Math.round(rollsH * 0.62), 13, 20);
    const totalPx = clamp(Math.round(totalH * 0.70), 12, 17);

    // Nine regular frames plus a 1.5x tenth, matching a printed card.
    const unit = width / 10.5;
    const cumulative = score.cumulativeScores();

    for (let index = 0; index < 10; index++) {
      const frame = index + 1;
      const last = frame === 10;
      const w = Math.round(last ? unit * 1.5 : unit);
      const x = Math.round(last ? unit * 9 : unit * (frame - 1));
      const cellView = this.cells[index];
      const live = currentFrame !== null && frame === currentFrame;

      cellView.cell.style.left = `${x}px`;
      cellView.cell.style.top = '0px';
      cellView.cell.style.width = `${w}px`;
      cellView.cell.style.height = `${height}px`;
      cellView.cell.style.background = live ? css(CELL_LIVE) : (frame % 2 === 0 ? css(CELL_BG_ALT) : css(CELL_BG));
      cellView.cell.style.boxShadow = live
        ? `inset 0 0 0 1px ${cssA(PALETTE.cyan, 0.95)}, 0 0 14px ${cssA(PALETTE.cyan, 0.35)}`
        : `inset 0 0 0 1px ${cssA(RULE, 0.85)}`;
      cellView.cell.style.borderTopLeftRadius = frame === 1 ? '5px' : '0px';
      cellView.cell.style.borderTopRightRadius = last ? '5px' : '0px';

      cellView.label.style.top = '1px';
      cellView.label.style.fontSize = `${clamp(Math.round(numH * 0.8), 9, 12)}px`;
      cellView.label.style.color = live ? css(BONUS_RGB) : cssA(LABEL_RGB, 0.8);

      const marks = frameBoxes(score, frame);
      const boxes = boxCountFor(frame);
      const boxW = (w - 4) / boxes;
      cellView.rolls.style.left = '2px';
      cellView.rolls.style.top = `${numH}px`;
      cellView.rolls.style.width = `${w - 4}px`;
      cellView.rolls.style.height = `${rollsH}px`;
      cellView.rolls.style.boxShadow = `inset 0 -1px 0 ${cssA(RULE, 0.85)}`;
      for (let b = 0; b < 3; b++) {
        const box = cellView.boxes[b];
        box.style.display = b < boxes ? 'flex' : 'none';
        box.style.width = `${boxW}px`;
        box.style.height = '100%';
        box.style.fontSize = `${markPx}px`;
        box.style.borderLeft = b === 0 ? 'none' : `1px solid ${cssA(RULE, 0.8)}`;
        const mark = marks[b] !== undefined ? marks[b] : '';
        box.textContent = mark;
        box.style.color = isBonusMark(mark) ? css(BONUS_RGB) : css(MARK_RGB);
      }

      const value = cumulative[index];
      cellView.score.textContent = value === null || value === undefined ? '' : String(value);
      cellView.score.style.top = `${numH + rollsH}px`;
      cellView.score.style.height = `${totalH}px`;
      cellView.score.style.lineHeight = `${totalH}px`;
      cellView.score.style.fontSize = `${totalPx}px`;
      cellView.score.style.color = css(SCORE_RGB);
    }
  }
}
