// Workout generator tests (ENGINE-A). Run: node --test tests/generator.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateWorkout, validateSequence, sequenceKey, cryptoRandom, mulberry32,
} from '../js/generator.js';
import { CATEGORIES, PER_CATEGORY, TIMING } from '../js/config.js';
import { CATALOG } from '../js/catalog/index.js';

// ---------------------------------------------------------------- fixture

// Hard-coded on purpose so the independent checks below do not trust config.js blindly.
const CATS = ['lower', 'upper', 'core', 'cardio'];
const PER = 3;
const LEN = 12;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function mv(id, category, region, pattern, impact = 'low', extra = {}) {
  return {
    id,
    name: id,
    category,
    region,
    pattern,
    impact,
    equipment: 'none',
    alt: { name: `${id} (easier)`, cue: 'Go gently.', equipment: 'none', description: 'Easier version.', demo: { view: 'side', keys: [] } },
    ...extra,
  };
}

// 9 lower, 8 upper, 9 core, 10 cardio. Tricky cases: cardio moves with region 'legs'
// (squat jump, jump lunge), patterns shared across categories (squat, lunge, lateral in lower and
// cardio; plank in upper and core; crawl in upper and cardio), a high-impact core move, many
// high-impact cardio moves, wall equipment, and same-pattern pairs inside a category.
const FIXTURE = deepFreeze([
  mv('l-squat', 'lower', 'legs', 'squat'),
  mv('l-reverse-lunge', 'lower', 'legs', 'lunge'),
  mv('l-side-lunge', 'lower', 'legs', 'lateral'),
  mv('l-good-morning', 'lower', 'legs', 'hinge'),
  mv('l-glute-bridge', 'lower', 'legs', 'bridge'),
  mv('l-calf-raise', 'lower', 'legs', 'calf'),
  mv('l-wall-sit', 'lower', 'legs', 'squat', 'low', { equipment: 'wall' }),
  mv('l-split-squat', 'lower', 'legs', 'lunge', 'low', { switchSides: true }),
  mv('l-single-leg-bridge', 'lower', 'legs', 'bridge', 'low', { switchSides: true }),

  mv('u-push-up', 'upper', 'upper', 'push'),
  mv('u-pike-push-up', 'upper', 'upper', 'overhead-push'),
  mv('u-floor-dip', 'upper', 'upper', 'dip'),
  mv('u-prone-y-raise', 'upper', 'upper', 'pull'),
  mv('u-arm-circles', 'upper', 'upper', 'shoulder-mobility'),
  mv('u-shoulder-taps', 'upper', 'upper', 'plank'),
  mv('u-wall-push-up', 'upper', 'upper', 'push', 'low', { equipment: 'wall' }),
  mv('u-inchworm', 'upper', 'upper', 'crawl'),

  mv('c-forearm-plank', 'core', 'trunk', 'plank'),
  mv('c-side-plank', 'core', 'trunk', 'side-plank', 'low', { switchSides: true }),
  mv('c-crunch', 'core', 'trunk', 'crunch'),
  mv('c-dead-bug', 'core', 'trunk', 'supine-hold'),
  mv('c-bird-dog', 'core', 'trunk', 'quadruped'),
  mv('c-russian-twist', 'core', 'trunk', 'rotation'),
  mv('c-bicycle', 'core', 'trunk', 'crunch'),
  mv('c-hollow-hold', 'core', 'trunk', 'supine-hold'),
  mv('c-plank-jack', 'core', 'trunk', 'plank', 'high'),

  mv('k-jumping-jacks', 'cardio', 'full', 'jump', 'high'),
  mv('k-high-knees', 'cardio', 'full', 'run', 'high'),
  mv('k-march', 'cardio', 'full', 'run'),
  mv('k-squat-jump', 'cardio', 'legs', 'squat', 'high'),
  mv('k-skaters', 'cardio', 'full', 'lateral', 'high'),
  mv('k-mountain-climbers', 'cardio', 'full', 'climber'),
  mv('k-burpee', 'cardio', 'full', 'burpee', 'high'),
  mv('k-shadow-boxing', 'cardio', 'full', 'punch'),
  mv('k-jump-lunge', 'cardio', 'legs', 'lunge', 'high'),
  mv('k-bear-crawl', 'cardio', 'full', 'crawl'),
]);
const FIXTURE_SET = new Set(FIXTURE);
const POOL_SIZE = Object.fromEntries(CATS.map((c) => [c, FIXTURE.filter((m) => m.category === c).length]));

