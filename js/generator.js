// Workout generation and validation (ENGINE-A).
//
// Pure module: no DOM, no storage, no clock or calendar, no network. Works in the browser and in Node.
//
// A workout is 12 distinct movements, exactly 3 per category, ordered so that no two adjacent
// movements share a primary region or a movement pattern and no two adjacent movements are both
// high impact. Generation is rejection sampling:
//   1. Draw 3 movements per category uniformly at random (partial Fisher-Yates).
//   2. Search for a valid order with randomized backtracking. Candidates are tried in random
//      order, so every valid order of the drawn movements is reachable. Dead search states
//      (used-set, last movement) are memoized, so the search is bounded even when no order exists.
//   3. If no order exists, redraw the selection. If the result equals `previousKey`, redraw it all.
// After MAX_ATTEMPTS draws the generator throws instead of looping forever.

import { CATEGORIES, PER_CATEGORY } from './config.js';
import { CATALOG } from './catalog/index.js';

const LENGTH = CATEGORIES.length * PER_CATEGORY;
const MAX_ATTEMPTS = 500;
const DEFAULT_EQUIPMENT = Object.freeze(['none', 'wall']);
const IMPACTS = Object.freeze(['low', 'high']);

// ---------------------------------------------------------------- randomness

const POOL_SIZE = 128; // even: two 32-bit words per 53-bit sample
let pool = null;
let poolPos = POOL_SIZE;

/** Uniform float in [0, 1) with 53 random bits from crypto.getRandomValues. */
export function cryptoRandom() {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') return Math.random(); // very old engines only
  if (poolPos >= POOL_SIZE) {
    if (!pool) pool = new Uint32Array(POOL_SIZE);
    c.getRandomValues(pool);
    poolPos = 0;
  }
  const hi = pool[poolPos++] >>> 5; // 27 bits
  const lo = pool[poolPos++] >>> 6; // 26 bits
  return (hi * 67108864 + lo) / 9007199254740992;
}

/** Small deterministic PRNG (uniform float in [0, 1)) for tests and reproducible runs. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [0, n). Rejects a broken rng instead of producing garbage indices. */
function randInt(rng, n) {
  const r = rng();
  if (!(r >= 0 && r < 1)) throw new RangeError(`rng must return a number in [0, 1), got ${r}`);
  return Math.min(n - 1, Math.floor(r * n));
}

// ---------------------------------------------------------------- rules

const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';

/** Per-movement rule violation ({ rule, detail }) or null. Shared by validation and generation. */
function moveProblem(m) {
  if (!m || typeof m !== 'object') return { rule: 'move', detail: 'is not a movement object' };
  if (!nonEmpty(m.id)) return { rule: 'move', detail: 'has no id (expected a non-empty string)' };
  if (!CATEGORIES.includes(m.category)) {
    return { rule: 'move', detail: `has unknown category '${m.category}' (expected ${CATEGORIES.join(', ')})` };
  }
  if (!nonEmpty(m.region)) return { rule: 'move', detail: 'has no region (expected a non-empty string)' };
  if (!nonEmpty(m.pattern)) return { rule: 'move', detail: 'has no pattern (expected a non-empty string)' };
  if (!IMPACTS.includes(m.impact)) return { rule: 'move', detail: `has impact '${m.impact}' (expected 'low' or 'high')` };
  if (!DEFAULT_EQUIPMENT.includes(m.equipment)) {
    return { rule: 'equipment', detail: `has default equipment '${m.equipment}' (must be 'none' or 'wall')` };
  }
  if (!m.alt || typeof m.alt !== 'object' || !nonEmpty(m.alt.name)) {
    return { rule: 'alt', detail: 'has no lower-impact alternative (alt with a name)' };
  }
  return null;
}

/** Which adjacency rule two neighbouring movements break: 'category' | 'region' | 'pattern' | 'impact' | null. */
function conflict(a, b) {
  if (a.category === b.category) return 'category';
  if (a.region === b.region) return 'region';
  if (a.pattern === b.pattern) return 'pattern';
  if (a.impact === 'high' && b.impact === 'high') return 'impact';
  return null;
}

const label = (m) => (m && typeof m === 'object' && nonEmpty(m.id) ? ` ('${m.id}')` : '');

function fail(rule, reason, index) {
  const out = { ok: false, reason, rule };
  if (index !== undefined) out.index = index;
  return out;
}

