// Workout session state machine (ENGINE-B). DOM-free; the clock is injected.
//
// States: idle -> running <-> paused -> resuming -> running ... -> complete.
// end() from any non-terminal state -> ended. complete and ended are terminal.
//
// Timing model. The timeline position is
//     accumulatedMs + (now() - runStartedAt)   while running
//     accumulatedMs                            otherwise (frozen)
// and is never derived by summing tick intervals, so late or irregular ticks
// cannot drift. accumulatedMs is only re-based on pause, skip, end and
// completion. The resume countdown is timestamp-based too: running restarts
// exactly resumeCountdownMs after resume(), however late the next tick is.
//
// Event rules (applied by every reconciliation, i.e. tick(), snapshot() and
// every control method):
//   segment    every segment entered since the last reconciliation, in order.
//              If running time advanced by more than CATCH_UP_MS since then
//              (backgrounded tab), only the newest segment is emitted.
//   halfway    work segments, when the midpoint is crossed; only while still in
//              that segment and only if crossed less than CATCH_UP_MS ago.
//   countdown  secondsLeft 3, 2, 1 when the remaining time in a segment falls to
//              3000, 2000, 1000 ms; only while the display still shows that
//              number (crossed less than 1000 ms ago, same segment), so a late
//              tick never produces a burst of stale countdowns.
//   complete   once, when the position reaches the end; it supersedes any
//              halfway or countdown crossed in the same reconciliation.

import { TIMING } from './config.js';
import { buildTimeline, totalMs as timelineTotalMs, locate } from './timeline.js';

const CATCH_UP_MS = 1500;
const COUNTDOWN_FRESH_MS = 1000;
const HALFWAY_FRESH_MS = CATCH_UP_MS;
const COUNTDOWN_SECONDS = [3, 2, 1];

// Rank breaks ties between events at the same timeline position.
const RANK_SEGMENT = 0;
const RANK_HALFWAY = 1;
const RANK_COUNTDOWN = 2;

/**
 * @param {{
 *   workout: { moves: object[], key?: string },
 *   timeline?: ReadonlyArray<import('./timeline.js').Segment>,
 *   now?: () => number,
 *   resumeCountdownMs?: number,
 * }} options
 */
