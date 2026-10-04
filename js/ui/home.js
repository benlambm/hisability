// Home screen: wordmark + motto, the ready workout, Start / Preview / Shuffle,
// dismissible install guidance, offline notice, and the safety note.
import { CATEGORY_LABELS, MOTTO, SAFETY_NOTE, SCOPE_NOTE, TOTAL_SEC } from '../config.js';
import { h, activeVersion, formatClock } from './dom.js';
import { icon } from './icons.js';

/**
 * @param {HTMLElement} root  the #screen-home section
 * @param {{ onStart, onPreview, onShuffle, onInfo, onInstall, onDismissInstall, onRetry }} handlers
 */
export function createHome(root, handlers) {
  const infoBtn = h(
    'button',
    { class: 'icon-btn info-btn', type: 'button', 'aria-label': 'About His Ability', onclick: () => handlers.onInfo() },
    icon('info'),
  );
  const header = h(
    'header',
    { class: 'home-header' },
    h(
      'div',
      { class: 'home-brand' },
      h('h1', { class: 'wordmark', id: 'home-title' }, 'His Ability'),
      h('p', { class: 'motto' }, MOTTO),
    ),
    infoBtn,
  );

  const list = h('ol', { class: 'move-list', 'aria-label': 'Movements in order' });
  const cardBody = h('div', { class: 'workout-body' }, list);
  const card = h(
    'section',
    { class: 'card workout-card', 'aria-labelledby': 'workout-heading' },
    h(
      'div',
      { class: 'workout-head' },
      h('p', { class: 'workout-time tnum', 'aria-hidden': 'true' }, formatClock(TOTAL_SEC * 1000)),
      h(
        'div',
        { class: 'workout-summary' },
        h('h2', { class: 'workout-title', id: 'workout-heading' },
          h('span', { class: 'visually-hidden' }, 'Seven minutes, '),
          '12 movements'),
        h('p', { class: 'workout-sub' }, 'No equipment needed'),
      ),
    ),
    cardBody,
  );

  const startBtn = h(
    'button',
    { class: 'btn btn-primary btn-xl start-btn', type: 'button', 'data-action': 'start', onclick: () => handlers.onStart() },
    icon('play', { size: 22 }),
    h('span', null, 'Start'),
  );
  const previewBtn = h(
    'button',
    { class: 'btn btn-secondary', type: 'button', 'data-action': 'preview', onclick: () => handlers.onPreview() },
    icon('list', { size: 20 }),
    h('span', null, 'Preview'),
  );
  const shuffleBtn = h(
    'button',
    { class: 'btn btn-secondary', type: 'button', 'data-action': 'shuffle', onclick: () => handlers.onShuffle() },
    icon('shuffle', { size: 20 }),
    h('span', null, 'Shuffle'),
  );
  const actions = h('div', { class: 'home-actions' }, startBtn, h('div', { class: 'btn-row' }, previewBtn, shuffleBtn));

  const notes = h('div', { class: 'home-notes' });
  const footer = h(
    'footer',
    { class: 'home-footer' },
    h('p', { class: 'safety' }, SAFETY_NOTE),
    h('p', { class: 'scope' }, SCOPE_NOTE),
  );

  const content = h('div', { class: 'home-inner' }, header, card, actions, notes, footer);
  root.replaceChildren(content);

  let lastKey = null;

  function renderList(workout, alternatives) {
    const rows = workout.moves.map((move, i) => {
      const v = activeVersion(move, alternatives[i]);
      return h(
        'li',
        { class: 'move-row', dataset: { cat: move.category } },
        h('span', { class: 'move-num tnum', 'aria-hidden': 'true' }, String(i + 1)),
        h(
          'span',
          { class: 'move-name' },
          v.name,
          v.isAlt ? h('span', { class: 'tag tag-easier' }, 'Easier') : null,
        ),
        h(
          'span',
          { class: 'move-cat' },
          h('span', { class: 'cat-dot', 'aria-hidden': 'true' }),
          h('span', { class: 'visually-hidden' }, ', '),
          CATEGORY_LABELS[move.category] ?? move.category,
        ),
      );
    });
    list.replaceChildren(...rows);
  }

  function renderError(message) {
    cardBody.replaceChildren(
      h(
        'div',
        { class: 'inline-error', role: 'alert' },
        h('p', { class: 'inline-error-title' }, 'The workout could not be put together just now.'),
        h('p', { class: 'inline-error-text' }, message || 'Please try again in a moment.'),
        h(
          'button',
          { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => handlers.onRetry() },
          icon('refresh', { size: 18 }),
          h('span', null, 'Try again'),
        ),
      ),
    );
  }

  function installNote(install) {
    if (!install || install.dismissed || install.standalone) return null;
    const dismiss = h(
      'button',
      { class: 'icon-btn icon-btn-sm note-close', type: 'button', 'aria-label': 'Dismiss install tip', onclick: () => handlers.onDismissInstall() },
      icon('close', { size: 18 }),
    );
    if (install.platform === 'ios') {
      return h(
        'aside',
        { class: 'note note-install', 'aria-label': 'Install on iPhone or iPad' },
        h('span', { class: 'note-icon' }, icon('plus-square', { size: 22 })),
        h(
          'div',
          { class: 'note-body' },
          h('p', { class: 'note-title' }, 'Install on your Home Screen'),
          h(
            'p',
            { class: 'note-text' },
            'Install: tap Share ',
            h('span', { class: 'inline-glyph' }, icon('share', { size: 17, label: 'Share' })),
            ' (or ',
            h('span', { class: 'inline-glyph' }, icon('more', { size: 17, label: 'More' })),
            ' then Share), then Add to Home Screen.',
          ),
        ),
        dismiss,
      );
    }
    if (install.platform === 'android') {
      if (install.canPrompt) {
        return h(
          'aside',
          { class: 'note note-install', 'aria-label': 'Install the app' },
          h('span', { class: 'note-icon' }, icon('download', { size: 22 })),
          h(
            'div',
            { class: 'note-body' },
            h('p', { class: 'note-title' }, 'Keep it on your home screen'),
            h('p', { class: 'note-text' }, 'Install for one-tap access, even offline.'),
            h(
              'button',
              { class: 'btn btn-quiet btn-sm', type: 'button', 'data-action': 'install', onclick: () => handlers.onInstall() },
              icon('download', { size: 18 }),
              h('span', null, 'Install app'),
            ),
          ),
          dismiss,
        );
      }
      return h(
        'aside',
        { class: 'note note-install', 'aria-label': 'Install the app' },
        h('span', { class: 'note-icon' }, icon('download', { size: 22 })),
        h(
          'div',
          { class: 'note-body' },
          h('p', { class: 'note-title' }, 'Keep it on your home screen'),
          h(
            'p',
            { class: 'note-text' },
            'Open the browser menu ',
            h('span', { class: 'inline-glyph' }, icon('more-vertical', { size: 17, label: 'Menu' })),
            ' and choose Install app or Add to Home screen.',
          ),
        ),
        dismiss,
      );
    }
    if (install.platform === 'desktop' && install.canPrompt) {
      return h(
        'p',
        { class: 'quiet-install' },
        h(
          'button',
          { class: 'link-btn', type: 'button', 'data-action': 'install', onclick: () => handlers.onInstall() },
          icon('download', { size: 16 }),
          h('span', null, 'Install as an app'),
        ),
      );
    }
    return null;
  }

  function offlineNote(failed) {
    if (!failed) return null;
    return h(
      'aside',
      { class: 'note note-offline', role: 'status' },
      h('span', { class: 'note-icon' }, icon('offline', { size: 22 })),
      h(
        'div',
        { class: 'note-body' },
        h('p', { class: 'note-title' }, 'Offline use is not ready yet'),
        h('p', { class: 'note-text' }, 'Everything works while you are online. Stay online and reopen the app to finish setting up.'),
      ),
    );
  }

  /**
   * @param {{ workout, alternatives, error, install, offlineFailed }} state
   */
  function render(state) {
    const ok = Boolean(state.workout);
    if (ok) {
      if (!cardBody.contains(list)) cardBody.replaceChildren(list);
      renderList(state.workout, state.alternatives);
      if (lastKey && lastKey !== state.workout.key) {
        list.classList.remove('is-fresh');
        void list.offsetWidth; // restart the fade
        list.classList.add('is-fresh');
      }
      lastKey = state.workout.key;
    } else {
      renderError(state.error);
    }
    startBtn.disabled = !ok;
    previewBtn.disabled = !ok;
    notes.replaceChildren(...[installNote(state.install), offlineNote(state.offlineFailed)].filter(Boolean));
  }

  return {
    render,
    focusStart() {
      startBtn.focus({ preventScroll: true });
    },
    get startButton() {
      return startBtn;
    },
  };
}
