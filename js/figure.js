// Articulated 2D figure: pose math, SVG renderer, and a shared animation clock.
//
// Angle convention (degrees, absolute, screen space):
//   0 = straight up, 90 = forward (screen right), 180 = straight down, 270 / -90 = back (screen left).
// Every segment angle is the direction from its proximal joint to its distal joint:
//   torso: hip -> neck        head: neck -> head centre
//   arm:   [shoulder -> elbow, elbow -> hand]
//   leg:   [hip -> knee, knee -> ankle]
//   foot:  ankle -> toe
// Side view: the figure faces screen right; "near" limbs are drawn in front of the body, "far"
// limbs behind it in a muted tone. Front view: "near" is the figure's left side (screen right).
//
// Each rendered frame is placed automatically: vertically so the lowest body surface rests on the
// ground (minus `lift`), horizontally so `demo.anchor.joint` sits at `demo.anchor.x` (plus `dx`).
// Angles interpolate along the shortest arc, so -90 and 270 are interchangeable.
// Feet default to 100 (side view: resting flat, toe just touching) and 105 / -105 in front view.

const NS = 'http://www.w3.org/2000/svg';
const D2R = Math.PI / 180;

export const SIZE = 200;
export const GROUND_Y = 186;

export const BODY = Object.freeze({
  headR: 11,
  neck: 6,
  torso: 50,
  shoulderDrop: 5,
  upperArm: 27,
  foreArm: 25,
  handR: 4.6,
  thigh: 39,
  shin: 37,
  foot: 13,
  frontShoulder: 13,
  frontHip: 7.5,
  frontFoot: 8,
});

const W = Object.freeze({
  upperArm: 10,
  foreArm: 8.4,
  thigh: 14,
  shin: 11,
  foot: 6.6,
  neck: 7.5,
  chest: 23,
  waist: 18,
  frontChest: 33,
  frontWaist: 23,
});

export const JOINTS = Object.freeze([
  'hip', 'neck', 'head',
  'nearShoulder', 'nearElbow', 'nearHand', 'farShoulder', 'farElbow', 'farHand',
  'nearHip', 'nearKnee', 'nearAnkle', 'nearToe', 'farHip', 'farKnee', 'farAnkle', 'farToe',
]);

const FOCUS_PARTS = Object.freeze({
  legs: ['thigh', 'shin'],
  hips: ['thigh', 'torso'],
  glutes: ['thigh'],
  thighs: ['thigh'],
  calves: ['shin', 'foot'],
  arms: ['upperArm', 'foreArm'],
  shoulders: ['upperArm'],
  chest: ['torso', 'upperArm'],
  back: ['torso'],
  core: ['torso'],
  full: ['torso', 'upperArm', 'foreArm', 'thigh', 'shin'],
});

export const FOCUS_TOKENS = Object.freeze(Object.keys(FOCUS_PARTS));

const dir = (a) => [Math.sin(a * D2R), -Math.cos(a * D2R)];
const add = (p, v, s = 1) => [p[0] + v[0] * s, p[1] + v[1] * s];
const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

const pair = (v, fallback) => (Array.isArray(v) && v.length === 2 ? v : fallback);

