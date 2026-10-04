// His Ability: boot and screen controller. Holds the in-memory app state (never persisted),
// wires the session engine, cues, wake lock, and PWA helpers to the UI modules.
import { initPWA, applyUpdate, offlineStatus } from './pwa.js';
import { getInstallInfo, onInstallChange, promptInstall } from './install.js';
import { generateWorkout } from './generator.js';
import { createSession } from './session.js';
import { createCues } from './cues.js';
import { createWakeLock } from './wakelock.js';
import { TIMING } from './config.js';
import { announce, activeVersion } from './ui/dom.js';
import { initHistory, pushLayer, popLayer, replaceLayer, topLayer, hasLayer } from './ui/history.js';
import { createHome } from './ui/home.js';
import { createPreview } from './ui/preview.js';
import { createPlayer } from './ui/player.js';
import { createFinish } from './ui/finish.js';
import { createAbout } from './ui/about.js';
import { createEndDialog } from './ui/dialog.js';
import { createToaster } from './ui/toast.js';
import { pickMessage } from './ui/messages.js';

const $ = (id) => document.getElementById(id);
const blankAlternatives = () => new Array(TIMING.moves).fill(false);
const guessVibration = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

const PLAYER_THEME = { light: '#4A2340', dark: '#2E1A2B' };

/** Everything lives in memory and disappears on reload or close (Requirement 54). */
const state = {
  workout: null,
  error: null,
  alternatives: blankAlternatives(),
  audio: true,
  vibration: guessVibration(),
  vibrationSupported: guessVibration(),
  screen: 'home',
  session: null,
  installDismissed: false,
  offlineFailed: false,
  updateReady: false,
  updateToastShown: false,
  wakeHintShown: false,
  endWasRunning: false,
};

let cues = null;
const wakeLock = createWakeLock();

// ---------------------------------------------------------------- views

const toaster = createToaster($('toasts'));

const home = createHome($('screen-home'), {
  onStart: () => startWorkout(),
  onPreview: () => openPreview(),
  onShuffle: () => shuffle(),
  onRetry: () => shuffle(),
  onInfo: () => openAbout(),
  onInstall: () => doInstall(),
  onDismissInstall: () => {
    state.installDismissed = true;
    renderHome();
  },
});

const preview = createPreview($('preview-sheet'), {
  onClose: () => closePreview(),
  onStart: () => startWorkout(),
  onShuffle: () => shuffle(),
  onToggleAlt: (i, on) => {
    state.alternatives[i] = on;
    preview.setAlternative(i, on);
    renderHome();
    const move = state.workout?.moves[i];
    if (move) announce(on ? `Easier version: ${move.alt.name}` : `Standard version: ${move.name}`);
  },
});

const player = createPlayer($('screen-player'), {
  onEnd: () => requestEnd(),
  onTogglePause: () => togglePause(),
  onResume: () => resume(),
  onSkip: () => skip(),
  onAudio: () => toggleAudio(),
  onVibration: () => toggleVibration(),
  onEasier: () => toggleEasier(),
});

const finish = createFinish($('screen-finish'), {
  onDone: () => leaveFinish(false),
  onAnother: () => leaveFinish(true),
});

const about = createAbout($('about-sheet'), {
  onClose: () => closeAbout(),
  onInstall: () => doInstall(),
});

const endDialog = createEndDialog($('end-dialog'), {
  onKeep: () => keepGoing(),
  onEnd: () => endWorkout(),
});

// ---------------------------------------------------------------- workout generation

function generate(previousKey = null) {
  try {
    state.workout = generateWorkout({ previousKey });
    state.error = null;
  } catch (err) {
    console.warn('His Ability: could not generate a workout', err);
    state.workout = null;
    state.error = 'Please try again in a moment. If this keeps happening, reload the app.';
  }
  state.alternatives = blankAlternatives();
}

function shuffle() {
  if (state.session) return;
  generate(state.workout?.key ?? null);
  renderHome();
  if (preview.isOpen && state.workout) preview.refresh(state.workout, state.alternatives);
  announce(state.workout ? 'New workout ready' : 'The workout could not be put together');
}

// ---------------------------------------------------------------- screens

function installInfo() {
  let info;
  try {
    info = getInstallInfo();
  } catch {
    info = { platform: 'other', standalone: false, canPrompt: false };
  }
  return { ...info, dismissed: state.installDismissed };
}

function renderHome() {
  home.render({
    workout: state.workout,
    alternatives: state.alternatives,
    error: state.error,
    install: installInfo(),
    offlineFailed: state.offlineFailed,
  });
}

const themeMetas = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => ({
  el: m,
  original: m.getAttribute('content'),
  dark: /dark/.test(m.getAttribute('media') || ''),
}));

function showScreen(name) {
  state.screen = name;
  for (const id of ['home', 'player', 'finish']) {
    const el = $(`screen-${id}`);
    el.hidden = id !== name;
  }
  document.body.dataset.screen = name;
  for (const m of themeMetas) {
    m.el.setAttribute('content', name === 'player' ? (m.dark ? PLAYER_THEME.dark : PLAYER_THEME.light) : m.original);
  }
  window.scrollTo(0, 0);
}

