# Webcam test media

Real-person footage used to build the deterministic landmark fixtures in
`tools/webcam_landmarks.json` and `tools/webcam_wave_landmarks.json` (see
`tools/export_landmarks.py`). The recorded landmark traces - not the videos -
are what the automated tests consume, so the videos are only needed to
regenerate the fixtures.

| File | Source | Licence |
| --- | --- | --- |
| `jumping_jacks_burpees.webm` | Wikimedia Commons, [Jumping jacks and burpees](https://commons.wikimedia.org/wiki/File:Jumping_jacks_and_burpees.webm) by Taco fleur | CC BY-SA 4.0 |
| `handwave.webm` | Wikimedia Commons, [HandWaveExample](https://commons.wikimedia.org/wiki/File:HandWaveExample.webm) by NMu11er | CC BY-SA 4.0 |

Regenerate a fixture with:

```
python tools/export_landmarks.py tools/testdata/<video> <start_frame> <end_frame> tools/<fixture>.json
```

The export runs the same pose model the browser uses, stores the landmarks the
swing pipeline reads, and records the Python reference detector's phase
timeline and releases so `node tools/js_tests.mjs` can assert the browser
detector reproduces them.
