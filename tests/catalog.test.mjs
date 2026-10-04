// Movement catalog validation. Run: node --test tests/catalog.test.mjs
//
// Validates whatever entries exist in js/catalog/*.js against docs/ARCHITECTURE.md (Movement and
// Demo schemas). Each movement gets its own test that lists every problem at once; softer style
// issues are printed as diagnostics ("warning: ...") without failing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../js/catalog/index.js';
import lowerFile from '../js/catalog/lower.js';
import upperFile from '../js/catalog/upper.js';
import coreFile from '../js/catalog/core.js';
import cardioFile from '../js/catalog/cardio.js';
import { CATEGORIES, PER_CATEGORY } from '../js/config.js';
import { FOCUS_TOKENS, JOINTS, normalizePose, solvePose, contactGaps } from '../js/figure.js';
import { generateWorkout, validateSequence, mulberry32 } from '../js/generator.js';

const FILES = { lower: lowerFile, upper: upperFile, core: coreFile, cardio: cardioFile };

// ---------------------------------------------------------------- contract vocabulary

const PATTERNS = [
  'squat', 'lunge', 'lateral', 'hinge', 'bridge', 'calf', 'push', 'overhead-push', 'dip', 'pull',
  'shoulder-mobility', 'plank', 'side-plank', 'crunch', 'supine-hold', 'quadruped', 'rotation',
  'jump', 'run', 'climber', 'burpee', 'punch', 'crawl',
];
const REGIONS = ['legs', 'upper', 'trunk', 'full'];
const DEFAULT_REGION = { lower: ['legs'], upper: ['upper'], core: ['trunk'], cardio: ['full', 'legs'] };
const IMPACTS = ['low', 'high'];
const DEFAULT_EQUIPMENT = ['none', 'wall'];
const ALT_EQUIPMENT = ['none', 'wall', 'chair'];
const VIEWS = ['side', 'front'];
const EASES = ['linear', 'inOut', 'in', 'out'];
const PROP_TYPES = ['wall', 'chair', 'mat'];

const MOVE_FIELDS = [
  'id', 'name', 'say', 'category', 'region', 'pattern', 'impact', 'equipment', 'setup', 'cue',
  'mistake', 'caution', 'switchSides', 'description', 'demo', 'alt',
];
const MOVE_REQUIRED_TEXT = ['name', 'setup', 'cue', 'mistake', 'description'];
const MOVE_OPTIONAL_TEXT = ['say', 'caution'];
const ALT_FIELDS = ['name', 'say', 'cue', 'equipment', 'description', 'demo', 'switchSides', 'setup', 'mistake', 'caution'];
const ALT_REQUIRED_TEXT = ['name', 'cue', 'description'];
const ALT_OPTIONAL_TEXT = ['say', 'setup', 'mistake', 'caution'];
const DEMO_FIELDS = ['view', 'anchor', 'focus', 'props', 'contacts', 'keys', 'depth'];
const KEY_FIELDS = ['pose', 'dur', 'hold', 'ease', 'tween', 'anchor', 'contacts'];
const POSE_FIELDS = ['torso', 'head', 'nearArm', 'farArm', 'nearLeg', 'farLeg', 'nearFoot', 'farFoot', 'lift', 'dx'];
const POSE_ANGLES = ['torso', 'head', 'nearFoot', 'farFoot'];
const POSE_PAIRS = ['nearArm', 'farArm', 'nearLeg', 'farLeg'];
const PROP_FIELDS = { wall: ['type', 'x', 'side'], chair: ['type', 'x', 'seat', 'facing'], mat: ['type', 'x1', 'x2'] };

const NAME_MAX = 22;
const CUE_MAX = 60;
const CONTACT_TOLERANCE = 3.5;
const SCENE = { xMin: -5, xMax: 205, yMin: 0, yMax: 200 };
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------- language

