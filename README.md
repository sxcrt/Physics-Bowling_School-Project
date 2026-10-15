# Hells Balls

An original motion-controlled 3D physics bowling game built with
[Ursina](https://www.ursinaengine.org/) (which wraps Panda3D). It features a
real rigid-body bowling simulation, USBC ten-frame scoring, six game modes,
mouse **and** webcam (MediaPipe pose) input, an original procedural bowler
avatar, and audio synthesised entirely with the Python standard library.

---

> **Important — this is a native desktop game.**
> It runs from `python main.py` on your own machine. It does **not** run in a
> web browser and cannot be hosted as a web application on Vercel or any
> serverless platform:
>
> * Panda3D needs a real window and an OpenGL/GPU context (no serverless
>   runtime provides one, and Vercel functions are CPU-only and time-limited).
> * The webcam stack (OpenCV `cv2.VideoCapture` + MediaPipe) has no browser or
>   WebAssembly build.
> * Ursina has no web export at all.
>
> The `web/` folder in this repo is only a **landing page** (deployed to
> Vercel) that links to the game. See `docs/REPORT.md` and `docs/TESTING.md`
> for the full development report.

---

## Requirements

* Python 3.12–3.14 (developed and verified on 3.14.7)
* A desktop machine with OpenGL support (any modern machine)
* A webcam (optional — only needed for webcam input mode)

## Run

```bash
pip install -r requirements.txt
python main.py
```

The first webcam use downloads the MediaPipe pose model (~6 MB) automatically,
or it is bundled at `assets/models/pose_landmarker_lite.task`.

## Controls

* **Mouse** (default): move the pointer to aim, `A`/`D` to slide the ball
  across the lane, drag-and-release to throw (sideways drag adds hook).
* **Webcam**: press `TAB` to toggle webcam mode (or `1`/`2`), `C` to cycle the
  throwing arm.
* **Menus**: mouse, or arrow keys + `ENTER` (`ESC` backs out).

## Game modes

Classic Bowling · Physics Trivia · Equation Challenge · Player vs Bot ·
Local Multiplayer (2–4 players) · BowlRush.

## Project layout

| Path | Purpose |
| --- | --- |
| `physics.py`, `scoring.py` | pure-Python simulation + ten-pin scoring (no engine imports) |
| `scene/` | lane, pins, ball, camera, custom GLSL surface shader |
| `ui/` | menus, HUD, overlays, Physics Lab |
| `avatar/` | the procedural bowler character |
| `motion/` | tween/timeline animation system |
| `game/` | modes, session/turn logic, bot, audio, settings |
| `input/`, `tracking/` | mouse input and MediaPipe body tracking |
| `tests/` | headless test suite — `python -m pytest tests -q` |
| `web/` | the Vercel landing page |
| `vercel.json` | Vercel config (static site only — the game is not a web app) |

## Building a standalone executable

The unchanged game can be packaged into a self-contained Windows executable
with Panda3D's `build_apps` (via the `tools/package.py` wrapper):

```bash
python -m pip install setuptools
python tools/package.py
```

This produces the bundle in `build/win_amd64/` (the launcher is
`build/win_amd64/Hells Balls.exe`, ~200 MB). Zip that folder and upload it to a
GitHub Release, then point the landing page's download button at that release.

`tools/package.py` runs `build_apps` and then copies in two runtime data-sets
that Panda3D loads dynamically and its dependency scanner therefore misses:

1. Panda3D's OpenGL/DirectX renderer + audio DLLs (without them the exe fails
   with "No graphics pipe is available!").
2. Ursina's built-in `fonts/`, `models_compressed/` and `textures/` (without
   them text and the `quad`/`cube`/`sphere` primitives fail to load).

The bundle includes OpenCV + MediaPipe, so webcam input mode is packaged, but
the exe's settings/audio/webcam file paths resolve relative to the working
directory and are not fully verified end-to-end — the mouse-mode game is the
verified path.

> Note: `build_apps` bundles the *running* interpreter and all installed
> packages, so build it in a clean virtualenv that has exactly
> `requirements.txt` installed.
