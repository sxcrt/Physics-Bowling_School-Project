// The visual design system: palette, type, spacing and small DOM helpers
// (ported from ui/theme.py). Sizes are written in reference pixels at 1280x720.
export const REFERENCE_WIDTH = 1280;
export const REFERENCE_HEIGHT = 720;

export const COLORS = {
  panel: [20, 16, 46], card: [28, 23, 69], card_high: [37, 31, 90],
  hairline: [58, 50, 112], pink: [255, 61, 139], pink_deep: [194, 24, 91],
  cyan: [62, 201, 232], amber: [255, 181, 71], coral: [255, 92, 108],
  purple: [167, 139, 250], green: [74, 222, 128], text: [255, 255, 255],
  text_dim: [207, 203, 234], ink: [14, 11, 30], shade: [9, 7, 20], veil: [11, 8, 32],
  // Convenience aliases the older widgets read (see PALETTE in ui/theme.py).
  grey: [176, 184, 210], dim: [207, 203, 234],
};

export const PALETTE = {
  bg: [20, 16, 40], panel: [28, 22, 58], panel_dark: [14, 11, 30],
  panel_light: [46, 36, 92], magenta: [232, 72, 168], cyan: [96, 226, 255],
  red: [226, 58, 40], brand: [255, 84, 130], amber: [255, 214, 130],
  green: [120, 230, 140], wood: [172, 120, 74], white: [245, 245, 252],
  grey: [176, 184, 210], dim: [126, 132, 164], ink: [16, 12, 30],
};

export const TYPE_PX = {
  title: 40, question: 26, heading: 18, score: 28, body: 17, body_small: 16,
  chip: 15, label: 14, helper: 13,
};

export const SIZES = {
  primary_w: 380, primary_h: 72, primary_radius: 14, primary_font: 24, primary_tracking: 2,
  secondary_w: 220, secondary_h: 56, secondary_radius: 12, secondary_font: 18,
  secondary_gap: 16, secondary_border: 2, label_tracking: 1, title_tracking: 2, title_font: 40,
  keycap_h: 22, keycap_font: 13, keycap_radius: 6, keycap_pad: 8, keycap_min_w: 26, keycap_inset: 16,
  gap_title_play: 48, gap_play_row: 24, gap_row_input: 32, input_label_gap: 8, input_label_font: 14,
  segment_h: 40, segment_font: 16, segment_radius: 10, segment_pad: 18, segment_inset: 4, segment_gap: 6,
  quit_w: 120, quit_h: 44, quit_font: 16, quit_margin: 32,
  hint_font: 15, hint_bottom: 32, hint_gap: 8, hint_group: 24, hint_strip: 72, hint_strip_alpha: 0.80,
  tagline_font: 18, tagline_tracking: 4,
  list_x: 96, list_y: 112, list_w: 400, row_h: 60, row_gap: 8, row_radius: 12, row_pad: 16,
  row_title: 18, row_tile: 40, row_tile_radius: 10, row_icon_gap: 16, row_check: 20,
  row_select_border: 3, row_hover_border: 2, row_shift: 4, row_glow: 20, row_focus_border: 2,
  row_focus_offset: 3, row_dash: 7, row_dash_gap: 5,
  detail_x: 536, detail_w: 648, detail_pad: 32, detail_title: 32, detail_tagline: 18, detail_desc: 17,
  detail_gap_title: 8, detail_gap_tagline: 16, detail_gap_desc: 24, detail_gap_chips: 24,
  detail_gap_rule: 24, detail_gap_setup: 16, detail_rule: 1,
  tab_y: 104, tab_w: 160, tab_h: 44, tab_gap: 16, tab_font: 16, tab_underline: 3, tab_tracking: 1,
  howto_x: 96, howto_y: 168, howto_w: 1088, howto_chip_col: 150, howto_row_gap: 16, howto_body: 17,
  howto_line: 25.5, howto_scroll_w: 6, howto_fade: 24,
  settings_w: 560, settings_gap: 32, settings_y: 104, settings_pad: 24, settings_heading: 18,
  settings_head_track: 3, settings_rule_gap: 12, settings_first_gap: 20, settings_row_gap: 10,
  settings_row_h: 52, settings_row_h_help: 64, settings_row_pad: 20, settings_row_radius: 12,
  settings_label: 17, settings_value: 17, settings_helper: 13, settings_label_col: 160,
  settings_value_col: 56, settings_thumb: 18, settings_track: 6, settings_note: 14,
  question_w: 760, question_y: 96, question_pad: 32, question_gap: 24, question_header: 14,
  question_text: 26, question_body: 17, question_input_h: 56, question_input_pad: 20,
  question_input_radius: 12, question_border: 2, question_button_w: 160, question_button_h: 56,
  challenge_w: 900, challenge_y: 72, challenge_pad: 28, challenge_gap: 16, challenge_header: 14,
  challenge_title: 21, challenge_body: 16, challenge_input_h: 52, challenge_input_pad: 18,
  challenge_input_radius: 12, challenge_border: 2, challenge_button_w: 164, challenge_button_h: 48,
  challenge_diagram_w: 240, challenge_diagram_h: 150, challenge_feedback_lines: 6,
  score_chip_pad: 16, score_chip_radius: 12,
  chip_font: 15, chip_pad_x: 14, chip_pad_y: 8, chip_gap: 10, chip_row_gap: 8,
  panel_radius: 16, panel_pad: 32, panel_rule: 2, card_pad: 16, card_focus_offset: 3,
  card_tile: 40, card_tile_radius: 10, setup_heading: 14, setup_tracking: 3, setup_font: 16,
  setup_gear: 24, setup_gear_gap: 16, panel_min_h: 236, picker_title: 40, picker_title_tracking: 2,
  picker_subtitle: 18, picker_gap_title: 12, picker_gap_subtitle: 26, picker_nav_gap: 18,
  nav_w: 200, nav_h: 56, nav_font: 18, nav_margin: 48, nav_bottom: 32,
  transition: 0.14, hover_scale: 1.03, press_scale: 0.97, hover_brighten: 0.10,
  screen_enter: 0.18, screen_enter_rise: 12, row_w: 400, card_border: 1,
};

