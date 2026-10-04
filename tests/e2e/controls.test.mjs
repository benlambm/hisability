// Acceptance criterion 8 (reliable controls in every interval state) and criterion 15
// (keyboard operation, reduced motion). Requirements 18, 20, 23, 24, 47, 50.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../../tools/pw.mjs';
import {
  startProxy, openApp, closeAll, homeNames, readPlayer, readFinish, screenName, movementByName,
  now, advanceTo, advanceBy, DESKTOP,
} from './helpers.mjs';

let server;
let browser;

before(async () => {
  server = await startProxy();
  browser = await chromium.launch();
});

after(async () => {
  await closeAll(browser, server);
});

const START = '#screen-home [data-action="start"]';
const PAUSE = '#screen-player .ctl-pause'; // the main Pause / Resume control
const RESUME_BIG = '#screen-player .pl-resume-big';
const SKIP = '#screen-player .ctl-skip';
const EASIER = '#screen-player .ctl-easier';
const AUDIO = '#screen-player .ctl-audio';
const VIBRATION = '#screen-player .ctl-vibration';
const END = '#screen-player [data-action="end"]';

/** Init script: record what the cues module says and vibrates. */
function cueSpy() {
  const spoken = [];
  const buzz = [];
  Object.defineProperty(window, '__cues', { value: { spoken, buzz } });
  if (window.SpeechSynthesis) {
    const speak = SpeechSynthesis.prototype.speak;
    SpeechSynthesis.prototype.speak = function (u) {
      if (u && String(u.text).trim()) spoken.push(String(u.text));
      return speak.call(this, u);
    };
  }
  if (typeof Navigator.prototype.vibrate === 'function') {
    const vibrate = Navigator.prototype.vibrate;
    Navigator.prototype.vibrate = function (p) {
      const pattern = Array.isArray(p) ? p : [p];
      if (pattern.some((v) => Number(v) > 0)) buzz.push(pattern);
      try {
        return vibrate.call(this, p);
      } catch {
        return false;
      }
    };
  }
}

const cues = (page) => page.evaluate(() => ({ spoken: [...window.__cues.spoken], buzz: window.__cues.buzz.length }));
const dialogOpen = (page) => page.evaluate(() => document.getElementById('end-dialog').open);

// ---------------------------------------------------------------- pause / resume

