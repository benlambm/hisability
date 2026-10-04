// Requirement 32 (GitHub Pages project subpath) and criterion 16 in the browser: every URL the
// app, its service worker and its manifest use resolves under /hisability/, and a full session
// produces no 404 (or any other failed request) anywhere.
//
// The proxy logs every request that reaches the server, including the service worker's own
// precache fetches, which Playwright's request events do not report.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../../tools/pw.mjs';
import {
  startProxy, openApp, closeAll, screenName, waitForOfflineReady, swAssets, BASE,
} from './helpers.mjs';

let server;
let browser;

before(async () => {
  server = await startProxy();
  browser = await chromium.launch();
});

after(async () => {
  await closeAll(browser, server);
});

test('Requirement 32: a full session requests only URLs under /hisability/ and nothing fails', async () => {
  const seen = [];
  const failures = [];
  const listen = (context) => {
    context.on('request', (r) => seen.push(r.url()));
    context.on('requestfailed', (r) => failures.push(`failed ${r.url()} ${r.failure()?.errorText}`));
    context.on('response', (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
    });
  };
  const { context, page, errors } = await openApp(browser, server.url, { clock: true, onContext: listen });
  try {
    await waitForOfflineReady(page);

    // Paths the page and the worker are configured with.
    const config = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return {
        scope: reg.scope,
        script: navigator.serviceWorker.controller?.scriptURL,
        manifest: document.querySelector('link[rel="manifest"]').href,
        resources: [...document.querySelectorAll('[src], [href]')]
          .map((el) => el.src || el.href)
          .filter((u) => typeof u === 'string' && /^https?:/.test(u)),
      };
    });
    assert.equal(config.scope, server.url, 'service-worker scope is the project subpath');
    assert.equal(config.script, `${server.url}sw.js`);
    assert.equal(config.manifest, `${server.url}manifest.webmanifest`);
    for (const u of config.resources) assert.ok(u.startsWith(server.url), `page resource under the subpath: ${u}`);

    const cdp = await context.newCDPSession(page);
    const { manifest } = await cdp.send('Page.getAppManifest');
    assert.equal(manifest.startUrl, server.url, 'manifest start_url resolves to the subpath');
    assert.equal(manifest.scope, server.url, 'manifest scope resolves to the subpath');
    for (const icon of manifest.icons) {
      assert.ok(icon.url.startsWith(server.url), `icon under the subpath: ${icon.url}`);
      const res = await fetch(icon.url);
      assert.equal(res.status, 200, `${icon.url} is served`);
    }

    // The precache asked for every asset, under the subpath, and got it.
    const precached = new Set(server.log.filter((e) => e.status === 200).map((e) => e.path));
    for (const a of swAssets()) {
      const path = a === './' ? BASE : BASE + a;
      assert.ok(precached.has(path), `fetched ${path}`);
    }

    // A full session: preview, shuffle, about, a workout to the finish, another, a relaunch.
    await page.click('#screen-home [data-action="preview"]');
    await page.locator('#preview-sheet').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.click('#screen-home [data-action="shuffle"]');
    await page.click('#screen-home .info-btn');
    await page.keyboard.press('Escape');
    await page.click('#screen-home [data-action="start"]');
    for (let i = 0; i < 40 && (await screenName(page)) === 'player'; i++) await page.clock.fastForward(15_000);
    assert.equal(await screenName(page), 'finish');
    await page.click('[data-action="another"]');
    await page.reload();
    await page.waitForSelector('#screen-home .move-row');
    const tab = await context.newPage();
    await tab.goto(server.url);
    await tab.waitForSelector('#screen-home .move-row');
    await tab.goto(`${server.url}index.html`);
    await tab.waitForSelector('#screen-home .move-row');

    assert.ok(seen.length > 0);
    for (const u of seen) assert.ok(u.startsWith(server.url), `browser request under /hisability/: ${u}`);
    assert.ok(server.log.length > 0);
    for (const e of server.log) {
      assert.ok(e.path.startsWith(BASE), `server request under /hisability/: ${e.path}`);
      assert.ok(e.status > 0 && e.status < 400, `server answered ${e.status} for ${e.path}`);
    }
    assert.deepEqual(failures, [], 'no 404s or failed requests');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
