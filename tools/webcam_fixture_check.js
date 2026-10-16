// In-page end-to-end check of the webcam-to-throw path (no camera required).
//
//   python tools/vercel_sim.py 8130 --with-tools
//   # in the page console:
//   (0, eval)(await (await fetch('/tools/webcam_fixture_check.js')).text())
//   await window.hellsWebcamFixtureRun()
//
// It uses the production TrackingService, WebcamInput, temporal classifier,
// game loop and physics. Only two process boundaries are substituted:
//   * getUserMedia returns a canvas captureStream (this environment has no
//     camera the browser can open), and
//   * the pose landmarker replays a deterministic landmark trace.
// Everything from the service's frame publication to the ball leaving the
// foul line is the shipping code path. Three traces:
//   * a scripted one-arm bowling swing (ready hold, backswing, forward
//     delivery) - must launch exactly one ball;
//   * recorded jumping jacks/burpees footage (tools/webcam_landmarks.json) -
//     the legacy phase machine fires on it, but the classifier must refuse it
//     and must not even recognize a release: zero launches;
//   * recorded waving footage (tools/webcam_wave_landmarks.json) - zero
//     launches.
//
// It mutates the game - run it on a throwaway load.
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadFixture(name) {
    const response = await fetch(`/tools/${name}`);
    if (!response.ok) throw new Error(`fixture ${name}: HTTP ${response.status}`);
    return response.json();
  }

  // MediaPipe landmark indices for the joints the swing pipeline reads.
  const MEDIAPIPE_INDEX = {
    left_shoulder: 11, right_shoulder: 12, left_elbow: 13, right_elbow: 14,
    left_wrist: 15, right_wrist: 16, left_index: 19, right_index: 20,
    left_pinky: 17, right_pinky: 18, left_thumb: 21, right_thumb: 22,
    left_hip: 23, right_hip: 24, left_knee: 25, right_knee: 26,
  };

  function emptyPose() {
    return new Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  }

  // One full upper-body pose in MediaPipe's flat landmark order.
  function poseArray({ bodyX = 0.5, shoulderY = 0.40, hipY = 0.65, rightWristY = 0.62,
                       leftWristY = 0.62, rightWristX = null, leftWristX = null } = {}) {
    const full = emptyPose();
    const put = (name, x, y, visibility = 0.96) => {
      full[MEDIAPIPE_INDEX[name]] = { x, y, z: 0, visibility };
    };
    put('left_shoulder', bodyX - 0.12, shoulderY);
    put('right_shoulder', bodyX + 0.12, shoulderY);
    put('left_hip', bodyX - 0.10, hipY);
    put('right_hip', bodyX + 0.10, hipY);
    put('left_knee', bodyX - 0.10, hipY + 0.25);
    put('right_knee', bodyX + 0.10, hipY + 0.25);
    put('left_wrist', leftWristX === null ? bodyX - 0.18 : leftWristX, leftWristY);
    put('right_wrist', rightWristX === null ? bodyX + 0.18 : rightWristX, rightWristY);
    return full;
  }

  // The scripted deliberate swing: still ready hold, visible backswing,
  // sustained forward/up delivery - the motion the validator must accept.
  function scriptedSwingFrames() {
    const frames = [];
    for (let i = 0; i < 60; i++) frames.push(poseArray({}));
    for (let i = 1; i <= 6; i++) frames.push(poseArray({ rightWristY: 0.62 + 0.28 * i / 6 }));
    for (let i = 1; i <= 8; i++) frames.push(poseArray({ rightWristY: 0.90 + (0.28 - 0.90) * i / 8 }));
    for (let i = 0; i < 30; i++) frames.push(poseArray({ rightWristY: 0.28 }));
    return frames;
  }

  // A landmarker replaying `frames` (arrays of 33 landmarks) in order.
  function sequenceLandmarker(frames, state) {
    return {
      detectForVideo() {
        const index = Math.min(state.frame, frames.length - 1);
        state.frame += 1;
        return { landmarks: [frames[index]] };
      },
      close() {},
    };
  }

  // A landmarker replaying a recorded fixture file in order.
  function fixtureFrames(fixture) {
    const names = fixture.landmarks;
    const n = names.length;
    return fixture.frames.map((entry) => {
      if (!entry.t || !entry.l) return emptyPose();
      const full = emptyPose();
      names.forEach((name, i) => {
        const indexInPose = MEDIAPIPE_INDEX[name];
        if (indexInPose === undefined || entry.l[i] === null) return;
        full[indexInPose] = {
          x: entry.l[i], y: entry.l[n + i], z: 0, visibility: entry.l[2 * n + i],
        };
      });
      return full;
    });
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

    const throwOf = async (frames, timeoutMs, expectThrow) => {
      const state = { frame: 0 };
      service._delegate = 'CPU';
      // The fixture check replaces the pose engine with a replaying stub, so
      // it must run the main-thread engine (the worker owns its own engine).
      service._useWorker = false;
      service._loadLandmarker = async () => sequenceLandmarker(frames, state);
      const detector = webcam._classifier;
      const phases = [];
      let thrown = null;
      let launches = 0;
      // Classifier counters are session diagnostics and deliberately survive a
      // stop()/reset; each trace must therefore be judged by its own delta.
      const releasesBefore = detector.release_count;
      const blockedBefore = detector.blocked_count;
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
      const blocked = detector.blocked_count - blockedBefore;
      const detectorReleases = detector.release_count - releasesBefore;
      await webcam.stop();
      return { thrown, phases, launches, frames: state.frame, blocked, detectorReleases };
    };

    try {
      const swing = await throwOf(scriptedSwingFrames(), 30000, true);
      check('a deliberate scripted swing launches a ball', swing.thrown !== null,
        swing.thrown ? `speed=${swing.thrown.speed.toFixed(2)}` : `frames=${swing.frames}`);
      if (swing.thrown) {
        const t = swing.thrown;
        check('throw came from the webcam input', t.source === 'webcam');
        check('throw parameters are finite and in range',
          Number.isFinite(t.speed) && Number.isFinite(t.lateral_position)
          && Number.isFinite(t.launch_angle) && Number.isFinite(t.spin_omega)
          && t.speed >= 2.0 && t.speed <= 12.0,
          `speed=${t.speed.toFixed(2)} lateral=${t.lateral_position.toFixed(2)} yaw=${(t.launch_angle * 180 / Math.PI).toFixed(2)}`);
      }
      check('exactly one launch from one swing', swing.launches === 1, `launches=${swing.launches}`);
      const phaseNames = swing.phases.map((p) => p.phase);
      check('classifier armed and swung',
        phaseNames.includes('ready') && (phaseNames.includes('forward') || phaseNames.includes('backswing')),
        phaseNames.join('>'));

      const jj = await loadFixture('webcam_landmarks.json');
      const exercise = await throwOf(fixtureFrames(jj), 20000, true);
      check('recorded exercise motion (jumping jacks) never launches', exercise.thrown === null,
        `detectorReleases=${exercise.detectorReleases} blocked=${exercise.blocked}`);
      check('the exercise motion never even recognizes a release in the classifier',
        exercise.detectorReleases === 0,
        `classifierReleases=${exercise.detectorReleases}`);

      const wave = await loadFixture('webcam_wave_landmarks.json');
      const waving = await throwOf(fixtureFrames(wave), 10000, true);
      check('waving does not throw', waving.thrown === null);
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
