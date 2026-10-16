// In-page end-to-end check of the webcam-to-throw path (no camera required).
//
//   python tools/vercel_sim.py 8130 --with-tools
//   # in the page console:
//   (0, eval)(await (await fetch('/tools/webcam_fixture_check.js')).text())
//   await window.hellsWebcamFixtureRun()
//
// It uses the production TrackingService, WebcamInput, swing detector, game
// loop and physics. Only two process boundaries are substituted:
//   * getUserMedia returns a canvas captureStream (this environment has no
//     camera the browser can open), and
//   * the pose landmarker replays a RECORDED MediaPipe trace exported from a
//     real person's video by tools/export_landmarks.py.
// Everything from the service's frame publication to the ball leaving the
// foul line is the shipping code path. Two fixtures:
//   webcam_landmarks.json        - a real arm swing that must throw once,
//   webcam_wave_landmarks.json   - real people waving, which must never throw.
//
// It mutates the game - run it on a throwaway load.
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadFixture(name) {
    const response = await fetch(`/tools/${name}`);
    if (!response.ok) throw new Error(`fixture ${name}: HTTP ${response.status}`);
    return response.json();
  }

  // A landmarker whose detectForVideo returns the recorded frames in order.
  function fixtureLandmarker(fixture, state) {
    const names = fixture.landmarks;
    const n = names.length;
    return {
      detectForVideo() {
        const index = Math.min(state.frame, fixture.frames.length - 1);
        state.frame += 1;
        const entry = fixture.frames[index];
        if (!entry.t || !entry.l) return { landmarks: [] };
        const pose = [];
        for (let i = 0; i < n; i++) {
          const x = entry.l[i];
          pose.push(x === null
            ? { x: 0, y: 0, z: 0, visibility: 0 }
            : { x, y: entry.l[n + i], z: 0, visibility: entry.l[2 * n + i] });
        }
        // Keep the flat landmark array in MediaPipe's index order: the service
        // maps by index, so rebuild it from the fixture's named list.
        const full = new Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0, visibility: 0 }));
        const MEDIAPIPE_INDEX = {
          left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14,
          left_wrist: 15, right_wrist: 16, left_index: 19, right_index: 20,
          left_pinky: 17, right_pinky: 18, left_thumb: 21, right_thumb: 22,
          left_hip: 23, right_hip: 24, left_knee: 25, right_knee: 26,
        };
        names.forEach((name, i) => {
          const indexInPose = MEDIAPIPE_INDEX[name];
          if (indexInPose !== undefined) full[indexInPose] = pose[i];
        });
        return { landmarks: [full] };
      },
      close() {},
    };
  }

  window.hellsWebcamFixtureRun = async function hellsWebcamFixtureRun() {
    const app = window.__hellsBalls;
    if (!app) throw new Error('hellsWebcamFixtureRun: the game is not loaded');
    const game = app.game;
    const webcam = game.inputs.webcam;
    const service = webcam._service;
    const results = [];
    const check = (name, ok, detail = '') => results.push([name, !!ok, detail]);

    // camera boundary: a canvas stream driven by a timer (not rAF: a
    // background tab never gets animation frames, and this check must be
    // runnable wherever the page happens to be shown)
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#123'; ctx.fillRect(0, 0, 640, 480);
    const drawTimer = setInterval(() => {
      ctx.fillStyle = `hsl(${(performance.now() / 20) % 360},40%,20%)`;
      ctx.fillRect(0, 0, 640, 480);
    }, 25);
    const mediaDevices = navigator.mediaDevices;
    const originalGum = mediaDevices.getUserMedia;
    mediaDevices.getUserMedia = async () => canvas.captureStream(30);
    const originalLoadLandmarker = service._loadLandmarker;

    const throwOf = async (fixture, timeoutMs, expectThrow) => {
      const state = { frame: 0 };
      service._delegate = 'CPU';
      // The fixture check replaces the pose engine with a replaying stub, so
      // it must run the main-thread engine (the worker owns its own engine).
      service._useWorker = false;
      service._loadLandmarker = async () => fixtureLandmarker(fixture, state);
      const detector = webcam._detector;
      const phases = [];
      let thrown = null;
      let launches = 0;
      const originalLaunch = game.launch.bind(game);
      game.launch = (data) => { launches += 1; if (thrown === null) thrown = JSON.parse(JSON.stringify(data)); return originalLaunch(data); };
      game.configure('classic', [{ name: 'FIXTURE' }]);
      app.screens.set('play');
      game.set_input_mode('mouse', false);
      game.set_input_mode('webcam', false);
      const deadline = performance.now() + timeoutMs;
      while (performance.now() < deadline && thrown === null) {
        const phase = detector.phase;
        if (!phases.length || phases[phases.length - 1].phase !== phase) {
          phases.push({ phase, seconds: Math.round((performance.now() / 1000) * 10) / 10 });
        }
        await sleep(50);
      }
      if (expectThrow) await sleep(300);   // catch any duplicate launch
      game.launch = originalLaunch;
      await webcam.stop();
      return { thrown, phases, launches, frames: state.frame };
    };

    try {
      const swing = await loadFixture('webcam_landmarks.json');
      const positive = await throwOf(swing, 30000, true);
      check('recorded swing launches a ball', positive.thrown !== null,
        positive.thrown ? `speed=${positive.thrown.speed.toFixed(2)}` : `frames=${positive.frames}`);
      if (positive.thrown) {
        const t = positive.thrown;
        check('throw came from the webcam input', t.source === 'webcam');
        check('throw parameters are finite and in range',
          Number.isFinite(t.speed) && Number.isFinite(t.lateral_position)
          && Number.isFinite(t.launch_angle) && Number.isFinite(t.spin_omega)
          && t.speed >= 2.0 && t.speed <= 12.0,
          `speed=${t.speed.toFixed(2)} lateral=${t.lateral_position.toFixed(2)} yaw=${(t.launch_angle * 180 / Math.PI).toFixed(2)}`);
      }
      check('exactly one launch from one swing', positive.launches === 1, `launches=${positive.launches}`);
      const phaseNames = positive.phases.map((p) => p.phase);
      check('phase machine armed and swung',
        phaseNames.includes('ready') && (phaseNames.includes('forward') || phaseNames.includes('backswing')),
        phaseNames.join('>'));

      const wave = await loadFixture('webcam_wave_landmarks.json');
      const negative = await throwOf(wave, 10000, true);
      check('waving does not throw', negative.thrown === null);
    } finally {
      mediaDevices.getUserMedia = originalGum;
      service._loadLandmarker = originalLoadLandmarker;
      clearInterval(drawTimer);
    }

    const failed = results.filter(([, ok]) => !ok);
    console.log('[webcam fixture] ' + results.map(([name, ok, detail]) => `${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`).join('\n[webcam fixture] '));
    return { ok: failed.length === 0, results };
  };
})();
