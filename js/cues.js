// Eyes-free guidance for the player (CUES): spoken cues (Web Speech API), short synthesized
// tones (WebAudio, no audio files), and vibration (navigator.vibrate, or the iOS 18+
// switch-control haptic as a best-effort fallback).
//
// handle(event) consumes js/session.js events. Audio (speech + tones) and vibration are
// independent; with both off, handle() does nothing observable. Nothing here throws: every
// browser API is feature-detected at call time and may be missing.
//
// iOS Safari notes:
// - unlock() must run synchronously inside the Start / Resume tap. A speak() call inside a
//   user gesture lifts WebKit's speech restriction for the page, and an AudioContext created
//   or resumed inside a gesture is allowed to run.
// - Speech queues lag easily, so a new segment cancels whatever is still being said, and a
//   countdown word is dropped rather than spoken late.

const RATE = 1;
const PITCH = 1;
const PREP_SETUP_MAX = 70; // characters of setup read during the 10 s prep
const REST_SETUP_MAX = 90; // characters of setup read during a 10 s transition (ends before 3-2-1)
const CHAR_MS = 62; // rough speaking time per character at rate 1
const BASE_MS = 250;
const QUEUE_SLACK_MS = 350; // a countdown word may wait this long behind current speech
const STALE_GRACE_MS = 1500; // forget utterances whose end event never arrived
const IOS_TAP_GAP_MS = 110; // switch-haptic taps closer than this blur together
const MASTER_GAIN = 0.9;
const ATTACK_S = 0.012;
const SILENT = 0.0001; // exponential ramps cannot reach 0
const END_SUSPEND_MS = 300;
const COMPLETE_SUSPEND_MS = 2500;

const freezeAll = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze(v)])));

export const VIBRATION_PATTERNS = freezeAll({
  work: [180],
  transition: [70, 60, 70],
  countdown: [25],
  pause: [40, 50, 40, 50, 40],
  resume: [120],
  complete: [220, 90, 220, 90, 400],
  switchSides: [150, 100, 150],
});

// Each note: f = frequency (Hz), at = start offset (s), d = length (s), g = peak gain.
const TONES = {
  tick: [{ f: 880, at: 0, d: 0.09, g: 0.16 }],
  work: [
    { f: 660, at: 0, d: 0.13, g: 0.18, type: 'triangle' },
    { f: 990, at: 0.11, d: 0.24, g: 0.2, type: 'triangle' },
  ],
  transition: [{ f: 392, at: 0, d: 0.45, g: 0.18 }],
  complete: [
    { f: 523.25, at: 0, d: 0.6, g: 0.15 },
    { f: 659.25, at: 0.16, d: 0.6, g: 0.15 },
    { f: 783.99, at: 0.32, d: 0.95, g: 0.17 },
  ],
  pause: [
    { f: 330, at: 0, d: 0.09, g: 0.18 },
    { f: 330, at: 0.16, d: 0.09, g: 0.18 },
  ],
  switchSides: [
    { f: 587.33, at: 0, d: 0.12, g: 0.15 },
    { f: 587.33, at: 0.17, d: 0.12, g: 0.15 },
  ],
};

const WORDS = Object.freeze({
  1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five',
  6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten',
});

// Novelty voices shipped with Apple platforms; never chosen.
const NOVELTY_VOICES = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged', 'fred',
  'good news', 'hysterical', 'jester', 'junior', 'kathy', 'organ', 'pipe organ', 'princess',
  'ralph', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox',
]);
// Older formant voices: usable, but ranked below the natural-sounding ones.
const DATED_VOICES = new Set([
  'eddy', 'flo', 'grandma', 'grandpa', 'reed', 'rocko', 'sandy', 'shelley',
]);

const isObj = (v) => v !== null && typeof v === 'object';
const isInt = (v) => Number.isInteger(v);
const normLang = (l) => String(l || '').replace(/_/g, '-').toLowerCase();
const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

