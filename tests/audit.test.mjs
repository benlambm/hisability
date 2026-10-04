// Static privacy and no-dates audit (acceptance criterion 10; Requirements 3, 51, 52, 53).
// Scans the shipped code: index.html, sw.js, js/**/*.js, plus css/*.css and the manifest for
// third-party URLs and emoji. Tools, tests and docs are not shipped and are not scanned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function walk(dir, ext) {
  const out = [];
  if (!existsSync(join(ROOT, dir))) return out;
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, ext));
    else if (name.endsWith(ext)) out.push(rel);
  }
  return out;
}

const present = (files) => files.filter((f) => existsSync(join(ROOT, f)));
const CODE = present(['index.html', 'sw.js', ...walk('js', '.js')]);
const STYLES = walk('css', '.css');
const ALL = [...CODE, ...STYLES, ...present(['manifest.webmanifest'])];

// XML namespace identifiers look like URLs but are never fetched.
const NAMESPACES = /https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|1999\/xhtml|XML\/1998\/namespace)/g;

const BANNED = [
  // Requirement 3: no dates, weekdays, schedules or time of day.
  ['Date object', /\bDate\b/],
  ['Temporal API', /\bTemporal\b/],
  ['weekday lookup', /\bget(UTC)?Day\b/],
  ['calendar getters', /\bget(UTC)?(FullYear|Month|Hours)\b|getTimezoneOffset/],
  ['locale date formatting', /toLocale(Date|Time)String/],
  ['Intl date formatting', /Intl\.(DateTimeFormat|RelativeTimeFormat)/],
  ['absolute clock origin', /\btimeOrigin\b/],
  // Requirement 51: no storage of behaviour.
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['IndexedDB', /\bindexedDB\b|\bIDBFactory\b/i],
  ['cookies', /document\.cookie|\bcookieStore\b/],
  // Requirement 52: no permission requests for notifications, location or identity.
  ['Notification API', /\bNotification\b|showNotification|\bPushManager\b|\bpushManager\b|periodicSync/],
  ['geolocation', /navigator\.geolocation/],
  ['credentials', /navigator\.credentials/],
  // Requirement 53: no telemetry or remote calls.
  ['beacon', /\bsendBeacon\b/],
  ['raw network channels', /\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b/],
];

function findings(file, patterns) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const lines = text.split('\n');
  const out = [];
  lines.forEach((line, i) => {
    for (const [name, re] of patterns) {
      if (re.test(line)) out.push(`${file}:${i + 1} ${name}: ${line.trim().slice(0, 120)}`);
    }
  });
  return out;
}

test('the audit has shipped code to scan', () => {
  assert.ok(CODE.includes('js/config.js'));
  assert.ok(CODE.length >= 3);
});

test('no date, storage, notification, location or telemetry APIs in shipped code', () => {
  const hits = CODE.flatMap((f) => findings(f, BANNED));
  assert.deepEqual(hits, [], `banned APIs found:\n${hits.join('\n')}`);
});

test('no third-party URLs in shipped files (everything loads from this site)', () => {
  const hits = [];
  for (const file of ALL) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const clean = line.replace(NAMESPACES, '');
      if (/https?:\/\//i.test(clean) || /\b(src|href)\s*=\s*["']\/\//i.test(clean) || /url\(\s*["']?\/\//i.test(clean)) {
        hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  assert.deepEqual(hits, [], `external URLs found:\n${hits.join('\n')}`);
});

test('no emoji in the interface (index.html, css, js, manifest)', () => {
  const hits = ALL.flatMap((f) => findings(f, [['emoji', /\p{Extended_Pictographic}|\u{FE0F}/u]]));
  assert.deepEqual(hits, [], `emoji found:\n${hits.join('\n')}`);
});