function goHome() {
  showScreen('home');
  renderHome();
  home.focusStart();
  maybeShowUpdate();
}

// ---------------------------------------------------------------- preview and about

function openPreview() {
  if (!state.workout || state.session || preview.isOpen) return;
  preview.open(state.workout, state.alternatives);
  pushLayer('preview', () => preview.close());
}

function closePreview() {
  if (!preview.isOpen) return;
  preview.close();
  popLayer('preview');
  home.focusStart();
}

function aboutInfo() {
  let offline = 'unsupported';
  try {
    offline = offlineStatus();
  } catch {
    /* keep 'unsupported' */
  }
  return { offline, install: installInfo() };
}

function openAbout() {
  if (about.isOpen) return;
  about.open(aboutInfo());
  pushLayer('about', () => about.close());
}

function closeAbout() {
  if (!about.isOpen) return;
  about.close();
  popLayer('about');
}

async function doInstall() {
  let result = 'unavailable';
  try {
    result = await promptInstall();
  } catch {
    /* fall back to menu guidance */
  }
  if (result === 'accepted') state.installDismissed = true;
  renderHome();
  if (about.isOpen) about.render(aboutInfo());
}

// ---------------------------------------------------------------- the workout

function settings() {
  return { audio: state.audio, vibration: state.vibration, vibrationSupported: state.vibrationSupported };
}

function ensureCues() {
  if (cues) return cues;
  try {
    cues = createCues({ audio: state.audio, vibration: true });
    state.vibrationSupported = Boolean(cues.vibrationSupported);
    state.vibration = state.vibrationSupported;
    cues.setVibration(state.vibration);
  } catch (err) {
    console.warn('His Ability: cues unavailable', err);
    cues = null;
    state.vibrationSupported = false;
    state.vibration = false;
  }
  return cues;
}

function startWorkout() {
  if (!state.workout || state.session) return;
  // Must run synchronously inside the tap: unlocks WebAudio and speech on iOS Safari.
  ensureCues();
  try {
    cues?.unlock();
  } catch {
    /* audio stays silent; the workout still runs */
  }

  let session;
  try {
    session = createSession({ workout: state.workout });
    state.alternatives.forEach((on, i) => {
      if (on) session.setAlternative(i, true);
    });
  } catch (err) {
    console.warn('His Ability: could not start the session', err);
    toaster.show({ message: 'The workout could not start. Please try again.', id: 'start-failed' });
    return;
  }
  state.session = session;
  session.on(onSessionEvent);

  const fromPreview = preview.isOpen;
  if (fromPreview) preview.close();
  player.mount(state.workout, settings());
  showScreen('player');
  if (fromPreview && topLayer() === 'preview') replaceLayer('player', onBackFromPlayer);
  else pushLayer('player', onBackFromPlayer);

  session.start();
  player.update(session.snapshot());
  startLoop();
  player.focusMain();

  wakeLock
    .acquire()
    .then((ok) => {
      if (ok || state.wakeHintShown || state.session !== session) return;
      state.wakeHintShown = true;
      player.hint('Tip: keep your screen awake for this workout');
    })
    .catch(() => {});
}

function onBackFromPlayer() {
  // Back during a workout never leaves silently: stay, and ask.
  pushLayer('player', onBackFromPlayer);
  requestEnd();
}

function nameAt(i, snap) {
  const move = state.workout?.moves[i];
  return move ? activeVersion(move, snap?.alternatives?.[i]).name : '';
}

function onSessionEvent(e) {
  cues?.handle(e);
  const snap = e.snapshot;
  switch (e.type) {
    case 'segment': {
      const name = nameAt(e.moveIndex, snap);
      if (snap?.status === 'running') {
        if (e.kind === 'work') announce(`Work: ${name}`);
        else if (e.kind === 'transition') announce(`Rest. Up next: ${name}`);
        else announce(`Get ready. First up: ${name}`);
      } else {
        announce(`Up next: ${name}`);
      }
      break;
    }
    case 'pause':
      announce('Paused');
      break;
    case 'resume-countdown':
      if (e.secondsLeft === TIMING.resumeCountdownSec) announce('Resuming in 3 seconds');
      break;
    case 'resume':
      announce('Resumed');
      break;
    case 'alternative':
      state.alternatives[e.moveIndex] = e.on;
      announce(e.on ? `Easier version: ${nameAt(e.moveIndex, snap)}` : `Standard version: ${nameAt(e.moveIndex, snap)}`);
      break;
    case 'complete':
      completeWorkout(snap);
      return;
    default:
      break;
  }
  if (state.session && snap) player.update(snap);
}

// Drive the display: every animation frame while visible, plus a 250 ms fallback.
let rafId = 0;
let intervalId = 0;

function pump() {
  const s = state.session;
  if (!s) return;
  const snap = s.tick();
  if (state.session === s) player.update(snap);
}

function frame() {
  rafId = 0;
  pump();
  if (state.session) rafId = requestAnimationFrame(frame);
}