function sentence(s) {
  const t = clean(s);
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function spoken(m) {
  if (!isObj(m)) return '';
  return (clean(m.say) || clean(m.name)).replace(/[\s.,;:!?]+$/, '');
}

function defaultNow() {
  const p = globalThis.performance;
  return p && typeof p.now === 'function' ? p.now() : 0;
}

function navigatorLang() {
  const nav = globalThis.navigator;
  if (!nav) return '';
  return String(nav.language || (Array.isArray(nav.languages) && nav.languages[0]) || '');
}

/**
 * Picks the best English voice: user locale match, then en-US, then en-GB; local voices
 * (work offline) over network voices; novelty voices are never chosen.
 * @returns {SpeechSynthesisVoice|null}
 */
export function pickVoice(voices, preferred = navigatorLang()) {
  const pref = normLang(preferred);
  let best = null;
  let bestScore = -Infinity;
  for (const v of voices || []) {
    if (!isObj(v)) continue;
    const lang = normLang(v.lang);
    if (!/^en(-|$)/.test(lang)) continue;
    const name = String(v.name || '');
    const base = name.split(' (')[0].trim().toLowerCase();
    if (NOVELTY_VOICES.has(base)) continue;
    let score = 0;
    if (pref && lang === pref) score += 40;
    else if (lang === 'en-us') score += 25;
    else if (lang === 'en-gb') score += 20;
    else score += 5;
    if (v.localService) score += 30;
    if (DATED_VOICES.has(base)) score -= 15;
    if (/\b(enhanced|premium|natural|neural)\b/i.test(name)) score += 8;
    if (v.default) score += 3;
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

// iOS / iPadOS 18+ Safari (and other WebKit iOS browsers): a programmatic click on a
// <label> wrapping <input type="checkbox" switch> plays the system switch haptic.
function detectSwitchHaptics() {
  try {
    const nav = globalThis.navigator;
    const doc = globalThis.document;
    const Input = globalThis.HTMLInputElement;
    if (!nav || !doc || typeof doc.createElement !== 'function') return false;
    if (typeof Input !== 'function' || !Input.prototype || !('switch' in Input.prototype)) return false;
    const ua = String(nav.userAgent || '');
    const iDevice = /iPhone|iPad|iPod/.test(ua);
    const iPadDesktopUA = /Macintosh/.test(ua) && Number(nav.maxTouchPoints) > 1;
    if (!iDevice && !iPadDesktopUA) return false;
    const os = iDevice && ua.match(/OS (\d+)[_.]\d/); // "CPU iPhone OS 18_6 like Mac OS X"
    if (os) return Number(os[1]) >= 18;
    const safari = ua.match(/Version\/(\d+)/);
    if (safari) return Number(safari[1]) >= 18;
    return true; // switch support already implies a recent WebKit
  } catch {
    return false;
  }
}

function hasVibrate() {
  const nav = globalThis.navigator;
  return !!nav && typeof nav.vibrate === 'function';
}

/**
 * @param {{ audio?: boolean, vibration?: boolean, now?: () => number }} [options]
 *   `now` is a clock override for tests (defaults to performance.now).
 */
export function createCues(options = {}) {
  const opts = isObj(options) ? options : {};
  let audioOn = opts.audio !== false;
  let vibrationOn = opts.vibration !== false;
  const now = typeof opts.now === 'function' ? opts.now : defaultNow;

  let unlocked = false;
  let supportCache = null;

  // ---- speech ------------------------------------------------------------------

  let voice = null;
  let voicesHooked = false;
  let live = []; // utterances handed to the engine: { kind: 'guide'|'count'|'prime', end }

  const synth = () => {
    const s = globalThis.speechSynthesis;
    return isObj(s) && typeof s.speak === 'function' ? s : null;
  };
  const Utterance = () => {
    const U = globalThis.SpeechSynthesisUtterance;
    return typeof U === 'function' ? U : null;
  };

  function refreshVoice() {
    try {
      const s = synth();
      if (!s || typeof s.getVoices !== 'function') return;
      const list = s.getVoices();
      if (list && list.length) voice = pickVoice(Array.from(list)) || null;
    } catch {
      /* keep the previous choice */
    }
  }

  function hookVoices() {
    const s = synth();
    if (!s || voicesHooked) return;
    voicesHooked = true;
    try {
      if (typeof s.addEventListener === 'function') s.addEventListener('voiceschanged', refreshVoice);
      else if (!s.onvoiceschanged) s.onvoiceschanged = refreshVoice;
    } catch {
      /* voices are also picked lazily */
    }
    refreshVoice();
  }

  function say(text, kind, volume = 1) {
    const s = synth();
    const U = Utterance();
    if (!s || !U || !text) return false;
    hookVoices();
    if (!voice) refreshVoice();
    try {
      const u = new U(text);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        const nl = navigatorLang();
        u.lang = /^en\b/i.test(nl) ? nl : 'en-US';
      }
      u.rate = RATE;
      u.pitch = PITCH;
      u.volume = volume;
      const t = now();
      const dur = kind === 'prime' ? 0 : BASE_MS + text.length * CHAR_MS;
      const tail = live.reduce((m, e) => (e.end > m ? e.end : m), t);
      // Holding the entry also keeps the utterance referenced until it ends (engines may
      // drop events of utterances that get garbage collected).
      const entry = { u, kind, end: tail + dur };
      const done = () => {
        live = live.filter((e) => e !== entry);
      };
      u.onstart = () => {
        entry.end = now() + dur;
      };
      u.onend = done;
      u.onerror = done;
      live.push(entry);
      if (s.paused && typeof s.resume === 'function') s.resume(); // iOS can stay paused after backgrounding
      s.speak(u);
      return true;
    } catch {
      return false;
    }
  }

  function cancelSpeech() {
    live = [];
    const s = synth();
    if (!s || typeof s.cancel !== 'function') return;
    // Only when something is queued: a needless cancel() right before speak() has been
    // known to swallow the next utterance on some engines.
    if (!(s.speaking || s.pending || s.paused)) return;
    try {
      s.cancel();
    } catch {
      /* ignore */
    }
  }

  function prune() {
    const s = synth();
    if (!s || !(s.speaking || s.pending)) {
      live = [];
      return;
    }
    const cutoff = now() - STALE_GRACE_MS;
    live = live.filter((e) => e.end > cutoff);
  }

  // A cue that replaces anything still being said.
  function guide(text) {
    if (!audioOn || !text) return;
    cancelSpeech();
    say(text, 'guide');
  }

  // A countdown word: never lag. Queue it only if current speech ends almost at once;
  // otherwise cancel stale countdown words, or drop this word if guidance is still talking.
  function count(word) {
    if (!audioOn || !word) return;
    prune();
    const t = now();
    let freeAt = t;
    let guiding = false;
    for (const e of live) {
      if (e.end > freeAt) freeAt = e.end;
      if (e.kind === 'guide' && e.end > t + QUEUE_SLACK_MS) guiding = true;
    }
    if (freeAt - t > QUEUE_SLACK_MS) {
      if (guiding) return; // the tick and haptic still mark the second
      cancelSpeech();
    }
    say(word, 'count');
  }

  function primeSpeech() {
    const s = synth();
    if (!s || !Utterance()) return;
    hookVoices();
    say(' ', 'prime', 0);
  }

  // ---- tones ---------------------------------------------------------------------

  let ctx = null;
  let master = null;
  let suspendTimer = null;
  const sounding = new Set();

  function ensureAudioContext() {
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof Ctor !== 'function') return null;
    if (!ctx || ctx.state === 'closed') {
      try {
        ctx = new Ctor();
        master = null;
      } catch {
        ctx = null;
      }
    }
    return ctx;
  }

  function wakeAudio() {
    if (!ctx || ctx.state === 'running' || typeof ctx.resume !== 'function') return;
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* resume needs a gesture on some platforms; unlock() retries */
    }
  }

  function playSilence() {
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* ignore */
    }
  }

  function clearSuspend() {
    if (suspendTimer !== null) clearTimeout(suspendTimer);
    suspendTimer = null;
  }

  // Let the audio hardware sleep after a workout; unlock() wakes it for the next one.
  function scheduleSuspend(ms) {
    clearSuspend();
    if (!ctx || typeof ctx.suspend !== 'function') return;
    suspendTimer = setTimeout(() => {
      suspendTimer = null;
      try {
        if (ctx && ctx.state === 'running') {
          const p = ctx.suspend();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch {
        /* ignore */
      }
    }, ms);
  }

  function tone(name) {
    if (!audioOn || !ctx) return;
    const notes = TONES[name];
    if (!notes) return;
    if (ctx.state && ctx.state !== 'running') {
      wakeAudio(); // skip this one: a tone played late is worse than none
      return;
    }
    try {
      if (!master) {
        master = ctx.createGain();
        master.gain.value = MASTER_GAIN;
        master.connect(ctx.destination);
      }
      const t0 = ctx.currentTime + 0.015;
      for (const n of notes) {
        const start = t0 + n.at;
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        osc.type = n.type || 'sine';
        osc.frequency.setValueAtTime(n.f, start);
        amp.gain.setValueAtTime(SILENT, start);
        amp.gain.exponentialRampToValueAtTime(n.g, start + ATTACK_S);
        amp.gain.exponentialRampToValueAtTime(SILENT, start + n.d);
        osc.connect(amp);
        amp.connect(master);
        const voiceNode = { osc, amp };
        sounding.add(voiceNode);
        osc.onended = () => {
          sounding.delete(voiceNode);
          try {
            osc.disconnect();
            amp.disconnect();
          } catch {
            /* ignore */
          }
        };
        osc.start(start);
        osc.stop(start + n.d + 0.05);
      }
    } catch {
      /* ignore */
    }
  }

  function stopTones() {
    if (!ctx || !sounding.size) return;
    const t = ctx.currentTime;
    for (const v of sounding) {
      try {
        const g = v.amp.gain;
        if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(t);
        else g.cancelScheduledValues(t);
        g.setTargetAtTime(0, t, 0.01); // fast fade, no click
        v.osc.stop(t + 0.08);
      } catch {
        /* already stopped */
      }
    }
    sounding.clear();
  }

  // ---- vibration -----------------------------------------------------------------

  const hapticTimers = new Set();
  let hapticLabel = null;
  let hapticInput = null;

  function clearHaptics() {
    for (const id of hapticTimers) clearTimeout(id);
    hapticTimers.clear();
  }

  function tapSwitch() {
    try {
      const doc = globalThis.document;
      if (!doc || !doc.body) return;
      if (!hapticLabel || hapticLabel.isConnected === false) {
        const label = doc.createElement('label');
        const input = doc.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        input.tabIndex = -1;
        label.setAttribute('aria-hidden', 'true');
        label.style.display = 'none';
        // Keep these synthetic clicks away from the app's own click handlers.
        if (typeof label.addEventListener === 'function') {
          label.addEventListener('click', (e) => e.stopPropagation());
        }
        label.appendChild(input);
        doc.body.appendChild(label);
        hapticLabel = label;
        hapticInput = input;
      }
      const prev = doc.activeElement;
      hapticLabel.click();
      if (prev && prev !== hapticInput && doc.activeElement === hapticInput && typeof prev.focus === 'function') {
        prev.focus({ preventScroll: true });
      }
    } catch {
      /* ignore */
    }
  }

  function supportsSwitchHaptics() {
    if (supportCache === null) supportCache = detectSwitchHaptics();
    return supportCache;
  }

  function buzz(name) {
    if (!vibrationOn) return;
    const pattern = VIBRATION_PATTERNS[name];
    if (!pattern) return;
    clearHaptics();
    const nav = globalThis.navigator;
    if (hasVibrate()) {
      try {
        nav.vibrate(pattern);
      } catch {
        /* ignore */
      }
      return;
    }
    if (!supportsSwitchHaptics()) return;
    // One light tap per pulse of the pattern, spaced so they stay distinct.
    let at = 0;
    let last = -Infinity;
    for (let i = 0; i < pattern.length; i += 2) {
      const when = Math.max(at, last + IOS_TAP_GAP_MS);
      last = when;
      at += pattern[i] + (pattern[i + 1] || 0);
      if (when <= 0) {
        tapSwitch(); // first tap stays inside the current gesture, if any
      } else {
        const id = setTimeout(() => {
          hapticTimers.delete(id);
          if (vibrationOn) tapSwitch();
        }, when);
        hapticTimers.add(id);
      }
    }
  }

  function stopVibration() {
    clearHaptics();
    if (!hasVibrate()) return;
    try {
      globalThis.navigator.vibrate(0);
    } catch {
      /* ignore */
    }
  }

  // ---- event interpretation ------------------------------------------------------

  let lastKey = null; // kind:moveIndex of the last announced segment
  let lastKeyAt = -Infinity;
  let resumeCounting = false;

  function indexOf(event, snap) {
    if (isInt(event.moveIndex)) return event.moveIndex;
    return isInt(snap.moveIndex) ? snap.moveIndex : null;
  }

  function moveOf(event, snap, idx) {
    if (isObj(event.move)) return event.move;
    if (isObj(snap.move) && (idx === null || !isInt(snap.moveIndex) || snap.moveIndex === idx)) return snap.move;
    if (isObj(snap.nextMove) && isInt(snap.moveIndex) && idx === snap.moveIndex + 1) return snap.nextMove;
    return null;
  }

  function altOf(event, snap, idx) {
    const alts = snap.alternatives;
    if (Array.isArray(alts) && idx !== null && idx >= 0 && idx < alts.length) return alts[idx] === true;
    return event.alternative === true;
  }

  // The version being performed: the default movement or its easier alternative.
  function version(move, alt) {
    if (!isObj(move)) return null;
    const a = alt && isObj(move.alt) ? move.alt : null;
    return {
      name: (a && spoken(a)) || spoken(move),
      setup: a ? clean(a.setup) || clean(a.cue) || clean(move.setup) : clean(move.setup),
      switchSides: a && typeof a.switchSides === 'boolean' ? a.switchSides : move.switchSides === true,
    };
  }

  function announce(kind, idx, v, status, fromStart) {
    const key = kind ? `${kind}:${idx}` : null;
    const t = now();
    if (key && key === lastKey && (!fromStart || t - lastKeyAt < 750)) return; // start + segment(prep)
    lastKey = key;
    lastKeyAt = t;
    const name = v ? v.name : '';
    if (status === 'paused' || status === 'resuming') {
      // Entered by Skip while paused: inform quietly, resume() gives the real cue.
      if (name) guide(`Next up: ${name}.`);
      return;
    }
    if (kind === 'work') {
      tone('work');
      buzz('work');
      guide(name ? `Go. ${name}.` : 'Go.');
    } else if (kind === 'transition') {
      tone('transition');
      buzz('transition');
      const setup = v && v.setup.length <= REST_SETUP_MAX ? sentence(v.setup) : '';
      guide([name ? `Rest. Next up: ${name}.` : 'Rest.', setup].filter(Boolean).join(' '));
    } else if (kind === 'prep') {
      const setup = v && v.setup.length <= PREP_SETUP_MAX ? sentence(v.setup) : '';
      guide([name ? `Get ready. First up: ${name}.` : 'Get ready.', setup].filter(Boolean).join(' '));
    }
  }

  function dispatch(event) {
    if (!isObj(event) || typeof event.type !== 'string') return;
    const snap = isObj(event.snapshot) ? event.snapshot : {};
    const idx = indexOf(event, snap);
    switch (event.type) {
      case 'start': {
        clearSuspend();
        resumeCounting = false;
        const kind = typeof event.kind === 'string' ? event.kind : snap.kind || 'prep';
        const i = idx === null ? 0 : idx;
        announce(kind, i, version(moveOf(event, snap, i), altOf(event, snap, i)), 'running', true);
        return;
      }
      case 'segment': {
        resumeCounting = false;
        const kind = typeof event.kind === 'string' ? event.kind : snap.kind;
        announce(kind, idx, version(moveOf(event, snap, idx), altOf(event, snap, idx)), snap.status, false);
        return;
      }
      case 'countdown': {
        tone('tick');
        buzz('countdown');
        count(WORDS[event.secondsLeft]);
        return;
      }
      case 'halfway': {
        const v = version(moveOf(event, snap, idx), altOf(event, snap, idx));
        const sides = typeof event.switchSides === 'boolean' ? event.switchSides : !!(v && v.switchSides);
        if (!sides) return;
        tone('switchSides');
        buzz('switchSides');
        guide('Switch sides.');
        return;
      }
      case 'pause': {
        resumeCounting = false;
        stopTones();
        tone('pause');
        buzz('pause');
        guide('Paused.');
        return;
      }
      case 'resume-countdown': {
        const word = WORDS[event.secondsLeft];
        tone('tick');
        buzz('countdown');
        if (!resumeCounting) {
          resumeCounting = true;
          guide(word ? `Resuming in ${word.toLowerCase()}` : 'Resuming.');
        } else {
          count(word);
        }
        return;
      }
      case 'resume': {
        resumeCounting = false;
        buzz('resume');
        const v = version(moveOf(event, snap, idx), altOf(event, snap, idx));
        if (snap.kind === 'transition') {
          tone('transition');
          guide(v ? `Rest. Next up: ${v.name}.` : 'Rest.');
        } else if (snap.kind === 'prep') {
          guide(v ? `Get ready. First up: ${v.name}.` : 'Get ready.');
        } else {
          tone('work');
          guide('Go.');
        }
        return;
      }
      case 'alternative': {
        const on = typeof event.on === 'boolean' ? event.on : altOf(event, snap, idx);
        const v = version(moveOf(event, snap, idx), on);
        const label = on ? 'Easier version' : 'Standard version';
        guide(v && v.name ? `${label}: ${v.name}.` : `${label}.`);
        return;
      }
      case 'complete': {
        resumeCounting = false;
        lastKey = null;
        clearHaptics();
        tone('complete');
        buzz('complete');
        guide('Workout complete. Well done.');
        scheduleSuspend(COMPLETE_SUSPEND_MS);
        return;
      }
      case 'end': {
        resumeCounting = false;
        lastKey = null;
        clearHaptics();
        if (audioOn) {
          cancelSpeech();
          stopTones();
        }
        if (vibrationOn) stopVibration();
        scheduleSuspend(END_SUSPEND_MS);
        return;
      }
      default:
        // 'skip' is followed by the 'segment' it lands on, which carries the cue.
        return;
    }
  }

  // ---- public API ----------------------------------------------------------------

  function unlock() {
    unlocked = true;
    clearSuspend();
    try {
      if (ensureAudioContext()) {
        wakeAudio();
        playSilence();
      }
    } catch {
      /* ignore */
    }
    try {
      primeSpeech();
    } catch {
      /* ignore */
    }
  }

  return {
    unlock,
    handle(event) {
      try {
        dispatch(event);
      } catch {
        /* cues must never break the player */
      }
    },
    setAudio(on) {
      audioOn = !!on;
      try {
        if (!audioOn) {
          cancelSpeech();
          stopTones();
        } else if (unlocked) {
          unlock(); // usually called from the Audio toggle tap, itself a gesture
        }
      } catch {
        /* ignore */
      }
    },
    setVibration(on) {
      vibrationOn = !!on;
      if (!vibrationOn) stopVibration();
    },
    get audio() {
      return audioOn;
    },
    get vibration() {
      return vibrationOn;
    },
    get vibrationSupported() {
      return hasVibrate() || supportsSwitchHaptics();
    },
    speak(text, speakOpts) {
      try {
        if (!audioOn) return false;
        const t = clean(typeof text === 'string' ? text : String(text ?? ''));
        if (!t) return false;
        if (!(isObj(speakOpts) && speakOpts.interrupt === false)) cancelSpeech();
        return say(t, 'guide');
      } catch {
        return false;
      }
    },
    stop() {
      resumeCounting = false;
      try {
        cancelSpeech();
        stopTones();
        stopVibration();
      } catch {
        /* ignore */
      }
    },
  };
}
