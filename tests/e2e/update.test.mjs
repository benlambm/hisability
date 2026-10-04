// Acceptance criterion 14: a newly deployed service worker never replaces assets during an
// active workout and offers Refresh afterwards. Requirements 40, 41.
//
// "Deploying" release B = serving a changed js/config.js and a sw.js re-stamped by
// tools/stamp-sw.mjs's own stampSource() (new fingerprint/BUILD, and the new CACHE_VERSION when
// APP_VERSION is bumped), the way README "Release a change" does it. Only the proxy's responses
// change; the repository files are never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../../tools/pw.mjs';
import { stampSource } from '../../tools/stamp-sw.mjs';
import {
  startProxy, openApp, closeAll, readPlayer, screenName, waitForOfflineReady, waitFor, appVersion,
  setVisibility, swAssets, BASE,
} from './helpers.mjs';

let browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await closeAll(browser);
});

const A = appVersion();
const B = A.replace(/(\d+)$/, (n) => String(Number(n) + 1));
const START = '#screen-home [data-action="start"]';
const UPDATE_TOAST = '#toasts [data-toast="update"]';

/**
 * Serve release `version` with a changed js/config.js (it carries `marker`), and sw.js re-stamped
 * the way tools/stamp-sw.mjs does after any file change (`print` stands in for the new fingerprint).
 */
function deploy(server, { version = A, print = 'b0b0b0b0b0b0b0b0', marker = `/* release ${print} */` } = {}) {
  server.override(`${BASE}js/config.js`, (src) => `${src.replace(/APP_VERSION = '[^']+'/, `APP_VERSION = '${version}'`)}\n${marker}\n`);
  server.override(`${BASE}sw.js`, (src) =>
    stampSource(src, { version, files: swAssets(src).filter((a) => a !== './'), print }),
  );
  return marker;
}

const cacheNames = (page) => page.evaluate(async () => (await caches.keys()).sort());

const hasWaitingWorker = (page) =>
  page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));

const updateToast = (page) =>
  page.evaluate((sel) => {
    const t = document.querySelector(sel);
    return t && !t.classList.contains('is-leaving')
      ? { text: t.querySelector('.toast-text')?.textContent, buttons: [...t.querySelectorAll('button')].map((b) => b.textContent) }
      : null;
  }, UPDATE_TOAST);

async function aboutVersion(page) {
  await page.click('#screen-home .info-btn');
  const text = await page.textContent('#about-sheet .about-version');
  await page.keyboard.press('Escape');
  return text;
}

/** Version A installed and controlling, opened the way an installed app opens. */
async function installedApp(server) {
  const opened = await openApp(browser, server.url, { clock: true });
  await waitForOfflineReady(opened.page);
  await opened.page.reload();
  await opened.page.waitForSelector('#screen-home .move-row');
  await waitFor(() => opened.page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { message: 'controlled after reload' });
  return opened;
}

test('criterion 14: an update found mid-workout waits; afterwards Refresh reloads once into the new version', async () => {
  const server = await startProxy();
  const { context, page, errors } = await installedApp(server);
  try {
    let loads = 0;
    page.on('load', () => loads++);
    await page.evaluate(() => {
      window.__sameDocument = true;
    });

    const cachesA = await cacheNames(page);
    assert.equal(cachesA.length, 1);
    assert.ok(cachesA[0].startsWith(`his-ability-${A}`), `release A cache: ${cachesA[0]}`);

    await page.click(START);
    await page.clock.fastForward(20_000);
    const nameBefore = (await readPlayer(page)).name;

    const marker = deploy(server, { version: B });
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await waitFor(() => hasWaitingWorker(page), { message: 'release B installed and waiting' });

    // During the workout: no offer, no reload, no swap.
    await page.clock.fastForward(30_000);
    await page.clock.runFor(100);
    await page.waitForTimeout(500);
    const p = await readPlayer(page);
    assert.equal(p.screen, 'player');
    assert.equal(p.status, 'running', 'the workout keeps running');
    assert.equal(await updateToast(page), null, 'no update offer over an active workout');
    assert.equal(loads, 0, 'no reload during the workout');
    assert.equal(await page.evaluate(() => window.__sameDocument), true, 'same document');
    const live = await page.evaluate(async () => ({
      caches: (await caches.keys()).sort(),
      config: await (await fetch('js/config.js')).text(),
    }));
    assert.match(live.config, new RegExp(`APP_VERSION = '${A.replace(/\./g, '\\.')}'`), 'the running version still serves its own files');
    assert.ok(!live.config.includes(marker), 'no release B bytes are served before Refresh');
    assert.ok(live.caches.includes(cachesA[0]), 'the live cache is still there');
    assert.equal(live.caches.length, 2, `release B precached into a cache of its own: ${live.caches.join(', ')}`);
    assert.ok(nameBefore && p.name, 'the player kept showing the workout');

    // Finish the workout: the offer appears on the finish screen.
    for (let i = 0; i < 40 && (await screenName(page)) === 'player'; i++) await page.clock.fastForward(15_000);
    assert.equal(await screenName(page), 'finish');
    const toast = await waitFor(() => updateToast(page), { message: 'the update toast after the workout' });
    assert.equal(toast.text, 'A new version is ready');
    assert.ok(toast.buttons.includes('Refresh'), `Refresh offered (${toast.buttons.join(', ')})`);
    assert.equal(loads, 0);

    // Refresh: exactly one reload, into release B.
    const loaded = page.waitForEvent('load');
    await page.locator(UPDATE_TOAST).getByRole('button', { name: 'Refresh' }).click();
    await loaded;
    await page.waitForSelector('#screen-home .move-row');
    await page.waitForTimeout(1_500);
    await page.clock.fastForward(6_000); // past the 4 s reload fallback timer, had it survived
    await page.waitForTimeout(500);
    assert.equal(loads, 1, 'reloaded exactly once');
    assert.equal(await page.evaluate(() => window.__sameDocument), undefined, 'a new document');
    assert.equal(await aboutVersion(page), `Version ${B}`, 'running the new release');
    const after = await cacheNames(page);
    assert.equal(after.length, 1, `the old cache was removed: ${after.join(', ')}`);
    assert.ok(after[0].startsWith(`his-ability-${B}`), `release B cache: ${after[0]}`);
    assert.ok((await page.evaluate(async () => (await fetch('js/config.js')).text())).includes(marker), 'release B files are served now');
    assert.equal(await hasWaitingWorker(page), false);
    assert.equal(await updateToast(page), null, 'nothing left to offer');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await server.close();
  }
});