// ---------------------------------------------------------------- independent checks

/** Re-implementation of every workout rule, sharing no code with js/generator.js. */
function independentProblems(moves, catalogSet = null) {
  if (!Array.isArray(moves)) return 'not an array';
  if (moves.length !== LEN) return `length ${moves.length}`;
  const ids = moves.map((m) => m.id);
  if (new Set(ids).size !== LEN) return `duplicate ids in ${ids.join(',')}`;
  for (const c of CATS) {
    const n = moves.filter((m) => m.category === c).length;
    if (n !== PER) return `category ${c} has ${n}`;
  }
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (catalogSet && !catalogSet.has(m)) return `move ${i} (${m.id}) is not a catalog object`;
    if (m.equipment !== 'none' && m.equipment !== 'wall') return `move ${i} equipment ${m.equipment}`;
    if (!m.alt || typeof m.alt.name !== 'string' || !m.alt.name) return `move ${i} has no alt`;
    if (i === 0) continue;
    const p = moves[i - 1];
    if (p.category === m.category) return `category repeat at ${i - 1}/${i}: ${m.category}`;
    if (p.region === m.region) return `region repeat at ${i - 1}/${i}: ${m.region}`;
    if (p.pattern === m.pattern) return `pattern repeat at ${i - 1}/${i}: ${m.pattern}`;
    if (p.impact === 'high' && m.impact === 'high') return `high impact repeat at ${i - 1}/${i}`;
  }
  return null;
}

function assertValidWorkout(w, catalogSet, context) {
  const v = validateSequence(w.moves);
  assert.ok(v.ok, `${context}: validateSequence rejected a generated workout: ${v.reason}`);
  const p = independentProblems(w.moves, catalogSet);
  assert.equal(p, null, `${context}: independent check failed: ${p}`);
  assert.equal(w.key, sequenceKey(w.moves), `${context}: key does not match sequenceKey(moves)`);
  assert.equal(w.key, w.moves.map((m) => m.id).join(','), `${context}: key is not ids joined with ','`);
}

/** Independent count of valid orders of 12 items (Hamiltonian paths in the compatibility graph). */
function countValidOrders(items) {
  const n = items.length;
  const compatible = (a, b) =>
    a.category !== b.category && a.region !== b.region && a.pattern !== b.pattern &&
    !(a.impact === 'high' && b.impact === 'high');
  const full = (1 << n) - 1;
  const ways = new Float64Array((1 << n) * n);
  for (let i = 0; i < n; i++) ways[(1 << i) * n + i] = 1;
  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      const w = ways[mask * n + last];
      if (!w) continue;
      for (let j = 0; j < n; j++) {
        if (!(mask & (1 << j)) && compatible(items[last], items[j])) ways[(mask | (1 << j)) * n + j] += w;
      }
    }
  }
  let total = 0;
  for (let last = 0; last < n; last++) total += ways[full * n + last];
  return total;
}

const timed = (fn) => {
  const t0 = performance.now();
  let error = null;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  return { error, ms: performance.now() - t0 };
};

// ---------------------------------------------------------------- basics

