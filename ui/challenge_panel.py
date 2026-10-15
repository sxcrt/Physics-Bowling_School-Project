"""The Equation Mode challenge panel: problem, lane diagram, input, result.

One panel, laid out top to bottom from a single cursor so nothing can overlap
at any window size (the same discipline as :class:`ui.hud.QuestionPanel`):

* the header row ("CHALLENGE 2 OF 10" and the case label) and a hairline,
* the challenge title and the brief, with the **lane diagram** on the right -
  a schematic top view drawn from the real deck geometry that overlays the
  *simulated* ball path of the last attempt,
* YOUR TASK, GIVEN and the governing EQUATION,
* the answer field with its unit and the primary button (BOWL IT / NEXT),
* the marked result: the player's input, the measurements the simulation
  produced, the physics explanation and the progressive hint steps.

Nothing here decides anything physical. The panel only shows what the play
screen measured and what the challenge bank computed; the deck is the judge.
"""
from dataclasses import dataclass

from ursina import Entity, camera

from scene.textures import lane_diagram_texture, panel_texture
from ui import theme
from ui.layout import wrap_text
from ui.theme import SIZES, TextSprite, px, screen_pos

GREEN = (120, 230, 120)
AMBER = (255, 214, 130)
RED = (240, 110, 110)
GRAY = (186, 194, 214)
WHITE = (242, 242, 248)
CYAN = theme.COLORS['cyan']


@dataclass
class ChallengeView:
    """Everything the panel needs to draw one frame of Equation Mode."""

    challenge: object = None
    progress: str = ''
    input_text: str = ''
    result: object = None            # game.challenges.ChallengeOutcome or None
    attempts: int = 0
    hints_unlocked: int = 0
    solution: str = ''               # revealed worked solution ('' = hidden)
    show_solution: bool = False      # the SHOW SOLUTION button is available
    caret: bool = True
    path: tuple = ()                 # ((x, z), ...) from the last roll
    pins: tuple = ()                 # (label, x, z, is_target, is_down)
    launched: bool = False
    gutter_x: float = None
    error: str = ''                  # input validation message


