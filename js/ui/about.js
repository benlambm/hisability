// About sheet: what the app is, exact timing, privacy, safety, offline status, install
// steps, and version. A modal <dialog> styled as a bottom sheet on phones.
import { APP_VERSION, MOTTO, SAFETY_NOTE, SCOPE_NOTE } from '../config.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { TIMING_SENTENCE } from './preview.js';

export const OFFLINE_TEXT = Object.freeze({
  ready: 'Ready to work offline',
  installing: 'Getting ready for offline use',
  failed: 'Offline use is not ready yet; stay online and reopen',
  unsupported: 'Offline mode not supported in this browser',
});

const OFFLINE_ICON = { ready: 'check', installing: 'refresh', failed: 'offline', unsupported: 'offline' };

/**
 * @param {HTMLDialogElement} dialog
 * @param {{ onClose, onInstall }} handlers
 */
export function createAbout(dialog, handlers) {
  const closeBtn = h(
    'button',
    { class: 'icon-btn sheet-close', type: 'button', 'aria-label': 'Close', onclick: () => handlers.onClose() },
    icon('close'),
  );
  const offlineRow = h('p', { class: 'about-status' });
  const title = h('h2', { class: 'sheet-title', id: 'about-title', tabindex: '-1' }, 'His Ability');
  const installBox = h('div', { class: 'about-install' });
  const section = (title, ...body) => h('section', { class: 'about-section' }, h('h3', { class: 'about-h' }, title), ...body);

  const scroller = h(
    'div',
    { class: 'sheet-scroll' },
    h(
      'div',
      { class: 'sheet-inner about-inner' },
      title,
      h('p', { class: 'about-motto' }, MOTTO),
      h(
        'p',
        { class: 'about-lede' },
        'One balanced, no-equipment workout each time you open the app: three lower-body, three upper-body, three core, and three cardio movements, mixed in a safe order. Preview it, shuffle it, or simply start.',
      ),
      section('Timing', h('p', null, TIMING_SENTENCE), h('p', { class: 'about-soft' }, 'Spoken cues and optional vibration guide every change, so you can keep your eyes off the screen.')),
      section('Privacy', h('p', { class: 'about-strong' }, 'Nothing is recorded. No accounts, no history, no tracking.'), h('p', { class: 'about-soft' }, 'Each workout lives in memory only and is gone when you close the app.')),
      section('Safety', h('p', null, SAFETY_NOTE), h('p', { class: 'about-soft' }, SCOPE_NOTE)),
      section('Offline', offlineRow),
      section('Install', installBox),
      h('p', { class: 'about-version' }, `Version ${APP_VERSION}`),
    ),
  );
  const head = h('div', { class: 'sheet-head' }, closeBtn, h('p', { class: 'sheet-head-title', 'aria-hidden': 'true' }, 'About'));
  dialog.replaceChildren(h('div', { class: 'sheet-frame' }, head, scroller));
  scroller.addEventListener('scroll', () => head.classList.toggle('is-scrolled', scroller.scrollTop > 4), { passive: true });

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    handlers.onClose();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) handlers.onClose(); // backdrop tap (wide screens)
  });

  function installContent(install) {
    if (!install) return [h('p', null, 'Add His Ability to your home screen from your browser menu.')];
    if (install.standalone) {
      return [h('p', { class: 'about-status is-ready' }, icon('check', { size: 18 }), h('span', null, 'Installed. You are using the Home Screen app.'))];
    }
    if (install.platform === 'ios') {
      return [
        h(
          'ol',
          { class: 'about-steps' },
          h('li', null, 'In Safari, tap Share ', h('span', { class: 'inline-glyph' }, icon('share', { size: 17, label: 'Share' })), ' (or ', h('span', { class: 'inline-glyph' }, icon('more', { size: 17, label: 'More' })), ' then Share).'),
          h('li', null, 'Choose Add to Home Screen ', h('span', { class: 'inline-glyph' }, icon('plus-square', { size: 17, label: '' })), '.'),
          h('li', null, 'Tap Add, then open His Ability from your Home Screen.'),
        ),
      ];
    }
    const out = [];
    if (install.canPrompt) {
      out.push(
        h(
          'button',
          { class: 'btn btn-secondary btn-sm', type: 'button', 'data-action': 'install', onclick: () => handlers.onInstall() },
          icon('download', { size: 18 }),
          h('span', null, 'Install app'),
        ),
      );
    }
    if (install.platform === 'android') {
      out.push(h('p', { class: 'about-soft' }, 'Or open the browser menu and choose Install app or Add to Home screen.'));
    } else {
      out.push(h('p', { class: 'about-soft' }, 'In Chrome or Edge, use the install button in the address bar or the browser menu. On iPhone and iPad, use Safari: Share, then Add to Home Screen.'));
    }
    return out;
  }

  function render({ offline, install }) {
    const key = OFFLINE_TEXT[offline] ? offline : 'unsupported';
    offlineRow.className = `about-status is-${key}`;
    offlineRow.replaceChildren(icon(OFFLINE_ICON[key], { size: 18 }), h('span', { 'data-offline': key }, OFFLINE_TEXT[key]));
    installBox.replaceChildren(...installContent(install));
  }

  return {
    get isOpen() {
      return dialog.open;
    },
    render,
    open(info) {
      render(info);
      if (!dialog.open) dialog.showModal();
      scroller.scrollTop = 0;
      title.focus({ preventScroll: true });
      document.documentElement.classList.add('has-sheet');
    },
    close() {
      if (dialog.open) dialog.close();
      document.documentElement.classList.remove('has-sheet');
    },
  };
}