describe('config and helpers', () => {
  test('config matches the workout contract (4 categories x 3 = 12 moves)', () => {
    assert.deepEqual([...CATEGORIES], CATS);
    assert.equal(PER_CATEGORY, PER);
    assert.equal(TIMING.moves, LEN);
    assert.equal(CATEGORIES.length * PER_CATEGORY, TIMING.moves);
  });

  test('mulberry32 is deterministic, seed-sensitive, and in [0, 1)', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const c = mulberry32(12346);
    const sa = Array.from({ length: 1000 }, () => a());
    const sb = Array.from({ length: 1000 }, () => b());
    const sc = Array.from({ length: 1000 }, () => c());
    assert.deepEqual(sa, sb);
    assert.notDeepEqual(sa, sc);
    for (const x of sa) assert.ok(x >= 0 && x < 1, `out of range: ${x}`);
    const mean = sa.reduce((s, x) => s + x, 0) / sa.length;
    assert.ok(Math.abs(mean - 0.5) < 0.05, `mean ${mean}`);
  });

  test('cryptoRandom is uniform-looking in [0, 1) with full resolution', () => {
    const n = 100000;
    let sum = 0;
    const buckets = new Array(10).fill(0);
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      const x = cryptoRandom();
      assert.ok(typeof x === 'number' && x >= 0 && x < 1, `out of range: ${x}`);
      sum += x;
      buckets[Math.floor(x * 10)]++;
      seen.add(x);
    }
    assert.ok(Math.abs(sum / n - 0.5) < 0.01, `mean ${sum / n}`);
    for (const b of buckets) assert.ok(b > n / 10 * 0.9 && b < n / 10 * 1.1, `bucket ${b}`);
    assert.ok(seen.size > n * 0.999, 'values repeat far more than a 53-bit generator should');
  });

  test('sequenceKey joins ids with commas', () => {
    assert.equal(sequenceKey([{ id: 'a' }, { id: 'b-c' }, { id: 'd' }]), 'a,b-c,d');
    assert.equal(sequenceKey([]), '');
  });

  test('fixture is a sound test catalog', () => {
    assert.deepEqual(POOL_SIZE, { lower: 9, upper: 8, core: 9, cardio: 10 });
    assert.equal(new Set(FIXTURE.map((m) => m.id)).size, FIXTURE.length);
  });
});

// ---------------------------------------------------------------- fixture generation

