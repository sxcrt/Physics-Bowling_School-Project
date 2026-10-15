"""Compact in-game webcam feed for webcam mode.

Shows the live camera frame with the detected landmarks in the bottom-left
corner, outside the lane/pins/scorecard area. The feed is a single Panda3D
texture whose RAM image is replaced with each new camera frame
(``setRamImageAs``), which is cheap enough to run on the render thread: the
expensive capture and pose inference happen on the tracking service's worker
thread, and only one small resize/convert happens per *new* frame.

OpenCV is imported lazily so mouse-only play never pays for it, and every
failure path hides the panel instead of raising into the game loop.
"""
from panda3d.core import Texture as PandaTexture
from ursina import Entity, Texture, camera, color, window

import config

_FRAME_COLOR = (250, 250, 250)
_IDLE_COLOR = (200, 120, 60)
_TRACKED_COLOR = (80, 210, 90)
_READY_COLOR = (235, 210, 80)
_ERROR_COLOR = (220, 60, 60)
_EDGE_THICKNESS = 0.007


class WebcamPanel:
    """Bottom-left webcam feed with a status-coloured frame."""

    def __init__(self, parent=None):
        parent = parent if parent is not None else camera.ui
        # Four thin edge bars instead of one big backing quad, so the border
        # can never cover the feed regardless of draw order.
        # IMPORTANT: entities start hidden *at creation time*. A UI quad that
        # is accidentally left visible defaults to fullscreen size in Ursina's
        # UI space, which would cover the whole game.
        self._edges = [
            Entity(parent=parent, model='quad', visible=False,
                   color=color.rgb32(*_IDLE_COLOR))
            for _ in range(4)
        ]
        self._feed = Entity(parent=parent, model='quad', visible=False,
                            color=color.white)
        self._panda_texture = None
        self._texture_size = (0, 0)
        self._last_frame_count = -1
        self._visible = None          # unknown, so the first call applies
        self._set_visible(False)
        self._place()                 # safe corner geometry from the start

    # --------------------------------------------------------------- public
    def update(self, snapshot, status, visible):
        """Refresh the feed from the latest tracking snapshot (once per frame)."""
        if not visible or snapshot is None or snapshot.frame is None:
            self._set_visible(False)
            return
        if snapshot.frame_count == self._last_frame_count:
            self._place()          # keep the panel anchored on window resize
            return
        self._last_frame_count = snapshot.frame_count
        prepared = self._prepare(snapshot)
        if prepared is None:
            self._set_visible(False)
            return
        rgb, size = prepared
        self._ensure_texture(size)
        self._panda_texture.setRamImageAs(rgb, 'RGB')
        self._set_visible(True)
        self._set_edge_color(self._status_color(snapshot, status))
        self._place()

    # ------------------------------------------------------------ internal
    def _set_visible(self, visible):
        if visible == self._visible:
            return
        self._visible = visible
        self._feed.visible = visible
        for edge in self._edges:
            edge.visible = visible

    def _prepare(self, snapshot):
        """Resize / mirror / annotate one camera frame into RGB bytes."""
        try:
            import cv2
        except ImportError:
            return None
        frame = snapshot.frame
        try:
            height, width = frame.shape[:2]
            target_w = config.WEBCAM_PANEL_FEED_WIDTH
            target_h = max(1, int(round(target_w * height / width)))
            small = cv2.resize(frame, (target_w, target_h),
                               interpolation=cv2.INTER_AREA)
            if config.WEBCAM_MIRROR:
                small = cv2.flip(small, 1)
            if snapshot.tracked and snapshot.landmarks:
                try:
                    from tracking import overlay
                    overlay.draw_pose(small, snapshot.landmarks,
                                      mirror=config.WEBCAM_MIRROR)
                except Exception:
                    pass    # annotation must never break the game loop
            # BGR -> RGB and vertical flip (Panda textures start bottom-left).
            return small[::-1, :, ::-1].tobytes(), (target_w, target_h)
        except Exception:
            return None

    def _ensure_texture(self, size):
        if self._panda_texture is not None and self._texture_size == size:
            return
        texture = PandaTexture('webcam-feed')
        texture.setup_2d_texture(size[0], size[1],
                                 PandaTexture.TUnsignedByte, PandaTexture.FRgb)
        texture.setMagfilter(PandaTexture.FTLinear)
        texture.setMinfilter(PandaTexture.FTLinear)
        self._panda_texture = texture
        self._texture_size = size
        self._feed.texture = Texture(texture)

    @staticmethod
    def _status_color(snapshot, status):
        if status is not None and status.error:
            return _ERROR_COLOR
        if snapshot.tracked:
            if status is not None and status.phase == 'ready':
                return _READY_COLOR
            return _TRACKED_COLOR
        return _IDLE_COLOR

    def _set_edge_color(self, rgb):
        for edge in self._edges:
            edge.color = color.rgb32(*rgb)

    def _place(self):
        aspect = window.aspect_ratio
        width = config.WEBCAM_PANEL_WIDTH
        if self._texture_size[0]:
            height = width * self._texture_size[1] / self._texture_size[0]
        else:
            height = width * 0.5625
        margin = config.WEBCAM_PANEL_MARGIN
        thickness = _EDGE_THICKNESS
        x = -aspect / 2 + margin + width / 2
        y = -0.5 + config.WEBCAM_PANEL_BOTTOM + height / 2

        self._feed.position = (x, y)
        self._feed.scale = (width, height)

        half_w = width / 2 + thickness
        half_h = height / 2 + thickness
        self._edges[0].position = (x, y + half_h)
        self._edges[0].scale = (2 * half_w, thickness)
        self._edges[1].position = (x, y - half_h)
        self._edges[1].scale = (2 * half_w, thickness)
        self._edges[2].position = (x - half_w, y)
        self._edges[2].scale = (thickness, 2 * half_h)
        self._edges[3].position = (x + half_w, y)
        self._edges[3].scale = (thickness, 2 * half_h)
