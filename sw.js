/* His Ability service worker (classic script, scope './').
 *
 * - install:  precache every file the app needs, bypassing the HTTP cache.
 *             The new worker then waits; js/pwa.js asks it to take over only after the user
 *             taps Refresh, so an update never swaps files under an active workout.
 * - activate: remove older his-ability-* caches (other sites on this origin are left alone).
 * - fetch:    same-origin GET inside the scope only. Opening the app gets the cached
 *             index.html; other files are cache-first with a network fallback. Offline, an
 *             unknown address inside the scope redirects to the app's root.
 *
 * CACHE_VERSION must equal APP_VERSION in js/config.js, and the ASSETS block is generated:
 * after changing any file, run `node tools/stamp-sw.mjs` (see README.md).
 */
'use strict';

const CACHE_VERSION = '1.0.0';
const CACHE_PREFIX = 'his-ability-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const SHELL = 'index.html';
const MATCH = { ignoreVary: true }; // one representation per URL; ignore Vary: Accept-Encoding

const ASSETS = [
  /* ASSETS:START */
  // fingerprint 0702c6e83b3c1888 (written by tools/stamp-sw.mjs; changes when any file below changes)
  './',
  'css/app.css',
  'css/figure.css',
  'icons/apple-touch-icon.png',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon.svg',
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'index.html',
  'js/app.js',
  'js/catalog/cardio.js',
  'js/catalog/core.js',
  'js/catalog/index.js',
  'js/catalog/lower.js',
  'js/catalog/upper.js',
  'js/config.js',
  'js/cues.js',
  'js/figure.js',
  'js/generator.js',
  'js/install.js',
  'js/pwa.js',
  'js/session.js',
  'js/timeline.js',
  'js/ui/about.js',
  'js/ui/dialog.js',
  'js/ui/dom.js',
  'js/ui/finish.js',
  'js/ui/history.js',
  'js/ui/home.js',
  'js/ui/icons.js',
  'js/ui/messages.js',
  'js/ui/player.js',
  'js/ui/preview.js',
  'js/ui/toast.js',
  'js/wakelock.js',
  'manifest.webmanifest',
  /* ASSETS:END */
];

const SCOPE = self.registration.scope;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache: 'reload' skips the browser's HTTP cache (GitHub Pages sends max-age=600), so a new
      // release never precaches a stale copy. addAll is all-or-nothing: if any file fails, the
      // install fails and the page reports that offline use is not ready.
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  event.respondWith(request.mode === 'navigate' ? navigate(request, url) : asset(request));
});

/** Page loads: the app shell, cache-first. Other addresses in scope fall back to the app. */
async function navigate(request, url) {
  const cache = await caches.open(CACHE_NAME);
  const path = url.pathname.slice(new URL(SCOPE).pathname.length);
  if (path === '' || path === SHELL) {
    const shell = await cachedShell(cache);
    if (shell) return shell;
    try {
      return await fetch(request);
    } catch {
      return offlinePage();
    }
  }
  // A direct link to a cached file (an icon, the manifest) gets that file.
  const file = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (file) return file;
  try {
    return await fetch(request);
  } catch {
    // Offline at an unknown address: open the app at its root, where relative paths resolve.
    return (await cachedShell(cache)) ? Response.redirect(SCOPE, 302) : offlinePage();
  }
}

/** Static files: cache-first, then network (successful responses are kept for next time). */
async function asset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, MATCH);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic' && !request.headers.has('range')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function cachedShell(cache) {
  return (await cache.match(SHELL, MATCH)) || (await cache.match('./', MATCH));
}

function offlinePage() {
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>His Ability</title></head>' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#FAF9F5;' +
    'color:#1F1A1C;font:17px/1.5 ui-sans-serif,-apple-system,system-ui,sans-serif;text-align:center">' +
    '<main style="max-width:22rem;padding:24px"><h1 style="font-family:ui-serif,Georgia,serif;' +
    'color:#4A2340;font-weight:600">His Ability</h1>' +
    '<p>You are offline, and the app has not finished saving itself for offline use yet.</p>' +
    '<p>Connect once and open it again. After that it works without a connection.</p></main>' +
    '</body></html>';
  return new Response(html, {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