describe('generateWorkout on a synthetic catalog', () => {
  test('10,000 seeded workouts are all valid (validateSequence and independent checks)', () => {
    const rng = mulberry32(20261004);
    const t0 = performance.now();
    for (let i = 0; i < 10000; i++) {
      assertValidWorkout(generateWorkout({ catalog: FIXTURE, rng }), FIXTURE_SET, `workout ${i}`);
    }
    const ms = performance.now() - t0;
    assert.ok(ms < 5000, `10,000 generations took ${ms.toFixed(0)} ms`);
  });

  test('10,000 workouts from cryptoRandom are all valid', () => {
    for (let i = 0; i < 10000; i++) {
      assertValidWorkout(generateWorkout({ catalog: FIXTURE, rng: cryptoRandom }), FIXTURE_SET, `workout ${i}`);
    }
  });

  test('many independent seeds each give a valid workout', () => {
    for (let seed = 0; seed < 2000; seed++) {
      assertValidWorkout(generateWorkout({ catalog: FIXTURE, rng: mulberry32(seed) }), FIXTURE_SET, `seed ${seed}`);
    }
  });

  test('is deterministic for a given seed and varies across seeds', () => {
    const run = (seed) => {
      const rng = mulberry32(seed);
      return Array.from({ length: 50 }, () => generateWorkout({ catalog: FIXTURE, rng }).key);
    };
    assert.deepEqual(run(7), run(7));
    assert.deepEqual(run(99), run(99));
    const a = run(7);
    const b = run(8);
    assert.ok(a.filter((k, i) => k !== b[i]).length >= 49, 'different seeds should give different workouts');
    assert.equal(new Set(a).size, a.length, '50 consecutive workouts should all differ');
  });

  test('distribution: every movement appears near its fair share; slots are not category-stuck', () => {
    const N = 10000;
    const rng = mulberry32(4242);
    const count = new Map(FIXTURE.map((m) => [m.id, 0]));
    const slotCat = Array.from({ length: LEN }, () => Object.fromEntries(CATS.map((c) => [c, 0])));
    const keys = new Set();
    for (let i = 0; i < N; i++) {
      const w = generateWorkout({ catalog: FIXTURE, rng });
      keys.add(w.key);
      w.moves.forEach((m, s) => {
        count.set(m.id, count.get(m.id) + 1);
        slotCat[s][m.category]++;
      });
    }
    for (const m of FIXTURE) {
      const share = count.get(m.id) / N;
      const fair = PER / POOL_SIZE[m.category];
      assert.ok(count.get(m.id) > 0, `${m.id} never appeared`);
      assert.ok(Math.abs(share - fair) < 0.06, `${m.id} appeared in ${(share * 100).toFixed(1)}% of workouts, fair share ${(fair * 100).toFixed(1)}%`);
    }
    for (const c of CATS) {
      const first = slotCat[0][c] / N;
      assert.ok(first > 0.15 && first < 0.35, `first slot is '${c}' in ${(first * 100).toFixed(1)}% of workouts`);
    }
    slotCat.forEach((row, s) => {
      for (const c of CATS) {
        const share = row[c] / N;
        assert.ok(share > 0.12 && share < 0.4, `slot ${s} is '${c}' in ${(share * 100).toFixed(1)}% of workouts`);
      }
    });
    assert.ok(keys.size > N * 0.99, `only ${keys.size} distinct workouts in ${N}`);
  });

  test('every valid order of a tightly constrained selection is reachable', () => {
    // Exactly 3 per category, so the selection is fixed; constraints leave only a few valid orders.
    const spec = [
      ['lo0', 'lower', 'legs', 'plank', 'low'], ['lo1', 'lower', 'legs', 'push', 'low'],
      ['lo2', 'lower', 'upper', 'squat', 'low'], ['up0', 'upper', 'upper', 'plank', 'low'],
      ['up1', 'upper', 'upper', 'push', 'high'], ['up2', 'upper', 'trunk', 'squat', 'low'],
      ['co0', 'core', 'legs', 'squat', 'high'], ['co1', 'core', 'full', 'push', 'high'],
      ['co2', 'core', 'trunk', 'squat', 'high'], ['ca0', 'cardio', 'legs', 'plank', 'high'],
      ['ca1', 'cardio', 'legs', 'plank', 'high'], ['ca2', 'cardio', 'legs', 'squat', 'low'],
    ];
    const tight = deepFreeze(spec.map(([id, c, r, p, i]) => mv(id, c, r, p, i)));
    const total = countValidOrders(tight);
    assert.ok(total >= 2 && total <= 40, `expected a small number of valid orders, got ${total}`);
    const rng = mulberry32(31337);
    const seen = new Map();
    for (let i = 0; i < 4000; i++) {
      const w = generateWorkout({ catalog: tight, rng });
      assertValidWorkout(w, new Set(tight), `tight ${i}`);
      seen.set(w.key, (seen.get(w.key) ?? 0) + 1);
    }
    assert.equal(seen.size, total, `reached ${seen.size} of ${total} valid orders`);
  });

  test('ineligible catalog entries are never selected; duplicate ids are ignored', () => {
    const bad = [
      mv('x-chair-default', 'lower', 'legs', 'squat', 'low', { equipment: 'chair' }),
      mv('x-no-alt', 'upper', 'upper', 'push', 'low', { alt: undefined }),
      mv('x-unnamed-alt', 'core', 'trunk', 'plank', 'low', { alt: { cue: 'x' } }),
      mv('x-unknown-category', 'arms', 'upper', 'push'),
      mv('x-no-pattern', 'cardio', 'full', undefined),
      mv('x-bad-impact', 'cardio', 'full', 'jump', 'medium'),
      { ...FIXTURE[0], pattern: 'push', name: 'impostor' }, // duplicate id of l-squat
      null,
    ];
    const catalog = deepFreeze([...FIXTURE, ...bad]);
    const rng = mulberry32(5);
    for (let i = 0; i < 3000; i++) {
      const w = generateWorkout({ catalog, rng });
      assertValidWorkout(w, FIXTURE_SET, `filtered ${i}`);
    }
  });

  test('rejects bad arguments clearly', () => {
    assert.throws(() => generateWorkout({ catalog: 'nope' }), TypeError);
    assert.throws(() => generateWorkout({ catalog: FIXTURE, rng: 42 }), TypeError);
    assert.throws(() => generateWorkout({ catalog: FIXTURE, rng: () => 1 }), RangeError);
    assert.throws(() => generateWorkout({ catalog: FIXTURE, rng: () => NaN }), RangeError);
    assert.throws(() => generateWorkout({ catalog: FIXTURE, rng: () => -0.1 }), RangeError);
  });
});