/**
 * Check a sequence against every workout rule.
 * Returns { ok: true } or { ok: false, reason, rule, index? } where `rule` is one of
 * 'length' | 'move' | 'equipment' | 'alt' | 'duplicate' | 'category-count' |
 * 'adjacent-category' | 'adjacent-region' | 'adjacent-pattern' | 'adjacent-impact', and `index` is the offending
 * position (for adjacency rules, the first of the two neighbours).
 */
export function validateSequence(moves) {
  if (!Array.isArray(moves)) return fail('length', `expected an array of ${LENGTH} moves, got ${moves === null ? 'null' : typeof moves}`);
  if (moves.length !== LENGTH) return fail('length', `expected ${LENGTH} moves, got ${moves.length}`);

  for (let i = 0; i < moves.length; i++) {
    const p = moveProblem(moves[i]);
    if (p) return fail(p.rule, `move at index ${i}${label(moves[i])} ${p.detail}`, i);
  }

  const firstIndex = new Map();
  for (let i = 0; i < moves.length; i++) {
    const id = moves[i].id;
    if (firstIndex.has(id)) {
      return fail('duplicate', `duplicate id '${id}' at index ${firstIndex.get(id)} and index ${i}`, i);
    }
    firstIndex.set(id, i);
  }

  for (const cat of CATEGORIES) {
    const n = moves.reduce((s, m) => s + (m.category === cat ? 1 : 0), 0);
    if (n !== PER_CATEGORY) {
      return fail('category-count', `category '${cat}' has ${n} moves, expected exactly ${PER_CATEGORY}`);
    }
  }

  for (let i = 0; i + 1 < moves.length; i++) {
    const a = moves[i];
    const b = moves[i + 1];
    const c = conflict(a, b);
    if (!c) continue;
    const pair = `adjacent moves at index ${i} ('${a.id}') and index ${i + 1} ('${b.id}')`;
    if (c === 'category') return fail('adjacent-category', `${pair} share category '${a.category}'`, i);
    if (c === 'region') return fail('adjacent-region', `${pair} share region '${a.region}'`, i);
    if (c === 'pattern') return fail('adjacent-pattern', `${pair} share pattern '${a.pattern}'`, i);
    return fail('adjacent-impact', `${pair} are both high impact`, i);
  }

  return { ok: true };
}

/** Stable identity of an ordered sequence: ids joined with ','. */
export function sequenceKey(moves) {
  return moves.map((m) => m.id).join(',');
}

// ---------------------------------------------------------------- generation

/** Eligible movements grouped by category (first occurrence of each id wins). Throws if too few. */
function eligiblePools(catalog) {
  const pools = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  const skipped = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const seen = new Set();
  for (const m of catalog) {
    if (moveProblem(m)) {
      if (m && CATEGORIES.includes(m.category)) skipped[m.category]++;
      continue;
    }
    if (seen.has(m.id)) {
      skipped[m.category]++;
      continue;
    }
    seen.add(m.id);
    pools[m.category].push(m);
  }
  for (const cat of CATEGORIES) {
    if (pools[cat].length < PER_CATEGORY) {
      const extra = skipped[cat] ? ` (${skipped[cat]} more skipped as ineligible or duplicate)` : '';
      throw new Error(
        `generateWorkout: catalog too small: category '${cat}' has ${pools[cat].length} eligible ` +
          `movements${extra}, needs at least ${PER_CATEGORY}`,
      );
    }
  }
  return pools;
}

/** Append k distinct random members of pool to out (partial Fisher-Yates, uniform). */
function drawInto(out, pool, k, rng) {
  const a = pool.slice();
  for (let i = 0; i < k; i++) {
    const j = i + randInt(rng, a.length - i);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
    out.push(a[i]);
  }
}

// Memo of dead search states, indexed by usedMask * n + last. A per-search stamp avoids clearing.
let dead = null;
let stamp = 0;
function nextStamp(size) {
  if (!dead || dead.length < size) {
    dead = new Uint32Array(size);
    stamp = 0;
  }
  stamp++;
  if (stamp >= 0xffffffff) {
    dead.fill(0);
    stamp = 1;
  }
  return stamp;
}

