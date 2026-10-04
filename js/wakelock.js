// Screen wake lock for the active workout (CUES).
//
// Uses the Screen Wake Lock API where available. The system releases the lock whenever the
// page is hidden (screen locked, app switched), so while the lock is wanted it is requested
// again when the page becomes visible. Nothing here throws; acquire() resolves false when the
// API is missing or the request is refused, and the UI can then show a gentle
// "keep your screen on" hint.

/**
 * @returns {{
 *   acquire(): Promise<boolean>,
 *   release(): Promise<void>,
 *   readonly supported: boolean,
 *   readonly active: boolean,
 *   onChange(fn: (active: boolean) => void): () => void,
 * }}
 */
export function createWakeLock() {
  const api = () => {
    try {
      const wl = globalThis.navigator && globalThis.navigator.wakeLock;
      return wl && typeof wl.request === 'function' ? wl : null;
    } catch {
      return null;
    }
  };
  const supported = !!api();

  let sentinel = null;
  let wanted = false;
  let inflight = null;
  let listening = false;
  let lastNotified = false;
  const listeners = new Set();

  const isActive = () => !!sentinel && sentinel.released !== true;

  function notify() {
    const active = isActive();
    if (active === lastNotified) return;
    lastNotified = active;
    for (const fn of [...listeners]) {
      try {
        fn(active);
      } catch {
        /* a listener error must not affect the lock */
      }
    }
  }

  function visible() {
    const doc = globalThis.document;
    return !doc || doc.visibilityState === undefined || doc.visibilityState === 'visible';
  }

  function safeRelease(s) {
    try {
      const p = s && typeof s.release === 'function' ? s.release() : null;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  }

  function adopt(s) {
    sentinel = s;
    const onRelease = () => {
      if (sentinel !== s) return;
      sentinel = null;
      notify();
    };
    try {
      if (typeof s.addEventListener === 'function') s.addEventListener('release', onRelease);
      else s.onrelease = onRelease;
    } catch {
      /* the released flag is still checked */
    }
    notify();
  }

  function request() {
    if (inflight) return inflight;
    const wl = api();
    if (!wl) return Promise.resolve(false);
    let pending;
    try {
      pending = Promise.resolve(wl.request('screen'));
    } catch {
      return Promise.resolve(false);
    }
    const mine = pending.then(
      (s) => {
        if (!s || s.released === true) return false;
        if (!wanted) {
          safeRelease(s); // release() was called while the request was in flight
          return false;
        }
        adopt(s);
        return true;
      },
      () => false, // NotAllowedError: hidden page, power saving, permissions policy
    );
    inflight = mine;
    mine.then(() => {
      if (inflight === mine) inflight = null;
    });
    return mine;
  }

  function onVisibility() {
    if (wanted && visible() && !isActive()) request();
  }

  function listen(on) {
    const doc = globalThis.document;
    if (!doc || typeof doc.addEventListener !== 'function' || on === listening) return;
    try {
      if (on) doc.addEventListener('visibilitychange', onVisibility);
      else doc.removeEventListener('visibilitychange', onVisibility);
      listening = on;
    } catch {
      /* ignore */
    }
  }

  return {
    async acquire() {
      try {
        if (!supported) return false;
        wanted = true;
        listen(true);
        if (isActive()) return true;
        if (!visible()) return false; // requested again once the page is visible
        return await request();
      } catch {
        return false;
      }
    },
    async release() {
      try {
        wanted = false;
        listen(false);
        const s = sentinel;
        sentinel = null;
        if (s) {
          try {
            await s.release();
          } catch {
            /* already released */
          }
        }
        notify();
      } catch {
        /* never throws */
      }
    },
    get supported() {
      return supported;
    },
    get active() {
      return isActive();
    },
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
