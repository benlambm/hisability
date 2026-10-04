import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSession } from '../js/session.js';
import { buildTimeline } from '../js/timeline.js';

const TL = buildTimeline();
const TOTAL = 420000;
const LAST = TL.length - 1; // 23

// ---- helpers -------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeMoves(n = 12) {
  return Array.from({ length: n }, (_, i) => {
    const move = {
      id: `move-${i}`,
      name: `Move ${i}`,
      cue: `Cue ${i}`,
      alt: { name: `Easier ${i}`, cue: `Easier cue ${i}` },
    };
    if (i === 2) move.switchSides = true; // alt inherits
    if (i === 3) {
      move.switchSides = true;
      move.alt.switchSides = false; // alt overrides
    }
    return move;
  });
}

function setup({ start = 5000, moves = makeMoves(), ...opts } = {}) {
  const clock = { t: start };
  const workout = { moves, key: moves.map((m) => m.id).join(',') };
  const session = createSession({ workout, now: () => clock.t, ...opts });
  const log = [];
  session.on((e) => log.push(e));
  return { clock, session, log, workout, moves, t0: start };
}

// Tick in fixed steps until the clock reaches targetT (inclusive).
function advanceTo(env, targetT, step = 100) {
  while (env.clock.t < targetT) {
    env.clock.t = Math.min(targetT, env.clock.t + step);
    env.session.tick();
  }
}

// Running position relative to start.
function pos(env) {
  return env.session.snapshot().posMs;
}

function since(log, n) {
  return log.slice(n);
}

function types(events) {
  return events.map((e) => e.type);
}

function countOf(log, type) {
  return log.filter((e) => e.type === type).length;
}

function tickUntilComplete(env, step = 100, limit = 1e6) {
  let n = 0;
  while (env.session.status !== 'complete') {
    env.clock.t += step;
    env.session.tick();
    if (++n > limit) throw new Error('did not complete');
  }
  return env.clock.t - env.t0;
}

const SNAPSHOT_KEYS = [
  'status',
  'posMs',
  'totalMs',
  'segIndex',
  'seg',
  'kind',
  'segElapsedMs',
  'segRemainingMs',
  'moveIndex',
  'move',
  'nextMove',
  'upcoming',
  'resumeRemainingMs',
  'activeMs',
  'movesReached',
  'alternatives',
].sort();

// ---- construction and idle ---------------------------------------------------

test('construction rejects bad inputs', () => {
  const workout = { moves: makeMoves(), key: 'k' };
  assert.throws(() => createSession(), TypeError);
  assert.throws(() => createSession({ workout: {} }), TypeError);
  assert.throws(() => createSession({ workout: { moves: makeMoves(11) } }), RangeError);
  assert.throws(() => createSession({ workout, now: 5 }), TypeError);
  assert.throws(() => createSession({ workout, timeline: [] }), TypeError);
  assert.throws(() => createSession({ workout, resumeCountdownMs: -1 }), RangeError);
  assert.throws(() => createSession({ workout, resumeCountdownMs: NaN }), RangeError);
});

test('idle snapshot has every contract field and sensible values', () => {
  const env = setup();
  const s = env.session.snapshot();
  assert.deepEqual(Object.keys(s).sort(), SNAPSHOT_KEYS);
  assert.equal(s.status, 'idle');
  assert.equal(s.posMs, 0);
  assert.equal(s.totalMs, TOTAL);
  assert.equal(s.segIndex, 0);
  assert.equal(s.seg, env.session.timeline[0]);
  assert.deepEqual(s.seg, TL[0]);
  assert.equal(s.kind, 'prep');
  assert.equal(s.segElapsedMs, 0);
  assert.equal(s.segRemainingMs, 10000);
  assert.equal(s.moveIndex, 0);
  assert.equal(s.move, env.moves[0]);
  assert.equal(s.nextMove, env.moves[1]);
  assert.equal(s.upcoming, true);
  assert.equal(s.resumeRemainingMs, 0);
  assert.equal(s.activeMs, 0);
  assert.equal(s.movesReached, 0);
  assert.deepEqual(s.alternatives, new Array(12).fill(false));
  assert.equal(env.log.length, 0);
  // Time passing while idle changes nothing.
  env.clock.t += 60000;
  env.session.tick();
  assert.equal(env.session.snapshot().posMs, 0);
  assert.equal(env.log.length, 0);
});

test('start emits start then the prep segment; a second start is a no-op', () => {
  const env = setup();
  env.session.start();
  assert.deepEqual(types(env.log), ['start', 'segment']);
  const seg = env.log[1];
  assert.equal(seg.kind, 'prep');
  assert.equal(seg.segIndex, 0);
  assert.equal(seg.moveIndex, 0);
  assert.equal(seg.move, env.moves[0]);
  assert.equal(seg.nextMove, env.moves[1]);
  assert.equal(seg.upcoming, true);
  assert.equal(seg.alternative, false);
  assert.equal(seg.snapshot.status, 'running');
  assert.equal(seg.snapshot.posMs, 0);
  env.clock.t += 500;
  env.session.start();
  assert.equal(env.log.length, 2);
  assert.equal(pos(env), 500);
});

test('the default clock is performance.now()', () => {
  const session = createSession({ workout: { moves: makeMoves(), key: 'k' } });
  session.start();
  const s = session.snapshot();
  assert.equal(s.status, 'running');
  assert.ok(s.posMs >= 0 && s.posMs < 1000);
  session.end();
  assert.equal(session.status, 'ended');
});

test('position comes from timestamps, not from ticks', () => {
  const env = setup();
  env.session.start();
  env.clock.t = env.t0 + 1234.5;
  // No tick in between: snapshot alone reconciles.
  assert.equal(env.session.snapshot().posMs, 1234.5);
  env.clock.t = env.t0 + 12000;
  const s = env.session.snapshot();
  assert.equal(s.posMs, 12000);
  assert.equal(s.segIndex, 1);
  assert.equal(s.kind, 'work');
  assert.equal(s.segElapsedMs, 2000);
  assert.equal(s.movesReached, 1);
});

// ---- exact duration ------------------------------------------------------------

test('irregular random ticks (1-400 ms) complete exactly at 420000 ms and never before', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rng = mulberry32(seed);
    const env = setup({ start: 1000 + seed * 7 });
    env.session.start();
    let lastPos = 0;
    let lastT = env.clock.t;
    while (env.session.status === 'running') {
      lastT = env.clock.t;
      env.clock.t += 1 + Math.floor(rng() * 400);
      const s = env.session.tick();
      const elapsed = env.clock.t - env.t0;
      assert.ok(s.posMs >= lastPos, 'posMs never decreases');
      lastPos = s.posMs;
      if (elapsed < TOTAL) {
        assert.equal(s.status, 'running', `not complete at ${elapsed}`);
        assert.equal(s.posMs, elapsed);
      } else {
        assert.equal(s.status, 'complete', `complete at ${elapsed}`);
      }
    }
    assert.ok(lastT - env.t0 < TOTAL);
    assert.ok(env.clock.t - env.t0 >= TOTAL);
    const s = env.session.snapshot();
    assert.equal(s.posMs, TOTAL);
    assert.equal(s.activeMs, TOTAL);
    assert.equal(s.movesReached, 12);
    assert.equal(countOf(env.log, 'complete'), 1);
    assert.equal(env.log.at(-1).type, 'complete');
  }
});

test('fractional clock values still complete exactly when now() - start >= 420000', () => {
  for (let seed = 100; seed < 110; seed++) {
    const rng = mulberry32(seed);
    const env = setup({ start: 1234.5678 + seed / 3 });
    env.session.start();
    while (env.session.status === 'running') {
      env.clock.t += 0.5 + rng() * 399.5;
      const s = env.session.tick();
      const elapsed = env.clock.t - env.t0;
      assert.equal(s.status === 'complete', elapsed >= TOTAL, `at ${elapsed}`);
    }
    assert.equal(env.session.snapshot().activeMs, TOTAL);
  }
});

test('one big tick of 420000 ms completes; 419999 ms does not', () => {
  let env = setup();
  env.session.start();
  env.clock.t = env.t0 + TOTAL - 1;
  let s = env.session.tick();
  assert.equal(s.status, 'running');
  assert.equal(s.segIndex, LAST);
  assert.equal(s.segRemainingMs, 1);

  env = setup();
  env.session.start();
  env.clock.t = env.t0 + TOTAL;
  s = env.session.tick();
  assert.equal(s.status, 'complete');
  assert.equal(s.posMs, TOTAL);
  assert.equal(s.activeMs, TOTAL);
  // Catch-up: only the newest segment, then complete.
  assert.deepEqual(types(env.log), ['start', 'segment', 'segment', 'complete']);
  assert.equal(env.log[2].segIndex, LAST);
});

test('a late final tick does not inflate active time', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + TOTAL - 50, 100);
  env.clock.t = env.t0 + TOTAL + 750;
  const s = env.session.tick();
  assert.equal(s.status, 'complete');
  assert.equal(s.posMs, TOTAL);
  assert.equal(s.activeMs, TOTAL);
  assert.equal(s.segRemainingMs, 0);
  assert.equal(s.nextMove, null);
  // Further time passing changes nothing.
  env.clock.t += 100000;
  assert.equal(env.session.snapshot().activeMs, TOTAL);
});

test('drift: 250 ms timer chain firing late completes at exactly 420000 ms of running time', () => {
  for (let seed = 7; seed < 12; seed++) {
    const rng = mulberry32(seed);
    const env = setup();
    env.session.start();
    let scheduled = env.t0 + 250;
    let ticks = 0;
    let prevT = env.t0;
    while (env.session.status === 'running') {
      prevT = env.clock.t;
      env.clock.t = scheduled + 1 + Math.floor(rng() * 80); // always late
      const s = env.session.tick();
      ticks++;
      if (s.status === 'running') assert.equal(s.posMs, env.clock.t - env.t0);
      scheduled = env.clock.t + 250; // setTimeout chains accumulate lateness
    }
    assert.ok(prevT - env.t0 < TOTAL);
    assert.ok(env.clock.t - env.t0 >= TOTAL);
    // Summing nominal intervals would need 1680 ticks; real ticks are fewer.
    assert.ok(ticks < 1680, `ticks ${ticks}`);
    const s = env.session.snapshot();
    assert.equal(s.activeMs, TOTAL);
    assert.equal(s.posMs, TOTAL);
  }
});

test('drift: fixed-rate 250 ms schedule with random late firing completes on the first tick past 420000', () => {
  const rng = mulberry32(99);
  const env = setup();
  env.session.start();
  let k = 0;
  while (env.session.status === 'running') {
    k++;
    env.clock.t = env.t0 + k * 250 + Math.floor(rng() * 200);
    env.session.tick();
  }
  const elapsed = env.clock.t - env.t0;
  assert.ok(elapsed >= TOTAL && elapsed < TOTAL + 250 + 200);
  assert.equal(env.session.snapshot().activeMs, TOTAL);
});

test('a clock that steps backwards never moves the position backwards', () => {
  const env = setup({ start: 10000 });
  env.session.start();
  advanceTo(env, 15000);
  assert.equal(pos(env), 5000);
  env.clock.t = 12000;
  assert.equal(env.session.tick().posMs, 5000);
  env.clock.t = 16000;
  assert.equal(env.session.tick().posMs, 6000);
});

// ---- pause and resume ------------------------------------------------------------

test('pause freezes position; resume counts down 3, 2, 1 then resumes after 3000 ms', () => {
  const env = setup();
  const { session, clock, t0 } = env;
  session.start();
  advanceTo(env, t0 + 30000);
  session.pause();
  assert.equal(env.log.at(-1).type, 'pause');
  assert.equal(env.log.at(-1).snapshot.status, 'paused');
  let s = session.snapshot();
  assert.equal(s.status, 'paused');
  assert.equal(s.posMs, 30000);
  assert.equal(s.activeMs, 30000);

  let mark = env.log.length;
  advanceTo(env, t0 + 90000); // 60 s paused
  assert.equal(env.log.length, mark, 'no events while paused');
  assert.equal(pos(env), 30000);
  session.pause(); // no-op
  assert.equal(env.log.length, mark);

  session.resume();
  let e = env.log.at(-1);
  assert.equal(e.type, 'resume-countdown');
  assert.equal(e.secondsLeft, 3);
  assert.equal(e.snapshot.status, 'resuming');
  assert.equal(e.snapshot.resumeRemainingMs, 3000);
  session.resume(); // no-op while resuming
  mark = env.log.length;

  clock.t = t0 + 90999;
  s = session.tick();
  assert.equal(env.log.length, mark);
  assert.equal(s.status, 'resuming');
  assert.equal(s.posMs, 30000);
  assert.equal(s.resumeRemainingMs, 2001);
  assert.equal(s.activeMs, 30000);

  clock.t = t0 + 91000;
  session.tick();
  assert.deepEqual(
    since(env.log, mark).map((x) => [x.type, x.secondsLeft]),
    [['resume-countdown', 2]],
  );
  clock.t = t0 + 92000;
  session.tick();
  assert.equal(env.log.at(-1).secondsLeft, 1);
  clock.t = t0 + 92999;
  s = session.tick();
  assert.equal(s.status, 'resuming');
  assert.equal(s.posMs, 30000);
  assert.equal(s.resumeRemainingMs, 1);
  clock.t = t0 + 93000;
  s = session.tick();
  assert.equal(env.log.at(-1).type, 'resume');
  assert.equal(s.status, 'running');
  assert.equal(s.posMs, 30000);
  assert.equal(s.resumeRemainingMs, 0);
  clock.t = t0 + 93001;
  assert.equal(pos(env), 30001);

  assert.deepEqual(
    types(env.log).filter((t) => t.startsWith('resume')),
    ['resume-countdown', 'resume-countdown', 'resume-countdown', 'resume'],
  );

  advanceTo(env, t0 + TOTAL + 60000 + 3000 - 1, 100);
  assert.equal(session.status, 'running');
  clock.t = t0 + TOTAL + 60000 + 3000;
  assert.equal(session.tick().status, 'complete');
  assert.equal(session.snapshot().activeMs, TOTAL);
});

test('pause during the resume countdown cancels it; total = 420000 + pauses + countdowns', () => {
  const env = setup();
  const { session, clock, t0 } = env;
  session.start();
  advanceTo(env, t0 + 50000);
  session.pause();
  advanceTo(env, t0 + 55000);
  session.resume();
  advanceTo(env, t0 + 56500);
  assert.deepEqual(
    env.log.filter((x) => x.type === 'resume-countdown').map((x) => x.secondsLeft),
    [3, 2],
  );
  session.pause();
  assert.equal(env.log.at(-1).type, 'pause');
  let s = session.snapshot();
  assert.equal(s.status, 'paused');
  assert.equal(s.posMs, 50000);
  assert.equal(s.resumeRemainingMs, 0);
  const mark = env.log.length;
  advanceTo(env, t0 + 60000);
  assert.equal(env.log.length, mark, 'cancelled countdown never fires');
  assert.equal(countOf(env.log, 'resume'), 0);

  session.resume();
  assert.equal(env.log.at(-1).secondsLeft, 3);
  advanceTo(env, t0 + 63000);
  assert.equal(env.log.at(-1).type, 'resume');
  assert.equal(pos(env), 50000);

  // 5000 paused + 1500 cancelled countdown + 3500 paused + 3000 countdown.
  const elapsed = tickUntilComplete(env, 100);
  assert.equal(elapsed, TOTAL + 13000);
  s = session.snapshot();
  assert.equal(s.activeMs, TOTAL);
  assert.equal(s.status, 'complete');
});

test('resume countdown is timestamp-based: late ticks skip stale numbers and do not lose time', () => {
  const env = setup();
  const { session, clock, t0 } = env;
  session.start();
  advanceTo(env, t0 + 20000);
  session.pause();
  session.resume(); // at t0 + 20000
  const mark = env.log.length;
  clock.t = t0 + 20500;
  session.tick();
  assert.equal(env.log.length, mark);
  clock.t = t0 + 22500; // 2 was due at +1000 but this tick is late
  session.tick();
  assert.deepEqual(
    since(env.log, mark).map((x) => [x.type, x.secondsLeft]),
    [['resume-countdown', 1]],
  );
  clock.t = t0 + 23400; // countdown ended at +3000; running since then
  const s = session.tick();
  assert.equal(env.log.at(-1).type, 'resume');
  assert.equal(s.status, 'running');
  assert.equal(s.posMs, 20400);
  assert.equal(s.activeMs, 20400);
});

test('resumeCountdownMs is configurable, including zero', () => {
  let env = setup({ resumeCountdownMs: 0 });
  env.session.start();
  advanceTo(env, env.t0 + 1000);
  env.session.pause();
  env.session.resume();
  assert.equal(env.log.at(-1).type, 'resume');
  assert.equal(env.session.status, 'running');
  assert.equal(countOf(env.log, 'resume-countdown'), 0);

  env = setup({ resumeCountdownMs: 2000 });
  env.session.start();
  env.session.pause();
  env.session.resume();
  advanceTo(env, env.t0 + 2000);
  assert.deepEqual(
    env.log.filter((x) => x.type.startsWith('resume')).map((x) => [x.type, x.secondsLeft]),
    [['resume-countdown', 2], ['resume-countdown', 1], ['resume', undefined]],
  );
});

test('pause and resume are no-ops in the wrong states', () => {
  const env = setup();
  env.session.pause();
  env.session.resume();
  assert.equal(env.session.status, 'idle');
  assert.equal(env.log.length, 0);
  env.session.start();
  env.session.resume(); // running: no-op
  assert.equal(env.session.status, 'running');
  assert.deepEqual(types(env.log), ['start', 'segment']);
});

// ---- skip ------------------------------------------------------------

test('skip during prep jumps to the first work start', () => {
  const env = setup();
  const { session, t0 } = env;
  session.start();
  advanceTo(env, t0 + 4000);
  const mark = env.log.length;
  session.skip();
  const evs = since(env.log, mark);
  assert.deepEqual(types(evs), ['skip', 'segment']);
  assert.equal(evs[0].fromSegIndex, 0);
  assert.equal(evs[0].fromKind, 'prep');
  assert.equal(evs[1].kind, 'work');
  assert.equal(evs[1].moveIndex, 0);
  assert.equal(evs[1].upcoming, false);
  const s = session.snapshot();
  assert.equal(s.status, 'running');
  assert.equal(s.posMs, 10000);
  assert.equal(s.segIndex, 1);
  assert.equal(s.activeMs, 4000);
  assert.equal(s.movesReached, 1);
  advanceTo(env, t0 + 5000);
  assert.equal(pos(env), 11000);
  assert.equal(session.snapshot().activeMs, 5000);
  // The rest of the run is shortened by the 6000 ms skipped.
  assert.equal(tickUntilComplete(env, 100), TOTAL - 6000);
  assert.equal(session.snapshot().activeMs, TOTAL - 6000);
});

test('skip mid-work jumps to the following transition start', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 20000);
  const mark = env.log.length;
  env.session.skip();
  const evs = since(env.log, mark);
  assert.deepEqual(types(evs), ['skip', 'segment']);
  assert.equal(evs[0].fromKind, 'work');
  assert.equal(evs[0].fromMoveIndex, 0);
  assert.equal(evs[1].kind, 'transition');
  assert.equal(evs[1].moveIndex, 1);
  assert.equal(evs[1].move, env.moves[1]);
  assert.equal(evs[1].nextMove, env.moves[2]);
  assert.equal(evs[1].upcoming, true);
  const s = env.session.snapshot();
  assert.equal(s.posMs, 35000);
  assert.equal(s.kind, 'transition');
  assert.equal(s.movesReached, 1);
  assert.equal(s.activeMs, 20000);
});

test('skip during a transition jumps to the next work start', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 40000);
  assert.equal(env.session.snapshot().kind, 'transition');
  env.session.skip();
  const s = env.session.snapshot();
  assert.equal(s.posMs, 45000);
  assert.equal(s.kind, 'work');
  assert.equal(s.moveIndex, 1);
  assert.equal(s.movesReached, 2);
  assert.equal(s.activeMs, 40000);
  assert.equal(env.log.at(-1).type, 'segment');
  assert.equal(env.log.at(-1).moveIndex, 1);
});

test('skip during the final movement completes the workout', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 400000);
  let s = env.session.snapshot();
  assert.equal(s.segIndex, LAST);
  const mark = env.log.length;
  env.session.skip();
  assert.deepEqual(types(since(env.log, mark)), ['skip', 'complete']);
  s = env.session.snapshot();
  assert.equal(s.status, 'complete');
  assert.equal(s.posMs, TOTAL);
  assert.equal(s.activeMs, 400000);
  assert.equal(s.movesReached, 12);
  env.clock.t += 50000;
  assert.equal(env.session.snapshot().activeMs, 400000);
});

test('skip while paused moves the position and stays paused', () => {
  const env = setup();
  const { session, t0 } = env;
  session.start();
  advanceTo(env, t0 + 20000);
  session.pause();
  session.skip();
  let s = session.snapshot();
  assert.equal(s.status, 'paused');
  assert.equal(s.posMs, 35000);
  assert.equal(s.activeMs, 20000);
  assert.deepEqual(types(env.log.slice(-2)), ['skip', 'segment']);
  assert.equal(env.log.at(-1).snapshot.status, 'paused');
  advanceTo(env, t0 + 30000);
  assert.equal(pos(env), 35000);
  session.skip(); // transition -> work 1, still paused
  s = session.snapshot();
  assert.equal(s.status, 'paused');
  assert.equal(s.posMs, 45000);
  assert.equal(s.movesReached, 2);
  session.resume();
  advanceTo(env, t0 + 33000);
  assert.equal(session.status, 'running');
  assert.equal(pos(env), 45000);
  advanceTo(env, t0 + 34000);
  assert.equal(pos(env), 46000);
});

test('skip while resuming moves the position and keeps the countdown', () => {
  const env = setup();
  const { session, t0 } = env;
  session.start();
  advanceTo(env, t0 + 2000);
  session.pause();
  session.resume(); // countdown ends at t0 + 5000
  advanceTo(env, t0 + 3500);
  session.skip();
  let s = session.snapshot();
  assert.equal(s.status, 'resuming');
  assert.equal(s.posMs, 10000);
  assert.equal(s.resumeRemainingMs, 1500);
  advanceTo(env, t0 + 5000);
  s = session.snapshot();
  assert.equal(s.status, 'running');
  assert.equal(s.posMs, 10000);
  advanceTo(env, t0 + 6000);
  assert.equal(pos(env), 11000);
  assert.equal(session.snapshot().activeMs, 3000);
});

test('skipping every segment from the start reaches completion with no active time', () => {
  const env = setup();
  env.session.start();
  let skips = 0;
  while (env.session.status !== 'complete') {
    env.session.skip();
    skips++;
    assert.ok(skips <= TL.length);
  }
  assert.equal(skips, TL.length);
  assert.equal(countOf(env.log, 'skip'), TL.length);
  assert.equal(countOf(env.log, 'segment'), TL.length); // prep from start + 23 via skip
  assert.equal(countOf(env.log, 'complete'), 1);
  assert.deepEqual(
    env.log.filter((e) => e.type === 'segment').map((e) => e.segIndex),
    TL.map((s) => s.index),
  );
  const s = env.session.snapshot();
  assert.equal(s.movesReached, 12);
  assert.equal(s.activeMs, 0);
  assert.equal(s.posMs, TOTAL);
});

test('movesReached counts work segments entered by time or by skip', () => {
  const env = setup();
  const { session, t0 } = env;
  assert.equal(session.snapshot().movesReached, 0);
  session.start();
  assert.equal(session.snapshot().movesReached, 0);
  advanceTo(env, t0 + 9999, 1111);
  assert.equal(session.snapshot().movesReached, 0);
  advanceTo(env, t0 + 10000);
  assert.equal(session.snapshot().movesReached, 1);
  session.skip(); // -> transition before move 1
  assert.equal(session.snapshot().movesReached, 1);
  session.skip(); // -> work 1
  assert.equal(session.snapshot().movesReached, 2);
  session.end();
  assert.equal(session.snapshot().movesReached, 2);
});

test('skip is a no-op when idle, complete, or ended', () => {
  let env = setup();
  env.session.skip();
  assert.equal(env.session.status, 'idle');
  assert.equal(env.log.length, 0);
  assert.equal(pos(env), 0);

  env = setup();
  env.session.start();
  env.clock.t += TOTAL;
  env.session.tick();
  let n = env.log.length;
  env.session.skip();
  assert.equal(env.log.length, n);

  env = setup();
  env.session.start();
  env.session.end();
  n = env.log.length;
  env.session.skip();
  assert.equal(env.log.length, n);
  assert.equal(pos(env), 0);
});

// ---- events over a full session -----------------------------------------------------

test('full session at 100 ms ticks: 24 segment, 12 halfway, 72 countdown events in order', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + TOTAL, 100);
  const { log, moves } = env;
  assert.equal(env.session.status, 'complete');
  assert.equal(countOf(log, 'start'), 1);
  assert.equal(countOf(log, 'segment'), 24);
  assert.equal(countOf(log, 'halfway'), 12);
  assert.equal(countOf(log, 'countdown'), 72);
  assert.equal(countOf(log, 'complete'), 1);
  assert.equal(log.length, 1 + 24 + 12 + 72 + 1);

  const expected = ['start'];
  for (const seg of TL) {
    expected.push(`segment:${seg.index}`);
    if (seg.kind === 'work') expected.push(`halfway:${seg.index}`);
    expected.push(`countdown:${seg.index}:3`, `countdown:${seg.index}:2`, `countdown:${seg.index}:1`);
  }
  expected.push('complete');
  const actual = log.map((e) => {
    if (e.type === 'segment') return `segment:${e.segIndex}`;
    if (e.type === 'halfway') return `halfway:${e.snapshot.segIndex}`;
    if (e.type === 'countdown') return `countdown:${e.snapshot.segIndex}:${e.secondsLeft}`;
    return e.type;
  });
  assert.deepEqual(actual, expected);

  for (const e of log) {
    assert.equal(typeof e.type, 'string');
    assert.deepEqual(Object.keys(e.snapshot).sort(), SNAPSHOT_KEYS);
    if (e.type === 'segment') {
      const seg = TL[e.segIndex];
      assert.equal(e.kind, seg.kind);
      assert.equal(e.moveIndex, seg.move);
      assert.equal(e.move, moves[seg.move]);
      assert.equal(e.nextMove, moves[seg.move + 1] ?? null);
      assert.equal(e.upcoming, seg.kind !== 'work');
      assert.equal(e.alternative, false);
      assert.equal(e.snapshot.segIndex, e.segIndex);
      assert.equal(e.snapshot.segElapsedMs, 0);
      assert.equal(e.snapshot.upcoming, seg.kind !== 'work');
      assert.equal(e.snapshot.move, moves[seg.move]);
      assert.equal(e.snapshot.nextMove, moves[seg.move + 1] ?? null);
    }
    if (e.type === 'halfway') {
      assert.equal(e.snapshot.kind, 'work');
      assert.equal(e.snapshot.segElapsedMs, 12500);
      assert.equal(e.moveIndex, e.snapshot.moveIndex);
      assert.equal(e.move, moves[e.moveIndex]);
    }
    if (e.type === 'countdown') {
      assert.equal(e.snapshot.segRemainingMs, e.secondsLeft * 1000);
      assert.equal(e.kind, e.snapshot.kind);
      assert.equal(e.moveIndex, e.snapshot.moveIndex);
    }
  }
  // Kind order of segment events.
  const kinds = log.filter((e) => e.type === 'segment').map((e) => e.kind);
  assert.deepEqual(kinds, TL.map((s) => s.kind));
  // Final work: nextMove is null.
  const lastSeg = log.filter((e) => e.type === 'segment').at(-1);
  assert.equal(lastSeg.moveIndex, 11);
  assert.equal(lastSeg.nextMove, null);
  assert.equal(log.at(-1).snapshot.status, 'complete');
});

test('events fire on the exact boundary millisecond, not one before', () => {
  const env = setup();
  const { session, clock, t0 } = env;
  session.start();
  const at = (ms) => {
    const mark = env.log.length;
    clock.t = t0 + ms;
    session.tick();
    return since(env.log, mark).map((e) => e.type + (e.secondsLeft ?? ''));
  };
  assert.deepEqual(at(6999), []);
  assert.deepEqual(at(7000), ['countdown3']); // 3000 ms remaining
  assert.deepEqual(at(7999.999), []);
  assert.deepEqual(at(8000), ['countdown2']);
  assert.deepEqual(at(9000), ['countdown1']);
  assert.deepEqual(at(9999.999), []);
  assert.deepEqual(at(10000), ['segment']);
  assert.equal(env.log.at(-1).snapshot.segElapsedMs, 0);
  assert.equal(env.log.at(-1).snapshot.segRemainingMs, 25000);
  assert.deepEqual(at(22499), []);
  assert.deepEqual(at(22500), ['halfway']); // 10000 + 25000 / 2
  assert.deepEqual(at(22501), []);
});

test('event counts hold for irregular ticks under 1000 ms', () => {
  const rng = mulberry32(5);
  const env = setup();
  env.session.start();
  while (env.session.status !== 'complete') {
    env.clock.t += 1 + Math.floor(rng() * 999);
    env.session.tick();
  }
  assert.equal(countOf(env.log, 'segment'), 24);
  assert.equal(countOf(env.log, 'halfway'), 12);
  assert.equal(countOf(env.log, 'countdown'), 72);
});

test('halfway carries switchSides for the active version', () => {
  const env = setup();
  env.session.setAlternative(3, true);
  env.session.start();
  advanceTo(env, env.t0 + TOTAL, 100);
  const halfway = env.log.filter((e) => e.type === 'halfway');
  assert.deepEqual(
    halfway.map((e) => e.switchSides),
    halfway.map((e) => e.moveIndex === 2), // move 3 alt overrides to false
  );
  assert.equal(halfway[3].alternative, true);
  assert.equal(halfway[2].alternative, false);
});

// ---- catch-up after long gaps ----------------------------------------------------

test('a 60 s gap emits only the newest segment and no stale countdowns or halfway', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 20000);
  const mark = env.log.length;
  env.clock.t = env.t0 + 85000; // work 2 (80000-105000), 5 s in
  const s = env.session.tick();
  const evs = since(env.log, mark);
  assert.deepEqual(types(evs), ['segment']);
  assert.equal(evs[0].segIndex, 5);
  assert.equal(evs[0].kind, 'work');
  assert.equal(evs[0].moveIndex, 2);
  assert.equal(s.posMs, 85000);
  assert.equal(s.movesReached, 3);
  // Normal ticking resumes afterwards.
  advanceTo(env, env.t0 + 105000);
  assert.deepEqual(
    since(env.log, mark + 1).map((e) => e.type + (e.secondsLeft ?? '')),
    ['halfway', 'countdown3', 'countdown2', 'countdown1', 'segment'],
  );
});

test('a gap inside one segment emits nothing stale', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 46000); // work 1
  const mark = env.log.length;
  env.clock.t = env.t0 + 66000; // still work 1, past halfway (57500)
  env.session.tick();
  assert.equal(env.log.length, mark);
});

test('a gap landing just after a countdown crossing emits that countdown only', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 20000);
  const mark = env.log.length;
  env.clock.t = env.t0 + 102300; // work 2 ends 105000: "3" crossed 300 ms ago
  env.session.tick();
  const evs = since(env.log, mark);
  assert.deepEqual(
    evs.map((e) => [e.type, e.segIndex ?? e.snapshot.segIndex, e.secondsLeft]),
    [
      ['segment', 5, undefined],
      ['countdown', 5, 3],
    ],
  );
});

test('a gap past the end emits the newest segment and complete only', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 20000);
  const mark = env.log.length;
  env.clock.t = env.t0 + 500000;
  const s = env.session.tick();
  assert.deepEqual(types(since(env.log, mark)), ['segment', 'complete']);
  assert.equal(env.log[mark].segIndex, LAST);
  assert.equal(s.status, 'complete');
  assert.equal(s.activeMs, TOTAL);
  assert.equal(s.movesReached, 12);
});

test('a gap that starts in the final movement emits complete only', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 400000);
  const mark = env.log.length;
  env.clock.t = env.t0 + 460000;
  env.session.tick();
  assert.deepEqual(types(since(env.log, mark)), ['complete']);
});

test('late ticks under the catch-up threshold drop only stale countdowns', () => {
  const env = setup();
  const { session, clock, t0 } = env;
  session.start();
  advanceTo(env, t0 + 31500); // work 0 ends at 35000
  let mark = env.log.length;
  clock.t = t0 + 32700; // crosses 32000 ("3") 700 ms ago
  session.tick();
  clock.t = t0 + 34100; // crosses 33000 ("2", 1100 ms ago: stale) and 34000 ("1")
  session.tick();
  clock.t = t0 + 35200; // enters the transition 200 ms ago
  session.tick();
  assert.deepEqual(
    since(env.log, mark).map((e) => e.type + (e.secondsLeft ?? '')),
    ['countdown3', 'countdown1', 'segment'],
  );
  // Halfway of work 1 (57500) crossed by a 1300 ms tick is still emitted.
  advanceTo(env, t0 + 56600);
  mark = env.log.length;
  clock.t = t0 + 57900;
  session.tick();
  assert.deepEqual(types(since(env.log, mark)), ['halfway']);
});

test('a long gap during the resume countdown: resume, newest segment, no stale numbers', () => {
  const env = setup();
  const { session, clock, t0 } = env;
  session.start();
  advanceTo(env, t0 + 20000);
  session.pause();
  session.resume(); // countdown ends at t0 + 23000
  const mark = env.log.length;
  clock.t = t0 + 85000; // running for 62 s since the countdown ended -> pos 82000
  const s = session.tick();
  const evs = since(env.log, mark);
  assert.deepEqual(types(evs), ['resume', 'segment']);
  assert.equal(evs[1].segIndex, 5);
  assert.equal(s.posMs, 82000);
  assert.equal(s.activeMs, 82000);
});

test('the first tick after a long pause is not treated as a catch-up', () => {
  const env = setup();
  const { session, t0 } = env;
  session.start();
  advanceTo(env, t0 + 31900);
  session.pause();
  env.clock.t = t0 + 200000;
  session.resume();
  advanceTo(env, t0 + 203100); // countdown ends at 203000, pos 32000
  assert.equal(env.log.at(-1).type, 'countdown');
  assert.equal(env.log.at(-1).secondsLeft, 3);
});

// ---- end ------------------------------------------------------------

function assertFrozenAfterTerminal(env) {
  const { session } = env;
  const before = session.snapshot();
  const n = env.log.length;
  env.clock.t += 100000;
  session.start();
  session.pause();
  session.resume();
  session.skip();
  session.end();
  session.tick();
  session.setAlternative(0, !before.alternatives[0]);
  const after = session.snapshot();
  assert.equal(env.log.length, n, 'no events after a terminal state');
  assert.equal(after.status, before.status);
  assert.equal(after.posMs, before.posMs);
  assert.equal(after.activeMs, before.activeMs);
  assert.equal(after.movesReached, before.movesReached);
  assert.deepEqual(after.alternatives, before.alternatives);
}

test('end from idle', () => {
  const env = setup();
  env.session.end();
  assert.equal(env.session.status, 'ended');
  assert.deepEqual(types(env.log), ['end']);
  assert.equal(env.log[0].previousStatus, 'idle');
  assert.equal(env.log[0].snapshot.status, 'ended');
  assertFrozenAfterTerminal(env);
});

test('end from running', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 30000);
  env.session.end();
  const e = env.log.at(-1);
  assert.equal(e.type, 'end');
  assert.equal(e.previousStatus, 'running');
  const s = env.session.snapshot();
  assert.equal(s.status, 'ended');
  assert.equal(s.posMs, 30000);
  assert.equal(s.activeMs, 30000);
  assert.equal(s.movesReached, 1);
  assertFrozenAfterTerminal(env);
});

test('end from paused', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 30000);
  env.session.pause();
  env.clock.t += 9000;
  env.session.end();
  assert.equal(env.log.at(-1).previousStatus, 'paused');
  const s = env.session.snapshot();
  assert.equal(s.status, 'ended');
  assert.equal(s.activeMs, 30000);
  assertFrozenAfterTerminal(env);
});

test('end from resuming cancels the countdown', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 30000);
  env.session.pause();
  env.session.resume();
  advanceTo(env, env.t0 + 31500);
  env.session.end();
  assert.equal(env.log.at(-1).previousStatus, 'resuming');
  const s = env.session.snapshot();
  assert.equal(s.resumeRemainingMs, 0);
  assert.equal(s.posMs, 30000);
  assertFrozenAfterTerminal(env);
  assert.equal(countOf(env.log, 'resume'), 0);
});

test('end after the countdown elapsed but before a tick counts the running time', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + 30000);
  env.session.pause();
  env.session.resume();
  env.clock.t = env.t0 + 34000; // countdown ended at 33000
  env.session.end();
  assert.deepEqual(types(env.log.slice(-2)), ['resume', 'end']);
  assert.equal(env.session.snapshot().activeMs, 31000);
});

test('end when the session already reached the end by time is a no-op after completing', () => {
  const env = setup();
  env.session.start();
  env.clock.t = env.t0 + TOTAL + 10;
  env.session.end();
  assert.equal(env.session.status, 'complete');
  assert.equal(countOf(env.log, 'end'), 0);
  assert.equal(countOf(env.log, 'complete'), 1);
});

test('complete is terminal: every control method is a no-op', () => {
  const env = setup();
  env.session.start();
  advanceTo(env, env.t0 + TOTAL, 1000);
  assert.equal(env.session.status, 'complete');
  assertFrozenAfterTerminal(env);
  assert.equal(countOf(env.log, 'complete'), 1);
});

test('ended is terminal and a second end is a no-op', () => {
  const env = setup();
  env.session.start();
  env.session.end();
  env.session.end();
  assert.equal(countOf(env.log, 'end'), 1);
});

// ---- alternatives ------------------------------------------------------------

test('setAlternative emits, is reflected in snapshots, and never touches the clock', () => {
  const env = setup();
  const { session, clock, t0 } = env;
  session.setAlternative(3, true);
  assert.deepEqual(env.log.map((e) => [e.type, e.moveIndex, e.on]), [['alternative', 3, true]]);
  assert.equal(env.log[0].snapshot.alternatives[3], true);
  assert.equal(session.isAlternative(3), true);
  assert.equal(session.isAlternative(4), false);
  assert.equal(session.isAlternative(99), false);
  assert.equal(session.isAlternative(-1), false);
  assert.equal(session.isAlternative(1.5), false);

  session.setAlternative(3, true); // unchanged: no event
  assert.equal(env.log.length, 1);

  const snap = session.snapshot();
  snap.alternatives[5] = true; // a copy
  assert.equal(session.isAlternative(5), false);
  assert.equal(session.snapshot().alternatives[5], false);

  session.start();
  advanceTo(env, t0 + 60000);
  const before = session.snapshot();
  const mark = env.log.length;
  session.setAlternative(1, true);
  session.setAlternative(1, false);
  session.setAlternative(7, 1); // truthy coerced
  const after = session.snapshot();
  assert.deepEqual(
    since(env.log, mark).map((e) => [e.type, e.moveIndex, e.on]),
    [
      ['alternative', 1, true],
      ['alternative', 1, false],
      ['alternative', 7, true],
    ],
  );
  assert.equal(after.posMs, before.posMs);
  assert.equal(after.status, 'running');
  assert.equal(after.activeMs, before.activeMs);
  assert.deepEqual(after.alternatives, [
    false, false, false, true, false, false, false, true, false, false, false, false,
  ]);
  assert.equal(clock.t, t0 + 60000);

  // Timing is unchanged by the switches.
  assert.equal(tickUntilComplete(env, 100), TOTAL);

  const segs = env.log.filter((e) => e.type === 'segment');
  for (const e of segs) {
    if (e.snapshot.posMs < 60000) continue;
    assert.equal(e.alternative, e.moveIndex === 3 || e.moveIndex === 7, `segment ${e.segIndex}`);
    assert.deepEqual(e.snapshot.alternatives, after.alternatives);
  }
  // The transition before move 3 already carries the alternative flag.
  assert.ok(segs.some((e) => e.kind === 'transition' && e.moveIndex === 3 && e.alternative));
  assert.ok(segs.some((e) => e.kind === 'work' && e.moveIndex === 3 && e.alternative));
});

test('setAlternative works while paused and resuming, and rejects bad indices', () => {
  const env = setup();
  env.session.start();
  env.session.pause();
  env.session.setAlternative(0, true);
  assert.equal(env.session.status, 'paused');
  env.session.resume();
  env.session.setAlternative(0, false);
  assert.equal(env.session.status, 'resuming');
  assert.equal(countOf(env.log, 'alternative'), 2);
  assert.throws(() => env.session.setAlternative(12, true), RangeError);
  assert.throws(() => env.session.setAlternative(-1, true), RangeError);
  assert.throws(() => env.session.setAlternative('2', true), RangeError);
});

// ---- handlers ------------------------------------------------------------

test('a throwing handler does not break the session or other handlers', () => {
  const env = setup();
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const seen = [];
    env.session.on(() => {
      throw new Error('boom');
    });
    env.session.on((e) => seen.push(e.type));
    env.session.start();
    advanceTo(env, env.t0 + 10000);
    assert.deepEqual(seen.slice(0, 2), ['start', 'segment']);
    assert.equal(seen.at(-1), 'segment');
    assert.equal(errors.length, seen.length);
    assert.equal(env.session.status, 'running');
    assert.equal(pos(env), 10000);
  } finally {
    console.error = original;
  }
});

test('on() returns an unsubscribe function, also safe during dispatch', () => {
  const env = setup();
  const a = [];
  const b = [];
  let offB = null;
  const offA = env.session.on((e) => {
    a.push(e.type);
    offB();
  });
  offB = env.session.on((e) => b.push(e.type));
  env.session.start();
  assert.deepEqual(a, ['start', 'segment']);
  assert.deepEqual(b, []);
  offA();
  offA(); // idempotent
  env.session.end();
  assert.deepEqual(a, ['start', 'segment']);
  assert.equal(env.log.at(-1).type, 'end');
  assert.throws(() => env.session.on(null), TypeError);
});

test('handlers that call back into the session keep events in order', () => {
  const env = setup();
  const { session, t0 } = env;
  session.on((e) => {
    session.snapshot(); // re-entrant reconcile must not duplicate events
    if (e.type === 'segment' && e.kind === 'work' && e.moveIndex === 0) session.pause();
  });
  session.start();
  advanceTo(env, t0 + 12000);
  assert.deepEqual(
    env.log.map((e) => e.type + (e.secondsLeft ?? '')),
    ['start', 'segment', 'countdown3', 'countdown2', 'countdown1', 'segment', 'pause'],
  );
  assert.equal(env.log[5].snapshot.status, 'running');
  assert.equal(env.log[6].snapshot.status, 'paused');
  const s = session.snapshot();
  assert.equal(s.status, 'paused');
  assert.equal(s.posMs, 10000);
});

// ---- custom timelines ------------------------------------------------------------

test('a custom timeline sets the length and the move count', () => {
  const timeline = buildTimeline(3, { prepSec: 5, workSec: 20, transitionSec: 5 });
  const env = setup({ moves: makeMoves(3), timeline });
  env.session.start();
  assert.equal(env.session.snapshot().totalMs, 75000);
  assert.equal(tickUntilComplete(env, 100), 75000);
  assert.equal(countOf(env.log, 'segment'), 6);
  assert.equal(countOf(env.log, 'halfway'), 3);
  assert.equal(countOf(env.log, 'countdown'), 18);
  assert.equal(env.session.snapshot().movesReached, 3);
});
