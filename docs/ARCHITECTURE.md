# His Ability — architecture and module contract

Static, build-free Progressive Web App. Plain ES modules, no frameworks, no third-party code,
no network calls beyond loading its own files. Served from the repository root by GitHub Pages
at a project subpath (`https://<user>.github.io/hisability/`), so **every URL is relative**
(`./`, `js/app.js`, never `/js/app.js`).

## Hard product rules (from the PRD)

- No `localStorage`, `sessionStorage`, `IndexedDB`, cookies, analytics, telemetry, remote calls.
  Session state lives only in memory. The only persistence is the service-worker cache.
- No dates: never use `Date`, `Intl.DateTimeFormat`, `toLocale*String` for dates, weekdays,
  time-of-day, or calendars. Use `performance.now()` for all timing. No Notification API.
- No emojis anywhere in the UI. Icons are inline SVG.
- No weight, calorie, body-shape, guilt, competition, punishment, streak, or missed-day language.
- Never claim a workout is unique to a day ("today's workout" is banned wording).
- Motto "From each according to his ability" appears on the home/opening view.

## File layout and ownership

```
index.html                 UI       single page, all screens
manifest.webmanifest       PWA
sw.js                      PWA      service worker (cache-first, versioned)
.nojekyll                  core
css/figure.css             core     figure styling (custom properties)
css/app.css                UI       design system + screens
js/config.js               core     TIMING, TOTAL_SEC, CATEGORIES, labels, safety text, APP_VERSION
js/figure.js               core     pose rig, SVG renderer, animation clock
js/catalog/index.js        core     CATALOG (aggregates the four category files), BY_ID
js/catalog/{lower,upper,core,cardio}.js   CATALOG authors (one per category)
js/generator.js            ENGINE-A workout generation and validation
js/timeline.js             ENGINE-B fixed interval timeline
js/session.js              ENGINE-B workout session state machine (DOM-free)
js/cues.js                 CUES     speech, beeps, vibration/haptics
js/wakelock.js             CUES     screen wake lock with fallback
js/pwa.js                  PWA      service worker registration, update + offline status
js/install.js              PWA      install context + Android prompt capture
js/app.js                  UI       boot + screen controller
js/ui/*.js                 UI       screen modules, icons, dialogs
icons/*                    PWA      icon source SVG + generated PNGs
tools/serve.mjs            core     static server mirroring Pages subpath (/hisability/)
tools/pw.mjs               core     Playwright loader (global install fallback)
tools/render-demos.mjs     core     screenshot demo sheets for pose review
tools/make-icons.mjs       PWA      SVG -> PNG icon generation via Playwright
tests/*.test.mjs           each owner, run with `npm test` (node:test, no deps)
tests/e2e/*.test.mjs       integration, Playwright + tools/serve.mjs
README.md                  PWA      preview, deploy, cache update, rollback, install
```

Only edit files you own. If you need a change in someone else's file, note it in your final report.

## Timing (js/config.js)

`TIMING = { prepSec: 10, workSec: 25, transitionSec: 10, moves: 12, resumeCountdownSec: 3 }`,
`TOTAL_SEC = 420`. Sequence: prep, work 1, transition, work 2, ... transition, work 12. There is
no transition after the final movement. Randomization never changes timing.

## Movement schema (js/catalog/<category>.js)

Each category file `export default [ ...movements ]` (8 to 10 movements, target 9).

```js
{
  id: 'reverse-lunge',          // kebab-case, unique across the whole catalog, stable forever
  name: 'Reverse Lunge',        // display name, <= 22 characters
  say: 'Reverse lunges',        // optional natural spoken name; defaults to name
  category: 'lower',            // 'lower' | 'upper' | 'core' | 'cardio'
  region: 'legs',               // primary loaded region: 'legs' | 'upper' | 'trunk' | 'full'
  pattern: 'lunge',             // primary movement pattern, from PATTERNS below
  impact: 'low',                // 'low' | 'high' (high = both feet leave the floor / landing forces)
  equipment: 'none',            // default version: 'none' | 'wall'  (never 'chair')
  setup: 'Stand tall, feet hip-width apart.',            // setup cue, one sentence
  cue: 'Step back and lower until both knees bend.',     // primary form cue, <= 60 chars, imperative
  mistake: 'Letting the front knee drift inward.',       // common mistake, one short sentence
  caution: 'Shorten the step if your knees complain.',   // optional contraindication note, or omit
  switchSides: false,           // optional: true for one-sided holds/moves (side plank, split squat);
                                //   the player says "Switch sides" at the halfway point of the work
  description: 'Figure steps one foot back and lowers ...', // screen-reader description of the demo
  demo: { ... },                // see Demo schema
  alt: {                        // required lower-impact / easier alternative
    name: 'Supported Split Squat',
    cue: 'Hold a wall and lower only partway.',
    equipment: 'wall',          // 'none' | 'wall' | 'chair'  (chair allowed only here)
    description: 'Figure ...',
    demo: { ... },
  },
}
```

