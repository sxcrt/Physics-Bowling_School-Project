"""Dump the Python reference behaviour of the webcam swing pipeline.

This is the webcam counterpart of ``tools/fidelity_dump.py``: it feeds a set of
recorded and synthetic landmark sequences through the *original* Python
``input.swing.SwingDetector`` and ``input.webcam_input.event_to_throw`` and
writes a per-frame trace plus the recognised swings and the throws they map to.

    python tools/webcam_parity_dump.py tools/webcam_parity_py.json
    node   tools/webcam_parity_run.mjs  tools/webcam_parity_js.json
    node   tools/webcam_parity_compare.mjs tools/webcam_parity_py.json tools/webcam_parity_js.json

``tools/js_tests.mjs`` also replays the same file through the browser detector,
so a divergence in the ported detector, the velocity/state arithmetic or the
event -> ThrowData mapping fails without a camera.

Sequences cover the cases the acceptance criteria name: valid swings at
different speeds, left/right hooks and straight releases, a short swing, plus
the negative cases (standing still, leaning, walking, waving, occlusion,
tracking loss, arm switching and repeated swings). Input landmarks are integer-
free floats, so both languages parse bit-identical doubles.
"""
import json
import math
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))

import config  # noqa: E402
from input.swing import SwingDetector  # noqa: E402
from input.webcam_input import event_to_throw  # noqa: E402
from tracking.pose import Landmark, PoseResult  # noqa: E402

ARMS = ('right', 'left')
FPS = 30.0
DT = 1.0 / FPS

# Every landmark the swing pipeline can read (torso, arms, hands, knees), in a
# fixed order so the fixture stays compact and stable.
KEEP = (
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_index', 'left_pinky', 'left_thumb',
    'right_index', 'right_pinky', 'right_thumb',
    'left_hip', 'right_hip', 'left_knee', 'right_knee',
)


def pose_result(landmarks, tracked=True):
    """Wrap raw landmark dicts in the detector's PoseResult contract."""
    if not tracked or not landmarks:
        return PoseResult(landmarks={}, confidence=0.0, tracked=False, timestamp=0.0)
    total = 0.0
    for name in ('left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
                 'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
                 'left_knee', 'right_knee'):
        landmark = landmarks.get(name)
        if landmark is not None:
            total += landmark.visibility
    return PoseResult(landmarks=dict(landmarks), confidence=total / 10.0,
                      tracked=tracked, timestamp=0.0)


def scene(body_x=0.5, shoulder_y=0.40, hip_y=0.65, right_hand=(0.62, 0.62),
          left_hand=(0.38, 0.62), visibility=0.97,
          right_wrist_visibility=None, left_wrist_visibility=None,
          right_hand_visibility=None, left_hand_visibility=None):
    """A full upper-body pose with both hands placed explicitly.

    Shoulders/hips/knees are placed around ``body_x`` so the torso is
    measured exactly as the detector expects; elbows sit halfway to the hand
    (slightly outwards), and the finger landmarks sit next to the wrist so the
    wrist-to-hand fallback measures the same point. Visibility overrides let a
    sequence occlude one wrist, one hand or the whole body.
    """
    wrist_visibility = {
        'right': visibility if right_wrist_visibility is None else right_wrist_visibility,
        'left': visibility if left_wrist_visibility is None else left_wrist_visibility,
    }
    hand_visibility = {
        'right': visibility if right_hand_visibility is None else right_hand_visibility,
        'left': visibility if left_hand_visibility is None else left_hand_visibility,
    }
    half = 0.13
    points = {
        'left_shoulder': (body_x - half, shoulder_y),
        'right_shoulder': (body_x + half, shoulder_y),
        'left_hip': (body_x - 0.10, hip_y),
        'right_hip': (body_x + 0.10, hip_y),
        'left_knee': (body_x - 0.10, hip_y + 0.25),
        'right_knee': (body_x + 0.10, hip_y + 0.25),
    }
    visibility_by_name = {}
    for arm, (hand_x, hand_y) in (('right', right_hand), ('left', left_hand)):
        shoulder = points[f'{arm}_shoulder']
        elbow_x = shoulder[0] + 0.45 * (hand_x - shoulder[0]) + 0.05
        elbow_y = shoulder[1] + 0.55 * (hand_y - shoulder[1])
        points[f'{arm}_elbow'] = (elbow_x, elbow_y)
        points[f'{arm}_wrist'] = (hand_x, hand_y)
        points[f'{arm}_index'] = (hand_x + 0.018, hand_y + 0.012)
        points[f'{arm}_pinky'] = (hand_x - 0.020, hand_y + 0.020)
        points[f'{arm}_thumb'] = (hand_x + 0.004, hand_y - 0.022)
        visibility_by_name[f'{arm}_wrist'] = wrist_visibility[arm]
        for finger in ('index', 'pinky', 'thumb'):
            visibility_by_name[f'{arm}_{finger}'] = hand_visibility[arm]
    landmarks = {}
    for name, (x, y) in points.items():
        landmarks[name] = Landmark(
            x=float(x), y=float(y), z=0.0,
            visibility=float(visibility_by_name.get(name, visibility)))
    return landmarks


