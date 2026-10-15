// The lane diagram (top view) for the Equation Mode panel, drawn on a canvas
// (ported from scene/textures.py: lane_diagram_texture).
import * as config from '../config.js';

export function drawLaneDiagram(canvas, { pins = [], path = [], startX = 0.0, aimX = null,
                                         solved = false, launched = false, gutterX = null } = {}) {
  const width = canvas.width, height = canvas.height;
  const ctx = canvas.getContext('2d');
  const laneHalf = config.LANE_WIDTH / 2.0;
  const totalHalf = laneHalf + config.GUTTER_WIDTH;
  const zBottom = -0.6, zTop = config.PIN_DECK_LENGTH + config.HEAD_PIN_Z + 0.35;
  const padX = 8.0, padTop = 22.0, padBottom = 12.0;
  const scaleX = (width - 2 * padX) / (2.0 * totalHalf);
  const scaleY = (height - padTop - padBottom) / (zTop - zBottom);
  const toPx = (x, z) => [width / 2.0 + x * scaleX, padTop + (zTop - z) * scaleY];

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(126,132,164,1)';
  ctx.font = '11px sans-serif';
  ctx.fillText('LANE - TOP VIEW', 6, 12);

  const [gx0, gy0] = toPx(-totalHalf, zTop);
  const [gx1, gy1] = toPx(totalHalf, zBottom);
  ctx.fillStyle = 'rgba(20,16,40,1)';
  ctx.beginPath();
  ctx.roundRect(gx0, gy0, gx1 - gx0, gy1 - gy0, 4);
  ctx.fill();
  const [lx0, ly0] = toPx(-laneHalf, zTop);
  const [lx1, ly1] = toPx(laneHalf, zBottom);
  ctx.fillStyle = 'rgba(70,48,30,1)';
  ctx.fillRect(lx0, ly0, lx1 - lx0, ly1 - ly0);
  for (const edge of [-laneHalf, laneHalf]) {
    const [ex] = toPx(edge, 0.0);
    ctx.strokeStyle = 'rgba(255,61,139,0.86)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ex, gy0); ctx.lineTo(ex, gy1); ctx.stroke();
  }
  const [, fy] = toPx(0.0, 0.0);
  ctx.strokeStyle = 'rgba(255,61,139,0.78)';
  ctx.beginPath(); ctx.moveTo(lx0, fy); ctx.lineTo(lx1, fy); ctx.stroke();
  const [cx, cyTop] = toPx(0.0, zTop);
  const [, cyBottom] = toPx(0.0, zBottom);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  let y = cyTop;
  while (y < cyBottom) {
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, Math.min(y + 5, cyBottom)); ctx.stroke();
    y += 10;
  }

  if (path.length) {
    const colour = solved ? 'rgba(74,222,128,1)' : 'rgba(96,226,255,1)';
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    path.forEach(([x, z], i) => {
      const [px, py] = toPx(x, z);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    if (gutterX !== null) {
      const [gxp, gyp] = toPx(gutterX, path[path.length - 1][1]);
      ctx.strokeStyle = 'rgba(255,92,108,1)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gxp - 4, gyp - 4); ctx.lineTo(gxp + 4, gyp + 4);
      ctx.moveTo(gxp - 4, gyp + 4); ctx.lineTo(gxp + 4, gyp - 4); ctx.stroke();
    }
  }

  for (const [label, x, z, isTarget, isDown] of pins) {
    const [px, py] = toPx(x, z);
    if (isDown) { ctx.fillStyle = 'rgba(200,90,110,0.9)'; ctx.strokeStyle = 'rgba(200,90,110,0.9)'; }
    else { ctx.fillStyle = 'rgba(248,248,252,0.96)'; ctx.strokeStyle = isTarget ? 'rgba(255,181,71,1)' : 'rgba(60,52,110,0.9)'; }
    const radius = isTarget ? 4 : 3;
    ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.stroke();
    if (isTarget && label) {
      ctx.fillStyle = 'rgba(255,181,71,1)';
      ctx.font = '11px sans-serif';
      ctx.fillText(String(label), px + radius + 3, py + 4);
    }
  }

  if (launched) {
    const [sx, sy] = toPx(startX, 0.0);
    ctx.fillStyle = 'rgba(96,226,255,1)';
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
  }
  if (aimX !== null) {
    const [ax] = toPx(aimX, zTop);
    const [bx] = toPx(aimX, zBottom);
    ctx.strokeStyle = 'rgba(255,181,71,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, gy0); ctx.lineTo(bx, gy1); ctx.stroke();
  }
}
