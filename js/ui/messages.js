// Completion messages. Encouraging, varied, and free of weight, calorie, body-shape, guilt,
// competition, punishment, streak, or missed-day language (Requirement 26).
export const FINISH_MESSAGES = Object.freeze([
  "That's seven minutes well spent. Come back whenever you have a few more.",
  'Nicely done. You turned a small window into real movement.',
  'Every movement counted. Take a breath and enjoy the rest of your day.',
  'Good work. A fresh mix will be ready whenever you are.',
  'Seven minutes, start to finish. That is something to feel good about.',
  'Strong finish. Shake it out, have some water, and carry on.',
  'You gave what you had, and that is the whole idea.',
  'Well moved. Come back any time for another short session.',
  'That is a complete session. However it felt, it counted.',
  'Finished. Breathe easy; the next one is only a tap away.',
  'Time well used. Enjoy that easy, loosened-up feeling.',
]);

export function pickMessage(rng = Math.random) {
  const i = Math.min(FINISH_MESSAGES.length - 1, Math.floor(rng() * FINISH_MESSAGES.length));
  return FINISH_MESSAGES[i];
}
