// PWA packaging: manifest, icons, service worker precache list, relative paths, and the
// js/pwa.js + js/install.js runtime contracts that can run without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const exists = (f) => existsSync(join(ROOT, f));

// ------------------------------------------------------------------ helpers

function pngInfo(file) {
  const buf = readFileSync(join(ROOT, file));
  assert.equal(buf.toString('hex', 0, 8), '89504e470d0a1a0a', `${file} is not a PNG`);
  assert.equal(buf.toString('latin1', 12, 16), 'IHDR', `${file} has no IHDR`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
    interlace: buf[28],
    buf,
  };
}

/** Decode an 8-bit non-interlaced PNG (grey, RGB, grey+alpha or RGBA) to RGBA. */
function decodePNG(file) {
  const info = pngInfo(file);
  const { width, height, bitDepth, colorType, interlace, buf } = info;
  assert.equal(bitDepth, 8, `${file}: expected 8-bit samples`);
  assert.equal(interlace, 0, `${file}: expected no interlacing`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  assert.ok(ch, `${file}: unsupported colour type ${colorType}`);
  const idat = [];
  for (let off = 8; off < buf.length; ) {
    const len = buf.readUInt32BE(off);
    if (buf.toString('latin1', off + 4, off + 8) === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      line[i] = (line[i] + [0, a, b, (a + b) >> 1, paeth][f]) & 255;
    }
    for (let x = 0; x < width; x++) {
      const s = x * ch;
      const o = (y * width + x) * 4;
      const grey = ch <= 2;
      rgba[o] = line[s];
      rgba[o + 1] = grey ? line[s] : line[s + 1];
      rgba[o + 2] = grey ? line[s] : line[s + 2];
      rgba[o + 3] = ch === 4 ? line[s + 3] : ch === 2 ? line[s + 1] : 255;
    }
    prev = line;
  }
  return { ...info, rgba };
}

function swAssets() {
  const sw = read('sw.js');
  const m = sw.match(/\/\* ASSETS:START \*\/([\s\S]*?)\/\* ASSETS:END \*\//);
  assert.ok(m, 'sw.js has an ASSETS:START ... ASSETS:END block');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function walk(dir) {
  const out = [];
  if (!exists(dir)) return out;
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

function runtimeFiles() {
  return [
    'index.html',
    'manifest.webmanifest',
    ...walk('css').filter((f) => f.endsWith('.css')),
    ...walk('js').filter((f) => f.endsWith('.js')),
    ...walk('icons').filter((f) => /\.(png|svg)$/.test(f)),
  ];
}

const manifest = () => JSON.parse(read('manifest.webmanifest'));

// ------------------------------------------------------------------ manifest (Requirement 35, 37)

test('manifest defines identity, scope, display and colours (Requirement 35)', () => {
  const m = manifest();
  assert.equal(m.name, 'His Ability');
  assert.equal(typeof m.short_name, 'string');
  assert.ok(m.short_name.length > 0 && m.short_name.length <= 12, 'short_name fits under a home-screen icon');
  assert.equal(m.id, './');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.equal(m.orientation, 'portrait-primary');
  assert.equal(m.background_color, '#FAF9F5');
  assert.equal(m.theme_color, '#FAF9F5');
  assert.match(m.description, /From each according to his ability/);
  assert.deepEqual([...m.categories].sort(), ['fitness', 'health']);
});

test('manifest lists 192 and 512 icons plus maskable variants that exist at those sizes (Requirement 37)', () => {
  const icons = manifest().icons;
  const want = [
    ['icons/icon-192.png', 192, 'any'],
    ['icons/icon-512.png', 512, 'any'],
    ['icons/maskable-192.png', 192, 'maskable'],
    ['icons/maskable-512.png', 512, 'maskable'],
  ];
  for (const [src, size, purpose] of want) {
    const entry = icons.find((i) => i.src === src);
    assert.ok(entry, `manifest lists ${src}`);
    assert.equal(entry.sizes, `${size}x${size}`);
    assert.equal(entry.type, 'image/png');
    assert.equal(entry.purpose, purpose);
    assert.ok(exists(src), `${src} exists`);
    const { width, height } = pngInfo(src);
    assert.deepEqual([width, height], [size, size], `${src} is ${size}x${size}`);
  }
  for (const entry of icons) assert.ok(exists(entry.src), `${entry.src} exists`);
});

test('maskable icons are full-bleed with all artwork inside the 80% safe circle', () => {
  for (const file of ['icons/maskable-192.png', 'icons/maskable-512.png']) {
    const { width, height, rgba } = decodePNG(file);
    const bg = [...rgba.subarray(0, 4)];
    assert.equal(bg[3], 255, `${file} corner is opaque`);
    const c = width / 2;
    const safe = width * 0.4;
    let stray = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (rgba[o + 3] !== 255) stray++;
        if (Math.hypot(x + 0.5 - c, y + 0.5 - c) <= safe) continue;
        const d = Math.abs(rgba[o] - bg[0]) + Math.abs(rgba[o + 1] - bg[1]) + Math.abs(rgba[o + 2] - bg[2]);
        if (d > 6) stray++;
      }
    }
    assert.equal(stray, 0, `${file}: ${stray} pixels outside the safe circle differ from the background`);
  }
});

test('apple-touch-icon is 180x180 and fully opaque', () => {
  const file = 'icons/apple-touch-icon.png';
  assert.ok(exists(file));
  const { width, height, colorType, rgba } = decodePNG(file);
  assert.deepEqual([width, height], [180, 180]);
  if (colorType === 4 || colorType === 6) {
    for (let i = 3; i < rgba.length; i += 4) assert.equal(rgba[i], 255, 'every pixel is opaque');
  } else {
    assert.ok(colorType === 2 || colorType === 0, 'no alpha channel');
  }
});

test('SVG icon sources exist', () => {
  for (const f of ['icons/icon.svg', 'icons/favicon.svg']) {
    assert.ok(exists(f), `${f} exists`);
    const svg = read(f);
    assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 \d+ \d+"/);
    assert.doesNotMatch(svg, /<image|href=/, `${f} is self-contained`);
  }
  assert.match(read('icons/icon.svg'), /<g id="mark">/, 'icon.svg keeps the mark group make-icons.mjs reuses');
});

// ------------------------------------------------------------------ service worker (Requirements 38, 40)

test('sw.js CACHE_VERSION equals APP_VERSION in js/config.js', async () => {
  const { APP_VERSION } = await import('../js/config.js');
  const m = read('sw.js').match(/const CACHE_VERSION = '([^']+)';/);
  assert.ok(m, 'sw.js declares CACHE_VERSION');
  assert.equal(m[1], APP_VERSION, 'run node tools/stamp-sw.mjs after bumping APP_VERSION');
});

test('sw.js caches under a versioned his-ability- name and waits for the user to update', () => {
  const sw = read('sw.js');
  assert.match(sw, /'his-ability-'/);
  assert.match(sw, /CACHE_PREFIX \+ CACHE_VERSION/);
  assert.match(sw, /cache: 'reload'/, 'precache bypasses the HTTP cache');
  assert.match(sw, /SKIP_WAITING/);
  // skipWaiting() may appear only inside the message handler.
  const calls = sw.match(/skipWaiting\(\)/g) ?? [];
  assert.equal(calls.length, 1, 'exactly one skipWaiting() call');
  assert.match(sw, /data\.type === 'SKIP_WAITING'\) self\.skipWaiting\(\)/);
  assert.match(sw, /clients\.claim\(\)/);
});

