"""Input devices. Each source produces the same ThrowData object."""

from input.base import ThrowSource
from input.classifier import SwingClassifier
from input.mouse_input import ThrowData, MouseInput
from input.swing import SwingDetector, SwingEvent
from input.webcam_input import WebcamInput, WebcamStatus

__all__ = [
    "ThrowData", "MouseInput", "ThrowSource",
    "SwingDetector", "SwingEvent", "SwingClassifier",
    "WebcamInput", "WebcamStatus",
]