// ---------------------------------------------------------------- shuffle / previousKey

describe('previousKey (shuffle)', () => {
  const chain = (catalog, rng, steps) => {
    let prev = generateWorkout({ catalog, rng }).key;
    for (let i = 0; i < steps; i++) {
      const w = generateWorkout({ catalog, rng, previousKey: prev });
      assert.notEqual(w.key, prev, `shuffle step ${i} returned the same sequence`);
      assertValidWorkout(w, new Set(catalog), `shuffle step ${i}`);
      prev = w.key;
    }
  };

  test('a 2,000-step seeded shuffle chain never repeats the displayed sequence', () => {
    chain(FIXTURE, mulberry32(77), 2000);
  });

  test('a 2,000-step cryptoRandom shuffle chain never repeats the displayed sequence', () => {
    chain(FIXTURE, cryptoRandom, 2000);
  });

  test('a 2,000-step shuffle chain on a catalog with only 20 valid workouts never repeats', () => {
    const spec = [
      ['lo0', 'lower', 'legs', 'plank', 'low'], ['lo1', 'lower', 'legs', 'push', 'low'],
      ['lo2', 'lower', 'upper', 'squat', 'low'], ['up0', 'upper', 'upper', 'plank', 'low'],
      ['up1', 'upper', 'upper', 'push', 'high'], ['up2', 'upper', 'trunk', 'squat', 'low'],
      ['co0', 'core', 'legs', 'squat', 'high'], ['co1', 'core', 'full', 'push', 'high'],
      ['co2', 'core', 'trunk', 'squat', 'high'], ['ca0', 'cardio', 'legs', 'plank', 'high'],
      ['ca1', 'cardio', 'legs', 'plank', 'high'], ['ca2', 'cardio', 'legs', 'squat', 'low'],
    ];
    chain(deepFreeze(spec.map(([id, c, r, p, i]) => mv(id, c, r, p, i))), mulberry32(3), 2000);
  });

  test('redraws when the first draw reproduces previousKey', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const first = generateWorkout({ catalog: FIXTURE, rng: mulberry32(seed) });
      // Same rng stream: the first attempt reproduces `first` exactly and must be rejected.
      const again = generateWorkout({ catalog: FIXTURE, rng: mulberry32(seed), previousKey: first.key });
      assert.notEqual(again.key, first.key);
      assertValidWorkout(again, FIXTURE_SET, `seed ${seed}`);
    }
  });

  test('previousKey of null or undefined does not affect generation', () => {
    const a = generateWorkout({ catalog: FIXTURE, rng: mulberry32(9) }).key;
    const b = generateWorkout({ catalog: FIXTURE, rng: mulberry32(9), previousKey: null }).key;
    const c = generateWorkout({ catalog: FIXTURE, rng: mulberry32(9), previousKey: undefined }).key;
    assert.equal(a, b);
    assert.equal(a, c);
  });

  test('throws (bounded) when every draw reproduces previousKey', () => {
    const stuck = () => 0; // always picks the same selection and order
    const only = generateWorkout({ catalog: FIXTURE, rng: stuck });
    assertValidWorkout(only, FIXTURE_SET, 'stuck rng');
    const { error, ms } = timed(() => generateWorkout({ catalog: FIXTURE, rng: stuck, previousKey: only.key }));
    assert.ok(error instanceof Error, 'expected an error');
    assert.match(error.message, /previousKey/);
    assert.ok(ms < 2000, `took ${ms.toFixed(0)} ms`);
  });
});

// ---------------------------------------------------------------- impossible catalogs

