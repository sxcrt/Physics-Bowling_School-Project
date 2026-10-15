# Browser verification checks

The browser build has no bundler and no test runner, so the DOM/three.js layer
is verified by driving the real page. This file records the sweep and provides
a self-contained check you can paste into the browser console.

## Running it

```bash
python tools/serve.py 8124        # or any static server from the repo root
```

Open <http://127.0.0.1:8124/>, wait for the splash, open the DevTools console
and run `browserAudit()`. It returns a table of `[check, pass/fail]` entries and
prints the failures. It mutates the game (starts matches, throws balls), so run
it on a throwaway page load.

```js
async function browserAudit() {
  const app = window.__hellsBalls;
  const game = app.game;
  const step = (n) => { for (let i = 0; i < n; i++) app.update(1 / 60); };
  const until = (pred, limit = 40000) => { let g = 0; while (!pred() && g < limit) { step(1); g++; } return g < limit; };
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message), true);
  const results = [];
  const check = (name, ok) => results.push([name, !!ok]);
  const hittable = (el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === el || (hit && el.contains(hit));
  };

  // click routing: splash background click starts the game
  app.screens.set('splash'); app.screens.get('splash').AUTO_ADVANCE = 9999; step(2);
  app.screens.get('splash').root.querySelector('.screen-dim')
    .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  step(2);
  check('splash click starts', app.screens.active.name === 'menu');

  // in-game DOM controls are hit-testable
  app.startMatch('classic', [{ name: 'AUDIT' }]); step(2);
  game.pause(); step(1);
  check('pause buttons hittable', game.pause_overlay.buttons.every(hittable));
  game.resume(); step(1);

  // no ghost avatars after a 2-player match
  app.startMatch('local', [{ name: 'A' }, { name: 'B' }]);
  app.startMatch('classic', [{ name: 'A' }]); step(2);
  check('one avatar visible', Object.values(game._avatars).filter(a => a.visible).length === 1);

  // handoff click confirms the turn
  app.startMatch('local', [{ name: 'A' }, { name: 'B' }]);
  game._enter_handoff(); step(2);
  window.dispatchEvent(new MouseEvent('click', { clientX: 640, clientY: 400, button: 0, bubbles: true }));
  step(2);
  check('handoff click confirms', game.state === 'ready');

  // trivia: space is typeable and a background click continues
  app.startMatch('trivia', [{ name: 'T' }]); step(2);
  for (const ch of 'the ball') window.dispatchEvent(new KeyboardEvent('keydown', { key: ch }));
  check('space is typeable', game.answer_text === 'the ball');
  game.answer_text = 'momentum';
  game.submit_answer(); step(2);
  window.dispatchEvent(new MouseEvent('click', { clientX: 640, clientY: 700, button: 0, bubbles: true }));
  step(2);
  check('background click continues', game.state === 'ready');

  // results overlay: count-up reaches the final score and the menu button works
  app.startMatch('classic', [{ name: 'R' }]);
  game.score.rolls = Array(18).fill(0).concat([7, 2]);
  game._finish_match(); step(100);
  check('results count up', game.results_overlay.totalScore.textContent === '9');
  game.results_overlay.buttons[2].click(); step(2);
  check('results main menu works', app.screens.active.name === 'menu');

  // lab controls are hittable and BOWL starts a run
  app.goToLab(); step(2);
  const lab = app.screens.get('lab');
  const button = (label) => [...lab.root.querySelectorAll('.ui-button')].find(b => b.textContent === label);
  check('lab buttons hittable', ['BOWL', 'PAUSE', 'RESET'].every(l => hittable(button(l))));
  button('BOWL').click(); step(60);
  check('lab bowl starts', lab.state === 'rolling');
  button('RESET').click(); step(2);

  // the stage scales to fit instead of distorting
  const sr = app.stage.getBoundingClientRect();
  const scale = Math.min(innerWidth / 1280, innerHeight / 720);
  check('stage fits the window', Math.abs(sr.width - 1280 * scale) < 2 && Math.abs(sr.height - 720 * scale) < 2);

  // physics: a straight throw is recorded through the real loop
  app.startMatch('classic', [{ name: 'P' }]); step(2);
  game.launch({ lateral_position: 0, launch_angle: 0, speed: 7.5, spin_omega: 0, source: 'script' });
  until(() => game.state === 'ready', 8000);
  check('a roll is recorded', game.score.rolls.length === 1);

  check('no console errors', errors.length === 0);
  if (errors.length) console.error('console errors:', errors);
  console.table(results);
  return results;
}
```

## What was verified in the audit (Chromium, 2026-10-15)

| Area | Evidence |
| --- | --- |
| Boot / splash / click-to-start / auto-advance | DOM + screenshot |
| Menu, How to Play (4 tabs), Settings (9 rows, persistence), Quit | DOM clicks, keyboard |
| Mode picker: all six modes, player counts 1/2/2/2-4, bot level, duration | DOM clicks |
| Classic: complete 10-frame game through real pointer drags, scorecard, results, rematch | 20 rolls recorded, results screen |
| Trivia: correct/wrong marking, throw gate, 10 questions, results lines | state + DOM |
| Equations: challenge panel, miss → hints, solved → next, BOWL IT / SHOW SOLUTION / CONTINUE | DOM clicks + real deck |
| Player vs Bot: bot plans and bowls through the real simulation (Easy/Medium/Hard) | bot frame bowled |
| Local 2-4 players: rotation, handoff banner, ENTER and click confirm | state + DOM |
| BowlRush: countdown ticks only while eligible, in-flight roll finishes after time-out | state |
| Pause / resume / restart / settings-from-pause / quit-to-menu | DOM + keyboard |
| Physics Lab: BOWL, PAUSE, RESET, scrubbing, equation rows, load last throw, back | DOM + state |
| Mouse input: aim (frozen during drag), A/D lateral, drag→speed/yaw/hook, gates | real pointer events |
| Keyboard: R (rack), H (physics readout), P/ESC (pause), TAB/1/2 (input), C (arm), F12 (screenshot) | key events |
| Webcam fallback (no camera): reports unavailable and switches to mouse | state + message |
| Audio: 18 WAVs decode, cues fire on release/result | `audio.available`, `audio.played` |
| Reduce motion: no flash/shake/pulse, rolls still complete | state |
| Hand navigation: dwell cursor clicks the control under it | simulated landmarks |
| Console / network: no uncaught errors; all requests < 400 | DevTools APIs |
