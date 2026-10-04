// Acceptance criteria 9 and 10 at runtime: no tracking, no dates.
// Requirements 3, 28, 29, 51, 52, 53, 54.
//
// An init script (helpers.auditProbe) wraps Date, Intl date formatting, Temporal, timeOrigin,
// every storage API, permission/identity/location/notification APIs and every remote-call API,
// and records each call with its stack. A whole session is then driven through the real UI and
// the test asserts that no recorded call came from the app's own scripts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../../tools/pw.mjs';
import {
  startProxy, openApp, closeAll, homeNames, readFinish, readPlayer, screenName, now, advanceTo,
  auditProbe, appAuditCalls, waitForOfflineReady, setVisibility, waitFor, PHONE, BASE,
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

/** Everything the page can see of stored state, read without going through the app. */
function storageSnapshot(page) {
  return page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookie: document.cookie,
    idb: (await indexedDB.databases()).map((d) => d.name),
    caches: await caches.keys(),
  }));
}

test('audit probe self-check: a Date call made by app code is detected (positive control)', async () => {
  server.override(`${BASE}js/ui/messages.js`, (src) => `${src}\nexport const __auditControl = [Date.now(), new Date(), localStorage.length];\n`);
  const { context, page } = await openApp(browser, server.url, { initScripts: [auditProbe] });
  try {
    const calls = await appAuditCalls(page, server.origin);
    const apis = calls.map((c) => c.split('\n')[0]);
    assert.ok(apis.includes('Date.now'), `Date.now detected: ${apis.join(', ')}`);
    assert.ok(apis.includes('new Date()'), 'new Date() detected');
    assert.ok(apis.includes('localStorage'), 'localStorage access detected');
    assert.ok(calls.every((c) => c.includes('/hisability/js/ui/messages.js')), 'attributed to the app file');
  } finally {
    server.clearOverrides();
    await context.close();
  }
});

test('criteria 9, 10: a whole session makes no date, calendar, storage, permission or remote calls', async () => {
  const requests = [];
  const failures = [];
  const listen = (context) => {
    context.on('request', (r) => requests.push(r.url()));
    context.on('requestfailed', (r) => failures.push(`${r.url()} ${r.failure()?.errorText}`));
    context.on('response', (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
  };
  const logStart = server.log.length;
  const { context, page, errors } = await openApp(browser, server.url, { paused: true, initScripts: [auditProbe], onContext: listen });
  const dialogs = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    d.dismiss().catch(() => {});
  });
  try {
    // Home, preview with an easier toggle, shuffle, about.
    await page.click('#screen-home [data-action="preview"]');
    await page.locator('#preview-sheet .pv-item').nth(2).locator('[role="switch"]').click();
    await page.keyboard.press('Escape');
    await page.click('#screen-home [data-action="shuffle"]');
    await page.click('#screen-home .info-btn');
    await page.keyboard.press('Escape');

    // A whole workout, one second at a time so every cue (segment, countdown, halfway) fires,
    // with a pause/resume, an easier switch and the audio/vibration toggles on the way.
    await page.click(START);
    const t0 = await now(page);
    let shift = 0;
    for (let s = 1; s <= 421; s++) {
      await page.clock.fastForward(1_000);
      if (s === 30) {
        await page.click('#screen-player .ctl-pause');
        await page.clock.fastForward(4_000);
        await page.click('#screen-player .pl-resume-big');
        shift += 7_000;
      }
      if (s === 60) await page.click('#screen-player .ctl-easier');
      if (s === 90) {
        await page.click('#screen-player .ctl-audio');
        await page.click('#screen-player .ctl-vibration');
      }
      if (s === 100) {
        await page.click('#screen-player .ctl-audio');
        await page.click('#screen-player .ctl-vibration');
      }
      if (s > 400 && (await screenName(page)) === 'finish') break;
    }
    await advanceTo(page, t0 + 421_000 + shift);
    const fin = await readFinish(page);
    assert.equal(fin.screen, 'finish');
    assert.deepEqual(fin.stats, ['7:00', '12 of 12']);

    // Generate another, start it and end it (the other exit path).
    await page.click('[data-action="another"]');
    await page.click(START);
    await page.clock.fastForward(20_000);
    await page.click('#screen-player [data-action="end"]');
    await page.click('#end-dialog [data-action="confirm-end"]');
    assert.equal(await screenName(page), 'home');

    const appCalls = await appAuditCalls(page, server.origin);
    assert.deepEqual(appCalls, [], 'the app made no date/storage/permission/network API calls');

    // Nothing stored anywhere but the service-worker cache.
    await page.clock.resume();
    await waitForOfflineReady(page);
    const store = await storageSnapshot(page);
    assert.equal(store.local, 0, 'localStorage is empty');
    assert.equal(store.session, 0, 'sessionStorage is empty');
    assert.equal(store.cookie, '', 'no cookies');
    assert.deepEqual(store.idb, [], 'no IndexedDB databases');
    assert.ok(store.caches.length >= 1, 'the offline cache exists');
    for (const name of store.caches) assert.match(name, /^his-ability-\d+\.\d+\.\d+(-[0-9a-f]+)?$/, `cache ${name} is the app's versioned cache`);
    const state = await context.storageState({ indexedDB: true });
    assert.deepEqual(state.cookies, [], 'browser profile has no cookies');
    assert.deepEqual(state.origins, [], 'browser profile has no localStorage or IndexedDB for any origin');

    // Only the local server was contacted, only under the app's path.
    assert.ok(requests.length > 0);
    for (const url of requests) assert.ok(url.startsWith(server.url), `request stays on the app's own origin and path: ${url}`);
    for (const entry of server.log.slice(logStart)) {
      assert.ok(entry.path.startsWith(BASE), `server saw ${entry.path}`);
      assert.ok(entry.status < 400, `server answered ${entry.status} for ${entry.path}`);
    }
    assert.deepEqual(failures, [], 'no failed or 4xx/5xx requests');
    assert.deepEqual(dialogs, [], 'no permission or alert dialogs');
    assert.deepEqual(errors, []);

    // Reopen: no history, counts, dates, ratings or prior workout (criterion 9).
    const previous = await homeNames(page);
    await page.reload();
    await page.waitForSelector('#screen-home .move-row');
    const text = await page.evaluate(() => document.body.innerText);
    assert.notDeepEqual(await homeNames(page), previous, 'a new workout');
    assert.doesNotMatch(text, /workout complete|12 of 12|\b\d+ (workouts?|sessions?|minutes? (total|this))|streak|history|last (time|session|workout)|previous|best|badge|rating|yesterday|today/i);
    assert.deepEqual(await appAuditCalls(page, server.origin), [], 'reloading reads nothing back either');
    const again = await storageSnapshot(page);
    assert.deepEqual([again.local, again.session, again.cookie, again.idb], [0, 0, '', []]);
  } finally {
    await context.close();
  }
});

