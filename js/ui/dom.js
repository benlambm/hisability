// Small DOM helpers shared by the screen modules. No framework, no state.

/**
 * Create an element. Props: class, text, html is intentionally unsupported (no innerHTML),
 * on<Event> functions become listeners, `true` booleans become empty attributes,
 * null/false/undefined are skipped. Children may be nodes, strings, arrays, or null.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Set text only when it changed (cheap to call every frame). */
export function setText(el, text) {
  const value = String(text);
  if (el.textContent !== value) el.textContent = value;
}

/** Toggle an attribute-like boolean state only when it changed. */
export function setFlag(el, name, on) {
  if (el.hasAttribute(name) !== Boolean(on)) el.toggleAttribute(name, Boolean(on));
}

/** m:ss from milliseconds. `mode` 'ceil' for countdowns, 'round' for durations. */
export function formatClock(ms, mode = 'ceil') {
  const safe = Math.max(0, Number(ms) || 0);
  const total = mode === 'round' ? Math.round(safe / 1000) : Math.ceil(safe / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Spoken-friendly duration, e.g. "7 minutes", "5 minutes 12 seconds". */
export function spokenDuration(ms, mode = 'ceil') {
  const safe = Math.max(0, Number(ms) || 0);
  const total = mode === 'round' ? Math.round(safe / 1000) : Math.ceil(safe / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (s || !m) parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}

let announcer = null;
let announceTimer = 0;

/** Polite screen-reader announcement through the shared live region. */
export function announce(text) {
  announcer ??= document.getElementById('announcer');
  if (!announcer) return;
  // Clear first so repeating the same sentence is announced again.
  announcer.textContent = '';
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    announcer.textContent = text;
  }, 60);
}

/** The active version (default or easier alternative) of a movement. */
export function activeVersion(move, alternative) {
  if (!move) return null;
  const alt = alternative && move.alt ? move.alt : null;
  return {
    name: alt ? alt.name : move.name,
    cue: alt ? alt.cue : move.cue,
    demo: alt?.demo ?? move.demo,
    description: (alt ? alt.description : move.description) || (alt ? alt.name : move.name),
    switchSides: alt && typeof alt.switchSides === 'boolean' ? alt.switchSides : move.switchSides === true,
    isAlt: Boolean(alt),
  };
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