describe('impossible catalogs throw within bounded time', () => {
  // Six 'legs' moves conflict pairwise, so they take 6 non-adjacent slots and every other slot
  // touches one of them. 'u-trap' conflicts with all six (pattern with l-*, impact with k-*), so no
  // order exists even though no region/pattern/impact group exceeds 6 (passes pigeonhole checks).
  const subtle = (extra = []) =>
    deepFreeze([
      mv('l-a', 'lower', 'legs', 'squat'), mv('l-b', 'lower', 'legs', 'squat'), mv('l-c', 'lower', 'legs', 'squat'),
      mv('k-a', 'cardio', 'legs', 'lunge', 'high'), mv('k-b', 'cardio', 'legs', 'lunge', 'high'),
      mv('k-c', 'cardio', 'legs', 'lunge', 'high'),
      mv('u-trap', 'upper', 'upper', 'squat', 'high'), mv('u-b', 'upper', 'upper', 'push'), mv('u-c', 'upper', 'upper', 'pull'),
      mv('c-a', 'core', 'trunk', 'plank'), mv('c-b', 'core', 'trunk', 'crunch'), mv('c-c', 'core', 'trunk', 'rotation'),
      ...extra,
    ]);

  const expectThrow = (catalog, pattern, maxMs) => {
    const { error, ms } = timed(() => generateWorkout({ catalog, rng: mulberry32(1) }));
    assert.ok(error instanceof Error, 'expected generateWorkout to throw');
    assert.match(error.message, pattern);
    assert.ok(ms < maxMs, `took ${ms.toFixed(0)} ms (limit ${maxMs})`);
    return error;
  };

  test('only 2 movements in a category', () => {
    const e = expectThrow(FIXTURE.filter((m) => m.category !== 'core' || m.id === 'c-crunch' || m.id === 'c-dead-bug'),
      /catalog too small/, 100);
    assert.match(e.message, /'core'/);
    assert.match(e.message, /at least 3/);
  });

  test('an empty category and an empty catalog', () => {
    expectThrow(FIXTURE.filter((m) => m.category !== 'cardio'), /catalog too small.*'cardio'/, 100);
    expectThrow([], /catalog too small/, 100);
  });

  test('ineligible entries do not count toward the minimum', () => {
    const catalog = [
      ...FIXTURE.filter((m) => m.category !== 'upper'),
      mv('u-1', 'upper', 'upper', 'push'),
      mv('u-2', 'upper', 'upper', 'pull'),
      mv('u-chair', 'upper', 'upper', 'dip', 'low', { equipment: 'chair' }),
    ];
    const e = expectThrow(catalog, /catalog too small.*'upper' has 2 eligible/, 100);
    assert.match(e.message, /skipped/);
  });

  test('all patterns identical (no valid order exists)', () => {
    expectThrow(FIXTURE.map((m) => ({ ...m, pattern: 'squat' })), /no valid workout found/, 3000);
  });

  test('all regions identical', () => {
    expectThrow(FIXTURE.map((m) => ({ ...m, region: 'full' })), /no valid workout found/, 3000);
  });

  test('every movement high impact', () => {
    expectThrow(FIXTURE.map((m) => ({ ...m, impact: 'high' })), /no valid workout found/, 3000);
  });

  test('infeasible despite passing simple counting checks (exactly 3 per category)', () => {
    assert.equal(countValidOrders(subtle()), 0, 'fixture should be infeasible');
    expectThrow(subtle(), /no valid workout found/, 3000);
  });

  test('infeasible across many distinct selections (4 per category)', () => {
    // Every selection keeps 6 legs moves; the 4th upper move also conflicts with every legs move.
    const catalog = subtle([
      mv('l-d', 'lower', 'legs', 'squat'), mv('k-d', 'cardio', 'legs', 'lunge', 'high'),
      mv('u-trap-2', 'upper', 'upper', 'squat', 'high'), mv('c-d', 'core', 'trunk', 'quadruped'),
    ]);
    // Any 3 of the 4 upper moves include a trap, so no selection is orderable.
    expectThrow(catalog, /no valid workout found/, 8000);
  });

  test('removing the conflict makes the subtle catalog feasible', () => {
    const fixed = subtle().map((m) => (m.id === 'u-trap' ? { ...m, pattern: 'dip', impact: 'low' } : m));
    assert.ok(countValidOrders(fixed) > 0);
    for (let i = 0; i < 200; i++) {
      assertValidWorkout(generateWorkout({ catalog: fixed, rng: mulberry32(i) }), new Set(fixed), `fixed ${i}`);
    }
  });
});

