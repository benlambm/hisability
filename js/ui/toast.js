// Small, calm toasts (update ready, offline ready, wake-lock tip). Never modal.
import { h } from './dom.js';

/** @param {HTMLElement} root the #toasts container (aria-live polite) */
export function createToaster(root) {
  /**
   * @param {{ message: string, actions?: { label: string, primary?: boolean, onClick?: () => void }[],
   *           duration?: number, id?: string }} opts  duration 0 keeps it until an action
   */
  function show({ message, actions = [], duration = 4000, id = '' }) {
    if (id) root.querySelector(`[data-toast="${id}"]`)?.remove();
    let timer = 0;
    const toast = h('div', { class: 'toast', role: 'status', dataset: id ? { toast: id } : undefined });
    const dismiss = () => {
      clearTimeout(timer);
      if (!toast.isConnected) return;
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 180);
    };
    toast.append(h('p', { class: 'toast-text' }, message));
    if (actions.length) {
      toast.append(
        h(
          'div',
          { class: 'toast-actions' },
          actions.map((a) =>
            h(
              'button',
              {
                class: `toast-btn${a.primary ? ' is-primary' : ''}`,
                type: 'button',
                onclick: () => {
                  dismiss();
                  a.onClick?.();
                },
              },
              a.label,
            ),
          ),
        ),
      );
    }
    root.append(toast);
    if (duration > 0) timer = setTimeout(dismiss, duration);
    return { dismiss, el: toast };
  }
  return { show };
}
