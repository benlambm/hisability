// Overlay layers (preview, about, player, finish) mapped onto browser history so the
// Android back button / gesture closes the top layer instead of leaving the app.
// URLs never change; only in-memory history state entries are pushed.

const layers = []; // [{ name, onBack }]
let ignorePops = 0;

/** Push a layer. `onBack` runs when the user navigates back while it is on top. */
export function pushLayer(name, onBack) {
  layers.push({ name, onBack });
  try {
    history.pushState({ hbLayer: name, depth: layers.length }, '');
  } catch {
    /* history unavailable (sandboxed): layers still work without back support */
  }
}

/** Replace the top layer (e.g. preview -> player, player -> finish) without a navigation. */
export function replaceLayer(name, onBack) {
  if (!layers.length) return pushLayer(name, onBack);
  layers[layers.length - 1] = { name, onBack };
  try {
    history.replaceState({ hbLayer: name, depth: layers.length }, '');
  } catch {
    /* ignore */
  }
}

/** Remove a layer programmatically (closed by a button, not by Back). */
export function popLayer(name) {
  const i = layers.findLastIndex((l) => l.name === name);
  if (i === -1) return;
  const count = layers.length - i;
  layers.splice(i);
  ignorePops += 1;
  try {
    history.go(-count);
  } catch {
    ignorePops -= 1;
  }
}

export function topLayer() {
  return layers.length ? layers[layers.length - 1].name : null;
}

export function hasLayer(name) {
  return layers.some((l) => l.name === name);
}

export function initHistory() {
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) {
      ignorePops -= 1;
      return;
    }
    const top = layers.pop();
    if (top) top.onBack();
  });
}
