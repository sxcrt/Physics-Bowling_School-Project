// The full scorecard overlay, shown while RIGHT SHIFT is held.
//
// It renders from the same BowlingGame the match scores with (score.frameMarks /
// score.cumulativeScores / score.current_frame_number), so the card can never
// disagree with the game's own results. Frames that have not been bowled yet are
// left visibly empty; a frame whose bonus rolls are still outstanding shows its
// marks with a blank total, exactly as a printed card does.
import { COLORS, PALETTE, css, cssA } from './theme.js';
import { div, el } from './dom.js';
import { boxCountFor, frameBoxes, isBonusMark } from './cardmodel.js';

const CARD_BG = [13, 11, 34];
const CELL_BG = [23, 19, 52];
const CELL_BG_ALT = [30, 25, 66];
const CELL_LIVE = [34, 44, 92];
const RULE = [62, 54, 120];
const MARK = [244, 247, 255];
const TOTAL = [255, 214, 130];
const DIM = [150, 160, 198];
const BONUS = [128, 230, 255];

const PANEL_X = 56;
const PANEL_W = 1280 - 2 * PANEL_X;
const PAD = 26;
const BODY_TOP = 84;
const BODY_BOTTOM = 58;          // room for the legend + hint strip

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function marksFor(score, frame) {
  // The engine's marks, mapped for a printed card (a miss shows as "-").
  return frameBoxes(score, frame);
}

