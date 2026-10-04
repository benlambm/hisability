// Shared constants. Keep APP_VERSION in sync with CACHE_VERSION in sw.js
// (tests/pwa.test.mjs enforces this).

export const APP_VERSION = '1.0.0';

export const TIMING = Object.freeze({
  prepSec: 10,
  workSec: 25,
  transitionSec: 10,
  moves: 12,
  resumeCountdownSec: 3,
});

// 10 + 12 * 25 + 11 * 10 = 420 seconds = exactly seven minutes.
export const TOTAL_SEC =
  TIMING.prepSec + TIMING.moves * TIMING.workSec + (TIMING.moves - 1) * TIMING.transitionSec;

export const CATEGORIES = Object.freeze(['lower', 'upper', 'core', 'cardio']);
export const PER_CATEGORY = 3;

export const CATEGORY_LABELS = Object.freeze({
  lower: 'Lower body',
  upper: 'Upper body',
  core: 'Core',
  cardio: 'Cardio',
});

export const SAFETY_NOTE =
  'Use a clear, non-slip space, with a wall nearby if you want support. ' +
  'Stop if you feel pain, dizziness, or unusual shortness of breath.';

export const SCOPE_NOTE = 'General exercise guidance only, not a substitute for individual medical advice.';

export const MOTTO = 'From each according to his ability';
