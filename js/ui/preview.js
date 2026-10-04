// Preview sheet: the full sequence in order with demonstrations, cues, easier options,
// exact timing, and a sticky Shuffle + Start footer. Previewing never changes the workout.
import { CATEGORY_LABELS, TIMING, TOTAL_SEC } from '../config.js';
import { createDemo } from '../figure.js';
import { h, activeVersion, formatClock } from './dom.js';
import { icon } from './icons.js';

export const TIMING_SENTENCE =
  `${TIMING.prepSec} s to get ready, then ${TIMING.moves} movements of ${TIMING.workSec} s each ` +
  `with ${TIMING.transitionSec} s transitions between them. Total ${formatClock(TOTAL_SEC * 1000)}.`;

/** Proportional bar of the whole session: prep, then work and rest segments. */
export function timelineStrip() {
  const bar = h('div', { class: 'tl-bar', 'aria-hidden': 'true' });
  const seg = (kind, sec) => h('span', { class: `tl-seg tl-${kind}`, style: `flex-grow:${sec}` });
  bar.append(seg('prep', TIMING.prepSec));
  for (let i = 0; i < TIMING.moves; i++) {
    if (i > 0) bar.append(seg('rest', TIMING.transitionSec));
    bar.append(seg('work', TIMING.workSec));
  }
  const key = (kind, label, value) =>
    h('li', { class: `tl-key tl-key-${kind}` }, h('span', { class: 'tl-swatch', 'aria-hidden': 'true' }), h('span', null, label), ' ', h('span', { class: 'tl-val tnum' }, value));
  const legend = h(
    'ul',
    { class: 'tl-legend', 'aria-label': 'Timing' },
    key('prep', 'Get ready', `0:${String(TIMING.prepSec).padStart(2, '0')}`),
    key('work', 'Work', `${TIMING.moves} × 0:${TIMING.workSec}`),
    key('rest', 'Rest', `${TIMING.moves - 1} × 0:${String(TIMING.transitionSec).padStart(2, '0')}`),
  );
  return h('div', { class: 'tl' }, bar, legend);
}

/** Accessible switch button: role=switch with a visible track + label. */
export function switchButton(label, { checked = false, onToggle, className = '' } = {}) {
  const btn = h(
    'button',
    { class: `switch ${className}`.trim(), type: 'button', role: 'switch', 'aria-checked': String(checked) },
    h('span', { class: 'switch-track', 'aria-hidden': 'true' }, h('span', { class: 'switch-thumb' })),
    h('span', { class: 'switch-label' }, label),
  );
  btn.addEventListener('click', () => onToggle?.(btn.getAttribute('aria-checked') !== 'true'));
  return btn;
}

/**
 * @param {HTMLDialogElement} dialog
 * @param {{ onClose, onStart, onShuffle, onToggleAlt }} handlers
 */