export function createSession({
  workout,
  timeline = buildTimeline(),
  now = () => performance.now(),
  resumeCountdownMs = TIMING.resumeCountdownSec * 1000,
} = {}) {
  if (!workout || !Array.isArray(workout.moves)) {
    throw new TypeError('session: workout.moves must be an array');
  }
  if (!Array.isArray(timeline) || timeline.length === 0) {
    throw new TypeError('session: timeline must be a non-empty segment array');
  }
  if (typeof now !== 'function') throw new TypeError('session: now must be a function');
  const workCount = timeline.filter((s) => s.kind === 'work').length;
  if (workout.moves.length !== workCount) {
    throw new RangeError(
      `session: workout has ${workout.moves.length} moves but the timeline has ${workCount} work segments`,
    );
  }
  const countdownMs = Number(resumeCountdownMs);
  if (!Number.isFinite(countdownMs) || countdownMs < 0) {
    throw new RangeError('session: resumeCountdownMs must be a non-negative number');
  }

  const moves = workout.moves;
  const total = timelineTotalMs(timeline);
  const lastIndex = timeline.length - 1;

  // movesReached for a position in segment i: work segments with index <= i,
  // i.e. every work segment whose start the position has reached. The position
  // never moves backwards, so this is the furthest work index entered + 1.
  const reachedBySeg = [];
  for (let i = 0, count = 0; i < timeline.length; i++) {
    if (timeline[i].kind === 'work') count++;
    reachedBySeg.push(count);
  }

  let status = 'idle';
  let accumulatedMs = 0; // timeline position at runStartedAt (or the frozen position)
  let runStartedAt = 0; // clock value when the current running stretch began
  let activeBaseMs = 0; // running time accumulated before the current stretch
  let lastPos = 0; // position at the last reconciliation (events emitted up to here)
  let resumeStartedAt = 0;
  let resumeShown = 0; // last resume-countdown secondsLeft emitted
  let lastClock = -Infinity;
  const alternatives = moves.map(() => false);

  const handlers = new Set();
  const queue = [];
  let flushing = false;

  // ---- clock -------------------------------------------------------------

  // Monotonic, finite view of the injected clock.
  function readClock() {
    let v = Number(now());
    if (!Number.isFinite(v)) v = Number.isFinite(lastClock) ? lastClock : 0;
    if (v < lastClock) v = lastClock;
    lastClock = v;
    return v;
  }

  function runningPos(t) {
    const pos = accumulatedMs + (t - runStartedAt);
    if (pos >= total) return total;
    return pos > accumulatedMs ? pos : accumulatedMs;
  }

  function posAt(t) {
    return status === 'running' ? runningPos(t) : accumulatedMs;
  }

  function activeAt(t) {
    if (status !== 'running') return activeBaseMs;
    const run = Math.min(t - runStartedAt, total - accumulatedMs);
    return activeBaseMs + (run > 0 ? run : 0);
  }

  // Fold the current running stretch into accumulatedMs/activeBaseMs at t.
  function commitRun(t) {
    const elapsed = t - runStartedAt;
    const room = total - accumulatedMs;
    if (elapsed >= room) {
      activeBaseMs += room;
      accumulatedMs = total;
    } else if (elapsed > 0) {
      activeBaseMs += elapsed;
      accumulatedMs += elapsed;
    }
    runStartedAt = t;
  }

  // ---- snapshots and events ----------------------------------------------

  function moveAt(i) {
    return i >= 0 && i < moves.length ? moves[i] : null;
  }

  function snapAt(t) {
    const pos = posAt(t);
    const loc = locate(timeline, pos);
    const seg = loc.seg;
    const moveIndex = seg.move;
    return {
      status,
      posMs: pos,
      totalMs: total,
      segIndex: loc.segIndex,
      seg,
      kind: seg.kind,
      segElapsedMs: loc.intoMs,
      segRemainingMs: loc.remainingMs,
      moveIndex,
      move: moveAt(moveIndex),
      nextMove: moveAt(moveIndex + 1),
      upcoming: seg.kind !== 'work',
      resumeRemainingMs:
        status === 'resuming' ? Math.max(0, resumeStartedAt + countdownMs - t) : 0,
      activeMs: activeAt(t),
      movesReached: reachedBySeg[loc.segIndex],
      alternatives: alternatives.slice(),
    };
  }

  function enqueue(type, fields, t) {
    queue.push({ type, ...fields, snapshot: snapAt(t) });
  }

  function segmentFields(segIndex) {
    const seg = timeline[segIndex];
    return {
      segIndex,
      kind: seg.kind,
      moveIndex: seg.move,
      move: moveAt(seg.move),
      nextMove: moveAt(seg.move + 1),
      upcoming: seg.kind !== 'work',
      alternative: alternatives[seg.move] === true,
    };
  }

  function activeVersionSwitchesSides(moveIndex) {
    const move = moveAt(moveIndex);
    if (!move) return false;
    if (alternatives[moveIndex] && move.alt && typeof move.alt.switchSides === 'boolean') {
      return move.alt.switchSides;
    }
    return move.switchSides === true;
  }

  function flush() {
    if (flushing) return; // re-entrant call: the outer loop delivers in order
    flushing = true;
    try {
      while (queue.length) {
        const event = queue.shift();
        for (const entry of [...handlers]) {
          if (!handlers.has(entry)) continue; // unsubscribed during this event
          try {
            entry.fn(event);
          } catch (err) {
            console.error('session: event handler failed', err);
          }
        }
      }
    } finally {
      flushing = false;
    }
  }

  // ---- reconciliation ----------------------------------------------------

  // Advance a running session to clock value t, emitting crossings since lastPos.
  function advance(t) {
    const prev = lastPos;
    const pos = runningPos(t);
    if (!(pos > prev)) return;
    lastPos = pos;

    const prevIdx = locate(timeline, prev).segIndex;
    const loc = locate(timeline, pos);
    const curIdx = loc.segIndex;
    const catchUp = pos - prev > CATCH_UP_MS;
    const found = [];

    for (let j = prevIdx; j <= curIdx; j++) {
      const seg = timeline[j];
      if (j > prevIdx && (!catchUp || j === curIdx)) {
        found.push({ x: seg.startMs, rank: RANK_SEGMENT, type: 'segment', fields: segmentFields(j) });
      }
      // Halfway and countdown only matter for the segment we are still in.
      if (j !== curIdx || loc.done) continue;
      if (seg.kind === 'work') {
        const x = seg.startMs + seg.durationMs / 2;
        if (x > prev && x <= pos && pos - x < HALFWAY_FRESH_MS) {
          found.push({
            x,
            rank: RANK_HALFWAY,
            type: 'halfway',
            fields: {
              segIndex: j,
              moveIndex: seg.move,
              move: moveAt(seg.move),
              alternative: alternatives[seg.move] === true,
              switchSides: activeVersionSwitchesSides(seg.move),
            },
          });
        }
      }
      for (const secondsLeft of COUNTDOWN_SECONDS) {
        const x = seg.endMs - secondsLeft * 1000;
        if (x <= seg.startMs) continue; // segment too short for this second
        if (x > prev && x <= pos && pos - x < COUNTDOWN_FRESH_MS) {
          found.push({
            x,
            rank: RANK_COUNTDOWN,
            type: 'countdown',
            fields: { secondsLeft, segIndex: j, kind: seg.kind, moveIndex: seg.move },
          });
        }
      }
    }

    if (loc.done) {
      commitRun(t); // clamps at total: activeMs gains only the time actually needed
      accumulatedMs = total;
      lastPos = total;
      status = 'complete';
    }

    found.sort((a, b) => a.x - b.x || a.rank - b.rank);
    for (const f of found) enqueue(f.type, f.fields, t);
    if (loc.done) enqueue('complete', {}, t);
  }

  // Bring state up to the current clock value and queue events. Returns t.
  function reconcile() {
    const t = readClock();
    if (status === 'resuming') {
      const endAt = resumeStartedAt + countdownMs;
      if (t < endAt) {
        const secondsLeft = Math.ceil((endAt - t) / 1000);
        if (secondsLeft < resumeShown) {
          resumeShown = secondsLeft; // only the number on screen now, never stale ones
          enqueue('resume-countdown', { secondsLeft }, t);
        }
      } else {
        status = 'running';
        runStartedAt = endAt; // running began when the countdown ended, not at this tick
        resumeShown = 0;
        enqueue('resume', {}, t);
      }
    }
    if (status === 'running') advance(t);
    return t;
  }

  function isLive() {
    return status === 'running' || status === 'paused' || status === 'resuming';
  }

  // ---- public API ----------------------------------------------------------

  function start() {
    if (status !== 'idle') return;
    const t = readClock();
    status = 'running';
    accumulatedMs = 0;
    activeBaseMs = 0;
    runStartedAt = t;
    lastPos = 0;
    enqueue('start', {}, t);
    enqueue('segment', segmentFields(0), t);
    flush();
  }

  function pause() {
    const t = reconcile();
    if (status === 'running') {
      commitRun(t);
    } else if (status === 'resuming') {
      resumeShown = 0; // cancel the countdown; position never moved
    } else {
      flush();
      return;
    }
    status = 'paused';
    enqueue('pause', {}, t);
    flush();
  }

  function resume() {
    const t = reconcile();
    if (status !== 'paused') {
      flush();
      return;
    }
    if (countdownMs <= 0) {
      status = 'running';
      runStartedAt = t;
      enqueue('resume', {}, t);
    } else {
      status = 'resuming';
      resumeStartedAt = t;
      resumeShown = Math.ceil(countdownMs / 1000);
      enqueue('resume-countdown', { secondsLeft: resumeShown }, t);
    }
    flush();
  }

  function skip() {
    const t = reconcile();
    if (!isLive()) {
      flush();
      return;
    }
    if (status === 'running') commitRun(t);
    const from = locate(timeline, accumulatedMs);
    const fromFields = {
      fromSegIndex: from.segIndex,
      fromKind: from.seg.kind,
      fromMoveIndex: from.seg.move,
    };
    if (from.segIndex >= lastIndex) {
      // Skipping the final movement finishes the workout. Skipped time is not active time.
      accumulatedMs = total;
      lastPos = total;
      status = 'complete';
      resumeShown = 0;
      enqueue('skip', fromFields, t);
      enqueue('complete', {}, t);
    } else {
      // Prep/transition -> next work start; work i -> following transition start.
      const target = from.segIndex + 1;
      accumulatedMs = timeline[target].startMs;
      lastPos = accumulatedMs;
      enqueue('skip', fromFields, t);
      enqueue('segment', segmentFields(target), t);
    }
    flush();
  }

  function end() {
    const t = reconcile();
    if (status === 'complete' || status === 'ended') {
      flush();
      return;
    }
    const previousStatus = status;
    if (status === 'running') commitRun(t);
    status = 'ended';
    resumeShown = 0;
    enqueue('end', { previousStatus }, t);
    flush();
  }

  function tick() {
    reconcile();
    flush();
    return snapAt(lastClock);
  }

  function snapshot() {
    reconcile();
    flush();
    return snapAt(lastClock);
  }

  function isAlternative(i) {
    return Number.isInteger(i) && i >= 0 && i < alternatives.length && alternatives[i];
  }

  function setAlternative(i, on) {
    if (!Number.isInteger(i) || i < 0 || i >= alternatives.length) {
      throw new RangeError(`session: no movement at index ${i}`);
    }
    const t = reconcile();
    const value = Boolean(on);
    if (status === 'complete' || status === 'ended' || alternatives[i] === value) {
      flush();
      return;
    }
    alternatives[i] = value; // never touches the clock or the position
    enqueue('alternative', { moveIndex: i, on: value }, t);
    flush();
  }

  function on(handler) {
    if (typeof handler !== 'function') throw new TypeError('session: handler must be a function');
    const entry = { fn: handler };
    handlers.add(entry);
    return () => {
      handlers.delete(entry);
    };
  }

  return {
    start,
    pause,
    resume,
    skip,
    end,
    tick,
    snapshot,
    setAlternative,
    isAlternative,
    on,
    get status() {
      return status;
    },
    timeline,
    workout,
  };
}
