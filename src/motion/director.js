// The director: the one object the game talks to (ported from motion/director.py).
import * as celebrate from './celebrate.js';
import * as ease from './ease.js';
import { MOTION } from './config.js';
import { Motion, tweenStep, wait, call } from './tween.js';
import {
  FlashFX, VignetteFX, SweepFX, ParticlesFX, PopTextPool, ResultCardPool, ShakeBuffer,
} from './effects.js';
import { NeonStrips, PinGlow, BallTrail, DustPuffs, ImpactRings, RackResetFX, AimGuide } from './scene_fx.js';

const CYAN = [96, 226, 255];
const MAGENTA = [232, 72, 168];
const AMBER = [255, 214, 130];
const WHITE = [245, 245, 252];
const DESAT_BLUE = [126, 152, 196];
const GOLD = [255, 214, 130];

function resultSpec(style, pins = 0, streak = 1) {
  const combo = celebrate.comboLabel(streak);
  const intensity = celebrate.streakIntensity(streak);
  if (style === 'turkey') {
    return { text: MOTION.turkey_text, sub: streak <= 3 ? '' : combo, rgb: AMBER, glow: MAGENTA, scale: 3.0,
      hold: MOTION.turkey_hold, particles: Math.floor(MOTION.turkey_particles * intensity),
      dust: Math.floor(MOTION.strike_dust * intensity), shake: MOTION.strike_shake_px * 1.3 * intensity,
      flashes: MOTION.turkey_flashes + Math.max(0, streak - 3), flash_colors: [CYAN, MAGENTA, AMBER],
      position: [0.0, 0.04], slam_from: 2.05, rotate: 5.5, ring: true, in_time: MOTION.result_slam_time * 1.05 };
  }
  if (style === 'strike') {
    return { text: 'STRIKE!', sub: combo, rgb: AMBER, glow: CYAN,
      scale: Math.min(3.9, 3.4 + 0.12 * (streak - 1)), hold: MOTION.result_hold * comboHold(streak),
      particles: Math.floor(MOTION.strike_particles * intensity), dust: Math.floor(MOTION.strike_dust * intensity),
      shake: MOTION.strike_shake_px * Math.min(1.5, intensity), flashes: MOTION.strike_flashes + Math.min(3, streak - 1),
      flash_colors: [CYAN, MAGENTA], position: [0.0, 0.04], slam_from: MOTION.result_slam_scale,
      rotate: MOTION.result_slam_rotate, ring: true, in_time: MOTION.result_slam_time };
  }
  if (style === 'spare') {
    return { text: 'SPARE', sub: celebrate.spareLabel(), rgb: CYAN, glow: MAGENTA, scale: 2.8,
      hold: MOTION.result_hold * 0.9, particles: MOTION.spare_particles, dust: 4, shake: MOTION.spare_shake_px,
      flashes: 1, flash_colors: [CYAN], position: [0.0, 0.04], slam_from: 1.55, rotate: 2.5, ring: true,
      in_time: MOTION.result_in_time * 0.9 };
  }
  if (style === 'gutter') {
    return { text: 'GUTTER', sub: '', rgb: DESAT_BLUE, glow: [70, 90, 130], scale: 2.2,
      hold: MOTION.result_hold * 0.7, particles: 8, dust: 0, shake: 0.0, flashes: 0, flash_colors: [],
      position: [0.0, 0.04], slam_from: 1.0, rotate: 0.0, ring: false, in_time: MOTION.result_in_time };
  }
  const strong = pins >= 8;
  return { text: celebrate.pinsResultText(pins), sub: '', rgb: AMBER, glow: CYAN,
    scale: strong ? 2.3 : 1.9, hold: MOTION.result_hold * 0.6 * celebrate.pinsHoldScale(pins),
    particles: strong ? Math.floor(MOTION.strike_particles / 2) : 10, dust: strong ? 6 : 0,
    shake: strong ? 1.4 : 0.0, flashes: 0, flash_colors: [], position: [0.0, -0.08],
    slam_from: strong ? 1.35 : 1.15, rotate: 1.5, ring: strong, in_time: MOTION.result_in_time * (strong ? 0.85 : 0.75) };
}

function comboHold(streak) {
  const bonus = MOTION.combo_hold_bonus * (Math.max(1, Math.floor(streak)) - 1);
  return 1.0 + Math.min(MOTION.combo_hold_max, bonus);
}

