// Tests for js/cues.js and js/wakelock.js with mocked browser globals.
import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createCues, pickVoice, VIBRATION_PATTERNS } from '../js/cues.js';
import { createWakeLock } from '../js/wakelock.js';

// ---- global mocking ---------------------------------------------------------------

const GLOBALS = [
  'speechSynthesis',
  'SpeechSynthesisUtterance',
  'AudioContext',
  'webkitAudioContext',
  'navigator',
  'document',
  'HTMLInputElement',
];
const saved = new Map(GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));

function setGlobal(key, value) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true, enumerable: true });
}

function restoreGlobals() {
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete globalThis[key];
  }
}

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPHONE_STANDALONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPHONE_17_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

function fakeNavigator(extra = {}) {
  const nav = { language: 'en-US', userAgent: ANDROID_UA, maxTouchPoints: 5, ...extra };
  setGlobal('navigator', nav);
  return nav;
}

function withVibrate(extra = {}) {
  const calls = [];
  fakeNavigator({
    vibrate(p) {
      calls.push(Array.isArray(p) ? [...p] : p);
      return true;
    },
    ...extra,
  });
  return calls;
}

class FakeUtterance {
  constructor(text = '') {
    this.text = text;
    this.volume = 1;
    this.rate = 1;
    this.pitch = 1;
    this.lang = '';
    this.voice = null;
  }
}

// A speech engine. Without a clock it stays "speaking" after speak() until cancel() or
// finish(); with a clock it speaks 60 ms per character and records when each utterance
// actually starts (queue position included).
function fakeSpeech({ voices = [], clock = null } = {}) {
  let speakingFlag = false;
  let busyUntil = 0;
  const s = {
    spoken: [],
    log: [],
    started: [], // [text, startTime] (clock mode)
    paused: false,
    listeners: {},
    get speaking() {
      return clock ? clock() < busyUntil : speakingFlag;
    },
    get pending() {
      return false;
    },
    speak(u) {
      s.spoken.push(u);
      s.log.push(['speak', u.text]);
      if (clock) {
        const startAt = Math.max(busyUntil, clock());
        s.started.push([u.text, startAt, clock()]);
        busyUntil = startAt + (u.volume > 0 ? u.text.trim().length * 60 + 150 : 0);
      } else {
        speakingFlag = true;
      }
    },
    cancel() {
      s.log.push(['cancel']);
      speakingFlag = false;
      busyUntil = 0;
    },
    resume() {
      s.paused = false;
    },
    getVoices() {
      return voices;
    },
    addEventListener(type, fn) {
      (s.listeners[type] ||= []).push(fn);
    },
    finish() {
      speakingFlag = false;
    },
    // Audible texts only (the unlock primer is silent).
    texts() {
      return s.spoken.filter((u) => u.volume > 0).map((u) => u.text);
    },
  };
  setGlobal('speechSynthesis', s);
  setGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return s;
}

function fakeAudio({ webkit = false, state = 'suspended' } = {}) {
  const log = { contexts: [], oscillators: [], sources: [], resumes: 0, suspends: 0 };
  const node = () => ({ connect() {}, disconnect() {} });
  const param = (value) => {
    const p = {
      value,
      calls: [],
      setValueAtTime: (...a) => p.calls.push(['set', ...a]),
      exponentialRampToValueAtTime: (...a) => p.calls.push(['exp', ...a]),
      linearRampToValueAtTime: (...a) => p.calls.push(['lin', ...a]),
      setTargetAtTime: (...a) => p.calls.push(['target', ...a]),
      cancelScheduledValues: (...a) => p.calls.push(['cancel', ...a]),
    };
    return p;
  };
  class Ctx {
    constructor() {
      this.state = state;
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.destination = node();
      log.contexts.push(this);
    }
    resume() {
      log.resumes++;
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      log.suspends++;
      this.state = 'suspended';
      return Promise.resolve();
    }
    createGain() {
      return { ...node(), gain: param(1) };
    }
    createOscillator() {
      const o = {
        ...node(),
        type: 'sine',
        frequency: param(440),
        start(t) {
          o.startAt = t;
        },
        stop(t) {
          o.stopAt = t;
        },
      };
      log.oscillators.push(o);
      return o;
    }
    createBuffer(channels, length, rate) {
      return { channels, length, rate };
    }
    createBufferSource() {
      const src = {
        ...node(),
        buffer: null,
        started: false,
        start() {
          src.started = true;
        },
      };
      log.sources.push(src);
      return src;
    }
  }
  setGlobal(webkit ? 'webkitAudioContext' : 'AudioContext', Ctx);
  log.freqs = () => log.oscillators.map((o) => o.frequency.calls[0][1]);
  return log;
}

function fakeSwitchDom() {
  const clicks = [];
  const body = {
    children: [],
    appendChild(el) {
      body.children.push(el);
      el.isConnected = true;
      return el;
    },
  };
  const make = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      style: {},
      attrs: {},
      children: [],
      isConnected: false,
      setAttribute(k, v) {
        el.attrs[k] = v;
      },
      appendChild(c) {
        el.children.push(c);
        return c;
      },
      addEventListener() {},
      click() {
        clicks.push(el);
      },
    };
    return el;
  };
  setGlobal('document', { body, activeElement: null, createElement: make });
  function HTMLInputElement() {}
  HTMLInputElement.prototype.switch = false;
  setGlobal('HTMLInputElement', HTMLInputElement);
  return { clicks, body };
}

