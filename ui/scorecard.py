"""Scorecard HUD: ten frame cells with roll marks and running totals.

Each frame is a small cell holding the frame number, the roll marks (``X``,
``/``, digits) and the cumulative score once the frame resolves. The layout is
recomputed from ``window.aspect_ratio`` every frame, and every line of text is
auto-fitted to its cell, so the card stays readable from 1024x768 up.

The card owns *layout*; :class:`motion.score_fx.ScorecardMotion` owns the
*motion* (the staggered reveal, the breathing active-frame glow, the score pop
and the mark stamp). When a motion object is attached, every cell value is
perturbed after it has been laid out - a small offset, a scale multiplier, an
alpha - so the two can never fight over the same property. When none is
attached the card draws exactly as it always did.

Colours are written through :func:`_assign`, which skips a write when the
value has not changed: ursina writes a new attrib for every assignment, and
this card is redrawn sixty times a second.
"""
from ursina import Entity, Text, camera, color

from ui.layout import fit_text

CELL_RGB = (22, 28, 52)
CELL_ALPHA = 190
CURRENT_RGB = (26, 132, 186)
CURRENT_ALPHA = 210
GLOW_RGB = (96, 226, 255)          # the active frame's cyan border
FLASH_RGB = (255, 214, 130)        # the amber score-entry flash
BURST_RGB = (245, 245, 252)        # the white glow of a mark stamp
LABEL_RGB = (150, 164, 205)
MARK_RGB = (242, 246, 255)
SCORE_RGB = (255, 214, 130)
BONUS_RGB = (128, 230, 255)

LABEL_SCALE_MAX = 0.62
MARK_SCALE_MAX = 1.10
SCORE_SCALE_MAX = 1.05

GLOW_ALPHA = 0.55                  # the glow's alpha at full strength


def _format_marks(marks):
    """Turn a list of roll marks into a short string, e.g. ``7 /``."""
    if not marks:
        return " "
    return " ".join("-" if m == "0" else m for m in marks)


def _rgba(rgb, alpha=1.0):
    """RGBA from a 0-255 colour and a 0-1 alpha."""
    return color.rgba32(*(tuple(rgb) + (max(0.0, min(1.0, alpha)) * 255.0,)))


def _mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def _fit(text_entity, content, max_scale, max_width):
    """Set ``content`` and the largest scale that keeps it inside the cell."""
    return fit_text(text_entity, content, max_scale, max_width)


def _scale_of(entity):
    value = entity.scale
    return float(value[0]) if hasattr(value, '__len__') else float(value)


def _assign(cache, slot, entity, rgb, alpha):
    """Write a colour only when it actually changed (attrib churn guard)."""
    key = (tuple(rgb), round(alpha, 2))
    if cache.get(slot) == key:
        return
    cache[slot] = key
    entity.color = _rgba(rgb, alpha)