Category -> default region: lower `legs`, upper `upper`, core `trunk`, cardio `full`. A cardio
movement that is overwhelmingly leg work (squat jumps) may use region `legs`.

PATTERNS (shared vocabulary; the generator forbids the same pattern in adjacent slots):
`squat` (squat, sumo squat, wall sit, squat jump), `lunge` (any split stance, jump lunge),
`lateral` (side lunge, skaters, lateral shuffle), `hinge` (good morning, single-leg hinge),
`bridge` (glute bridge variants), `calf` (calf raise), `push` (push-up variants),
`overhead-push` (pike push-up), `dip` (floor/crab dip), `pull` (prone Y raise, snow angel,
superman, back extension), `shoulder-mobility` (arm circles, wall angels), `plank` (forearm or
high plank holds, shoulder taps, plank up-downs), `side-plank`, `crunch` (crunch, bicycle,
reverse crunch, sit-up), `supine-hold` (dead bug, hollow hold, leg lowers), `quadruped`
(bird dog, bear hold), `rotation` (russian twist, standing twist), `jump` (jumping jacks, star
jumps), `run` (high knees, butt kicks, march, fast feet), `climber` (mountain climbers),
`burpee`, `punch` (shadow boxing, punches), `crawl` (inchworm, bear crawl).

Rules: every movement has a no-equipment (or wall) default and a lower-impact `alt`. A chair
may appear only in an `alt`. Use encouraging, plain, non-diagnostic language.

## Demo schema (js/figure.js)

```js
demo: {
  view: 'side',                          // 'side' (faces screen right) | 'front'
  anchor: { joint: 'nearAnkle', x: 100 },// horizontal pin; default { joint: 'hip', x: 100 }
  focus: ['legs'],                       // highlighted (orange) parts: legs hips glutes thighs calves
                                         //   arms shoulders chest back core full
  props: [{ type: 'wall', x: 170 }],     // optional: wall {x, side}, chair {x, seat, facing}, mat {x1, x2}
  contacts: ['nearToe', 'nearHand'],     // authoring metadata: joints that should touch the floor in
                                         //   every non-airborne key (checked by tests, <= 3.5 units)
  keys: [                                // 2-6 key poses, looped in order back to the first
    { pose: {...}, dur: 0.8, hold: 0.15, ease: 'inOut' },  // dur: seconds to next key; hold: pause
  ],
}
```

Pose: `{ torso, head, nearArm: [upper, fore], farArm, nearLeg: [thigh, shin], farLeg, nearFoot,
farFoot, lift, dx }`. Angles are absolute screen-space degrees for the direction from the
proximal to the distal joint: `0` up, `90` forward (screen right), `180` down, `270` (= `-90`)
back. Standing = `{ torso: 0, nearArm: [180, 180], nearLeg: [180, 180] }`. Supine with head at
screen-left = `torso: 270`; hips raised above shoulders when supine means torso between 180 and
270 (hip -> neck points down-left), e.g. 250. Prone plank facing right = torso about 80-90,
legs about 260-270.

Defaults: `head` = torso; far limbs = near limbs (side view) or mirrored near limbs (front
view, `-angle`); feet = 100 (side) or 105 / -105 (front); `lift` 0; `dx` 0. Angles interpolate on
the shortest arc, so a sweep of more than 180 degrees needs intermediate keys (use
`ease: 'linear'` on intermediate keys for smooth circles). `lift` raises the figure off the floor
(jumps); the figure is otherwise auto-grounded every frame. `dx` shifts horizontally.

Joint names: `hip neck head nearShoulder nearElbow nearHand farShoulder farElbow farHand
nearHip nearKnee nearAnkle nearToe farHip farKnee farAnkle farToe`.

Segment lengths (units in a 200 x 200 scene, ground at y = 186): torso 50, neck 6, head radius 11,
upper arm 27, forearm 25, thigh 39, shin 37, foot 13.

Authoring loop:
1. Pure functions work in Node: `import { normalizePose, solvePose, contactGaps } from '../js/figure.js'`
   then `contactGaps(solvePose(normalizePose(pose, view), demo), ['nearHand', 'nearToe'])`.
