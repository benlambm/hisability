// UI harness: renders any screen/state with fixture data, without running a workout.
// Used for screenshots (see tests/e2e/ui.test.mjs and the scratch screenshot scripts).
import samples from '../js/catalog/_samples.js';
import { CATEGORIES, TIMING } from '../js/config.js';
import { buildTimeline } from '../js/timeline.js';
import { createHome } from '../js/ui/home.js';
import { createPreview } from '../js/ui/preview.js';
import { createPlayer } from '../js/ui/player.js';
import { createFinish } from '../js/ui/finish.js';
import { createAbout } from '../js/ui/about.js';
import { createEndDialog } from '../js/ui/dialog.js';
import { createToaster } from '../js/ui/toast.js';
import { FINISH_MESSAGES } from '../js/ui/messages.js';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'home';
const $ = (id) => document.getElementById(id);
const noop = () => {};

// ---------------------------------------------------------------- fixtures

const SAMPLE = Object.fromEntries(samples.map((s) => [s.id, s.demo]));
const FALLBACK = {
  lower: [
    ['Squat', 'Sit back and down, chest proud, heels planted.', 'Wall Squat', 'Slide down a wall only as far as is comfortable.', 'sample-squat'],
    ['Reverse Lunge', 'Step back and lower until both knees bend.', 'Supported Split Squat', 'Hold a wall and lower only partway.', 'sample-squat', true],
    ['Glute Bridge', 'Drive through your heels and lift your hips.', 'Short Bridge', 'Lift only a few inches and pause.', 'sample-bridge'],
  ],
  upper: [
    ['Push-up', 'Lower your chest as one unit, then press away.', 'Wall Push-up', 'Hands on a wall, body straight, bend and press.', 'sample-pushup'],
    ['Plank Shoulder Taps', 'Tap the opposite shoulder, hips steady.', 'Kneeling Shoulder Taps', 'Knees down, tap slowly.', 'sample-pushup'],
    ['Pike Push-up', 'Hips high, lower your head between your hands.', 'Wall Pike Press', 'Hands on a wall, lean in and press.', 'sample-pushup'],
  ],
  core: [
    ['Dead Bug', 'Reach opposite arm and leg long, back flat.', 'Heel Taps', 'Keep knees bent and tap one heel at a time.', 'sample-bridge'],
    ['Side Plank', 'Stack your shoulders and lift your hips high.', 'Kneeling Side Plank', 'Bottom knee down, hips still lifted.', 'sample-pushup', true],
    ['Forearm Plank', 'Long line from head to heels, breathe.', 'Kneeling Plank', 'Knees down, keep the hips level.', 'sample-pushup'],
  ],
  cardio: [
    ['Jumping Jacks', 'Land softly, arms and feet out together.', 'Step Jacks', 'Step one foot out at a time as the arms rise.', 'sample-jacks'],
    ['High Knees', 'Drive the knees up, quick light feet.', 'Marching', 'March in place, lifting each knee.', 'sample-jacks'],
    ['Skaters', 'Bound side to side, land softly on one leg.', 'Side Steps', 'Step wide side to side with a small reach.', 'sample-jacks'],
  ],
};

async function realByCategory() {
  const out = {};
  for (const c of CATEGORIES) {
    try {
      const list = (await import(`../js/catalog/${c}.js`)).default;
      if (Array.isArray(list) && list.length >= 3) out[c] = list;
    } catch {
      /* use fallback */
    }
  }
  return out;
}

function fallbackMove(cat, [name, cue, altName, altCue, demoId, switchSides], i) {
  return {
    id: `${cat}-${i}`,
    name,
    category: cat,
    region: cat,
    pattern: `${cat}-${i}`,
    impact: 'low',
    equipment: 'none',
    setup: 'Stand tall.',
    cue,
    mistake: '',
    caution: i === 1 && cat === 'lower' ? 'Shorten the step if your knees complain.' : undefined,
    switchSides: Boolean(switchSides),
    description: `Figure demonstrating ${name.toLowerCase()}.`,
    demo: SAMPLE[demoId],
    alt: { name: altName, cue: altCue, equipment: 'none', description: `Figure demonstrating ${altName.toLowerCase()}.`, demo: SAMPLE[demoId] },
  };
}

async function fixtureWorkout() {
  const real = await realByCategory();
  const pools = {};
  for (const c of CATEGORIES) {
    pools[c] = real[c]
      ? real[c].slice(0, 3)
      : FALLBACK[c].map((row, i) => fallbackMove(c, row, i));
  }
  // Interleave: lower, upper, core, cardio x 3 (a plausible, valid-looking order).
  const moves = [];
  for (let r = 0; r < 3; r++) for (const c of ['lower', 'upper', 'cardio', 'core']) moves.push(pools[c][r]);
  // Make sure one switch-sides move exists for the badge.
  const focus = q.has('move') ? Number(q.get('move')) : null;
  return { moves, key: moves.map((m) => m.id).join(','), focus: Number.isInteger(focus) ? focus : null };
}