test('criterion 8: Pause freezes the interval and Resume counts 3-2-1 in prep, work and transition', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { paused: true, initScripts: [cueSpy] });
  try {
    await page.click(START);
    const t0 = await now(page);
    let shift = 0; // paused time + resume countdowns so far
    const cases = [
      { pos: 4_500, kind: 'prep', resumeWith: RESUME_BIG },
      { pos: 20_500, kind: 'work', resumeWith: PAUSE },
      { pos: 38_500, kind: 'transition', resumeWith: RESUME_BIG },
    ];
    for (const { pos, kind, resumeWith } of cases) {
      await advanceTo(page, t0 + pos + shift);
      const running = await readPlayer(page);
      assert.equal(running.kind, kind);
      await page.click(PAUSE);
      const tp = await now(page);
      let p = await readPlayer(page);
      assert.equal(p.status, 'paused', `${kind}: paused`);
      assert.equal(p.state, 'Paused', `${kind}: state label says Paused`);
      assert.ok(p.pausedOverlay, `${kind}: paused overlay with a Resume button`);
      assert.equal(p.pauseLabel, 'Resume', `${kind}: main control now reads Resume`);
      assert.equal(p.kind, kind);
      assert.match((await cues(page)).spoken.at(-1), /Paused/, `${kind}: pause is announced`);
      const frozen = { ring: p.ring, left: p.left, offset: p.ringOffset, name: p.name };

      await advanceTo(page, tp + 5_000);
      p = await readPlayer(page);
      assert.deepEqual({ ring: p.ring, left: p.left, offset: p.ringOffset, name: p.name }, frozen, `${kind}: frozen while paused`);
      assert.equal(p.status, 'paused');

      await page.click(resumeWith);
      const tr = await now(page);
      p = await readPlayer(page);
      assert.equal(p.status, 'resuming', `${kind}: Resume starts a countdown first`);
      assert.ok(p.resumingOverlay);
      assert.equal(p.resumeNum, '3');
      assert.match((await cues(page)).spoken.at(-1), /Resuming in three/i);
      for (const [dt, num] of [[1_050, '2'], [2_050, '1'], [2_950, '1']]) {
        await advanceTo(page, tr + dt);
        p = await readPlayer(page);
        assert.equal(p.status, 'resuming', `${kind}: still counting in at ${dt} ms`);
        assert.equal(p.resumeNum, num, `${kind}: countdown shows ${num} at ${dt} ms`);
        assert.equal(p.left, frozen.left, `${kind}: the countdown does not consume workout time`);
      }
      await advanceTo(page, tr + 3_050);
      p = await readPlayer(page);
      assert.equal(p.status, 'running', `${kind}: running again after 3 s`);
      assert.equal(p.resumingOverlay, false);
      assert.equal(p.pauseLabel, 'Pause');
      shift += tp + 5_000 + 3_000 - tp; // 5 s paused + 3 s countdown

      await advanceTo(page, t0 + pos + 1_000 + shift);
      p = await readPlayer(page);
      assert.equal(p.ring, String(Number(frozen.ring) - 1), `${kind}: resumes from the same point and counts on`);
    }

    // Pausing during the resume countdown cancels it without moving the position.
    await page.click(PAUSE);
    await page.click(PAUSE); // Resume
    await advanceBy(page, 1_500);
    assert.equal((await readPlayer(page)).status, 'resuming');
    const left = (await readPlayer(page)).left;
    await page.click(PAUSE); // the main control reads Pause again during the countdown
    await advanceBy(page, 4_000);
    const p = await readPlayer(page);
    assert.equal(p.status, 'paused', 'Pause during the countdown goes back to paused');
    assert.equal(p.left, left);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------- skip

test('criterion 8: Skip from prep, work, transition (also while paused) and from the final work to the finish', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { paused: true });
  try {
    const names = await homeNames(page);
    await page.click(START);
    const t0 = await now(page);
    let active = 0;

    await advanceTo(page, t0 + 2_000);
    active += 2_000;
    await page.click(SKIP); // prep -> work 1
    let p = await readPlayer(page);
    assert.equal(p.kind, 'work');
    assert.equal(p.status, 'running');
    assert.equal(p.count, 'Move 1 of 12');
    assert.equal(p.name, names[0]);
    assert.equal(p.ring, '25');
    assert.equal(p.left, '6:50', 'skipping prep jumps to 0:10 on the timeline');

    await advanceBy(page, 3_500);
    active += 3_500;
    assert.equal((await readPlayer(page)).ring, '22');
    await page.click(SKIP); // work 1 -> rest before 2
    p = await readPlayer(page);
    assert.equal(p.kind, 'transition');
    assert.equal(p.count, 'Move 2 of 12');
    assert.equal(p.name, names[1]);
    assert.equal(p.ring, '10');
    assert.equal(p.left, '6:25');

    await advanceBy(page, 1_000);
    active += 1_000;
    await page.click(SKIP); // rest -> work 2
    p = await readPlayer(page);
    assert.equal(p.kind, 'work');
    assert.equal(p.count, 'Move 2 of 12');
    assert.equal(p.ring, '25');
    assert.equal(p.left, '6:15');

    // Skip while paused moves on but stays paused.
    await page.click(PAUSE);
    await page.click(SKIP); // work 2 -> rest before 3, still paused
    p = await readPlayer(page);
    assert.equal(p.status, 'paused', 'skip keeps the paused state');
    assert.equal(p.kind, 'transition');
    assert.equal(p.count, 'Move 3 of 12');
    assert.equal(p.ring, '10');
    await advanceBy(page, 2_000);
    assert.equal((await readPlayer(page)).ring, '10', 'still frozen after skipping while paused');
    await page.click(RESUME_BIG);
    await advanceBy(page, 3_100);
    active += 100;
    assert.equal((await readPlayer(page)).status, 'running');

    // Skip through to the final work.
    for (let i = 0; i < 30; i++) {
      p = await readPlayer(page);
      if (p.kind === 'work' && p.count === 'Move 12 of 12') break;
      await page.click(SKIP);
    }
    assert.equal(p.kind, 'work');
    assert.equal(p.name, names[11]);
    assert.equal(p.next, 'Last one');
    await advanceBy(page, 5_000);
    active += 5_000;
    await page.click(SKIP); // final work -> finish
    const fin = await readFinish(page);
    assert.equal(fin.screen, 'finish', 'skipping the final movement finishes the workout');
    const secs = Math.round(active / 1000);
    assert.deepEqual(fin.stats, [`0:${String(secs).padStart(2, '0')}`, '12 of 12'], 'summary counts only time actually spent moving');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------- audio / vibration

test('criterion 8: Audio and Vibration toggles flip state in any interval and silence only their own cue', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { paused: true, initScripts: [cueSpy] });
  try {
    await page.click(START);
    let p = await readPlayer(page);
    assert.equal(p.audio, 'true');
    assert.equal(p.vibrationDisabled, false, 'Chromium supports vibration');
    assert.equal(p.vibration, 'true');
    let c = await cues(page);
    assert.ok(c.spoken.some((s) => /Get ready/.test(s)), 'spoken prep cue');

    // prep: both off -> work 1 is silent and still
    await page.click(AUDIO);
    await page.click(VIBRATION);
    p = await readPlayer(page);
    assert.deepEqual([p.audio, p.audioIcon, p.vibration, p.vibrationIcon], ['false', 'volume-off', 'false', 'vibrate-off']);
    c = await cues(page);
    await page.click(SKIP);
    await advanceBy(page, 23_000); // through the final-seconds countdown of work 1
    let d = await cues(page);
    assert.deepEqual(d.spoken.slice(c.spoken.length), [], 'no speech with audio off');
    assert.equal(d.buzz, c.buzz, 'no vibration with vibration off');
    assert.equal((await readPlayer(page)).status, 'running', 'the workout carries on silently');

    // work: audio on only -> speech but no vibration at the next change
    await page.click(AUDIO);
    p = await readPlayer(page);
    assert.deepEqual([p.kind, p.audio, p.vibration], ['work', 'true', 'false']);
    c = await cues(page);
    await page.click(SKIP);
    d = await cues(page);
    assert.ok(d.spoken.slice(c.spoken.length).some((s) => /^Rest\. Next up/.test(s)), 'speech is back');
    assert.equal(d.buzz, c.buzz, 'vibration stays off independently');

    // transition: vibration on, audio off -> vibration but no speech
    await page.click(AUDIO);
    await page.click(VIBRATION);
    p = await readPlayer(page);
    assert.deepEqual([p.kind, p.audio, p.vibration], ['transition', 'false', 'true']);
    c = await cues(page);
    await page.click(SKIP);
    d = await cues(page);
    assert.deepEqual(d.spoken.slice(c.spoken.length), [], 'audio stays off independently');
    assert.ok(d.buzz > c.buzz, 'vibration is back');

    // While paused the toggles still flip.
    await page.click(PAUSE);
    await page.click(AUDIO);
    assert.equal((await readPlayer(page)).audio, 'true');
    await page.click(VIBRATION);
    assert.equal((await readPlayer(page)).vibration, 'false');
    assert.equal((await readPlayer(page)).status, 'paused', 'toggles never change the workout state');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------- end

test('criterion 8: End asks first in every state, Keep going resumes, and End discards the session', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { paused: true });
  try {
    const names = await homeNames(page);
    await page.click(START);
    const t0 = await now(page);

    // prep: End -> confirmation, paused underneath; Keep going -> resume countdown.
    await advanceTo(page, t0 + 4_500);
    await page.click(END);
    assert.equal(await dialogOpen(page), true, 'End asks for confirmation');
    assert.match(await page.textContent('#end-dialog'), /End this workout\?/);
    let p = await readPlayer(page);
    assert.equal(p.status, 'paused', 'the timer is held while the question is open');
    const left = p.left;
    await advanceBy(page, 5_000);
    assert.equal((await readPlayer(page)).left, left);
    await page.click('#end-dialog [data-action="keep"]');
    assert.equal(await dialogOpen(page), false);
    assert.equal((await readPlayer(page)).status, 'resuming');
    await advanceBy(page, 3_100);

    // work: Escape in the dialog means Keep going.
    await advanceTo(page, t0 + 8_100 + 15_000);
    assert.equal((await readPlayer(page)).kind, 'work');
    await page.click(END);
    assert.equal(await dialogOpen(page), true);
    await page.keyboard.press('Escape');
    assert.equal(await dialogOpen(page), false);
    assert.equal((await readPlayer(page)).status, 'resuming');
    await advanceBy(page, 3_100);

    // Already paused: End then Keep going leaves it paused.
    await page.click(PAUSE);
    await page.click(END);
    await page.click('#end-dialog [data-action="keep"]');
    assert.equal((await readPlayer(page)).status, 'paused', 'Keep going does not unpause a workout the user paused');
    await page.click(RESUME_BIG);
    await advanceBy(page, 3_100);

    // transition: End -> confirm.
    for (let i = 0; i < 5 && (await readPlayer(page)).kind !== 'transition'; i++) await page.click(SKIP);
    p = await readPlayer(page);
    assert.equal(p.kind, 'transition');
    await page.click(END);
    await page.click('#end-dialog [data-action="confirm-end"]');
    assert.equal(await screenName(page), 'home', 'End returns home');
    assert.deepEqual(await homeNames(page), names, 'home shows the same workout');
    const after = await page.evaluate(() => ({
      dialog: document.getElementById('end-dialog').open,
      playerHidden: document.getElementById('screen-player').hidden,
      playerFigure: Boolean(document.querySelector('#screen-player .pl-figure svg, #screen-player .pl-figure .fig-strip')),
      focus: document.activeElement?.dataset.action ?? null,
    }));
    assert.deepEqual(after, { dialog: false, playerHidden: true, playerFigure: false, focus: 'start' });

    // The session is gone: time passing changes nothing, and Start begins from zero.
    await advanceBy(page, 30_000);
    assert.equal(await screenName(page), 'home');
    await page.click(START);
    p = await readPlayer(page);
    assert.deepEqual(
      [p.kind, p.status, p.left, p.ring, p.count, p.name, p.segStates.filter((s) => s === 'done').length],
      ['prep', 'running', '7:00', '10', 'Move 1 of 12', names[0], 0],
      'a new session starts from the beginning',
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------- easier version

test('criterion 8 / Requirement 23: the easier version switches in prep, work and transition without stopping the timer', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { paused: true });
  try {
    const names = await homeNames(page);
    const [m1, m2] = names.map(movementByName);
    await page.click(START);
    const t0 = await now(page);

    const toggle = async (expectChecked) => {
      const before = await readPlayer(page);
      await page.click(EASIER);
      const p = await readPlayer(page);
      assert.equal(p.easier, String(expectChecked));
      assert.equal(p.status, 'running', 'switching never pauses');
      assert.equal(p.ring, before.ring, 'switching never resets the interval');
      assert.equal(p.left, before.left);
      assert.equal(p.kind, before.kind);
      return p;
    };

    // prep: switch the upcoming first movement.
    await advanceTo(page, t0 + 3_500);
    let p = await toggle(true);
    assert.equal(p.name, m1.alt.name);
    assert.equal(p.cue, m1.alt.cue);
    assert.equal(p.figureLabel, m1.alt.description, 'the demonstration swaps to the easier version');
    assert.ok(p.easierBadge, 'an "Easier version" badge says so in text');

    // The choice carries into the work interval.
    await advanceTo(page, t0 + 10_500);
    p = await readPlayer(page);
    assert.deepEqual([p.kind, p.name, p.easier, p.ring], ['work', m1.alt.name, 'true', '25']);

    // work: back to standard mid-interval, timer keeps going.
    await advanceTo(page, t0 + 20_500);
    p = await toggle(false);
    assert.equal(p.name, m1.name);
    assert.equal(p.figureLabel, m1.description);
    assert.equal(p.ring, '15');
    await advanceTo(page, t0 + 22_500);
    p = await readPlayer(page);
    assert.equal(p.ring, '13', 'the timer ran on through the switch');
    p = await toggle(true);
    assert.equal(p.name, m1.alt.name);

    // transition: the switch targets the upcoming movement.
    await advanceTo(page, t0 + 38_500);
    p = await toggle(true);
    assert.equal(p.kind, 'transition');
    assert.equal(p.name, m2.alt.name);
    assert.equal(p.figureLabel, m2.alt.description);
    await advanceTo(page, t0 + 45_500);
    p = await readPlayer(page);
    assert.deepEqual([p.kind, p.name, p.ring], ['work', m2.alt.name, '25']);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------- keyboard and reduced motion

test('criterion 15: keyboard reaches Start, Preview and Shuffle; Space pauses; Escape asks before ending', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { paused: true, context: DESKTOP });
  try {
    const focused = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        const cs = a ? getComputedStyle(a) : null;
        return {
          action: a?.dataset?.action ?? null,
          label: a?.getAttribute?.('aria-label') ?? null,
          outline: cs ? `${cs.outlineStyle} ${cs.outlineWidth}` : null,
        };
      });
    const order = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const f = await focused();
      order.push(f.action ?? f.label);
      if (f.action === 'start') assert.doesNotMatch(f.outline, /^none|\b0px$/, `visible focus ring on Start (${f.outline})`);
    }
    const iStart = order.indexOf('start');
    const iPreview = order.indexOf('preview');
    const iShuffle = order.indexOf('shuffle');
    assert.ok(iStart >= 0 && iPreview > iStart && iShuffle > iPreview, `Tab order reaches Start, Preview, Shuffle: ${order.join(', ')}`);

    // Shuffle and Preview from the keyboard.
    const names = await homeNames(page);
    await page.focus('#screen-home [data-action="shuffle"]');
    await page.keyboard.press('Enter');
    const shuffled = await homeNames(page);
    assert.notDeepEqual(shuffled, names, 'Enter on Shuffle');
    await page.keyboard.press('Space');
    assert.notDeepEqual(await homeNames(page), shuffled, 'Space on Shuffle');
    await page.focus('#screen-home [data-action="preview"]');
    await page.keyboard.press('Enter');
    await page.locator('#preview-sheet').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.getElementById('preview-sheet').contains(document.activeElement)), true, 'focus moves into the preview');
    await page.keyboard.press('Escape');
    await page.locator('#preview-sheet').waitFor({ state: 'hidden' });
    assert.equal((await focused()).action, 'start', 'focus returns to Start');

    // Start with Enter; focus lands on Pause.
    await page.keyboard.press('Enter');
    assert.equal(await screenName(page), 'player');
    assert.equal((await focused()).action, 'pause', 'focus moves to the main control');
    await page.keyboard.press('Space');
    assert.equal((await readPlayer(page)).status, 'paused', 'Space on the focused control pauses');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Space');
    assert.equal((await readPlayer(page)).status, 'resuming', 'Space anywhere resumes (with the countdown)');
    await advanceBy(page, 3_100);
    await page.keyboard.press('Space');
    assert.equal((await readPlayer(page)).status, 'paused', 'Space anywhere pauses');
    await page.keyboard.press('Space');
    await advanceBy(page, 3_100);

    // Escape asks; Escape again keeps going; Escape, Tab, Enter ends.
    await page.keyboard.press('Escape');
    assert.equal(await dialogOpen(page), true, 'Escape asks before ending');
    assert.equal((await focused()).action, 'keep', 'the safe choice has focus');
    await page.keyboard.press('Escape');
    assert.equal(await dialogOpen(page), false);
    assert.equal(await screenName(page), 'player');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    assert.equal((await focused()).action, 'confirm-end');
    await page.keyboard.press('Enter');
    assert.equal(await screenName(page), 'home');
    assert.equal((await focused()).action, 'start', 'focus returns to Start after ending');

    // Finish and leave the finish screen from the keyboard.
    await page.keyboard.press('Enter');
    await advanceBy(page, 421_000);
    assert.equal(await screenName(page), 'finish');
    for (let i = 0; i < 4 && (await focused()).action !== 'done'; i++) await page.keyboard.press('Tab');
    assert.equal((await focused()).action, 'done', 'Done is reachable by Tab');
    await page.keyboard.press('Enter');
    assert.equal(await screenName(page), 'home');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('criterion 15: reduced motion replaces animated demonstrations with key-pose strips and stops looping animation', async () => {
  const count = async (reducedMotion) => {
    const { context, page, errors } = await openApp(browser, server.url, { paused: true, context: { reducedMotion } });
    try {
      await page.click('#screen-home [data-action="preview"]');
      await page.locator('#preview-sheet').waitFor({ state: 'visible' });
      const preview = await page.evaluate(() => ({
        strips: document.querySelectorAll('#preview-sheet .pv-demo .fig-strip').length,
        animated: document.querySelectorAll('#preview-sheet .pv-demo .fig-wrap').length,
      }));
      await page.keyboard.press('Escape');
      await page.click(START);
      const t0 = await now(page);
      await advanceTo(page, t0 + 8_500); // final seconds of prep: the most animated moment
      await page.waitForTimeout(300); // let CSS animations start on the real compositor clock
      const player = await page.evaluate(() => ({
        strip: Boolean(document.querySelector('#screen-player .pl-figure .fig-strip')),
        animated: Boolean(document.querySelector('#screen-player .pl-figure .fig-wrap')),
        looping: document
          .getAnimations()
          .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity)
          .map((a) => a.animationName ?? 'animation'),
      }));
      assert.deepEqual(errors, []);
      return { preview, player };
    } finally {
      await context.close();
    }
  };
  const normal = await count('no-preference');
  assert.deepEqual(normal.preview, { strips: 0, animated: 12 }, 'animated demonstrations by default');
  assert.equal(normal.player.animated, true);
  assert.ok(normal.player.looping.length > 0, 'control: the final-seconds pulse loops without reduced motion');
  const reduced = await count('reduce');
  assert.deepEqual(reduced.preview, { strips: 12, animated: 0 }, 'key-pose strips in the preview');
  assert.equal(reduced.player.strip, true, 'key-pose strip in the player');
  assert.equal(reduced.player.animated, false);
  assert.deepEqual(reduced.player.looping, [], 'no looping animation with reduced motion');
});
