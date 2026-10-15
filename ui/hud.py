"""Heads-up display: the mode-aware gameplay readout.

Ursina's UI space spans ``y`` in ``[-0.5, 0.5]`` and ``x`` in
``[-aspect/2, aspect/2]`` when parented to ``camera.ui``. Every element
re-anchors every frame from ``window.aspect_ratio`` and every text line is
auto-fitted to the space it is given, so nothing clips or overlaps at any
window size (checked at 1280x720 and 1024x768).

Layout, kept clear of the lane, pins and ball:

* top bar    - scorecard for the current player (centre) | score and the
              ten-pin rack (right); the timer (left) in timed modes
* player strip - every player's name and score in multi-player modes, with the
              bowler who is up highlighted
* centre-top - the status line ("Ready to throw", "STRIKE!", ...)
* centre     - transient messages, the question panel (Trivia / Equations)
* bottom-left- in-game webcam feed (webcam mode only)
* bottom-right - physics readout for the last throw, labelled with its source

The HUD is deliberately wordless: the score, the rack and the scorecard are
the readout, and the controls live in How to Play rather than under the lane.
"""
from ursina import Entity, Text, camera, color, window

from input.pointer import ui_pointer
from scene.textures import panel_texture
from ui.challenge_panel import ChallengePanel
from ui.layout import fit_text, wrap_text
from ui.scorecard import Scorecard
from ui import theme
from ui.theme import SIZES, TextSprite, px, screen_pos

GREEN = (120, 230, 120)
YELLOW = (235, 210, 90)
RED = (240, 110, 110)
GRAY = (186, 194, 214)
WHITE = (242, 242, 248)
SCORE_COLOR = (255, 221, 130)
AMBER = (255, 214, 130)
PANEL_RGB = (10, 8, 22)
# Firm enough that the lane's own markings (the approach dots sit right under
# this bar) do not read as UI blobs through it, still not flat black.
PANEL_ALPHA = 0.97
PIN_UP_COLOR = (250, 250, 255)
PIN_DOWN_COLOR = (70, 76, 104)

TOP_BAR_TOP = 0.5
TOP_BAR_BOTTOM = 0.408
TOP_BAR_CENTER = (TOP_BAR_TOP + TOP_BAR_BOTTOM) / 2.0


def _rgb(rgb):
    return color.rgb32(*rgb)


def _rgba(rgb, alpha=1.0):
    """RGBA from a 0-255 colour and a 0-1 alpha.

    Ursina's ``rgba32`` divides every component by 255, so the alpha is scaled
    here: this is the one place the two scales meet.
    """
    return color.rgba32(*(tuple(rgb) + (max(0.0, min(1.0, alpha)) * 255.0,)))


def _panel(parent=camera.ui, rgb=PANEL_RGB, alpha=PANEL_ALPHA):
    return Entity(parent=parent, model='quad', color=_rgba(rgb, alpha))


def _set_text(entity, value):
    """Assign ``entity.text`` only when it changed.

    Ursina's ``Text.text`` setter re-aligns and re-measures the Panda3D text
    node on *every* assignment. A HUD label rebuilt each frame with the same
    string therefore costs real frame time for nothing; this helper makes the
    assignment idempotent, which is where most of the play-loop text cost
    went (see the profile note in docs/VISITALS.md).
    """
    value = '' if value is None else str(value)
    if entity.text != value:
        entity.text = value
    return value


def _fit(text_entity, content, max_scale, max_width, min_scale=0.35):
    """Set the text and the largest scale that keeps it within ``max_width``."""
    return fit_text(text_entity, content, max_scale, max_width,
                    min_scale=min_scale)


def webcam_feedback_lines(status):
    """Pure formatter: WebcamStatus -> list of (text, RGB 0-255) lines."""
    if status is None:
        return []
    if status.error:
        return [(f'Webcam: unavailable - {status.error}', RED)]
    if not status.running:
        return [('Webcam: starting camera and pose model...', GRAY)]
    if status.tracked:
        lines = [
            (f'Webcam: tracking OK ({status.confidence * 100:3.0f}% confidence)'
             f'   arm: {getattr(status, "arm", "auto")}', GREEN),
            (f'Phase: {status.phase_label}',
             YELLOW if status.phase == 'ready' else GREEN),
        ]
    else:
        if status.lost_seconds is None:
            lines = [('Webcam: no person detected - stand in view', RED)]
        else:
            lines = [(f'Webcam: tracking lost ({status.lost_seconds:4.1f}s)'
                      ' - step back into view', RED)]
        lines.append((f'Phase: {status.phase_label}', GRAY))
    if status.hint:
        lines.append((status.hint, GRAY))
    if status.telemetry:
        lines.append((status.telemetry, (140, 145, 160)))
    return lines


def _ensure_ui_lens():
    """Keep the UI camera's film size in step with the window aspect ratio.

    Ursina only sets the UI lens film size from its window
    ``aspectRatioChanged`` event, so a window that is created at (or resized
    to) its final size can leave the lens at the wrong size and every
    ``camera.ui`` entity renders outside the view - an invisible or clipped
    HUD. Setting it here is idempotent, matches what
    ``window.update_aspect_ratio`` does, and never touches entity positions.
    """
    ui_size = getattr(camera, '_ui_size', 40)
    wanted = (ui_size * 0.5 * window.aspect_ratio, ui_size * 0.5)
    if tuple(camera.ui_lens.get_film_size()) != wanted:
        camera.ui_lens.set_film_size(*wanted)


