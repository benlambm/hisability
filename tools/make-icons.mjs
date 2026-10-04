// Generate the app icons.
//
//   node tools/make-icons.mjs              render every PNG from icons/icon.svg and icons/favicon.svg
//   node tools/make-icons.mjs --from-rig   first redraw both SVG sources from the figure rig
//                                          (js/figure.js), then render the PNGs
//   node tools/make-icons.mjs --out DIR    write into DIR instead of icons/ (for previews)
//
// The mark: a deep plum field, a Claude-orange timer ring (300 degrees, ending in a rust accent)
// around an ivory figure mid star jump, drawn by the same rig as the in-app demonstrations.
//
// Outputs (icons/):
//   icon.svg              master artwork, rounded square; contains <g id="mark">
//   favicon.svg           simplified mark tuned for 16-32 px
//   icon-192.png          rounded square, transparent corners        (manifest, purpose "any")
//   icon-512.png
//   maskable-192.png      full-bleed plum, mark inside the 80% safe circle (purpose "maskable")
//   maskable-512.png
//   apple-touch-icon.png  180 x 180, opaque RGB, full-bleed (iOS rounds the corners itself)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { chromium } from './pw.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};
const OUT = resolve(arg('--out', join(ROOT, 'icons')));
const FROM_RIG = process.argv.includes('--from-rig');

const C = { ivory: '#FAF9F5', plum: '#4A2340', clay: '#D97757', rust: '#A3412B' };

// Star jump, front view: arms in a high V, legs wide.
const POSE = { nearArm: [50, 30], nearLeg: [150, 158] };

// Artwork geometry on a 512 canvas.
const MASTER = {
  size: 512,
  radius: 112, // corner radius of the rounded field
  ring: { r: 178, width: 38, sweep: 300, accent: 44 }, // degrees clockwise from 12 o'clock
  figure: { height: 252, weight: 1.5, head: 1.18, dy: 2 }, // weight thickens limbs for small sizes
};
// Favicon on a 64 canvas: fewer, bolder shapes.
const FAVICON = {
  size: 64,
  radius: 14,
  ring: { r: 24.5, width: 9, sweep: 300, accent: 60 },
  figure: { height: 33, weight: 2.3, head: 1.35, dy: 0.5 },
};
// Maskable and apple-touch layouts reuse the master mark, scaled about the centre.
const MASKABLE_SCALE = 0.88; // ring outer radius 197 * 0.88 = 173 < 204.8 (the 40% safe radius)
const APPLE_SCALE = 0.9;

const n = (v) => +v.toFixed(2);

// ------------------------------------------------------------------ SVG composition

function arcPath(cx, cy, r, from, to) {
  const pt = (deg) => {
    const a = (deg * Math.PI) / 180;
    return [n(cx + r * Math.sin(a)), n(cy - r * Math.cos(a))];
  };
  const [x0, y0] = pt(from);
  const [x1, y1] = pt(to);
  const large = to - from > 180 ? 1 : 0;
  return `M${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

function ringMarkup(spec, size) {
  const c = size / 2;
  const { r, width, sweep, accent } = spec.ring;
  const common = `fill="none" stroke-width="${width}" stroke-linecap="round"`;
  return [
    `<path d="${arcPath(c, c, r, 0, sweep)}" stroke="${C.clay}" ${common}/>`,
    `<path d="${arcPath(c, c, r, sweep - accent, sweep)}" stroke="${C.rust}" ${common}/>`,
  ].join('\n    ');
}

/** Serialized rig figure (from the browser) -> markup scaled and centred for this spec. */
function figureMarkup(fig, spec) {
  const { height, weight, head, dy } = spec.figure;
  const w = (v) => v * weight;
  const radius = (s) => (s.hand ? w(s.r) : s.r * head);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x, y, pad) => {
    minX = Math.min(minX, x - pad);
    maxX = Math.max(maxX, x + pad);
    minY = Math.min(minY, y - pad);
    maxY = Math.max(maxY, y + pad);
  };
  for (const s of fig) {
    if (s.tag === 'line') {
      grow(s.x1, s.y1, w(s.width) / 2);
      grow(s.x2, s.y2, w(s.width) / 2);
    } else if (s.tag === 'circle') {
      grow(s.cx, s.cy, radius(s));
    } else {
      for (const [x, y] of s.points) grow(x, y, w(s.width) / 2);
    }
  }
  const scale = height / (maxY - minY);
  const tx = spec.size / 2 - ((minX + maxX) / 2) * scale;
  const ty = spec.size / 2 - ((minY + maxY) / 2) * scale + dy;
  const parts = fig.map((s) => {
    if (s.tag === 'line') {
      return `<line x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(s.x2)}" y2="${n(s.y2)}" stroke-width="${n(w(s.width))}"/>`;
    }
    if (s.tag === 'circle') {
      return `<circle cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(radius(s))}" stroke="none"/>`;
    }
    const d = 'M' + s.points.map(([x, y]) => `${n(x)} ${n(y)}`).join('L') + 'Z';
    return `<path d="${d}" stroke-width="${n(w(s.width))}" stroke-linejoin="round"/>`;
  });
  return (
    `<g id="figure" transform="translate(${n(tx)} ${n(ty)}) scale(${+scale.toFixed(4)})" ` +
    `fill="${C.ivory}" stroke="${C.ivory}" stroke-linecap="round">\n      ` +
    parts.join('\n      ') +
    '\n    </g>'
  );
}

