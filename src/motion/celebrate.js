// The celebration rules (ported from motion/celebrate.py).
import { MOTION } from './config.js';

export const ACHIEVEMENT_PERFECT = 'perfect';
export const ACHIEVEMENT_BEST = 'best';
export const ACHIEVEMENT_WIN = 'win';

function clamp01(v) { return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v); }

export function pinsPopupText(count) {
  count = Math.max(1, Math.floor(count));
  return count === 1 ? '+1 PIN!' : `+${count} PINS!`;
}

export function pinsResultText(pins) {
  pins = Math.max(0, Math.floor(pins));
  return pins === 1 ? '1 PIN DOWN!' : `${pins} PINS DOWN!`;
}

export function pinsHoldScale(pins) {
  pins = Math.max(0, Math.min(10, Math.floor(pins)));
  if (pins >= 8) return 1.25;
  if (pins >= 5) return 1.1;
  if (pins === 0) return 0.7;
  return 1.0;
}

export const STREAK_LABELS = {
  2: 'DOUBLE!', 3: 'TURKEY!', 4: 'FOUR-BAGGER!', 5: 'FIVE-BAGGER!', 6: 'SIX-BAGGER!',
};

export function comboLabel(streak) {
  streak = Math.floor(streak);
  if (streak <= 1) return '';
  if (streak in STREAK_LABELS) return STREAK_LABELS[streak];
  return `${streak} IN A ROW!`;
}

export function streakTier(streak) {
  streak = Math.floor(streak);
  if (streak <= 2) return Math.max(0, streak - 1);
  if (streak === 3) return 2;
  return 3;
}

export function streakIntensity(streak) {
  streak = Math.max(1, Math.floor(streak));
  const grown = 1.0 + MOTION.combo_intensity_step * (streak - 1);
  return Math.min(MOTION.combo_intensity_max, grown);
}

export function spareLabel() { return MOTION.spare_sub_text; }

export function impactIntensity(speed, soft = null, reference = null) {
  if (speed === null || speed === undefined) return 0.0;
  soft = soft === null ? MOTION.impact_soft_speed : soft;
  reference = reference === null ? MOTION.impact_reference_speed : reference;
  try { speed = Number(speed); } catch (_e) { return 0.0; }
  const span = Math.max(1e-6, Number(reference) - Number(soft));
  return clamp01((speed - Number(soft)) / span);
}

export function impactShakePx(speed) {
  const intensity = impactIntensity(speed);
  if (intensity <= 0.0) return 0.0;
  return MOTION.impact_shake_min + (MOTION.impact_shake_max - MOTION.impact_shake_min) * intensity;
}

export function impactDustCount(speed) {
  const intensity = impactIntensity(speed);
  return Math.round(MOTION.dust_puff_impact * (0.5 + 0.9 * intensity));
}

export function impactFlashAlpha(speed) {
  const intensity = impactIntensity(speed);
  if (intensity < MOTION.impact_flash_min_intensity) return 0.0;
  return MOTION.impact_flash_alpha * intensity;
}

export function pindropShakePx(delta) {
  delta = Math.max(0, Math.floor(delta));
  if (delta <= 0) return 0.0;
  return Math.min(MOTION.pindrop_shake_max, MOTION.pindrop_shake_px * delta);
}

export function pindropPopScale(delta) {
  delta = Math.max(1, Math.floor(delta));
  return Math.min(MOTION.pinpop_scale_max, MOTION.pinpop_scale + 0.12 * (delta - 1));
}

export function achievement(perfect = false, best = false, won = false, total = null, previous = null) {
  if (perfect) return [ACHIEVEMENT_PERFECT, MOTION.perfect_text, MOTION.perfect_sub_text, 3];
  if (best) {
    let subtitle = MOTION.best_sub_text;
    if (total !== null && total !== undefined) {
      subtitle = previous === null || previous === undefined
        ? `${Math.floor(total)} - your best yet.`
        : `${Math.floor(total)}, beating ${Math.floor(previous)}.`;
    }
    return [ACHIEVEMENT_BEST, MOTION.best_text, subtitle, 2];
  }
  if (won) return [ACHIEVEMENT_WIN, MOTION.win_text, MOTION.win_sub_text, 1];
  return null;
}

export function achievementEventCount(tier) {
  return { 3: 3, 2: 2 }[Math.floor(tier)] ?? 1;
}

export function achievementConfetti(tier) {
  tier = Math.floor(tier);
  if (tier >= 3) return MOTION.perfect_confetti;
  if (tier === 2) return MOTION.best_confetti;
  if (tier === 1) return MOTION.win_confetti;
  return MOTION.end_confetti;
}

export function achievementFlashes(tier) {
  tier = Math.floor(tier);
  if (tier >= 3) return MOTION.perfect_flashes;
  if (tier === 2) return MOTION.best_flashes;
  if (tier === 1) return MOTION.win_flashes;
  return 0;
}