def ready_frames(count, **kwargs):
    return [scene(**kwargs) for _ in range(count)]


def swing_frames(start_y=0.62, deep_y=0.88, top_y=0.20, start_x=0.62,
                 back_steps=6, forward_steps=9, hook=0.0, **kwargs):
    """A full backswing -> forward swing -> release arc for the right hand."""
    frames = []
    for step in range(1, back_steps + 1):
        y = start_y + (deep_y - start_y) * step / back_steps
        frames.append(scene(right_hand=(start_x, y), **kwargs))
    for step in range(1, forward_steps + 1):
        fraction = step / forward_steps
        y = deep_y + (top_y - deep_y) * fraction
        x = start_x + hook * fraction
        frames.append(scene(right_hand=(x, y), **kwargs))
    return frames


def build_sequences():
    """The named landmark sequences every implementation is run against."""
    sequences = {}

    sequences['still'] = ready_frames(90)

    lean = ready_frames(15)
    for index in range(75):
        sway = 0.05 * math.sin(index / 6.0)
        crouch = 0.02 * math.sin(index / 9.0)
        lean.append(scene(body_x=0.5 + sway, shoulder_y=0.40 + crouch,
                          hip_y=0.65 + crouch))
    sequences['lean'] = lean

    walk = []
    for index in range(90):
        body_x = 0.5 + 0.22 * math.sin(index / 12.0)
        bob = 0.012 * math.sin(index / 4.0)
        walk.append(scene(body_x=body_x, shoulder_y=0.40 + bob, hip_y=0.65 + bob))
    sequences['walk'] = walk

    # Casual waving: the hands stay up around chest/face height and swing side
    # to side, so the ready pose is never armed and nothing may be released
    # (this is what real waving looks like - see the recorded wave fixture).
    wave = []
    for index in range(75):
        lift = 0.05 * math.sin(index / 3.1)
        wave.append(scene(right_hand=(0.64 + 0.09 * math.sin(index / 2.6),
                                      0.44 - lift),
                          left_hand=(0.36 - 0.09 * math.sin(index / 2.6),
                                     0.44 - lift)))
    sequences['wave'] = wave

    sequences['swing_straight'] = ready_frames(20) + swing_frames()
    sequences['swing_slow'] = ready_frames(20) + swing_frames(
        top_y=0.26, forward_steps=12)
    sequences['swing_fast'] = ready_frames(20) + swing_frames(
        top_y=0.16, forward_steps=6)
    # The hand drifts across the body while it rises: a left hook (image left)
    # and the mirrored right hook.
    sequences['swing_hook_left'] = ready_frames(20) + swing_frames(hook=-0.16)
    sequences['swing_hook_right'] = ready_frames(20) + swing_frames(hook=0.16)

    short = ready_frames(20)
    for y in (0.58, 0.52, 0.46, 0.40, 0.34, 0.28, 0.24):
        short.append(scene(right_hand=(0.62, y)))
    sequences['swing_short'] = short

    # The wrist vanishes mid-backswing; the finger landmarks still exist, so
    # the detector must fall back to them without breaking the swing.
    occluded = ready_frames(20) + swing_frames()
    for index in range(24, 28):
        occluded[index] = scene(
            right_hand=(0.62, [0.66, 0.70, 0.74, 0.78][index - 24]),
            right_wrist_visibility=0.05)
    sequences['occlusion'] = occluded

    # Tracking drops out mid-forward-swing: the swing must abort, not release.
    lost = ready_frames(20) + swing_frames()
    lost_frames = []
    for index, landmarks in enumerate(lost):
        if 30 <= index < 44:
            lost_frames.append(pose_result({}, tracked=False))
        else:
            lost_frames.append(pose_result(landmarks))
    sequences['tracking_lost'] = lost_frames

    repeated = ready_frames(20)
    for _ in range(3):
        repeated += swing_frames()
        repeated += ready_frames(30)
    sequences['repeated'] = repeated

    # Two throws, the second with the *left* arm (auto selection must follow
    # the moving arm and keep each swing's own history).
    first = ready_frames(20) + swing_frames()
    hold = []
    for index in range(30):
        hold.append(scene(right_hand=(0.62, 0.62), left_hand=(0.38, 0.62)))
    second = []
    start_x = 0.38
    for step in range(1, 7):
        y = 0.62 + (0.88 - 0.62) * step / 6
        second.append(scene(left_hand=(start_x, y)))
    for step in range(1, 10):
        fraction = step / 9
        second.append(scene(left_hand=(start_x + 0.10 * fraction,
                                       0.88 + (0.20 - 0.88) * fraction)))
    sequences['arm_switch'] = first + hold + second

    return sequences


