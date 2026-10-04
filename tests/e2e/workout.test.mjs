// Acceptance criteria 1, 2, 3, 5 and 7 (PRD section 8) in the real app, with an exact fake clock.
//   1  immediate generation      2  stable selection      3  effective shuffle
//   5  exact duration            7  complete guidance in every interval
// Requirements 1, 2, 11, 12, 13, 15, 17, 21, 25, 29.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../../tools/pw.mjs';
import { CATEGORY_LABELS } from '../../js/config.js';
import {
  startProxy, openApp, closeAll, homeNames, homeState, readPlayer, readFinish, screenName,
  assertValidWorkout, movementByName, now, advanceTo, reconcileNow, timeline, TOTAL_MS, clockSeconds,
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
const SHUFFLE = '#screen-home [data-action="shuffle"]';
const PREVIEW = '#screen-home [data-action="preview"]';

// Words that would mean the app reads or shows a date, weekday or time of day (Requirement 3).
// ("March" and "Good Morning" are movement names, "may" is ordinary English, so they are not listed.)
const DATE_WORDS =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|april|june|july|august|september|october|november|december|today|tonight|yesterday|tomorrow|this week|weekday|o'clock)\b|\b\d{1,2}:\d\d\s?(am|pm)\b|\b(19|20)\d\d\b/i;

async function shuffleAndWait(page, selector, read) {
  const beforeKey = (await read()).join('|');
  await page.click(selector);
  await page.waitForFunction(
    ({ key, sel }) => [...document.querySelectorAll(sel)].map((n) => n.textContent).join('|') !== key,
    { key: beforeKey, sel: selector.startsWith('#preview') ? '#preview-sheet .pv-name' : '#screen-home .move-name' },
  );
  return read();
}

// ---------------------------------------------------------------- criteria 1-3

test('criterion 1: a fresh launch shows one valid 12-movement workout with no goal, date or profile prompt', async () => {
  const { context, page, errors } = await openApp(browser, server.url);
  try {
    const home = await homeState(page);
    const moves = assertValidWorkout(home.names, 'fresh launch');
    assert.deepEqual(home.cats, moves.map((m) => m.category), 'each row carries its catalog category');
    const catText = await page.locator('#screen-home .move-cat').allTextContents();
    assert.deepEqual(catText, moves.map((m) => `, ${CATEGORY_LABELS[m.category]}`), 'category shown as text, not only color');
    assert.equal(home.time, '7:00');

    const ui = await page.evaluate(() => ({
      inputs: document.querySelectorAll('input, select, textarea, [contenteditable="true"]').length,
      openDialogs: [...document.querySelectorAll('dialog')].filter((d) => d.open).length,
      text: document.body.innerText,
      startEnabled: !document.querySelector('#screen-home [data-action="start"]').disabled,
      screen: document.body.dataset.screen,
    }));
    assert.equal(ui.screen, 'home');
    assert.equal(ui.inputs, 0, 'nothing to fill in before starting');
    assert.equal(ui.openDialogs, 0, 'no onboarding dialog');
    assert.ok(ui.startEnabled, 'Start is ready immediately');
    assert.doesNotMatch(ui.text, /\b(goal|profile|your age|sign in|log in|account|e-?mail|birthday)\b/i);
    assert.doesNotMatch(ui.text, DATE_WORDS, 'no date, weekday or time of day on the home screen');
    assert.doesNotMatch(ui.text, /today'?s workout|workout of the day/i, 'never claims a workout belongs to a day');

    // A second, independent launch gets its own workout.
    const second = await openApp(browser, server.url);
    try {
      const other = await homeNames(second.page);
      assertValidWorkout(other, 'second launch');
      assert.notDeepEqual(other, home.names, 'each launch generates a new workout');
    } finally {
      await second.context.close();
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('criterion 2: previewing (open, scroll, easier toggles, close, reopen) never changes the sequence', async () => {
  const { context, page, errors } = await openApp(browser, server.url);
  try {
    const original = await homeNames(page);
    const sheet = page.locator('#preview-sheet');
    for (let round = 0; round < 3; round++) {
      await page.click(PREVIEW);
      await sheet.waitFor({ state: 'visible' });
      const items = await page.evaluate(() =>
        [...document.querySelectorAll('#preview-sheet .pv-item')].map((li) => ({
          name: li.querySelector('.pv-name').textContent,
          cue: li.querySelector('.pv-cue').textContent,
          alt: li.querySelector('.pv-alt').textContent,
          demo: Boolean(li.querySelector('.pv-demo svg, .pv-demo .fig-strip')),
        })),
      );
      assert.deepEqual(items.map((i) => i.name), original, `round ${round}: preview shows the same order`);
      // Criterion 6 on the way: each item has its demo, primary cue and lower-impact alternative.
      items.forEach((it, i) => {
        const m = movementByName(original[i]);
        assert.ok(it.demo, `${it.name}: demonstration`);
        assert.equal(it.cue, m.cue, `${it.name}: primary form cue`);
        assert.ok(it.alt.includes(m.alt.name), `${it.name}: easier option ${m.alt.name}`);
      });
      if (round === 0) {
        await page.evaluate(() => {
          const s = document.querySelector('#preview-sheet .sheet-scroll');
          s.scrollTop = s.scrollHeight;
        });
        const sw = sheet.locator('.pv-item').nth(4).locator('[role="switch"]');
        await sw.click();
        assert.equal(await sw.getAttribute('aria-checked'), 'true');
        await sw.click();
        assert.equal(await sw.getAttribute('aria-checked'), 'false');
        await sheet.locator('.sheet-close').click();
      } else {
        await page.keyboard.press('Escape');
      }
      await sheet.waitFor({ state: 'hidden' });
      assert.deepEqual(await homeNames(page), original, `round ${round}: home unchanged after closing`);
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('criterion 3: Shuffle replaces the sequence with a different valid one and timing stays 7:00', async () => {
  const { context, page, errors } = await openApp(browser, server.url);
  try {
    const seen = new Set();
    let prev = await homeNames(page);
    seen.add(prev.join('|'));
    for (let i = 0; i < 8; i++) {
      const next = await shuffleAndWait(page, SHUFFLE, () => homeNames(page));
      assert.notDeepEqual(next, prev, `shuffle ${i + 1} changed the sequence`);
      assertValidWorkout(next, `shuffle ${i + 1}`);
      assert.equal(await page.textContent('#screen-home .workout-time'), '7:00', 'total unchanged');
      seen.add(next.join('|'));
      prev = next;
    }
    assert.equal(seen.size, 9, 'every shuffle produced a new sequence');

    // Shuffle from inside the preview refreshes the open preview and the home list together.
    await page.click(PREVIEW);
    await page.locator('#preview-sheet').waitFor({ state: 'visible' });
    const pvNames = () => page.locator('#preview-sheet .pv-name').allTextContents();
    const inPreview = await shuffleAndWait(page, '#preview-sheet .sheet-footer [data-action="shuffle"]', pvNames);
    assert.notDeepEqual(inPreview, prev);
    assertValidWorkout(inPreview, 'shuffle in preview');
    assert.deepEqual(await homeNames(page), inPreview, 'home and preview agree');
    assert.match(await page.textContent('#preview-sheet .pv-timing'), /Total 7:00/);
    assert.ok(await page.locator('#preview-sheet').isVisible(), 'preview stays open');
    assert.ok(await page.locator('#preview-sheet .sheet-footer [data-action="start"]').isVisible(), 'Start still reachable');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('Requirements 1, 2, 29, 54: reload (even mid-workout) generates a new workout and shows no trace of the old one', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { clock: true });
  try {
    const first = await homeNames(page);
    // Leave some session state behind: an easier choice and a workout in progress.
    await page.click(PREVIEW);
    await page.locator('#preview-sheet .pv-item').first().locator('[role="switch"]').click();
    await page.keyboard.press('Escape');
    await page.click(START);
    await page.waitForSelector('#screen-player:not([hidden])');
    await page.clock.fastForward(60_000);
    await page.clock.runFor(100);
    assert.equal(await screenName(page), 'player');

    await page.reload();
    await page.waitForSelector('#screen-home .move-row');
    const second = await homeNames(page);
    assertValidWorkout(second, 'after reload');
    assert.notDeepEqual(second, first, 'reload generates a new workout');
    const state = await page.evaluate(() => ({
      screen: document.body.dataset.screen,
      playerHidden: document.getElementById('screen-player').hidden,
      playerFigure: Boolean(document.querySelector('#screen-player svg.fig')),
      easierTags: document.querySelectorAll('#screen-home .tag-easier').length,
      openDialogs: [...document.querySelectorAll('dialog')].filter((d) => d.open).length,
      toasts: [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent),
      text: document.body.innerText,
    }));
    assert.equal(state.screen, 'home', 'an interrupted workout is never restored');
    assert.equal(state.playerHidden, true);
    assert.equal(state.playerFigure, false);
    assert.equal(state.easierTags, 0, 'easier choices are not remembered');
    assert.equal(state.openDialogs, 0);
    assert.deepEqual(state.toasts, []);
    assert.doesNotMatch(state.text, /resume|continue|last (time|workout)|previous|history|streak|completed|minutes (so far|total)/i);

    // Close and reopen (a new page in the same browser profile) is also fresh.
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(server.url);
    await reopened.waitForSelector('#screen-home .move-row');
    const third = await homeNames(reopened);
    assertValidWorkout(third, 'after reopening');
    assert.notDeepEqual(third, second);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------- criterion 5

test('criterion 5: from Start the workout finishes at exactly 420 s of clock time, not before', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { paused: true });
  try {
    const names = await homeNames(page);
    await page.click(START);
    const t0 = await now(page); // the clock is paused: Start happened at exactly t0
    let p = await readPlayer(page);
    assert.equal(p.kind, 'prep');
    assert.equal(p.left, '7:00', 'the countdown starts at 7:00 when the prep countdown begins');

    await advanceTo(page, t0 + 419_500);
    p = await readPlayer(page);
    assert.equal(p.screen, 'player', 'still in the player at 419.5 s');
    assert.equal(p.status, 'running');
    assert.equal(p.kind, 'work');
    assert.equal(p.count, 'Move 12 of 12');
    assert.equal(p.name, names[11], 'on the final movement');
    assert.equal(p.ring, '1');
    assert.equal(p.left, '0:01');

    // Millisecond boundary: sample the session at 419.999 s and at 420.000 s exactly.
    await page.clock.fastForward(t0 + 419_999 - (await now(page)));
    await reconcileNow(page);
    assert.equal(await screenName(page), 'player', 'not finished at 419.999 s');
    await page.clock.fastForward(1);
    await reconcileNow(page);
    assert.equal(await screenName(page), 'finish', 'finished at 420.000 s');

    await advanceTo(page, t0 + 420_500);
    const fin = await readFinish(page);
    assert.equal(fin.screen, 'finish');
    assert.equal(fin.title, 'Workout complete');
    assert.deepEqual(fin.stats, ['7:00', '12 of 12']);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('criterion 5: a 20 s pause plus the 3 s resume countdown finishes at 443 s; active time still 7:00', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { paused: true });
  try {
    await page.click(START);
    const t0 = await now(page);
    await advanceTo(page, t0 + 200_000);
    await page.click('#screen-player .ctl-pause'); // the pause reconciles at exactly 200 s
    const beforePause = await readPlayer(page);
    assert.equal(beforePause.status, 'paused');
    assert.equal(beforePause.left, '3:40');

    await advanceTo(page, t0 + 220_000);
    let p = await readPlayer(page);
    assert.equal(p.status, 'paused');
    assert.equal(p.left, '3:40', 'paused time does not count down');
    assert.equal(p.ring, beforePause.ring);

    await page.click('#screen-player .pl-resume-big');
    p = await readPlayer(page);
    assert.equal(p.status, 'resuming');
    assert.equal(p.resumeNum, '3');
    await advanceTo(page, t0 + 222_950);
    p = await readPlayer(page);
    assert.equal(p.status, 'resuming', 'still counting in at 2.95 s');
    assert.equal(p.left, '3:40', 'the resume countdown does not consume workout time');
    await advanceTo(page, t0 + 223_100);
    assert.equal((await readPlayer(page)).status, 'running');

    await advanceTo(page, t0 + 442_500);
    p = await readPlayer(page);
    assert.equal(p.screen, 'player', 'still running at 442.5 s');
    assert.equal(p.count, 'Move 12 of 12');
    assert.equal(p.ring, '1');

    await page.clock.fastForward(t0 + 442_999 - (await now(page)));
    await reconcileNow(page);
    assert.equal(await screenName(page), 'player', 'not finished at 442.999 s');
    await page.clock.fastForward(1);
    await reconcileNow(page);
    assert.equal(await screenName(page), 'finish', 'finished at 443.000 s (420 + 20 paused + 3 countdown)');

    await advanceTo(page, t0 + 443_500);
    const fin = await readFinish(page);
    assert.deepEqual(fin.stats, ['7:00', '12 of 12'], 'summary counts only active time');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------- criterion 7

test('criterion 7: every interval shows movement, demo, cue, countdown, ring, next movement and progress', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { paused: true });
  try {
    const names = await homeNames(page);
    const moves = names.map(movementByName);
    await page.click(START);
    const t0 = await now(page);
    const label = { prep: /^Get ready$/, work: /^Work$/, transition: /^Rest/ };

    for (const [index, seg] of timeline().entries()) {
      const where = `segment ${index} (${seg.kind}, move ${seg.move + 1})`;
      const samples = [];
      for (const pos of [seg.start + 1500, seg.end - 1200]) {
        await advanceTo(page, t0 + pos);
        const p = await readPlayer(page);
        samples.push(p);
        const m = moves[seg.move];
        assert.equal(p.screen, 'player', where);
        assert.equal(p.status, 'running', where);
        assert.equal(p.kind, seg.kind, where);
        assert.match(p.state, label[seg.kind], `${where}: state label is text`);
        assert.ok(p.eyebrow.includes(CATEGORY_LABELS[m.category]), `${where}: category label "${p.eyebrow}"`);
        assert.equal(p.name, names[seg.move], `${where}: movement name (the workout never changes)`);
        assert.equal(p.cue, m.cue, `${where}: form cue`);
        assert.ok(p.figure, `${where}: demonstration figure is on screen`);
        assert.equal(p.figureLabel, m.description, `${where}: demo has its accessible description`);
        assert.ok(p.ringArc, `${where}: circular countdown`);
        assert.equal(p.ring, String(Math.ceil((seg.end - pos) / 1000)), `${where}: countdown number`);
        assert.match(p.ringSr, /^\d+ seconds left in this /, `${where}: countdown for screen readers`);
        assert.equal(p.count, `Move ${seg.move + 1} of 12`, `${where}: overall progress`);
        assert.equal(p.left, `${Math.floor(Math.ceil((TOTAL_MS - pos) / 1000) / 60)}:${String(Math.ceil((TOTAL_MS - pos) / 1000) % 60).padStart(2, '0')}`, `${where}: time left`);
        assert.equal(p.segs, 12, `${where}: 12 progress segments`);
        assert.deepEqual(
          p.segStates,
          names.map((_, i) => (i < seg.move ? 'done' : i > seg.move ? 'todo' : seg.kind === 'work' ? 'current' : 'next')),
          `${where}: progress segments`,
        );
        if (seg.move + 1 < 12) {
          assert.equal(p.next, names[seg.move + 1], `${where}: next movement`);
          assert.equal(p.nextLabel, seg.kind === 'work' ? 'Next' : 'Then', where);
        } else {
          assert.equal(p.next, 'Last one', `${where}: says this is the last movement`);
        }
      }
      const [a, b] = samples;
      assert.ok(Number(b.ring) < Number(a.ring), `${where}: countdown decreases (${a.ring} -> ${b.ring})`);
      assert.ok(Number(b.ringOffset) > Number(a.ringOffset), `${where}: ring arc shrinks`);
      assert.ok(clockSeconds(b.left) < clockSeconds(a.left), `${where}: overall time left decreases`);
      assert.equal(b.final, 'true', `${where}: final seconds flagged`);
      assert.equal(a.final, 'false', where);
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