// Word-boundary patterns so legitimate words ("fatigue", "competent", "shift your weight") pass.
const BANNED = [
  ['calorie', /\bcalori(?:e|es|c)\b/i],
  ['burn fat', /\bburn(?:s|ing)?\s+(?:the\s+)?fat\b/i],
  ['fat', /\bfat(?:s|ty|ter|test)?\b/i],
  ['weight loss', /\bweight[\s-]*loss\b/i],
  ['lose weight', /\blos(?:e|es|ing)\s+(?:the\s+|some\s+)?weight\b/i],
  ['slim', /\bslim(?:s|mer|ming|med)?\b/i],
  ['tone up', /\b(?:tone[sd]?\s+up|toning\s+up|toned)\b/i],
  ['beach body', /\bbeach[\s-]*bod(?:y|ies)\b/i],
  ['bikini', /\bbikinis?\b/i],
  ['guilt', /\bguilt(?:y|ily|less)?\b/i],
  ['lazy', /\blaz(?:y|ier|iest|iness|ily)\b/i],
  ['punish', /\bpunish\w*/i],
  ['streak', /\bstreaks?\b/i],
  ['missed day', /\bmiss(?:ed|ing)\s+(?:a\s+)?days?\b/i],
  ['no excuses', /\bno\s+excuses?\b/i],
  ['earn your', /\bearn\s+your\b/i],
  ['beat your', /\bbeat\s+your\b/i],
  ['compete', /\bcompet(?:e|es|ed|ing|ition|itions|itive|itor|itors)\b/i],
  ['shame', /\bsham(?:e|es|ed|ing|eful)\b/i],
  // No calendar language (the app never claims a workout belongs to a day).
  ['day reference', /\b(?:today|tonight|tomorrow|yesterday|daily|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i],
];
const EMOJI = [/\p{Extended_Pictographic}/u, /\p{Regional_Indicator}/u, /[\u{FE0F}\u{20E3}]/u];

function languageProblems(text) {
  const out = [];
  for (const [label, re] of BANNED) {
    const m = text.match(re);
    if (m) out.push(`banned language "${m[0]}" (${label})`);
  }
  if (EMOJI.some((re) => re.test(text))) out.push('emoji or pictographic character');
  return out;
}

/** Every string anywhere in a value, with its path. */
function strings(value, path, out = []) {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
  return out;
}

// ---------------------------------------------------------------- checks

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const q = (v) => (typeof v === 'string' ? `'${v}'` : String(v));

function unknownFields(obj, allowed, where, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) errors.push(`${where}: unknown field '${k}' (allowed: ${allowed.join(', ')})`);
  }
}

function textField(obj, field, where, errors, { required, max, warnMax, warnings }) {
  const v = obj[field];
  if (v === undefined) {
    if (required) errors.push(`${where}.${field} is required`);
    return;
  }
  if (typeof v !== 'string' || v.trim() === '') {
    errors.push(`${where}.${field} must be a non-empty string`);
    return;
  }
  if (v !== v.trim()) errors.push(`${where}.${field} has leading or trailing whitespace`);
  if (/\s{2,}/.test(v)) warnings.push(`${where}.${field} contains repeated whitespace`);
  if (max && v.length > max) errors.push(`${where}.${field} is ${v.length} characters (max ${max}): "${v}"`);
  if (warnMax && v.length > warnMax) warnings.push(`${where}.${field} is ${v.length} characters (movement limit is ${warnMax}): "${v}"`);
}