// ---- fixtures ---------------------------------------------------------------------

const LUNGE = {
  id: 'reverse-lunge',
  name: 'Reverse Lunge',
  say: 'Reverse lunges',
  setup: 'Stand tall, feet hip-width apart.',
  cue: 'Step back and lower until both knees bend.',
  alt: { name: 'Supported Split Squat', cue: 'Hold a wall and lower only partway.' },
};
const SIDE_PLANK = {
  id: 'side-plank',
  name: 'Side Plank',
  setup: 'Lie on one side, elbow under shoulder',
  switchSides: true,
  alt: { name: 'Knee Side Plank', cue: 'Keep the bottom knee down.' },
};
const SPLIT = {
  id: 'split-squat',
  name: 'Split Squat',
  setup: 'Stagger your feet.',
  switchSides: true,
  alt: { name: 'Wall Sit', switchSides: false, cue: 'Slide down the wall.' },
};
const JACKS = {
  id: 'jumping-jacks',
  name: 'Jumping Jacks',
  setup: 'Stand with feet together.',
  alt: { name: 'Step Jacks', say: 'Step jacks', cue: 'Step one foot out at a time.' },
};
const MOVES = [LUNGE, SIDE_PLANK, SPLIT, JACKS];

function snap(over = {}) {
  const moveIndex = over.moveIndex ?? 0;
  return {
    status: 'running',
    kind: 'prep',
    moveIndex,
    move: MOVES[moveIndex],
    nextMove: MOVES[moveIndex + 1] ?? null,
    alternatives: MOVES.map(() => false),
    ...over,
  };
}

function seg(kind, i, over = {}) {
  return {
    type: 'segment',
    kind,
    moveIndex: i,
    move: MOVES[i],
    nextMove: MOVES[i + 1] ?? null,
    alternative: false,
    snapshot: snap({ kind, moveIndex: i, ...over }),
  };
}

const altsOn = (i) => MOVES.map((_, j) => j === i);
const ev = (type, fields = {}, snapOver = {}) => ({ type, ...fields, snapshot: snap(snapOver) });

// ---- cues -------------------------------------------------------------------------

