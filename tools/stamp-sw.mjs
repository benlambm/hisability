// Keep sw.js in step with the files it must precache.
//
//   node tools/stamp-sw.mjs           rewrite the ASSETS block and CACHE_VERSION in sw.js
//   node tools/stamp-sw.mjs --check   change nothing; exit 1 when sw.js is out of date
//
// ASSETS = './' plus every runtime file, sorted: index.html, manifest.webmanifest, css/*.css,
// js/**/*.js (skipping names that start with '_' or '.'), icons/*.png and icons/*.svg.
// CACHE_VERSION is copied from APP_VERSION in js/config.js. A fingerprint of every listed file's
// bytes is written as a comment, so sw.js changes whenever any shipped file changes and browsers
// always notice a new release. This is a local convenience; the deployed site is static files.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const START = '/* ASSETS:START */';
const END = '/* ASSETS:END */';

const hidden = (name) => name.startsWith('_') || name.startsWith('.');

async function walk(root, dir, test) {
  let entries;
  try {
    entries = await readdir(join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (hidden(e.name)) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(root, rel, test)));
    else if (e.isFile() && test(e.name)) out.push(rel);
  }
  return out;
}

/** Runtime files relative to the repository root, sorted (without './'). */
export async function runtimeFiles(root = ROOT) {
  const top = (await readdir(root)).filter((f) => f === 'index.html' || f === 'manifest.webmanifest');
  const css = (await readdir(join(root, 'css')).catch(() => []))
    .filter((f) => f.endsWith('.css') && !hidden(f))
    .map((f) => `css/${f}`);
  const js = await walk(root, 'js', (f) => f.endsWith('.js'));
  const icons = (await readdir(join(root, 'icons')).catch(() => []))
    .filter((f) => /\.(png|svg)$/.test(f) && !hidden(f))
    .map((f) => `icons/${f}`);
  return [...top, ...css, ...js, ...icons].sort();
}

export async function appVersion(root = ROOT) {
  const config = await readFile(join(root, 'js/config.js'), 'utf8');
  const m = config.match(/export const APP_VERSION\s*=\s*'([^']+)'/);
  if (!m) throw new Error('APP_VERSION not found in js/config.js');
  return m[1];
}

export async function fingerprint(files, root = ROOT) {
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f + '\n');
    hash.update(await readFile(join(root, f)));
    hash.update('\n');
  }
  return hash.digest('hex').slice(0, 16);
}

/** Return sw.js source with the ASSETS block and CACHE_VERSION replaced. */
export function stampSource(source, { version, files, print }) {
  const a = source.indexOf(START);
  const b = source.indexOf(END);
  if (a < 0 || b < a) throw new Error(`sw.js must contain ${START} ... ${END}`);
  const indent = source.slice(source.lastIndexOf('\n', a) + 1, a);
  const lines = [
    START,
    `// fingerprint ${print} (written by tools/stamp-sw.mjs; changes when any file below changes)`,
    ...['./', ...files].map((f) => `'${f}',`),
  ];
  const out = source.slice(0, a) + lines.join('\n' + indent) + '\n' + indent + source.slice(b);
  const v = /const CACHE_VERSION = '[^']*';/;
  if (!v.test(out)) throw new Error("sw.js must declare const CACHE_VERSION = '...';");
  return out.replace(v, () => `const CACHE_VERSION = '${version}';`);
}

export async function stamp({ root = ROOT } = {}) {
  const swPath = join(root, 'sw.js');
  const source = await readFile(swPath, 'utf8');
  const version = await appVersion(root);
  const files = await runtimeFiles(root);
  const print = await fingerprint(files, root);
  const next = stampSource(source, { version, files, print });
  const prevVersion = (source.match(/const CACHE_VERSION = '([^']*)';/) || [])[1];
  const prevPrint = (source.match(/\/\/ fingerprint ([0-9a-f]+)/) || [])[1];
  return { source, next, changed: next !== source, version, prevVersion, files, print, prevPrint, swPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const r = await stamp();
  if (check) {
    if (r.changed) {
      const why = [];
      if (r.prevVersion !== r.version) why.push(`CACHE_VERSION ${r.prevVersion} != APP_VERSION ${r.version}`);
      if (r.prevPrint !== r.print) why.push('shipped files changed (ASSETS list or contents)');
      console.error(`sw.js is out of date: ${why.join('; ') || 'ASSETS block differs'}.`);
      console.error('Run: node tools/stamp-sw.mjs');
      process.exit(1);
    }
    console.log(`sw.js is up to date (version ${r.version}, ${r.files.length + 1} assets).`);
  } else {
    if (r.changed) await writeFile(r.swPath, r.next);
    console.log(
      `sw.js ${r.changed ? 'stamped' : 'already up to date'}: version ${r.version}, ` +
        `${r.files.length + 1} assets, fingerprint ${r.print}.`,
    );
    if (r.prevPrint && r.prevPrint !== r.print && r.prevVersion === r.version) {
      console.log(
        `Note: files changed but APP_VERSION is still ${r.version}. Before releasing, bump it in ` +
          'js/config.js and run this again, so installed apps get a fresh cache.',
      );
    }
  }
}
