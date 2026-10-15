// Scorecard HUD: ten frame cells with roll marks and running totals (ported
// from ui/scorecard.py).
import { css, cssA, COLORS } from './theme.js';
import { div, el } from './dom.js';

const CELL_RGB = [22, 28, 52];
const CURRENT_RGB = [26, 132, 186];
const GLOW_RGB = [96, 226, 255];
const LABEL_RGB = [150, 164, 205];
const MARK_RGB = [242, 246, 255];
const SCORE_RGB = [255, 214, 130];
const BONUS_RGB = [128, 230, 255];

function formatMarks(marks) {
  if (!marks.length) return ' ';
  return marks.map((m) => (m === '0' ? '-' : m)).join(' ');
}

export class Scorecard {
  constructor(parent) {
    this.root = div('scorecard', parent);
    this.root.style.position = 'absolute';
    this.root.style.display = 'none';
    this.cells = [];
    for (let i = 0; i < 10; i++) {
      const cell = div('score-cell', this.root);
      cell.style.position = 'absolute';
      cell.style.borderRadius = '4px';
      cell.style.overflow = 'hidden';
      const label = el('div', 'cell-label', cell);
      const marks = el('div', 'cell-marks', cell);
      const score = el('div', 'cell-score', cell);
      label.style.cssText = 'font-size:13px;color:#96a4cd;text-align:center;line-height:1.1;';
      marks.style.cssText = 'font-size:17px;font-weight:700;text-align:center;line-height:1.1;letter-spacing:0.5px;';
      score.style.cssText = 'font-size:17px;font-weight:700;text-align:center;color:#ffd682;line-height:1.1;';
      this.cells.push({ cell, label, marks, score });
    }
    this._visible = false;
  }

  setVisible(visible) {
    this._visible = !!visible;
    this.root.style.display = visible ? 'block' : 'none';
  }

  update(score, currentFrame, area) {
    if (!this._visible) return;
    const [left, right, top, bottom] = area;
    const width = right - left;
    const height = top - bottom;
    const step = width / 10.0;
    const cellW = step * 0.92;
    const cellH = height * 0.88;
    const centreY = (top + bottom) / 2.0;
    const cumulative = score.cumulativeScores();
    for (let index = 0; index < 10; index++) {
      const frame = index + 1;
      const centreX = left + step * (index + 0.5);
      const current = currentFrame !== null && frame === currentFrame;
      const marks = formatMarks(score.frameMarks(frame));
      const bonus = marks.includes('X') || marks.includes('/');
      const frameScore = cumulative[index];
      const scoreText = frameScore === null ? '' : String(frameScore);

      const cell = this.cells[index];
      cell.cell.style.left = `${centreX - cellW / 2}px`;
      cell.cell.style.top = `${centreY - cellH / 2}px`;
      cell.cell.style.width = `${cellW}px`;
      cell.cell.style.height = `${cellH}px`;
      cell.cell.style.background = current ? css(CURRENT_RGB) : css(CELL_RGB);
      cell.cell.style.boxShadow = current ? `0 0 10px ${cssA(GLOW_RGB, 0.55)}` : 'none';
      cell.label.textContent = String(frame);
      cell.marks.textContent = marks;
      cell.marks.style.color = bonus ? css(BONUS_RGB) : css(MARK_RGB);
      cell.score.textContent = scoreText;
      cell.score.style.color = css(SCORE_RGB);
    }
  }
}
