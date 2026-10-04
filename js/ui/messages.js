// Completion messages: encouraging and varied. They celebrate only the session that just
// happened, never appearance, comparison, records, or obligation (Requirement 26).
// Messages that describe the whole session; used only when every second was actually done.
const FULL_SESSION = Object.freeze([
  "That's seven minutes well spent. Come back whenever you have a few more.",
  'Every movement counted. Take a breath and enjoy the rest of your day.',
  'Seven minutes, start to finish. That is something to feel good about.',
  'That is a complete session. However it felt, it counted.',
]);

const ANY_SESSION = Object.freeze([
  'Nicely done. You turned a small window into real movement.',
  'Good work. A fresh mix will be ready whenever you are.',
  'Strong finish. Shake it out, have some water, and carry on.',
  'You gave what you had, and that is the whole idea.',
  'Well moved. Come back any time for another short session.',
  'Finished. Breathe easy; the next one is only a tap away.',
  'Time well used. Enjoy that easy, loosened-up feeling.',
]);

export const FINISH_MESSAGES = Object.freeze([...FULL_SESSION, ...ANY_SESSION]);

/** A varied message; claims about the full seven minutes only when nothing was skipped. */
export function pickMessage({ full = true, rng = Math.random } = {}) {
  const pool = full ? FINISH_MESSAGES : ANY_SESSION;
  const i = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[i];
}