// ---------------------------------------------------------------- validateSequence

describe('validateSequence', () => {
  const base = generateWorkout({ catalog: FIXTURE, rng: mulberry32(11) }).moves;
  const copy = () => base.map((m) => ({ ...m, alt: { ...m.alt } }));
  const expectFail = (moves, rule, index, ...fragments) => {
    const v = validateSequence(moves);
    assert.equal(v.ok, false, `expected failure for rule ${rule}`);
    assert.equal(v.rule, rule, `rule: ${v.reason}`);
    if (index !== undefined) assert.equal(v.index, index, `index: ${v.reason}`);
    assert.equal(typeof v.reason, 'string');
    for (const f of fragments) assert.ok(v.reason.includes(f), `reason "${v.reason}" should mention ${f}`);
    return v;
  };

  test('accepts a valid sequence', () => {
    assert.deepEqual(validateSequence(base), { ok: true });
    assert.deepEqual(validateSequence(copy()), { ok: true });
  });

  test('accepts non-adjacent repeats of region, pattern, and high impact', () => {
    // Hand-built: same region/pattern/high impact only two apart.
    const seq = [
      mv('a1', 'lower', 'legs', 'squat'), mv('b1', 'upper', 'upper', 'push'),
      mv('a2', 'lower', 'legs', 'squat'), mv('d1', 'cardio', 'full', 'jump', 'high'),
      mv('c1', 'core', 'trunk', 'plank'), mv('d2', 'cardio', 'full', 'run', 'high'),
      mv('b2', 'upper', 'upper', 'push'), mv('c2', 'core', 'trunk', 'crunch'),
      mv('a3', 'lower', 'legs', 'lunge'), mv('d3', 'cardio', 'full', 'burpee', 'high'),
      mv('b3', 'upper', 'upper', 'pull'), mv('c3', 'core', 'trunk', 'rotation'),
    ];
    assert.deepEqual(validateSequence(seq), { ok: true });
    assert.equal(independentProblems(seq), null);
  });

  test('length: not an array, too short, too long, empty', () => {
    expectFail(null, 'length', undefined, '12');
    expectFail({ length: 12 }, 'length');
    expectFail(base.slice(0, 11), 'length', undefined, '12', '11');
    expectFail([...base, FIXTURE[0]], 'length', undefined, '13');
    expectFail([], 'length', undefined, '0');
  });

  test('malformed movements name the index', () => {
    let m = copy();
    m[3] = null;
    expectFail(m, 'move', 3, 'index 3');
    m = copy();
    delete m[4].pattern;
    expectFail(m, 'move', 4, 'index 4', 'pattern', m[4].id);
    m = copy();
    m[5].region = '';
    expectFail(m, 'move', 5, 'index 5', 'region');
    m = copy();
    m[6].impact = 'medium';
    expectFail(m, 'move', 6, 'index 6', 'medium');
    m = copy();
    m[7].category = 'arms';
    expectFail(m, 'move', 7, 'index 7', 'arms');
    m = copy();
    delete m[8].id;
    expectFail(m, 'move', 8, 'index 8', 'id');
  });

  test('equipment: default must be none or wall', () => {
    const m = copy();
    m[2].equipment = 'chair';
    expectFail(m, 'equipment', 2, 'index 2', "'chair'", m[2].id);
    const n = copy();
    delete n[9].equipment;
    expectFail(n, 'equipment', 9, 'index 9');
    const ok = copy();
    ok[2].equipment = 'wall';
    assert.deepEqual(validateSequence(ok), { ok: true });
  });

  test('alt: every move needs a named lower-impact alternative', () => {
    let m = copy();
    delete m[10].alt;
    expectFail(m, 'alt', 10, 'index 10', m[10].id);
    m = copy();
    m[0].alt = {};
    expectFail(m, 'alt', 0, 'index 0');
    m = copy();
    m[11].alt = { name: '   ' };
    expectFail(m, 'alt', 11, 'index 11');
  });

  test('duplicate ids name both indices', () => {
    const m = copy();
    m[7] = { ...m[2] };
    expectFail(m, 'duplicate', 7, `'${m[2].id}'`, 'index 2', 'index 7');
  });

  test('category counts must be exactly 3 each', () => {
    const m = copy();
    const from = m[0].category;
    const to = CATS.find((c) => c !== from);
    m[0].category = to;
    expectFail(m, 'category-count', undefined, 'expected exactly 3');
  });

  test('adjacent category names the pair and category', () => {
    const m = copy();
    // Swap slot 5 with a later slot of slot 4's category so two neighbours share a category.
    const j = m.findIndex((x, i) => i > 5 && x.category === m[4].category);
    [m[5], m[j]] = [m[j], m[5]];
    expectFail(m, 'adjacent-category', 4, 'index 4', 'index 5', `'${m[4].category}'`);
  });

  test('adjacent region names the pair and region', () => {
    const m = copy();
    m[5].region = m[4].region;
    expectFail(m, 'adjacent-region', 4, 'index 4', 'index 5', `'${m[4].region}'`, m[4].id, m[5].id);
    const first = copy();
    first[1].region = first[0].region;
    expectFail(first, 'adjacent-region', 0, 'index 0', 'index 1');
    const last = copy();
    last[11].region = last[10].region;
    expectFail(last, 'adjacent-region', 10, 'index 10', 'index 11');
  });

  test('adjacent pattern names the pair and pattern', () => {
    const m = copy();
    m[8].pattern = m[7].pattern;
    expectFail(m, 'adjacent-pattern', 7, 'index 7', 'index 8', `'${m[7].pattern}'`);
  });

  test('adjacent high impact names the pair', () => {
    const m = copy();
    for (const x of m) x.impact = 'low';
    assert.deepEqual(validateSequence(m), { ok: true });
    m[3].impact = 'high';
    m[4].impact = 'high';
    expectFail(m, 'adjacent-impact', 3, 'index 3', 'index 4', 'high impact');
    m[4].impact = 'low';
    m[5].impact = 'high';
    assert.deepEqual(validateSequence(m), { ok: true }, 'high impact two apart is allowed');
  });

  test('never throws on garbage input', () => {
    for (const bad of [undefined, 0, 'x', {}, [null], Array(12).fill(undefined), Array(12).fill(7)]) {
      const v = validateSequence(bad);
      assert.equal(v.ok, false);
      assert.equal(typeof v.reason, 'string');
    }
  });
});

