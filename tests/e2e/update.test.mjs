// Acceptance criterion 14: a newly deployed service worker never replaces assets during an
// active workout and offers Refresh afterwards. Requirements 40, 41.
//
// "Deploying" release B = serving a changed sw.js and js/config.js through the test proxy, the way
// README "Release a change" does it (APP_VERSION bumped, sw.js re-stamped with the new
// CACHE_VERSION). The repository files are never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../../tools/pw.mjs';
import {
  startProxy, openApp, closeAll, readPlayer, screenName, waitForOfflineReady, waitFor, appVersion,
  setVisibility, BASE,
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

function deploy(server, version) {
  server.override(`${BASE}sw.js`, (src) => src.replace(/const CACHE_VERSION = '[^']+';/, `const CACHE_VERSION = '${version}';`));
  server.override(`${BASE}js/config.js`, (src) => src.replace(/APP_VERSION = '[^']+'/, `APP_VERSION = '${version}'`));
}

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

    await page.click(START);
    await page.clock.fastForward(20_000);
    const nameBefore = (await readPlayer(page)).name;

    deploy(server, B);
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
    assert.ok(live.caches.includes(`his-ability-${A}`), 'the live cache is untouched');
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
    assert.deepEqual(await page.evaluate(() => caches.keys()), [`his-ability-${B}`], 'the old cache was removed');
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
    deploy(server, B);
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
  // release (exactly what commit ec7559d did: new fingerprint, CACHE_VERSION still 1.0.0) is
  // picked up as an update. Its worker must not write into the cache the running version serves.
  const server = await startProxy();
  const { context, page, errors } = await installedApp(server);
  try {
    await page.click(START);
    await page.clock.fastForward(20_000);
    const MARK = '/* release B, same APP_VERSION */';
    server.override(`${BASE}js/config.js`, (src) => `${src}\n${MARK}\n`);
    server.override(`${BASE}sw.js`, (src) => src.replace(/\/\/ fingerprint [0-9a-f]+/, '// fingerprint 0123456789abcdef'));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await waitFor(() => hasWaitingWorker(page), { message: 'the re-stamped release installed and waiting' });

    assert.equal(await screenName(page), 'player');
    assert.equal(await updateToast(page), null);
    const served = await page.evaluate(async () => (await fetch('js/config.js')).text());
    assert.ok(!served.includes(MARK), 'the running version must keep serving its own files until Refresh, but its cache now holds the new release');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await server.close();
  }
});
