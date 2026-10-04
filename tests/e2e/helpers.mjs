// Shared helpers for the acceptance-criteria browser tests (tests/e2e/*.test.mjs).
//
// - startProxy(): the real tools/serve.mjs server behind a thin logging proxy. The proxy records
//   every request the browser makes (including service-worker precache fetches, which Playwright's
//   request events do not report), can rewrite a response body (to "deploy" a new release), and
//   can be closed hard (every socket destroyed) to simulate a lost connection.
// - openApp(): a fresh browser context + page on the app, with optional fake clock (installed
//   before navigation) and init scripts that run after the clock is installed.
// - Clock helpers for a *paused* fake clock, so timeline positions are exact.
// - DOM readers for the home, player and finish screens.
// - Catalog lookups so a workout read from the DOM can be validated with the real generator rules.
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../tools/serve.mjs';
import { CATALOG } from '../../js/catalog/index.js';
import { validateSequence } from '../../js/generator.js';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const BASE = '/hisability/';

export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
export const DESKTOP = { viewport: { width: 1024, height: 768 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
export const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

/** Fake wall-clock origin used by every clock install (never a meaningful date). */
export const CLOCK_ORIGIN = 1_000_000;

// ------------------------------------------------------------------ timeline (docs/ARCHITECTURE.md)

export const PREP_MS = 10_000;
export const WORK_MS = 25_000;
export const REST_MS = 10_000;
export const MOVES = 12;
export const TOTAL_MS = PREP_MS + MOVES * WORK_MS + (MOVES - 1) * REST_MS; // 420 000

/** The 23 segments of the fixed timeline: { kind, move, start, end }. */
export function timeline() {
  const segs = [{ kind: 'prep', move: 0, start: 0, end: PREP_MS }];
  let t = PREP_MS;
  for (let i = 0; i < MOVES; i++) {
    if (i > 0) {
      segs.push({ kind: 'transition', move: i, start: t, end: t + REST_MS });
      t += REST_MS;
    }
    segs.push({ kind: 'work', move: i, start: t, end: t + WORK_MS });
    t += WORK_MS;
  }
  return segs;
}

// ------------------------------------------------------------------ catalog

const BY_NAME = new Map(CATALOG.map((m) => [m.name, m]));
const BY_ALT_NAME = new Map(CATALOG.map((m) => [m.alt.name, m]));

export function movementByName(name) {
  return BY_NAME.get(name) ?? null;
}

export function movementByAltName(name) {
  return BY_ALT_NAME.get(name) ?? null;
}

/** Assert that 12 display names read from the DOM form a valid workout under the generator rules. */
export function assertValidWorkout(names, label = 'workout') {
  assert.equal(names.length, MOVES, `${label}: 12 movements`);
  const moves = names.map((n) => {
    const m = movementByName(n);
    assert.ok(m, `${label}: "${n}" is an approved catalog movement`);
    return m;
  });
  assert.equal(new Set(moves.map((m) => m.id)).size, MOVES, `${label}: no duplicates`);
  const per = {};
  for (const m of moves) per[m.category] = (per[m.category] ?? 0) + 1;
  assert.deepEqual(per, { lower: 3, upper: 3, core: 3, cardio: 3 }, `${label}: 3 per category`);
  const v = validateSequence(moves);
  assert.ok(v.ok, `${label}: valid sequence (${v.reason ?? ''})`);
  return moves;
}

/** The ASSETS list precached by sw.js. */
export function swAssets(source = readFileSync(join(ROOT, 'sw.js'), 'utf8')) {
  const m = source.match(/\/\* ASSETS:START \*\/([\s\S]*?)\/\* ASSETS:END \*\//);
  assert.ok(m, 'sw.js has an ASSETS block');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

export function appVersion() {
  return readFileSync(join(ROOT, 'js/config.js'), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
}

// ------------------------------------------------------------------ server

/**
 * tools/serve.mjs behind a logging proxy.
 * Returns { url, origin, port, log, override(path, fn), clearOverrides(), close() }.
 *   log:      [{ method, path, status }] for every request that reached the server
 *   override: rewrite the body of a 200 response for an exact pathname, fn(text) -> text
 *   close:    stop accepting connections and destroy every open socket (a dead network)
 */
export async function startProxy() {
  const backend = await startServer({ port: 0 });
  const log = [];
  const overrides = new Map();
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const entry = { method: req.method, path, status: 0 };
    log.push(entry);
    const headers = { ...req.headers, host: `127.0.0.1:${backend.port}` };
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
    const up = http.request(
      { host: '127.0.0.1', port: backend.port, method: req.method, path: req.url, headers },
      (upRes) => {
        const chunks = [];
        upRes.on('data', (c) => chunks.push(c));
        upRes.on('end', () => {
          let body = Buffer.concat(chunks);
          const fn = overrides.get(path);
          if (fn && upRes.statusCode === 200 && req.method === 'GET') body = Buffer.from(fn(body.toString('utf8')));
          entry.status = upRes.statusCode;
          const out = { ...upRes.headers, 'content-length': String(body.length) };
          delete out['transfer-encoding'];
          res.writeHead(upRes.statusCode, out);
          res.end(req.method === 'HEAD' ? undefined : body);
        });
      },
    );
    up.on('error', () => {
      entry.status = 502;
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  let closed = false;
  return {
    url: `http://127.0.0.1:${port}${BASE}`,
    origin: `http://127.0.0.1:${port}`,
    port,
    log,
    override(path, fn) {
      overrides.set(path, fn);
    },
    clearOverrides() {
      overrides.clear();
    },
    /** Close the proxy only (the network is gone); the backend keeps running until close(). */
    async goOffline() {
      if (closed) return;
      closed = true;
      server.closeAllConnections?.();
      for (const s of sockets) s.destroy();
      await new Promise((ok) => server.close(() => ok()));
    },
    async close() {
      await this.goOffline();
      await backend.close();
    },
  };
}

// ------------------------------------------------------------------ pages

/**
 * New context + page on `url`, waiting for the home workout.
 * Options: clock (install the fake clock before navigation), paused (also pause it once the
 * home screen is ready, so time moves only when a test moves it), context (newContext options),
 * initScripts (functions or strings, added after the clock so they see its fakes), wait (false
 * to skip waiting for the home screen), onContext (called with the context before navigation,
 * to attach request listeners).
 */
export async function openApp(browser, url, { clock = false, paused = false, context: ctxOpts = {}, initScripts = [], wait = true, onContext } = {}) {
  const context = await browser.newContext({ ...PHONE, ...ctxOpts });
  onContext?.(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  if (clock || paused) await page.clock.install({ time: CLOCK_ORIGIN });
  for (const script of initScripts) await context.addInitScript(script);
  await page.goto(url);
  if (wait) await page.waitForSelector('#screen-home .move-row');
  if (paused) await pauseClock(page);
  return { context, page, errors };
}

/** Pause the fake clock a little in the future, so the page time stops flowing on its own. */
export async function pauseClock(page) {
  const wall = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(wall + 1000);
}

/** The page's fake monotonic clock (what js/session.js reads). */
export function now(page) {
  return page.evaluate(() => performance.now());
}

/**
 * Move a paused clock to exactly `target` (performance.now() ms): one fastForward jump (each due
 * timer fires once, at the new time), then a short runFor so animation frames render.
 */
export async function advanceTo(page, target, settle = 50) {
  const current = await now(page);
  const delta = Math.round(target - current);
  assert.ok(delta >= 0, `cannot move the clock backwards (${current} -> ${target})`);
  if (delta > settle) {
    await page.clock.fastForward(delta - settle);
    await page.clock.runFor(settle);
  } else if (delta > 0) {
    await page.clock.runFor(delta);
  }
}

export async function advanceBy(page, ms, settle = 50) {
  await advanceTo(page, (await now(page)) + ms, settle);
}

/**
 * Ask the app to reconcile right now, at the exact current clock value (the app's own
 * visibilitychange handler calls the same pump the animation loop uses). Lets a test sample the
 * session at an exact millisecond without waiting for a timer to fall due.
 */
export function reconcileNow(page) {
  return page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

/**
 * Emulate the page being hidden (app switched away, phone locked) or shown again: headless pages
 * are always visible, so override document.visibilityState/hidden and fire visibilitychange.
 */
export function setVisibility(page, state) {
  return page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

/** Poll an async predicate from Node (works whatever the page clock is doing). */
export async function waitFor(fn, { timeout = 10_000, interval = 50, message = 'condition' } = {}) {
  const end = performance.now() + timeout;
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    if (performance.now() > end) throw new Error(`timed out waiting for ${message} (last: ${last})`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

// ------------------------------------------------------------------ DOM readers

export const screenName = (page) => page.evaluate(() => document.body.dataset.screen);
export const homeNames = (page) => page.locator('#screen-home .move-name').allTextContents();

export function homeState(page) {
  return page.evaluate(() => ({
    names: [...document.querySelectorAll('#screen-home .move-name')].map((n) => n.textContent),
    cats: [...document.querySelectorAll('#screen-home .move-row')].map((r) => r.dataset.cat),
    time: document.querySelector('#screen-home .workout-time')?.textContent,
  }));
}

/** Everything the player shows, in one round trip. */
export function readPlayer(page) {
  return page.evaluate(() => {
    const root = document.getElementById('screen-player');
    const q = (s) => root.querySelector(s);
    const text = (s) => q(s)?.textContent ?? null;
    const fig = q('.pl-figure svg') ?? q('.pl-figure .fig-strip');
    const box = fig?.getBoundingClientRect();
    return {
      screen: document.body.dataset.screen,
      hidden: root.hidden,
      status: root.dataset.status ?? null,
      kind: root.dataset.kind ?? null,
      final: root.dataset.final ?? null,
      state: text('.pl-state-text'),
      eyebrow: text('.pl-eyebrow'),
      name: text('.pl-name'),
      cue: text('.pl-cue'),
      ring: text('.pl-ring-num'),
      ringSr: text('.pl-ring .visually-hidden'),
      ringArc: Boolean(q('.pl-ring svg circle.pl-ring-arc')),
      ringOffset: q('.pl-ring-arc')?.getAttribute('stroke-dashoffset') ?? null,
      nextLabel: text('.pl-next-label'),
      next: text('.pl-next-name'),
      count: text('.pl-count'),
      left: text('.pl-left'),
      segs: root.querySelectorAll('.pl-seg').length,
      segStates: [...root.querySelectorAll('.pl-seg')].map((s) => s.dataset.state),
      progressNow: q('.pl-progress')?.getAttribute('aria-valuenow') ?? null,
      figure: Boolean(fig) && box.width > 0 && box.height > 0,
      figureLabel: fig?.getAttribute('aria-label') ?? null,
      pausedOverlay: q('.pl-overlay-paused') ? !q('.pl-overlay-paused').hidden : null,
      resumingOverlay: q('.pl-overlay-resuming') ? !q('.pl-overlay-resuming').hidden : null,
      resumeNum: text('.pl-count-num'),
      pauseLabel: text('.ctl-pause .ctl-label'),
      easier: q('.ctl-easier')?.getAttribute('aria-checked') ?? null,
      easierBadge: q('.pl-badge-easier') ? !q('.pl-badge-easier').hidden : null,
      audio: q('.ctl-audio')?.getAttribute('aria-pressed') ?? null,
      audioIcon: q('.ctl-audio .ctl-icon')?.dataset.icon ?? null,
      vibration: q('.ctl-vibration')?.getAttribute('aria-pressed') ?? null,
      vibrationDisabled: q('.ctl-vibration')?.disabled ?? null,
      vibrationIcon: q('.ctl-vibration .ctl-icon')?.dataset.icon ?? null,
      endDialog: document.getElementById('end-dialog').open,
    };
  });
}

export function readFinish(page) {
  return page.evaluate(() => ({
    screen: document.body.dataset.screen,
    title: document.querySelector('.fin-title')?.textContent,
    stats: [...document.querySelectorAll('.fin-stat-value')].map((n) => n.textContent),
    message: document.querySelector('.fin-message')?.textContent,
  }));
}

/** "m:ss" -> seconds. */
export function clockSeconds(text) {
  const m = /^(\d+):(\d\d)$/.exec(String(text).trim());
  assert.ok(m, `"${text}" is an m:ss clock`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Wait until the page is controlled by the service worker and its versioned cache is complete. */
export async function waitForOfflineReady(page, { timeout = 15_000 } = {}) {
  const expected = swAssets().length;
  await waitFor(
    () =>
      page.evaluate(async (n) => {
        if (!navigator.serviceWorker.controller) return false;
        const keys = await caches.keys();
        const name = keys.find((k) => k.startsWith('his-ability-'));
        if (!name) return false;
        const c = await caches.open(name);
        return (await c.keys()).length >= n;
      }, expected),
    { timeout, message: 'service worker control and a complete precache' },
  );
}

// ------------------------------------------------------------------ runtime audit probe

/**
 * Init script (runs in the page before any app code, after the fake clock): wraps every
 * date/calendar entry point and every storage, permission and network API the PRD forbids, and
 * records each call with its stack in window.__audit. Stacks let a test tell app code (frames
 * under the server origin) from browser-automation internals.
 */
export function auditProbe() {
  const calls = [];
  const record = (api) => {
    calls.push({ api, stack: String(new Error().stack || '') });
  };
  Object.defineProperty(window, '__audit', { value: { calls }, configurable: true });
  const wrapFn = (obj, key, api) => {
    try {
      const orig = obj?.[key];
      if (typeof orig !== 'function') return;
      obj[key] = new Proxy(orig, {
        apply(target, self, args) {
          record(api);
          return Reflect.apply(target, self, args);
        },
        construct(target, args, nt) {
          record(api);
          return Reflect.construct(target, args, nt === obj[key] ? target : nt);
        },
      });
    } catch {
      /* not wrappable here */
    }
  };
  const wrapGetter = (proto, key, api, alsoSet) => {
    try {
      let owner = proto;
      while (owner && !Object.getOwnPropertyDescriptor(owner, key)) owner = Object.getPrototypeOf(owner);
      if (!owner) return;
      const d = Object.getOwnPropertyDescriptor(owner, key);
      Object.defineProperty(proto, key, {
        configurable: true,
        enumerable: d.enumerable,
        get() {
          record(api);
          return d.get ? d.get.call(this) : d.value;
        },
        set: alsoSet
          ? function (v) {
              record(`${api} (set)`);
              if (d.set) d.set.call(this, v);
            }
          : d.set,
      });
    } catch {
      /* not wrappable here */
    }
  };

  // Dates, calendars, time of day (Requirement 3, criterion 10).
  const RealDate = window.Date;
  window.Date = new Proxy(RealDate, {
    apply(target, self, args) {
      record('Date()');
      return Reflect.apply(target, self, args);
    },
    construct(target, args, nt) {
      record('new Date()');
      return Reflect.construct(target, args, nt === window.Date ? target : nt);
    },
    get(target, key, receiver) {
      if (key === 'now' || key === 'parse' || key === 'UTC') {
        const fn = Reflect.get(target, key);
        return (...args) => {
          record(`Date.${key}`);
          return fn.apply(target, args);
        };
      }
      return Reflect.get(target, key, receiver);
    },
  });
  for (const k of ['DateTimeFormat', 'RelativeTimeFormat']) wrapFn(window.Intl, k, `Intl.${k}`);
  if (window.Temporal?.Now) for (const k of Object.keys(window.Temporal.Now)) wrapFn(window.Temporal.Now, k, `Temporal.Now.${k}`);
  wrapGetter(window.performance, 'timeOrigin', 'performance.timeOrigin');
  wrapGetter(Document.prototype, 'lastModified', 'document.lastModified');

  // Storage (Requirement 51).
  for (const k of ['setItem', 'getItem', 'removeItem', 'clear', 'key']) wrapFn(Storage.prototype, k, `Storage.${k}`);
  wrapGetter(window, 'localStorage', 'localStorage');
  wrapGetter(window, 'sessionStorage', 'sessionStorage');
  if (window.IDBFactory) for (const k of ['open', 'deleteDatabase', 'databases']) wrapFn(IDBFactory.prototype, k, `indexedDB.${k}`);
  wrapGetter(Document.prototype, 'cookie', 'document.cookie', true);
  if (window.CookieStore) for (const k of ['get', 'getAll', 'set', 'delete']) wrapFn(CookieStore.prototype, k, `cookieStore.${k}`);
  if (window.StorageManager) for (const k of ['persist', 'persisted', 'estimate', 'getDirectory']) wrapFn(StorageManager.prototype, k, `navigator.storage.${k}`);

  // Permissions, identity, location, notifications (Requirement 52).
  if (window.Notification) {
    wrapFn(window, 'Notification', 'new Notification');
    wrapFn(window.Notification, 'requestPermission', 'Notification.requestPermission');
  }
  if (window.Geolocation) for (const k of ['getCurrentPosition', 'watchPosition']) wrapFn(Geolocation.prototype, k, `geolocation.${k}`);
  if (window.Permissions) wrapFn(Permissions.prototype, 'query', 'permissions.query');
  if (window.CredentialsContainer) for (const k of ['get', 'create', 'store']) wrapFn(CredentialsContainer.prototype, k, `credentials.${k}`);
  if (window.PushManager) wrapFn(PushManager.prototype, 'subscribe', 'pushManager.subscribe');

  // Remote calls (Requirement 53). The app loads its own files through the module graph only.
  wrapFn(window, 'fetch', 'fetch');
  wrapFn(Navigator.prototype, 'sendBeacon', 'sendBeacon');
  if (window.XMLHttpRequest) wrapFn(XMLHttpRequest.prototype, 'open', 'XMLHttpRequest.open');
  wrapFn(window, 'WebSocket', 'WebSocket');
  wrapFn(window, 'EventSource', 'EventSource');
}

/** Calls recorded by auditProbe whose stack runs through the app's own scripts. */
export function appAuditCalls(page, origin) {
  return page.evaluate((o) => {
    const calls = window.__audit?.calls ?? [];
    return calls.filter((c) => c.stack.includes(o)).map((c) => `${c.api}\n${c.stack.split('\n').slice(1, 5).join('\n')}`);
  }, origin);
}

/** Close everything a test opened, ignoring errors from already-closed objects. */
export async function closeAll(...things) {
  for (const t of things) {
    try {
      await t?.close();
    } catch {
      /* already closed */
    }
  }
}
