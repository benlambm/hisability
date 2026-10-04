// Service worker registration, offline readiness, and user-approved updates.
//
//   initPWA({ onUpdateReady, onOfflineReady, onOfflineFailed })
//     Registers ./sw.js (scope ./). Callbacks:
//       onOfflineReady()          first install finished: the app now works offline
//       onOfflineFailed(reason)   first install failed: the app works online only
//       onUpdateReady()           a new release is downloaded and waiting for applyUpdate()
//     Returns a promise that settles once registration has been attempted (never rejects).
//   applyUpdate()      activate the waiting release, then reload the page exactly once.
//                      Call it only from the user's Refresh action, never during a workout.
//   offlineStatus()    'unsupported' | 'installing' | 'ready' | 'failed'

const UPDATE_CHECK_MS = 30 * 60 * 1000; // at most one update check per 30 minutes
const RETRY_MS = 60 * 1000; // after a failed first install, retry at most once a minute
const RELOAD_FALLBACK_MS = 4000;

let status = 'unsupported';
let handlers = {};
let registration = null;
let started = false;
let hadController = false;
let updateSignalled = false;
let updateRequested = false;
let reloading = false;
let lastCheck = -Infinity;
let lastRetry = -Infinity;

const now = () => performance.now();

function call(name, ...args) {
  const fn = handlers[name];
  if (typeof fn !== 'function') return;
  try {
    fn(...args);
  } catch (err) {
    // A UI callback error must not break registration.
    queueMicrotask(() => {
      throw err;
    });
  }
}

function supported() {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof location !== 'undefined' &&
    location.protocol !== 'file:' &&
    (typeof isSecureContext === 'undefined' || isSecureContext)
  );
}

function setReady() {
  if (status === 'ready') return;
  status = 'ready';
  call('onOfflineReady');
}

function setFailed(reason) {
  if (status === 'failed' || status === 'ready') return;
  status = 'failed';
  call('onOfflineFailed', reason);
}

function signalUpdate() {
  if (updateSignalled) return;
  updateSignalled = true;
  call('onUpdateReady');
}

/** Follow the first install: 'activated' means the precache is complete. */
function trackFirstInstall(worker) {
  if (!worker) return;
  const check = () => {
    if (worker.state === 'activated') setReady();
    else if (worker.state === 'redundant' && status !== 'ready') {
      setFailed('The offline copy could not be saved.');
    }
  };
  worker.addEventListener('statechange', check);
  check();
}

/** A new worker that finishes installing while this page is controlled is a ready update. */
function trackUpdate(worker) {
  if (!worker) return;
  const check = () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) signalUpdate();
  };
  worker.addEventListener('statechange', check);
  check();
}

async function register() {
  lastCheck = now();
  let reg;
  try {
    reg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
  } catch (err) {
    setFailed((err && err.message) || 'The service worker could not be registered.');
    return;
  }
  registration = reg;
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (navigator.serviceWorker.controller) trackUpdate(worker);
    else if (status !== 'ready') trackFirstInstall(worker);
  });

  if (hadController) {
    status = 'ready';
    if (reg.waiting) signalUpdate();
    else if (reg.installing) trackUpdate(reg.installing);
    // Re-registering an unchanged worker does not fetch sw.js, so check explicitly on load.
    reg.update().catch(() => {});
    return;
  }
  // Not controlled at startup: a first install, or a hard reload that bypassed the worker.
  if (reg.active && reg.active.state === 'activated') setReady();
  else trackFirstInstall(reg.installing || reg.waiting || reg.active);
}

function checkForUpdate() {
  if (!registration || now() - lastCheck < UPDATE_CHECK_MS) return;
  lastCheck = now();
  registration.update().catch(() => {});
}

function retryIfFailed() {
  if (status !== 'failed' || now() - lastRetry < RETRY_MS) return;
  lastRetry = now();
  status = 'installing';
  register();
}

export function initPWA({ onUpdateReady, onOfflineReady, onOfflineFailed } = {}) {
  handlers = { onUpdateReady, onOfflineReady, onOfflineFailed };
  if (started) return Promise.resolve(status);
  if (!supported()) {
    status = 'unsupported';
    return Promise.resolve(status);
  }
  started = true;
  const sw = navigator.serviceWorker;
  hadController = Boolean(sw.controller);
  status = hadController ? 'ready' : 'installing';

  sw.addEventListener('controllerchange', () => {
    // Only reload for an update the user asked for; the first install's clients.claim()
    // also fires controllerchange and must not reload the page.
    if (!updateRequested || reloading) return;
    reloading = true;
    location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    checkForUpdate();
    retryIfFailed();
  });
  addEventListener('online', retryIfFailed);

  return register().then(() => status);
}

export function applyUpdate() {
  if (reloading) return true;
  const waiting = registration && registration.waiting;
  if (!waiting) {
    // Another tab may already have activated the new release; a plain reload picks it up.
    if (!updateSignalled) return false;
    reloading = true;
    location.reload();
    return true;
  }
  updateRequested = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // If controllerchange never arrives (the waiting worker was replaced), reload anyway.
  setTimeout(() => {
    if (reloading) return;
    reloading = true;
    location.reload();
  }, RELOAD_FALLBACK_MS);
  return true;
}

export function offlineStatus() {
  if (!started && supported()) return navigator.serviceWorker.controller ? 'ready' : 'installing';
  return status;
}