function startLoop() {
  stopLoop();
  rafId = requestAnimationFrame(frame);
  intervalId = setInterval(pump, 250);
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  if (intervalId) clearInterval(intervalId);
  rafId = 0;
  intervalId = 0;
}

document.addEventListener('visibilitychange', () => {
  if (!state.session) return;
  pump();
  if (document.visibilityState === 'visible' && !rafId) rafId = requestAnimationFrame(frame);
});

function togglePause() {
  const s = state.session;
  if (!s) return;
  if (s.status === 'paused') return resume();
  if (s.status === 'running' || s.status === 'resuming') s.pause();
  pump();
}

function resume() {
  const s = state.session;
  if (!s || s.status !== 'paused') return;
  try {
    cues?.unlock();
  } catch {
    /* ignore */
  }
  s.resume();
  pump();
}

function skip() {
  const s = state.session;
  if (!s) return;
  s.skip();
  pump();
}

function toggleEasier() {
  const s = state.session;
  if (!s) return;
  const i = s.snapshot().moveIndex;
  if (!state.workout.moves[i]?.alt) return;
  s.setAlternative(i, !s.isAlternative(i));
  pump();
}

function toggleAudio() {
  state.audio = !state.audio;
  try {
    cues?.setAudio(state.audio);
  } catch {
    /* ignore */
  }
  player.settings(settings());
  announce(state.audio ? 'Sound on' : 'Sound off');
}

function toggleVibration() {
  if (!state.vibrationSupported) return;
  state.vibration = !state.vibration;
  try {
    cues?.setVibration(state.vibration);
  } catch {
    /* ignore */
  }
  player.settings(settings());
  announce(state.vibration ? 'Vibration on' : 'Vibration off');
}

function requestEnd() {
  const s = state.session;
  if (!s || endDialog.isOpen) return;
  state.endWasRunning = s.status === 'running' || s.status === 'resuming';
  if (state.endWasRunning) s.pause();
  pump();
  endDialog.open();
}

function keepGoing() {
  const s = state.session;
  if (!s) return;
  if (state.endWasRunning && s.status === 'paused') resume();
  state.endWasRunning = false;
  player.focusMain();
}

function teardownSession() {
  const s = state.session;
  state.session = null;
  stopLoop();
  endDialog.dismiss();
  wakeLock.release().catch(() => {});
  player.unmount();
  return s;
}

function endWorkout() {
  const s = teardownSession();
  if (!s) return;
  try {
    s.end();
  } catch {
    /* already finished */
  }
  showScreen('home');
  popLayer('player');
  renderHome();
  home.focusStart();
  announce('Workout ended');
  maybeShowUpdate();
}

function completeWorkout(snap) {
  const s = teardownSession();
  if (!s) return;
  const total = snap?.totalMs ?? Infinity;
  finish.render({
    activeMs: Math.min(snap?.activeMs ?? 0, total),
    movesReached: snap?.movesReached ?? 0,
    moveCount: state.workout?.moves.length ?? TIMING.moves,
    text: pickMessage(),
  });
  showScreen('finish');
  if (hasLayer('player')) replaceLayer('finish', () => goHome());
  else pushLayer('finish', () => goHome());
  finish.focus();
  announce('Workout complete');
  maybeShowUpdate();
}

function leaveFinish(another) {
  if (another) generate(state.workout?.key ?? null);
  popLayer('finish');
  goHome();
  if (another) announce('New workout ready');
}

// ---------------------------------------------------------------- keyboard

document.addEventListener('keydown', (e) => {
  if (state.screen !== 'player' || !state.session || endDialog.isOpen) return;
  if (e.key === ' ' || e.code === 'Space') {
    if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea, [role="switch"]')) return;
    e.preventDefault();
    togglePause();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    requestEnd();
  }
});

// ---------------------------------------------------------------- updates and offline

function maybeShowUpdate() {
  if (!state.updateReady || state.updateToastShown || state.session) return;
  state.updateToastShown = true;
  toaster.show({
    id: 'update',
    message: 'A new version is ready',
    duration: 0,
    actions: [
      { label: 'Refresh', primary: true, onClick: () => applyUpdate() },
      { label: 'Later' },
    ],
  });
}

// ---------------------------------------------------------------- boot

initHistory();
generate();
renderHome();

try {
  onInstallChange(() => {
    renderHome();
    if (about.isOpen) about.render(aboutInfo());
  });
} catch {
  /* install guidance stays static */
}

initPWA({
  onUpdateReady() {
    state.updateReady = true;
    maybeShowUpdate();
  },
  onOfflineReady() {
    const wasFailed = state.offlineFailed;
    state.offlineFailed = false;
    if (wasFailed && state.screen === 'home') renderHome();
    if (!state.session) toaster.show({ message: 'Ready to use offline', duration: 3500, id: 'offline' });
    if (about.isOpen) about.render(aboutInfo());
  },
  onOfflineFailed() {
    state.offlineFailed = true;
    if (state.screen === 'home') renderHome();
    if (about.isOpen) about.render(aboutInfo());
  },
});