/** Pigeonhole: a group of mutually conflicting items larger than ceil(n / 2) cannot be ordered. */
function obviouslyInfeasible(items) {
  const limit = Math.ceil(items.length / 2);
  const regions = new Map();
  const patterns = new Map();
  let high = 0;
  for (const m of items) {
    const r = (regions.get(m.region) ?? 0) + 1;
    const p = (patterns.get(m.pattern) ?? 0) + 1;
    regions.set(m.region, r);
    patterns.set(m.pattern, p);
    if (m.impact === 'high') high++;
    if (r > limit || p > limit || high > limit) return true;
  }
  return false;
}

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/** Random valid order of items as an index array, or null when none exists. */
function findOrder(items, rng) {
  const n = items.length;
  if (obviouslyInfeasible(items)) return null;
  // adj[i]: bitmask of the items that may sit next to item i.
  const adj = new Array(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) if (a !== b && !conflict(items[a], items[b])) adj[a] |= 1 << b;
  }
  const full = (1 << n) - 1;
  const mark = nextStamp((1 << n) * n);
  const memo = dead;
  const order = new Array(n);

  // Necessary condition for the unplaced items to form a path: with 2+ of them left, each needs
  // a compatible partner among them, and at most two (the path ends) can have exactly one.
  const hopeless = (rest) => {
    let ends = 0;
    for (let r = rest; r; r &= r - 1) {
      const i = 31 - Math.clz32(r & -r);
      const d = popcount(adj[i] & rest);
      if (d === 0 || (d === 1 && ++ends > 2)) return true;
    }
    return false;
  };

  const step = (depth, last, mask) => {
    if (depth === n) return true;
    const state = mask * n + last;
    if (depth > 0 && memo[state] === mark) return false;
    const rest = full & ~mask;
    if (depth < n - 1 && hopeless(rest)) {
      if (depth > 0) memo[state] = mark;
      return false;
    }
    const cand = [];
    for (let i = 0; i < n; i++) {
      if (rest & (1 << i) && (depth === 0 || adj[last] & (1 << i))) cand.push(i);
    }
    // Lazy Fisher-Yates: each untried candidate is equally likely to be tried next.
    for (let k = 0; k < cand.length; k++) {
      const j = k + randInt(rng, cand.length - k);
      const c = cand[j];
      cand[j] = cand[k];
      cand[k] = c;
      order[depth] = c;
      if (step(depth + 1, c, mask | (1 << c))) return true;
    }
    if (depth > 0) memo[state] = mark;
    return false;
  };

  return step(0, 0, 0) ? order : null;
}

/**
 * Generate a balanced, validly ordered workout.
 * Returns { moves, key } where moves holds LENGTH catalog movements and key = sequenceKey(moves).
 * Throws when the catalog cannot produce a valid workout (different from previousKey) within
 * MAX_ATTEMPTS draws.
 */
export function generateWorkout({ catalog = CATALOG, rng = cryptoRandom, previousKey = null } = {}) {
  if (!Array.isArray(catalog)) throw new TypeError('generateWorkout: catalog must be an array of movements');
  if (typeof rng !== 'function') throw new TypeError('generateWorkout: rng must be a function returning [0, 1)');
  const pools = eligiblePools(catalog);

  let unorderable = 0;
  let repeats = 0;
  const knownUnorderable = new Set(); // selections (sorted ids) already proven to have no valid order
  const selectionKey = (picked) => picked.map((m) => m.id).sort().join(',');
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const picked = [];
    for (const cat of CATEGORIES) drawInto(picked, pools[cat], PER_CATEGORY, rng);
    if (knownUnorderable.size && knownUnorderable.has(selectionKey(picked))) {
      unorderable++;
      continue;
    }
    const order = findOrder(picked, rng);
    if (!order) {
      unorderable++;
      knownUnorderable.add(selectionKey(picked));
      continue;
    }
    const moves = order.map((i) => picked[i]);
    const key = sequenceKey(moves);
    if (previousKey != null && key === previousKey) {
      repeats++;
      continue;
    }
    const check = validateSequence(moves);
    if (!check.ok) throw new Error(`generateWorkout: internal error, produced an invalid sequence: ${check.reason}`);
    return { moves, key };
  }

  throw new Error(
    `generateWorkout: no valid workout found after ${MAX_ATTEMPTS} attempts ` +
      `(${unorderable} selections had no valid order, ${repeats} matched previousKey); ` +
      'the catalog has too few compatible movements (regions, patterns, or high-impact moves) ' +
      'to satisfy the sequencing rules',
  );
}