/** Validate a demo object. Returns { airborneKeys, props } for cross-checks. */
function checkDemo(demo, where, errors, warnings, { isDefault }) {
  const info = { airborneKeys: 0, props: [] };
  if (!isObj(demo)) {
    errors.push(`${where} must be an object`);
    return info;
  }
  unknownFields(demo, DEMO_FIELDS, where, errors);
  if (!VIEWS.includes(demo.view)) errors.push(`${where}.view must be 'side' or 'front', got ${q(demo.view)}`);
  const view = VIEWS.includes(demo.view) ? demo.view : 'side';

  // A bad anchor makes every solved position meaningless, so geometry checks are skipped then.
  let anchorOk = true;
  if (demo.anchor !== undefined) {
    if (!isObj(demo.anchor)) {
      errors.push(`${where}.anchor must be an object`);
      anchorOk = false;
    } else {
      unknownFields(demo.anchor, ['joint', 'x'], `${where}.anchor`, errors);
      if (!JOINTS.includes(demo.anchor.joint)) {
        errors.push(`${where}.anchor.joint ${q(demo.anchor.joint)} is not a joint`);
        anchorOk = false;
      }
      if (!finite(demo.anchor.x)) {
        errors.push(`${where}.anchor.x must be a finite number`);
        anchorOk = false;
      }
    }
  }

  if (demo.focus !== undefined) {
    if (!Array.isArray(demo.focus)) errors.push(`${where}.focus must be an array`);
    else {
      for (const f of demo.focus) {
        if (!FOCUS_TOKENS.includes(f)) errors.push(`${where}.focus token ${q(f)} is not one of ${FOCUS_TOKENS.join(', ')}`);
      }
      if (isDefault && demo.focus.length === 0) warnings.push(`${where}.focus is empty`);
    }
  } else if (isDefault) {
    warnings.push(`${where} has no focus (no highlighted parts)`);
  }

  if (demo.props !== undefined) {
    if (!Array.isArray(demo.props)) errors.push(`${where}.props must be an array`);
    else {
      demo.props.forEach((p, i) => {
        const pw = `${where}.props[${i}]`;
        if (!isObj(p) || !PROP_TYPES.includes(p.type)) {
          errors.push(`${pw}.type must be one of ${PROP_TYPES.join(', ')}`);
          return;
        }
        info.props.push(p.type);
        unknownFields(p, PROP_FIELDS[p.type], pw, errors);
        for (const k of ['x', 'seat', 'x1', 'x2']) {
          if (p[k] !== undefined && !finite(p[k])) errors.push(`${pw}.${k} must be a finite number`);
        }
        if (p.side !== undefined && !['left', 'right'].includes(p.side)) errors.push(`${pw}.side must be 'left' or 'right'`);
        if (p.facing !== undefined && !['left', 'right'].includes(p.facing)) errors.push(`${pw}.facing must be 'left' or 'right'`);
      });
    }
  }

  let contacts = [];
  if (demo.contacts !== undefined) {
    if (!Array.isArray(demo.contacts)) errors.push(`${where}.contacts must be an array`);
    else {
      for (const c of demo.contacts) if (!JOINTS.includes(c)) errors.push(`${where}.contacts entry ${q(c)} is not a joint`);
      if (new Set(demo.contacts).size !== demo.contacts.length) errors.push(`${where}.contacts has duplicates`);
      contacts = demo.contacts.filter((c) => JOINTS.includes(c));
    }
  }
  const keyContacts = Array.isArray(demo.keys) && demo.keys.some((k) => isObj(k) && Array.isArray(k.contacts) && k.contacts.length);
  if (contacts.length === 0 && !keyContacts) warnings.push(`${where} declares no floor contacts, so grounding is unchecked`);

  if (!Array.isArray(demo.keys)) {
    errors.push(`${where}.keys must be an array`);
    return info;
  }
  if (demo.keys.length < 1 || demo.keys.length > 6) errors.push(`${where}.keys has ${demo.keys.length} keys (1-6 allowed)`);
  if (demo.keys.length === 1) warnings.push(`${where} has a single key (static); 2+ keys are preferred`);

  demo.keys.forEach((key, i) => {
    const kw = `${where}.keys[${i}]`;
    if (!isObj(key) || !isObj(key.pose)) {
      errors.push(`${kw} must be an object with a pose object`);
      return;
    }
    unknownFields(key, KEY_FIELDS, kw, errors);
    if (key.dur !== undefined && !(finite(key.dur) && key.dur > 0)) errors.push(`${kw}.dur must be > 0, got ${q(key.dur)}`);
    if (key.hold !== undefined && !(finite(key.hold) && key.hold >= 0)) errors.push(`${kw}.hold must be >= 0, got ${q(key.hold)}`);
    if (key.ease !== undefined && !EASES.includes(key.ease)) errors.push(`${kw}.ease ${q(key.ease)} is not one of ${EASES.join(', ')}`);
    if (key.tween !== undefined && typeof key.tween !== 'boolean') errors.push(`${kw}.tween must be a boolean`);
    let ownContacts = null;
    if (key.contacts !== undefined) {
      if (!Array.isArray(key.contacts) || !key.contacts.every((c) => JOINTS.includes(c))) {
        errors.push(`${kw}.contacts must be an array of joint names`);
      } else ownContacts = key.contacts;
    }
    if (key.anchor !== undefined) {
      if (!isObj(key.anchor) || !JOINTS.includes(key.anchor.joint) || !finite(key.anchor.x)) {
        errors.push(`${kw}.anchor must be { joint: <joint name>, x: <number> }`);
      } else if (isObj(demo.anchor) || i > 0 || demo.keys.length > 1) {
        // Switching the pinned joint must not make the figure jump at this key.
        const prev = demo.keys[(i - 1 + demo.keys.length) % demo.keys.length];
        const before = (isObj(prev) && prev.anchor) || demo.anchor || { joint: 'hip', x: 100 };
        const norm = normalizePose(key.pose, view);
        const a = solvePose({ ...norm, anchor: before }, demo).joints.hip[0];
        const b = solvePose({ ...norm, anchor: key.anchor }, demo).joints.hip[0];
        if (Math.abs(a - b) > 1) errors.push(`${kw}.anchor switch makes the figure jump ${Math.abs(a - b).toFixed(1)} units`);
      }
    }

    const pose = key.pose;
    unknownFields(pose, POSE_FIELDS, `${kw}.pose`, errors);
    let poseOk = true;
    for (const a of POSE_ANGLES) {
      if (pose[a] !== undefined && !finite(pose[a])) {
        errors.push(`${kw}.pose.${a} must be a finite angle, got ${q(pose[a])}`);
        poseOk = false;
      }
    }
    for (const a of POSE_PAIRS) {
      if (pose[a] === undefined) continue;
      if (!Array.isArray(pose[a]) || pose[a].length !== 2 || !pose[a].every(finite)) {
        errors.push(`${kw}.pose.${a} must be an array of 2 finite angles, got ${JSON.stringify(pose[a])}`);
        poseOk = false;
      }
    }
    if (pose.lift !== undefined && !(finite(pose.lift) && pose.lift >= 0)) {
      errors.push(`${kw}.pose.lift must be a finite number >= 0, got ${q(pose.lift)}`);
      poseOk = false;
    }
    if (pose.dx !== undefined && !finite(pose.dx)) {
      errors.push(`${kw}.pose.dx must be a finite number, got ${q(pose.dx)}`);
      poseOk = false;
    }
    if (!poseOk) return;

    const airborne = Boolean(pose.lift);
    if (airborne) info.airborneKeys++;
    if (!anchorOk) return;
    const solved = solvePose(key.anchor && isObj(key.anchor) ? { ...normalizePose(pose, view), anchor: key.anchor } : normalizePose(pose, view), demo);
    for (const [joint, [x, y]] of Object.entries(solved.joints)) {
      if (!(x >= SCENE.xMin && x <= SCENE.xMax && y >= SCENE.yMin && y <= SCENE.yMax)) {
        errors.push(`${kw}: joint ${joint} at (${x.toFixed(1)}, ${y.toFixed(1)}) is outside the scene ` +
          `(x ${SCENE.xMin}..${SCENE.xMax}, y ${SCENE.yMin}..${SCENE.yMax})`);
      }
    }
    const useContacts = ownContacts ?? contacts;
    if (!airborne && useContacts.length) {
      const gaps = contactGaps(solved, useContacts);
      for (const [joint, gap] of Object.entries(gaps)) {
        if (!(Math.abs(gap) <= CONTACT_TOLERANCE)) {
          errors.push(`${kw}: contact ${joint} is ${gap} units from the floor (|gap| must be <= ${CONTACT_TOLERANCE})`);
        }
      }
    }
  });
  return info;
}