function iconSVG(fig, spec, title) {
  const s = spec.size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  <title>${title}</title>
  <!-- Generated by tools/make-icons.mjs from the figure rig (js/figure.js). -->
  <rect id="field" width="${s}" height="${s}" rx="${spec.radius}" fill="${C.plum}"/>
  <g id="mark">
    ${ringMarkup(spec, s)}
    ${figureMarkup(fig, spec)}
  </g>
</svg>
`;
}

/** Full-bleed square variant of the master: plum background, mark scaled about the centre. */
function fullBleedSVG(master, scale) {
  const m = master.match(/<g id="mark">[\s\S]*<\/g>\s*<\/g>/);
  if (!m) throw new Error('icons/icon.svg must contain <g id="mark">...</g>');
  const s = 512;
  const t = (s / 2) * (1 - scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" width="${s}" height="${s}">
  <rect width="${s}" height="${s}" fill="${C.plum}"/>
  <g transform="translate(${n(t)} ${n(t)}) scale(${scale})">${m[0]}</g>
</svg>
`;
}

// ------------------------------------------------------------------ PNG encode / decode

function decodePNG(buf) {
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit, non-interlaced PNGs');
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const ch = { 2: 3, 6: 4 }[colorType];
  if (!ch) throw new Error(`unsupported PNG colour type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      line[i] = (line[i] + [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = line[x * ch];
      out[o + 1] = line[x * ch + 1];
      out[o + 2] = line[x * ch + 2];
      out[o + 3] = ch === 4 ? line[x * ch + 3] : 255;
    }
    prev = line;
  }
  return { width, height, rgba: out };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Encode RGBA pixels as an 8-bit PNG; alpha=false writes colour type 2 (RGB, no alpha). */
function encodePNG({ width, height, rgba }, { alpha }) {
  const ch = alpha ? 4 : 3;
  const stride = width * ch;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < ch; k++) line[x * ch + k] = rgba[(y * width + x) * 4 + k];
    }
    // Pick the filter with the smallest sum of absolute residuals (standard heuristic).
    let best = null;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const row = Buffer.alloc(stride + 1);
      row[0] = f;
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? line[i - ch] : 0;
        const b = prev[i];
        const c = i >= ch ? prev[i - ch] : 0;
        const v = (line[i] - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 255;
        row[i + 1] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = row;
      }
    }
    rows.push(best);
    prev = line;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ browser work

/** Draw POSE with buildFigureSVG, styled through the documented --fig-* custom properties. */
async function drawFigure(page) {
  return page.evaluate(async (pose) => {
    const { buildFigureSVG, solvePose, normalizePose } = await import('./js/figure.js');
    const demo = { view: 'front', focus: [] };
    const { svg, update } = buildFigureSVG(demo);
    update(solvePose(normalizePose(pose, demo.view), demo));
    document.body.appendChild(svg);
    const num = (node, name) => parseFloat(node.getAttribute(name));
    const shapes = [];
    for (const node of svg.querySelector('.fig-body').children) {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const tag = node.tagName.toLowerCase();
      if (tag === 'line') {
        const width = num(node, 'stroke-width') || parseFloat(cs.strokeWidth);
        shapes.push({ tag, x1: num(node, 'x1'), y1: num(node, 'y1'), x2: num(node, 'x2'), y2: num(node, 'y2'), width });
      } else if (tag === 'circle') {
        shapes.push({ tag, cx: num(node, 'cx'), cy: num(node, 'cy'), r: num(node, 'r'), hand: !node.classList.contains('fig-head') });
      } else if (tag === 'path') {
        const nums = node.getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number);
        const points = [];
        for (let i = 0; i < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
        shapes.push({ tag, points, width: parseFloat(cs.strokeWidth) });
      }
    }
    svg.remove();
    return shapes;
  }, POSE);
}

async function renderPNG(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" style="display:block" src="${src}"></body></html>`,
  );
  await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
  const shot = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  return decodePNG(shot);
}

const server = await startServer({ port: 0 });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await mkdir(OUT, { recursive: true });

  let master;
  let favicon;
  if (FROM_RIG) {
    const harness = server.url + '__make-icons.html';
    await page.route(harness, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="css/figure.css">
<style>.fig { --fig-body: ${C.ivory}; --fig-far: ${C.ivory}; --fig-focus: ${C.clay}; --fig-focus-far: ${C.clay}; }</style>
<body></body>`,
      }),
    );
    await page.goto(harness);
    const fig = await drawFigure(page);
    master = iconSVG(fig, MASTER, 'His Ability');
    favicon = iconSVG(fig, FAVICON, 'His Ability');
    await writeFile(join(OUT, 'icon.svg'), master);
    await writeFile(join(OUT, 'favicon.svg'), favicon);
  } else {
    master = await readFile(join(ROOT, 'icons', 'icon.svg'), 'utf8');
  }

  const jobs = [
    ['icon-192.png', master, 192, true],
    ['icon-512.png', master, 512, true],
    ['maskable-192.png', fullBleedSVG(master, MASKABLE_SCALE), 192, false],
    ['maskable-512.png', fullBleedSVG(master, MASKABLE_SCALE), 512, false],
    ['apple-touch-icon.png', fullBleedSVG(master, APPLE_SCALE), 180, false],
  ];
  for (const [name, svg, size, alpha] of jobs) {
    const img = await renderPNG(page, svg, size);
    await writeFile(join(OUT, name), encodePNG(img, { alpha }));
    console.log(`${name.padEnd(22)} ${size}x${size} ${alpha ? 'RGBA' : 'RGB'}`);
  }
} finally {
  await browser.close();
  await server.close();
}