class PlayerChip:
    """One player's name + score in the strip under the top bar."""

    def __init__(self):
        self.body = Entity(parent=camera.ui, model='quad',
                           color=_rgba(PANEL_RGB, 0.75))
        self.name = Text(parent=camera.ui, text='', origin=(0, 0.5),
                         color=_rgb(WHITE), scale=0.62)
        self.score = Text(parent=camera.ui, text='', origin=(0, 0.5),
                          color=_rgb(SCORE_COLOR), scale=0.78)
        self.detail = Text(parent=camera.ui, text='', origin=(0, 0.5),
                           color=_rgb(GRAY), scale=0.55)

    def update(self, player, current, area, score_text, detail):
        left, right, top, bottom = area
        width = right - left
        height = top - bottom
        centre_y = (top + bottom) / 2.0
        self.body.position = ((left + right) / 2.0, centre_y, 0.02)
        self.body.scale = (width, height)
        accent = player.rgb if current else tuple(int(c * 0.45)
                                                  for c in player.rgb)
        self.body.color = _rgba(accent, 0.42 if current else 0.20)
        _set_text(self.name, player.name)
        self.name.color = _rgb(WHITE if current else GRAY)
        _set_text(self.score, score_text)
        _set_text(self.detail, detail)
        text_width = width * 0.92
        name_height = _fit(self.name, player.name, 0.62, text_width)
        score_height = _fit(self.score, score_text, 0.78, text_width)
        detail_height = _fit(self.detail, detail, 0.55, text_width)
        gap = height * 0.06
        block = name_height + score_height + detail_height + 2 * gap
        cursor = centre_y + block / 2.0
        self.name.position = ((left + right) / 2.0, cursor)
        cursor -= name_height + gap
        self.score.position = ((left + right) / 2.0, cursor)
        cursor -= score_height + gap
        self.detail.position = ((left + right) / 2.0, cursor)

    def hide(self):
        self.body.visible = False
        self.name.visible = False
        self.score.visible = False
        self.detail.visible = False

    def show(self):
        self.body.visible = True
        self.name.visible = True
        self.score.visible = True
        self.detail.visible = True


