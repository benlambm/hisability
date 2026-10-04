// Acceptance criterion 11: after one online load, airplane mode permits launch, generation,
// preview, shuffle and completion. Requirements 38, 39, 40.
//
// Playwright's context.setOffline() does not stop service-worker fetches, so the test really
// takes the network away: the server is closed (every socket destroyed) and the context is also
// set offline so the page sees navigator.onLine === false, like airplane mode.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../../tools/pw.mjs';
import {
  startProxy, closeAll, homeNames, readFinish, readPlayer, screenName, assertValidWorkout,
  waitForOfflineReady, swAssets, waitFor, PHONE, CLOCK_ORIGIN, BASE,
} from './helpers.mjs';

let browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await closeAll(browser);
});

test('criterion 11: after one online load, launch, generate, preview, shuffle and a full workout work with no network', async () => {
  const server = await startProxy();
  const context = await browser.newContext(PHONE);
  const errors = [];
  const failures = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      // A failed background update check is the browser's own log line, not an app error.
      if (m.type() === 'error' && !/ServiceWorker|service worker|sw\.js/i.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    page.on('requestfailed', (r) => {
      if (r.url().startsWith(server.url) && !r.url().endsWith('/sw.js')) failures.push(`${r.url()} ${r.failure()?.errorText}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
  };
  try {
    let page = await context.newPage();
    watch(page);
    await page.clock.install({ time: CLOCK_ORIGIN });
    await page.goto(server.url);
    await page.waitForSelector('#screen-home .move-row');
    await waitForOfflineReady(page);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const c = await caches.open(names[0]);
      return (await c.keys()).map((r) => new URL(r.url).pathname);
    });
    for (const a of swAssets()) {
      const path = a === './' ? BASE : BASE + a;
      assert.ok(cached.includes(path), `precached ${path}`);
    }
    const online = await homeNames(page);

    // Airplane mode: the server is gone and the browser reports offline.
    await server.goOffline();
    await context.setOffline(true);
    const reachable = await fetch(server.url).then(() => true, () => false);
    assert.equal(reachable, false, 'the server really is unreachable');

    // Relaunch (reload) and a fresh launch in a new tab.
    await page.reload();
    await page.waitForSelector('#screen-home .move-row');
    const relaunched = await homeNames(page);
    assertValidWorkout(relaunched, 'offline relaunch');
    assert.notDeepEqual(relaunched, online, 'a new workout is generated offline');
    await page.close();

    page = await context.newPage();
    watch(page);
    await page.goto(server.url);
    await page.waitForSelector('#screen-home .move-row');
    const launched = await homeNames(page);
    assertValidWorkout(launched, 'offline launch');
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    assert.equal(await page.locator('#screen-home .note-offline').count(), 0, 'no "offline not ready" warning');

    // Preview: all 12 with demonstrations and the timing.
    await page.click('#screen-home [data-action="preview"]');
    await page.locator('#preview-sheet').waitFor({ state: 'visible' });
    assert.deepEqual(await page.locator('#preview-sheet .pv-name').allTextContents(), launched);
    assert.equal(await page.locator('#preview-sheet .pv-demo svg, #preview-sheet .pv-demo .fig-strip').count(), 12);
    assert.match(await page.textContent('#preview-sheet .pv-timing'), /Total 7:00/);
    await page.keyboard.press('Escape');

    // Shuffle.
    await page.click('#screen-home [data-action="shuffle"]');
    const shuffled = await homeNames(page);
    assert.notDeepEqual(shuffled, launched);
    assertValidWorkout(shuffled, 'offline shuffle');

    // About reports offline readiness.
    await page.click('#screen-home .info-btn');
    assert.match(await page.textContent('#about-sheet .about-status'), /Ready to work offline/);
    await page.keyboard.press('Escape');

    // A complete workout, fast-forwarded.
    await page.click('#screen-home [data-action="start"]');
    assert.equal((await readPlayer(page)).figure, true, 'the demonstration renders offline');
    for (let i = 0; i < 40 && (await screenName(page)) === 'player'; i++) {
      await page.clock.fastForward(15_000);
      await page.clock.runFor(50);
    }
    const fin = await readFinish(page);
    assert.equal(fin.screen, 'finish');
    assert.deepEqual(fin.stats, ['7:00', '12 of 12']);
    await page.click('[data-action="another"]');
    assertValidWorkout(await homeNames(page), 'generate another offline');

    // Navigation fallbacks: the shell by name, and an unknown address inside the scope.
    await page.goto(`${server.url}index.html`);
    await page.waitForSelector('#screen-home .move-row');
    await page.goto(`${server.url}some/deep/link`);
    await waitFor(() => page.url() === server.url, { message: `redirect to the app root (at ${page.url()})` });
    await page.waitForSelector('#screen-home .move-row');

    assert.deepEqual(failures, [], 'no app request failed offline');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await server.close();
  }
});

test('Requirement 42: when the first offline save fails, the app stays usable online and says offline is not ready', async () => {
  const server = await startProxy();
  // One precached file is missing on the server: cache.addAll() rejects and the install fails.
  server.override(`${BASE}sw.js`, (src) => src.replace("'css/app.css',", "'css/app.css',\n  'missing-file-for-test.css',"));
  const context = await browser.newContext(PHONE);
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForSelector('#screen-home .move-row');
    const note = page.locator('#screen-home .note-offline');
    await note.waitFor({ timeout: 10_000 });
    assert.match(await note.textContent(), /Offline use is not ready yet/);
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), false);
    // Everything still works online.
    assert.equal(await page.isEnabled('#screen-home [data-action="start"]'), true);
    await page.click('#screen-home [data-action="shuffle"]');
    await page.click('#screen-home [data-action="start"]');
    assert.equal(await screenName(page), 'player');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await server.close();
  }
});
