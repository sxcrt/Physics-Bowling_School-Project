"""Text fitting and wrapping helpers shared by the menus and the HUD.

``Text.width`` is measured by building a temporary Panda3D text node, so it is
far too expensive to call for every label on every frame. This module caches
the measurement per (entity, content, window size) and hands back the scale
that keeps a line inside its panel, which is what lets the HUD adapt to any
window size without clipping or per-frame layout cost.

:func:`wrap_text` splits a paragraph into lines of at most ``width`` characters
so a long problem statement can be laid out line by line instead of being
shrunk until it is unreadable.
"""
from ursina import window

_CACHE = {}


def _window_key():
    return (round(window.aspect_ratio, 4), round(window.size[0], 1),
            round(window.size[1], 1))


def fit_text(text_entity, content, max_scale, max_width, min_scale=0.35):
    """Set ``content`` and the largest scale that keeps it within ``max_width``.

    Returns the rendered height of the line in UI units.
    """
    key = (id(text_entity), content, round(max_width, 5))
    entry = _CACHE.get(key)
    if entry is None or entry[0] != _window_key():
        if text_entity.text != content:
            text_entity.text = content
        width = text_entity.width
        scale = max_scale if width <= 0 else min(max_scale, max_width / width)
        scale = max(min_scale, scale)
        entry = (_window_key(), scale)
        _CACHE[key] = entry
    text_entity.scale = entry[1]
    return text_entity.height * entry[1]


def wrap_text(text, width):
    """Wrap ``text`` into lines of at most ``width`` characters.

    Words longer than the width are kept whole (they are part of a formula or a
    unit, and splitting them mid-token would be worse than a wide line).
    """
    lines = []
    current = ''
    for word in str(text).split():
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= width:
            current += ' ' + word
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines
