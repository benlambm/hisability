import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTimeline, totalMs, locate } from '../js/timeline.js';
import { TIMING, TOTAL_SEC } from '../js/config.js';

const tl = buildTimeline();

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

test('default timeline has prep + 12 work + 11 transitions = 24 segments', () => {
  assert.equal(tl.length, 1 + TIMING.moves + (TIMING.moves - 1));
  assert.equal(tl.length, 24);
  assert.equal(tl.filter((s) => s.kind === 'prep').length, 1);
  assert.equal(tl.filter((s) => s.kind === 'work').length, 12);
  assert.equal(tl.filter((s) => s.kind === 'transition').length, 11);
});

test('segment kinds follow prep, work, (transition, work) x 11 with no trailing transition', () => {
  const expected = ['prep', 'work'];
  for (let i = 1; i < 12; i++) expected.push('transition', 'work');
  assert.deepEqual(
    tl.map((s) => s.kind),
    expected,
  );
  assert.equal(tl[tl.length - 1].kind, 'work');
});

test('move indices: prep -> 0, work i -> i, transition before i -> i', () => {
  assert.equal(tl[0].move, 0);
  const works = tl.filter((s) => s.kind === 'work');
  works.forEach((s, i) => assert.equal(s.move, i));
  const transitions = tl.filter((s) => s.kind === 'transition');
  transitions.forEach((s, k) => {
    assert.equal(s.move, k + 1);
    // The following segment is the work for that same movement.
    assert.equal(tl[s.index + 1].kind, 'work');
    assert.equal(tl[s.index + 1].move, s.move);
  });
});

test('durations, contiguity, integer milliseconds and indices', () => {
  let cursor = 0;
  tl.forEach((s, i) => {
    assert.equal(s.index, i);
    assert.equal(s.startMs, cursor);
    assert.equal(s.endMs - s.startMs, s.durationMs);
    for (const v of [s.startMs, s.endMs, s.durationMs]) assert.ok(Number.isInteger(v));
    const expected = { prep: 10000, work: 25000, transition: 10000 }[s.kind];
    assert.equal(s.durationMs, expected);
    cursor = s.endMs;
  });
});

test('total is exactly 420000 ms and matches TOTAL_SEC', () => {
  assert.equal(totalMs(tl), 420000);
  assert.equal(totalMs(tl), TOTAL_SEC * 1000);
  assert.equal(tl[tl.length - 1].endMs, 420000);
  assert.equal(totalMs([]), 0);
});

test('timeline and segments are frozen', () => {
  assert.ok(Object.isFrozen(tl));
  for (const s of tl) assert.ok(Object.isFrozen(s));
  assert.throws(() => {
    'use strict';
    tl[0].startMs = 5;
  }, TypeError);
});

test('custom move counts and timing', () => {
  const small = buildTimeline(3, { prepSec: 5, workSec: 20, transitionSec: 4 });
  assert.deepEqual(
    small.map((s) => [s.kind, s.move, s.startMs, s.endMs]),
    [
      ['prep', 0, 0, 5000],
      ['work', 0, 5000, 25000],
      ['transition', 1, 25000, 29000],
      ['work', 1, 29000, 49000],
      ['transition', 2, 49000, 53000],
      ['work', 2, 53000, 73000],
    ],
  );
  const one = buildTimeline(1);
  assert.deepEqual(one.map((s) => s.kind), ['prep', 'work']);
  assert.equal(totalMs(one), 35000);
  // Fractional seconds round to integer milliseconds.
  const frac = buildTimeline(2, { prepSec: 1.0004, workSec: 2.5, transitionSec: 0.75 });
  for (const s of frac) assert.ok(Number.isInteger(s.durationMs));
  assert.deepEqual(frac.map((s) => s.durationMs), [1000, 2500, 750, 2500]);
});

test('invalid arguments throw', () => {
  assert.throws(() => buildTimeline(0), RangeError);
  assert.throws(() => buildTimeline(2.5), RangeError);
  assert.throws(() => buildTimeline(-1), RangeError);
  assert.throws(() => buildTimeline(3, null), TypeError);
  assert.throws(() => buildTimeline(3, { prepSec: 0, workSec: 25, transitionSec: 10 }), RangeError);
  assert.throws(() => buildTimeline(3, { prepSec: 10, workSec: NaN, transitionSec: 10 }), RangeError);
  assert.throws(() => buildTimeline(3, { prepSec: 10, workSec: 25 }), RangeError);
});

test('locate: start, inside, and the last millisecond of a segment', () => {
  let r = locate(tl, 0);
  assert.equal(r.segIndex, 0);
  assert.equal(r.seg, tl[0]);
  assert.equal(r.intoMs, 0);
  assert.equal(r.remainingMs, 10000);
  assert.equal(r.done, false);

  r = locate(tl, 4321);
  assert.deepEqual([r.segIndex, r.intoMs, r.remainingMs, r.done], [0, 4321, 5679, false]);

  r = locate(tl, 9999);
  assert.deepEqual([r.segIndex, r.intoMs, r.remainingMs], [0, 9999, 1]);

  r = locate(tl, 9999.5);
  assert.deepEqual([r.segIndex, r.intoMs, r.remainingMs], [0, 9999.5, 0.5]);
});

test('locate: a position exactly on a boundary belongs to the later segment', () => {
  for (let i = 1; i < tl.length; i++) {
    const s = tl[i];
    const r = locate(tl, s.startMs);
    assert.equal(r.segIndex, i, `boundary ${s.startMs}`);
    assert.equal(r.intoMs, 0);
    assert.equal(r.remainingMs, s.durationMs);
    assert.equal(r.done, false);
    const before = locate(tl, s.startMs - 0.001);
    assert.equal(before.segIndex, i - 1);
  }
  assert.equal(locate(tl, 10000).seg.kind, 'work');
  assert.equal(locate(tl, 35000).seg.kind, 'transition');
  assert.equal(locate(tl, 45000).seg.kind, 'work');
});

test('locate: at and past the end reports done on the last segment', () => {
  const last = tl[tl.length - 1];
  let r = locate(tl, 419999);
  assert.deepEqual([r.segIndex, r.remainingMs, r.done], [23, 1, false]);
  for (const pos of [420000, 420000.0001, 500000, Infinity]) {
    r = locate(tl, pos);
    assert.equal(r.done, true);
    assert.equal(r.segIndex, tl.length - 1);
    assert.equal(r.seg, last);
    assert.equal(r.intoMs, last.durationMs);
    assert.equal(r.remainingMs, 0);
  }
});

test('locate: negative and non-numeric positions clamp to the start', () => {
  for (const pos of [-1, -100000, NaN, undefined, -Infinity]) {
    const r = locate(tl, pos);
    assert.equal(r.segIndex, 0);
    assert.equal(r.intoMs, 0);
    assert.equal(r.remainingMs, 10000);
    assert.equal(r.done, false);
  }
  const empty = locate([], 5);
  assert.equal(empty.done, true);
  assert.equal(empty.seg, null);
});

test('locate agrees with a linear scan at random positions', () => {
  const rng = mulberry32(42);
  for (let n = 0; n < 5000; n++) {
    const pos = rng() * 430000;
    const r = locate(tl, pos);
    if (pos >= 420000) {
      assert.equal(r.done, true);
      continue;
    }
    const idx = tl.findIndex((s) => s.startMs <= pos && pos < s.endMs);
    assert.equal(r.segIndex, idx);
    assert.ok(Math.abs(r.intoMs + r.remainingMs - tl[idx].durationMs) < 1e-6);
  }
});