2. `node tools/render-demos.mjs --cat lower --out /tmp/x/lower.png` renders every key pose
   (orange outline, contact gaps printed, red when > 3.5) plus 6 tween samples per demo.
   Open the PNG with the Read tool and judge it like a coach: recognizable exercise, plausible
   joints (no backward knees or elbows), contacts on the floor, smooth tween.
3. `js/catalog/_samples.js` has working squat, push-up, jumping jack, and bridge examples.

Runtime API used by the UI:
- `createDemo(demo, { label, offset, className })` -> `{ el, play(), pause(), destroy() }`.
  Animated figure, or a static numbered key-pose strip when `prefers-reduced-motion: reduce`.
- `createFigure(demo, opts)` (always animated, has `setDemo(demo, label)`), `createKeyStrip(demo, opts)`.
- Figures pause themselves when off-screen or detached. Include `css/figure.css`; recolor with
  `--fig-body --fig-far --fig-focus --fig-focus-far --fig-ground --fig-shadow --fig-prop
  --fig-prop-line --fig-mat --fig-eye` on an ancestor `.fig` (or a selector targeting `.fig`).

## js/generator.js (ENGINE-A)

```js
export function generateWorkout({ catalog = CATALOG, rng = cryptoRandom, previousKey = null } = {})
  // -> { moves: Movement[12], key: string }   key = sequenceKey(moves)
export function validateSequence(moves) // -> { ok: true } | { ok: false, reason: string }
export function sequenceKey(moves)      // ids joined with ','
export function cryptoRandom()          // uniform [0,1) from crypto.getRandomValues
export function mulberry32(seed)        // deterministic rng for tests
```

Validity: exactly 12, no duplicate ids, exactly 3 per category, no two adjacent moves sharing
`region`, no two adjacent sharing `pattern`, no two adjacent `impact: 'high'`, every move has a
lower-impact `alt`, default equipment is `none` or `wall`. Algorithm: draw 3 random moves per
category, then randomized backtracking to find a valid order; redraw the selection if none exists;
if the result's key equals `previousKey`, redraw. Never loops forever (bounded attempts, then throw).

## js/timeline.js and js/session.js (ENGINE-B)

```js
// timeline.js
export function buildTimeline(moveCount = TIMING.moves, timing = TIMING)
  // -> Segment[]: { index, kind: 'prep'|'work'|'transition', move, startMs, endMs, durationMs }
  //    move = index of the movement the segment is about: prep -> 0, work i -> i,
  //    transition before move i -> i (the upcoming movement)
export function totalMs(timeline)
export function locate(timeline, posMs) // -> { segIndex, seg, intoMs, remainingMs, done }

// session.js — DOM-free, clock injected, fully unit-testable
export function createSession({ workout, timeline = buildTimeline(), now = () => performance.now(),
                                resumeCountdownMs = TIMING.resumeCountdownSec * 1000 })
```

Session methods: `start()`, `pause()`, `resume()`, `skip()`, `end()`, `tick()`, `snapshot()`,
`setAlternative(moveIndex, on)`, `isAlternative(i)`, `on(handler)` (receives every event,
returns an unsubscribe function).

States: `idle -> running <-> paused -> resuming -> running ... -> complete`; `end()` from any
state -> `ended`. Position advances only while `running`. Timeline position is computed from
`now()` deltas (accumulated + now - runStartedAt), never by summing ticks, so late callbacks cause
no drift. `resume()` enters `resuming` for 3 s (position frozen) then `running`.

Skip: during prep or a transition -> jump to the start of the next work segment; during work i
-> jump to the start of the following transition (or complete if i is the final movement).
Allowed while running, paused, or resuming; the status is unchanged.

Snapshot: `{ status, posMs, totalMs, segIndex, seg, kind, segElapsedMs, segRemainingMs,
moveIndex, move, nextMove, upcoming, resumeRemainingMs, activeMs, movesReached, alternatives }`
- `move` = movement for `moveIndex` (during prep/transition it is the upcoming movement)
- `nextMove` = movement after the current work (during work), or after the upcoming one (rest)
- `activeMs` = time actually spent running (for the summary); `movesReached` = work segments entered
- `alternatives` = boolean[12]

