// Fixed interval timeline (ENGINE-B). Pure functions, no DOM, no clock.
//
// Sequence: prep, work 0, transition, work 1, ..., transition, work N-1.
// There is no transition after the final movement. With the default TIMING:
// 10 s + 12 x 25 s + 11 x 10 s = 420 s = 420000 ms.
//
// All boundaries are integer milliseconds. A position exactly on a boundary
// belongs to the later segment.

import { TIMING } from './config.js';

/**
 * @typedef {'prep' | 'work' | 'transition'} SegmentKind
 * @typedef {{ index: number, kind: SegmentKind, move: number,
 *             startMs: number, endMs: number, durationMs: number }} Segment
 *   `move` is the movement the segment is about: prep -> 0, work i -> i,
 *   transition before movement i -> i (the upcoming movement).
 * @typedef {{ segIndex: number, seg: Segment | null, intoMs: number,
 *             remainingMs: number, done: boolean }} Location
 */

function secondsToMs(value, label) {
  const ms = Math.round(Number(value) * 1000);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new RangeError(`timeline: ${label} must be a positive number of seconds`);
  }
  return ms;
}

/**
 * Build the frozen segment list.
 * @param {number} [moveCount]
 * @param {{ prepSec: number, workSec: number, transitionSec: number }} [timing]
 * @returns {ReadonlyArray<Segment>}
 */
export function buildTimeline(moveCount = TIMING.moves, timing = TIMING) {
  if (!Number.isInteger(moveCount) || moveCount < 1) {
    throw new RangeError('timeline: moveCount must be a positive integer');
  }
  if (!timing || typeof timing !== 'object') {
    throw new TypeError('timeline: timing must be an object');
  }
  const prepMs = secondsToMs(timing.prepSec, 'prepSec');
  const workMs = secondsToMs(timing.workSec, 'workSec');
  const transitionMs = secondsToMs(timing.transitionSec, 'transitionSec');

  const segments = [];
  let cursor = 0;
  const push = (kind, move, durationMs) => {
    segments.push(
      Object.freeze({
        index: segments.length,
        kind,
        move,
        startMs: cursor,
        endMs: cursor + durationMs,
        durationMs,
      }),
    );
    cursor += durationMs;
  };

  push('prep', 0, prepMs);
  for (let i = 0; i < moveCount; i++) {
    if (i > 0) push('transition', i, transitionMs);
    push('work', i, workMs);
  }
  return Object.freeze(segments);
}

/**
 * Total length of a timeline in milliseconds (end of the last segment).
 * @param {ReadonlyArray<Segment>} timeline
 */
export function totalMs(timeline) {
  return timeline.length ? timeline[timeline.length - 1].endMs : 0;
}

/**
 * Find the segment that contains a position.
 * Negative or non-numeric positions are treated as 0. A position at or past
 * the end reports the last segment with `done: true` and `remainingMs: 0`.
 * @param {ReadonlyArray<Segment>} timeline
 * @param {number} posMs
 * @returns {Location}
 */
export function locate(timeline, posMs) {
  const n = timeline.length;
  if (n === 0) return { segIndex: -1, seg: null, intoMs: 0, remainingMs: 0, done: true };

  const pos = posMs > 0 ? posMs : 0; // also maps NaN to 0
  const last = timeline[n - 1];
  if (pos >= last.endMs) {
    return { segIndex: n - 1, seg: last, intoMs: last.durationMs, remainingMs: 0, done: true };
  }

  // Largest index whose startMs <= pos (boundary belongs to the later segment).
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timeline[mid].startMs <= pos) lo = mid;
    else hi = mid - 1;
  }
  const seg = timeline[lo];
  return {
    segIndex: lo,
    seg,
    intoMs: Math.max(0, pos - seg.startMs),
    remainingMs: seg.endMs - pos,
    done: false,
  };
}