export const LAYOUT = {
  margin_x: 64, margin_top: 32, margin_bottom: 32, gap_min: 16, gap_section: 32,
  pad: 32, title_y: 32,
};

export const MODE_ICONS = {
  classic: 'pin', trivia: 'question', equations: 'sigma', pvbot: 'robot',
  local: 'people3', bowlrush: 'stopwatch',
};
export const MODE_ACCENTS = {
  classic: COLORS.cyan, trivia: COLORS.pink, equations: COLORS.green,
  pvbot: COLORS.purple, local: COLORS.amber, bowlrush: COLORS.cyan,
};

export function css(rgb) { return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; }
export function cssA(rgb, alpha) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.max(0, Math.min(1, alpha))})`; }
export function brighten(rgb, amount = 0.10) { return rgb.map((c) => Math.round(c + (255 - c) * amount)); }
export function shade(rgb, factor) { return rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * factor)))); }
export function mixRgb(a, b, t) { return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)); }

// Neon glow text-shadow style.
export function glowShadow(rgb, intensity = 0.5, blurPx = 14) {
  return `0 0 ${blurPx}px ${cssA(rgb, intensity)}`;
}

// Named keys that type a character (mirrors ui/theme.py's _KEY_CHARACTERS).
// The browser reports most printable keys as their character already; these
// are the ones it reports by name.
const NAMED_CHARACTERS = {
  space: ' ', period: '.', minus: '-', comma: ',', slash: '/',
  semicolon: ';', equal: '=', plus: '+', asterisk: '*', underscore: '_',
};

export const keyToCharacter = (key) => {
  if (!key) return null;
  if (key in NAMED_CHARACTERS) return NAMED_CHARACTERS[key];
  if (key.length === 1) return /[\x20-\x7E]/.test(key) ? key : null;
  return null;
};

export function wrapText(text, width) {
  const lines = [];
  let current = '';
  for (const word of String(text).split(' ')) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ' ' + word;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}