const AWARD_COLOURS = {
  [celebrate.ACHIEVEMENT_PERFECT]: [GOLD, [255, 255, 255]],
  [celebrate.ACHIEVEMENT_BEST]: [AMBER, CYAN],
  [celebrate.ACHIEVEMENT_WIN]: [CYAN, MAGENTA],
};

export class MotionDirector {
  constructor(hud = null, ball = null, pins = null, effectsRoot = null) {
    this.motion = new Motion();
    this.hud = hud;
    this.ball = ball;
    this.pins = pins;
    this.parent = effectsRoot;
    this.flash = new FlashFX(effectsRoot, this.motion);
    this.vignette = new VignetteFX(effectsRoot);
    this.sweep = new SweepFX(effectsRoot);
    this.particles = new ParticlesFX(effectsRoot, 220);
    this.cards = new ResultCardPool(effectsRoot, 2);
    this.pops = new PopTextPool(effectsRoot, 5);
    this.shake = new ShakeBuffer();
    this.strips = new NeonStrips();
    this.pin_glow = new PinGlow();
    this.dust = new DustPuffs();
    this.rings = new ImpactRings();
    this.trail = ball ? new BallTrail(ball) : null;
    this.racks = new RackResetFX(this.motion, pins);
    this.guide = new AimGuide();
    this.throw_count = 0;
    // The HUD's celebration layer borrows this director's particle pool for
    // confetti (motion/director.py wires the same relationship).
    if (this.hud && this.hud.motion) this.hud.motion.director = this;
    this.strike_streak = 0;
    this.slow_motion_time = 0.0;
    this.last_impact_speed = null;
    this._pins_counted = 0;
    this._pop_seq = 0;
    this._award_tier = 0;
    this._slow_motion_charged = false;
  }

  update(dt, ball = null, pins = null, state = 'ready', meter = null) {
    this.motion.update(dt);
    this.slow_motion_time = Math.max(0.0, this.slow_motion_time - dt);
    this.strips.update(dt);
    this.pin_glow.update(dt);
    this.dust.update(dt);
    this.rings.update(dt);
    this.particles.update(dt);
    this.flash.update(dt);
    this.vignette.update(dt);
    this.sweep.update(dt);
    this.shake.update(dt);
    this._watchPins(pins || this.pins, state);
    if (this.hud && this.hud.motion) this.hud.motion.update(dt, meter);
    if (this.trail) this.trail.update(dt, ['rolling', 'settling', 'result'].includes(state));
  }

  _watchPins(pins, state) {
    if (!pins || !['rolling', 'settling'].includes(state)) return;
    const count = pins.knockdownCount();
    if (count > this._pins_counted) {
      const delta = count - this._pins_counted;
      this._pins_counted = count;
      this.onPinDrop(count, delta);
    }
  }

  updateAimGuide(dt, active, startX, aimAngle, startZ, endZ, markX = null) {
    this.guide.update(dt, active, startX, aimAngle, startZ, endZ);
    if (markX !== null) this.guide.placeMark(markX, endZ);
  }

  cameraShake() { return this.shake.offset(); }
  slowMotionScale() {
    if (!MOTION.slow_motion_enabled) return 1.0;
    return this.slow_motion_time > 0.0 ? MOTION.slow_motion_scale : 1.0;
  }

  onMatchStart(inputMode = 'mouse', throws = 0) {
    this.throw_count = throws;
    this.strike_streak = 0;
    this._pins_counted = 0;
    this.last_impact_speed = null;
    this._award_tier = 0;
    this._slow_motion_charged = false;
    this.cards.hideAll();
    this.pops.hideAll();
    this.particles.clear();
    this.motion.cancel();
    this.flash.reset();
    this.vignette.clear();
    this.sweep.reset();
    this.dust.clear();
    this.rings.clear();
    if (this.trail) this.trail.clear();
    if (this.hud && this.hud.motion) this.hud.motion.onShow();
  }

  onThrowRelease(throwData = null, power = null) {
    this._pins_counted = 0;
    this.last_impact_speed = null;
    this._slow_motion_charged = false;
    this._pop_seq = 0;
    if (throwData) {
      this.dust.burst([throwData.lateral_position || 0.0, 0.06, 0.0], MOTION.dust_puff_release, CYAN, 0.8);
    }
    if (this.hud && this.hud.motion) this.hud.motion.meterReleased();
  }