/** Fill in pose defaults. In front view the far side mirrors the near side unless given. */
export function normalizePose(pose = {}, view = 'side') {
  const front = view === 'front';
  const mirror = (p) => (front ? p.map((a) => -a) : p.slice());
  const torso = pose.torso ?? 0;
  const nearArm = pair(pose.nearArm, [180, 180]);
  const nearLeg = pair(pose.nearLeg, [180, 180]);
  const nearFoot = pose.nearFoot ?? (front ? 105 : 100);
  return {
    torso,
    head: pose.head ?? torso,
    nearArm,
    farArm: pair(pose.farArm, mirror(nearArm)),
    nearLeg,
    farLeg: pair(pose.farLeg, mirror(nearLeg)),
    nearFoot,
    farFoot: pose.farFoot ?? (front ? -nearFoot : nearFoot),
    lift: pose.lift ?? 0,
    dx: pose.dx ?? 0,
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + wrap(b - a) * t;

export function interpolatePose(a, b, t) {
  const ang = (x, y) => lerpAngle(x, y, t);
  return {
    torso: ang(a.torso, b.torso),
    head: ang(a.head, b.head),
    nearArm: [ang(a.nearArm[0], b.nearArm[0]), ang(a.nearArm[1], b.nearArm[1])],
    farArm: [ang(a.farArm[0], b.farArm[0]), ang(a.farArm[1], b.farArm[1])],
    nearLeg: [ang(a.nearLeg[0], b.nearLeg[0]), ang(a.nearLeg[1], b.nearLeg[1])],
    farLeg: [ang(a.farLeg[0], b.farLeg[0]), ang(a.farLeg[1], b.farLeg[1])],
    nearFoot: ang(a.nearFoot, b.nearFoot),
    farFoot: ang(a.farFoot, b.farFoot),
    lift: lerp(a.lift, b.lift, t),
    dx: lerp(a.dx, b.dx, t),
  };
}

const EASE = {
  linear: (t) => t,
  inOut: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  in: (t) => 1 - Math.cos((Math.PI * t) / 2),
  out: (t) => Math.sin((Math.PI * t) / 2),
};

const keyDur = (k) => k.dur ?? 0.8;
const keyHold = (k) => k.hold ?? 0.15;

export function cycleSeconds(demo) {
  if (!demo || !demo.keys || demo.keys.length < 2) return 0;
  return demo.keys.reduce((s, k) => s + keyDur(k) + keyHold(k), 0);
}

/** Pose (normalized) of a demo at time t seconds. Keys loop: last key returns to the first. */
export function poseAt(demo, t) {
  const view = demo.view ?? 'side';
  const keys = demo.keys;
  const norm = keys.map((k) => normalizePose(k.pose, view));
  if (keys.length === 1) return norm[0];
  const cycle = cycleSeconds(demo);
  let tt = ((t % cycle) + cycle) % cycle;
  for (let i = 0; i < keys.length; i++) {
    const hold = keyHold(keys[i]);
    if (tt < hold) return norm[i];
    tt -= hold;
    const dur = keyDur(keys[i]);
    if (tt < dur) {
      const ease = EASE[keys[i].ease ?? 'inOut'] ?? EASE.inOut;
      return interpolatePose(norm[i], norm[(i + 1) % keys.length], ease(tt / dur));
    }
    tt -= dur;
  }
  return norm[0];
}

/** Forward kinematics with the hip at the origin. Returns joint positions keyed by JOINTS. */
function forward(p, view) {
  const front = view === 'front';
  const B = BODY;
  const hip = [0, 0];
  const up = dir(p.torso);
  const side = dir(p.torso + 90);
  const neck = add(hip, up, B.torso);
  const shoulder = add(hip, up, B.torso - B.shoulderDrop);
  const head = add(neck, dir(p.head), B.neck + B.headR);
  const nearShoulder = front ? add(shoulder, side, B.frontShoulder) : shoulder;
  const farShoulder = front ? add(shoulder, side, -B.frontShoulder) : shoulder;
  const nearHip = front ? add(hip, side, B.frontHip) : hip;
  const farHip = front ? add(hip, side, -B.frontHip) : hip;
  const footLen = front ? B.frontFoot : B.foot;
  const limb = (root, angles, l1, l2) => {
    const mid = add(root, dir(angles[0]), l1);
    return [mid, add(mid, dir(angles[1]), l2)];
  };
  const [nearElbow, nearHand] = limb(nearShoulder, p.nearArm, B.upperArm, B.foreArm);
  const [farElbow, farHand] = limb(farShoulder, p.farArm, B.upperArm, B.foreArm);
  const [nearKnee, nearAnkle] = limb(nearHip, p.nearLeg, B.thigh, B.shin);
  const [farKnee, farAnkle] = limb(farHip, p.farLeg, B.thigh, B.shin);
  const nearToe = add(nearAnkle, dir(p.nearFoot), footLen);
  const farToe = add(farAnkle, dir(p.farFoot), footLen);
  return {
    hip, neck, head, shoulder,
    nearShoulder, nearElbow, nearHand, farShoulder, farElbow, farHand,
    nearHip, nearKnee, nearAnkle, nearToe, farHip, farKnee, farAnkle, farToe,
  };
}

// Radius of the drawn surface around each joint, used for grounding.
const SURFACE = {
  head: BODY.headR,
  hip: W.waist / 2,
  shoulder: W.chest / 2,
  nearHand: BODY.handR, farHand: BODY.handR,
  nearElbow: W.upperArm / 2, farElbow: W.upperArm / 2,
  nearKnee: W.thigh / 2, farKnee: W.thigh / 2,
  nearAnkle: W.shin / 2, farAnkle: W.shin / 2,
  nearToe: W.foot / 2, farToe: W.foot / 2,
};

/**
 * Place a (normalized) pose in the 200x200 scene.
 * Returns { joints, view, pose, lowest } with joints in scene coordinates.
 */
export function solvePose(pose, demo = {}) {
  const view = demo.view ?? 'side';
  const j = forward(pose, view);
  let lowest = -Infinity;
  for (const [name, r] of Object.entries(SURFACE)) lowest = Math.max(lowest, j[name][1] + r);
  const dy = GROUND_Y - lowest - (pose.lift || 0);
  const anchor = demo.anchor ?? { joint: 'hip', x: SIZE / 2 };
  const ax = j[anchor.joint] ? j[anchor.joint][0] : 0;
  const dx = anchor.x - ax + (pose.dx || 0);
  const joints = {};
  for (const [k, v] of Object.entries(j)) joints[k] = [v[0] + dx, v[1] + dy];
  return { joints, view, pose };
}

/** Distance of each named contact joint's surface from the ground (0 = touching). For authoring. */
export function contactGaps(solved, names) {
  const out = {};
  for (const n of names) {
    const p = solved.joints[n];
    if (!p) continue;
    const r = SURFACE[n] ?? 0;
    out[n] = +(GROUND_Y - (p[1] + r)).toFixed(1);
  }
  return out;
}

// ---------------------------------------------------------------- SVG rendering

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function focusSet(demo) {
  const set = new Set();
  for (const token of demo.focus ?? []) for (const part of FOCUS_PARTS[token] ?? []) set.add(part);
  return set;
}

function drawProps(g, demo) {
  for (const prop of demo.props ?? []) {
    if (prop.type === 'wall') {
      const x = prop.x ?? 170;
      const rightSide = (prop.side ?? (x > SIZE / 2 ? 'right' : 'left')) === 'right';
      const wx = rightSide ? x : x - 14;
      el('rect', { x: wx, y: 18, width: 14, height: GROUND_Y - 18, rx: 2, class: 'fig-prop' }, g);
      for (let y = 30; y < GROUND_Y - 6; y += 16) {
        el('line', { x1: wx + 3, y1: y, x2: wx + 11, y2: y + 6, class: 'fig-prop-mark' }, g);
      }
    } else if (prop.type === 'chair') {
      const x = prop.x ?? 150;
      const seatY = GROUND_Y - (prop.seat ?? 44);
      const facing = prop.facing === 'left' ? -1 : 1;
      const back = x - facing * 22;
      el('path', {
        d: `M ${back} ${GROUND_Y} L ${back} ${seatY - 42} M ${x + facing * 22} ${GROUND_Y} L ${x + facing * 22} ${seatY} ` +
          `M ${back} ${seatY} L ${x + facing * 24} ${seatY}`,
        class: 'fig-prop-line',
      }, g);
    } else if (prop.type === 'mat') {
      const x1 = prop.x1 ?? 18;
      const x2 = prop.x2 ?? 182;
      el('rect', { x: x1, y: GROUND_Y - 1.5, width: x2 - x1, height: 5, rx: 2.5, class: 'fig-mat' }, g);
    }
  }
}

/** Build the static SVG skeleton for a demo. Returns { svg, update(solved) }. */
export function buildFigureSVG(demo, { label = '', className = '' } = {}) {
  const view = demo.view ?? 'side';
  const front = view === 'front';
  const focus = focusSet(demo);
  const svg = el('svg', {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    class: `fig fig-${view}${className ? ' ' + className : ''}`,
    role: 'img',
    'aria-label': label,
    focusable: 'false',
  });
  if (label) el('title', {}, svg).textContent = label;
  const props = el('g', { class: 'fig-props' }, svg);
  drawProps(props, demo);
  const shadow = el('ellipse', { class: 'fig-shadow', cx: 100, cy: GROUND_Y + 1, rx: 40, ry: 3.5 }, svg);
  el('line', { class: 'fig-ground', x1: 6, y1: GROUND_Y + 0.5, x2: SIZE - 6, y2: GROUND_Y + 0.5 }, svg);
  const body = el('g', { class: 'fig-body' }, svg);

  const tone = (part, far) => {
    const f = focus.has(part);
    if (far && !front) return f ? 'fig-focus-far' : 'fig-far';
    return f ? 'fig-focus' : 'fig-near';
  };
  const seg = (part, far, width) =>
    el('line', { class: `fig-seg ${tone(part, far)}`, 'stroke-width': width, 'data-part': part }, body);
  const dot = (part, far, r) => el('circle', { class: tone(part, far).replace('fig-seg', ''), r }, body);

  const parts = {};
  const drawArm = (side, far) => {
    parts[side + 'Upper'] = seg('upperArm', far, W.upperArm);
    parts[side + 'Fore'] = seg('foreArm', far, W.foreArm);
    parts[side + 'HandDot'] = dot('foreArm', far, BODY.handR);
  };
  const drawLeg = (side, far) => {
    parts[side + 'Foot'] = seg('foot', far, W.foot);
    parts[side + 'Shin'] = seg('shin', far, W.shin);
    parts[side + 'Thigh'] = seg('thigh', far, W.thigh);
  };
  const drawTorso = () => {
    parts.torso = el('path', { class: `fig-torso ${tone('torso', false)}`, 'data-part': 'torso' }, body);
    parts.neck = seg('neck', false, W.neck);
    parts.head = el('circle', { class: `fig-head ${tone('head', false)}`, r: BODY.headR }, body);
    if (!front) parts.eye = el('circle', { class: 'fig-eye', r: 1.7 }, body);
  };

  if (front) {
    drawLeg('far', true);
    drawLeg('near', false);
    drawTorso();
    drawArm('far', true);
    drawArm('near', false);
  } else {
    drawArm('far', true);
    drawLeg('far', true);
    drawTorso();
    drawLeg('near', false);
    drawArm('near', false);
  }

  const line = (node, a, b) => {
    node.setAttribute('x1', a[0].toFixed(2));
    node.setAttribute('y1', a[1].toFixed(2));
    node.setAttribute('x2', b[0].toFixed(2));
    node.setAttribute('y2', b[1].toFixed(2));
  };
  const at = (node, p) => {
    node.setAttribute('cx', p[0].toFixed(2));
    node.setAttribute('cy', p[1].toFixed(2));
  };

  function update(solved) {
    const j = solved.joints;
    const p = solved.pose;
    for (const s of ['near', 'far']) {
      line(parts[s + 'Upper'], j[s + 'Shoulder'], j[s + 'Elbow']);
      line(parts[s + 'Fore'], j[s + 'Elbow'], j[s + 'Hand']);
      at(parts[s + 'HandDot'], j[s + 'Hand']);
      line(parts[s + 'Thigh'], j[s + 'Hip'], j[s + 'Knee']);
      line(parts[s + 'Shin'], j[s + 'Knee'], j[s + 'Ankle']);
      line(parts[s + 'Foot'], j[s + 'Ankle'], j[s + 'Toe']);
    }
    // Torso as a tapered quad (rounded by a matching stroke in CSS).
    const across = dir(p.torso + 90);
    const halfChest = (front ? W.frontChest : W.chest) / 2 - 3;
    const halfWaist = (front ? W.frontWaist : W.waist) / 2 - 3;
    const top = add(j.hip, dir(p.torso), BODY.torso - 2);
    const bot = add(j.hip, dir(p.torso), front ? -2 : 1);
    const q = [add(top, across, halfChest), add(top, across, -halfChest), add(bot, across, -halfWaist), add(bot, across, halfWaist)];
    parts.torso.setAttribute('d', `M${q.map((v) => v[0].toFixed(2) + ' ' + v[1].toFixed(2)).join(' L')} Z`);
    line(parts.neck, j.neck, add(j.neck, dir(p.head), BODY.neck));
    at(parts.head, j.head);
    if (parts.eye) {
      const e = add(add(j.head, dir(p.head + 90), 5.6), dir(p.head), 1.2);
      at(parts.eye, e);
    }
    // Soft shadow follows the body's centre of mass and shrinks when airborne.
    const cx = (j.hip[0] + j.neck[0]) / 2;
    const k = Math.max(0.45, 1 - (p.lift || 0) / 40);
    shadow.setAttribute('cx', cx.toFixed(2));
    shadow.setAttribute('rx', (34 * k).toFixed(2));
    shadow.setAttribute('opacity', k.toFixed(2));
  }

  return { svg, update };
}

// ---------------------------------------------------------------- animation clock

const live = new Set();
let rafId = 0;

function frame(now) {
  const t = now / 1000;
  for (const fig of live) fig.render(t);
  rafId = live.size ? requestAnimationFrame(frame) : 0;
}

function startClock() {
  if (!rafId && typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(frame);
}

let observer = null;
function getObserver() {
  if (observer || typeof IntersectionObserver !== 'function') return observer;
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const fig = e.target.__figure;
      if (!fig) continue;
      fig.visible = e.isIntersecting;
      fig.sync();
    }
  });
  return observer;
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Create an animated figure for a demo.
 * Options: label (accessible description), animate (default true), offset (seconds), className.
 * Returns { el, play(), pause(), setDemo(demo, label), destroy() }.
 */
export function createFigure(demo, { label = '', animate = true, offset = 0, className = '' } = {}) {
  let current = demo;
  let built = buildFigureSVG(current, { label, className });
  const wrap = document.createElement('div');
  wrap.className = 'fig-wrap';
  wrap.appendChild(built.svg);

  const fig = {
    visible: true,
    playing: animate,
    render(t) {
      built.update(solvePose(poseAt(current, t + offset), current));
    },
    sync() {
      const shouldRun = fig.playing && fig.visible && wrap.isConnected && current.keys.length > 1;
      if (shouldRun) {
        live.add(fig);
        startClock();
      } else {
        live.delete(fig);
      }
    },
  };
  wrap.__figure = fig;
  fig.render(0);
  const io = getObserver();
  if (io) io.observe(wrap);
  // Start once attached to the document.
  queueMicrotask(() => fig.sync());
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fig.sync());

  return {
    el: wrap,
    play() {
      fig.playing = true;
      fig.sync();
    },
    pause() {
      fig.playing = false;
      fig.sync();
    },
    setDemo(next, nextLabel = label) {
      current = next;
      const fresh = buildFigureSVG(current, { label: nextLabel, className });
      wrap.replaceChild(fresh.svg, built.svg);
      built = fresh;
      fig.render(typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
      fig.sync();
    },
    destroy() {
      live.delete(fig);
      if (io) io.unobserve(wrap);
      wrap.remove();
    },
  };
}

/** Static key-pose strip for reduced motion: one small numbered figure per key pose. */
export function createKeyStrip(demo, { label = '', className = '' } = {}) {
  const strip = document.createElement('div');
  strip.className = `fig-strip${className ? ' ' + className : ''}`;
  strip.setAttribute('role', 'img');
  strip.setAttribute('aria-label', label);
  const view = demo.view ?? 'side';
  const keys = demo.keys.filter((k) => !k.tween);
  keys.forEach((key, i) => {
    const cell = document.createElement('div');
    cell.className = 'fig-step';
    const { svg, update } = buildFigureSVG(demo, {});
    svg.setAttribute('aria-hidden', 'true');
    svg.removeAttribute('role');
    update(solvePose(normalizePose(key.pose, view), demo));
    cell.appendChild(svg);
    if (keys.length > 1) {
      const n = document.createElement('span');
      n.className = 'fig-step-num';
      n.textContent = String(i + 1);
      cell.appendChild(n);
    }
    strip.appendChild(cell);
  });
  return { el: strip, play() {}, pause() {}, destroy() { strip.remove(); } };
}

/** Animated figure, or a key-pose strip when the user prefers reduced motion. */
export function createDemo(demo, opts = {}) {
  return prefersReducedMotion() && !opts.forceAnimate ? createKeyStrip(demo, opts) : createFigure(demo, opts);
}