class QuestionPanel:
    """The Trivia / Equations question, answer field and worked solution.

    The panel is 760px wide with its top edge at y=96, 32px of padding and
    blocks 24px apart: the header row ("QUESTION 1 OF 10" at 14px cyan and a
    1px rule), the question at 26px bold white, the GIVEN block only when it
    has content, the answer input (56px tall, #1C1745, a 2px #3A3270 border
    that turns cyan while the field is live, 20px of padding) and SUBMIT as
    the primary pink button, 160x56, right-aligned under the input. Once the
    answer is marked the panel shows the feedback and CONTINUE instead.

    The lane stays visible below the panel: nothing here is a full-width slab.
    """

    WIDTH = SIZES['question_w']
    TOP = SIZES['question_y']
    PAD = SIZES['question_pad']
    GAP = SIZES['question_gap']
    RADIUS = SIZES['question_input_radius']
    LINE_GAP = 8.0

    def __init__(self):
        self.body = Entity(parent=camera.ui, model='quad', z=0.03,
                           shader=theme.unlit_shader)
        self.heading = TextSprite(
            camera.ui, '', size_px=SIZES['question_header'],
            rgb_tuple=theme.COLORS['cyan'], bold=True,
            tracking=SIZES['title_tracking'], anchor='left', z=0.01)
        self.head_rule = Entity(parent=camera.ui, model='quad', z=0.015,
                                color=theme.rgba(theme.COLORS['hairline'], 1.0),
                                shader=theme.unlit_shader)
        self.case_label = TextSprite(
            camera.ui, '', size_px=SIZES['question_header'],
            rgb_tuple=theme.COLORS['text_dim'], anchor='right', z=0.01)
        self.prompt = TextSprite(
            camera.ui, '', size_px=SIZES['question_text'],
            rgb_tuple=theme.COLORS['text'], bold=True, anchor='lefttop',
            line_spacing=9.0, z=0.01)
        # Kept as an empty alias: the older HUD exposed per-line prompt
        # labels, and nothing should break if something still looks for them.
        self.prompt_lines = []
        self.given_label = TextSprite(
            camera.ui, 'GIVEN', size_px=SIZES['question_header'],
            rgb_tuple=theme.COLORS['cyan'], bold=True,
            tracking=SIZES['title_tracking'], anchor='lefttop', z=0.01)
        self.given = TextSprite(
            camera.ui, '', size_px=theme.TYPE_PX['body_small'],
            rgb_tuple=theme.COLORS['text'], anchor='lefttop', z=0.01)
        self.equation_label = TextSprite(
            camera.ui, 'EQUATION', size_px=SIZES['question_header'],
            rgb_tuple=theme.COLORS['cyan'], bold=True,
            tracking=SIZES['title_tracking'], anchor='lefttop', z=0.01)
        self.equation = TextSprite(
            camera.ui, '', size_px=theme.TYPE_PX['body'],
            rgb_tuple=theme.COLORS['text'], anchor='lefttop', z=0.01)
        self.unknown = TextSprite(
            camera.ui, '', size_px=SIZES['question_header'],
            rgb_tuple=theme.COLORS['amber'], anchor='right', z=0.01)
        # --- answer input ---------------------------------------------------
        self.field_body = Entity(parent=camera.ui, model='quad', z=0.02,
                                 shader=theme.unlit_shader)
        self.field_edge = Entity(parent=camera.ui, model='quad', z=0.015,
                                 shader=theme.unlit_shader)
        self.field_label = TextSprite(
            camera.ui, '', size_px=SIZES['question_body'],
            rgb_tuple=theme.COLORS['text_dim'], anchor='left', z=0.01)
        self.field = TextSprite(
            camera.ui, '', size_px=SIZES['question_body'],
            rgb_tuple=theme.COLORS['text'], anchor='left', z=0.01)
        self.caret = Entity(parent=camera.ui, model='quad',
                            color=theme.rgba(theme.COLORS['cyan'], 0.9),
                            shader=theme.unlit_shader)
        # --- feedback -------------------------------------------------------
        self.feedback_lines = [
            TextSprite(camera.ui, '', size_px=theme.TYPE_PX['chip'],
                       anchor='lefttop', z=0.01)
            for _ in range(10)
        ]
        self.LINE_GAP = 6.0
        self.footer = TextSprite(
            camera.ui, '', size_px=theme.TYPE_PX['label'],
            rgb_tuple=theme.COLORS['text_dim'], anchor='lefttop', z=0.01)
        self.submit_button = theme.ArcadeButton(
            camera.ui, 'SUBMIT',
            size_px=(SIZES['question_button_w'], SIZES['question_button_h']),
            variant='primary', accent=theme.COLORS['pink'],
            font_px=SIZES['nav_font'], tracking=SIZES['label_tracking'],
            z=0.008, on_click=lambda _b: self._submit())
        self.continue_button = theme.ArcadeButton(
            camera.ui, 'CONTINUE',
            size_px=(SIZES['question_button_w'], SIZES['question_button_h']),
            variant='primary', accent=theme.COLORS['pink'],
            font_px=SIZES['nav_font'], tracking=SIZES['label_tracking'],
            z=0.008, on_click=lambda _b: self._continue())
        self.on_submit = None          # set by the play screen
        self.on_continue = None
        self.visible = False
        # Start hidden: the panel body is a full-size quad until the first
        # layout runs, and a stray one would flash across the whole screen.
        self.hide()

    # ------------------------------------------------------------------ state
    def _widgets(self):
        return [self.body, self.head_rule, self.case_label, self.heading,
                self.prompt, self.given_label, self.given, self.equation_label,
                self.equation, self.unknown, self.field_body, self.field_edge,
                self.field_label, self.field, self.caret, self.footer,
                self.submit_button, self.continue_button,
                *self.feedback_lines]

    def hide(self):
        self.visible = False
        for entity in self._widgets():
            entity.visible = False

    def show(self):
        self.visible = True
        for entity in self._widgets():
            entity.visible = True

    def _submit(self):
        if callable(self.on_submit):
            self.on_submit()

    def _continue(self):
        if callable(self.on_continue):
            self.on_continue()

    def set_callbacks(self, on_submit, on_continue):
        self.on_submit = on_submit
        self.on_continue = on_continue

    def click(self, x, y):
        """Route a click to whichever button is showing; True when taken."""
        if not self.visible:
            return False
        if self.submit_button.visible and self.submit_button.click(x, y):
            return True
        if self.continue_button.visible and self.continue_button.click(x, y):
            return True
        return False

    def update_widgets(self, x, y, dt):
        if not self.visible:
            return
        self.submit_button.update_widget(x, y, dt)
        self.continue_button.update_widget(x, y, dt)

    # ------------------------------------------------------------------ layout
    def _paint_panel(self, height):
        """Paint the panel plate at ``height`` with its top edge at TOP."""
        radius = min(SIZES['panel_radius'], height / 2.0)
        self.body.texture = panel_texture(
            self.WIDTH, height, radius, fill_rgb=theme.COLORS['panel'],
            fill_alpha=theme.ALPHA['panel_solid'],
            border_left_rgb=theme.COLORS['cyan'],
            border_right_rgb=theme.COLORS['pink'], border_alpha=0.60)
        self.body.scale = (px(self.WIDTH), px(height))
        position = screen_pos(640, self.TOP + height / 2.0)
        self.body.position = (position[0], position[1], 0.03)

    def _place_left(self, sprite, left_px, top_px):
        theme.place(sprite, left_px, top_px)
        sprite.relayout()

    def update(self, question, answer_text, feedback, progress, mode_title,
               show_caret=True, hints_unlocked=0, attempts_left=0,
               throw_earned=False):
        """Lay the panel out top-to-bottom from one cursor, so nothing can
        overlap: the header, the question, the givens and the equation, then
        either the answer input with SUBMIT or the marked feedback."""
        content_w = self.WIDTH - 2 * self.PAD
        left_px = 640 - self.WIDTH / 2.0 + self.PAD
        right_px = 640 + self.WIDTH / 2.0 - self.PAD
        marking = feedback is not None
        solved = marking and feedback.correct
        exhausted = marking and not feedback.correct and attempts_left <= 0
        max_bottom = 720.0 - theme.LAYOUT['margin_bottom']
        button_h = SIZES['question_button_h']
        field_h = SIZES['question_input_h']

        # --- measure ---------------------------------------------------------
        self.heading.set_text(progress.upper())
        self.case_label.set_text(getattr(question, 'case', '') or '')
        self.prompt.max_width_px = content_w
        # While the answer is being marked the statement is trimmed to two
        # lines (it has been read by then) so the solution has room; the full
        # text is always shown while the question is live.
        self.prompt.max_lines = 2 if marking else 0
        self.prompt.set_text(question.prompt)
        self.prompt.relayout()
        prompt_h = self.prompt.height_px
        given_text = _given_text(question)
        has_given = bool(given_text) and not marking
        equation_text = question.equation or ''
        has_equation = bool(equation_text)
        unknown_text = (f'UNKNOWN: {question.unknown}'
                        if question.unknown else '')
        header_h = max(self.heading.height_px, self.case_label.height_px,
                       float(SIZES['question_header']))
        given_h = 0.0
        if has_given:
            self.given.max_width_px = content_w
            self.given.set_text(given_text)
            given_h = self.given_label.height_px + self.LINE_GAP \
                + self.given.height_px
        equation_h = 0.0
        if has_equation:
            self.equation.max_width_px = content_w - 200.0
            self.equation.set_text(equation_text)
            equation_h = self.equation_label.height_px + self.LINE_GAP \
                + self.equation.height_px

        fixed_h = header_h + self.GAP + prompt_h
        if has_given:
            fixed_h += self.GAP + given_h
        if has_equation:
            fixed_h += self.GAP + equation_h
        if marking:
            fixed_h += self.GAP
        else:
            fixed_h += self.GAP + field_h
        fixed_h += self.GAP + button_h
        width_px = self.WIDTH - 2 * self.PAD
        budget = max_bottom - self.TOP - 2 * self.PAD

        # --- feedback lines (they get whatever room is left) -----------------
        feedback_entries = []
        if marking:
            available = budget - fixed_h
            lines, colours = _feedback_lines(question, feedback, width_px,
                                             hints_unlocked, attempts_left)
            used = 0.0
            for index, text in enumerate(lines):
                if index >= len(self.feedback_lines):
                    break
                sprite = self.feedback_lines[index]
                sprite.max_width_px = width_px
                sprite.set_text(text)
                sprite.set_color(tuple(colours[index]))
                extra = sprite.height_px + (
                    self.LINE_GAP if feedback_entries else 0.0)
                if used + extra > available and feedback_entries:
                    break
                used += extra
                feedback_entries.append((sprite, sprite.height_px))
            fixed_h += used

        height = min(max_bottom - self.TOP, fixed_h + 2 * self.PAD)
        self._paint_panel(height)

        # --- place ------------------------------------------------------------
        y = self.TOP + self.PAD
        theme.place(self.heading, left_px, y + header_h / 2.0)
        self.heading.relayout()
        case_w = self.case_label.width_px if self.case_label.text else 0.0
        rule_left = left_px + self.heading.width_px + 16.0
        rule_right = right_px - (case_w + 16.0 if case_w else 0.0)
        if rule_right > rule_left + 16.0:
            width = rule_right - rule_left
            theme.place(self.head_rule, rule_left + width / 2.0,
                        y + header_h / 2.0)
            self.head_rule.scale = (px(width), px(1))
            self.head_rule.visible = True
        else:
            self.head_rule.visible = False
        if self.case_label.text:
            theme.place(self.case_label, right_px, y + header_h / 2.0)
            self.case_label.relayout()
        self.case_label.visible = bool(self.case_label.text)
        y += header_h + self.GAP

        self._place_left(self.prompt, left_px, y)
        y += prompt_h

        if has_given:
            y += self.GAP
            self._place_left(self.given_label, left_px, y)
            y += self.given_label.height_px + self.LINE_GAP
            self._place_left(self.given, left_px, y)
            y += self.given.height_px
        self.given_label.visible = has_given
        self.given.visible = has_given

        if has_equation:
            y += self.GAP
            self._place_left(self.equation_label, left_px, y)
            y += self.equation_label.height_px + self.LINE_GAP
            self._place_left(self.equation, left_px, y)
            self.unknown.set_text(unknown_text)
            theme.place(self.unknown, right_px,
                        y + self.equation.height_px / 2.0)
            self.unknown.relayout()
            y += self.equation.height_px
        self.equation_label.visible = has_equation
        self.equation.visible = has_equation
        self.unknown.visible = bool(unknown_text) and has_equation

        button_centre = self.TOP + height - self.PAD - button_h / 2.0
        button_x = right_px - SIZES['question_button_w'] / 2.0

        if marking:
            self.field_body.visible = False
            self.field_edge.visible = False
            self.field_label.visible = False
            self.field.visible = False
            self.caret.visible = False
            self.submit_button.visible = False
            self.continue_button.visible = self.visible
            theme.place(self.continue_button, button_x, button_centre)
            self.continue_button.relayout()
            y += self.GAP
            for sprite, sprite_h in feedback_entries:
                self._place_left(sprite, left_px, y)
                y += sprite_h + self.LINE_GAP
            footer = _feedback_footer(solved, exhausted, throw_earned)
            self.footer.set_text(footer)
            self.footer.visible = bool(footer)
            theme.place(self.footer, left_px,
                        button_centre - button_h / 2.0 + 8.0)
            self.footer.relayout()
        else:
            y += self.GAP
            field_y = y + field_h / 2.0
            self.field_body.visible = True
            self.field_edge.visible = True
            self.field_label.visible = True
            self.field.visible = True
            theme.place(self.field_body, left_px + content_w / 2.0, field_y)
            self.field_body.scale = (px(content_w), px(field_h))
            self.field_body.texture = theme.rounded_mask_texture(
                content_w, field_h, self.RADIUS)
            self.field_body.color = theme.rgba(theme.COLORS['card'], 1.0)
            theme.place(self.field_edge, left_px + content_w / 2.0, field_y)
            self.field_edge.scale = (px(content_w), px(field_h))
            self.field_edge.texture = theme.rounded_mask_texture(
                content_w, field_h, self.RADIUS, SIZES['question_border'])
            self.field_edge.color = theme.rgba(
                theme.COLORS['cyan'] if show_caret
                else theme.COLORS['hairline'], 1.0)
            pad = SIZES['question_input_pad']
            text = answer_text or ''
            self.field.set_text(text)
            theme.place(self.field, left_px + pad, field_y)
            self.field.relayout()
            if text:
                self.field_label.visible = False
            else:
                self.field_label.set_text('Type your answer, then press ENTER')
                theme.place(self.field_label, left_px + pad, field_y)
                self.field_label.relayout()
            self.caret.visible = bool(show_caret) and self.visible
            caret_x = left_px + pad + self.field.width_px + 6.0
            theme.place(self.caret, min(caret_x, right_px - 12.0), field_y)
            self.caret.scale = (px(2), px(field_h * 0.54))
            self.submit_button.visible = self.visible
            self.continue_button.visible = False
            theme.place(self.submit_button, button_x, button_centre)
            self.submit_button.relayout()
            self.footer.set_text('')
            self.footer.visible = False

        for index in range(len(feedback_entries), len(self.feedback_lines)):
            self.feedback_lines[index].visible = False


