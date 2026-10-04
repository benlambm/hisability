// Finish screen: celebrates only the session that just happened. Nothing is stored.
import { MOTTO } from '../config.js';
import { h, formatClock, setText } from './dom.js';
import { icon } from './icons.js';

/**
 * @param {HTMLElement} root the #screen-finish section
 * @param {{ onDone, onAnother }} handlers
 */
export function createFinish(root, handlers) {
  const message = h('p', { class: 'fin-message' });
  const duration = h('span', { class: 'fin-stat-value tnum' });
  const moves = h('span', { class: 'fin-stat-value tnum' });
  const doneBtn = h(
    'button',
    { class: 'btn btn-primary btn-xl', type: 'button', 'data-action': 'done', onclick: () => handlers.onDone() },
    icon('check', { size: 22 }),
    h('span', null, 'Done'),
  );
  const anotherBtn = h(
    'button',
    { class: 'btn btn-secondary btn-lg', type: 'button', 'data-action': 'another', onclick: () => handlers.onAnother() },
    icon('shuffle', { size: 20 }),
    h('span', null, 'Generate another workout'),
  );
  const title = h('h2', { class: 'fin-title', id: 'finish-title', tabindex: '-1' }, 'Workout complete');
  root.replaceChildren(
    h(
      'div',
      { class: 'fin-inner' },
      h(
        'div',
        { class: 'fin-hero' },
        h('div', { class: 'fin-badge', 'aria-hidden': 'true' }, h('span', { class: 'fin-badge-ring' }), icon('check', { size: 40 })),
        title,
        message,
      ),
      h(
        'dl',
        { class: 'fin-stats', 'aria-label': 'This session' },
        h('div', { class: 'fin-stat' }, h('dt', null, 'Active time'), h('dd', null, duration)),
        h('div', { class: 'fin-stat' }, h('dt', null, 'Movements'), h('dd', null, moves, h('span', { class: 'fin-stat-unit' }, ' movements'))),
      ),
      h('div', { class: 'fin-actions' }, doneBtn, anotherBtn),
      h('p', { class: 'fin-motto' }, MOTTO),
    ),
  );

  return {
    /** @param {{ activeMs: number, movesReached: number, moveCount: number, text: string }} summary */
    render({ activeMs, movesReached, moveCount, text }) {
      setText(duration, formatClock(activeMs, 'round'));
      setText(moves, `${movesReached} of ${moveCount}`);
      setText(message, text);
    },
    focus() {
      title.focus({ preventScroll: true });
    },
  };
}