export class FullScorecard {
  constructor(parent) {
    this.root = div('full-scorecard', parent);
    this.root.style.cssText = 'position:absolute;left:0;top:0;width:1280px;height:720px;'
      + 'display:none;pointer-events:none;z-index:140;';

    this.scrim = div('scrim', this.root);
    this.scrim.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;`
      + `background:radial-gradient(1100px 720px at 50% 44%, ${cssA([11, 9, 32], 0.995)}, ${cssA([3, 3, 10], 0.998)});`;

    this.panel = div('panel', this.root);
    this.panel.style.cssText = `position:absolute;left:${PANEL_X}px;top:32px;`
      + `width:${PANEL_W}px;height:420px;border-radius:18px;background:${cssA(CARD_BG, 0.98)};`
      + `box-shadow:0 26px 80px rgba(0,0,0,0.7), inset 0 0 0 1px ${cssA(RULE, 0.95)};overflow:hidden;`;

    this.topRule = div('top-rule', this.panel);
    this.topRule.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:4px;'
      + `background:linear-gradient(90deg,${css(PALETTE.cyan)},${css(PALETTE.magenta)},${css(PALETTE.amber)});`;

    this.title = el('div', 'title', this.panel, 'SCORECARD');
    this.title.style.cssText = `position:absolute;left:${PAD}px;top:18px;font-size:26px;font-weight:900;`
      + `letter-spacing:5px;color:${css(PALETTE.white)};text-shadow:0 0 16px ${cssA(PALETTE.cyan, 0.55)};`;

    this.subtitle = el('div', 'subtitle', this.panel, '');
    this.subtitle.style.cssText = `position:absolute;left:${PAD}px;top:51px;font-size:13px;letter-spacing:2.5px;`
      + `color:${css(COLORS.text_dim)};`;

    this.frameHeading = el('div', 'frame-heading', this.panel, '');
    this.frameHeading.style.cssText = `position:absolute;right:${PAD}px;top:26px;text-align:right;`
      + `font-size:15px;font-weight:800;letter-spacing:2px;color:${css(PALETTE.amber)};`;

    this.legend = el('div', 'legend', this.panel, '');
    this.legend.style.cssText = `position:absolute;left:${PAD}px;bottom:22px;font-size:12px;letter-spacing:1.5px;`
      + `color:${cssA(DIM, 0.9)};`;

    this.hint = el('div', 'hint', this.panel, 'RELEASE RIGHT SHIFT TO RETURN');
    this.hint.style.cssText = `position:absolute;right:${PAD}px;bottom:22px;font-size:12px;letter-spacing:2px;`
      + `color:${cssA(DIM, 0.8)};`;

    this.rowsRoot = div('rows', this.panel);
    this.rowsRoot.style.cssText = `position:absolute;left:${PAD}px;top:${BODY_TOP}px;`
      + `width:${PANEL_W - 2 * PAD}px;height:240px;`;

    this.rows = [];
    this.visible = false;
  }

  show() { if (this.visible) return; this.visible = true; this.root.style.display = 'block'; }
  hide() { if (!this.visible) return; this.visible = false; this.root.style.display = 'none'; }

  _ensureRows(count) {
    while (this.rows.length < count) {
      const row = div('score-row', this.rowsRoot);
      row.style.cssText = 'position:absolute;left:0;border-radius:12px;';

      const name = el('div', 'name', row, '');
      name.style.cssText = 'position:absolute;font-weight:800;letter-spacing:1px;white-space:nowrap;overflow:hidden;';
      const meta = el('div', 'meta', row, '');
      meta.style.cssText = 'position:absolute;white-space:nowrap;overflow:hidden;';
      const stat = el('div', 'stat', row, '');
      stat.style.cssText = 'position:absolute;white-space:nowrap;';

      const grid = div('grid', row);
      grid.style.cssText = 'position:absolute;';
      const cells = [];
      for (let f = 1; f <= 10; f++) {
        const cell = div('cell', grid);
        cell.style.cssText = 'position:absolute;overflow:hidden;';
        const number = el('div', 'num', cell, String(f));
        number.style.cssText = 'position:absolute;font-weight:700;';
        const rolls = div('rolls', cell);
        rolls.style.cssText = 'position:absolute;display:flex;';
        const boxes = [];
        for (let b = 0; b < 3; b++) {
          const box = el('div', 'roll', rolls, '');
          box.style.cssText = 'display:flex;align-items:center;justify-content:center;font-weight:800;overflow:hidden;';
          boxes.push(box);
        }
        const total = el('div', 'total', cell, '');
        total.style.cssText = 'position:absolute;left:0;width:100%;text-align:center;font-weight:800;';
        cells.push({ cell, number, rolls, boxes, total });
      }

      const history = el('div', 'history', row, '');
      history.style.cssText = 'position:absolute;display:none;flex-wrap:wrap;align-content:flex-start;';

      this.rows.push({ row, name, meta, stat, grid, cells, history });
    }
    for (let i = 0; i < this.rows.length; i++) {
      this.rows[i].row.style.display = i < count ? 'block' : 'none';
    }
  }

  update(state) {
    const { match, mode } = state;
    if (!match) return;
    const players = match.players;
    this._ensureRows(players.length);

    const isFrames = !!mode && mode.score_style === 'frames';
    this.subtitle.textContent = String(mode ? mode.title : '').toUpperCase();

    // The panel hugs its content: a one-player card is short, a four-player card
    // fills the stage. Stretching one row over the whole screen left a large
    // empty void above and below the frames.
    const count = players.length;
    const rowH = count <= 2 ? 152 : (count === 3 ? 140 : 124);
    const gap = count > 2 ? 10 : 14;
    const bodyH = rowH * count + gap * (count - 1);
    const panelH = BODY_TOP + bodyH + BODY_BOTTOM;
    this.panel.style.top = `${Math.round((720 - panelH) / 2)}px`;
    this.panel.style.height = `${panelH}px`;
    this.rowsRoot.style.height = `${bodyH}px`;

    if (isFrames) {
      const live = match.current_player;
      const frame = live.bowling.is_complete ? 10 : live.bowling.current_frame_number;
      this.frameHeading.textContent = match.player_count > 1
        ? `${live.name} - FRAME ${frame} OF 10`
        : `FRAME ${frame} OF 10`;
      this.legend.textContent = 'X  STRIKE      /  SPARE      -  MISS      BLANK  NOT YET BOWLED';
    } else {
      const time = match.time_left === null || match.time_left === undefined ? '' : `TIME LEFT ${this._clock(match.time_left)}`;
      this.frameHeading.textContent = time || `${players.length} PLAYER${players.length === 1 ? '' : 'S'}`;
      this.legend.textContent = mode && mode.timed
        ? 'EVERY THROW FACES A FRESH RACK - MOST PINS WHEN THE CLOCK RUNS OUT WINS'
        : 'SCORE IS TOTAL PINS - RECENT THROWS ARE SHOWN NEWEST LAST';
    }

    const width = this.rowsRoot.clientWidth || (PANEL_W - 2 * PAD);

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const view = this.rows[i];
      const y = i * (rowH + gap);
      const active = !match.finished && !match.is_complete && i === match.turn_index;
      const accent = player.rgb;

      view.row.style.top = `${y}px`;
      view.row.style.width = `${width}px`;
      view.row.style.height = `${rowH}px`;
      view.row.style.background = active
        ? `linear-gradient(90deg, ${cssA(accent, 0.22)}, ${cssA(CELL_BG_ALT, 0.75)} 38%, ${cssA(CELL_BG, 0.75)})`
        : cssA(CELL_BG, 0.55);
      view.row.style.boxShadow = active
        ? `inset 0 0 0 1px ${cssA(accent, 0.6)}, 0 0 26px ${cssA(accent, 0.16)}`
        : `inset 0 0 0 1px ${cssA(RULE, 0.7)}`;

      const labelW = clamp(Math.round(width * 0.19), 150, 246);
      const namePx = clamp(Math.round(rowH * 0.155), 14, 22);
      const metaPx = clamp(Math.round(rowH * 0.088), 10, 13);
      const totalPx = clamp(Math.round(rowH * 0.24), 20, 40);
      const nameTop = Math.round(rowH * 0.17);
      const nameLine = Math.round(namePx * 1.12);
      const metaTop = nameTop + nameLine + 2;
      const metaLine = Math.round(metaPx * 1.2);

      view.name.textContent = player.name;
      view.name.style.left = '16px';
      view.name.style.top = `${nameTop}px`;
      view.name.style.fontSize = `${namePx}px`;
      view.name.style.lineHeight = `${nameLine}px`;
      view.name.style.color = active ? css(PALETTE.white) : css(COLORS.text_dim);
      view.name.style.maxWidth = `${labelW - 12}px`;

      const metaParts = [];
      if (player.is_bot) metaParts.push(`BOT ${String(player.difficulty || '').toUpperCase()}`);
      if (!isFrames) metaParts.push(`${player.throws} THROWS`);
      if (mode && mode.gate && mode.gate !== 'none') metaParts.push(`${player.correct}/${player.answered} CORRECT`);
      view.meta.textContent = metaParts.join('   ·   ');
      view.meta.style.left = '16px';
      view.meta.style.top = `${metaTop}px`;
      view.meta.style.fontSize = `${metaPx}px`;
      view.meta.style.lineHeight = `${metaLine}px`;
      view.meta.style.letterSpacing = '1px';
      view.meta.style.color = cssA(DIM, 0.92);
      view.meta.style.maxWidth = `${labelW - 12}px`;

      view.stat.style.left = '16px';
      view.stat.style.top = `${metaTop + metaLine + 6}px`;
      view.stat.style.width = `${labelW - 12}px`;
      view.stat.innerHTML = '';
      const value = isFrames ? player.bowling.current_score : player.total_pins;
      const big = el('div', '', view.stat, String(value));
      big.style.cssText = `font-size:${totalPx}px;font-weight:900;color:${css(TOTAL)};`
        + `line-height:1.02;letter-spacing:1px;text-shadow:0 0 14px ${cssA(TOTAL, 0.35)};`;
      const caption = el('div', '', view.stat, isFrames
        ? (player.bowling.is_complete ? 'FINAL SCORE' : 'RUNNING TOTAL')
        : 'TOTAL PINS');
      caption.style.cssText = `font-size:9px;letter-spacing:2px;color:${cssA(DIM, 0.85)};`;

      if (isFrames) {
        view.grid.style.display = 'block';
        view.history.style.display = 'none';
        this._layoutFrames(view, player, match, i, { width, rowH, labelW, active });
      } else {
        view.grid.style.display = 'none';
        view.history.style.display = 'flex';
        this._layoutPins(view, player, { width, rowH, labelW });
      }
    }
  }

  _clock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds)));
    const m = Math.floor(total / 60);
    const s = total - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  _layoutFrames(view, player, match, playerIndex, geom) {
    const { width, rowH, labelW, active } = geom;
    const score = player.bowling;
    const cumulative = score.cumulativeScores();
    const currentFrame = score.is_complete ? null : score.current_frame_number;
    const activePlayer = !match.finished && playerIndex === match.turn_index;
    const dimmed = match.player_count > 1 && !activePlayer && !score.is_complete;

    const gridTop = Math.round(rowH * 0.10);
    const gridH = Math.max(58, rowH - gridTop * 2);
    const gridLeft = labelW + 10;
    const gridW = width - gridLeft - 12;
    const numW = 0;                                  // the frame number rides inside each cell
    const frameW = (gridW - numW) / 10.5;            // the tenth frame is 1.5x wide

    view.grid.style.left = `${gridLeft}px`;
    view.grid.style.top = `${gridTop}px`;
    view.grid.style.width = `${gridW}px`;
    view.grid.style.height = `${gridH}px`;

    const numH = clamp(Math.round(gridH * 0.16), 12, 20);
    const totalH = clamp(Math.round(gridH * 0.26), 16, 34);
    const rollsH = Math.max(20, gridH - numH - totalH - 2);
    const markPx = clamp(Math.round(rollsH * 0.60), 12, 30);

    for (let f = 1; f <= 10; f++) {
      const cellView = view.cells[f - 1];
      const last = f === 10;
      const w = Math.round(last ? frameW * 1.5 : frameW);
      const x = Math.round(last ? frameW * 9 : frameW * (f - 1));
      const live = activePlayer && currentFrame === f && !score.is_complete;

      cellView.cell.style.left = `${x}px`;
      cellView.cell.style.top = '0px';
      cellView.cell.style.width = `${w}px`;
      cellView.cell.style.height = `${gridH}px`;
      cellView.cell.style.opacity = dimmed ? '0.72' : '1';
      cellView.cell.style.background = live ? css(CELL_LIVE) : css(CELL_BG);
      cellView.cell.style.boxShadow = live
        ? `inset 0 0 0 2px ${cssA(PALETTE.cyan, 0.95)}, 0 0 20px ${cssA(PALETTE.cyan, 0.30)}`
        : `inset 0 0 0 1px ${cssA(RULE, 0.9)}`;

      cellView.number.style.left = '0px';
      cellView.number.style.top = '1px';
      cellView.number.style.width = '100%';
      cellView.number.style.textAlign = 'center';
      cellView.number.style.fontSize = `${clamp(Math.round(numH * 0.78), 9, 14)}px`;
      cellView.number.style.letterSpacing = '1px';
      cellView.number.style.color = live ? css(BONUS) : cssA(DIM, 0.75);

      const marks = marksFor(score, f);
      const boxes = boxCountFor(f);
      const boxW = (w - 4) / boxes;

      cellView.rolls.style.left = '2px';
      cellView.rolls.style.top = `${numH + 1}px`;
      cellView.rolls.style.width = `${w - 4}px`;
      cellView.rolls.style.height = `${rollsH}px`;
      cellView.rolls.style.boxShadow = `inset 0 -1px 0 ${cssA(RULE, 0.85)}`;
      for (let b = 0; b < 3; b++) {
        const box = cellView.boxes[b];
        box.style.display = b < boxes ? 'flex' : 'none';
        box.style.width = `${boxW}px`;
        box.style.height = '100%';
        box.style.fontSize = `${markPx}px`;
        box.style.borderLeft = b === 0 ? 'none' : `1px solid ${cssA(RULE, 0.85)}`;
        const mark = marks[b] !== undefined ? marks[b] : '';
        box.textContent = mark;
        box.style.color = isBonusMark(mark) ? css(BONUS) : css(MARK);
      }

      const frameTotal = cumulative[f - 1];
      cellView.total.textContent = frameTotal === null || frameTotal === undefined ? '' : String(frameTotal);
      cellView.total.style.top = `${numH + rollsH + 2}px`;
      cellView.total.style.height = `${totalH}px`;
      cellView.total.style.lineHeight = `${totalH}px`;
      cellView.total.style.fontSize = `${clamp(Math.round(totalH * 0.66), 12, 24)}px`;
      cellView.total.style.color = live ? css(PALETTE.amber) : css(TOTAL);
    }
  }

  _layoutPins(view, player, geom) {
    const { width, rowH, labelW } = geom;
    const history = player.bowling.rolls || [];
    const left = labelW + 10;
    const w = width - left - 12;
    const chipH = clamp(Math.round(rowH * 0.22), 18, 34);
    const chipW = Math.round(chipH * 1.45);
    const perRow = Math.max(4, Math.floor(w / (chipW + 6)));
    const recent = history.slice(-perRow * 2);

    view.history.style.left = `${left}px`;
    view.history.style.top = `${Math.round(rowH * 0.5 - (chipH + 6))}px`;
    view.history.style.width = `${w}px`;
    view.history.innerHTML = '';
    for (const value of recent) {
      const chip = el('div', '', view.history, value === 10 ? 'X' : String(value));
      chip.style.cssText = `width:${chipW}px;height:${chipH}px;margin-right:6px;margin-bottom:6px;`
        + `border-radius:6px;display:flex;align-items:center;justify-content:center;`
        + `font-size:${Math.round(chipH * 0.56)}px;font-weight:800;`
        + `color:${value === 10 ? css(BONUS) : css(MARK)};background:${cssA(CELL_BG_ALT, 0.9)};`
        + `box-shadow:inset 0 0 0 1px ${cssA(RULE, 0.85)};`;
    }
    if (!recent.length) {
      const empty = el('div', '', view.history, 'NO THROWS YET');
      empty.style.cssText = `font-size:12px;letter-spacing:2px;color:${cssA(DIM, 0.8)};`;
    }
  }
}