def _feedback_footer(solved, exhausted, throw_earned):
    if solved and throw_earned:
        return 'Correct - the throw is yours. ENTER moves on.'
    if solved:
        return 'Correct. The throw for this question is gone; ENTER moves on.'
    if exhausted:
        return 'All hints are unlocked and the solution is above.'
    return 'Try again, or ENTER to move on.'


def _feedback_lines(question, feedback, text_width, hints_unlocked=0,
                    attempts_left=0):
    """The marked feedback as ``(lines, colours)`` for the panel.

    Wrong answers reveal the progressive hint steps one at a time (the
    case-study calculator idea); once every hint is unlocked - or the answer
    was correct - the worked solution is shown.
    """
    lines = [feedback.summary]
    colours = [GREEN if feedback.correct else RED]
    if feedback.detail:
        lines.append(feedback.detail)
        colours.append(WHITE)
    hints = getattr(question, 'hints', ())
    if not feedback.correct:
        for index in range(min(hints_unlocked, len(hints))):
            lines.append(f'Step {index + 1}:  {hints[index]}')
            colours.append(AMBER)
        if hints_unlocked < len(hints):
            lines.append(f'({len(hints) - hints_unlocked} more hint '
                         f'{"step" if len(hints) - hints_unlocked == 1 else "steps"} '
                         f'left)')
            colours.append(GRAY)
    if feedback.working and (feedback.correct or attempts_left <= 0):
        lines.append('Worked solution:' if not feedback.correct
                     else 'Worked solution:')
        colours.append(AMBER)
        for chunk in wrap_text(feedback.working, 104)[:2]:
            lines.append(chunk)
            colours.append(GRAY)
    if not feedback.correct and attempts_left <= 0 and feedback.expected:
        lines.append(f'Expected answer: {feedback.expected}')
        colours.append(AMBER)
    if question.bowling and len(lines) < 12:
        lines.append('Why it matters: ' + question.bowling)
        colours.append(theme.PALETTE['cyan'])
    return lines, colours


def _given_text(question):
    if question.given:
        return '    '.join(f'{name} = {value}' for name, value in question.given)
    return question.assumptions or ''


class Hud:
    """Every on-screen readout, rebuilt as a coherent panel layout.

    Everything the HUD creates is reparented into ``self.root`` when the
    constructor finishes, so the entire play readout (top bar, scorecard,
    player strip, question panel, overlays' text, readouts) can be hidden or
    shown in one step. Without that, the HUD would keep drawing over the
    menus - it is the play screen's furniture, not the menu's.
    """

    def __init__(self, parent=None):
        _ensure_ui_lens()
        self.root = Entity(parent=parent if parent is not None else camera.ui)
        existing = set(camera.ui.children)
        # --- top bar ------------------------------------------------------
        self._top_bar = _panel()
        self._top_hairline = Entity(parent=camera.ui, model='quad',
                                    color=_rgba((86, 190, 255), 0.35))

        self.scorecard = Scorecard()

        # The score, top-right; no caption - the number is the score. The rack
        # under it (motion layer) or the row of ticks (plain HUD) is the only
        # other readout the top bar carries.
        self.total_score = Text(parent=camera.ui, text='0',
                                origin=(1, 0.5), color=_rgb(AMBER), scale=1.35)
        self._pin_ticks = [
            Entity(parent=camera.ui, model='quad', color=_rgba(PIN_UP_COLOR, 0.92))
            for _ in range(10)
        ]

        # --- status -------------------------------------------------------
        self.status = Text(parent=camera.ui, text='Ready to throw', scale=1.15,
                           color=_rgb(WHITE), origin=(0, 0.5))

        # Player strip (multi-player modes).
        self._player_chips = [PlayerChip() for _ in range(4)]

        # Timer (BowlRush): just the clock, no caption.
        self._timer_panel = _panel(rgb=(40, 12, 24), alpha=0.82)
        self.timer_value = Text(parent=camera.ui, text='',
                                color=_rgb(AMBER), scale=1.2, origin=(0, 0.5))

        # Webcam debug chip (top-left, clear of the question panel).
        self._webcam_panel = Entity(parent=camera.ui, model='quad',
                                    color=_rgba((11, 8, 32), 0.80),
                                    shader=theme.unlit_shader)
        self.webcam_lines = [
            TextSprite(camera.ui, '', size_px=13, rgb_tuple=GRAY,
                       anchor='lefttop', z=-0.01)
            for _ in range(4)
        ]

        # Score chip (top-right while a question is up).
        self._score_chip = Entity(parent=camera.ui, model='quad',
                                  color=_rgba((11, 8, 32), 0.80),
                                  shader=theme.unlit_shader)
        self._score_chip_edge = Entity(parent=camera.ui, model='quad',
                                       color=_rgba((58, 50, 112), 1.0),
                                       shader=theme.unlit_shader)
        self.score_caption = TextSprite(camera.ui, 'SCORE', size_px=13,
                                        rgb_tuple=theme.COLORS['text_dim'],
                                        anchor='right', z=-0.01)
        self._score_chip.visible = False
        self._score_chip_edge.visible = False
        self.score_caption.visible = False

        # Physics readout (bottom-right), with its own quiet panel so the
        # numbers stay readable over the lane.
        self._readout_panel = _panel(alpha=0.62)
        self.readout = Text(parent=camera.ui, text='', scale=theme.TYPE['tiny'],
                            color=_rgb(GRAY), origin=(1, 0.5))
        self._readout_panel.visible = False

        # Question panel (Trivia).
        self.question_panel = QuestionPanel()

        # Challenge panel (Equation Mode).
        self.challenge_panel = ChallengePanel()

        # The animation layer (see motion/hud_fx.py). ``MotionDirector`` sets
        # this to a ``HudMotion`` after the HUD is built; every animated value
        # is an offset on top of the layout below, so the HUD keeps working
        # unchanged when it is absent (tests, headless tools).
        self.motion = None
        self._official_value = None

        # Overlays.
        self.message = Text(parent=camera.ui, text='', scale=1.15,
                            color=color.yellow, origin=(0, 0.5))
        self.message.visible = False
        self._message_text = None
        self.game_over = Text(parent=camera.ui, text='', scale=1.9,
                              color=color.yellow, origin=(0, 0.5))
        self.game_over.visible = False
        self._game_over_text = None
        self._last_readout = None
        # Fold everything this HUD just created into one root entity, so the
        # whole play readout can be shown or hidden in a single step.
        for child in list(camera.ui.children):
            if child is not self.root and child not in existing:
                child.parent = self.root

    def set_visible(self, visible):
        """Show or hide the entire play readout."""
        self.root.enabled = bool(visible)

    # ------------------------------------------------------------------ update
    def update(self, ball, knockdowns, score, state, input_mode='mouse',
               webcam_status=None, message='', message_warning=False,
               match=None, mode=None, paused=False, question=None,
               answer_text='', feedback=None, question_progress='',
               results=None, physics_lines=None, timer=None, rush=False,
               hide_scorecard=False, standing_pins=None,
               score_value=None, hints_unlocked=0, attempts_left=0,
               throw_earned=False, challenge_state=None):
        _ensure_ui_lens()
        aspect = window.aspect_ratio
        half_width = aspect / 2.0
        self._update_top_bar(aspect, half_width, score, state, match, rush,
                             timer, hide_scorecard, standing_pins, score_value)
        self._update_players(half_width, match, mode)
        self._update_status(state, knockdowns, paused, match)
        self._update_webcam(half_width, input_mode, webcam_status)
        self._update_physics(physics_lines, halt=hide_scorecard)
        self._update_question(question, answer_text, feedback,
                              question_progress, mode, state,
                              hints_unlocked=hints_unlocked,
                              attempts_left=attempts_left,
                              throw_earned=throw_earned)
        self._update_challenge(challenge_state, state)
        self._update_messages(message, message_warning, state)
        self._update_results(results, state)
        motion = getattr(self, 'motion', None)
        if motion is not None:
            # Layout the animated widgets (pin triangle, power meter) inside
            # the geometry the HUD has just computed. The director applies
            # their animated offsets right after this call.
            motion.layout(self, aspect, input_mode, state)

    # ------------------------------------------------------------ top bar
    def _update_top_bar(self, aspect, half_width, score, state, match, rush,
                        timer, hide_scorecard, standing_pins=None,
                        score_value=None):
        self._top_bar.scale = (aspect, TOP_BAR_TOP - TOP_BAR_BOTTOM)
        self._top_bar.position = (0, TOP_BAR_CENTER, 0.02)
        self._top_hairline.scale = (aspect, 0.0035)
        self._top_hairline.position = (0, TOP_BAR_BOTTOM + 0.0017, 0.015)

        # The scorecard owns the middle of the bar; the score and the rack own
        # the right edge. Nothing else is written up there.
        right_x = half_width - 0.016
        show_card = (match is None or match.player_count == 1) \
            and not hide_scorecard and not rush
        self.scorecard.set_visible(show_card)
        if show_card:
            current_frame = None if state in ('game_over', 'question') \
                else score.current_frame_number
            self.scorecard.update(score, current_frame,
                                  (-half_width + 0.045, right_x - 0.105,
                                   TOP_BAR_TOP - 0.010, TOP_BAR_BOTTOM + 0.010))

        # The score: the big number is the whole readout - except while a
        # question is up, when it becomes the top-right SCORE chip.
        motion = getattr(self, 'motion', None)
        official = (score_value if score_value is not None
                    else score.current_score)
        if motion is None:
            _set_text(self.total_score, str(official))
        else:
            # The cumulative total counts up from the old value instead of
            # snapping (section 1). The HUD detects the change itself, so it
            # also catches a strike bonus that is awarded rolls later.
            if self._official_value is None:
                self._official_value = official
            elif official != self._official_value:
                motion.official_changed(self._official_value, official)
                self._official_value = official
            _set_text(self.total_score, str(motion.display_score(official)))
        question_up = self.question_panel.visible or self.challenge_panel.visible
        if question_up:
            self._update_score_chip()
        else:
            self._score_chip.visible = False
            self._score_chip_edge.visible = False
            self.score_caption.visible = False
            self.total_score.position = (right_x, TOP_BAR_TOP - 0.022)
            self.total_score.scale = 1.35

        # The rack: the ten-pin triangle with motion on, a row of ticks without.
        if standing_pins is not None:
            remaining = standing_pins
        else:
            standing = score.standing_pins() if score is not None else 0
            remaining = 0 if standing is None else standing
        if question_up:
            # The score chip owns the top-right corner while a question is up.
            self._hide_pin_ticks()
            if motion is not None:
                motion.pins.set_visible(False)
        elif motion is None:
            self._layout_pin_ticks(right_x, remaining)
        else:
            self._hide_pin_ticks()
            motion.pins.set_visible(True)
            motion.pins.set_standing(remaining)
            motion.layout_pins(right_x, TOP_BAR_BOTTOM)

        # BowlRush countdown, top-left: a bare clock.
        show_timer = bool(timer is not None)
        self._timer_panel.visible = show_timer
        self.timer_value.visible = show_timer
        if show_timer:
            seconds = max(0.0, float(timer))
            minutes = int(seconds // 60)
            remainder = seconds - minutes * 60
            text = f'{minutes}:{remainder:04.1f}'
            warn = seconds <= 30.0
            self._timer_panel.scale = (0.175, 0.056)
            self._timer_panel.position = (-half_width + 0.104, TOP_BAR_CENTER,
                                          0.02)
            _set_text(self.timer_value, text)
            self.timer_value.color = _rgb(theme.PALETTE['red'] if warn
                                          else AMBER)
            self.timer_value.position = (-half_width + 0.104,
                                         TOP_BAR_CENTER + 0.012)

    # ------------------------------------------------------------ player strip
    def _update_players(self, half_width, match, mode):
        if match is None or match.player_count < 2:
            for chip in self._player_chips:
                chip.hide()
            return
        players = match.players
        count = len(players)
        left = -half_width + 0.05
        right = half_width - 0.05
        total = right - left
        gap = 0.012
        width = (total - gap * (count - 1)) / count
        top = TOP_BAR_BOTTOM - 0.012
        height = 0.070
        bottom = top - height
        for index, chip in enumerate(self._player_chips):
            if index >= count:
                chip.hide()
                continue
            chip.show()
            player = players[index]
            score_text = str(match.score_of(player))
            # The chips show the pins knocked down as well: in a frames mode
            # the official score of a strike frame is not written down until
            # the bonus rolls are bowled, and a chip that never moves makes a
            # strike look ignored.
            if player.is_bot:
                detail = f'BOT {player.difficulty.upper()}'
            elif mode is not None and mode.score_style == 'frames':
                detail = f'{player.total_pins} pins'
            else:
                detail = f'{player.throws} throws'
            chip.update(player, index == match.turn_index,
                        (left + index * (width + gap), left + index * (width + gap)
                         + width, top, bottom), score_text, detail)
        if mode is not None and mode.timed:
            self._mark_leader(match)

    def _mark_leader(self, match):
        board = match.scoreboard()
        if not board:
            return
        best = max(score for _player, score in board)
        for index, chip in enumerate(self._player_chips):
            if index >= len(match.players):
                continue
            player = match.players[index]
            if match.score_of(player) == best and best > 0:
                chip.score.color = _rgb(theme.PALETTE['amber'])

    # ---------------------------------------------------------------- status
    def _update_status(self, state, knockdowns, paused, match):
        # The question/challenge panel owns the centre of the screen while it
        # is up, so the status line steps aside rather than overlapping it.
        self.status.visible = state not in ('question', 'challenge')
        if paused:
            text = 'Paused'
        elif state == 'game_over':
            text = 'Match over'
        elif state == 'question':
            text = 'Answer to earn a throw'
        elif state == 'challenge':
            text = 'Solve it, then bowl it'
        elif state == 'handoff':
            text = 'Next bowler'
        elif state == 'rolling':
            text = 'Ball rolling...'
        elif state == 'settling':
            text = 'Counting pins...'
        elif state == 'result' and knockdowns is not None:
            if knockdowns == 10:
                text = 'STRIKE!'
            elif knockdowns == 0:
                text = 'No pins'
            elif knockdowns == 1:
                text = '1 pin down'
            else:
                text = f'{knockdowns} pins down'
        else:
            player = match.current_player if match is not None else None
            if player is not None and match is not None \
                    and match.player_count > 1:
                text = f'{player.name} to bowl'
            elif player is not None and player.is_bot:
                text = f'{player.name} is preparing...'
            else:
                text = 'Ready to throw'
        colour = (YELLOW if knockdowns == 10 else (GRAY if paused else WHITE))
        motion = getattr(self, 'motion', None)
        if motion is None:
            _set_text(self.status, text)
            self.status.color = _rgb(colour)
        else:
            # Crossfade + 8 px drift on every change; "Ready to throw" gently
            # pulses to invite action; the prompt fades out entirely while the
            # ball is rolling (section 3).
            inviting = text in ('Ready to throw', 'Next bowler') \
                or text.endswith('to bowl')
            motion.set_prompt(text, colour, pulsing=inviting,
                              hidden=state in ('rolling',))
        self.status.position = (0, TOP_BAR_BOTTOM - 0.028)

    # ------------------------------------------------------- pin icon helpers
    def _layout_pin_ticks(self, right_x, remaining):
        """The static row of pin ticks (used when motion is not attached)."""
        tick_y = TOP_BAR_BOTTOM + 0.026
        for index, tick in enumerate(self._pin_ticks):
            tick.visible = True
            tick.position = (right_x - 0.114 + index * 0.0110, tick_y, 0.01)
            tick.scale = (0.0085, 0.022)
            if index < remaining:
                tick.color = _rgba(PIN_UP_COLOR, 0.92)
            else:
                tick.color = _rgba(PIN_DOWN_COLOR, 0.7)

    def _hide_pin_ticks(self):
        for tick in self._pin_ticks:
            tick.visible = False

    # ---------------------------------------------------------------- webcam
    def _update_webcam(self, half_width, input_mode, webcam_status):
        """The webcam debug chip: top-left, 13px, never over the question.

        It is drawn only while webcam input is active (the physics-readout
        setting and the H key govern the numbers panel, and the debug lines
        only ever exist in webcam mode). The chip stays in the free strip
        left of the question panel, so it can never cover the question.
        """
        lines = (webcam_feedback_lines(webcam_status)
                 if input_mode == 'webcam' else [])
        if not lines:
            self._webcam_panel.visible = False
            for text_entity in self.webcam_lines:
                text_entity.visible = False
            return
        chip_w = 180.0 if (self.question_panel.visible
                           or self.challenge_panel.visible) else 320.0
        pad = 12.0
        content_w = chip_w - 2 * pad
        left_px = theme.LAYOUT['margin_x']
        top_px = theme.LAYOUT['margin_top']
        y = top_px + pad
        for index, text_entity in enumerate(self.webcam_lines):
            if index < len(lines):
                text, rgb = lines[index]
                text_entity.max_width_px = content_w
                text_entity.set_text(text)
                text_entity.set_color(tuple(rgb))
                theme.place(text_entity, left_px + pad, y)
                text_entity.relayout()
                text_entity.visible = True
                y += text_entity.height_px + 4.0
            else:
                text_entity.visible = False
        chip_h = y - 4.0 - top_px + pad
        self._webcam_panel.visible = True
        self._webcam_panel.texture = theme.rounded_mask_texture(
            chip_w, max(8.0, chip_h), 8.0)
        self._webcam_panel.scale = (px(chip_w), px(chip_h))
        theme.place(self._webcam_panel, left_px + chip_w / 2.0,
                    top_px + chip_h / 2.0)

    # ------------------------------------------------------------ score chip
    def _update_score_chip(self):
        """The SCORE chip: 16px padding, a caption over the value, top-right."""
        pad = SIZES['score_chip_pad']
        right_px = 1280.0 - theme.LAYOUT['margin_x']
        top_px = theme.LAYOUT['margin_top']
        caption_h = float(self.score_caption.height_px or 15.0)
        value_h = 28.0 * 1.2
        width = max(90.0, pad * 2 + 72.0)
        height = pad * 2 + caption_h + 4.0 + value_h
        self._score_chip.visible = True
        self._score_chip_edge.visible = True
        self.score_caption.visible = True
        self._score_chip.texture = theme.rounded_mask_texture(
            width, height, SIZES['score_chip_radius'])
        self._score_chip.scale = (px(width), px(height))
        theme.place(self._score_chip, right_px - width / 2.0,
                    top_px + height / 2.0)
        self._score_chip_edge.texture = theme.rounded_mask_texture(
            width, height, SIZES['score_chip_radius'], 1)
        self._score_chip_edge.scale = (px(width), px(height))
        theme.place(self._score_chip_edge, right_px - width / 2.0,
                    top_px + height / 2.0)
        theme.place(self.score_caption, right_px - pad,
                    top_px + pad + caption_h / 2.0)
        self.score_caption.relayout()
        value_centre = top_px + pad + caption_h + 4.0 + value_h / 2.0
        self.total_score.scale = 28.0 / 18.0
        x, y = screen_pos(right_px - pad, value_centre)
        self.total_score.position = (x, y, 0.01)

    # --------------------------------------------------------------- physics
    def _update_physics(self, physics_lines, halt=False):
        """A compact, collapsible readout in the bottom-right corner.

        Only the release conditions and the outcome are shown by default; the
        full numbers live in the Physics Lab. ``H`` hides the block entirely.
        """
        if halt or not physics_lines:
            self.readout.visible = False
            self._readout_panel.visible = False
            return
        standalone = [line for line in physics_lines
                      if not line.startswith('#')]
        text = '\n'.join(standalone[:3])
        if text != self._last_readout:
            _set_text(self.readout, text)
            self._last_readout = text
        lines = max(1, text.count('\n') + 1)
        self.readout.visible = True
        self.readout.position = (window.aspect_ratio / 2.0 - 0.020,
                                 -0.5 + 0.086 + (lines - 1) * 0.026, 0.01)
        self._readout_panel.visible = True
        self._readout_panel.scale = (0.40, 0.030 * lines + 0.030)
        self._readout_panel.position = (
            window.aspect_ratio / 2.0 - 0.016 - 0.20,
            self.readout.position[1] - 0.020, 0.02)

    # -------------------------------------------------------------- question
    def _update_question(self, question, answer_text, feedback, progress,
                         mode, state, hints_unlocked=0, attempts_left=0,
                         throw_earned=False):
        if question is None or state not in ('question',):
            self.question_panel.hide()
            return
        self.question_panel.show()
        self.question_panel.update(question, answer_text, feedback, progress,
                                   mode.title if mode is not None else 'QUIZ',
                                   show_caret=feedback is None,
                                   hints_unlocked=hints_unlocked,
                                   attempts_left=attempts_left,
                                   throw_earned=throw_earned)
        from ursina import time
        self.question_panel.update_widgets(*ui_pointer(), time.dt)

    # ------------------------------------------------------------- challenge
    def _update_challenge(self, challenge_state, state):
        """The Equation Mode panel (see :mod:`ui.challenge_panel`)."""
        if challenge_state is None or state != 'challenge':
            self.challenge_panel.hide()
            return
        self.challenge_panel.show()
        self.challenge_panel.update(challenge_state)
        from ursina import time
        self.challenge_panel.update_widgets(*ui_pointer(), time.dt)

    # -------------------------------------------------------------- messages
    def _update_messages(self, message, message_warning, state):
        if message and state not in ('game_over',):
            if message != self._message_text:
                _set_text(self.message, message)
                self.message.create_background()
                self._message_text = message
            self.message.color = _rgb(RED if message_warning else YELLOW)
            self.message.position = (0, 0.05)
            self.message.visible = True
        else:
            self.message.visible = False
            self._message_text = None

    def _update_results(self, results, state):
        if results is None:
            self.game_over.visible = False
            self._game_over_text = None
            return
        text = results if isinstance(results, str) else '\n'.join(results)
        if text != self._game_over_text:
            _set_text(self.game_over, text)
            self.game_over.create_background()
            self._game_over_text = text
        self.game_over.position = (0, 0.02)
        self.game_over.visible = True
