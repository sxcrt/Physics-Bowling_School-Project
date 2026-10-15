// Compact in-game webcam feed (ported from ui/webcam_panel.py). The <video>
// element is shown directly (mirrored) with a canvas landmark overlay.
import * as config from '../config.js';
import { div } from './dom.js';

const IDLE_COLOR = [200, 120, 60];
const TRACKED_COLOR = [80, 210, 90];
const READY_COLOR = [235, 210, 80];
const ERROR_COLOR = [220, 60, 60];

const SKELETON = [
  ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'], ['left_wrist', 'left_index'], ['left_wrist', 'left_pinky'],
  ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
  ['right_wrist', 'right_index'], ['right_wrist', 'right_pinky'],
  ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'], ['left_hip', 'left_knee'], ['right_hip', 'right_knee'],
  ['left_knee', 'left_ankle'], ['right_knee', 'right_ankle'],
];

export class WebcamPanel {
  constructor(parent) {
    this.root = div('webcam-panel', parent);
    this.root.style.position = 'absolute';
    this.root.style.display = 'none';
    this.root.style.borderRadius = '6px';
    this.root.style.overflow = 'hidden';
    this.root.style.border = `3px solid ${cssColor(IDLE_COLOR)}`;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.style.cssText = 'display:block;width:100%;height:100%;transform:scaleX(-1);';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;transform:scaleX(-1);';
    this.root.appendChild(this.video);
    this.root.appendChild(this.canvas);
    this._lastFrameCount = -1;
    this._visible = false;
    this._setVisible(false);
    this._place();
  }

  _setVisible(visible) {
    if (visible === this._visible) return;
    this._visible = visible;
    this.root.style.display = visible ? 'block' : 'none';
  }

  update(snapshot, status, visible) {
    if (!visible || !snapshot || !snapshot.frame) { this._setVisible(false); return; }
    if (snapshot.frame_count !== this._lastFrameCount) {
      this._lastFrameCount = snapshot.frame_count;
      if (this.video.srcObject !== snapshot.frame.srcObject) {
        this.video.srcObject = snapshot.frame.srcObject;
        this.video.play().catch(() => {});
      }
      this._drawOverlay(snapshot);
    }
    this._setVisible(true);
    this.root.style.borderColor = cssColor(this._statusColor(snapshot, status));
    this._place();
  }

  _drawOverlay(snapshot) {
    const frame = snapshot.frame;
    if (!frame) return;
    const width = config.WEBCAM_PANEL_FEED_WIDTH;
    const height = Math.max(1, Math.round(width * (frame.videoHeight || 480) / (frame.videoWidth || 640)));
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    if (!snapshot.tracked || !snapshot.landmarks) return;
    ctx.strokeStyle = 'rgba(96,226,255,0.9)';
    ctx.lineWidth = 2;
    for (const [a, b] of SKELETON) {
      const la = snapshot.landmarks[a], lb = snapshot.landmarks[b];
      if (!la || !lb) continue;
      ctx.beginPath();
      ctx.moveTo(la.x * width, la.y * height);
      ctx.lineTo(lb.x * width, lb.y * height);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,214,130,0.95)';
    for (const name of ['left_wrist', 'right_wrist', 'left_elbow', 'right_elbow']) {
      const lm = snapshot.landmarks[name];
      if (!lm) continue;
      ctx.beginPath();
      ctx.arc(lm.x * width, lm.y * height, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _statusColor(snapshot, status) {
    if (status && status.error) return ERROR_COLOR;
    if (snapshot.tracked) return status && status.phase === 'ready' ? READY_COLOR : TRACKED_COLOR;
    return IDLE_COLOR;
  }

  _place() {
    const width = config.WEBCAM_PANEL_WIDTH * 720;
    const ratio = this.video.videoWidth ? this.video.videoHeight / this.video.videoWidth : 0.5625;
    const height = width * ratio;
    this.root.style.left = `${config.WEBCAM_PANEL_MARGIN * 720}px`;
    this.root.style.bottom = `${config.WEBCAM_PANEL_BOTTOM * 720}px`;
    this.root.style.width = `${width}px`;
    this.root.style.height = `${height}px`;
  }
}

function cssColor(rgb) { return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; }