describe('cues', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
  });
  afterEach(() => {
    mock.timers.reset();
    restoreGlobals();
  });

  test('unlock primes speech silently and creates + resumes the AudioContext', () => {
    const synth = fakeSpeech();
    const audio = fakeAudio();
    fakeNavigator();
    const cues = createCues();
    cues.unlock();
    assert.equal(audio.contexts.length, 1);
    assert.equal(audio.resumes, 1);
    assert.equal(audio.contexts[0].state, 'running');
    assert.equal(audio.sources.length, 1, 'silent buffer played');
    assert.ok(audio.sources[0].started);
    assert.equal(audio.sources[0].buffer.length, 1);
    assert.equal(synth.spoken.length, 1);
    assert.equal(synth.spoken[0].volume, 0, 'primer is silent');
    assert.ok(synth.spoken[0].text.length <= 1);
    // Safe to repeat: one context, resumed again only when needed.
    cues.unlock();
    assert.equal(audio.contexts.length, 1);
    assert.equal(audio.resumes, 1);
    audio.contexts[0].state = 'interrupted'; // iOS after a call or backgrounding
    cues.unlock();
    assert.equal(audio.resumes, 2);
  });

  test('unlock uses webkitAudioContext when AudioContext is missing', () => {
    fakeSpeech();
    const audio = fakeAudio({ webkit: true });
    fakeNavigator();
    createCues().unlock();
    assert.equal(audio.contexts.length, 1);
    assert.equal(audio.contexts[0].state, 'running');
  });

  test('nothing throws when every browser API is missing', () => {
    setGlobal('navigator', undefined);
    const cues = createCues();
    assert.doesNotThrow(() => cues.unlock());
    for (const e of [seg('prep', 0), seg('work', 0), ev('countdown', { secondsLeft: 3 }), ev('pause'), ev('complete'), ev('end')]) {
      assert.doesNotThrow(() => cues.handle(e));
    }
    assert.equal(cues.vibrationSupported, false);
    assert.equal(cues.speak('Hello'), false);
    assert.doesNotThrow(() => cues.stop());
    assert.doesNotThrow(() => cues.setAudio(false));
    assert.doesNotThrow(() => cues.setVibration(false));
  });

  test('a throwing speech engine never breaks handle()', () => {
    setGlobal('speechSynthesis', {
      speaking: true,
      speak() {
        throw new Error('boom');
      },
      cancel() {
        throw new Error('boom');
      },
      getVoices() {
        throw new Error('boom');
      },
    });
    setGlobal('SpeechSynthesisUtterance', FakeUtterance);
    fakeNavigator();
    const cues = createCues();
    assert.doesNotThrow(() => cues.unlock());
    assert.doesNotThrow(() => cues.handle(seg('work', 0)));
    assert.doesNotThrow(() => cues.stop());
  });

  test('start announces prep once even though segment(prep) follows', () => {
    const synth = fakeSpeech();
    fakeNavigator();
    const cues = createCues();
    cues.handle(ev('start'));
    cues.handle(seg('prep', 0));
    assert.deepEqual(synth.texts(), ['Get ready. First up: Reverse lunges. Stand tall, feet hip-width apart.']);
  });

  test('prep segment without a start event is announced; long setups are left out', () => {
    const synth = fakeSpeech();
    fakeNavigator();
    const cues = createCues();
    cues.handle(seg('prep', 1));
    const long = { ...JACKS, setup: 'Stand with your feet together, arms by your sides, and look straight ahead at the horizon.' };
    cues.handle({ type: 'segment', kind: 'prep', moveIndex: 0, move: long, snapshot: snap({ moveIndex: 0, move: long }) });
    assert.deepEqual(synth.texts(), [
      'Get ready. First up: Side Plank. Lie on one side, elbow under shoulder.',
      'Get ready. First up: Jumping Jacks.',
    ]);
  });

  test('work, transition, countdown, complete script', () => {
    const synth = fakeSpeech();
    fakeNavigator();
    const cues = createCues();
    cues.handle(seg('work', 0));
    synth.finish();
    cues.handle(seg('transition', 3));
    synth.finish();
    cues.handle(ev('countdown', { secondsLeft: 3 }));
    synth.finish();
    cues.handle(ev('countdown', { secondsLeft: 2 }));
    synth.finish();
    cues.handle(ev('countdown', { secondsLeft: 1 }));
    cues.handle(ev('complete'));
    assert.deepEqual(synth.texts(), [
      'Go. Reverse lunges.',
      'Rest. Next up: Jumping Jacks. Stand with feet together.',
      'Three',
      'Two',
      'One',
      'Workout complete. Well done.',
    ]);
    for (const u of synth.spoken) {
      assert.equal(u.rate, 1);
      assert.equal(u.pitch, 1);
    }
  });

  test('alternative names are spoken when the easier version is on', () => {
    const synth = fakeSpeech();
    fakeNavigator();
    const cues = createCues();
    cues.handle(seg('work', 0, { alternatives: altsOn(0) }));
    cues.handle(seg('transition', 0, { alternatives: altsOn(0) }));
    cues.handle(seg('work', 3, { alternatives: altsOn(3) }));
    // No snapshot: falls back to the segment's own `alternative` flag.
    cues.handle({ type: 'segment', kind: 'transition', moveIndex: 1, move: SIDE_PLANK, alternative: true });
    assert.deepEqual(synth.texts(), [
      'Go. Supported Split Squat.',
      'Rest. Next up: Supported Split Squat. Hold a wall and lower only partway.',
      'Go. Step jacks.',
      'Rest. Next up: Knee Side Plank. Keep the bottom knee down.',
    ]);
  });

  test('alternative switch announcements', () => {
    const synth = fakeSpeech();
    fakeNavigator();
    const cues = createCues();
    cues.handle(ev('alternative', { moveIndex: 0, on: true }, { kind: 'work', alternatives: altsOn(0) }));
    cues.handle(ev('alternative', { moveIndex: 0, on: false }, { kind: 'work' }));
    // Upcoming movement during a transition: found through snapshot.nextMove.
    cues.handle(ev('alternative', { moveIndex: 1, on: true }, { kind: 'work', moveIndex: 0 }));
    cues.handle(ev('alternative', { moveIndex: 9, on: true }, { kind: 'work' }));
    assert.deepEqual(synth.texts(), [
      'Easier version: Supported Split Squat.',
      'Standard version: Reverse lunges.',
      'Easier version: Knee Side Plank.',
      'Easier version.',
    ]);
  });

  test('halfway says "Switch sides" only for one-sided versions', () => {
    const synth = fakeSpeech();
    const vib = withVibrate();
    const cues = createCues();
    const half = (i, alternatives = MOVES.map(() => false)) => ({
      type: 'halfway',
      moveIndex: i,
      move: MOVES[i],
      snapshot: snap({ kind: 'work', moveIndex: i, alternatives }),
    });
    cues.handle(half(0)); // lunge: no
    assert.equal(synth.texts().length, 0);
    assert.equal(vib.length, 0, 'silent and still when not one-sided');
    cues.handle(half(1)); // side plank: yes
    cues.handle(half(1, altsOn(1))); // knee side plank inherits switchSides
    cues.handle(half(2, altsOn(2))); // wall sit overrides with false
    cues.handle(half(2)); // split squat: yes
    assert.deepEqual(synth.texts(), ['Switch sides.', 'Switch sides.', 'Switch sides.']);
    assert.deepEqual(vib, [[150, 100, 150], [150, 100, 150], [150, 100, 150]]);
    // The session's own switchSides field wins when present.
    cues.handle({ ...half(0), switchSides: true });
    cues.handle({ ...half(1), switchSides: false });
    assert.equal(synth.texts().filter((t) => t === 'Switch sides.').length, 4);
  });

  test('pause, resume countdown and resume', () => {
    const synth = fakeSpeech();
    fakeNavigator();
    const cues = createCues();
    cues.handle(ev('pause', {}, { kind: 'work', status: 'paused' }));
    synth.finish();
    cues.handle(ev('resume-countdown', { secondsLeft: 3 }, { kind: 'work', status: 'resuming' }));
    synth.finish();
    cues.handle(ev('resume-countdown', { secondsLeft: 2 }, { kind: 'work', status: 'resuming' }));
    synth.finish();
    cues.handle(ev('resume-countdown', { secondsLeft: 1 }, { kind: 'work', status: 'resuming' }));
    cues.handle(ev('resume', {}, { kind: 'work' }));
    // Paused again during a transition: the resume cue is a rest cue, not "Go".
    cues.handle(ev('pause', {}, { kind: 'transition', moveIndex: 2, status: 'paused' }));
    cues.handle(ev('resume-countdown', { secondsLeft: 3 }, { kind: 'transition', moveIndex: 2 }));
    cues.handle(ev('resume', {}, { kind: 'transition', moveIndex: 2 }));
    assert.deepEqual(synth.texts(), [
      'Paused.',
      'Resuming in three',
      'Two',
      'One',
      'Go.',
      'Paused.',
      'Resuming in three',
      'Rest. Next up: Split Squat.',
    ]);
  });

  test('a new segment cancels stale speech before speaking', () => {
    const synth = fakeSpeech();
    fakeNavigator();
    const cues = createCues();
    cues.handle(seg('transition', 1));
    cues.handle(seg('work', 1)); // previous guidance still "speaking"
    assert.deepEqual(synth.log.slice(-2), [['cancel'], ['speak', 'Go. Side Plank.']]);
    cues.handle(ev('end'));
    assert.deepEqual(synth.log.at(-1), ['cancel'], 'end stops speech at once');
  });

  test('countdown words never lag behind the timer', () => {
    let t = 0;
    const synth = fakeSpeech();
    fakeNavigator();
    const cues = createCues({ now: () => t });
    // Long guidance still talking when "Three" is due: the word is dropped, not queued.
    cues.handle(seg('transition', 0));
    t = 1000;
    cues.handle(ev('countdown', { secondsLeft: 3 }));
    assert.ok(!synth.texts().includes('Three'));
    // Guidance is (by estimate) over: "Two" goes straight out, no cancel needed.
    t = 6000;
    const before = synth.log.length;
    cues.handle(ev('countdown', { secondsLeft: 2 }));
    assert.deepEqual(synth.log.slice(before), [['speak', 'Two']]);
    // A countdown word still queued when the next is due is cancelled, not waited on.
    t = 6010;
    cues.handle(ev('countdown', { secondsLeft: 1 }));
    assert.deepEqual(synth.log.slice(-2), [['cancel'], ['speak', 'One']]);
    // A short phrase about to finish is waited on briefly instead of cut off.
    synth.finish();
    t = 10000;
    cues.handle(ev('pause', {}, { status: 'paused' }));
    synth.finish();
    cues.handle(ev('resume-countdown', { secondsLeft: 3 }));
    t = 11000;
    const mark = synth.log.length;
    cues.handle(ev('resume-countdown', { secondsLeft: 2 }));
    assert.deepEqual(synth.log.slice(mark), [['speak', 'Two']]);
  });

  test('skip while paused only names the new movement', () => {
    const synth = fakeSpeech();
    const audio = fakeAudio({ state: 'running' });
    const vib = withVibrate();
    const cues = createCues();
    cues.unlock();
    cues.handle({ type: 'skip', snapshot: snap({ status: 'paused' }) });
    cues.handle(seg('work', 2, { status: 'paused' }));
    assert.deepEqual(synth.texts(), ['Next up: Split Squat.']);
    assert.equal(audio.oscillators.length, 0);
    assert.equal(vib.length, 0);
  });

  test('tones: distinct, enveloped, and skipped while the context is not running', () => {
    fakeSpeech();
    const audio = fakeAudio();
    fakeNavigator();
    const cues = createCues();
    cues.handle(seg('work', 0));
    assert.equal(audio.oscillators.length, 0, 'no context before unlock');
    cues.unlock();
    cues.handle(seg('work', 1));
    assert.deepEqual(audio.freqs(), [660, 990]);
    cues.handle(seg('transition', 1));
    cues.handle(ev('countdown', { secondsLeft: 3 }));
    cues.handle(ev('pause'));
    cues.handle(ev('complete'));
    assert.deepEqual(audio.freqs().slice(2), [392, 880, 330, 330, 523.25, 659.25, 783.99]);
    for (const o of audio.oscillators) {
      assert.ok(o.stopAt > o.startAt, 'every oscillator is stopped');
    }
    // Interrupted context (iOS): try to resume, play nothing late.
    const n = audio.oscillators.length;
    const resumes = audio.resumes;
    audio.contexts[0].state = 'interrupted';
    cues.handle(ev('countdown', { secondsLeft: 2 }));
    assert.equal(audio.oscillators.length, n);
    assert.equal(audio.resumes, resumes + 1);
  });

  test('the audio context is suspended after a workout and woken by unlock', () => {
    fakeSpeech();
    const audio = fakeAudio();
    fakeNavigator();
    const cues = createCues();
    cues.unlock();
    cues.handle(ev('complete'));
    mock.timers.tick(5000);
    assert.equal(audio.suspends, 1);
    cues.unlock();
    assert.equal(audio.contexts[0].state, 'running');
    cues.handle(ev('start'));
    cues.handle(ev('end'));
    cues.unlock(); // a new workout starts right away: the pending suspend is cancelled
    mock.timers.tick(5000);
    assert.equal(audio.suspends, 1);
  });

  test('setAudio(false) silences speech and tones; vibration still fires', () => {
    const synth = fakeSpeech();
    const audio = fakeAudio();
    const vib = withVibrate();
    const cues = createCues();
    cues.unlock();
    cues.handle(seg('transition', 0)); // speaking
    const oscBefore = audio.oscillators.length;
    cues.setAudio(false);
    assert.equal(cues.audio, false);
    assert.deepEqual(synth.log.at(-1), ['cancel'], 'turning audio off stops current speech');
    const spokenBefore = synth.spoken.length;
    cues.handle(seg('work', 0));
    cues.handle(ev('countdown', { secondsLeft: 3 }));
    cues.handle(ev('pause'));
    cues.handle(ev('complete'));
    assert.equal(synth.spoken.length, spokenBefore);
    assert.equal(audio.oscillators.length, oscBefore);
    assert.deepEqual(vib.slice(-4), [[180], [25], [40, 50, 40, 50, 40], [220, 90, 220, 90, 400]]);
    assert.equal(cues.speak('Hello'), false);
    cues.setAudio(true);
    cues.handle(seg('work', 1));
    assert.equal(synth.texts().at(-1), 'Go. Side Plank.');
  });

  test('setVibration(false) stops vibration; speech still plays', () => {
    const synth = fakeSpeech();
    const vib = withVibrate();
    const cues = createCues();
    cues.setVibration(false);
    assert.equal(cues.vibration, false);
    assert.deepEqual(vib, [0], 'any running pattern is stopped');
    cues.handle(seg('work', 0));
    cues.handle(ev('pause'));
    cues.handle(ev('complete'));
    assert.deepEqual(vib, [0]);
    assert.deepEqual(synth.texts(), ['Go. Reverse lunges.', 'Paused.', 'Workout complete. Well done.']);
  });

  test('constructor options set the initial switches', () => {
    fakeNavigator();
    const a = createCues({ audio: false, vibration: false });
    assert.equal(a.audio, false);
    assert.equal(a.vibration, false);
    const b = createCues();
    assert.equal(b.audio, true);
    assert.equal(b.vibration, true);
    assert.doesNotThrow(() => createCues(null));
  });

  test('distinct vibration patterns per event', () => {
    fakeSpeech();
    const vib = withVibrate();
    const cues = createCues();
    const run = (e) => {
      const n = vib.length;
      cues.handle(e);
      return vib.slice(n);
    };
    assert.deepEqual(run(ev('start')), []);
    assert.deepEqual(run(seg('work', 0)), [[180]]);
    assert.deepEqual(run(seg('transition', 1)), [[70, 60, 70]]);
    assert.deepEqual(run(ev('countdown', { secondsLeft: 3 })), [[25]]);
    assert.deepEqual(run(ev('pause')), [[40, 50, 40, 50, 40]]);
    assert.deepEqual(run(ev('resume-countdown', { secondsLeft: 3 })), [[25]]);
    assert.deepEqual(run(ev('resume', {}, { kind: 'work' })), [[120]]);
    assert.deepEqual(run(ev('alternative', { moveIndex: 0, on: true })), []);
    assert.deepEqual(run(ev('skip')), []);
    assert.deepEqual(run(ev('complete')), [[220, 90, 220, 90, 400]]);
    assert.deepEqual(run(ev('end')), [0]);
    const all = Object.values(VIBRATION_PATTERNS).map((p) => p.join(','));
    assert.equal(new Set(all).size, all.length, 'patterns are distinct');
  });

  test('unknown and malformed events are ignored', () => {
    const synth = fakeSpeech();
    const audio = fakeAudio({ state: 'running' });
    const vib = withVibrate();
    const cues = createCues();
    cues.unlock();
    const spoken = synth.spoken.length;
    const junk = [
      undefined,
      null,
      42,
      'segment',
      {},
      { type: 7 },
      { type: 'mystery', snapshot: 5 },
      { type: 'toString' },
      { type: '__proto__' },
      { type: 'countdown', secondsLeft: 99 },
      { type: 'countdown', secondsLeft: '2.5' },
      { type: 'halfway' },
      { type: 'halfway', move: null, snapshot: null },
      { type: 'skip' },
    ];
    for (const e of junk) assert.doesNotThrow(() => cues.handle(e));
    assert.equal(synth.spoken.length, spoken, 'nothing spoken');
    // Countdown ticks/buzzes for an odd number, but never speaks it.
    assert.deepEqual(vib, [[25], [25]]);
    assert.equal(audio.oscillators.length, 2);
    // Missing movement data degrades to generic cues.
    cues.handle({ type: 'segment', kind: 'work' });
    cues.handle({ type: 'segment', kind: 'transition', snapshot: { alternatives: 'x' } });
    cues.handle({ type: 'segment', kind: 'banana', moveIndex: 1 });
    assert.deepEqual(synth.texts(), ['Go.', 'Rest.']);
  });

  test('with audio and vibration both off, handle() does nothing observable', () => {
    const synth = fakeSpeech();
    const audio = fakeAudio({ state: 'running' });
    const vib = withVibrate();
    const dom = fakeSwitchDom();
    const cues = createCues({ audio: false, vibration: false });
    cues.unlock();
    const log = synth.log.length;
    const events = [
      ev('start'),
      seg('prep', 0),
      ev('countdown', { secondsLeft: 3 }),
      seg('work', 0),
      { type: 'halfway', moveIndex: 1, move: SIDE_PLANK, switchSides: true, snapshot: snap({ moveIndex: 1 }) },
      seg('transition', 1),
      ev('pause'),
      ev('resume-countdown', { secondsLeft: 3 }),
      ev('resume-countdown', { secondsLeft: 2 }),
      ev('resume'),
      ev('alternative', { moveIndex: 0, on: true }),
      ev('skip'),
      ev('complete'),
      ev('end'),
    ];
    for (const e of events) cues.handle(e);
    mock.timers.tick(1000);
    assert.equal(synth.log.length, log);
    assert.equal(audio.oscillators.length, 0);
    assert.deepEqual(vib, []);
    assert.equal(dom.clicks.length, 0);
  });

  test('speak() and stop()', () => {
    const synth = fakeSpeech();
    const vib = withVibrate();
    const cues = createCues();
    assert.equal(cues.speak('  Hello   there '), true);
    assert.equal(synth.texts().at(-1), 'Hello there');
    assert.equal(cues.speak(''), false);
    cues.speak('Queued', { interrupt: false });
    assert.notDeepEqual(synth.log.at(-2), ['cancel']);
    cues.stop();
    assert.deepEqual(synth.log.at(-1), ['cancel']);
    assert.deepEqual(vib.at(-1), 0);
  });

  test('voice choice: locale, then en-US / en-GB, local, never novelty', () => {
    const v = (name, lang, localService = true, extra = {}) => ({ name, lang, localService, ...extra });
    const voices = [
      v('Bad News', 'en-US'),
      v('Zarvox', 'en-US'),
      v('Thomas', 'fr-FR'),
      v('Google US English', 'en-US', false),
      v('Daniel', 'en-GB'),
      v('Samantha', 'en-US'),
      v('Karen', 'en-AU'),
      v('Eddy (English (US))', 'en-US'),
    ];
    assert.equal(pickVoice(voices, 'en-US').name, 'Samantha');
    assert.equal(pickVoice(voices, 'en-GB').name, 'Daniel');
    assert.equal(pickVoice(voices, 'en-AU').name, 'Karen');
    assert.equal(pickVoice(voices, 'de-DE').name, 'Samantha');
    assert.equal(pickVoice([v('Samantha', 'en-US'), v('Ava (Premium)', 'en-US')], 'en-US').name, 'Ava (Premium)');
    assert.equal(pickVoice([v('Google UK English Female', 'en_GB', false)], 'en-US').name, 'Google UK English Female');
    assert.equal(pickVoice([v('Bells', 'en-US'), v('Whisper', 'en-US'), v('Thomas', 'fr-FR')], 'en-US'), null);
    assert.equal(pickVoice([], 'en-US'), null);
    assert.equal(pickVoice(undefined), null);
  });

  test('voice is applied to utterances and re-picked when voices load', () => {
    const voices = [];
    const synth = fakeSpeech({ voices });
    fakeNavigator({ language: 'en-GB' });
    const cues = createCues();
    cues.speak('One');
    assert.equal(synth.spoken[0].voice, null);
    assert.equal(synth.spoken[0].lang, 'en-GB');
    voices.push({ name: 'Bubbles', lang: 'en-US', localService: true }, { name: 'Daniel', lang: 'en-GB', localService: true });
    for (const fn of synth.listeners.voiceschanged || []) fn();
    cues.speak('Two');
    assert.equal(synth.spoken[1].voice.name, 'Daniel');
    assert.equal(synth.spoken[1].lang, 'en-GB');
  });

  test('non-English browser language still speaks English', () => {
    const synth = fakeSpeech();
    fakeNavigator({ language: 'es-ES' });
    createCues().speak('Go.');
    assert.equal(synth.spoken[0].lang, 'en-US');
  });

  test('iOS 18+ switch haptics emulate patterns with timed taps', () => {
    fakeSpeech();
    fakeNavigator({ userAgent: IPHONE_UA });
    const dom = fakeSwitchDom();
    const cues = createCues();
    assert.equal(cues.vibrationSupported, true);
    cues.handle(seg('transition', 1));
    assert.equal(dom.clicks.length, 1, 'first tap is immediate (inside the gesture, if any)');
    mock.timers.tick(129);
    assert.equal(dom.clicks.length, 1);
    mock.timers.tick(1);
    assert.equal(dom.clicks.length, 2);
    // One hidden label + switch, reused.
    assert.equal(dom.body.children.length, 1);
    const label = dom.body.children[0];
    assert.equal(label.tagName, 'LABEL');
    assert.equal(label.style.display, 'none');
    assert.equal(label.attrs['aria-hidden'], 'true');
    const input = label.children[0];
    assert.equal(input.type, 'checkbox');
    assert.equal(input.attrs.switch, '');
    assert.ok(dom.clicks.every((el) => el === label));
    // Pause: three taps, spaced apart.
    cues.handle(ev('pause'));
    mock.timers.tick(109);
    assert.equal(dom.clicks.length, 3);
    mock.timers.tick(1);
    assert.equal(dom.clicks.length, 4);
    mock.timers.tick(110);
    assert.equal(dom.clicks.length, 5);
    assert.equal(dom.body.children.length, 1);
    // Complete, then turning vibration off cancels the remaining taps.
    cues.handle(ev('complete'));
    assert.equal(dom.clicks.length, 6);
    cues.setVibration(false);
    mock.timers.tick(2000);
    assert.equal(dom.clicks.length, 6);
    cues.handle(seg('work', 0));
    assert.equal(dom.clicks.length, 6);
  });

  test('a newer pattern or end cancels pending iOS taps', () => {
    fakeSpeech();
    fakeNavigator({ userAgent: IPHONE_STANDALONE_UA });
    const dom = fakeSwitchDom();
    const cues = createCues();
    assert.equal(cues.vibrationSupported, true, 'standalone UA (no Version token) still detected');
    cues.handle(ev('complete')); // taps at 0, 310, 620
    cues.handle(ev('end'));
    mock.timers.tick(1000);
    assert.equal(dom.clicks.length, 1);
    cues.handle(ev('complete'));
    cues.handle(seg('work', 0)); // replaces the remaining complete taps
    mock.timers.tick(1000);
    assert.equal(dom.clicks.length, 3);
  });

  test('vibration support detection', () => {
    const check = (setup) => {
      restoreGlobals();
      setup();
      return createCues().vibrationSupported;
    };
    assert.equal(check(() => withVibrate()), true, 'navigator.vibrate');
    assert.equal(check(() => (fakeNavigator({ userAgent: IPHONE_UA }), fakeSwitchDom())), true);
    assert.equal(check(() => (fakeNavigator({ userAgent: IPAD_UA, maxTouchPoints: 5 }), fakeSwitchDom())), true, 'iPadOS');
    assert.equal(check(() => (fakeNavigator({ userAgent: IPAD_UA, maxTouchPoints: 0 }), fakeSwitchDom())), false, 'macOS Safari');
    assert.equal(check(() => (fakeNavigator({ userAgent: IPHONE_17_UA }), fakeSwitchDom())), false, 'iOS 17 has no switch haptic');
    assert.equal(check(() => fakeNavigator({ userAgent: IPHONE_UA })), false, 'no DOM');
    assert.equal(
      check(() => {
        fakeNavigator({ userAgent: IPHONE_UA });
        fakeSwitchDom();
        delete globalThis.HTMLInputElement.prototype.switch;
      }),
      false,
      'no switch control',
    );
    assert.equal(check(() => fakeNavigator()), false, 'Android without vibrate');
  });
});

