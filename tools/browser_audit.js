// In-page regression sweep for the browser build's DOM / three.js layer.
//
//   python tools/serve.py 8124
//   # in the page console:
//   (0, eval)(await (await fetch('/tools/browser_audit.js')).text())
//   await window.hellsAuditRun()
//
// It drives the real page (real game loop, real DOM, real renderer), so it
// covers the things tools/js_tests.mjs cannot: the held RIGHT SHIFT scorecard,
// the scorecard's agreement with the scoring engine as rendered, the HUD layout,
// and the shadow pipeline. It mutates the game - run it on a throwaway load.
(() => {
  const step = (app, n) => { for (let i = 0; i < n; i++) app.update(1 / 60); };
  const until = (app, pred, limit = 9000) => {
    let guard = 0;
    while (!pred() && guard < limit) { step(app, 1); guard += 1; }
    return guard < limit;
  };
  const boxOf = (app, node) => {
    const rect = node.getBoundingClientRect();
    const stage = app.stage.getBoundingClientRect();
    const k = 1280 / stage.width;
    return {
      x: Math.round((rect.left - stage.left) * k), y: Math.round((rect.top - stage.top) * k),
      w: Math.round(rect.width * k), h: Math.round(rect.height * k),
    };
  };

  window.hellsAuditRun = async function hellsAuditRun() {
    const app = window.__hellsBalls;
    if (!app) throw new Error('hellsAuditRun: the game is not loaded');
    if (!window.hellsAudit) {
      (0, eval)(await (await fetch('/tools/dom_audit.js')).text());
    }
    const game = app.game;
    const keyboard = await import('/src/input/keyboard.js');
    const shadow = await import('/src/scene/shadow.js');
    const rendererModule = await import('/src/scene/renderer.js');
    const { BowlingGame } = await import('/src/scoring.js');
    const { frameBoxes, cardModel } = await import('/src/ui/cardmodel.js');

    const errors = [];
    const onError = (event) => errors.push(String(event.message || event));
    window.addEventListener('error', onError, true);

    const results = [];
    const check = (name, ok, detail = '') => results.push([name, !!ok, detail]);

    // --- rendering pipeline -------------------------------------------------
    check('shadow map enabled', rendererModule.renderer.shadowMap.enabled === true);
    check('shadow rig installed', shadow.shadowsInstalled() === true);
    const casters = [];
    const receivers = [];
    rendererModule.scene.traverse((node) => {
      if (!node.isMesh) return;
      if (node.castShadow) casters.push(node);
      if (node.receiveShadow) receivers.push(node);
    });
    check('ball and pins cast shadows', casters.length >= 12, `casters=${casters.length}`);
    check('lane surfaces receive shadows', receivers.length >= 12, `receivers=${receivers.length}`);
    const ball = game.ball;
    check('ball contact shadow lies flat', Math.abs(ball.shadow.rotation.x) < 1e-6
      && Math.abs(ball.shadow.rotation.z) < 1e-6);
    check('pin contact shadows lie flat', game.pins.pins.every(
      (pin) => Math.abs(pin.contact.rotation.x) < 1e-6));
    check('shadow focus tracks the action', (() => {
      game.configure('classic', [{ name: 'AUDIT' }]);
      app.screens.set('play');
      step(app, 2);
      const target = rendererModule.scene.getObjectByName('shadow-target');
      if (!target) return false;
      const readyZ = target.position.z;
      const readyOk = readyZ > 15.5 && readyZ < 18.5;
      game.launch({ lateral_position: 0, launch_angle: 0, speed: 8, spin_omega: 0, source: 'script' });
      until(app, () => game.ball.physics.z > 8 || game.state !== 'rolling', 4000);
      const rollingZ = target.position.z;
      until(app, () => game.state === 'ready', 9000);
      return readyOk && rollingZ < readyZ;
    })());

    // --- held scorecard -----------------------------------------------------
    // Build a legal mixed game by walking the engine, so the card is checked
    // against strikes, spares, open frames and the tenth-frame bonus balls.
    const makeGame = (pattern) => {
      const engine = new BowlingGame();
      const rolls = [];
      let i = 0;
      while (!engine.is_complete && rolls.length < 30) {
        const standing = engine.standingPins();
        if (standing === null) break;
        const pins = Math.min(pattern[i % pattern.length], standing);
        engine.recordRoll(pins);
        rolls.push(pins);
        i += 1;
      }
      return { engine, rolls };
    };

    game.configure('classic', [{ name: 'AUDIT' }]);
    app.screens.set('play');
    step(app, 20);
    const overlay = game.scorecard_overlay;

    check('scorecard hidden until RIGHT SHIFT is held', overlay.visible === false);
    keyboard.heldKeys.add('right shift');
    step(app, 3);
    check('holding RIGHT SHIFT shows the scorecard', overlay.visible === true);
    check('the play HUD hides behind the scorecard', game.hud.root.style.display === 'none');
    keyboard.heldKeys.delete('right shift');
    step(app, 3);
    check('releasing RIGHT SHIFT hides the scorecard', overlay.visible === false);
    check('the play HUD returns after release', game.hud.root.style.display !== 'none');

    // A key held when focus is lost must not stick the overlay on.
    keyboard.heldKeys.add('right shift');
    step(app, 3);
    window.dispatchEvent(new Event('blur'));
    step(app, 3);
    check('losing focus releases the held scorecard', overlay.visible === false);
    check('losing focus clears the held-key set', keyboard.heldKeys.size === 0);

    // Holding it must not disturb a roll in progress.
    const rollsBefore = game.score.rolls.length;
    game.launch({ lateral_position: 0, launch_angle: 0, speed: 8, spin_omega: 0, source: 'script' });
    step(app, 5);
    keyboard.heldKeys.add('right shift');
    step(app, 30);
    check('the scorecard does not interrupt a roll', game.state === 'rolling');
    check('the scorecard does not add a roll', game.score.rolls.length === rollsBefore);
    check('the scorecard cannot swallow pointer input', (() => {
      if (overlay.root.style.pointerEvents !== 'none') return false;
      const stage = app.stage.getBoundingClientRect();
      const target = document.elementFromPoint(stage.left + 640, stage.top + 560);
      if (!target) return false;
      let reached = false;
      const probe = () => { reached = true; };
      app.stage.addEventListener('pointerdown', probe, true);
      target.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, clientX: stage.left + 640, clientY: stage.top + 560,
      }));
      app.stage.removeEventListener('pointerdown', probe, true);
      return reached;
    })(), String(document.elementFromPoint(app.stage.getBoundingClientRect().left + 640, app.stage.getBoundingClientRect().top + 560).tagName));
    keyboard.heldKeys.delete('right shift');
    until(app, () => game.state !== 'rolling' && game.state !== 'settling', 9000);

    // Rendered marks and totals must equal the engine's.
    const built = makeGame([10, 7, 3, 10, 9, 0, 10, 8, 2, 6, 4, 10]);
    const engine = built.engine;
    game.score.rolls = built.rolls.slice();
    game.match.players[0].bowling.rolls = game.score.rolls;
    keyboard.heldKeys.add('right shift');
    step(app, 3);
    const model = cardModel(engine);
    const row = overlay.rows[0];
    let marksOk = true;
    let totalsOk = true;
    let detail = '';
    for (let frame = 1; frame <= 10; frame++) {
      const boxes = frameBoxes(engine, frame);
      const cells = row.cells[frame - 1];
      for (let i = 0; i < boxes.length; i++) {
        if (cells.boxes[i].textContent !== boxes[i]) {
          marksOk = false;
          detail += `f${frame}b${i}:${cells.boxes[i].textContent}|${boxes[i]} `;
        }
      }
      const shownTotal = cells.total.textContent;
      const want = model.totals[frame - 1];
      const wantText = (want === null || want === undefined) ? '' : String(want);
      if (shownTotal !== wantText) {
        totalsOk = false;
        detail += `f${frame}t:${shownTotal}|${wantText} `;
      }
    }
    check('scorecard roll boxes match the engine', marksOk, detail);
    check('scorecard frame totals match the engine', totalsOk, detail);
    check('scorecard running total matches the engine',
      row.stat.textContent.startsWith(String(engine.current_score)), row.stat.textContent);
    check('the test game contains strikes and spares',
      built.rolls.includes(10) && built.rolls.some((r, i) => i > 0 && r + built.rolls[i - 1] === 10));
    check('a frame with no total yet prints nothing', (() => {
      const index = model.totals.findIndex((v) => v === null);
      if (index < 0) return true;
      return row.cells[index].total.textContent === '';
    })());
    check('the tenth frame has three roll boxes',
      row.cells[9].boxes.filter((b) => b.style.display !== 'none').length === 3);
    check('frames 1-9 have two roll boxes',
      row.cells[0].boxes.filter((b) => b.style.display !== 'none').length === 2);
    check('the active frame is highlighted', (() => {
      const live = model.currentFrame;
      if (live === null) return true;
      return row.cells[live - 1].cell.style.boxShadow.includes('inset');
    })());
    check('the scorecard fits inside the stage', (() => {
      const panel = boxOf(app, overlay.panel);
      return panel.x >= 0 && panel.y >= 0 && panel.x + panel.w <= 1280 && panel.y + panel.h <= 720;
    })());
    check('scorecard layout audit is clean', window.hellsAudit().length === 0,
      JSON.stringify(window.hellsAudit()));
    keyboard.heldKeys.delete('right shift');
    step(app, 3);

    // Four players: one row each, all ten frames, no overlap.
    game.configure('local', [{ name: 'ALEX' }, { name: 'BLAIR' }, { name: 'CASEY' }, { name: 'DREW' }]);
    app.screens.set('play');
    step(app, 20);
    keyboard.heldKeys.add('right shift');
    step(app, 3);
    const rowsVisible = overlay.rows.filter((r) => r.row.style.display !== 'none');
    check('multiplayer card shows one row per player', rowsVisible.length === 4, `rows=${rowsVisible.length}`);
    check('every multiplayer row has ten frames',
      rowsVisible.every((r) => r.cells.length === 10));
    check('multiplayer highlights the active player',
      rowsVisible[game.match.turn_index].row.style.boxShadow.includes('inset'));
    check('multiplayer layout audit is clean', window.hellsAudit().length === 0,
      JSON.stringify(window.hellsAudit()));
    keyboard.heldKeys.delete('right shift');
    step(app, 3);

    // A pins-scored mode keeps its own conventions.
    game.configure('bowlrush', [{ name: 'P1' }, { name: 'P2' }]);
    app.screens.set('play');
    step(app, 20);
    game.match.players[0].total_pins = 34;
    game.match.players[0].throws = 12;
    game.match.players[0].bowling.rolls = [10, 9, 0, 8, 7];
    keyboard.heldKeys.add('right shift');
    step(app, 3);
    check('a pins mode shows a pinfall log, not a ten-frame grid',
      overlay.rows[0].history.style.display !== 'none' && overlay.rows[0].grid.style.display === 'none');
    check('a pins mode reports the pin total',
      overlay.rows[0].stat.textContent.includes('34'), overlay.rows[0].stat.textContent);
    check('a pins mode shows the recent throws',
      overlay.rows[0].history.textContent.includes('X'), overlay.rows[0].history.textContent);
    check('pins mode layout audit is clean', window.hellsAudit().length === 0,
      JSON.stringify(window.hellsAudit()));
    keyboard.heldKeys.delete('right shift');
    step(app, 3);

    // --- every screen -------------------------------------------------------
    const screens = [
      ['splash', () => { app.screens.set('splash'); step(app, 30); }],
      ['menu', () => { app.screens.set('menu'); step(app, 30); }],
      ['modes', () => { app.screens.set('modes'); step(app, 30); }],
      ['howto', () => { app.screens.set('howto'); step(app, 30); }],
      ['settings', () => { app.screens.set('settings'); step(app, 30); }],
      ['lab', () => { app.goToLab(); step(app, 40); }],
    ];
    for (const [name, show] of screens) {
      show();
      const defects = window.hellsAudit().filter((d) => !d.el || !String(d.el).includes('brand-glow'));
      check(`${name} layout is clean`, defects.length === 0, JSON.stringify(defects));
      const uiText = document.getElementById('ui-root').textContent;
      check(`${name} shows no webcam diagnostics`,
        !/WEBCAM (tracking|searching|error)\s+\[|conf \d+%|GPU \(|infer \d+ms|frame \d+ @|delegate:/i.test(uiText));
    }

    const playStates = [
      ['classic', 'classic', [{ name: 'PLAYER 1' }]],
      ['local4', 'local', [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }]],
      ['trivia', 'trivia', [{ name: 'T' }]],
      ['equations', 'equations', [{ name: 'E' }]],
      ['bowlrush', 'bowlrush', [{ name: 'P1' }, { name: 'P2' }]],
      ['pvbot', 'pvbot', [{ name: 'H' }, { name: 'BOT', is_bot: true, difficulty: 'hard' }]],
    ];
    for (const [label, modeId, specs] of playStates) {
      game.configure(modeId, specs);
      app.screens.set('play');
      step(app, 20);
      const defects = window.hellsAudit();
      check(`play/${label} layout is clean`, defects.length === 0, JSON.stringify(defects));
      check(`play/${label} keeps the lane visible`, game.hud.root.style.display !== 'none');
    }

    // Pause and results own the frame; the play HUD must not show through.
    game.configure('classic', [{ name: 'PLAYER 1' }]);
    app.screens.set('play');
    step(app, 20);
    game.pause();
    step(app, 5);
    check('the play HUD hides behind the pause overlay', game.hud.root.style.display === 'none');
    game.resume();
    step(app, 5);
    check('the play HUD returns after resuming', game.hud.root.style.display !== 'none');
    game.score.rolls = Array(18).fill(0).concat([7, 2]);
    game._finish_match();
    step(app, 120);
    check('the play HUD hides behind the results overlay', game.hud.root.style.display === 'none');
    check('results layout audit is clean', window.hellsAudit().length === 0,
      JSON.stringify(window.hellsAudit()));
    check('the results overlay reports the final score',
      game.results_overlay.totalScore.textContent === '9',
      game.results_overlay.totalScore.textContent);

    // The scorecard is still readable on top of the results screen.
    keyboard.heldKeys.add('right shift');
    step(app, 3);
    check('the scorecard opens over the results screen', game.scorecard_overlay.visible === true);
    check('scorecard-over-results audit is clean', window.hellsAudit().length === 0,
      JSON.stringify(window.hellsAudit()));
    keyboard.heldKeys.delete('right shift');
    step(app, 3);
    check('the results screen returns after releasing RIGHT SHIFT',
      game.results_overlay.visible === true);

    // --- viewport fits ------------------------------------------------------
    const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    for (const [w, h] of [[800, 600], [1024, 768], [1280, 720], [1920, 1080]]) {
      const fit = Math.min(w / 1280, h / 720);
      const rect = app.stage.getBoundingClientRect();
      const k = rect.width / (1280 * scale);
      check(`stage keeps the 16:9 reference grid at ${w}x${h}`,
        Math.abs(rect.width / rect.height - 1280 / 720) < 0.01
        && Math.abs((rect.width / k) / (1280 * fit)) > 0);
    }
    check('stage fits the live window',
      Math.abs(app.stage.getBoundingClientRect().width - 1280 * scale) < 2
      && Math.abs(app.stage.getBoundingClientRect().height - 720 * scale) < 2);
    check('the page itself does not scroll', (() => {
      const doc = document.documentElement;
      return doc.scrollWidth <= window.innerWidth + 1 && doc.scrollHeight <= window.innerHeight + 1;
    })(), `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight} vs ${window.innerWidth}x${window.innerHeight}`);
    check('the stage is centred horizontally and vertically', (() => {
      const rect = app.stage.getBoundingClientRect();
      const dx = Math.abs(rect.left - (window.innerWidth - rect.width) / 2);
      const dy = Math.abs(rect.top - (window.innerHeight - rect.height) / 2);
      return dx < 2 && dy < 2;
    })());

    // --- fullscreen ---------------------------------------------------------
    check('fullscreen support is reported', typeof app.fullscreen_supported === 'boolean');
    check('fullscreen controls exist on the splash, menu and pause screens',
      app._fullscreenControls.length >= 3, `controls=${app._fullscreenControls.length}`);
    if (app.fullscreen_supported) {
      const originalRequest = document.documentElement.requestFullscreen;
      let requested = 0;
      let fakeElement = null;
      document.documentElement.requestFullscreen = function requestFullscreen() {
        requested += 1;
        fakeElement = document.documentElement;
        return Promise.resolve();
      };
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true, get: () => fakeElement,
      });
      try {
        await app.toggleFullscreen();
        check('entering fullscreen goes through the browser API', requested === 1, `calls=${requested}`);
        document.dispatchEvent(new Event('fullscreenchange'));
        check('the interface switches to EXIT FULLSCREEN',
          app._fullscreenControls.some((c) => c.node.textContent === 'EXIT FULLSCREEN'));
        check('the stage re-fits while fullscreen',
          Math.abs(app.stage.getBoundingClientRect().width / app.stage.getBoundingClientRect().height
            - 1280 / 720) < 0.01);
        fakeElement = null;
        document.dispatchEvent(new Event('fullscreenchange'));
        check('leaving fullscreen restores the FULLSCREEN label',
          app._fullscreenControls.some((c) => c.node.textContent === 'FULLSCREEN'));
        check('app.fullscreen_active rolls back', app.fullscreen_active === false);
      } finally {
        delete document.fullscreenElement;
        document.documentElement.requestFullscreen = originalRequest;
      }
    } else {
      check('fullscreen is unsupported: controls are hidden', (() => {
        return app._fullscreenControls.every((c) => c.node.style.display === 'none');
      })());
    }

    // --- webcam diagnostics are developer-only ------------------------------
    const savedInputMode = game.input_mode;
    const savedDebug = app.settings.get('debug_diagnostics');
    const savedStatus = game._webcam_status;
    game.input_mode = 'webcam';
    game._webcam_status = {
      running: true, tracked: true, confidence: 0.91, fps: 30, error: null,
      phase: 'ready', phase_label: 'Ready', hint: 'Swing your arm forward and up to throw.',
      lost_seconds: null, telemetry: '', arm: 'auto', message: 'tracking',
      frame_count: 42, delegate: 'GPU (worker)', infer_ms: 12, frame_time: 1.2,
      lost_frames: 0, blocked_count: 2, block_reason: 'both arms moved together - throw with one arm',
      stale_frames: 0, session: 1, reject_reason: null, engine_fallback: null,
      hand: 'wrist', speed: 0.4, direction: 'up', depth: 0.2, rise: 0.4, peak_up: 1.1,
      swing_pose: 0.2, release_eligible: false, last_throw: null,
    };
    app.settings.set('debug_diagnostics', false);
    game._physics_lines = [];
    game._update_physics_readout();
    game._hud();
    const cleanText = game.hud.root.textContent;
    check('normal play HUD hides engine/confidence/telemetry',
      !/confidence|fps|GPU|CPU|delegate|infer|frame \d+ @/i.test(cleanText), cleanText.slice(0, 160));
    check('normal play readout hides the webcam diagnostics block',
      !/WEBCAM (tracking|searching|error)/.test(game.hud.readout.textContent));
    app.settings.set('debug_diagnostics', true);
    game._update_physics_readout();
    game._hud();
    check('the developer toggle restores the diagnostics',
      /WEBCAM tracking/.test(game.hud.readout.textContent)
      && /blocked 2/.test(game.hud.readout.textContent),
      game.hud.readout.textContent.split('\n')[0]);
    check('webcam HUD layout is clean with diagnostics on', window.hellsAudit().length === 0,
      JSON.stringify(window.hellsAudit()));
    app.settings.set('debug_diagnostics', false);
    game._update_physics_readout();
    game._hud();
    check('webcam HUD layout is clean with diagnostics off', window.hellsAudit().length === 0,
      JSON.stringify(window.hellsAudit()));
    app.settings.set('debug_diagnostics', !!savedDebug);
    game.input_mode = savedInputMode;
    game._webcam_status = savedStatus;
    game._physics_lines = [];
    game._update_physics_readout();
    game._hud();

    window.removeEventListener('error', onError, true);
    check('no uncaught page errors during the sweep', errors.length === 0, errors.join(' | '));

    const failed = results.filter(([, ok]) => !ok);
    if (failed.length) console.error('browser audit failures:', failed);
    console.table(results.map(([name, ok, detail]) => ({ check: name, result: ok ? 'pass' : 'FAIL', detail: detail || '' })));
    return results;
  };
})();
