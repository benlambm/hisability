// Screenshot demo sheets for visual review of figure animations.
//
//   node tools/render-demos.mjs --cat lower [--ids squat,lunge] [--samples 6] [--out /path/sheet.png]
//
// Prints a JSON contact-gap report (per key pose) to stdout. Open the PNG to inspect poses.
import { startServer } from './serve.mjs';
import { chromium } from './pw.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : def;
};

const cat = arg('--cat', 'all');
const ids = arg('--ids', '');
const samples = arg('--samples', '6');
const out = arg('--out', `demo-sheet-${cat}.png`);
const alt = arg('--alt', '1');

const server = await startServer({ port: 0 });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1700, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const qs = new URLSearchParams({ cat, samples, alt, ...(ids ? { ids } : {}) });
  await page.goto(`${server.url}tools/demo-sheet.html?${qs}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  await page.screenshot({ path: out, fullPage: true });
  const report = await page.evaluate(() => window.__report);
  console.log(JSON.stringify({ out, errors, report }, null, 1));
} finally {
  await browser.close();
  await server.close();
}
