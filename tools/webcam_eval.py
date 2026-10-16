"""Replay the labeled webcam evaluation traces through the Python classifier.

    node   tools/webcam_eval.mjs --export tools/webcam_eval_sequences.json
    python tools/webcam_eval.py tools/webcam_eval_sequences.json
    python tools/webcam_eval.py tools/webcam_eval_sequences.json --json report_py.json

The trace file is exported from tools/webcam_eval_data.mjs, so the JavaScript
and Python classifiers are verified against the *same* labeled expectations
instead of against each other. Every sequence carries `kind` ('synthetic' or
'recorded-human') and `expect` (the number of releases the movement should
produce). There is no recorded genuine bowling footage in this repository; the
recorded-human entries are the two negative motions (jumping jacks/burpees and
waving).

Exit status is 1 when any sequence releases the wrong number of times.
"""
import json
import math
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT))

from input.classifier import SwingClassifier  # noqa: E402
from tracking.pose import Landmark, PoseResult  # noqa: E402


def frame_result(entry, landmarks):
    if entry is None:
        return PoseResult(landmarks={}, confidence=0.0, tracked=False, timestamp=0.0)
    points = {}
    for name, values in zip(landmarks, entry.get('l') or []):
        if values is None:
            continue
        points[name] = Landmark(x=float(values[0]), y=float(values[1]), z=0.0,
                                visibility=float(values[2]), presence=1.0)
    return PoseResult(landmarks=points,
                      confidence=float(entry.get('c', 0.95)),
                      tracked=True, timestamp=0.0)


def run_sequence(sequence, names):
    classifier = SwingClassifier()
    fps = float(sequence.get('fps') or 30.0)
    events = []
    phases = []
    last_phase = None
    max_depth = max_rise = max_peak = 0.0
    for index, entry in enumerate(sequence['frames']):
        dt = float(entry.get('dt')) if entry and entry.get('dt') else 1.0 / fps
        event = classifier.update(frame_result(entry, names), dt)
        telemetry = classifier.telemetry
        max_depth = max(max_depth, telemetry['depth'])
        max_rise = max(max_rise, telemetry['rise'])
        max_peak = max(max_peak, telemetry['peak_up'])
        if event is not None:
            events.append({'frame': index, 'arm': event.arm,
                           'up_speed': event.up_speed, 'rise': event.rise,
                           'depth': event.depth, 'hand_source': event.hand_source})
        if classifier.phase != last_phase:
            phases.append({'phase': classifier.phase, 'frame': index})
            last_phase = classifier.phase
    return {
        'events': events, 'phases': phases,
        'max_depth': round(max_depth, 3), 'max_rise': round(max_rise, 3),
        'max_peak': round(max_peak, 3),
        'last_reject_reason': classifier.last_reject_reason,
        'counters': {
            'releases': classifier.release_count,
            'blocked': classifier.blocked_count,
            'aborts': classifier.abort_count,
            'rejects': classifier.rejected_count,
            'lost': classifier.lost_count,
        },
    }


def main():
    source = (Path(sys.argv[1]) if len(sys.argv) > 1
              else PROJECT / 'tools' / 'webcam_eval_sequences.json')
    payload = json.loads(source.read_text(encoding='utf-8'))
    names = payload['landmarks']
    results = []
    tp = fp = tn = fn = 0
    for sequence in payload['sequences']:
        run = run_sequence(sequence, names)
        expected = int(sequence['expect'])
        got = len(run['events'])
        passed = got == expected
        if expected > 0:
            if got > 0:
                tp += 1
            else:
                fn += 1
        elif got > 0:
            fp += 1
        else:
            tn += 1
        results.append({'name': sequence['name'], 'kind': sequence['kind'],
                        'motion': sequence['motion'], 'expected': expected,
                        'got': got, 'pass': passed, **run})
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    print(f'webcam classifier evaluation (Python): {len(results)} sequences')
    print('')
    print(f"{'sequence':<28} {'kind':<15} {'motion':<16} exp got  result")
    for r in results:
        print(f"{r['name']:<28} {r['kind']:<15} {r['motion']:<16}"
              f" {r['expected']:>3} {r['got']:>3}  {'pass' if r['pass'] else 'FAIL'}")
    print('')
    print(f'positives detected: {tp}   false negatives: {fn}')
    print(f'false positives: {fp}   true negatives: {tn}')
    print(f'precision {precision * 100:.1f}%  recall {recall * 100:.1f}%  f1 {f1 * 100:.1f}%')
    failed = [r for r in results if not r['pass']]
    if failed:
        print('')
        print(f'FAILURES ({len(failed)}):')
        for r in failed:
            print(f"- {r['name']}: expected {r['expected']}, got {r['got']}"
                  f"  releases={r['events']}  blocked={r['counters']['blocked']}"
                  f" aborts={r['counters']['aborts']} rejects={r['counters']['rejects']}"
                  f" lost={r['counters']['lost']}"
                  f"{'  last reject: ' + r['last_reject_reason'] if r['last_reject_reason'] else ''}")
    if '--json' in sys.argv:
        out = Path(sys.argv[sys.argv.index('--json') + 1])
        out.write_text(json.dumps({
            'classifier': 'input/classifier.py',
            'source': str(source),
            'totals': {'tp': tp, 'fp': fp, 'tn': tn, 'fn': fn,
                       'precision': precision, 'recall': recall, 'f1': f1},
            'results': results,
        }, indent=2), encoding='utf-8')
        print(f'wrote {out}')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
