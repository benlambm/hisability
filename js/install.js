// Install context: which platform guidance to show, whether the app already runs standalone,
// and the Android/desktop Chrome install prompt.
//
//   getInstallInfo()     { platform: 'ios'|'android'|'desktop'|'other', standalone, canPrompt, installed }
//   onInstallChange(fn)  fn(info) whenever canPrompt / standalone / installed changes; returns unsubscribe
//   promptInstall()      'accepted' | 'dismissed' | 'unavailable'  (call from a tap handler)
//
// iOS has no install prompt: show Safari's Share > Add to Home Screen steps instead.

let deferredPrompt = null;
let installed = false;
let last = null;
const listeners = new Set();

function standaloneQuery() {
  return typeof matchMedia === 'function' ? matchMedia('(display-mode: standalone)') : null;
}

function detectPlatform() {
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  const ua = String(nav.userAgent || '');
  const touchPoints = Number(nav.maxTouchPoints || 0);
  // iPadOS Safari reports itself as a Mac; a multi-touch "Mac" is an iPad.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|Mac OS X|CrOS|X11|Linux/.test(ua)) return 'desktop';
  return 'other';
}

function isStandalone() {
  const mq = standaloneQuery();
  if (mq && mq.matches) return true;
  return typeof navigator !== 'undefined' && navigator.standalone === true;
}

export function getInstallInfo() {
  const standalone = isStandalone();
  return {
    platform: detectPlatform(),
    standalone,
    canPrompt: Boolean(deferredPrompt) && !standalone,
    installed: installed || standalone,
  };
}

function notify() {
  const info = getInstallInfo();
  const key = `${info.canPrompt}|${info.standalone}|${info.installed}`;
  if (key === last) return;
  last = key;
  for (const fn of [...listeners]) {
    try {
      fn(info);
    } catch (err) {
      queueMicrotask(() => {
        throw err;
      });
    }
  }
}

export function onInstallChange(fn) {
  if (typeof fn !== 'function') return () => {};
  if (last === null) {
    const info = getInstallInfo();
    last = `${info.canPrompt}|${info.standalone}|${info.installed}`;
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function promptInstall() {
  const event = deferredPrompt;
  if (!event || typeof event.prompt !== 'function') return 'unavailable';
  deferredPrompt = null; // a captured prompt can be shown only once
  let outcome = 'unavailable';
  try {
    // prompt() runs synchronously inside the caller's tap handler (no await before it).
    // Newer Chrome resolves it with the choice; older versions return nothing.
    const shown = await event.prompt();
    const choice = shown && shown.outcome ? shown : await event.userChoice;
    outcome = choice && choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    deferredPrompt = deferredPrompt || event; // not shown (e.g. no user gesture): keep it for a retry
    outcome = 'unavailable';
  }
  if (outcome === 'accepted') installed = true;
  notify();
  return outcome;
}

// Capture as early as possible: this runs when the module is first evaluated.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // keep the mini-infobar away; the app offers its own Install button
    deferredPrompt = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    notify();
  });
  const mq = standaloneQuery();
  if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', notify);
}
