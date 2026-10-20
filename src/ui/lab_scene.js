// Physics Lab 2D scene renderers.
//
// Bowling keeps the real 3D lane. Free Fall, Straight Line and Journey draw
// their own side-on scene on a canvas that sits exactly where the 3D lane is
// on every other Lab mode. Nothing here touches the game renderer.
//
// The renderer is stateless: lab.js passes the solved values and the current
// timeline time, and receives a frame. That keeps scrubbing and animation on
// the same code path.

const COLORS = {
  cyan: '#3ec9e8',
  cyanSoft: 'rgba(62,201,232,0.16)',
  pink: '#ff9cc2',
  pinkSoft: 'rgba(255,156,194,0.14)',
  green: '#7ceca7',
  yellow: '#f5c84c',
  ink: '#f7f5ff',
  dim: '#b9b6d6',
  muted: '#8f93b3',
  red: '#ff5c6c',
  panel: 'rgba(15,12,40,0.88)',
  line: 'rgba(62,201,232,0.24)',
};

const JOURNEY_COLORS = [COLORS.cyan, COLORS.pink, '#ffffff', '#b9b6d6'];

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function fmt(value, decimals = 4) {
  if (!isNum(value)) return '—';
  let text = Number(value).toFixed(decimals);
  if (text.includes('.')) text = text.replace(/0+$/, '').replace(/\.$/, '');
  if (text === '-0' || text === '') text = '0';
  return text;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Pick a readable tick spacing: 1, 2, 5 × a power of ten.
function niceStep(range, target = 6) {
  if (!isNum(range) || range <= 0) return 1;
  const rough = range / Math.max(1, target);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const normal = rough / power;
  let factor = 1;
  if (normal >= 5) factor = 5;
  else if (normal >= 2) factor = 2;
  return factor * power;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function eastWest(value) {
  if (!isNum(value) || Math.abs(value) < 1e-9) return 'no net direction';
  return value > 0 ? 'east' : 'west';
}

function downUp(value, positiveWord, negativeWord) {
  if (!isNum(value) || Math.abs(value) < 1e-9) return 'stationary';
  return value > 0 ? positiveWord : negativeWord;
}

export class LabScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(modeId, state = {}, time = 0, reduced = false) {
    if (!this.ctx) return;
    this.resize();
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    this._background(ctx, w, h, modeId);
    if (modeId === 'freefall') this._freeFall(ctx, w, h, state, time, reduced);
    else if (modeId === 'straight') this._straight(ctx, w, h, state, time, reduced);
    else if (modeId === 'journey') this._journey(ctx, w, h, state, time, reduced);
    else if (modeId === 'projectile') this._projectile(ctx, w, h, state, time, reduced);
    else if (modeId === 'rotational') this._rotational(ctx, w, h, state, time, reduced);
    else if (modeId === 'torque') this._torque(ctx, w, h, state, time, reduced);
    else if (modeId === 'inertia') this._inertia(ctx, w, h, state, time, reduced);
  }

  _background(ctx, w, h, modeId) {
    const gradient = ctx.createRadialGradient(w * 0.55, h * 0.2, 30,
      w * 0.55, h * 0.45, Math.max(w, h) * 0.85);
    gradient.addColorStop(0, '#141642');
    gradient.addColorStop(0.55, '#0a0a24');
    gradient.addColorStop(1, '#05060f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // A faint horizon glow gives the 2D scenes the same glass-and-neon feel as
    // the lane without copying any of its geometry.
    const glow = ctx.createLinearGradient(0, h * 0.45, 0, h);
    glow.addColorStop(0, modeId === 'journey' ? 'rgba(255,156,194,0.05)' : 'rgba(62,201,232,0.05)');
    glow.addColorStop(1, 'rgba(5,6,15,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, h * 0.45, w, h * 0.55);
  }

  _font(size, weight = 600) {
    return `${weight} ${size}px Inter, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  }

  _card(ctx, x, y, width, height) {
    ctx.fillStyle = COLORS.panel;
    roundRect(ctx, x, y, width, height, 12);
    ctx.fill();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ==== Free Fall ==========================================================
  _freeFall(ctx, w, h, state, time, reduced) {
    const direction = state.direction === 'up' ? 'up' : 'down';
    const gravity = isNum(state.gravity) && state.gravity > 0 ? state.gravity : 9.8;
    const u = isNum(state.u) ? state.u : 0;
    const solvedH = isNum(state.h) ? state.h : null;
    const solvedT = isNum(state.t) ? Math.max(0, state.t) : 0;
    const a = isNum(state.a) ? state.a : (direction === 'up' ? -gravity : gravity);
    const positiveIsUp = state.signConvention
      ? state.signConvention !== 'travel' || direction === 'up'
      : direction === 'up';
    const flightEnd = direction === 'up' && u > 1e-9
      ? Math.max(solvedT, (2 * u) / gravity)
      : solvedT;
    const now = clamp(time, 0, Math.max(0, flightEnd));
    const hTau = u * now + 0.5 * a * now * now;
    const vTau = u + a * now;
    const peak = direction === 'up' && u > 1e-9 ? (u * u) / (2 * gravity) : null;

    const maxH = Math.max(1, solvedH || 0, hTau, peak || 0);
    const minH = Math.min(0, solvedH || 0, hTau);
    const axisTop = h * 0.16;
    const axisBottom = h * 0.62;
    const axisX = w * 0.17;
    const ballX = w * 0.58;
    const span = Math.max(0.001, maxH - minH);
    const yFor = (value) => (positiveIsUp
      ? axisBottom - ((value - minH) / span) * (axisBottom - axisTop)
      : axisTop + ((value - minH) / span) * (axisBottom - axisTop));
    const zeroY = yFor(0);
    const groundY = positiveIsUp ? yFor(minH) : yFor(maxH);

    // Ground and axis.
    ctx.strokeStyle = 'rgba(185,182,214,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(axisX, axisTop);
    ctx.lineTo(axisX, axisBottom);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(185,182,214,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(axisX - 18, groundY);
    ctx.lineTo(w * 0.9, groundY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(62,201,232,0.07)';
    ctx.fillRect(axisX - 18, groundY, w * 0.9 - axisX + 18, Math.max(0, h - groundY));

    // Meter scale.
    const tickStep = niceStep(span, 7);
    const startTick = Math.ceil(minH / tickStep) * tickStep;
    ctx.font = this._font(Math.max(10, w * 0.0115), 600);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let value = startTick; value <= maxH + tickStep * 0.01; value += tickStep) {
      const y = yFor(value);
      ctx.strokeStyle = 'rgba(185,182,214,0.24)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(axisX - 7, y);
      ctx.lineTo(axisX, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(`${fmt(value, 2)} m`, axisX - 12, y);
    }

    // Release point / hand.
    ctx.fillStyle = direction === 'up' ? 'rgba(62,201,232,0.85)' : 'rgba(185,182,214,0.65)';
    roundRect(ctx, ballX - 34, zeroY - 4, 68, 8, 4);
    ctx.fill();
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    ctx.font = this._font(Math.max(10, w * 0.011), 700);
    ctx.fillText(direction === 'up' ? 'RELEASE' : 'DROP', ballX, zeroY - 14);

    // Motion trail. For a thrown-up run this is the full rise–peak–fall path.
    const trailEnd = direction === 'up' ? Math.max(0, flightEnd) : now;
    if (trailEnd > 1e-6) {
      ctx.save();
      ctx.strokeStyle = direction === 'up'
        ? 'rgba(255,156,194,0.34)' : 'rgba(62,201,232,0.28)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      const steps = 64;
      for (let i = 0; i <= steps; i += 1) {
        const t = (i / steps) * trailEnd;
        const value = u * t + 0.5 * a * t * t;
        const y = yFor(value);
        if (i === 0) ctx.moveTo(ballX, y);
        else ctx.lineTo(ballX, y);
      }
      ctx.stroke();
      ctx.restore();

      // The part already travelled is solid: a progress trail.
      if (now > 1e-6) {
        ctx.save();
        ctx.strokeStyle = direction === 'up' ? COLORS.pink : COLORS.cyan;
        ctx.globalAlpha = reduced ? 0.6 : 0.85;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const steps = 48;
        for (let i = 0; i <= steps; i += 1) {
          const t = (i / steps) * now;
          const value = u * t + 0.5 * a * t * t;
          const y = yFor(value);
          if (i === 0) ctx.moveTo(ballX, y);
          else ctx.lineTo(ballX, y);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // Dashed height marker from the scale to the ball.
    const ballY = yFor(hTau);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(axisX + 8, ballY);
    ctx.lineTo(ballX - 16, ballY);
    ctx.stroke();
    ctx.restore();

    // Ball.
    const radius = Math.max(10, Math.min(18, w * 0.016));
    const ballGlow = ctx.createRadialGradient(ballX - radius * 0.3, ballY - radius * 0.35, 1,
      ballX, ballY, radius * 1.8);
    ballGlow.addColorStop(0, '#ffffff');
    ballGlow.addColorStop(0.35, direction === 'up' ? '#ffd3e6' : '#c8f5ff');
    ballGlow.addColorStop(1, direction === 'up' ? '#ff5c95' : '#1aa7c8');
    ctx.fillStyle = ballGlow;
    ctx.beginPath();
    ctx.arc(ballX, ballY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Live readout.
    const directionWord = vTau > 0
      ? (positiveIsUp ? 'upward' : 'downward')
      : (positiveIsUp ? 'downward' : 'upward');
    const heightWord = hTau >= 0
      ? (positiveIsUp ? 'above release' : 'below release')
      : (positiveIsUp ? 'below release' : 'above release');
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.muted;
    ctx.font = this._font(Math.max(10, w * 0.0115), 700);
    ctx.fillText('HEIGHT', w * 0.38, h * 0.13);
    ctx.fillStyle = COLORS.ink;
    ctx.font = this._font(Math.max(18, w * 0.026), 800);
    ctx.fillText(`${fmt(hTau, 3)} m`, w * 0.38, h * 0.175);
    ctx.fillStyle = COLORS.dim;
    ctx.font = this._font(Math.max(10, w * 0.0115), 600);
    ctx.fillText(`${heightWord} · ${fmt(Math.abs(vTau), 3)} m/s ${directionWord}`,
      w * 0.38, h * 0.235);

    // The peak marker makes the "rises, peaks, falls" shape legible.
    if (direction === 'up' && peak && peak > 1e-6) {
      const peakY = yFor(peak);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,156,194,0.35)';
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(axisX, peakY);
      ctx.lineTo(w * 0.9, peakY);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = COLORS.pink;
      ctx.textAlign = 'left';
      ctx.font = this._font(Math.max(9, w * 0.0105), 700);
      ctx.fillText('PEAK', axisX + 8, peakY - 8);
    }
  }

  // ==== Straight Line ======================================================
  _straight(ctx, w, h, state, time, reduced) {
    const u = isNum(state.u) ? state.u : 0;
    const finalS = isNum(state.s) ? state.s : 0;
    const finalV = isNum(state.v) ? state.v : null;
    const accel = isNum(state.a) ? state.a : 0;
    const duration = isNum(state.t) ? Math.max(0, state.t) : 0;
    const now = clamp(time, 0, duration);
    const sTau = u * now + 0.5 * accel * now * now;
    const vTau = u + accel * now;

    const minS = Math.min(0, finalS, sTau);
    const maxS = Math.max(0, finalS, sTau);
    const span = Math.max(1, maxS - minS);
    const pad = Math.max(1, span * 0.12);
    const left = w * 0.1;
    const right = w * 0.92;
    const xFor = (value) => left + ((value - (minS - pad)) / ((maxS + pad) - (minS - pad))) * (right - left);
    const roadY = h * 0.5;
    const roadH = h * 0.12;

    // Road.
    const road = ctx.createLinearGradient(0, roadY, 0, roadY + roadH);
    road.addColorStop(0, '#242750');
    road.addColorStop(1, '#14162f');
    ctx.fillStyle = road;
    ctx.fillRect(0, roadY, w, roadH);
    ctx.strokeStyle = 'rgba(62,201,232,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, roadY);
    ctx.lineTo(w, roadY);
    ctx.moveTo(0, roadY + roadH);
    ctx.lineTo(w, roadY + roadH);
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = 'rgba(245,200,76,0.50)';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 18]);
    ctx.beginPath();
    ctx.moveTo(0, roadY + roadH / 2);
    ctx.lineTo(w, roadY + roadH / 2);
    ctx.stroke();
    ctx.restore();

    // Distance markers. The base spacing is 10 m; the step grows only when
    // the solved run makes 10 m unreadable.
    const range = maxS - minS;
    const step = Math.max(10, niceStep(range + 20, 10));
    const startTick = Math.ceil((minS - pad) / step) * step;
    const endTick = Math.floor((maxS + pad) / step) * step;
    ctx.font = this._font(Math.max(10, w * 0.0115), 600);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let value = startTick; value <= endTick + step * 0.01; value += step) {
      const x = xFor(value);
      ctx.strokeStyle = 'rgba(185,182,214,0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, roadY + roadH);
      ctx.lineTo(x, roadY + roadH + 8);
      ctx.stroke();
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(`${fmt(value, 0)} m`, x, roadY + roadH + 12);
    }

    // Start and stop lines.
    const startX = xFor(0);
    ctx.strokeStyle = 'rgba(185,182,214,0.38)';
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(startX, roadY - 10);
    ctx.lineTo(startX, roadY + roadH + 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.dim;
    ctx.font = this._font(Math.max(9, w * 0.0105), 700);
    ctx.fillText('START', startX, roadY - 28);

    const stopX = xFor(finalS);
    ctx.strokeStyle = 'rgba(255,255,255,0.82)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(stopX, roadY - 14);
    ctx.lineTo(stopX, roadY + roadH + 4);
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.font = this._font(Math.max(9, w * 0.0105), 800);
    ctx.fillText('STOP', stopX, roadY - 32);

    // Speed / position readout.
    const body = state.body || 'Car';
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.muted;
    ctx.font = this._font(Math.max(10, w * 0.0115), 700);
    ctx.fillText('SPEED', w * 0.38, h * 0.14);
    ctx.fillStyle = COLORS.ink;
    ctx.font = this._font(Math.max(20, w * 0.028), 800);
    ctx.fillText(`${fmt(Math.abs(vTau), 3)} m/s`, w * 0.38, h * 0.188);
    ctx.fillStyle = COLORS.dim;
    ctx.font = this._font(Math.max(10, w * 0.0115), 600);
    ctx.fillText(`${body} · ${fmt(sTau, 3)} m along the road`, w * 0.38, h * 0.248);

    const braking = accel < 0 && isNum(finalV) && Math.abs(finalV) < 1e-6
      && now > duration * 0.55 && vTau < Math.max(0.5, Math.abs(u) * 0.2);

    this._sprite(ctx, body, xFor(sTau), roadY + roadH * 0.48, Math.max(0.8, w / 960),
      u + accel * now, braking, reduced);
  }

  _sprite(ctx, body, x, y, scale, velocity, braking, reduced) {
    ctx.save();
    ctx.translate(x, y);
    if (velocity < -1e-6) ctx.scale(-1, 1);
    const s = Math.max(0.75, Math.min(1.35, scale));
    if (body === 'Ball') {
      const glow = ctx.createRadialGradient(-6 * s, -8 * s, 1, 0, 0, 22 * s);
      glow.addColorStop(0, '#ffffff');
      glow.addColorStop(0.4, '#c8f5ff');
      glow.addColorStop(1, '#1aa7c8');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, -10 * s, 17 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (body === 'Cyclist') {
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.arc(-22 * s, 4 * s, 12 * s, 0, Math.PI * 2);
      ctx.arc(22 * s, 4 * s, 12 * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = COLORS.pink;
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath();
      ctx.moveTo(-22 * s, 4 * s);
      ctx.lineTo(-4 * s, -18 * s);
      ctx.lineTo(16 * s, 4 * s);
      ctx.lineTo(-22 * s, 4 * s);
      ctx.moveTo(-4 * s, -18 * s);
      ctx.lineTo(14 * s, -18 * s);
      ctx.stroke();
      ctx.fillStyle = '#ffe2ef';
      ctx.beginPath();
      ctx.arc(2 * s, -34 * s, 7 * s, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Car: body, roof, wheels, and brake lights when it is stopping.
      ctx.fillStyle = '#2fb6d8';
      roundRect(ctx, -38 * s, -24 * s, 76 * s, 28 * s, 7 * s);
      ctx.fill();
      ctx.fillStyle = '#1b7f9c';
      roundRect(ctx, -20 * s, -38 * s, 40 * s, 18 * s, 5 * s);
      ctx.fill();
      ctx.fillStyle = '#081424';
      ctx.beginPath();
      ctx.arc(-24 * s, 6 * s, 9 * s, 0, Math.PI * 2);
      ctx.arc(24 * s, 6 * s, 9 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      roundRect(ctx, -29 * s, -20 * s, 13 * s, 8 * s, 2 * s);
      ctx.fill();
      roundRect(ctx, 8 * s, -20 * s, 14 * s, 8 * s, 2 * s);
      ctx.fill();
      if (braking) {
        const glow = ctx.createRadialGradient(-38 * s, -8 * s, 1, -38 * s, -8 * s, 18 * s);
        glow.addColorStop(0, reduced ? 'rgba(255,60,60,0.75)' : 'rgba(255,60,60,0.95)');
        glow.addColorStop(1, 'rgba(255,60,60,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(-38 * s, -8 * s, 18 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.red;
        roundRect(ctx, -41 * s, -12 * s, 5 * s, 9 * s, 2 * s);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ==== Journey ============================================================
  _journey(ctx, w, h, state, time, reduced) {
    const legs = Array.isArray(state.legs) ? state.legs : [];
    const results = state.results || {};
    const totalTime = isNum(results.totalTime) && results.totalTime > 0
      ? results.totalTime : 0;
    const now = clamp(time, 0, totalTime);

    // Cumulative positions and per-leg windows.
    const segments = [];
    let position = 0;
    let clock = 0;
    for (const leg of legs) {
      if (!isNum(leg.distance) || !isNum(leg.time) || leg.time < 0) continue;
      const start = position;
      const end = position + (leg.direction === -1 ? -1 : 1) * leg.distance;
      const startTime = clock;
      const endTime = clock + leg.time;
      segments.push({ start, end, startTime, endTime });
      position = end;
      clock = endTime;
    }
    const finalPosition = position;
    const displacement = isNum(results.displacement) ? results.displacement : finalPosition;

    let current = 0;
    let currentLeg = 0;
    if (segments.length) {
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (now >= segment.endTime) {
          current = segment.end;
          currentLeg = index;
        } else if (now >= segment.startTime) {
          const fraction = segment.endTime > segment.startTime
            ? (now - segment.startTime) / (segment.endTime - segment.startTime) : 1;
          current = segment.start + (segment.end - segment.start) * clamp(fraction, 0, 1);
          currentLeg = index;
          break;
        }
      }
    }

    const min = Math.min(0, finalPosition, current, displacement);
    const max = Math.max(0, finalPosition, current, displacement);
    const span = Math.max(1, max - min);
    const pad = Math.max(1, span * 0.12);
    const left = w * 0.09;
    const right = w * 0.93;
    const xFor = (value) => left + ((value - (min - pad)) / ((max + pad) - (min - pad))) * (right - left);
    const axisY = h * 0.5;

    // Number line.
    ctx.strokeStyle = 'rgba(185,182,214,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, axisY);
    ctx.lineTo(right, axisY);
    ctx.stroke();

    const step = Math.max(10, niceStep(span + 20, 9));
    const startTick = Math.ceil((min - pad) / step) * step;
    const endTick = Math.floor((max + pad) / step) * step;
    ctx.font = this._font(Math.max(10, w * 0.0115), 600);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let value = startTick; value <= endTick + step * 0.01; value += step) {
      const x = xFor(value);
      ctx.strokeStyle = 'rgba(185,182,214,0.30)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, axisY - 6);
      ctx.lineTo(x, axisY + 6);
      ctx.stroke();
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(`${fmt(value, 0)} m`, x, axisY + 10);
    }

    // Leg trails: one colour per leg, with the travelled part stronger.
    if (segments.length) {
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const x1 = xFor(segment.start);
        const x2 = xFor(segment.end);
        const reached = now >= segment.endTime;
        const active = index === currentLeg && now > segment.startTime && !reached;
        ctx.save();
        ctx.strokeStyle = JOURNEY_COLORS[index % JOURNEY_COLORS.length];
        ctx.globalAlpha = reached ? (reduced ? 0.72 : 0.92) : (active ? 0.75 : 0.22);
        ctx.lineWidth = active ? 5 : 4;
        ctx.beginPath();
        ctx.moveTo(x1, axisY);
        ctx.lineTo(active ? xFor(current) : x2, axisY);
        ctx.stroke();
        ctx.restore();

        // A small leg label above its midpoint.
        ctx.fillStyle = JOURNEY_COLORS[index % JOURNEY_COLORS.length];
        ctx.globalAlpha = 0.9;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = this._font(Math.max(9, w * 0.0105), 700);
        const labelX = (x1 + x2) / 2;
        ctx.fillText(`${fmt(segments[index].end - segments[index].start, 2)} m`,
          labelX, axisY - 10);
        ctx.globalAlpha = 1;
      }
    }

    // Start and end flags.
    this._flag(ctx, xFor(0), axisY, 'START', COLORS.cyan, 1);
    this._flag(ctx, xFor(finalPosition), axisY, 'END', COLORS.pink, -1);

    // Net displacement arrow.
    if (Math.abs(displacement) > 1e-6) {
      const arrowY = axisY - h * 0.18;
      const x1 = xFor(0);
      const x2 = xFor(displacement);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.moveTo(x1, arrowY);
      ctx.lineTo(x2, arrowY);
      ctx.stroke();
      ctx.setLineDash([]);
      const dir = displacement > 0 ? 1 : -1;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.moveTo(x2, arrowY);
      ctx.lineTo(x2 - dir * 10, arrowY - 5);
      ctx.lineTo(x2 - dir * 10, arrowY + 5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, arrowY);
      ctx.lineTo(x1, axisY - 6);
      ctx.moveTo(x2, arrowY);
      ctx.lineTo(x2, axisY - 6);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = this._font(Math.max(10, w * 0.0115), 700);
      ctx.fillText(`net ${fmt(Math.abs(displacement), 2)} m ${eastWest(displacement)}`,
        (x1 + x2) / 2, arrowY - 10);
    }

    // Moving marker.
    const markerX = xFor(current);
    const markerGlow = ctx.createRadialGradient(markerX, axisY, 1, markerX, axisY, 22);
    markerGlow.addColorStop(0, 'rgba(255,255,255,0.95)');
    markerGlow.addColorStop(0.4, 'rgba(62,201,232,0.55)');
    markerGlow.addColorStop(1, 'rgba(62,201,232,0)');
    ctx.fillStyle = markerGlow;
    ctx.beginPath();
    ctx.arc(markerX, axisY, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(markerX, axisY, 7, 0, Math.PI * 2);
    ctx.fill();

    // Readout.
    const distanceSoFar = segments.reduce((total, segment, index) => {
      if (now >= segment.endTime) return total + Math.abs(segment.end - segment.start);
      if (now > segment.startTime && index === currentLeg) {
        return total + Math.abs(current - segment.start);
      }
      return total;
    }, 0);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.muted;
    ctx.font = this._font(Math.max(10, w * 0.0115), 700);
    ctx.fillText('POSITION', w * 0.36, h * 0.15);
    ctx.fillStyle = COLORS.ink;
    ctx.font = this._font(Math.max(20, w * 0.028), 800);
    ctx.fillText(`${fmt(current, 2)} m`, w * 0.36, h * 0.198);
    ctx.fillStyle = COLORS.dim;
    ctx.font = this._font(Math.max(10, w * 0.0115), 600);
    ctx.fillText(`travelled ${fmt(distanceSoFar, 2)} m · leg ${Math.min(currentLeg + 1, Math.max(1, segments.length))} of ${Math.max(1, segments.length)}`,
      w * 0.36, h * 0.258);

    if (!segments.length) {
      ctx.fillStyle = COLORS.dim;
      ctx.textAlign = 'center';
      ctx.font = this._font(Math.max(12, w * 0.014), 600);
      ctx.fillText('Add distance and time to see the journey.', w / 2, h * 0.3);
    }
  }

  // ==== Projectile Motion =================================================
  _projectile(ctx, w, h, state, time, reduced) {
    const values = state.values || {};
    const g = Number.isFinite(state.gravity) ? state.gravity : 9.8;
    const vx = values.vx0;
    const vy = values.vy0;
    const h0 = values.h0;
    const T = values.T;
    const R = values.R;
    const H = values.H;
    const now = Math.max(0, Math.min(Number.isFinite(T) ? T : 0, time));
    if (![vx, vy, h0, T].every(isNum)) {
      ctx.fillStyle = COLORS.dim;
      ctx.font = this._font(Math.max(12, w * 0.014), 600);
      ctx.textAlign = 'center';
      ctx.fillText('Add a launch speed and angle to see the trajectory.', w / 2, h * 0.42);
      return;
    }
    const maxX = Math.max(1, R || 0, state.barrierEnabled ? state.barrierDistance || 0 : 0,
      isNum(values.targetR) ? values.targetR : 0, 1);
    const maxY = Math.max(1, H || 0, state.barrierEnabled ? state.barrierHeight || 0 : 0,
      isNum(values.yTarget) ? values.yTarget : 0, 1);
    const left = w * 0.09;
    const right = w * 0.93;
    const ground = h * 0.64;
    const top = h * 0.16;
    const xFor = (x) => left + (x / (maxX * 1.08)) * (right - left);
    const yFor = (y) => ground - (Math.max(0, y) / (maxY * 1.12)) * (ground - top);

    // Ground and axes.
    ctx.strokeStyle = 'rgba(185,182,214,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left, ground);
    ctx.lineTo(right, ground);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(185,182,214,0.25)';
    ctx.beginPath();
    ctx.moveTo(left, ground);
    ctx.lineTo(left, top);
    ctx.stroke();

    const step = niceStep(Math.max(maxX, maxY), 7);
    ctx.font = this._font(Math.max(9, w * 0.0105), 600);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let x = 0; x <= maxX * 1.08; x += step) {
      ctx.fillText(`${fmt(x, 0)} m`, xFor(x), ground + 8);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = step; y <= maxY * 1.12; y += step) {
      ctx.fillText(`${fmt(y, 0)} m`, left - 8, yFor(y));
    }

    // Platform.
    if (h0 > 0.01) {
      ctx.fillStyle = 'rgba(62,201,232,0.18)';
      ctx.fillRect(left - 16, yFor(h0), 34, ground - yFor(h0));
      ctx.strokeStyle = 'rgba(62,201,232,0.62)';
      ctx.strokeRect(left - 16, yFor(h0), 34, ground - yFor(h0));
    }

    // Full dashed trajectory.
    const pathY = (x) => h0 + x * Math.tan((values.angle || 0) * Math.PI / 180)
      - (g * x * x) / (2 * values.v0 * values.v0
        * Math.cos((values.angle || 0) * Math.PI / 180) ** 2);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,156,194,0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 7]);
    ctx.beginPath();
    for (let i = 0; i <= 80; i += 1) {
      const x = (i / 80) * R;
      const y = pathY(x);
      if (i === 0) ctx.moveTo(xFor(x), yFor(y));
      else ctx.lineTo(xFor(x), yFor(y));
    }
    ctx.stroke();
    ctx.restore();

    // Apex and range markers.
    if (isNum(values.timeApex) && isNum(H)) {
      ctx.fillStyle = COLORS.pink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.font = this._font(10, 800);
      ctx.fillText('APEX', xFor(vx * values.timeApex) + 5, yFor(H) - 4);
    }
    const targetAtRange = isNum(values.targetR) && isNum(R)
      && Math.abs(values.targetR - R) < 0.05;
    if (!targetAtRange) {
      ctx.strokeStyle = 'rgba(255,255,255,0.72)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(xFor(R), ground);
      ctx.lineTo(xFor(R), ground - 18);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = this._font(10, 700);
      ctx.fillText(`R = ${fmt(R, 2)} m`, xFor(R), ground - 22);
    }

    // Barrier.
    if (state.barrierEnabled) {
      const bx = xFor(state.barrierDistance);
      const by = yFor(state.barrierHeight);
      ctx.fillStyle = 'rgba(255,92,108,0.25)';
      ctx.fillRect(bx - 4, by, 8, ground - by);
      ctx.strokeStyle = COLORS.red;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx - 4, by, 8, ground - by);
      if (isNum(values.yTarget)) {
        const clears = values.yTarget >= state.barrierHeight;
        ctx.fillStyle = clears ? COLORS.cyan : COLORS.red;
        ctx.textAlign = 'center';
        ctx.font = this._font(10, 700);
        ctx.fillText(clears
          ? `Clears by ${fmt(values.yTarget - state.barrierHeight, 2)} m`
          : `Hits the barrier, ${fmt(state.barrierHeight - values.yTarget, 2)} m short`,
        bx, by - 8);
      }
    }

    // Target point (distance X, height Y). The ring is drawn whenever the
    // horizontal target distance is known.
    if (isNum(values.targetR)) {
      const tx = xFor(values.targetR);
      const ty = yFor(isNum(values.yTarget) ? values.yTarget : h0);
      ctx.save();
      ctx.strokeStyle = 'rgba(62,201,232,0.55)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(tx, ground);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tx, ty, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tx, ty, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.cyan;
      ctx.fill();
      ctx.fillStyle = COLORS.ink;
      const alignRight = tx > right - 130;
      ctx.textAlign = alignRight ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      ctx.font = this._font(10, 700);
      const labelX = alignRight ? tx - 12 : tx + 12;
      const targetText = isNum(values.yTarget)
        ? `target (${fmt(values.targetR, 2)}, ${fmt(values.yTarget, 2)}) m`
        : `target x = ${fmt(values.targetR, 2)} m`;
      ctx.fillText(targetText, labelX, ty - 30);
      if (isNum(values.yTarget)) {
        const label = (state.targetYTyped || targetAtRange)
          ? 'Hits the target'
          : `${fmt(values.yTarget, 2)} m at the target`;
        ctx.fillStyle = state.targetYTyped ? COLORS.cyan : COLORS.muted;
        ctx.font = this._font(10, 700);
        ctx.fillText(label, labelX, ty - 16);
      }
      ctx.restore();
    }

    // Moving ball.
    const x = vx * now;
    const y = h0 + vy * now - 0.5 * g * now * now;
    const bx = xFor(x);
    const by = yFor(y);
    const glow = ctx.createRadialGradient(bx - 6, by - 6, 1, bx, by, 24);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.35, '#ffd3e6');
    glow.addColorStop(1, '#ff5c95');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(bx, by, 13, 0, Math.PI * 2);
    ctx.fill();

    const vyNow = vy - g * now;
    const speed = Math.hypot(vx, vyNow);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.muted;
    ctx.font = this._font(Math.max(10, w * 0.0115), 700);
    ctx.fillText('POSITION', w * 0.38, h * 0.13);
    ctx.fillStyle = COLORS.ink;
    ctx.font = this._font(Math.max(20, w * 0.026), 800);
    ctx.fillText(`x ${fmt(x, 2)} m · y ${fmt(y, 2)} m`, w * 0.38, h * 0.176);
    ctx.fillStyle = COLORS.dim;
    ctx.font = this._font(Math.max(10, w * 0.0115), 600);
    ctx.fillText(`speed ${fmt(speed, 2)} m/s · t ${fmt(now, 2)} s`, w * 0.38, h * 0.238);
  }

  // ==== Rotational Motion =================================================
  _rotational(ctx, w, h, state, time, reduced) {
    const values = state.values || {};
    const w0 = Number.isFinite(values.w0) ? values.w0 : 0;
    const alpha = Number.isFinite(values.alpha) ? values.alpha : 0;
    const theta = w0 * time + 0.5 * alpha * time * time;
    const omega = w0 + alpha * time;
    const radius = Number.isFinite(values.r) && values.r > 0 ? values.r : 0.5;
    const rolling = !!state.rolling;
    const centerX = rolling ? w * 0.32 + (theta * radius) * (w * 0.1) : w * 0.5;
    const centerY = rolling ? h * 0.48 : h * 0.4;
    const wheelR = Math.min(w, h) * (rolling ? 0.18 : 0.24);
    if (rolling) {
      const ground = centerY + wheelR;
      ctx.strokeStyle = 'rgba(185,182,214,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.1, ground);
      ctx.lineTo(w * 0.92, ground);
      ctx.stroke();
      const dist = theta * radius;
      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = 'center';
      ctx.font = this._font(10, 700);
      ctx.fillText(`distance ${fmt(dist, 2)} m`, centerX, ground + 16);
    }

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.fillStyle = 'rgba(15,12,40,0.65)';
    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, wheelR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      ctx.strokeStyle = 'rgba(185,182,214,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * wheelR * 0.82, Math.sin(angle) * wheelR * 0.82);
      ctx.lineTo(Math.cos(angle) * wheelR, Math.sin(angle) * wheelR);
      ctx.stroke();
    }
    // The spoke makes the rotation visible.
    ctx.strokeStyle = COLORS.pink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(theta - Math.PI / 2) * wheelR * 0.86,
      Math.sin(theta - Math.PI / 2) * wheelR * 0.86);
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.muted;
    ctx.font = this._font(Math.max(10, w * 0.0115), 700);
    ctx.fillText('ANGLE', w * 0.4, h * 0.14);
    ctx.fillStyle = COLORS.ink;
    ctx.font = this._font(Math.max(20, w * 0.026), 800);
    ctx.fillText(`${fmt(theta, 2)} rad`, w * 0.4, h * 0.188);
    ctx.fillStyle = COLORS.dim;
    ctx.font = this._font(Math.max(10, w * 0.0115), 600);
    ctx.fillText(`${fmt(theta / (Math.PI * 2), 2)} rev · ${fmt(omega, 2)} rad/s`, w * 0.4, h * 0.248);
    // Spin gauge.
    const gaugeX = w * 0.4;
    const gaugeY = h * 0.28;
    const gaugeW = w * 0.32;
    ctx.fillStyle = 'rgba(245,200,76,0.16)';
    roundRect(ctx, gaugeX, gaugeY, gaugeW, 8, 4);
    ctx.fill();
    const frac = Math.min(1, Math.abs(omega) / 60);
    ctx.fillStyle = COLORS.cyan;
    roundRect(ctx, gaugeX, gaugeY, gaugeW * frac, 8, 4);
    ctx.fill();
  }

  // ==== Torque ============================================================
  _torque(ctx, w, h, state, time, reduced) {
    const values = state.values || {};
    const scene = state.scene || 'door';
    const net = Number.isFinite(values.netTorque) ? values.netTorque : 0;
    const alpha = Number.isFinite(values.alpha) ? values.alpha : 0;
    const forces = state.forces || [];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.muted;
    ctx.font = this._font(Math.max(10, w * 0.0115), 700);
    ctx.fillText('NET TORQUE', w * 0.36, h * 0.13);
    ctx.fillStyle = COLORS.ink;
    ctx.font = this._font(Math.max(20, w * 0.024), 800);
    ctx.fillText(`${fmt(net, 2)} N·m`, w * 0.36, h * 0.172);
    ctx.fillStyle = COLORS.dim;
    ctx.font = this._font(Math.max(10, w * 0.0115), 600);
    ctx.fillText(`${state.netDirection || 'balanced'} · α = ${fmt(alpha, 2)} rad/s²`,
      w * 0.36, h * 0.232);

    if (scene === 'seesaw') {
      const cx = w * 0.5;
      const cy = h * 0.48;
      const beamW = w * 0.5;
      const tilt = Math.max(-0.22, Math.min(0.22, net / 80));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.fillStyle = '#2fb6d8';
      roundRect(ctx, -beamW / 2, -5, beamW, 10, 5);
      ctx.fill();
      const left = forces[0];
      const right = forces[1];
      if (left) {
        const x = -Math.min(beamW * 0.42, (left.r || 0.5) * 120);
        ctx.fillStyle = '#ff9cc2';
        roundRect(ctx, x - 15, -42, 30, 30, 5);
        ctx.fill();
        ctx.fillStyle = COLORS.ink;
        ctx.font = this._font(9, 700);
        ctx.textAlign = 'center';
        ctx.fillText(`${fmt((left.F || 0) / 9.8, 1)} kg`, x, -48);
      }
      if (right) {
        const x = Math.min(beamW * 0.42, (right.r || 0.5) * 120);
        ctx.fillStyle = COLORS.cyan;
        roundRect(ctx, x - 15, -42, 30, 30, 5);
        ctx.fill();
        ctx.fillStyle = COLORS.ink;
        ctx.font = this._font(9, 700);
        ctx.textAlign = 'center';
        ctx.fillText(`${fmt((right.F || 0) / 9.8, 1)} kg`, x, -48);
      }
      ctx.restore();
      ctx.fillStyle = COLORS.cyan;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - 28, cy + 50);
      ctx.lineTo(cx + 28, cy + 50);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = net > 0.001 ? COLORS.cyan : (net < -0.001 ? COLORS.red : COLORS.dim);
      ctx.textAlign = 'center';
      ctx.font = this._font(12, 800);
      ctx.fillText(Math.abs(net) < 0.001 ? 'BALANCED' : (net > 0 ? 'CCW' : 'CW'), cx, cy + 70);
      return;
    }

    if (scene === 'wheel') {
      const cx = w * 0.5;
      const cy = h * 0.45;
      const r = Math.min(w, h) * 0.2;
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      const first = forces[0];
      const second = forces[1];
      this._forceArrow(ctx, cx + r, cy - r * 0.6, 0, first ? Math.sign(first.direction) : 1, COLORS.pink, 'F1');
      this._forceArrow(ctx, cx - r, cy + r * 0.6, Math.PI, second ? Math.sign(second.direction) : -1, COLORS.cyan, 'F2');
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.7, -Math.PI / 2, -Math.PI / 2 + (net >= 0 ? 1 : -1)
        * Math.min(1.6, Math.abs(net) / 4), net < 0);
      ctx.stroke();
      return;
    }

    if (scene === 'pulley') {
      const cx = w * 0.5;
      const cy = h * 0.42;
      const r = Math.min(w, h) * 0.16;
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#c9c4e6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx - r, cy + h * 0.2);
      ctx.moveTo(cx + r, cy);
      ctx.lineTo(cx + r, cy + h * 0.2 - Math.sin(time * 2) * 20);
      ctx.stroke();
      this._forceArrow(ctx, cx - r, cy + h * 0.2, Math.PI / 2, net >= 0 ? 1 : -1, COLORS.cyan, 'F');
      this._forceArrow(ctx, cx + r, cy + h * 0.2 - 20, -Math.PI / 2, net >= 0 ? -1 : 1, COLORS.red, 'friction');
      return;
    }

    // Door / wrench: a lever from the pivot with a force at angle theta.
    const pivotX = w * 0.28;
    const pivotY = h * 0.5;
    const lever = w * 0.38;
    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY);
    ctx.lineTo(pivotX + lever, pivotY);
    ctx.stroke();
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, 8, 0, Math.PI * 2);
    ctx.fill();
    const angle = Number.isFinite(values.angle) ? values.angle : 90;
    const tipX = pivotX + lever;
    const forceLen = h * 0.16;
    const fx = tipX + Math.cos((angle - 90) * Math.PI / 180) * forceLen;
    const fy = pivotY + Math.sin((angle - 90) * Math.PI / 180) * forceLen;
    ctx.strokeStyle = COLORS.pink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(tipX, pivotY);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.fillStyle = COLORS.pink;
    ctx.beginPath();
    ctx.arc(fx, fy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.dim;
    ctx.textAlign = 'center';
    ctx.font = this._font(11, 700);
    ctx.fillText(`F = ${fmt(values.F, 2)} N`, fx, fy - 8);
    ctx.fillText(`r = ${fmt(values.r, 2)} m`, pivotX + lever / 2, pivotY + 20);
  }

  _forceArrow(ctx, x, y, angle, sign, color, label) {
    const length = 54 * (sign < 0 ? -1 : 1);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
    const tipX = x + Math.cos(angle) * length;
    const tipY = y + Math.sin(angle) * length;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(angle - 0.5) * 10, tipY - Math.sin(angle - 0.5) * 10);
    ctx.lineTo(tipX - Math.cos(angle + 0.5) * 10, tipY - Math.sin(angle + 0.5) * 10);
    ctx.closePath();
    ctx.fill();
    if (label) {
      ctx.font = this._font(10, 700);
      ctx.textAlign = 'center';
      ctx.fillText(label, tipX, tipY - 8);
    }
    ctx.restore();
  }

  // ==== Moment of Inertia =================================================
  _inertia(ctx, w, h, state, time, reduced) {
    const values = state.values || {};
    const submode = state.submode || 'shape';
    const shape = state.shape || 'disk';
    const wValue = Number.isFinite(values.w) ? values.w : 0;
    const spin = Number.isFinite(values.w2) ? values.w2 : wValue;
    const angle = (spin || 0) * time;
    const cx = w * 0.5;
    const cy = h * 0.44;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COLORS.muted;
    ctx.font = this._font(Math.max(10, w * 0.0115), 700);
    ctx.fillText('ANGULAR MOMENTUM', w * 0.36, h * 0.13);
    ctx.fillStyle = COLORS.ink;
    ctx.font = this._font(Math.max(20, w * 0.026), 800);
    ctx.fillText(`${fmt(values.Lm, 2)} kg·m²/s`, w * 0.36, h * 0.176);
    ctx.fillStyle = COLORS.dim;
    ctx.font = this._font(Math.max(10, w * 0.0115), 600);
    if (submode === 'conservation') {
      ctx.fillText(`I1 ${fmt(values.I1, 2)} · w1 ${fmt(values.w1, 2)} → I2 ${fmt(values.I2, 2)} · w2 ${fmt(values.w2, 2)}`,
        w * 0.36, h * 0.238);
    } else if (submode === 'collision') {
      ctx.fillText(`I2 ${fmt(values.I2, 3)} kg·m² · w2 ${fmt(values.w2, 2)} rad/s`,
        w * 0.36, h * 0.238);
    } else {
      ctx.fillText(`I ${fmt(values.I, 3)} kg·m² · w ${fmt(values.w, 2)} rad/s`,
        w * 0.36, h * 0.238);
    }

    if (submode === 'conservation') {
      const armsIn = Math.sin(time * 0.9) > 0;
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy - 40, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - 22);
      ctx.lineTo(cx, cy + 34);
      ctx.stroke();
      const armLength = armsIn ? 24 : 52;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx - armLength, cy + 10);
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx + armLength, cy + 10);
      ctx.stroke();
      ctx.fillStyle = armsIn ? COLORS.cyan : COLORS.pink;
      ctx.textAlign = 'center';
      ctx.font = this._font(11, 700);
      ctx.fillText(armsIn ? 'arms in · spins faster' : 'arms out · spins slower', cx, cy + 76);
      return;
    }

    if (submode === 'collision') {
      const platformR = Math.min(w, h) * 0.18;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(62,201,232,0.2)';
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, platformR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.pink;
      ctx.beginPath();
      ctx.arc(platformR * 0.55, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const drop = Math.max(0, 1 - time / 1.2);
      ctx.fillStyle = '#d9a066';
      const bagY = cy - platformR - 20 + drop * 40;
      roundRect(ctx, cx - 14, bagY, 28, 24, 4);
      ctx.fill();
      ctx.fillStyle = COLORS.dim;
      ctx.textAlign = 'center';
      ctx.font = this._font(10, 700);
      ctx.fillText('sandbag', cx, bagY - 8);
      return;
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const scale = Math.min(w, h) * 0.2;
    if (shape === 'ring') {
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(0, 0, scale, 0, Math.PI * 2);
      ctx.stroke();
    } else if (shape === 'rodEnd' || shape === 'rodCenter') {
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 8;
      ctx.beginPath();
      const x0 = shape === 'rodCenter' ? -scale : 0;
      const x1 = shape === 'rodCenter' ? scale : scale * 2;
      ctx.moveTo(x0, 0);
      ctx.lineTo(x1, 0);
      ctx.stroke();
      ctx.fillStyle = COLORS.pink;
      ctx.beginPath();
      ctx.arc(shape === 'rodCenter' ? 0 : 0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === 'point') {
      ctx.fillStyle = COLORS.pink;
      ctx.beginPath();
      ctx.arc(scale * 0.5, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(scale * 0.5, 0);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = 'rgba(62,201,232,0.2)';
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = COLORS.pink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(scale * 0.9, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  _flag(ctx, x, axisY, label, color, direction) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, axisY - 38);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, axisY - 38);
    ctx.lineTo(x + direction * 26, axisY - 31);
    ctx.lineTo(x, axisY - 24);
    ctx.closePath();
    ctx.fill();
    ctx.font = this._font(10, 800);
    ctx.textAlign = direction > 0 ? 'left' : 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, x + direction * 4, axisY - 42);
    ctx.restore();
  }
}