test('criterion 9, Requirement 21: an app switch keeps an active workout on time; leaving after a completed workout shows a fresh one', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { paused: true });
  try {
    const names = await homeNames(page);
    await page.click(START);
    const t0 = await now(page);

    // Switch away mid-workout for a minute (timers throttled: each fires at most once).
    await advanceTo(page, t0 + 30_500);
    await setVisibility(page, 'hidden');
    await page.clock.fastForward(60_000);
    await setVisibility(page, 'visible');
    let p = await readPlayer(page);
    assert.equal(p.screen, 'player', 'an active workout is kept while the page stays open');
    assert.equal(p.status, 'running');
    assert.equal(p.left, '5:30', 'reconciled from timestamps: 90.5 s elapsed, no drift');
    assert.deepEqual([p.kind, p.name, p.count], ['work', names[2], 'Move 3 of 12']);

    // Finish, then leave the app: coming back shows a fresh workout, not the finish screen.
    await advanceTo(page, t0 + 421_000);
    assert.equal(await screenName(page), 'finish');
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    assert.equal(await screenName(page), 'home', 'no finish screen after returning');
    const fresh = await homeNames(page);
    assert.notDeepEqual(fresh, names, 'a new workout replaces the one just used');
    await waitFor(() => page.evaluate(() => history.state?.hbLayer === undefined), { message: 'the finish layer to leave history' });

    // Ended early, then left: the unfinished workout stays until Shuffle or reload (Requirement 2).
    await page.click(START);
    await page.clock.fastForward(20_000);
    await page.click('#screen-player [data-action="end"]');
    await page.click('#end-dialog [data-action="confirm-end"]');
    assert.deepEqual(await homeNames(page), fresh, 'End keeps the workout while the app stays open');
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    assert.deepEqual(await homeNames(page), fresh, 'an unfinished workout survives an app switch');
    assert.equal(await screenName(page), 'home');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

/** about:blank, then the app, a workout skipped to the finish screen, then a reload. */
async function reloadOnFinish() {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  await page.goto('about:blank');
  await page.goto(server.url);
  await page.waitForSelector('#screen-home .move-row');
  await page.click(START);
  for (let i = 0; i < 30 && (await screenName(page)) === 'player'; i++) await page.click('#screen-player .ctl-skip');
  assert.equal(await screenName(page), 'finish');
  await page.reload();
  await page.waitForSelector('#screen-home .move-row');
  return { context, page };
}

test('Requirements 29, 54: after a reload on the finish screen, history.state keeps no trace of the finished workout', async () => {
  const { context, page } = await reloadOnFinish();
  try {
    const leftover = await page.evaluate(() => history.state);
    assert.equal(leftover?.hbLayer, undefined, `history.state after reload should be empty, found ${JSON.stringify(leftover)}`);
  } finally {
    await context.close();
  }
});

test('Back after a reload on the finish screen: a single Back leaves the app (no stale same-URL history entry)', async () => {
  const { context, page } = await reloadOnFinish();
  try {
    await page.evaluate(() => {
      window.__sameDocument = true;
    });
    await page.goBack({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(300);
    const stayed = page.url() === 'about:blank' ? null : await page.evaluate(() => ({ same: window.__sameDocument === true, screen: document.body.dataset.screen }));
    assert.equal(
      page.url(),
      'about:blank',
      `one Back press should leave the app; instead it stayed on ${page.url()} (${JSON.stringify(stayed)}): a dead Back press`,
    );
  } finally {
    await context.close();
  }
});