// ---- integration with the real session --------------------------------------------

describe('cues with js/session.js', () => {
  afterEach(() => {
    restoreGlobals();
  });

  test('a full workout with a pause produces a timely, complete script', async (t) => {
    let session;
    try {
      session = await import('../js/session.js');
    } catch {
      t.skip('js/session.js not available');
      return;
    }
    const moves = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      name: `Move ${i}`,
      setup: 'Stand tall.',
      switchSides: i === 4,
      alt: { name: `Easy ${i}` },
    }));
    let clock = 0;
    const synth = fakeSpeech({ clock: () => clock });
    const audio = fakeAudio();
    const vib = withVibrate();
    const s = session.createSession({ workout: { moves }, now: () => clock });
    const cues = createCues({ now: () => clock });
    const types = [];
    s.on((e) => types.push(e.type));
    s.on(cues.handle);
    cues.unlock();
    s.start();
    let paused = false;
    while (s.status !== 'complete' && clock < 500000) {
      clock += 50;
      if (!paused && clock === 30000) {
        s.pause();
        paused = true;
      } else if (clock === 36000) {
        cues.unlock();
        s.resume();
      } else {
        s.tick();
      }
    }
    assert.equal(s.status, 'complete');
    const texts = synth.texts();
    assert.equal(texts[0], 'Get ready. First up: Move 0. Stand tall.');
    assert.equal(texts.filter((x) => x.startsWith('Get ready')).length, 1);
    assert.equal(texts.filter((x) => /^Go\. Move \d+\.$/.test(x)).length, 12);
    assert.equal(texts.filter((x) => x.startsWith('Rest. Next up: Move ')).length, 11);
    assert.equal(texts.filter((x) => x === 'Switch sides.').length, 1);
    assert.equal(texts.at(-1), 'Workout complete. Well done.');
    const pauseAt = texts.indexOf('Paused.');
    assert.deepEqual(texts.slice(pauseAt, pauseAt + 5), ['Paused.', 'Resuming in three', 'Two', 'One', 'Go.']);
    // Countdown words: plenty of them, and none starts late.
    const words = synth.started.filter(([text]) => ['Three', 'Two', 'One'].includes(text));
    assert.ok(words.length >= 60, `countdown words spoken: ${words.length}`);
    for (const [text, startAt, calledAt] of words) {
      assert.ok(startAt - calledAt <= 350, `${text} lagged ${startAt - calledAt} ms`);
    }
    assert.equal(vib.filter((p) => Array.isArray(p) && p.join() === '180').length, 12);
    assert.equal(vib.filter((p) => Array.isArray(p) && p.join() === '70,60,70').length, 11);
    assert.equal(vib.filter((p) => Array.isArray(p) && p.join() === '220,90,220,90,400').length, 1);
    assert.ok(audio.oscillators.length > 100);
    assert.ok(types.includes('halfway'));
  });
});