test('every ASSETS entry exists on disk, without duplicates or absolute paths', () => {
  const assets = swAssets();
  assert.ok(assets.includes('./'), "ASSETS includes './'");
  assert.ok(assets.includes('index.html'), 'ASSETS includes index.html');
  assert.equal(new Set(assets).size, assets.length, 'no duplicates');
  for (const a of assets) {
    assert.ok(!a.startsWith('/') && !/^[a-z]+:/i.test(a), `${a} is relative`);
    const file = a === './' ? 'index.html' : a;
    assert.ok(exists(file), `${a} exists on disk`);
  }
});

test('every runtime file is precached (run node tools/stamp-sw.mjs if this fails)', () => {
  const assets = new Set(swAssets());
  const missing = runtimeFiles().filter((f) => !assets.has(f));
  assert.deepEqual(missing, [], `missing from sw.js ASSETS: ${missing.join(', ')}`);
});

// ------------------------------------------------------------------ project-site paths (Requirement 32)

test('manifest, sw.js and index.html use only relative URLs', () => {
  const m = manifest();
  for (const url of [m.id, m.start_url, m.scope, ...m.icons.map((i) => i.src)]) {
    assert.ok(!url.startsWith('/') && !/^[a-z]+:/i.test(url), `manifest URL ${url} is relative`);
  }
  const sw = read('sw.js');
  for (const [, s] of sw.matchAll(/'([^'\n]*)'/g)) {
    assert.ok(!/^\/[^/]/.test(s), `sw.js string '${s}' is not root-absolute`);
  }
  const html = read('index.html');
  for (const [, attr, url] of html.matchAll(/\b(src|href|content)\s*=\s*"([^"]*)"/g)) {
    if (attr === 'content' && !/^[./]/.test(url)) continue;
    assert.ok(!url.startsWith('/'), `index.html ${attr}="${url}" must be relative`);
    assert.ok(!/^[a-z]+:\/\//i.test(url), `index.html ${attr}="${url}" must not load from another site`);
  }
});

