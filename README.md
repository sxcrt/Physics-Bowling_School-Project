# Hells Balls

An original motion-controlled 3D physics bowling game. It features a real
rigid-body bowling simulation, USBC ten-frame scoring, six game modes, mouse
**and** webcam (MediaPipe pose) input, an original procedural bowler avatar, a
Physics Lab, and audio synthesised with the Python standard library.

**The game runs in the browser.** Open the deployed site and play — nothing to
download or install. See `MIGRATION.md` for how the original native build was
migrated and what was verified.

---

## Play

The site is a static web app (no build step):

* deployed: your Vercel project's domain (see *Deploy* below);
* locally: any static server from the repository root, e.g.
  `python tools/serve.py 8124` and then <http://127.0.0.1:8124/>.

The first click also unlocks audio (browser autoplay policy).

### Controls

* **Mouse** (default): move the pointer to aim, `A`/`D` to slide the ball
  across the lane, drag back and stroke forward to throw (a sideways stroke adds
  hook).
* **Webcam**: press `TAB` to toggle webcam mode (or `1`/`2`), `C` to cycle the
  throwing arm.
* **Menus**: mouse, or arrow keys + `ENTER` (`ESC` backs out).
* `ESC` pauses, `R` re-stands the rack before a throw, `H` shows/hides the
  physics readout, `F12` saves a screenshot.

### Game modes

Classic Bowling · Physics Trivia · Equation Challenge · Player vs Bot ·
Local Multiplayer (2–4 players) · BowlRush.

---

## Deploy to Vercel (with automatic GitHub deployments)

1. Push this repository to GitHub.
2. In Vercel: **Add New… → Project**, import the repository.
3. Leave the framework preset as **Other** / *No framework*. `vercel.json`
   already sets `"framework": null` and `"outputDirectory": "."`, so Vercel
   serves the repository as a static site with no build command.
4. Deploy. Every push to the production branch then deploys automatically, and
   every pull request gets a preview URL.

No environment variables or build settings are required. Webcam mode loads the
MediaPipe pose model from `assets/models/pose_landmarker_lite.task` (already in
the repository) and its WebAssembly runtime from a CDN the first time webcam
mode is entered.

---

## Repository layout

| Path | Purpose |
| --- | --- |
| `index.html`, `src/` | **the browser game** (ES modules + Three.js) |
| `assets/` | audio WAVs and the MediaPipe pose model, shared by both builds |
| `physics.py`, `scoring.py` | the original Python simulation + scoring (pure, no engine imports) |
| `scene/`, `ui/`, `avatar/`, `motion/`, `input/`, `tracking/`, `game/` | the original Python desktop build |
| `tests/` | the original Python test suite |
| `tools/` | packaging + the migration's verification tools |
| `web/` | the earlier static landing page |
| `docs/` | the original development report, physics notes, screenshots |
| `MIGRATION.md` | the browser migration report: decisions, checklist, tests, differences |
| `vercel.json` | static deployment configuration |

## Deploying the original desktop build

The Python game is unchanged and still runs from source:

```bash
pip install -r requirements.txt
python main.py
```

and can be packaged into a standalone Windows executable with
`python tools/package.py` (see the original `README` section below).

## Verification

The browser physics, scoring, challenge bank and question marking are diffed
against the original Python implementations, and the browser logic has its own
regression suite (scoring, session, input models, swing detector, physics
vs. the Python fixtures):

```bash
node tools/js_tests.mjs   # browser logic regression suite

python tools/fidelity_dump.py  tools/physics_py.json
node   tools/fidelity_run.mjs  tools/physics_js.json
node   tools/fidelity_compare.mjs tools/physics_py.json tools/physics_js.json

python tools/fidelity_dump2.py tools/logic_py.json
node   tools/fidelity_run2.mjs tools/logic_js.json
node   tools/fidelity_compare2.mjs tools/logic_py.json tools/logic_js.json
```

The original Python suite still applies to the Python build:

```bash
python -m pytest tests -q
```

---

## Original desktop build notes

* **Requirements**: Python 3.12–3.14 (verified on 3.14.7), a desktop machine
  with OpenGL, and a webcam for webcam input mode.
* **Run**: `pip install -r requirements.txt` then `python main.py`.
* The first webcam use downloads the MediaPipe pose model (~6 MB) or uses the
  bundled copy at `assets/models/pose_landmarker_lite.task`.
* `docs/REPORT.md`, `docs/PHYSICS.md`, `docs/MODES.md`, `docs/INPUT.md`,
  `docs/TESTING.md` and `docs/VISUALS.md` describe the original game in detail.
* Building a standalone executable: `python -m pip install setuptools` then
  `python tools/package.py`; the bundle lands in `build/win_amd64/`.
