// End-workout confirmation (<dialog>). Escape and the backdrop behave like "Keep going".
import { h } from './dom.js';
import { icon } from './icons.js';

/**
 * @param {HTMLDialogElement} dialog
 * @param {{ onKeep: () => void, onEnd: () => void }} handlers
 */
export function createEndDialog(dialog, handlers) {
  const keepBtn = h(
    'button',
    { class: 'btn btn-primary btn-lg', type: 'button', 'data-action': 'keep', onclick: () => finish('keep') },
    icon('play', { size: 20 }),
    h('span', null, 'Keep going'),
  );
  const endBtn = h(
    'button',
    { class: 'btn btn-danger btn-lg', type: 'button', 'data-action': 'confirm-end', onclick: () => finish('end') },
    icon('close', { size: 20 }),
    h('span', null, 'End workout'),
  );
  dialog.replaceChildren(
    h(
      'div',
      { class: 'confirm-card' },
      h('h2', { class: 'confirm-title', id: 'end-title' }, 'End this workout?'),
      h('p', { class: 'confirm-text', id: 'end-desc' }, 'You can stop whenever you need to. Nothing from this session is kept.'),
      h('div', { class: 'confirm-actions' }, keepBtn, endBtn),
    ),
  );

  let settled = true;
  function finish(choice) {
    if (settled) return;
    settled = true;
    if (dialog.open) dialog.close();
    document.documentElement.classList.remove('has-dialog');
    if (choice === 'end') handlers.onEnd();
    else handlers.onKeep();
  }

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    finish('keep');
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) finish('keep'); // backdrop tap
  });

  return {
    get isOpen() {
      return dialog.open;
    },
    open() {
      if (dialog.open) return;
      settled = false;
      dialog.showModal();
      document.documentElement.classList.add('has-dialog');
      keepBtn.focus();
    },
    /** Close without a choice (e.g. the session ended underneath). */
    dismiss() {
      settled = true;
      if (dialog.open) dialog.close();
      document.documentElement.classList.remove('has-dialog');
    },
  };
}