test('index.html declares the manifest, icons and standalone metadata', () => {
  const html = read('index.html');
  const tag = (re, what) => assert.match(html, re, `index.html needs ${what}`);
  tag(/<link[^>]+rel="manifest"[^>]+href="manifest\.webmanifest"/, '<link rel="manifest" href="manifest.webmanifest">');
  tag(/<link[^>]+rel="apple-touch-icon"[^>]+href="icons\/apple-touch-icon\.png"/, 'an apple-touch-icon link');
  tag(/<link[^>]+rel="icon"[^>]+href="icons\/favicon\.svg"/, 'an SVG favicon link');
  tag(/<meta[^>]+name="theme-color"/, 'a theme-color meta tag');
  tag(/<meta[^>]+name="apple-mobile-web-app-capable"[^>]+content="yes"/, 'apple-mobile-web-app-capable');
  tag(/<meta[^>]+name="viewport"[^>]+viewport-fit=cover/, 'a viewport meta with viewport-fit=cover');
});

// ------------------------------------------------------------------ js/pwa.js and js/install.js

test('pwa.js reports unsupported and never throws without service workers', async () => {
  const pwa = await import('../js/pwa.js');
  assert.equal(pwa.offlineStatus(), 'unsupported');
  assert.equal(await pwa.initPWA({ onOfflineReady() {}, onOfflineFailed() {}, onUpdateReady() {} }), 'unsupported');
  assert.equal(pwa.offlineStatus(), 'unsupported');
  assert.equal(pwa.applyUpdate(), false);
});

test('install.js detects platform, standalone display and the captured prompt', async (t) => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const nav = { userAgent: '', maxTouchPoints: 0 };
  let standaloneQuery = false;
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  globalThis.window = new EventTarget();
  globalThis.matchMedia = () => ({ matches: standaloneQuery, addEventListener() {} });
  t.after(() => {
    delete globalThis.window;
    delete globalThis.matchMedia;
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
  });

  const install = await import('../js/install.js');
  const platform = (ua, touch = 0) => {
    nav.userAgent = ua;
    nav.maxTouchPoints = touch;
    return install.getInstallInfo().platform;
  };
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  assert.equal(platform(IPHONE, 5), 'ios');
  assert.equal(platform(MAC, 5), 'ios', 'iPadOS reporting as a Mac');
  assert.equal(platform(MAC, 0), 'desktop');
  assert.equal(platform(ANDROID, 5), 'android');
  assert.equal(platform(WINDOWS), 'desktop');
  assert.equal(platform('SomethingElse/1.0'), 'other');

  nav.userAgent = ANDROID;
  assert.equal(install.getInstallInfo().standalone, false);
  standaloneQuery = true;
  assert.equal(install.getInstallInfo().standalone, true, 'display-mode: standalone');
  standaloneQuery = false;
  nav.standalone = true;
  assert.equal(install.getInstallInfo().standalone, true, 'navigator.standalone (iOS)');
  delete nav.standalone;

  assert.equal(install.getInstallInfo().canPrompt, false);
  assert.equal(await install.promptInstall(), 'unavailable');

  const seen = [];
  const off = install.onInstallChange((info) => seen.push(info.canPrompt));
  const event = new Event('beforeinstallprompt', { cancelable: true });
  let prompted = 0;
  event.prompt = () => {
    prompted++;
    return Promise.resolve();
  };
  event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, 'the mini-infobar is suppressed');
  assert.equal(install.getInstallInfo().canPrompt, true);
  assert.deepEqual(seen, [true]);

  assert.equal(await install.promptInstall(), 'accepted');
  assert.equal(prompted, 1);
  assert.equal(install.getInstallInfo().canPrompt, false, 'a prompt is used once');
  assert.equal(install.getInstallInfo().installed, true);
  assert.deepEqual(seen, [true, false]);
  assert.equal(await install.promptInstall(), 'unavailable');

  off();
  const again = new Event('beforeinstallprompt', { cancelable: true });
  again.prompt = () => Promise.resolve({ outcome: 'dismissed' });
  window.dispatchEvent(again);
  assert.deepEqual(seen, [true, false], 'unsubscribed listeners are not called');
  assert.equal(await install.promptInstall(), 'dismissed');
});