export function createPreview(dialog, handlers) {
  const closeBtn = h(
    'button',
    { class: 'icon-btn sheet-close', type: 'button', 'aria-label': 'Close preview', onclick: () => handlers.onClose() },
    icon('close'),
  );
  const list = h('ol', { class: 'pv-list', 'aria-label': 'Movements in order' });
  const scroller = h(
    'div',
    { class: 'sheet-scroll' },
    h(
      'div',
      { class: 'sheet-inner' },
      h(
        'div',
        { class: 'pv-intro' },
        title,
        h('p', { class: 'pv-timing' }, TIMING_SENTENCE),
        timelineStrip(),
      ),
      list,
      h('p', { class: 'pv-foot-note' }, 'Switch to an easier version any time, here or during the workout.'),
    ),
  );
  const startBtn = h(
    'button',
    { class: 'btn btn-primary btn-lg', type: 'button', 'data-action': 'start', onclick: () => handlers.onStart() },
    icon('play', { size: 20 }),
    h('span', null, 'Start'),
  );
  const shuffleBtn = h(
    'button',
    { class: 'btn btn-secondary btn-lg', type: 'button', 'data-action': 'shuffle', onclick: () => handlers.onShuffle() },
    icon('shuffle', { size: 20 }),
    h('span', null, 'Shuffle'),
  );
  const footer = h('div', { class: 'sheet-footer' }, h('div', { class: 'sheet-footer-inner' }, shuffleBtn, startBtn));
  const head = h('div', { class: 'sheet-head' }, closeBtn, h('p', { class: 'sheet-head-title', 'aria-hidden': 'true' }, 'Preview'));
  dialog.replaceChildren(h('div', { class: 'sheet-frame' }, head, scroller, footer));

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    handlers.onClose();
  });

  let items = []; // [{ li, demo, ... }]
  let current = null; // { workout, alternatives }

  function destroyDemos() {
    for (const it of items) it.demo?.destroy();
    items = [];
  }

  function mountDemo(it, version, index) {
    it.demo?.destroy();
    it.demo = createDemo(version.demo, { label: version.description, offset: index * 0.37 });
    it.stage.replaceChildren(it.demo.el);
    it.li.classList.toggle('has-strip', it.demo.el.classList.contains('fig-strip'));
  }

  function fillItem(it, move, i, alt) {
    const v = activeVersion(move, alt);
    it.name.textContent = v.name;
    it.cue.textContent = v.cue;
    it.easierTag.hidden = !alt;
    it.sides.hidden = !v.switchSides;
    if (alt) {
      it.altLabel.textContent = 'Standard: ';
      it.altText.textContent = `${move.name} — ${move.cue}`;
    } else {
      it.altLabel.textContent = 'Easier: ';
      it.altText.textContent = `${move.alt?.name ?? ''} — ${move.alt?.cue ?? ''}`;
    }
    it.toggle.setAttribute('aria-checked', String(Boolean(alt)));
    it.li.classList.toggle('is-alt', Boolean(alt));
    mountDemo(it, v, i);
  }

  function buildItem(move, i) {
    const it = {};
    it.stage = h('div', { class: 'pv-demo' });
    it.name = h('h3', { class: 'pv-name' });
    it.cue = h('p', { class: 'pv-cue' });
    it.easierTag = h('span', { class: 'tag tag-easier' }, 'Easier version');
    it.sides = h('p', { class: 'pv-sides' }, icon('sides', { size: 16 }), h('span', null, 'Switch sides halfway'));
    it.altLabel = h('strong', null, 'Easier: ');
    it.altText = h('span');
    it.toggle = switchButton('Use easier version', {
      className: 'pv-switch',
      onToggle: (on) => handlers.onToggleAlt(i, on),
    });
    it.toggle.setAttribute('aria-describedby', `pv-alt-${i}`);
    it.li = h(
      'li',
      { class: 'pv-item', dataset: { cat: move.category, index: String(i) } },
      h(
        'div',
        { class: 'pv-head' },
        h(
          'p',
          { class: 'pv-meta' },
          h('span', { class: 'pv-num tnum' }, String(i + 1).padStart(2, '0')),
          h('span', { class: 'pv-cat' }, h('span', { class: 'cat-dot', 'aria-hidden': 'true' }), CATEGORY_LABELS[move.category] ?? move.category),
        ),
        it.name,
        it.easierTag,
        it.cue,
      ),
      it.stage,
      h(
        'div',
        { class: 'pv-more' },
        it.sides,
        move.caution ? h('p', { class: 'pv-caution' }, move.caution) : null,
        h('p', { class: 'pv-alt', id: `pv-alt-${i}` }, it.altLabel, it.altText),
      ),
      h('div', { class: 'pv-switch-row' }, it.toggle),
    );
    return it;
  }

  function render(workout, alternatives) {
    current = { workout, alternatives };
    destroyDemos();
    items = workout.moves.map((move, i) => {
      const it = buildItem(move, i);
      fillItem(it, move, i, alternatives[i]);
      return it;
    });
    list.replaceChildren(...items.map((it) => it.li));
  }

  return {
    get isOpen() {
      return dialog.open;
    },
    open(workout, alternatives) {
      render(workout, alternatives);
      if (!dialog.open) dialog.showModal();
      scroller.scrollTop = 0;
      closeBtn.focus({ preventScroll: true });
      document.documentElement.classList.add('has-sheet');
    },
    close() {
      if (dialog.open) dialog.close();
      destroyDemos();
      list.replaceChildren();
      document.documentElement.classList.remove('has-sheet');
    },
    /** Re-render after Shuffle, keeping the sheet open at the top. */
    refresh(workout, alternatives) {
      if (!dialog.open) return;
      render(workout, alternatives);
      scroller.scrollTop = 0;
    },
    setAlternative(i, on) {
      const it = items[i];
      if (!it || !current) return;
      current.alternatives[i] = on;
      fillItem(it, current.workout.moves[i], i, on);
    },
    get scroller() {
      return scroller;
    },
  };
}