  onShotHit(position = null, style = null, speed = null) {
    position = position || [0.0, 0.3, 16.5];
    if (speed !== null) this.last_impact_speed = speed;
    const intensity = celebrate.impactIntensity(speed);
    this.dust.burst(position, speed !== null ? celebrate.impactDustCount(speed) : MOTION.dust_puff_impact, WHITE, 1.2 + 0.6 * intensity);
    this.pin_glow.hit(0.6 + 0.6 * intensity);
    // The fov push-in is handled by the game directly.
    if (style === 'strike' || style === 'turkey') {
      this.strips.spike(1.0);
      this.shake.trigger(Math.max(MOTION.strike_shake_px, celebrate.impactShakePx(speed)));
      if (!this._slow_motion_charged) {
        this.slow_motion_time = MOTION.slow_motion_time;
        this._slow_motion_charged = true;
      }
    } else if (style === 'pins') {
      this.shake.trigger(Math.max(MOTION.spare_shake_px * 0.5, celebrate.impactShakePx(speed)));
    }
  }

  onPinImpact(position = null, speed = null) {
    position = position || [0.0, 0.30, 17.4];
    const intensity = celebrate.impactIntensity(speed);
    this.last_impact_speed = speed;
    if (intensity > 0.0 && MOTION.slow_motion_enabled && !this._slow_motion_charged) {
      this.slow_motion_time = MOTION.slow_motion_time;
      this._slow_motion_charged = true;
    }
    if (intensity > 0.0) {
      this.rings.burst([position[0], 0.02, position[2]], ease.mixRgb(WHITE, AMBER, intensity),
        MOTION.impact_ring_size * (0.6 + 0.6 * intensity));
    }
    this.dust.burst(position, celebrate.impactDustCount(speed), AMBER, 1.1 + 0.8 * intensity);
    this.shake.trigger(celebrate.impactShakePx(speed));
    const flashAlpha = celebrate.impactFlashAlpha(speed);
    if (flashAlpha > 0.0) this.flash.trigger([WHITE, CYAN], 1, MOTION.result_flash_time * 0.7, flashAlpha);
  }

  onPinDrop(count = 1, delta = 1) {
    if (!this.parent || !this.hud) return;
    count = Math.max(0, Math.floor(count));
    delta = Math.max(1, Math.floor(delta));
    const pop = this.pops.acquire();
    const text = celebrate.pinsPopupText(delta);
    const rgb = count < 10 ? AMBER : GOLD;
    const glow = count >= 10 ? MAGENTA : CYAN;
    this._pop_seq += 1;
    const side = this._pop_seq % 2 ? -1.0 : 1.0;
    const x = MOTION.pinpop_x * side + (Math.random() * 2 - 1) * MOTION.pinpop_jitter_x;
    const y = MOTION.pinpop_y + MOTION.pinpop_step_y * (this._pop_seq % 3) + (Math.random() * 2 - 1) * MOTION.pinpop_jitter_y;
    const scale = celebrate.pindropPopScale(delta);
    pop.baseX = x; pop.baseY = y;
    pop.text = text; pop.rgb = rgb; pop.glow = glow;
    this.pops.setState(pop, { scale: MOTION.pinpop_slam, alpha: 0.0 });
    // One tag per pop: a new pop must never cancel an older pop's timeline
    // (that would leave the older one stuck on screen - motion/director.py
    // tags with ('pinpop', id(pop))).
    const tag = `pinpop-${this._pop_seq}`;
    this.motion.cancel(tag);
    const slam = MOTION.pinpop_time * 0.22;
    const life = Math.max(slam + 0.05, MOTION.pinpop_time);
    const stepIn = (p) => this.pops.setState(pop, {
      scale: ease.lerp(MOTION.pinpop_slam, 1.0, p), alpha: ease.clamp01(p * 1.8), rotation: ease.lerp(-4.0, 0.0, p),
    });
    const floatOut = (p) => {
      const fadeAt = MOTION.pinpop_fade_at;
      const alpha = p <= fadeAt ? 1.0 : 1.0 - (p - fadeAt) / Math.max(1e-5, 1.0 - fadeAt);
      this.pops.setState(pop, { scale: 1.0, alpha: Math.max(0, alpha) ** 1.1,
        dy: MOTION.pinpop_rise * p, dx: MOTION.pinpop_drift * side * p });
    };
    this.motion.timeline([tweenStep(slam, stepIn, ease.OVERSHOOT), tweenStep(life - slam, floatOut, ease.LINEAR),
      call(() => this.pops.hide(pop))], tag);
    const shakePx = celebrate.pindropShakePx(delta);
    if (shakePx > 0.0) this.shake.trigger(shakePx);
    if (this.pins && delta > 1) {
      this.dust.burst([(Math.random() * 2 - 1) * 0.30, 0.22, 17.6], MOTION.pindrop_dust * delta, MAGENTA, 1.0);
    }
  }