function snapshotFor(workout, { kind, moveIndex, remainingMs, status = 'running', resumeRemainingMs = 0, alternatives }) {
  const timeline = buildTimeline();
  const seg = timeline.find((s) => s.kind === kind && s.move === moveIndex) ?? timeline[0];
  const posMs = seg.endMs - remainingMs;
  const total = timeline[timeline.length - 1].endMs;
  const reached = timeline.filter((s) => s.kind === 'work' && s.startMs <= posMs).length;
  return {
    status,
    posMs,
    totalMs: total,
    segIndex: seg.index,
    seg,
    kind: seg.kind,
    segElapsedMs: posMs - seg.startMs,
    segRemainingMs: remainingMs,
    moveIndex: seg.move,
    move: workout.moves[seg.move],
    nextMove: workout.moves[seg.move + 1] ?? null,
    upcoming: seg.kind !== 'work',
    resumeRemainingMs,
    activeMs: posMs,
    movesReached: reached,
    alternatives,
  };
}

// ---------------------------------------------------------------- render

function show(name) {
  for (const id of ['home', 'player', 'finish']) $(`screen-${id}`).hidden = id !== name;
  document.body.dataset.screen = name;
}

function installFromQuery() {
  const v = q.get('install');
  if (v === 'ios') return { platform: 'ios', standalone: false, canPrompt: false };
  if (v === 'android') return { platform: 'android', standalone: false, canPrompt: false };
  if (v === 'android-prompt') return { platform: 'android', standalone: false, canPrompt: true };
  if (v === 'desktop') return { platform: 'desktop', standalone: false, canPrompt: true };
  return { platform: 'desktop', standalone: false, canPrompt: false };
}

async function main() {
  const workout = await fixtureWorkout();
  const alternatives = new Array(TIMING.moves).fill(false);
  const install = installFromQuery();
  const toaster = createToaster($('toasts'));

  const home = createHome($('screen-home'), {
    onStart: noop, onPreview: noop, onShuffle: noop, onInfo: noop, onInstall: noop, onDismissInstall: noop, onRetry: noop,
  });
  if (q.get('altHome') === '1') alternatives[1] = true;
  home.render({
    workout: q.get('error') === '1' ? null : workout,
    alternatives,
    error: q.get('error') === '1' ? 'Please try again in a moment. If this keeps happening, reload the app.' : null,
    install: { ...install, dismissed: false },
    offlineFailed: q.get('offline') === 'failed',
  });
  show('home');

  if (screen === 'preview') {
    const preview = createPreview($('preview-sheet'), { onClose: noop, onStart: noop, onShuffle: noop, onToggleAlt: (i, on) => preview.setAlternative(i, on) });
    if (q.get('alt') === '1') alternatives[1] = true;
    preview.open(workout, alternatives);
    const scroll = Number(q.get('scroll') ?? 0);
    if (scroll) preview.scroller.scrollTop = scroll;
  }

  if (screen.startsWith('player') || screen === 'dialog') {
    const player = createPlayer($('screen-player'), {
      onEnd: noop, onTogglePause: noop, onResume: noop, onSkip: noop, onAudio: noop, onVibration: noop, onEasier: noop,
    });
    const state = screen === 'dialog' ? 'paused' : screen.slice('player-'.length);
    const moveIndex = workout.focus ?? (state === 'prep' ? 0 : 2);
    if (q.get('alt') === '1') alternatives[moveIndex] = true;
    const opts = {
      prep: { kind: 'prep', moveIndex: 0, remainingMs: 7400 },
      work: { kind: 'work', moveIndex, remainingMs: q.get('final') === '1' ? 2400 : 17400 },
      rest: { kind: 'transition', moveIndex, remainingMs: 6400 },
      paused: { kind: 'work', moveIndex, remainingMs: 11200, status: 'paused' },
      resuming: { kind: 'work', moveIndex, remainingMs: 11200, status: 'resuming', resumeRemainingMs: 2300 },
    }[state] ?? { kind: 'work', moveIndex, remainingMs: 17400 };
    const vibrationSupported = q.get('vib') !== '0';
    player.mount(workout, { audio: q.get('audio') !== '0', vibration: vibrationSupported, vibrationSupported });
    show('player');
    player.update(snapshotFor(workout, { ...opts, alternatives }));
    if (screen === 'dialog') {
      const dlg = createEndDialog($('end-dialog'), { onKeep: noop, onEnd: noop });
      dlg.open();
    }
  }

  if (screen === 'finish') {
    const finish = createFinish($('screen-finish'), { onDone: noop, onAnother: noop });
    finish.render({ activeMs: 420000, movesReached: 12, moveCount: 12, text: FINISH_MESSAGES[Number(q.get('msg') ?? 0) % FINISH_MESSAGES.length] });
    show('finish');
  }

  if (screen === 'about') {
    const about = createAbout($('about-sheet'), { onClose: noop, onInstall: noop });
    about.open({ offline: q.get('offline') ?? 'ready', install });
  }

  const toast = q.get('toast');
  if (toast === 'update') {
    toaster.show({ message: 'A new version is ready', duration: 0, actions: [{ label: 'Refresh', primary: true }, { label: 'Later' }] });
  } else if (toast === 'offline') {
    toaster.show({ message: 'Ready to use offline', duration: 0 });
  } else if (toast === 'wake') {
    toaster.show({ message: 'Tip: keep your screen awake for this workout', duration: 0 });
  }

  // Let figures render at least one frame.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__ready = true;
  }));
}

main().catch((err) => {
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#a3412b;padding:16px">${String(err.stack || err)}</pre>`);
  window.__ready = true;
  console.error(err);
});
