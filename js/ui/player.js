// Player screen. Built once per workout; update(snapshot) runs every animation frame and
// touches the DOM only where something changed (the ring and the progress fill move smoothly).
import { CATEGORY_LABELS } from '../config.js';
import { createDemo } from '../figure.js';
import { h, setText, activeVersion, formatClock, spokenDuration } from './dom.js';
import { icon } from './icons.js';

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;
const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

const STATE_INFO = {
  prep: { icon: 'timer', label: 'Get ready' },
  work: { icon: 'bolt', label: 'Work' },
  transition: { icon: 'leaf', label: 'Rest — up next' },
  paused: { icon: 'pause', label: 'Paused' },
  resuming: { icon: 'play', label: 'Resuming' },
};

/**
 * @param {HTMLElement} root the #screen-player section
 * @param {{ onEnd, onTogglePause, onResume, onSkip, onAudio, onVibration, onEasier }} handlers
 */
export function createPlayer(root, handlers) {
  // ---- top bar
  const endBtn = h(
    'button',
    { class: 'pl-end', type: 'button', 'data-action': 'end', onclick: () => handlers.onEnd() },
    icon('close', { size: 20 }),
    h('span', null, 'End'),
  );
  const moveCount = h('span', { class: 'pl-count' });
  const timeLeft = h('span', { class: 'pl-left tnum' });
  const timeLeftSr = h('span', { class: 'visually-hidden' });
  const top = h(
    'div',
    { class: 'pl-top' },
    endBtn,
    h('p', { class: 'pl-meta' }, moveCount, h('span', { class: 'pl-meta-sep', 'aria-hidden': 'true' }, '·'), h('span', { class: 'pl-left-wrap', 'aria-hidden': 'true' }, timeLeft, ' left'), timeLeftSr),
  );

  // ---- progress: 12 segments
  const progress = h('div', { class: 'pl-progress', role: 'progressbar', 'aria-label': 'Workout progress', 'aria-valuemin': '0' });
  let segs = [];

  // ---- state + name
  const stateIcon = h('span', { class: 'pl-state-icon' });
  const stateText = h('span', { class: 'pl-state-text' });
  const statePill = h('span', { class: 'pl-pill' }, stateIcon, stateText);
  const eyebrow = h('span', { class: 'pl-eyebrow' });
  const stateRow = h('div', { class: 'pl-state' }, statePill, eyebrow);
  const nameEl = h('h2', { class: 'pl-name', id: 'player-move-name' });

  // ---- stage
  const figureBox = h('div', { class: 'pl-figure' });
  const sidesBadge = h('span', { class: 'pl-badge pl-badge-sides' }, icon('sides', { size: 16 }), h('span', null, 'Switch sides halfway'));
  const easierBadge = h('span', { class: 'pl-badge pl-badge-easier' }, icon('easier', { size: 16 }), h('span', null, 'Easier version'));
  const resumeBig = h(
    'button',
    { class: 'pl-resume-big', type: 'button', 'data-action': 'resume', onclick: () => handlers.onResume() },
    icon('play', { size: 34 }),
    h('span', { class: 'visually-hidden' }, 'Resume'),
  );
  const pausedOverlay = h(
    'div',
    { class: 'pl-overlay pl-overlay-paused' },
    h('p', { class: 'pl-overlay-title' }, 'Paused'),
    resumeBig,
    h('p', { class: 'pl-overlay-text' }, 'Resume when you are ready'),
  );
  const resumeNum = h('span', { class: 'pl-count-num tnum' }, '3');
  const resumingOverlay = h(
    'div',
    { class: 'pl-overlay pl-overlay-resuming', 'aria-hidden': 'true' },
    resumeNum,
    h('p', { class: 'pl-overlay-text' }, 'Get set'),
  );
  const hintEl = h('p', { class: 'pl-hint', role: 'status', hidden: true });
  let hintTimer = 0;
  const stage = h(
    'div',
    { class: 'pl-stage' },
    figureBox,
    h('div', { class: 'pl-badges' }, sidesBadge, easierBadge, hintEl),
    pausedOverlay,
    resumingOverlay,
  );

  // ---- ring + info
  const ringSvg = svg('svg', { viewBox: '0 0 120 120', class: 'pl-ring-svg', 'aria-hidden': 'true', focusable: 'false' });
  svg('circle', { cx: 60, cy: 60, r: RING_R, class: 'pl-ring-track' }, ringSvg);
  const ringArc = svg('circle', {
    cx: 60, cy: 60, r: RING_R, class: 'pl-ring-arc',
    'stroke-dasharray': RING_C.toFixed(2), 'stroke-dashoffset': '0', transform: 'rotate(-90 60 60)',
  }, ringSvg);
  const ringNum = h('span', { class: 'pl-ring-num tnum', 'aria-hidden': 'true' });
  const ringSr = h('span', { class: 'visually-hidden' });
  const ring = h('div', { class: 'pl-ring' }, ringSvg, ringNum, ringSr);
  const cueEl = h('p', { class: 'pl-cue' });
  const nextLabel = h('span', { class: 'pl-next-label' });
  const nextName = h('span', { class: 'pl-next-name' });
  const nextEl = h('p', { class: 'pl-next' }, nextLabel, nextName);
  const info = h('div', { class: 'pl-info' }, ring, h('div', { class: 'pl-info-text' }, cueEl, nextEl));

  // ---- controls
  const ctl = (name, iconName, label, extra = {}) => {
    const iconSlot = h('span', { class: 'ctl-icon' }, icon(iconName, { size: name === 'pause' ? 34 : 24 }));
    const text = h('span', { class: 'ctl-label' }, label);
    const btn = h('button', { class: `ctl ctl-${name}`, type: 'button', 'data-action': name, ...extra }, iconSlot, text);
    return { btn, iconSlot, text };
  };
  const audioC = ctl('audio', 'volume', 'Sound', { 'aria-pressed': 'true' });
  const vibC = ctl('vibration', 'vibrate', 'Vibrate', { 'aria-pressed': 'true' });
  const pauseC = ctl('pause', 'pause', 'Pause');
  const skipC = ctl('skip', 'skip', 'Skip');
  const easierC = ctl('easier', 'easier', 'Easier', { role: 'switch', 'aria-checked': 'false' });
  audioC.btn.addEventListener('click', () => handlers.onAudio());
  vibC.btn.addEventListener('click', () => handlers.onVibration());
  pauseC.btn.addEventListener('click', () => handlers.onTogglePause());
  skipC.btn.addEventListener('click', () => handlers.onSkip());
  easierC.btn.addEventListener('click', () => handlers.onEasier());
  const controls = h(
    'div',
    { class: 'pl-controls', role: 'group', 'aria-label': 'Workout controls' },
    audioC.btn, vibC.btn, pauseC.btn, skipC.btn, easierC.btn,
  );

  const inner = h('div', { class: 'pl-inner' }, top, progress, stateRow, nameEl, stage, info, controls);
  root.replaceChildren(inner);
  root.setAttribute('aria-labelledby', 'player-move-name');

  // ---- state
  let workout = null;
  let demo = null;
  let demoKey = '';
  let prev = {};

  function setIcon(slot, name, size) {
    if (slot.dataset.icon === name) return;
    slot.dataset.icon = name;
    slot.replaceChildren(icon(name, { size }));
  }

  function setData(key, value) {
    const v = String(value);
    if (root.dataset[key] !== v) root.dataset[key] = v;
  }

  function buildProgress(n) {
    segs = Array.from({ length: n }, () => {
      const fill = h('span', { class: 'pl-seg-fill' });
      const seg = h('span', { class: 'pl-seg' }, fill);
      return { seg, fill, state: '', f: -1 };
    });
    progress.replaceChildren(...segs.map((s) => s.seg));
    progress.setAttribute('aria-valuemax', String(n));
  }

  function mountDemo(version) {
    demo?.destroy();
    demo = createDemo(version.demo, { label: version.description, className: 'pl-fig' });
    figureBox.replaceChildren(demo.el);
    figureBox.classList.toggle('has-strip', demo.el.classList.contains('fig-strip'));
  }

  function settings({ audio, vibration, vibrationSupported }) {
    audioC.btn.setAttribute('aria-pressed', String(Boolean(audio)));
    setIcon(audioC.iconSlot, audio ? 'volume' : 'volume-off', 24);
    audioC.btn.setAttribute('aria-label', 'Sound');
    setText(audioC.text, 'Sound');
    if (vibrationSupported) {
      vibC.btn.disabled = false;
      vibC.btn.setAttribute('aria-pressed', String(Boolean(vibration)));
      vibC.btn.removeAttribute('aria-label');
      setIcon(vibC.iconSlot, vibration ? 'vibrate' : 'vibrate-off', 24);
      setText(vibC.text, 'Vibrate');
      vibC.btn.classList.remove('is-unavailable');
    } else {
      vibC.btn.disabled = true;
      vibC.btn.removeAttribute('aria-pressed');
      vibC.btn.setAttribute('aria-label', 'Vibration: Not available');
      setIcon(vibC.iconSlot, 'vibrate-off', 24);
      setText(vibC.text, 'Not available');
      vibC.btn.classList.add('is-unavailable');
    }
  }

  function update(snap) {
    if (!workout || !snap || !snap.seg) return;
    const { status, kind, moveIndex } = snap;
    const n = workout.moves.length;
    const move = snap.move ?? workout.moves[moveIndex];
    const alt = Boolean(snap.alternatives?.[moveIndex]);
    const version = activeVersion(move, alt);
    const remaining = Math.max(0, snap.segRemainingMs);
    const duration = snap.seg.durationMs || 1;
    const secs = Math.ceil(remaining / 1000);
    const live = status === 'running';
    const finalSecs = live && remaining > 0 && remaining <= 3000;
    const stateKey = status === 'paused' ? 'paused' : status === 'resuming' ? 'resuming' : kind;

    setData('kind', kind);
    setData('status', status);
    setData('final', finalSecs ? 'true' : 'false');

    // Top meta.
    setText(moveCount, `Move ${moveIndex + 1} of ${n}`);
    const leftMs = Math.max(0, snap.totalMs - snap.posMs);
    setText(timeLeft, formatClock(leftMs));
    if (prev.leftS !== Math.ceil(leftMs / 1000 / 15)) {
      // Screen-reader text changes at most every 15 s to stay calm.
      prev.leftS = Math.ceil(leftMs / 1000 / 15);
      setText(timeLeftSr, `, ${spokenDuration(leftMs)} left`);
    }

    // Progress segments.
    if (segs.length !== n) buildProgress(n);
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      let st;
      let f;
      if (i < moveIndex) { st = 'done'; f = 1; }
      else if (i === moveIndex) {
        st = kind === 'work' ? 'current' : 'next';
        f = kind === 'work' ? Math.min(1, snap.segElapsedMs / duration) : 0;
      } else { st = 'todo'; f = 0; }
      if (s.state !== st) {
        s.state = st;
        s.seg.dataset.state = st;
      }
      const rounded = Math.round(f * 500) / 500;
      if (s.f !== rounded) {
        s.f = rounded;
        s.fill.style.transform = `scaleX(${rounded})`;
      }
    }
    if (prev.progressNow !== moveIndex) {
      prev.progressNow = moveIndex;
      progress.setAttribute('aria-valuenow', String(moveIndex + (kind === 'work' ? 1 : 0)));
      progress.setAttribute('aria-valuetext', `Move ${moveIndex + 1} of ${n}`);
    }

    // State pill + eyebrow.
    if (prev.stateKey !== stateKey) {
      prev.stateKey = stateKey;
      const si = STATE_INFO[stateKey] ?? STATE_INFO.work;
      setIcon(stateIcon, si.icon, 18);
      setText(stateText, si.label);
    }
    const cat = CATEGORY_LABELS[move.category] ?? '';
    const eyebrowText = kind === 'prep' ? `Up next · ${cat}` : cat;
    setText(eyebrow, eyebrowText);

    // Name, cue, badges, demo.
    setText(nameEl, version.name);
    setText(cueEl, version.cue);
    sidesBadge.hidden = !version.switchSides;
    const halfwayNow = kind === 'work' && version.switchSides && snap.segElapsedMs >= duration / 2 && snap.segElapsedMs < duration / 2 + 3000;
    sidesBadge.classList.toggle('is-now', halfwayNow);
    setText(sidesBadge.lastChild, halfwayNow ? 'Switch sides now' : 'Switch sides halfway');
    easierBadge.hidden = !alt;
    stage.classList.toggle('has-badges', version.switchSides || alt);
    const key = `${moveIndex}:${alt}`;
    if (key !== demoKey) {
      demoKey = key;
      mountDemo(version);
    }
    const shouldAnimate = status === 'running';
    if (prev.anim !== shouldAnimate) {
      prev.anim = shouldAnimate;
      if (shouldAnimate) demo?.play();
      else demo?.pause();
    }

    // Next line.
    const next = snap.nextMove ?? null;
    if (!next) {
      setText(nextLabel, '');
      setText(nextName, 'Last one');
    } else {
      const nv = activeVersion(next, snap.alternatives?.[moveIndex + 1]);
      setText(nextLabel, kind === 'work' ? 'Next' : 'Then');
      setText(nextName, nv.name);
    }

    // Ring and number.
    const frac = Math.min(1, Math.max(0, remaining / duration));
    const offset = (RING_C * (1 - frac)).toFixed(2);
    if (prev.offset !== offset) {
      prev.offset = offset;
      ringArc.setAttribute('stroke-dashoffset', offset);
    }
    setText(ringNum, String(secs));
    if (prev.secs !== secs || prev.kind !== kind) {
      prev.secs = secs;
      prev.kind = kind;
      setText(ringSr, `${secs} seconds left in this ${kind === 'work' ? 'movement' : kind === 'prep' ? 'get-ready countdown' : 'rest'}`);
    }

    // Overlays and the main button.
    pausedOverlay.hidden = status !== 'paused';
    resumingOverlay.hidden = status !== 'resuming';
    if (status === 'resuming') setText(resumeNum, String(Math.max(1, Math.ceil(snap.resumeRemainingMs / 1000))));
    const paused = status === 'paused';
    if (prev.paused !== paused) {
      prev.paused = paused;
      setIcon(pauseC.iconSlot, paused ? 'play' : 'pause', 34);
      setText(pauseC.text, paused ? 'Resume' : 'Pause');
      pauseC.btn.dataset.action = paused ? 'resume' : 'pause';
    }

    // Easier switch targets the current (or upcoming) movement.
    easierC.btn.setAttribute('aria-checked', String(alt));
    const altName = move.alt?.name ?? '';
    const easierLabel = `Easier version: ${altName}`;
    if (easierC.btn.getAttribute('aria-label') !== easierLabel) easierC.btn.setAttribute('aria-label', easierLabel);
    easierC.btn.disabled = !move.alt;
  }

  return {
    /** Prepare for a new workout. */
    mount(nextWorkout, opts) {
      workout = nextWorkout;
      demoKey = '';
      prev = {};
      buildProgress(workout.moves.length);
      settings(opts);
    },
    update,
    settings,
    /** A gentle, temporary note inside the stage (e.g. the wake-lock tip). */
    hint(text, ms = 7000) {
      clearTimeout(hintTimer);
      hintEl.textContent = text;
      hintEl.hidden = false;
      stage.classList.add('has-hint');
      hintTimer = setTimeout(() => {
        hintEl.hidden = true;
        stage.classList.remove('has-hint');
      }, ms);
    },
    unmount() {
      clearTimeout(hintTimer);
      hintEl.hidden = true;
      stage.classList.remove('has-hint');
      demo?.destroy();
      demo = null;
      demoKey = '';
      workout = null;
      figureBox.replaceChildren();
    },
    focusMain() {
      pauseC.btn.focus({ preventScroll: true });
    },
  };
}