class Scorecard:
    """Ten frame columns (number / marks / score) inside a top bar."""

    def __init__(self, parent=None):
        parent = parent if parent is not None else camera.ui
        self._visible = True
        self._applied = [{} for _ in range(10)]   # last written colours
        # Attached by the HUD when the animation system is on (see motion/).
        self.motion = None
        self.cells = []
        for _ in range(10):
            cell = {
                # Draw order: glow furthest back, then the background, then the
                # flash wash, and the text in front of all of them.
                'glow': Entity(parent=parent, model='quad',
                               color=_rgba(GLOW_RGB, 0.0)),
                'background': Entity(parent=parent, model='quad',
                                     color=color.rgba32(*CELL_RGB, CELL_ALPHA)),
                'flash': Entity(parent=parent, model='quad',
                                color=_rgba(FLASH_RGB, 0.0)),
                'label': Text(parent=parent, text='', origin=(0, 0.5),
                              color=color.rgb32(*LABEL_RGB)),
                'marks': Text(parent=parent, text='', origin=(0, 0.5),
                              color=color.rgb32(*MARK_RGB)),
                'score': Text(parent=parent, text='', origin=(0, 0.5),
                              color=color.rgb32(*SCORE_RGB)),
            }
            self.cells.append(cell)

    # ------------------------------------------------------------------ layout
    def set_visible(self, visible):
        """Show/hide the whole card (single-player frame modes only)."""
        self._visible = bool(visible)
        for cell in self.cells:
            for part in cell.values():
                part.visible = self._visible

    def update(self, score, current_frame, area):
        """Draw the card.

        ``area`` is ``(left, right, top, bottom)`` in UI units; the cells share
        it evenly, so the card always fits the window it is drawn in.
        """
        if not getattr(self, '_visible', True):
            return
        left, right, top, bottom = area
        width = max(0.05, right - left)
        height = max(0.03, top - bottom)
        step = width / 10.0
        cell_width = step * 0.92
        cell_height = height * 0.88
        centre_y = (top + bottom) / 2.0
        animation = self.motion

        cumulative = score.cumulative_scores()
        for index, cell in enumerate(self.cells):
            frame = index + 1
            centre_x = left + step * (index + 0.5)
            current = current_frame is not None and frame == current_frame
            marks = _format_marks(score.frame_marks(frame))
            bonus = 'X' in marks or '/' in marks
            cache = self._applied[index]

            frame_score = cumulative[index]
            animated = (animation.displayed_total(index)
                        if animation is not None else None)
            score_text = '' if frame_score is None else str(frame_score)
            if animated is not None and frame_score is not None:
                score_text = str(animated)
            text_width = cell_width * 0.88

            label_height = _fit(cell['label'], str(frame),
                                LABEL_SCALE_MAX, text_width)
            mark_height = _fit(cell['marks'], marks,
                               MARK_SCALE_MAX, text_width)
            score_height = _fit(cell['score'], score_text,
                                SCORE_SCALE_MAX, text_width)

            gap = cell_height * 0.05
            block = label_height + mark_height + score_height + 2 * gap
            cursor = centre_y + block / 2.0
            label_y = cursor
            cursor -= label_height + gap
            marks_y = cursor
            cursor -= mark_height + gap
            score_y = cursor

            if animation is None:
                self._place(cell, cache, centre_x, centre_y, cell_width,
                            cell_height, label_y, marks_y, score_y,
                            mark_height, current, bonus, None)
            else:
                self._place(cell, cache, centre_x, centre_y, cell_width,
                            cell_height, label_y, marks_y, score_y, mark_height,
                            current, bonus, animation.cell_transform(index))

    # --------------------------------------------------------------- one cell
    def _place(self, cell, cache, centre_x, centre_y, cell_width, cell_height,
               label_y, marks_y, score_y, mark_height, current, bonus,
               transform):
        """Place one cell, statically (``transform is None``) or animated."""
        bg_rgb = CURRENT_RGB if current else CELL_RGB
        bg_alpha = (CURRENT_ALPHA if current else CELL_ALPHA) / 255.0
        label_rgb = LABEL_RGB
        mark_rgb = BONUS_RGB if bonus else MARK_RGB
        score_rgb = SCORE_RGB

        if transform is None:
            cell['glow'].visible = False
            cell['flash'].visible = False
            cell['background'].position = (centre_x, centre_y, 0.02)
            cell['background'].scale = (cell_width, cell_height)
            cell['label'].position = (centre_x, label_y)
            cell['marks'].position = (centre_x, marks_y)
            cell['marks'].rotation_z = 0.0
            cell['score'].position = (centre_x, score_y)
            _assign(cache, 'bg', cell['background'], bg_rgb, bg_alpha)
            _assign(cache, 'label', cell['label'], label_rgb, 0.85)
            _assign(cache, 'marks', cell['marks'], mark_rgb, 1.0)
            _assign(cache, 'score', cell['score'], score_rgb, 1.0)
            return

        alpha = transform['alpha']
        dy = transform['dy']
        scale = transform['scale']
        glow = transform['glow'] * GLOW_ALPHA
        flash = transform['flash']
        burst = transform['burst']

        cell['glow'].visible = glow > 0.01
        if cell['glow'].visible:
            cell['glow'].position = (centre_x + transform['glow_slide'],
                                     centre_y + dy, 0.028)
            cell['glow'].scale = (cell_width * 1.18 * scale,
                                  cell_height * 1.24 * scale)
            _assign(cache, 'glow', cell['glow'], GLOW_RGB, glow)

        flash_alpha = max(flash, burst * 0.5) * 0.55 * alpha
        cell['flash'].visible = flash_alpha > 0.01
        if cell['flash'].visible:
            cell['flash'].position = (centre_x, centre_y + dy, 0.014)
            cell['flash'].scale = (cell_width, cell_height)
            _assign(cache, 'flash', cell['flash'],
                    _mix(FLASH_RGB, BURST_RGB, burst), flash_alpha)

        cell['background'].position = (centre_x, centre_y + dy, 0.02)
        cell['background'].scale = (cell_width * scale, cell_height * scale)
        _assign(cache, 'bg', cell['background'],
                _mix(bg_rgb, FLASH_RGB, min(0.6, flash)), bg_alpha * alpha)

        label = cell['label']
        label.position = (centre_x, label_y + dy)
        label.scale = _scale_of(label) * scale
        _assign(cache, 'label', label, label_rgb, 0.85 * alpha)

        marks_entity = cell['marks']
        marks_entity.scale = _scale_of(marks_entity) * transform['mark_scale']
        rotation = transform['rotation']
        if rotation:
            from motion.score_fx import rotate_about_centre
            centre_of_marks = (centre_x, marks_y + dy - mark_height * 0.5)
            pivot = rotate_about_centre((centre_x, marks_y + dy),
                                        centre_of_marks, rotation)
        else:
            pivot = (centre_x, marks_y + dy)
        marks_entity.position = (pivot[0], pivot[1])
        marks_entity.rotation_z = rotation
        _assign(cache, 'marks', marks_entity, mark_rgb, alpha)

        score = cell['score']
        score.position = (centre_x, score_y + dy)
        score.scale = _scale_of(score) * scale
        _assign(cache, 'score', score, score_rgb, alpha)