def load_fixture(name, tools_dir):
    path = tools_dir / name
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding='utf-8'))
    names = data['landmarks']
    frames = []
    for entry in data['frames']:
        if not entry['t'] or entry['l'] is None:
            frames.append(pose_result({}, tracked=False))
            continue
        count = len(names)
        landmarks = {}
        for index, name in enumerate(names):
            x = entry['l'][index]
            if x is None:
                continue
            landmarks[name] = Landmark(x=float(x), y=float(entry['l'][count + index]),
                                       z=0.0,
                                       visibility=float(entry['l'][2 * count + index]))
        frames.append(pose_result(landmarks, tracked=True))
    return {'fps': float(data.get('fps') or FPS), 'frames': frames}


def trace_row(detector, event, time):
    """One comparable row of detector state (attribute names match the port)."""
    arms = {}
    for arm in ARMS:
        smooth = detector._smooth.get(arm)
        arms[arm] = {
            'sx': None if smooth is None else smooth[0],
            'sy': None if smooth is None else smooth[1],
            'vel': detector._vel[arm],
            'raw': detector._raw_vel[arm],
            'lat': detector._lateral_vel[arm],
            'src': detector._hand_source[arm],
        }
    depth = 0.0
    if detector._swing_arm is not None and detector._torso_height > 0.0:
        depth = max(0.0, (detector._backswing_deepest_rel
                          - detector._swing_start_rel) / detector._torso_height)
    return {
        't': time,
        'phase': detector.phase,
        'arm': detector._swing_arm,
        'rise': detector._rise,
        'peak': detector._peak_up_speed,
        'depth': depth,
        'torso': detector._torso_height,
        'pose': detector.swing_pose,
        'hint': detector.hint,
        'arms': arms,
        'event': None if event is None else event_fields(event),
    }


def event_fields(event):
    return {
        'up_speed': event.up_speed, 'body_x': event.body_x, 'arm': event.arm,
        'duration': event.duration, 'time': event.time,
        'release_speed': event.release_speed, 'rise': event.rise,
        'depth': event.depth, 'confidence': event.confidence,
        'hand_source': event.hand_source, 'lateral_speed': event.lateral_speed,
        'hand_offset': event.hand_offset,
    }


def throw_fields(throw):
    return {
        'lateral_position': throw.lateral_position,
        'launch_angle': throw.launch_angle,
        'speed': throw.speed,
        'spin_omega': throw.spin_omega,
        'source': throw.source,
        'confidence': throw.confidence,
    }


def run_sequence(frames, dt):
    detector = SwingDetector()
    trace = []
    events = []
    throws = []
    for index, result in enumerate(frames):
        event = detector.update(result, dt)
        if event is not None:
            events.append({'frame': index, **event_fields(event)})
            throws.append({'frame': index, **throw_fields(event_to_throw(event))})
        trace.append(trace_row(detector, event, detector._time))
    return trace, events, throws, detector


def main():
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else PROJECT / 'tools' / 'webcam_parity_py.json'
    tools_dir = PROJECT / 'tools'
    sequences = {}

    for name, frames in build_sequences().items():
        sequences[name] = {'fps': FPS, 'kind': 'synthetic', 'frames': frames}

    for fixture_name, sequence_name in (('webcam_landmarks.json', 'recorded_swing'),
                                        ('webcam_wave_landmarks.json', 'recorded_wave')):
        fixture = load_fixture(fixture_name, tools_dir)
        if fixture is None:
            print(f'  (tools/{fixture_name} missing; skipped)')
            continue
        sequences[sequence_name] = {
            'fps': fixture['fps'], 'kind': 'recorded', 'frames': fixture['frames'],
        }

    payload = {'version': 1, 'landmarks': list(KEEP), 'dt': DT, 'sequences': {}}
    summary = []
    for name, sequence in sequences.items():
        frames = [frame if isinstance(frame, PoseResult) else pose_result(frame)
                  for frame in sequence['frames']]
        dt = 1.0 / (sequence['fps'] or 30.0)
        # Serialise the landmarks with full float precision so the browser
        # parses the identical doubles.
        serialised = []
        for result in frames:
            if not result.tracked or not result.landmarks:
                serialised.append(None)
                continue
            serialised.append([
                [result.landmarks[name].x, result.landmarks[name].y,
                 result.landmarks[name].visibility] if name in result.landmarks else None
                for name in KEEP
            ])
        trace, events, throws, detector = run_sequence(frames, dt)
        payload['sequences'][name] = {
            'fps': sequence['fps'],
            'kind': sequence['kind'],
            'landmarks': serialised,
            'trace': trace,
            'events': events,
            'throws': throws,
            'counters': {
                'rejected': detector.rejected_count,
                'lost': detector.lost_count,
                'releases': detector.release_count,
                'aborts': detector.abort_count,
            },
        }
        summary.append((name, len(frames), len(events), len(throws)))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
    print(f'{out_path}: {len(payload["sequences"])} sequences')
    for name, frames, events, throws in summary:
        print(f'  {name:20s} frames={frames:4d} releases={events} throws={throws}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