  onScoreEntry(frameIndex = null, cellTotal = null, official = null, mark = null) {
    if (this.hud && this.hud.motion) this.hud.motion.rollRecorded(frameIndex, cellTotal, official, mark);
  }

  onPinsResolved(pins = 0, style = null, position = null, frameIndex = null) {
    if (style === null) style = pins >= 10 ? 'strike' : (pins <= 0 ? 'gutter' : 'pins');
    if (style === 'strike') {
      this.strike_streak += 1;
      if (this.strike_streak >= 3) style = 'turkey';
    } else if (style === 'spare' || style === 'gutter') this.strike_streak = 0;
    this.onShotHit(position, style, this.last_impact_speed);
    this._playResult(style, pins, frameIndex, this.strike_streak);
  }

  onFrameAdvance(frame = null, previous = null) {
    this.sweep.trigger({ rgb: [190, 240, 255] });
    if (this.hud && this.hud.motion && frame !== null) this.hud.motion.frameChanged(Math.max(0, Math.floor(frame) - 1));
  }

  onFrameChange(frame) {
    if (this.hud && this.hud.motion && frame !== null) this.hud.motion.frameChanged(Math.max(0, Math.floor(frame) - 1));
  }

  onPinReset(standing = null, full = false) {
    this.racks.play(!full);
  }

  onGameEnd(total = null, startFrom = null, overlay = null, won = false, best = false, perfect = false, previous = null) {
    const award = celebrate.achievement(perfect, best, won, total, previous);
    this._award_tier = award ? award[3] : 0;
    if (overlay) {
      if (award) {
        const [rgb, glow] = AWARD_COLOURS[award[0]] || [WHITE, CYAN];
        overlay.setAchievement(award[1], award[2], rgb, glow);
      }
      overlay.show(total, startFrom);
      // The final score counts up over the panel (see motion/director.py:
      // _count_final). Without this the overlay keeps the start value.
      if (total !== null && total !== undefined && overlay.totalScore) {
        const start = Number(startFrom !== null && startFrom !== undefined ? startFrom : 0) || 0;
        this.motion.cancel('end_count');
        this.motion.countUp(start, Number(total), MOTION.end_count_time,
          (value) => { overlay.totalScore.textContent = String(value); },
          null, ease.STANDARD, 'end_count', null, true);
      }
    }
    if (award) this._playAward(award, overlay);
    if (MOTION.allowFlash()) this.flash.trigger([CYAN, MAGENTA, WHITE], MOTION.turkey_flashes + this._award_tier);
  }

  _playAward(award, overlay) {
    if (!overlay || !this.hud) return;
    this.motion.cancel('award');
    if (this.hud.motion) this.hud.motion.confetti(celebrate.achievementConfetti(award[3]));
  }

  bindOverlays(pause = null, results = null) {
    if (pause) pause.animateIn = this.animatePauseIn.bind(this);
    if (results) results.animateIn = this.animateResultsIn.bind(this);
  }

  animatePauseIn(overlay) { /* the overlay handles its own scale-in */ }
  animateResultsIn(overlay) { /* the overlay handles its own expand */ }

  onPause(paused) {
    if (paused) this.vignette.hold(MOTION.pause_dim_alpha);
    else this.vignette.clear();
  }

  onPhysicsPanel(visible) {
    if (this.hud && this.hud.motion) this.hud.motion.setPhysicsVisible(visible);
  }

