// UI smoke tests: the real app served at /hisability/ (GitHub Pages layout) in Chromium.
//   npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../tools/serve.mjs';
import { chromium } from '../../tools/pw.mjs';

let server;
let browser;

before(async () => {
  server = await startServer({ port: 0 });
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };

async function openApp({ clock = false, context: ctxOpts = {} } = {}) {
  const context = await browser.newContext({ ...PHONE, ...ctxOpts });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  if (clock) await page.clock.install({ time: 1_000_000 });
  await page.goto(server.url);
  await page.waitForSelector('#screen-home .move-row');
  return { context, page, errors };
}

const names = (page) => page.locator('#screen-home .move-name').allTextContents();
const screenName = (page) => page.evaluate(() => document.body.dataset.screen);
const playerAttr = (page, name) => page.getAttribute('#screen-player', `data-${name}`);

test('app loads at /hisability/ with no console errors and shows a ready workout', async () => {
  const { context, page, errors } = await openApp();
  try {
    assert.equal(await page.title(), 'His Ability');
    assert.match(await page.textContent('#screen-home .motto'), /From each according to his ability/);
    assert.equal(await page.locator('#screen-home .move-row').count(), 12);
    assert.match(await page.textContent('#screen-home .workout-time'), /^7:00$/);
    const cats = await page.locator('#screen-home .move-cat').allTextContents();
    for (const label of ['Lower body', 'Upper body', 'Core', 'Cardio']) {
      assert.equal(cats.filter((c) => c.includes(label)).length, 3, `three ${label} movements`);
    }
    assert.equal(await page.isEnabled('#screen-home [data-action="start"]'), true);
    // Let registration and any async work settle, then check the console stayed clean.
    await page.waitForTimeout(800);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('preview lists all 12 with demonstrations and never changes the workout', async () => {
  const { context, page, errors } = await openApp();
  try {
    const before = await names(page);
    await page.click('#screen-home [data-action="preview"]');
    const sheet = page.locator('#preview-sheet');
    await sheet.waitFor({ state: 'visible' });
    assert.equal(await sheet.locator('.pv-item').count(), 12);
    assert.equal(await sheet.locator('.pv-item .pv-demo svg.fig, .pv-item .pv-demo .fig-strip').count(), 12);
    assert.match(await sheet.textContent('.pv-timing'), /Total 7:00/);
    assert.deepEqual(await sheet.locator('.pv-name').allTextContents(), before, 'same order as home');
    // Start and Shuffle stay reachable in the sticky footer.
    assert.equal(await sheet.locator('.sheet-footer [data-action="start"]').isVisible(), true);
    assert.equal(await sheet.locator('.sheet-footer [data-action="shuffle"]').isVisible(), true);

    // The easier switch swaps the demo, then switching back restores it.
    const first = sheet.locator('.pv-item').first();
    const label = await first.locator('.pv-demo svg.fig').getAttribute('aria-label');
    await first.locator('[role="switch"]').click();
    assert.equal(await first.locator('[role="switch"]').getAttribute('aria-checked'), 'true');
    assert.notEqual(await first.locator('.pv-demo svg.fig').getAttribute('aria-label'), label);
    await first.locator('[role="switch"]').click();

    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    assert.deepEqual(await names(page), before, 'previewing did not change the workout');

    // Browser back closes the preview too (Android back).
    await page.click('#screen-home [data-action="preview"]');
    await sheet.waitFor({ state: 'visible' });
    await page.goBack();
    await sheet.waitFor({ state: 'hidden' });
    assert.equal(await screenName(page), 'home');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('shuffle replaces the whole sequence', async () => {
  const { context, page, errors } = await openApp();
  try {
    const before = (await names(page)).join('|');
    await page.click('#screen-home [data-action="shuffle"]');
    await page.waitForFunction((b) => {
      const now = [...document.querySelectorAll('#screen-home .move-name')].map((n) => n.textContent).join('|');
      return now !== b;
    }, before);
    assert.equal(await page.locator('#screen-home .move-row').count(), 12);
    assert.match(await page.textContent('#announcer'), /New workout ready|^$/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('about sheet explains timing, privacy, and offline status', async () => {
  const { context, page, errors } = await openApp();
  try {
    await page.click('#screen-home .info-btn');
    const sheet = page.locator('#about-sheet');
    await sheet.waitFor({ state: 'visible' });
    const text = await sheet.textContent();
    assert.match(text, /Nothing is recorded\. No accounts, no history, no tracking\./);
    assert.match(text, /Total 7:00/);
    assert.match(text, /Version \d+\.\d+\.\d+/);
    assert.match(text, /Ready to work offline|Getting ready for offline use|Offline use is not ready yet|Offline mode not supported/);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('player: start, pause, resume countdown, skip, and end with confirmation', async () => {
  const { context, page, errors } = await openApp({ clock: true });
  try {
    const before = await names(page);
    await page.click('#screen-home [data-action="start"]');
    await page.waitForSelector('#screen-player:not([hidden])');
    assert.equal(await screenName(page), 'player');
    await page.clock.runFor(500);
    assert.equal(await playerAttr(page, 'kind'), 'prep');
    assert.match(await page.textContent('.pl-state-text'), /Get ready/);
    assert.equal(await page.textContent('.pl-name'), before[0], 'prep shows the first movement');
    assert.match(await page.textContent('.pl-count'), /Move 1 of 12/);
    assert.equal(await page.locator('.pl-seg').count(), 12);
    for (const action of ['audio', 'vibration', 'pause', 'skip', 'easier', 'end']) {
      assert.equal(await page.locator(`#screen-player [data-action="${action}"]`).count(), 1, `${action} control`);
    }

    // Pause freezes the clock.
    await page.click('.ctl-pause');
    assert.equal(await playerAttr(page, 'status'), 'paused');
    assert.match(await page.textContent('.pl-state-text'), /Paused/);
    const frozen = await page.textContent('.pl-left');
    await page.clock.runFor(5000);
    assert.equal(await page.textContent('.pl-left'), frozen);

    // Resume runs a 3-second countdown first.
    await page.click('.pl-resume-big');
    assert.equal(await playerAttr(page, 'status'), 'resuming');
    assert.equal(await page.textContent('.pl-count-num'), '3');
    await page.clock.runFor(3200);
    assert.equal(await playerAttr(page, 'status'), 'running');

    // Skip: prep -> work 1 -> rest before 2.
    await page.click('.ctl-skip');
    assert.equal(await playerAttr(page, 'kind'), 'work');
    await page.clock.runFor(100);
    await page.click('.ctl-skip');
    assert.equal(await playerAttr(page, 'kind'), 'transition');
    assert.match(await page.textContent('.pl-count'), /Move 2 of 12/);
    assert.match(await page.textContent('.pl-state-text'), /Rest/);

    // Easier switch works mid-interval without stopping the timer.
    const name = await page.textContent('.pl-name');
    await page.click('.ctl-easier');
    assert.equal(await page.getAttribute('.ctl-easier', 'aria-checked'), 'true');
    assert.notEqual(await page.textContent('.pl-name'), name);
    assert.equal(await playerAttr(page, 'status'), 'running');

    // Space toggles pause from the keyboard.
    await page.locator('.pl-stage').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Space');
    assert.equal(await playerAttr(page, 'status'), 'paused');
    await page.keyboard.press('Space');
    assert.equal(await playerAttr(page, 'status'), 'resuming');

    // End asks first; Keep going resumes with the countdown.
    await page.clock.runFor(3200);
    await page.click('#screen-player [data-action="end"]');
    assert.equal(await page.evaluate(() => document.getElementById('end-dialog').open), true);
    assert.equal(await playerAttr(page, 'status'), 'paused');
    await page.click('#end-dialog [data-action="keep"]');
    assert.equal(await page.evaluate(() => document.getElementById('end-dialog').open), false);
    assert.equal(await playerAttr(page, 'status'), 'resuming');

    // Browser back during the workout opens the confirmation instead of leaving.
    await page.goBack();
    await page.waitForFunction(() => document.getElementById('end-dialog').open);
    assert.equal(await screenName(page), 'player');
    await page.click('#end-dialog [data-action="confirm-end"]');
    await page.waitForSelector('#screen-home:not([hidden])');
    assert.equal(await screenName(page), 'home');
    const after = await names(page);
    assert.equal(after.length, 12);
    assert.deepEqual(
      after.map((n, i) => (i === 1 ? before[1] : n)),
      before,
      'ending keeps the same workout (only the chosen easier version differs)',
    );
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('a whole workout runs to the finish screen: 7:00 and 12 of 12', async () => {
  const { context, page, errors } = await openApp({ clock: true });
  try {
    const before = await names(page);
    await page.click('#screen-home [data-action="start"]');
    await page.waitForSelector('#screen-player:not([hidden])');
    // Step through the whole session one second at a time (every segment is entered).
    for (let s = 0; s < 425; s++) {
      await page.clock.fastForward(1000);
      if (s % 50 === 49 && (await screenName(page)) === 'finish') break;
    }
    await page.waitForSelector('#screen-finish:not([hidden])');
    assert.equal(await screenName(page), 'finish');
    assert.match(await page.textContent('.fin-title'), /Workout complete/);
    const stats = await page.locator('.fin-stat-value').allTextContents();
    assert.deepEqual(stats, ['7:00', '12 of 12']);
    const message = await page.textContent('.fin-message');
    assert.ok(message.length > 10);
    assert.doesNotMatch(message, /weight|calorie|burn|streak|guilt|best|beat|missed|punish|today/i);

    // Done returns home with the same workout.
    await page.click('[data-action="done"]');
    await page.waitForSelector('#screen-home:not([hidden])');
    assert.deepEqual(await names(page), before);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('generate another workout from the finish screen', async () => {
  const { context, page, errors } = await openApp({ clock: true });
  try {
    const before = (await names(page)).join('|');
    await page.click('#screen-home [data-action="start"]');
    await page.waitForSelector('#screen-player:not([hidden])');
    // Skip through every interval quickly.
    for (let i = 0; i < 24 && (await screenName(page)) === 'player'; i++) {
      await page.click('.ctl-skip');
      await page.clock.runFor(50);
    }
    await page.waitForSelector('#screen-finish:not([hidden])');
    assert.match(await page.locator('.fin-stat-value').nth(1).textContent(), /^12 of 12$/);
    await page.click('[data-action="another"]');
    await page.waitForSelector('#screen-home:not([hidden])');
    assert.notEqual((await names(page)).join('|'), before);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('iPhone Safari gets Share > Add to Home Screen guidance, never an install prompt', async () => {
  const ua =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const { context, page, errors } = await openApp({ context: { userAgent: ua } });
  try {
    const note = page.locator('#screen-home .note-install');
    await note.waitFor();
    assert.match(await note.textContent(), /tap Share.*then Add to Home Screen/);
    assert.equal(await note.locator('[data-action="install"]').count(), 0, 'no install button on iOS');
    // Dismissible, and never blocks the main actions.
    await note.locator('.note-close').click();
    assert.equal(await page.locator('#screen-home .note-install').count(), 0);
    assert.equal(await page.isEnabled('#screen-home [data-action="start"]'), true);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('Escape during the workout asks before ending', async () => {
  const { context, page, errors } = await openApp({ context: { isMobile: false, hasTouch: false, viewport: { width: 1024, height: 768 } } });
  try {
    await page.click('#screen-home [data-action="start"]');
    await page.waitForSelector('#screen-player:not([hidden])');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('end-dialog').open);
    await page.keyboard.press('Escape'); // Escape inside the dialog means "Keep going"
    await page.waitForFunction(() => !document.getElementById('end-dialog').open);
    assert.equal(await screenName(page), 'player');
    assert.equal(await playerAttr(page, 'status'), 'resuming');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('player fits small phones without horizontal overflow', async () => {
  for (const viewport of [{ width: 375, height: 667 }, { width: 320, height: 568 }]) {
    const { context, page } = await openApp({ context: { viewport } });
    try {
      await page.click('#screen-home [data-action="start"]');
      await page.waitForSelector('#screen-player:not([hidden])');
      const m = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        sh: document.documentElement.scrollHeight,
        ch: document.documentElement.clientHeight,
      }));
      assert.ok(m.sw <= m.cw, `no horizontal scroll at ${viewport.width}`);
      if (viewport.width === 375) assert.ok(m.sh <= m.ch, 'player fits 375x667 without scrolling');
      else assert.ok(m.sh - m.ch <= 80, 'at most a small scroll at 320x568');
    } finally {
      await context.close();
    }
  }
});