Events `{ type, snapshot, ... }`: `start`; `segment` (new segment entered, including via skip;
fields `kind`, `moveIndex`, `move`, `nextMove`, `alternative`); `countdown` (`secondsLeft` 3, 2,
1 inside the final three seconds of any segment); `halfway` (work segments only, at the midpoint;
fields `moveIndex`, `move`); `pause`; `resume-countdown` (`secondsLeft`
3, 2, 1); `resume`; `skip`; `alternative` (`moveIndex`, `on`); `complete`; `end`. After a long gap
(tab suspended) emit only the newest `segment` (and `complete` if reached); never a burst of stale
countdowns.

## js/cues.js and js/wakelock.js (CUES)

```js
export function createCues({ audio = true, vibration = true } = {})
  // -> { unlock(), handle(event), setAudio(on), setVibration(on), audio, vibration,
  //      vibrationSupported, speak(text), stop() }
export function createWakeLock() // -> { acquire(), release(), supported, active, onChange(fn) }
```

`unlock()` must be called synchronously inside the Start (and Resume) tap handler: it resumes the
WebAudio context and primes `speechSynthesis` (required on iOS Safari). `handle(event)` turns
session events into speech + short WebAudio tones + vibration patterns (distinct for work,
transition, pause, completion). On `halfway`, if the active version (default or alt) has
`switchSides` (alt inherits the movement's flag unless it sets its own), say "Switch sides".
Spoken text uses `move.say ?? move.name`, or the alternative's name
when `snapshot.alternatives[moveIndex]` is true. Audio and vibration are independent.

## js/pwa.js and js/install.js (PWA)

```js
export function initPWA({ onUpdateReady, onOfflineReady, onOfflineFailed } = {}) // registers ./sw.js
export function applyUpdate()          // tells the waiting worker to activate, then reloads once
export function offlineStatus()        // 'unsupported' | 'installing' | 'ready' | 'failed'
export function getInstallInfo()       // { platform: 'ios'|'android'|'desktop'|'other',
                                       //   standalone, canPrompt }
export function onInstallChange(fn)   // fires when canPrompt / standalone changes
export async function promptInstall()  // 'accepted' | 'dismissed' | 'unavailable'
```

The UI decides when to show the update prompt: never during an active workout.

## UI (js/app.js, js/ui/*, css/app.css, index.html)

Screens: home (motto, ready workout, Start / Preview / Shuffle, safety note, dismissible install
guidance), preview (all 12 in order with demo, name, cue, easier option, exact timing, sticky
Start + Shuffle), player (state label, movement name, demo, cue, circular countdown ring with
number, overall progress, next movement, easier-version switch, Pause/Resume, Skip, Audio,
Vibration, End), finish (complete, varied message, duration + movements reached, Done / Generate
another), end-confirm dialog, update toast.

### Visual language (Anthropic-inspired, warm and natural)

| Token | Light | Use |
| --- | --- | --- |
| `--ivory` | `#FAF9F5` | page background |
| `--paper` | `#F2EEE6` | cards, figure stage |
| `--sand` | `#E5DED2` | hairlines, borders |
| `--ink` | `#1F1A1C` | text |
| `--ink-soft` | `#5C5157` | secondary text |
| `--plum` | `#4A2340` | deep plum: brand, player background, figure body |
| `--plum-soft` | `#7A4A6B` | |
| `--clay` | `#D97757` | Claude orange: primary action, work state, focus parts |
| `--rust` | `#A3412B` | brownish red: emphasis, pressed states, final seconds |
| `--kraft` | `#D4A27F` | warm tan: prep state, details |
| `--sage` | `#7D8B5E` | transition / rest state |

Dark scheme (prefers-color-scheme: dark): background `#211A1E`, surfaces `#2C2328`, text
`#F4EFE8`, plum lifts to `#B98AAA` for text accents; orange and rust stay.

Type: serif display (`ui-serif, "New York", "Iowan Old Style", Georgia, serif`) for the wordmark,
headlines, movement names, and the countdown numerals; sans body (`ui-sans-serif, -apple-system,
system-ui, "Segoe UI", sans-serif`). Generous whitespace, 16-24px radii, hairline borders, no
heavy shadows, no gradients except a very subtle warm one on the player. Tabular numerals for time.
Touch targets at least 44 x 44. Respect safe-area insets (`viewport-fit=cover`). Portrait first,
320-1024px wide.

## Testing

- `npm test` runs `tests/*.test.mjs` with `node:test` (no dependencies).
- `npm run test:e2e` runs Playwright tests against `tools/serve.mjs` at `/hisability/`.
- Static audit test greps `js/`, `index.html`, `sw.js` for banned APIs (`Date`, `localStorage`,
  `sessionStorage`, `indexedDB`, `document.cookie`, `Notification`, `getDay`, emoji ranges).
