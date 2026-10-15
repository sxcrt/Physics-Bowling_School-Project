// One place to tune the whole animation system (ported from motion/config.py).
export const UI_MAX_DURATION = 0.6;

export class MotionConfig {
  constructor() {
    this.standard = [0.22, 1.00, 0.36, 1.00];
    this.overshoot = [0.34, 1.56, 0.64, 1.00];
    this.ease_in = [0.55, 0.06, 0.68, 0.19];
    this.ui_max_duration = UI_MAX_DURATION;

    this.reduce_motion = false;
    this.master_intensity = 1.0;
    this.particle_budget = 1.0;
    this.quality_min_scale = 0.35;
    this.slow_motion_enabled = true;
    this.slow_motion_scale = 0.4;
    this.slow_motion_time = 0.30;
    this.debug = false;

    // scoreboard reveal
    this.board_stagger = 0.040;
    this.board_enter_time = 0.34;
    this.board_enter_rise = 0.075;
    this.board_enter_alpha_from = 0.0;

    // active frame glow
    this.frame_pulse_period = 1.6;
    this.frame_pulse_min = 0.30;
    this.frame_pulse_max = 0.95;
    this.frame_scale = 1.05;
    this.frame_switch_out = 0.20;
    this.frame_switch_in = 0.25;
    this.frame_slide = 0.035;

    // entries
    this.score_pop_time = 0.25;
    this.score_pop_small = 0.60;
    this.score_pop_big = 1.15;
    this.score_flash_time = 0.20;
    this.score_flash_gain = 0.55;
    this.total_count_time = 0.50;
    this.mark_stamp_time = 0.34;
    this.mark_stamp_scale = 2.00;
    this.mark_stamp_rotate = 8.0;
    this.mark_glow_time = 0.30;

    // celebrations
    this.final_pulse_scale = 1.10;
    this.final_pulse_time = 0.50;
    this.shimmer_time = 0.90;
    this.shimmer_width = 0.28;

    // HUD player card
    this.card_slide_time = 0.35;
    this.card_slide_distance = 0.075;
    this.pin_dim_time = 0.20;
    this.pin_dim_alpha = 0.30;
    this.pin_dim_scale = 0.84;
    this.pin_wave_stagger = 0.030;
    this.pin_pop_time = 0.26;
    this.pin_pop_scale = 1.30;

    // prompt text
    this.prompt_crossfade = 0.25;
    this.prompt_rise = 0.011;
    this.prompt_pulse_period = 2.0;
    this.prompt_pulse_min = 0.75;
    this.prompt_pulse_max = 1.00;
    this.prompt_roll_fade = 0.18;

    // power bar
    this.meter_fill_smoothing = 0.20;
    this.meter_pulse_from = 0.999;
    this.meter_pulse_period = 0.7;
    this.meter_flash_time = 0.12;
    this.meter_fade_out = 0.20;
    this.meter_fade_in = 0.12;
    this.meter_colors = [[96, 226, 255], [255, 214, 130], [232, 72, 168]];

    // pin drop pop-ups
    this.pinpop_time = 0.60;
    this.pinpop_slam = 2.30;
    this.pinpop_scale = 1.80;
    this.pinpop_scale_max = 2.60;
    this.pinpop_rise = 0.085;
    this.pinpop_fade_at = 0.55;
    this.pinpop_x = 0.115;
    this.pinpop_y = -0.30;
    this.pinpop_jitter_x = 0.022;
    this.pinpop_jitter_y = 0.012;
    this.pinpop_step_y = 0.020;
    this.pinpop_drift = 0.030;
    this.pindrop_shake_px = 0.55;
    this.pindrop_shake_max = 2.60;
    this.pindrop_dust = 3;

    // result bursts
    this.result_in_time = 0.40;
    this.result_slam_time = 0.24;
    this.result_slam_scale = 2.35;
    this.result_slam_rotate = 4.0;
    this.result_pulse_period = 1.05;
    this.result_pulse_depth = 0.035;
    this.result_sub_gap = 0.105;
    this.result_sub_time = 0.28;
    this.result_ring_time = 0.45;
    this.result_ring_scale = 1.90;
    this.result_plate_alpha = 0.40;
    this.result_max_total = 1.85;
    this.result_hold = 0.90;
    this.result_out_time = 0.35;
    this.result_float = 0.055;
    this.result_flash_time = 0.12;
    this.result_flash_alpha = 0.30;
    this.strike_flashes = 3;
    this.strike_shake_px = 6.0;
    this.strike_shake_time = 0.40;
    this.strike_particles = 42;
    this.strike_dust = 10;
    this.spare_shake_px = 3.0;
    this.spare_particles = 16;
    this.spare_slide_x = 0.075;
    this.spare_slide_y = 0.030;
    this.spare_sub_text = 'CLEANED UP';
    this.gutter_drop = 0.30;
    this.gutter_sag = 0.028;
    this.gutter_vignette = 0.34;
    this.gutter_vignette_time = 0.50;
    this.pins_rise = 0.075;
    this.turkey_flashes = 5;
    this.turkey_particles = 96;
    this.turkey_hold = 1.30;
    this.turkey_text = 'TURKEY!';

    // combo / progression
    this.combo_intensity_step = 0.35;
    this.combo_intensity_max = 2.00;
    this.combo_hold_bonus = 0.22;
    this.combo_hold_max = 0.55;

    // impact
    this.impact_soft_speed = 4.60;
    this.impact_reference_speed = 8.60;
    this.impact_shake_min = 1.40;
    this.impact_shake_max = 6.50;
    this.impact_flash_min_intensity = 0.72;
    this.impact_flash_alpha = 0.16;
    this.impact_ring_time = 0.42;
    this.impact_ring_size = 0.85;

    // 3D neon
    this.strip_period_min = 3.0;
    this.strip_period_max = 5.0;
    this.strip_floor = 0.35;
    this.strip_ceiling = 0.95;
    this.strip_spike = 1.55;
    this.strip_spike_decay = 1.35;
    this.glow_breathe_depth = 0.18;
    this.glow_breathe_period = 2.6;
    this.glow_surge = 1.35;
    this.glow_surge_decay = 1.7;

    // ball and pins
    this.trail_alpha_min = 0.06;
    this.trail_alpha_max = 0.58;
    this.trail_scale = 1.0;
    this.dust_puff_release = 7;
    this.dust_puff_impact = 12;
    this.dust_life = 0.55;

    // camera
    this.deck_fov = 54.0;
    this.deck_fov_time = 0.60;
    this.camera_shake_decay = 2.6;
    this.shake_metres_per_px = 0.006;

    // pin reset
    this.sweeper_time = 0.42;
    this.sweeper_height = 0.95;
    this.drop_stagger = 0.035;
    this.drop_height = 0.55;
    this.drop_time = 0.28;

    // aim guide
    this.guide_dash_count = 14;
    this.guide_dash_length = 0.36;
    this.guide_dash_gap = 0.30;
    this.guide_flow_speed = 2.4;
    this.guide_alpha = 0.42;
    this.guide_arrow_pulse = 0.30;
    this.guide_arrow_period = 2.2;
    this.guide_fade_out = 0.15;

    // transitions
    this.pause_dim_alpha = 0.55;
    this.pause_dim_time = 0.25;
    this.pause_panel_from = 0.95;
    this.pause_panel_time = 0.28;
    this.panel_slide_time = 0.28;
    this.panel_slide_distance = 0.62;
    this.sweep_time = 0.35;
    this.sweep_width = 0.30;
    this.sweep_alpha = 0.30;

    // game end
    this.end_expand_time = 0.45;
    this.end_count_time = 1.20;
    this.end_confetti = 120;
    this.end_confetti_life = 2.2;
    this.end_results_delay = 1.45;
    this.perfect_text = 'PERFECT GAME!';
    this.perfect_sub_text = 'Twelve strikes - a 300.';
    this.best_text = 'NEW PERSONAL BEST!';
    this.best_sub_text = 'Your best game yet.';
    this.win_text = 'YOU WIN!';
    this.win_sub_text = 'The match is yours.';
    this.award_in_time = 0.42;
    this.award_pulse_period = 1.2;
    this.award_pulse_depth = 0.06;
    this.perfect_confetti = 260;
    this.best_confetti = 170;
    this.win_confetti = 120;
    this.perfect_flashes = 5;
    this.best_flashes = 3;
    this.win_flashes = 2;
  }

  get motion_scale() { return this.reduce_motion ? 0.0 : 1.0; }
  allowShake() { return !this.reduce_motion && this.master_intensity > 0.0; }
  allowFlash() { return !this.reduce_motion && this.master_intensity > 0.0; }
  allowPulse() { return !this.reduce_motion; }
  scaledCount(count) {
    const value = Math.round(count * this.particle_budget * this.master_intensity);
    return count > 0 ? Math.max(1, value) : 0;
  }
}

export const MOTION = new MotionConfig();
