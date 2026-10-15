"""Common interface for ball-throw input sources.

``MouseInput`` and ``WebcamInput`` both implement this protocol by turning
their device's motion into ``ThrowData``, so the physics and scoring layers
never need to know which device produced a throw. Swing recognition lives in
``input.swing``; the webcam adapter in ``input.webcam_input`` maps recognized
swings onto the same ``ThrowData`` the mouse produces.
"""
from typing import Optional, Protocol, runtime_checkable

from input.mouse_input import ThrowData


@runtime_checkable
class ThrowSource(Protocol):
    """Anything that can aim and throw the ball."""

    lateral: float          # current lateral position at the foul line (m)

    def update(self) -> None:
        """Advance the input state by one frame."""

    @property
    def throw_data(self) -> Optional[ThrowData]:
        """Return the pending throw once, or None if none is waiting."""

    def discard_pending(self) -> None:
        """Drop any queued throw (called when a new roll is set up)."""