class ChallengePanel:
    """The Equation Mode panel (one instance, shown while a challenge is up)."""

    WIDTH = SIZES['challenge_w']
    TOP = SIZES['challenge_y']
    PAD = SIZES['challenge_pad']
    GAP = SIZES['challenge_gap']
    LINE_GAP = 6.0
    DIAGRAM_W = SIZES['challenge_diagram_w']
    DIAGRAM_H = SIZES['challenge_diagram_h']

    def __init__(self):
        self.body = Entity(parent=camera.ui, model='quad', z=0.03,
                           shader=theme.unlit_shader)
        self.heading = TextSprite(
            camera.ui, '', size_px=SIZES['challenge_header'],
            rgb_tuple=CYAN, bold=True, tracking=SIZES['title_tracking'],
            anchor='left', z=0.01)
        self.head_rule = Entity(parent=camera.ui, model='quad', z=0.015,
                                color=theme.rgba(theme.COLORS['hairline'], 1.0),
                                shader=theme.unlit_shader)
        self.case_label = TextSprite(
            camera.ui, '', size_px=SIZES['challenge_header'],
            rgb_tuple=theme.COLORS['text_dim'], anchor='right', z=0.01)
        self.title = TextSprite(
            camera.ui, '', size_px=SIZES['challenge_title'],
            rgb_tuple=theme.COLORS['text'], bold=True, anchor='lefttop',
            z=0.01)
        self.brief = TextSprite(
            camera.ui, '', size_px=SIZES['challenge_body'],
            rgb_tuple=theme.COLORS['text_dim'], anchor='lefttop',
            line_spacing=7.0, z=0.01)
        self.target_label = TextSprite(
            camera.ui, 'YOUR TASK', size_px=SIZES['challenge_header'],
            rgb_tuple=AMBER, bold=True, tracking=SIZES['title_tracking'],
            anchor='lefttop', z=0.01)
        self.target = TextSprite(
            camera.ui, '', size_px=theme.TYPE_PX['body'],
            rgb_tuple=theme.COLORS['text'], anchor='lefttop', z=0.01)
        self.given_label = TextSprite(
            camera.ui, 'GIVEN', size_px=SIZES['challenge_header'],
            rgb_tuple=CYAN, bold=True, tracking=SIZES['title_tracking'],
            anchor='lefttop', z=0.01)
        self.given = TextSprite(
            camera.ui, '', size_px=theme.TYPE_PX['body_small'],
            rgb_tuple=theme.COLORS['text'], anchor='lefttop', z=0.01)
        self.equation_label = TextSprite(
            camera.ui, 'GOVERNING EQUATION', size_px=SIZES['challenge_header'],
            rgb_tuple=CYAN, bold=True, tracking=SIZES['title_tracking'],
            anchor='lefttop', z=0.01)
        self.equation = TextSprite(
            camera.ui, '', size_px=theme.TYPE_PX['body'],
            rgb_tuple=GREEN, anchor='lefttop', z=0.01)
        # --- lane diagram ---------------------------------------------------
        self.diagram = Entity(parent=camera.ui, model='quad', z=0.02,
                              shader=theme.unlit_shader)
        # --- input ----------------------------------------------------------
        self.field_body = Entity(parent=camera.ui, model='quad', z=0.02,
                                 shader=theme.unlit_shader)
        self.field_edge = Entity(parent=camera.ui, model='quad', z=0.015,
                                 shader=theme.unlit_shader)
        self.field_label = TextSprite(
            camera.ui, '', size_px=theme.TYPE_PX['body'],
            rgb_tuple=theme.COLORS['text_dim'], anchor='left', z=0.01)
        self.field = TextSprite(
            camera.ui, '', size_px=theme.TYPE_PX['heading'],
            rgb_tuple=WHITE, bold=True, anchor='left', z=0.01)
        self.unit_label = TextSprite(
            camera.ui, '', size_px=theme.TYPE_PX['body'],
            rgb_tuple=theme.COLORS['text_dim'], anchor='left', z=0.01)
        self.caret = Entity(parent=camera.ui, model='quad',
                            color=theme.rgba(CYAN, 0.9),
                            shader=theme.unlit_shader)
        # --- feedback -------------------------------------------------------
        self.feedback_headline = TextSprite(
            camera.ui, '', size_px=theme.TYPE_PX['heading'], bold=True,
            anchor='lefttop', z=0.01)
        self.feedback_lines = [
            TextSprite(camera.ui, '', size_px=theme.TYPE_PX['chip'],
                       anchor='lefttop', z=0.01)
            for _ in range(SIZES['challenge_feedback_lines'])
        ]
        self.footer = TextSprite(
            camera.ui, '', size_px=theme.TYPE_PX['label'],
            rgb_tuple=theme.COLORS['text_dim'], anchor='lefttop', z=0.01)
        # --- buttons --------------------------------------------------------
        size = (SIZES['challenge_button_w'], SIZES['challenge_button_h'])
        self.primary_button = theme.ArcadeButton(
            camera.ui, 'BOWL IT', size_px=size, variant='primary',
            accent=theme.COLORS['pink'], font_px=SIZES['nav_font'],
            tracking=SIZES['label_tracking'], z=0.008,
            on_click=lambda _b: self._primary())
        self.solution_button = theme.ArcadeButton(
            camera.ui, 'SHOW SOLUTION', size_px=size, variant='ghost',
            accent=CYAN, font_px=SIZES['nav_font'] - 2,
            tracking=SIZES['label_tracking'], z=0.008,
            on_click=lambda _b: self._solution())
        self.on_primary = None
        self.on_solution = None
        self.action = 'bowl'
        self.visible = False
        self.hide()

    # ------------------------------------------------------------------ state
    def _widgets(self):
        return [self.body, self.head_rule, self.heading, self.case_label,
                self.title, self.brief, self.target_label, self.target,
                self.given_label, self.given, self.equation_label,
                self.equation, self.diagram,
                self.field_body, self.field_edge, self.field_label, self.field,
                self.unit_label, self.caret, self.feedback_headline,
                self.footer, self.primary_button, self.solution_button,
                *self.feedback_lines]

    def hide(self):
        self.visible = False
        for entity in self._widgets():
            entity.visible = False

    def show(self):
        self.visible = True
        for entity in self._widgets():
            entity.visible = True

    def set_callbacks(self, on_primary, on_solution=None):
        self.on_primary = on_primary
        self.on_solution = on_solution

    def _primary(self):
        if callable(self.on_primary):
            self.on_primary(self.action)

    def _solution(self):
        if callable(self.on_solution):
            self.on_solution()

    def click(self, x, y):
        """Route a click to whichever button is showing; True when taken."""
        if not self.visible:
            return False
        if self.primary_button.visible and self.primary_button.click(x, y):
            return True
        if self.solution_button.visible and self.solution_button.click(x, y):
            return True
        return False

    def update_widgets(self, x, y, dt):
        if not self.visible:
            return
        self.primary_button.update_widget(x, y, dt)
        self.solution_button.update_widget(x, y, dt)

    # ------------------------------------------------------------------ layout
    def _paint_panel(self, height):
        radius = min(SIZES['panel_radius'], height / 2.0)
        self.body.texture = panel_texture(
            self.WIDTH, height, radius, fill_rgb=theme.COLORS['panel'],
            fill_alpha=theme.ALPHA['panel_solid'],
            border_left_rgb=CYAN, border_right_rgb=theme.COLORS['pink'],
            border_alpha=0.60)
        self.body.scale = (px(self.WIDTH), px(height))
        position = screen_pos(640, self.TOP + height / 2.0)
        self.body.position = (position[0], position[1], 0.03)

    def _place_left(self, sprite, left_px, top_px):
        theme.place(sprite, left_px, top_px)
        sprite.relayout()

    def update(self, view):
        """Lay the panel out for one frame; ``view`` is a :class:`ChallengeView`."""
        challenge = view.challenge
        if challenge is None:
            self.hide()
            return
        self.show()

        sizes = SIZES
        content_w = self.WIDTH - 2 * self.PAD
        left = 640 - self.WIDTH / 2.0 + self.PAD
        right = 640 + self.WIDTH / 2.0 - self.PAD
        max_bottom = 720.0 - theme.LAYOUT['margin_bottom']
        marking = view.result is not None or bool(view.solution)
        solved = bool(view.result is not None and view.result.solved)

        header_h = float(sizes['challenge_header']) + 6.0

        # ---- measure the text blocks --------------------------------------
        self.title.set_text(challenge.title)
        self.title.max_width_px = content_w
        self.brief.max_width_px = content_w - self.DIAGRAM_W - self.GAP
        self.brief.max_lines = 4
        self.brief.set_text(challenge.brief)
        self.target_label.set_text('YOUR TASK')
        target_label_w = self.target_label.width_px + 12.0
        self.target.max_width_px = content_w - target_label_w
        self.target.set_text(challenge.target)
        target_h = max(self.target_label.height_px, self.target.height_px)
        given_text = '    '.join(f'{name} = {value}'
                                 for name, value in challenge.given)
        self.given.max_width_px = content_w
        self.given.set_text(given_text or challenge.assumptions)
        equation_text = challenge.equation or ''
        if challenge.equation_note:
            equation_text = (equation_text + '\n' + challenge.equation_note
                             if equation_text else challenge.equation_note)
        self.equation.max_width_px = content_w
        self.equation.set_text(equation_text)
        for sprite in (self.title, self.brief, self.target, self.given,
                       self.equation):
            sprite.relayout()

        main_h = max(self.brief.height_px, float(self.DIAGRAM_H))
        headline_reserve = (float(theme.TYPE_PX['heading']) + self.LINE_GAP) \
            if (marking or view.error) else 0.0
        budget = max_bottom - self.TOP - 2 * self.PAD
        fixed = (header_h + 4.0 + self.title.height_px + 8.0 + main_h
                 + 12.0 + target_h + 10.0
                 + self.given_label.height_px + 4.0 + self.given.height_px
                 + 10.0 + self.equation_label.height_px + 4.0
                 + self.equation.height_px + 12.0
                 + float(sizes['challenge_input_h']))
        available = max(0.0, budget - fixed - headline_reserve)
        feedback_entries = self._feedback_entries(view, content_w, available)
        used = sum(height + self.LINE_GAP for _sprite, height, _colour in
                   feedback_entries)
        if feedback_entries:
            used -= self.LINE_GAP
        footer_text = self._footer_text(view, solved, marking)
        footer_h = self.footer.height_px if footer_text else 0.0
        height = min(max_bottom - self.TOP,
                     fixed + used + (self.LINE_GAP + footer_h if footer_h else 0)
                     + 2 * self.PAD)
        self._paint_panel(height)

        # ---- place ----------------------------------------------------------
        y = self.TOP + self.PAD
        self.heading.set_text(view.progress.upper())
        theme.place(self.heading, left, y + header_h / 2.0)
        self.heading.relayout()
        self.case_label.set_text(getattr(challenge, 'case', '') or '')
        theme.place(self.case_label, right, y + header_h / 2.0)
        self.case_label.relayout()
        case_w = self.case_label.width_px if self.case_label.text else 0.0
        rule_left = left + self.heading.width_px + 16.0
        rule_right = right - (case_w + 16.0 if case_w else 0.0)
        if rule_right > rule_left + 16.0:
            width = rule_right - rule_left
            theme.place(self.head_rule, rule_left + width / 2.0,
                        y + header_h / 2.0)
            self.head_rule.scale = (px(width), px(1))
            self.head_rule.visible = True
        else:
            self.head_rule.visible = False
        y += header_h + 4.0

        self._place_left(self.title, left, y)
        y += self.title.height_px + 8.0

        # The brief on the left, the diagram on the right.
        self._place_left(self.brief, left, y)
        diagram_left = right - self.DIAGRAM_W
        theme.place(self.diagram, diagram_left + self.DIAGRAM_W / 2.0,
                    y + self.DIAGRAM_H / 2.0)
        self.diagram.scale = (px(self.DIAGRAM_W), px(self.DIAGRAM_H))
        self.diagram.texture = lane_diagram_texture(
            self.DIAGRAM_W, self.DIAGRAM_H, pins=view.pins, path=view.path,
            start_x=self._start_x(view), aim_x=challenge.aim_x(),
            solved=solved, launched=view.launched, gutter_x=view.gutter_x)
        y += main_h + 12.0

        # The task shares one line with its amber label, which buys the result
        # block the vertical room it needs for four measured lines.
        self._place_left(self.target_label, left, y)
        label_w = self.target_label.width_px + 12.0
        self.target.max_width_px = content_w - label_w
        self.target.set_text(challenge.target)
        self.target.relayout()
        self._place_left(self.target, left + label_w, y)
        y += max(self.target_label.height_px, self.target.height_px) + 10.0

        self._place_left(self.given_label, left, y)
        y += self.given_label.height_px + 4.0
        self._place_left(self.given, left, y)
        y += self.given.height_px + 10.0

        self._place_left(self.equation_label, left, y)
        y += self.equation_label.height_px + 4.0
        self._place_left(self.equation, left, y)
        y += self.equation.height_px + 12.0

        # ---- input row ------------------------------------------------------
        field_h = float(sizes['challenge_input_h'])
        button_w = float(sizes['challenge_button_w'])
        field_w = content_w - button_w - 12.0
        interactive = not solved and not view.solution
        self.field_body.visible = True
        self.field_edge.visible = True
        theme.place(self.field_body, left + field_w / 2.0, y + field_h / 2.0)
        self.field_body.scale = (px(field_w), px(field_h))
        self.field_body.texture = theme.rounded_mask_texture(
            field_w, field_h, SIZES['challenge_input_radius'])
        self.field_body.color = theme.rgba(theme.COLORS['card'], 1.0)
        theme.place(self.field_edge, left + field_w / 2.0, y + field_h / 2.0)
        self.field_edge.scale = (px(field_w), px(field_h))
        self.field_edge.texture = theme.rounded_mask_texture(
            field_w, field_h, SIZES['challenge_input_radius'],
            SIZES['challenge_border'])
        edge_colour = (theme.COLORS['hairline'] if not interactive
                       else (RED if view.error else
                             (CYAN if view.caret else theme.COLORS['hairline'])))
        self.field_edge.color = theme.rgba(edge_colour, 1.0)

        pad = SIZES['challenge_input_pad']
        text = view.input_text or ''
        self.field_label.set_text(
            f'{challenge.control.label}  ({challenge.control.unit})')
        self.field.set_text(text)
        self.field.set_color(AMBER if marking else WHITE)
        field_y = y + field_h / 2.0
        if text:
            self.field.visible = True
            self.field_label.visible = False
            theme.place(self.field, left + pad, field_y)
            self.field.relayout()
            self.unit_label.set_text(f'{challenge.control.unit}')
            theme.place(self.unit_label,
                        left + pad + self.field.width_px + 8.0, field_y)
            self.unit_label.relayout()
            self.unit_label.visible = True
        else:
            self.field.visible = False
            self.field_label.visible = True
            theme.place(self.field_label, left + pad, field_y)
            self.field_label.relayout()
            self.unit_label.visible = False
        self.caret.visible = bool(interactive and view.caret)
        if text:
            caret_x = left + pad + self.field.width_px + 8.0 \
                + (self.unit_label.width_px + 10.0
                   if self.unit_label.visible else 0.0)
        else:
            caret_x = left + pad
        theme.place(self.caret, min(caret_x, left + field_w - 12.0), field_y)
        self.caret.scale = (px(2), px(field_h * 0.52))

        # ---- buttons --------------------------------------------------------
        button_x = right - button_w / 2.0
        self.primary_button.set_label(self._primary_label(view, solved))
        theme.place(self.primary_button, button_x, field_y)
        self.primary_button.relayout()
        self.solution_button.visible = bool(view.show_solution and interactive)
        theme.place(self.solution_button,
                    button_x - button_w / 2.0 - 12.0
                    - SIZES['challenge_button_w'] / 2.0, field_y)

        # ---- feedback -------------------------------------------------------
        y += field_h + self.LINE_GAP
        self.feedback_headline.visible = bool(view.error or marking)
        if view.error:
            self._place_left(self.feedback_headline, left, y)
            self.feedback_headline.set_text(view.error)
            self.feedback_headline.set_color(RED)
            self.feedback_headline.relayout()
            y += self.feedback_headline.height_px + self.LINE_GAP
        elif marking:
            headline = (view.result.headline if view.result is not None
                        else 'WORKED SOLUTION')
            self._place_left(self.feedback_headline, left, y)
            self.feedback_headline.set_text(headline)
            self.feedback_headline.set_color(GREEN if solved else RED)
            self.feedback_headline.relayout()
            y += self.feedback_headline.height_px + self.LINE_GAP

        for sprite, sprite_h, colour in feedback_entries:
            self._place_left(sprite, left, y)
            sprite.set_color(tuple(colour))
            y += sprite_h + self.LINE_GAP

        self.footer.max_width_px = content_w
        self.footer.set_text(footer_text)
        self.footer.visible = bool(footer_text)
        if footer_text:
            self._place_left(self.footer, left, y)
            self.footer.relayout()
        for sprite in self.feedback_lines[len(feedback_entries):]:
            sprite.visible = False

    # ------------------------------------------------------------------ parts
    @staticmethod
    def _start_x(view):
        """Where the diagram draws the launch marker: the real launch point."""
        if view.path:
            return view.path[0][0]
        return view.challenge.fixed.get('position', 0.0)

    def _primary_label(self, view, solved):
        if view.solution:
            self.action = 'continue'
            return 'CONTINUE'
        if solved:
            self.action = 'continue'
            return 'NEXT CHALLENGE'
        self.action = 'bowl'
        return 'BOWL AGAIN' if view.result is not None else 'BOWL IT'

    def _footer_text(self, view, solved, marking):
        if view.solution:
            return ('The worked solution is above. Press CONTINUE for the '
                    'next challenge.')
        if view.error:
            return 'Type a number (units optional), then press ENTER.'
        if solved:
            return 'Correct - CONTINUE moves to the next challenge.'
        if marking and view.result is not None:
            return (f'{view.result.verdict}  Change the value and press ENTER '
                    f'to bowl again.')
        if marking:
            return 'Change the value and press ENTER to bowl again.'
        if view.input_text and view.challenge.control.key == 'torque':
            try:
                value = float(view.input_text)
            except ValueError:
                value = None
            if value is not None:
                derived = view.challenge.derived_text(value)
                if derived:
                    return f'{derived}  Press ENTER to bowl.'
        return ('Unlimited attempts: edit the value, press ENTER, watch the '
                'simulation.')

    def _feedback_entries(self, view, content_w, available):
        """The marked-result lines that fit, in priority order."""
        entries = []
        if view.solution:
            lines = [(f'Worked solution: {chunk}', GRAY)
                     for chunk in wrap_text(view.solution, 118)[:4]]
        elif view.result is not None:
            outcome = view.result
            lines = [(text, GRAY) for text in outcome.lines]
            challenge = view.challenge
            # A torque challenge derives the spin it produces; show the
            # mapping the engine used right under the measurement.
            if challenge.control.key == 'torque' and view.input_text:
                try:
                    value = float(view.input_text)
                except ValueError:
                    value = None
                if value is not None:
                    derived = challenge.derived_text(value)
                    if derived:
                        lines.insert(1, (derived, CYAN))
            steps = getattr(challenge, 'steps', ())
            for index in range(min(view.hints_unlocked, len(steps))):
                lines.append((f'Step {index + 1}:  {steps[index]}', AMBER))
        else:
            lines = []
        maximum = len(self.feedback_lines)
        used = 0.0
        for text, colour in lines:
            if len(entries) >= maximum:
                break
            sprite = self.feedback_lines[len(entries)]
            sprite.max_width_px = content_w
            sprite.max_lines = 2
            sprite.set_text(text)
            sprite.relayout()
            extra = sprite.height_px + (self.LINE_GAP if entries else 0.0)
            if entries and used + extra > available:
                break
            used += extra
            entries.append((sprite, sprite.height_px, colour))
        return entries
