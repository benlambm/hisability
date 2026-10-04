// Inline SVG icon set, drawn for His Ability on a 24 x 24 grid. Stroke icons use
// currentColor with round caps; a few glyphs (play, pause, skip, dots) are filled.

const NS = 'http://www.w3.org/2000/svg';

// Each entry: list of [tag, attrs]. `fill: true` on an attrs object marks a filled shape.
const S = (d) => ['path', { d }];
const F = (d) => ['path', { d, fill: true }];

const ICONS = {
  play: [F('M8.2 5.1v13.8c0 .8.9 1.3 1.6.9l11-6.9c.6-.4.6-1.3 0-1.7l-11-6.9c-.7-.5-1.6 0-1.6.8z')],
  pause: [
    ['rect', { x: 6, y: 4.8, width: 4.2, height: 14.4, rx: 1.3, fill: true }],
    ['rect', { x: 13.8, y: 4.8, width: 4.2, height: 14.4, rx: 1.3, fill: true }],
  ],
  skip: [
    F('M4.6 6.1v11.8c0 .8.9 1.2 1.5.8l8.6-5.9c.6-.4.6-1.2 0-1.6L6.1 5.3c-.6-.4-1.5 0-1.5.8z'),
    ['rect', { x: 16.6, y: 5.2, width: 2.8, height: 13.6, rx: 1.1, fill: true }],
  ],
  volume: [
    S('M4 9.4h3.1L12 5.3v13.4l-4.9-4.1H4a.9.9 0 0 1-.9-.9V10.3c0-.5.4-.9.9-.9z'),
    S('M15.6 9.2a4 4 0 0 1 0 5.6'),
    S('M18.3 6.6a7.6 7.6 0 0 1 0 10.8'),
  ],
  'volume-off': [
    S('M4 9.4h3.1L12 5.3v13.4l-4.9-4.1H4a.9.9 0 0 1-.9-.9V10.3c0-.5.4-.9.9-.9z'),
    S('M15.8 9.6l4.8 4.8M20.6 9.6l-4.8 4.8'),
  ],
  vibrate: [
    ['rect', { x: 8, y: 3.8, width: 8, height: 16.4, rx: 2.2 }],
    S('M4.8 8.6v6.8M2.4 10.6v2.8M19.2 8.6v6.8M21.6 10.6v2.8'),
  ],
  'vibrate-off': [
    ['rect', { x: 8, y: 3.8, width: 8, height: 16.4, rx: 2.2 }],
    S('M3.5 3.5l17 17'),
  ],
  close: [S('M6.5 6.5l11 11M17.5 6.5l-11 11')],
  shuffle: [
    S('M3 7.2h2.6c2.4 0 3.8 1.2 5.2 3.4l1.4 2.2c1.4 2.2 2.8 3.4 5.2 3.4H20'),
    S('M3 16.2h2.6c1.4 0 2.4-.4 3.3-1.2'),
    S('M14.1 8.4c.9-.8 1.9-1.2 3.3-1.2H20'),
    S('M17.6 4.6l2.6 2.6-2.6 2.6M17.6 13.6l2.6 2.6-2.6 2.6'),
  ],
  list: [
    S('M9.5 6.5H20M9.5 12H20M9.5 17.5H20'),
    ['circle', { cx: 4.8, cy: 6.5, r: 1.3, fill: true }],
    ['circle', { cx: 4.8, cy: 12, r: 1.3, fill: true }],
    ['circle', { cx: 4.8, cy: 17.5, r: 1.3, fill: true }],
  ],
  info: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    S('M12 10.8v5.6'),
    ['circle', { cx: 12, cy: 7.7, r: 1.15, fill: true }],
  ],
  share: [
    S('M8.6 9.6H7.2c-1.1 0-2 .9-2 2V19c0 1.1.9 2 2 2h9.6c1.1 0 2-.9 2-2v-7.4c0-1.1-.9-2-2-2h-1.4'),
    S('M12 3.2v11'),
    S('M8.6 6.4L12 3l3.4 3.4'),
  ],
  'plus-square': [
    ['rect', { x: 3.8, y: 3.8, width: 16.4, height: 16.4, rx: 4.2 }],
    S('M12 8.4v7.2M8.4 12h7.2'),
  ],
  check: [S('M5 12.6l4.4 4.4L19 7.4')],
  refresh: [S('M19.6 12.6a7.6 7.6 0 1 1-2.2-6'), S('M18.2 3.6v3.8h-3.8')],
  more: [
    ['circle', { cx: 6, cy: 12, r: 1.6, fill: true }],
    ['circle', { cx: 12, cy: 12, r: 1.6, fill: true }],
    ['circle', { cx: 18, cy: 12, r: 1.6, fill: true }],
  ],
  'more-vertical': [
    ['circle', { cx: 12, cy: 6, r: 1.6, fill: true }],
    ['circle', { cx: 12, cy: 12, r: 1.6, fill: true }],
    ['circle', { cx: 12, cy: 18, r: 1.6, fill: true }],
  ],
  // State glyphs for the player.
  timer: [['circle', { cx: 12, cy: 13.4, r: 7.4 }], S('M12 13.4V9.8M9.6 3h4.8M12 3v3')],
  bolt: [S('M13.2 2.8L5.4 13.4h5.8L10.4 21.2l8.2-11h-5.8z')],
  leaf: [S('M5.2 18.8C4.4 10.6 9.6 5 19.2 4.8c.6 9.4-5 14.8-13.2 14z'), S('M5.2 18.8l7.6-7.6')],
  sides: [S('M4.5 8.5h14M15 5l3.5 3.5L15 12'), S('M19.5 15.5h-14M9 12l-3.5 3.5L9 19')],
  easier: [S('M3.5 6.5h5v5h5v5h7')],
  download: [S('M12 3.8v11'), S('M7.6 10.6L12 15l4.4-4.4'), S('M5 19.6h14')],
  offline: [S('M7.2 18.4h9.6a4.2 4.2 0 0 0 .6-8.4 5.6 5.6 0 0 0-10.8 1.4 3.6 3.6 0 0 0 .6 7z')],
  arrow: [S('M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5')],
};

/**
 * Build an icon. Decorative by default (aria-hidden); pass `label` for a meaningful icon.
 * @param {string} name
 * @param {{ size?: number, label?: string, className?: string }} [opts]
 */
export function icon(name, { size = 24, label = '', className = '' } = {}) {
  const shapes = ICONS[name];
  if (!shapes) throw new Error(`icon: unknown icon "${name}"`);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', `icon icon-${name}${className ? ' ' + className : ''}`);
  svg.setAttribute('focusable', 'false');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS(NS, tag);
    const filled = attrs.fill === true;
    for (const [k, v] of Object.entries(attrs)) if (k !== 'fill') node.setAttribute(k, String(v));
    if (filled) {
      node.setAttribute('fill', 'currentColor');
      node.setAttribute('stroke', 'none');
    } else {
      node.setAttribute('fill', 'none');
      node.setAttribute('stroke', 'currentColor');
      node.setAttribute('stroke-width', '1.8');
      node.setAttribute('stroke-linecap', 'round');
      node.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(node);
  }
  return svg;
}

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));