// ---- wake lock --------------------------------------------------------------------

function fakeDocument(visibilityState = 'visible') {
  const listeners = {};
  const doc = {
    visibilityState,
    addEventListener(type, fn) {
      (listeners[type] ||= new Set()).add(fn);
    },
    removeEventListener(type, fn) {
      listeners[type]?.delete(fn);
    },
    dispatch(type) {
      for (const fn of [...(listeners[type] || [])]) fn({ type });
    },
    listenerCount(type) {
      return listeners[type]?.size ?? 0;
    },
  };
  setGlobal('document', doc);
  return doc;
}

function makeSentinel(type) {
  const listeners = new Set();
  const s = {
    type,
    released: false,
    releaseCalls: 0,
    addEventListener(t, fn) {
      if (t === 'release') listeners.add(fn);
    },
    removeEventListener(t, fn) {
      listeners.delete(fn);
    },
    async release() {
      s.releaseCalls++;
      if (s.released) return;
      s.released = true;
      for (const fn of [...listeners]) fn({ type: 'release' });
    },
    // The system dropping the lock (page hidden, power saving).
    systemRelease() {
      s.released = true;
      for (const fn of [...listeners]) fn({ type: 'release' });
    },
  };
  return s;
}

function fakeWakeLockApi({ deny = false, throwSync = false, gate = null } = {}) {
  const sentinels = [];
  const api = {
    requests: 0,
    request(type) {
      api.requests++;
      if (throwSync) throw new TypeError('nope');
      if (deny) return Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
      const s = makeSentinel(type);
      sentinels.push(s);
      return gate ? gate.then(() => s) : Promise.resolve(s);
    },
  };
  fakeNavigator({ wakeLock: api });
  return { api, sentinels };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('wake lock', () => {
  afterEach(() => {
    restoreGlobals();
  });

  test('unsupported: acquire resolves false, release resolves, nothing throws', async () => {
    fakeNavigator();
    fakeDocument();
    const lock = createWakeLock();
    assert.equal(lock.supported, false);
    assert.equal(await lock.acquire(), false);
    assert.equal(lock.active, false);
    await lock.release();
    setGlobal('navigator', undefined);
    setGlobal('document', undefined);
    const bare = createWakeLock();
    assert.equal(bare.supported, false);
    assert.equal(await bare.acquire(), false);
    await bare.release();
  });

  test('acquire and release', async () => {
    const { api, sentinels } = fakeWakeLockApi();
    const doc = fakeDocument();
    const lock = createWakeLock();
    const seen = [];
    lock.onChange((a) => seen.push(a));
    assert.equal(lock.supported, true);
    assert.equal(await lock.acquire(), true);
    assert.equal(sentinels[0].type, 'screen');
    assert.equal(lock.active, true);
    assert.equal(await lock.acquire(), true, 'idempotent');
    assert.equal(api.requests, 1);
    await lock.release();
    assert.equal(lock.active, false);
    assert.equal(sentinels[0].released, true);
    assert.deepEqual(seen, [true, false]);
    assert.equal(doc.listenerCount('visibilitychange'), 0);
    await lock.release(); // twice is fine
    assert.deepEqual(seen, [true, false]);
  });

  test('re-acquires when the page becomes visible again, only while wanted', async () => {
    const { api, sentinels } = fakeWakeLockApi();
    const doc = fakeDocument();
    const lock = createWakeLock();
    const seen = [];
    lock.onChange((a) => seen.push(a));
    await lock.acquire();
    doc.visibilityState = 'hidden';
    sentinels[0].systemRelease();
    doc.dispatch('visibilitychange');
    await flush();
    assert.equal(lock.active, false);
    assert.equal(api.requests, 1, 'no request while hidden');
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await flush();
    assert.equal(api.requests, 2);
    assert.equal(lock.active, true);
    assert.deepEqual(seen, [true, false, true]);
    await lock.release();
    doc.visibilityState = 'hidden';
    doc.dispatch('visibilitychange');
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await flush();
    assert.equal(api.requests, 2, 'not re-acquired after release()');
    assert.equal(lock.active, false);
  });

  test('acquire while hidden waits for visibility', async () => {
    const { api } = fakeWakeLockApi();
    const doc = fakeDocument('hidden');
    const lock = createWakeLock();
    assert.equal(await lock.acquire(), false);
    assert.equal(api.requests, 0);
    doc.visibilityState = 'visible';
    doc.dispatch('visibilitychange');
    await flush();
    assert.equal(lock.active, true);
  });

  test('denied or throwing requests resolve false', async () => {
    fakeWakeLockApi({ deny: true });
    fakeDocument();
    const denied = createWakeLock();
    assert.equal(await denied.acquire(), false);
    assert.equal(denied.active, false);
    restoreGlobals();
    fakeWakeLockApi({ throwSync: true });
    fakeDocument();
    const throwing = createWakeLock();
    assert.equal(await throwing.acquire(), false);
    await throwing.release();
  });

  test('release during an in-flight request releases the late sentinel', async () => {
    let open;
    const gate = new Promise((r) => {
      open = r;
    });
    const { sentinels } = fakeWakeLockApi({ gate });
    fakeDocument();
    const lock = createWakeLock();
    const seen = [];
    lock.onChange((a) => seen.push(a));
    const pending = lock.acquire();
    await lock.release();
    open();
    assert.equal(await pending, false);
    assert.equal(sentinels[0].released, true);
    assert.equal(lock.active, false);
    assert.deepEqual(seen, []);
  });

  test('concurrent acquires share one request', async () => {
    const { api } = fakeWakeLockApi();
    fakeDocument();
    const lock = createWakeLock();
    const [a, b] = await Promise.all([lock.acquire(), lock.acquire()]);
    assert.equal(a, true);
    assert.equal(b, true);
    assert.equal(api.requests, 1);
  });

  test('onChange: unsubscribe, bad listeners, non-functions', async () => {
    fakeWakeLockApi();
    fakeDocument();
    const lock = createWakeLock();
    const seen = [];
    lock.onChange(() => {
      throw new Error('listener bug');
    });
    const off = lock.onChange((a) => seen.push(a));
    assert.equal(typeof lock.onChange(null), 'function');
    assert.equal(await lock.acquire(), true);
    off();
    await lock.release();
    assert.deepEqual(seen, [true]);
  });
});
