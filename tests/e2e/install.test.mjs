// Acceptance criteria 12 and 13, in the parts a browser can automate: platform install guidance,
// standalone detection, the Android install prompt, and Chrome's own installability check.
// Requirements 35, 43, 44, 45.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../../tools/pw.mjs';
import {
  startProxy, openApp, closeAll, homeNames, screenName, waitForOfflineReady, IPHONE_UA, ANDROID_UA, DESKTOP,
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

const NOTE = '#screen-home .note-install';
const INSTALL_BTN = '[data-action="install"]';

/** Init script: the page runs as an installed app (display-mode: standalone, iOS navigator.standalone). */
function standalone() {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (query) =>
    /display-mode\s*:\s*standalone/.test(query)
      ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
      : real(query);
  Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
}

/** Fire a synthetic beforeinstallprompt whose prompt() records calls and user activation. */
function firePrompt(page, outcome) {
  return page.evaluate((result) => {
    window.__prompt = { calls: 0, activation: [] };
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => {
      window.__prompt.calls++;
      window.__prompt.activation.push(Boolean(navigator.userActivation?.isActive));
      return Promise.resolve();
    };
    e.userChoice = Promise.resolve({ outcome: result, platform: 'web' });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }, outcome);
}

/** Bounding boxes of the note and the three main actions, and who receives a tap at each centre. */
function layout(page) {
  return page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    const note = document.querySelector('#screen-home .note-install');
    const actions = {};
    for (const a of ['start', 'preview', 'shuffle']) {
      const el = document.querySelector(`#screen-home [data-action="${a}"]`);
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      actions[a] = { box: box(el), hitsSelf: Boolean(hit && el.contains(hit)), enabled: !el.disabled };
    }
    return {
      note: note ? { box: box(note), position: getComputedStyle(note).position } : null,
      actions,
      modal: [...document.querySelectorAll('dialog')].some((d) => d.open),
    };
  });
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('criterion 12 / Requirements 43, 45: iPhone Safari gets Share > Add to Home Screen steps that never block Start, Preview or Shuffle', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { context: { userAgent: IPHONE_UA } });
  try {
    const note = page.locator(NOTE);
    await note.waitFor();
    const text = await note.textContent();
    assert.match(text, /Share/);
    assert.match(text, /Add to Home Screen/);
    assert.doesNotMatch(text, /install prompt|tap Install\b/i, 'no promise of a native prompt');
    assert.equal(await page.locator(INSTALL_BTN).count(), 0, 'no Install button on iOS');

    // Measure while the first-load "ready offline" tip is also showing (the busiest home screen).
    await page.waitForSelector('#toasts .toast', { timeout: 10_000 });
    const l = await layout(page);
    assert.equal(l.modal, false, 'guidance is not a modal');
    assert.notEqual(l.note.position, 'fixed', 'guidance sits in the page flow, not over it');
    for (const [name, a] of Object.entries(l.actions)) {
      assert.ok(a.enabled, `${name} enabled`);
      assert.ok(a.hitsSelf, `${name} receives a tap at its centre`);
      assert.ok(!overlaps(a.box, l.note.box), `${name} is not covered by the guidance`);
    }

    // All three actions work with the guidance showing.
    const names = await homeNames(page);
    await page.click('#screen-home [data-action="preview"]');
    await page.locator('#preview-sheet').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.click('#screen-home [data-action="shuffle"]');
    assert.notDeepEqual(await homeNames(page), names);
    assert.ok(await note.isVisible(), 'guidance survives a shuffle until dismissed');

    // About repeats the iOS steps.
    await page.click('#screen-home .info-btn');
    assert.match(await page.textContent('#about-sheet .about-install'), /Add to Home Screen/);
    assert.equal(await page.locator(`#about-sheet ${INSTALL_BTN}`).count(), 0);
    await page.keyboard.press('Escape');

    // Dismissible, and stays dismissed while the app is open.
    await note.locator('.note-close').click();
    assert.equal(await page.locator(NOTE).count(), 0);
    await page.click('#screen-home [data-action="shuffle"]');
    assert.equal(await page.locator(NOTE).count(), 0, 'stays dismissed after re-rendering');
    await page.click('#screen-home [data-action="start"]');
    assert.equal(await screenName(page), 'player');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('criteria 12, 13: running standalone (installed) shows no install guidance on iPhone or Android', async () => {
  for (const userAgent of [IPHONE_UA, ANDROID_UA]) {
    const { context, page, errors } = await openApp(browser, server.url, { context: { userAgent }, initScripts: [standalone] });
    try {
      await page.waitForTimeout(200);
      if (userAgent === ANDROID_UA) assert.equal(await firePrompt(page, 'accepted'), true);
      await page.waitForTimeout(100);
      assert.equal(await page.locator(NOTE).count(), 0, `${userAgent.slice(13, 30)}: no install note`);
      assert.equal(await page.locator(`#screen-home ${INSTALL_BTN}, #screen-home .quiet-install`).count(), 0);
      await page.click('#screen-home .info-btn');
      assert.match(await page.textContent('#about-sheet .about-install'), /Installed\. You are using the Home Screen app\./);
      assert.equal(await page.locator(`#about-sheet ${INSTALL_BTN}`).count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
});

test('criterion 13 / Requirement 44: Android Chrome offers Install from the captured prompt, with menu guidance as fallback', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { context: { userAgent: ANDROID_UA } });
  try {
    // No prompt captured (yet): browser-menu guidance, no button.
    let note = page.locator(NOTE);
    await note.waitFor();
    assert.match(await note.textContent(), /browser menu.*Install app or Add to Home screen/);
    assert.equal(await page.locator(INSTALL_BTN).count(), 0);

    // The browser offers a prompt: the app keeps it and shows an Install button.
    assert.equal(await firePrompt(page, 'dismissed'), true, 'the mini-infobar is suppressed (preventDefault)');
    const button = page.locator(`${NOTE} ${INSTALL_BTN}`);
    await button.waitFor();
    assert.equal(await page.isEnabled('#screen-home [data-action="start"]'), true, 'Start still available');
    await button.click();
    await page.waitForFunction(() => window.__prompt.calls === 1);
    assert.deepEqual(await page.evaluate(() => window.__prompt.activation), [true], 'prompt() ran inside the tap (user activation)');
    // Dismissed: a captured prompt can be used once, so fall back to the menu guidance.
    await page.waitForFunction(() => !document.querySelector('#screen-home .note-install [data-action="install"]'));
    note = page.locator(NOTE);
    assert.match(await note.textContent(), /browser menu/);

    // Next time the user accepts: the guidance goes away.
    await firePrompt(page, 'accepted');
    await button.waitFor();
    await button.click();
    await page.waitForFunction(() => window.__prompt.calls === 1 && !document.querySelector('#screen-home .note-install'));
    assert.equal(await page.locator(NOTE).count(), 0, 'accepted: no more install guidance');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('criterion 13: desktop install is optional and unobtrusive; Chrome finds the app installable as standalone', async () => {
  const { context, page, errors } = await openApp(browser, server.url, { context: DESKTOP });
  try {
    assert.equal(await page.locator(NOTE).count(), 0, 'no install note on desktop without a prompt');
    await firePrompt(page, 'accepted');
    const link = page.locator(`#screen-home .quiet-install ${INSTALL_BTN}`);
    await link.waitFor();
    assert.equal(await page.locator(NOTE).count(), 0, 'only a quiet link, never a note');

    await waitForOfflineReady(page);
    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installabilityErrors, [], 'Chrome reports no installability errors');
    const { manifest, errors: manifestErrors } = await cdp.send('Page.getAppManifest');
    assert.deepEqual(manifestErrors, []);
    assert.equal(manifest.display, 'kStandalone', 'opens standalone once installed');
    assert.equal(manifest.startUrl, server.url);
    assert.equal(manifest.scope, server.url);
    assert.equal(manifest.name, 'His Ability');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});