// ---------------------------------------------------------------- real catalog

const realCounts = Object.fromEntries(CATEGORIES.map((c) => [c, CATALOG.filter((m) => m && m.category === c).length]));
const realReady = CATEGORIES.every((c) => realCounts[c] >= PER_CATEGORY);
const realSkip = realReady
  ? false
  : `real catalog not ready (${CATEGORIES.map((c) => `${c} ${realCounts[c]}`).join(', ')}; needs >= ${PER_CATEGORY} each); ` +
    'catalog files are authored separately';
const REAL_SET = new Set(CATALOG);

describe('generateWorkout on the real catalog', () => {
  test('10,000 workouts with cryptoRandom are all valid', { skip: realSkip }, () => {
    for (let i = 0; i < 10000; i++) assertValidWorkout(generateWorkout(), REAL_SET, `real crypto ${i}`);
  });

  test('10,000 seeded workouts are all valid and reproducible', { skip: realSkip }, () => {
    const run = () => {
      const rng = mulberry32(1234);
      const keys = [];
      for (let i = 0; i < 10000; i++) {
        const w = generateWorkout({ rng });
        assertValidWorkout(w, REAL_SET, `real seeded ${i}`);
        keys.push(w.key);
      }
      return keys;
    };
    const a = run();
    assert.deepEqual(run().slice(0, 100), a.slice(0, 100));
    assert.ok(new Set(a).size > 9900, 'real catalog should give varied workouts');
  });

  test('a 2,000-step shuffle chain never repeats', { skip: realSkip }, () => {
    let prev = generateWorkout().key;
    for (let i = 0; i < 2000; i++) {
      const w = generateWorkout({ previousKey: prev });
      assert.notEqual(w.key, prev);
      assertValidWorkout(w, REAL_SET, `real shuffle ${i}`);
      prev = w.key;
    }
  });
});
