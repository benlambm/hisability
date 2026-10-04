# His Ability

*From each according to his ability.*

A randomized, guided seven-minute bodyweight workout. Open it and one balanced workout is ready:
preview it, shuffle it, or press Start and follow along. No equipment, no planning, no gym.

- **12 movements:** 3 lower body, 3 upper body, 3 core, 3 cardio, ordered so neighbours never
  load the same region, repeat a pattern, or put two high-impact moves back to back.
- **Exactly 7:00:** 10 s get ready, then 12 x 25 s of work with 10 s transitions between them.
- **Guidance:** animated demonstrations, one-line form cues, spoken and vibration cues, and an
  easier version of every movement.

## Privacy

No accounts, no tracking, no analytics, no ads, no dates, no history. Nothing is stored except
the offline copy of the app's own files (the browser's service-worker cache). A workout lives in
memory only and is gone when you close or reload the app. The app makes no network requests
beyond loading its own files.

## Preview locally

Needs Node.js 20 or newer. No install step; there are no dependencies.

```sh
npm run serve        # http://localhost:8080/hisability/
```

The local server mirrors GitHub Pages (the site lives under `/hisability/`). The service worker
serves cached files first, so while editing use a private window, or tick **Update on reload** in
Chrome DevTools > Application > Service workers.

## Tests

```sh
npm test             # unit tests, catalog checks, PWA packaging, privacy and no-dates audit
npm run test:e2e     # browser tests (needs Playwright with Chromium, local or global)
node tools/stamp-sw.mjs --check   # is sw.js in step with the files? (exit 1 if not)
```

## Deploy to GitHub Pages

The site is static files only: no build, no server, no secrets.

This repository publishes from the **`gh-pages`** branch, root folder. Publishing is a push:

```sh
git push origin HEAD:gh-pages
```

GitHub turns Pages on for a pushed `gh-pages` branch. If it does not, open **Settings > Pages >
Build and deployment > Source: Deploy from a branch**, choose `gh-pages` and **/ (root)**, and
**Save**. After a minute or two the app is live at `https://benlambm.github.io/hisability/`.

`.nojekyll` tells Pages to serve the files exactly as committed. Every path is relative, so the
app also works under another repository name or a custom domain.

## Release a change

1. Edit the files.
2. Bump `APP_VERSION` in `js/config.js` (for example `1.0.0` to `1.0.1`).
3. Run `node tools/stamp-sw.mjs`. It refreshes the precache list in `sw.js`, copies the
   version into it, and fingerprints the build, so every release gets its own offline cache.
4. Run `npm test`, commit, then publish with `git push origin HEAD:gh-pages`.

What people see: an installed app checks for a new version when it opens and when it comes back
to the foreground (at most every 30 minutes). The new version downloads in the background, then
a **Refresh** prompt appears. It never interrupts an active workout; the current version keeps
running until Refresh is tapped (or the app is fully closed and reopened).

## Roll back

1. `git revert <bad-commit>`
2. Bump `APP_VERSION` again, to a new higher number (never reuse an old one: the version names
   the offline cache), and run `node tools/stamp-sw.mjs`.
3. Commit and publish (`git push origin HEAD:gh-pages`). Installed apps receive it like any
   other update.

## Install

**iPhone / iPad (Safari)**

1. Open the app in Safari.
2. Tap **Share** (on iOS 26 it may be under the **...** menu).
3. Tap **Add to Home Screen**.
4. Keep **Open as Web App** on, then tap **Add**.

The home-screen icon opens full screen, without Safari's toolbars. There is no install pop-up on
iOS; the app shows these steps instead.

**Android (Chrome)**

Tap **Install** in the app when it appears, or use Chrome's three-dot menu > **Install app**
(or **Add to Home screen**).

**Desktop (Chrome, Edge)**

Optional: use the install icon in the address bar.

## Offline

After the first visit has finished saving the app (it tells you if that failed), everything works
without a connection: launch, generate, preview, shuffle, and the full workout. If the first save
fails on a poor connection, the app keeps working online and retries when the connection returns
or the app is reopened. Spoken cues use the voices built into your device.

## Project layout

```
index.html               the single page (all screens)
manifest.webmanifest     install metadata: name, colours, icons, standalone display
sw.js                    service worker: precache, cache-first, versioned updates
css/                     app.css (design system and screens), figure.css (demo figure)
js/app.js                boot and screen controller
js/ui/                   screen modules, icons, dialogs
js/config.js             timing, labels, safety text, APP_VERSION
js/generator.js          balanced random workout
js/timeline.js           the fixed 7-minute interval timeline
js/session.js            workout state machine (pause, resume, skip, end)
js/cues.js, wakelock.js  speech, tones, vibration; keep the screen awake
js/figure.js             pose rig and animated demonstration renderer
js/catalog/              movement content, one file per category
js/pwa.js, install.js    offline status, update prompt, install guidance
icons/                   icon.svg (master), favicon.svg, generated PNGs
tools/                   local server, demo sheets, icon and sw.js generators
tests/                   npm test (node:test); tests/e2e for browser tests
docs/                    PRD.md (requirements), ARCHITECTURE.md (module contract)
```

## Add a movement

1. Add an entry to the category file in `js/catalog/` (`lower.js`, `upper.js`, `core.js`,
   `cardio.js`), following the movement and demo schema in `docs/ARCHITECTURE.md`. Every
   movement needs an easier `alt` with its own demo.
2. Check the animation: `npm run demos -- --cat lower --ids your-id --out /tmp/check.png`,
   then open the image and look at every key pose (contact gaps over 3.5 are printed in red).
3. Run `npm test` (catalog schema, workout balance, audits).
4. Release it as above: bump `APP_VERSION`, run `node tools/stamp-sw.mjs`, commit, push.

## Icons

`node tools/make-icons.mjs` renders every PNG from `icons/icon.svg` and `icons/favicon.svg`.
`node tools/make-icons.mjs --from-rig` first redraws both SVGs with the app's own figure rig.
Release new icons like any other change.