  _playResult(style, pins, frameIndex, streak = 1) {
    if (!this.parent) return;
    const spec = resultSpec(style, pins, streak);
    const card = this.cards.acquire();
    card.baseX = spec.position[0]; card.baseY = spec.position[1];
    card.text = spec.text; card.rgb = spec.rgb; card.glow = spec.glow; card.subText = spec.sub;
    this.cards.hideOthers(card);
    this.motion.cancel('result');
    const script = [];
    if (style === 'gutter') {
      this.cards.setState(card, { scale: 1.0, alpha: 0.0, dy: MOTION.gutter_drop, subAlpha: 0.0 });
      script.push(tweenStep(MOTION.result_in_time, (p) => this.cards.setState(card, {
        scale: 1.0, alpha: ease.clamp01(p * 1.8), dy: ease.lerp(MOTION.gutter_drop, 0.0, p),
      }), ease.STANDARD));
      script.push(tweenStep(spec.hold * 0.5, (p) => this.cards.setState(card, {
        scale: 1.0, alpha: 1.0, dy: ease.lerp(0.0, -MOTION.gutter_sag, p),
      }), ease.STANDARD));
      script.push(wait(spec.hold * 0.5));
    } else {
      this.cards.setState(card, { scale: spec.slam_from, alpha: 0.0, rotation: spec.rotate, ring: 0.0, subAlpha: 0.0 });
      script.push(tweenStep(spec.in_time, (p) => {
        let dx = 0, dy = 0;
        if (style === 'spare') { dx = MOTION.spare_slide_x * (1.0 - p); dy = MOTION.spare_slide_y * (1.0 - p); }
        const ring = spec.ring && MOTION.allowFlash() ? ease.clamp01(p * 1.05) : 0.0;
        this.cards.setState(card, {
          scale: ease.lerp(spec.slam_from, 1.0, p), alpha: ease.clamp01(p * 2.6),
          rotation: ease.lerp(spec.rotate, 0.0, p), dx, dy, ring, subAlpha: 0.0,
        });
      }, ease.OVERSHOOT, 0, null, true));
      const holdCap = Math.max(0.20, MOTION.result_max_total - spec.in_time - MOTION.result_out_time);
      let hold = Math.max(0.12, Math.min(spec.hold, holdCap));
      if (spec.sub) {
        const subTime = Math.min(MOTION.result_sub_time, hold * 0.45);
        script.push(tweenStep(subTime, (p) => this.cards.setState(card, {
          scale: 1.0, alpha: 1.0, ring: 0.0, subAlpha: ease.clamp01(p * 1.5), subDy: ease.lerp(-0.022, 0.0, p),
        }), ease.STANDARD, 0, null, true));
        hold -= subTime;
      }
      script.push(tweenStep(Math.max(0.05, hold), (p) => {
        let wobble = 0.0;
        if (MOTION.allowPulse()) {
          const phase = p * hold / Math.max(0.05, MOTION.result_pulse_period);
          wobble = MOTION.result_pulse_depth * Math.sin(phase * Math.PI * 2);
        }
        this.cards.setState(card, { scale: 1.0 + wobble, alpha: 1.0, ring: 0.0, subAlpha: 1.0 });
      }, ease.LINEAR, 0, null, true));
    }
    script.push(tweenStep(MOTION.result_out_time, (p) => this.cards.setState(card, {
      scale: ease.lerp(1.0, 0.92, p), alpha: 1.0 - p, dy: MOTION.result_float * p, subAlpha: 1.0 - p,
    }), ease.STANDARD, 0, null, true));
    script.push(call(() => this.cards.hide(card)));
    this.motion.timeline(script, 'result');
    if (spec.flashes && MOTION.allowFlash()) this.flash.trigger(spec.flash_colors, spec.flashes);
    if (style === 'turkey') this.strips.laneFlash();
    else this.strips.spike(style === 'spare' ? 0.6 : 1.0);
    if (spec.shake) this.shake.trigger(spec.shake);
    this.particles.burst(640 + spec.position[0] * 720, 360 - spec.position[1] * 720, spec.particles,
      [spec.rgb, spec.glow, WHITE], 0.6, Math.PI / 2, -1.6, style === 'turkey' ? 1.2 : 0.8);
    if (style === 'gutter') this.vignette.trigger();
    if (spec.dust) this.dust.burst([0.0, 0.35, 17.6], spec.dust, MAGENTA, 1.8);
    if (this.hud && this.hud.motion && ['strike', 'turkey', 'spare'].includes(style)) {
      if (frameIndex !== null && frameIndex !== undefined) this.hud.motion.markStamp(frameIndex);
      this.hud.motion.pinsCelebrate(style);
    }
  }
}