test('criterion 14: an update found on opening is offered at home, withdrawn during a workout, re-offered after End', async () => {
  const server = await startProxy();
  const { context, page, errors } = await installedApp(server);
  try {
    // Release B is deployed while the app is closed; opening the app finds it.
    deploy(server, { version: B });
    let loads = 0;
    page.on('load', () => loads++);
    await page.reload();
    await page.waitForSelector('#screen-home .move-row');
    const offer = await waitFor(() => updateToast(page), { message: 'the update offer on opening' });
    assert.equal(offer.text, 'A new version is ready');
    assert.equal(loads, 1);

    // Starting a workout withdraws the offer; nothing reloads while it runs.
    await page.click(START);
    assert.equal(await updateToast(page), null, 'the offer never covers the player');
    await page.clock.fastForward(60_000);
    await page.waitForTimeout(300);
    assert.equal(await screenName(page), 'player');
    assert.equal(loads, 1);

    // End brings it back; Later dismisses it without reloading.
    await page.click('#screen-player [data-action="end"]');
    await page.click('#end-dialog [data-action="confirm-end"]');
    const again = await waitFor(() => updateToast(page), { message: 'the offer after End' });
    assert.ok(again.buttons.includes('Later'));
    await page.locator(UPDATE_TOAST).getByRole('button', { name: 'Later' }).click();
    await page.waitForTimeout(800);
    assert.equal(await updateToast(page), null);
    assert.equal(loads, 1, 'Later does not reload');
    assert.equal(await aboutVersion(page), `Version ${A}`, 'still on the old release');

    // Returning to the app offers it again; Refresh then applies it.
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await waitFor(() => updateToast(page), { message: 'the offer when the app is visible again' });
    const loaded = page.waitForEvent('load');
    await page.locator(UPDATE_TOAST).getByRole('button', { name: 'Refresh' }).click();
    await loaded;
    await page.waitForSelector('#screen-home .move-row');
    await page.waitForTimeout(1_000);
    assert.equal(loads, 2, 'one reload for the update');
    assert.equal(await aboutVersion(page), `Version ${B}`);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await server.close();
  }
});

test('criterion 14: a release that changes files without bumping APP_VERSION leaves the live cache alone during a workout', async () => {
  // tools/stamp-sw.mjs rewrites the sw.js fingerprint whenever a shipped file changes, so such a
  // release (e.g. commit ec7559d: new fingerprint, CACHE_VERSION still 1.0.0) is picked up as an
  // update. Its worker must not write into the cache the running version serves.
  const server = await startProxy();
  const { context, page, errors } = await installedApp(server);
  try {
    const cachesA = await cacheNames(page);
    await page.click(START);
    await page.clock.fastForward(20_000);
    const marker = deploy(server, { version: A, print: '0123456789abcdef' });
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await waitFor(() => hasWaitingWorker(page), { message: 'the re-stamped release installed and waiting' });

    assert.equal(await screenName(page), 'player');
    assert.equal(await updateToast(page), null);
    const served = await page.evaluate(async () => (await fetch('js/config.js')).text());
    assert.ok(!served.includes(marker), 'the running version keeps serving its own files until Refresh');
    const during = await cacheNames(page);
    assert.ok(during.includes(cachesA[0]) && during.length === 2, `the new build has its own cache: ${during.join(', ')}`);

    // After the workout, Refresh switches to the new build and drops the old cache.
    await page.click('#screen-player [data-action="end"]');
    await page.click('#end-dialog [data-action="confirm-end"]');
    await waitFor(() => updateToast(page), { message: 'the offer after End' });
    const loaded = page.waitForEvent('load');
    await page.locator(UPDATE_TOAST).getByRole('button', { name: 'Refresh' }).click();
    await loaded;
    await page.waitForSelector('#screen-home .move-row');
    await waitFor(async () => (await cacheNames(page)).length === 1, { message: 'the old build cache to be removed' });
    assert.notDeepEqual(await cacheNames(page), cachesA);
    assert.ok((await page.evaluate(async () => (await fetch('js/config.js')).text())).includes(marker));
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await server.close();
  }
});