/** All problems for one movement: { errors: string[], warnings: string[] }. */
function movementProblems(m) {
  const errors = [];
  const warnings = [];
  if (!isObj(m)) return { errors: ['movement must be an object'], warnings };
  const w = 'movement';

  unknownFields(m, MOVE_FIELDS, w, errors);
  if (typeof m.id !== 'string' || !KEBAB.test(m.id)) errors.push(`id ${q(m.id)} must be kebab-case (a-z, 0-9, single hyphens)`);
  for (const f of MOVE_REQUIRED_TEXT) {
    textField(m, f, w, errors, { required: true, max: f === 'name' ? NAME_MAX : f === 'cue' ? CUE_MAX : 0, warnings });
  }
  for (const f of MOVE_OPTIONAL_TEXT) textField(m, f, w, errors, { required: false, warnings });

  if (!CATEGORIES.includes(m.category)) errors.push(`category ${q(m.category)} must be one of ${CATEGORIES.join(', ')}`);
  if (!REGIONS.includes(m.region)) errors.push(`region ${q(m.region)} must be one of ${REGIONS.join(', ')}`);
  else if (DEFAULT_REGION[m.category] && !DEFAULT_REGION[m.category].includes(m.region)) {
    warnings.push(`region '${m.region}' is unusual for category '${m.category}' (expected ${DEFAULT_REGION[m.category].join(' or ')})`);
  }
  if (!PATTERNS.includes(m.pattern)) errors.push(`pattern ${q(m.pattern)} is not in the PATTERNS vocabulary`);
  if (!IMPACTS.includes(m.impact)) errors.push(`impact ${q(m.impact)} must be 'low' or 'high'`);
  if (!DEFAULT_EQUIPMENT.includes(m.equipment)) {
    errors.push(`equipment ${q(m.equipment)} must be 'none' or 'wall' (a chair is allowed only in alt)`);
  }
  if (m.switchSides !== undefined && typeof m.switchSides !== 'boolean') errors.push('switchSides must be a boolean when present');
  if (m.pattern === 'side-plank' && m.switchSides !== true) warnings.push("side-plank pattern without switchSides: true");

  const demoInfo = checkDemo(m.demo, 'demo', errors, warnings, { isDefault: true });
  if (demoInfo.props.includes('chair')) errors.push('default demo shows a chair; a chair may appear only in alt');
  if (m.equipment === 'wall' && !demoInfo.props.includes('wall')) warnings.push("equipment is 'wall' but the demo shows no wall prop");
  if (m.equipment === 'none' && demoInfo.props.includes('wall')) warnings.push("demo shows a wall but equipment is 'none'");
  if (m.impact === 'low' && demoInfo.airborneKeys > 0) {
    errors.push(`impact is 'low' but the demo has ${demoInfo.airborneKeys} airborne key(s) (lift > 0); airborne means 'high'`);
  }

  const alt = m.alt;
  if (!isObj(alt)) {
    errors.push('alt (lower-impact alternative) is required');
  } else {
    unknownFields(alt, ALT_FIELDS, 'alt', errors);
    for (const f of ALT_REQUIRED_TEXT) {
      textField(alt, f, 'alt', errors, {
        required: true, warnings, warnMax: f === 'name' ? NAME_MAX : f === 'cue' ? CUE_MAX : 0,
      });
    }
    for (const f of ALT_OPTIONAL_TEXT) textField(alt, f, 'alt', errors, { required: false, warnings });
    if (!ALT_EQUIPMENT.includes(alt.equipment)) errors.push(`alt.equipment ${q(alt.equipment)} must be one of ${ALT_EQUIPMENT.join(', ')}`);
    if (alt.switchSides !== undefined && typeof alt.switchSides !== 'boolean') errors.push('alt.switchSides must be a boolean when present');
    if (typeof alt.name === 'string' && typeof m.name === 'string' && alt.name.trim().toLowerCase() === m.name.trim().toLowerCase()) {
      errors.push('alt.name must differ from the movement name');
    }
    const altInfo = checkDemo(alt.demo, 'alt.demo', errors, warnings, { isDefault: false });
    if (altInfo.props.includes('chair') && alt.equipment !== 'chair') {
      errors.push(`alt.demo shows a chair but alt.equipment is ${q(alt.equipment)} (declare 'chair')`);
    }
    if ((alt.equipment === 'wall' || alt.equipment === 'chair') && !altInfo.props.includes(alt.equipment)) {
      warnings.push(`alt.equipment is '${alt.equipment}' but alt.demo shows no ${alt.equipment} prop`);
    }
    if (altInfo.airborneKeys > 0) {
      errors.push(`alt.demo has ${altInfo.airborneKeys} airborne key(s) (lift > 0); the alternative must be lower impact`);
    }
  }

  for (const [path, text] of strings(m, 'movement')) {
    for (const p of languageProblems(text)) errors.push(`${path}: ${p}: "${text}"`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------- tests: scanner self-checks

describe('language scanner', () => {
  test('flags banned language and emoji', () => {
    const bad = [
      'Burn calories fast', 'Burn fat', 'Fat', 'weight-loss', 'Lose weight', 'Slim down', 'Tone up your arms',
      'toned arms', 'Beach body', 'bikini', 'Do not feel guilty', 'No lazy reps', 'A punishing finish',
      'Keep your streak', 'Missed a day?', 'No excuses', 'Earn your rest', 'Beat your best', 'Compete',
      'competition', 'No shame', "Today's workout", 'Monday plan', 'Great job \u{1F4AA}', 'Go \u{2764}\u{FE0F}',
    ];
    for (const s of bad) assert.ok(languageProblems(s).length > 0, `should flag: ${s}`);
  });

  test('allows legitimate exercise language', () => {
    const good = [
      'Fight fatigue by breathing steadily.', 'Shift your weight onto your heels.', 'Stay competent and calm.',
      'Keep a steady tone.', 'Hold a wall for balance.', 'Punch forward with control.', 'Lower slowly.',
      'Bodyweight squat', 'Step back and lower until both knees bend.', 'Beat the rhythm with your feet.',
      'Breathe out as you rise.', 'Keep the ribs down and the core braced.',
    ];
    for (const s of good) assert.deepEqual(languageProblems(s), [], `false positive: ${s}`);
  });
});

// ---------------------------------------------------------------- tests: catalog shape

describe('catalog structure', () => {
  for (const cat of CATEGORIES) {
    test(`${cat} has 8-10 movements`, () => {
      const n = CATALOG.filter((m) => m && m.category === cat).length;
      assert.ok(n >= 8 && n <= 10, `category '${cat}' has ${n} movements; the contract requires 8 to 10 (target 9)`);
    });
  }

  test('each category file holds only its own category', () => {
    const wrong = [];
    for (const [cat, list] of Object.entries(FILES)) {
      assert.ok(Array.isArray(list), `js/catalog/${cat}.js must export an array`);
      for (const m of list) if (!m || m.category !== cat) wrong.push(`${cat}.js: ${m?.id} has category ${q(m?.category)}`);
    }
    assert.deepEqual(wrong, []);
  });

  test('CATALOG aggregates the four category files', () => {
    assert.deepEqual([...CATALOG], [...lowerFile, ...upperFile, ...coreFile, ...cardioFile]);
  });

  test('ids are unique across the catalog', () => {
    const seen = new Map();
    const dups = [];
    for (const m of CATALOG) {
      if (!m || typeof m.id !== 'string') continue;
      if (seen.has(m.id)) dups.push(`${m.id} (${seen.get(m.id)} and ${m.category})`);
      seen.set(m.id, m.category);
    }
    assert.deepEqual(dups, [], `duplicate ids: ${dups.join(', ')}`);
  });

  test('display names are unique across the catalog', () => {
    const seen = new Map();
    const dups = [];
    for (const m of CATALOG) {
      if (!m || typeof m.name !== 'string') continue;
      const k = m.name.trim().toLowerCase();
      if (seen.has(k)) dups.push(`"${m.name}" (${seen.get(k)} and ${m.id})`);
      seen.set(k, m.id);
    }
    assert.deepEqual(dups, [], `duplicate names: ${dups.join(', ')}`);
  });
});

// ---------------------------------------------------------------- tests: each movement

describe('movements', () => {
  if (CATALOG.length === 0) {
    test('catalog has movements', { skip: 'catalog is empty (category files are authored separately)' }, () => {});
  }
  CATALOG.forEach((m, i) => {
    const label = `${m?.category ?? '?'}/${typeof m?.id === 'string' ? m.id : `#${i}`}`;
    test(label, (t) => {
      const { errors, warnings } = movementProblems(m);
      for (const w of warnings) t.diagnostic(`warning: ${label}: ${w}`);
      assert.ok(errors.length === 0, `${label} has ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`);
    });
  });
});

// ---------------------------------------------------------------- tests: sequencing

const counts = Object.fromEntries(CATEGORIES.map((c) => [c, CATALOG.filter((m) => m && m.category === c).length]));
const ready = CATEGORIES.every((c) => counts[c] >= PER_CATEGORY);
const skipSequencing = ready
  ? false
  : `needs >= ${PER_CATEGORY} movements per category (${CATEGORIES.map((c) => `${c} ${counts[c]}`).join(', ')})`;

describe('sequencing feasibility with the real catalog', () => {
  test('generateWorkout succeeds and every movement can be scheduled', { skip: skipSequencing }, (t) => {
    const rng = mulberry32(2026);
    const seen = new Map(CATALOG.map((m) => [m.id, 0]));
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const w = generateWorkout({ catalog: CATALOG, rng });
      const v = validateSequence(w.moves);
      assert.ok(v.ok, `workout ${i} invalid: ${v.reason}`);
      for (const m of w.moves) seen.set(m.id, seen.get(m.id) + 1);
    }
    const never = [...seen].filter(([, n]) => n === 0).map(([id]) => id);
    assert.deepEqual(never, [], `movements never scheduled in ${N} workouts (ineligible or unsequenceable): ${never.join(', ')}`);
    for (const c of CATEGORIES) {
      const list = CATALOG.filter((m) => m.category === c);
      const high = list.filter((m) => m.impact === 'high').length;
      const patterns = new Set(list.map((m) => m.pattern)).size;
      t.diagnostic(`${c}: ${list.length} movements, ${high} high impact, ${patterns} distinct patterns`);
    }
  });
});
