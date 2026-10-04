**PRODUCT REQUIREMENTS DOCUMENT**

# **His Ability**

*From each according to his ability*

A randomized, guided seven-minute bodyweight workout for busy days

| Product decision Ship a focused Progressive Web App that presents one balanced workout at a time. The user may preview it, shuffle it, start it, follow timed guidance, and finish. The app has no accounts, dates, schedule, streaks, history, or progress tracking. |
| :---- |

| Product | Release | Primary use | Deployment |
| :---- | :---- | :---- | :---- |
| His Ability | Minimum viable product | One short workout | GitHub Pages PWA |

**VERSION 1.1**

3 October 2026

# **1\. Product definition**

His Ability helps someone turn a small opening in a busy day into completed exercise. It removes the need to plan a routine, remember interval timing, search for technique guidance, or go to a gym. The experience is intentionally narrow: receive one workout, inspect or change it, follow it, and finish.

## **The product has one primary job**

*“I have a few minutes and want to exercise without planning a routine or going to the gym.”*

## **Three obstacles define the product**

1. **Deciding what to do.** The app generates a complete, balanced routine.  
2. **Knowing how to move.** Preview cards, demonstrations, concise cues, and easier alternatives reduce uncertainty.  
3. **Making the time count.** An exact timer, spoken guidance, and immediate start keep the session short and usable.

## **Success means a complete session with almost no setup**

* **Immediate workout:** A fresh launch displays one ready-to-use randomized routine.  
* **Optional control:** The user may preview the full sequence or shuffle it before starting.  
* **Follow-along clarity:** The movement, demonstration, remaining time, and next step are understandable at a glance.  
* **Eyes-free support:** Spoken and optional vibration cues reduce the need to watch the screen.  
* **Clean finish:** The completion screen encourages another future session without recording progress.

## **The release boundary is intentionally strict**

The minimum viable product has no account, subscription, remote service, calendar, weekday logic, notification schedule, streak, session history, completion count, difficulty rating, social feature, or health-platform integration. It stores no behavioral record. The only persistent storage required is the browser cache used to install the app and support offline operation.

# **2\. Product decisions and core journey**

## **A single active workout replaces routine browsing**

The home screen does not present a library or ask the user to choose a goal. It immediately creates one balanced workout from the approved movement pool. The user decides only whether to accept it, inspect it, or shuffle it.

| Stage | User action | System response |
| :---- | :---- | :---- |
| Generate | Open app | Create one balanced workout |
| Preview | Inspect sequence | Show all moves and options |
| Shuffle | Request another | Replace full sequence |
| Start | Begin workout | Run prep countdown |
| Follow | Move with cues | Demonstrate and time |
| Finish | Complete session | Encourage, then stop |

## **The shortest path is one tap after launch**

**OPEN  →  START  →  MOVE  →  FINISH**

Preview and Shuffle are available before Start but never required. The active workout stays unchanged while the user previews it and throughout the workout. Shuffling replaces the entire sequence, not individual exercises.

## **Daily novelty does not require calendar awareness**

| Interpretation of “one new workout per day” Each fresh app launch generates one new workout for that use. The app does not read, calculate, display, or store the date, and it does not attempt to enforce one workout per calendar day. The phrase describes the intended daily habit, not a calendar-controlled product rule. |
| :---- |

**Requirement 1**  On each fresh app launch, the home screen shall generate and display one complete randomized workout.  **\[Must\]**

**Requirement 2**  The generated workout shall remain stable until the user selects Shuffle or reloads the app.  **\[Must\]**

**Requirement 3**  The app shall not read, display, calculate, infer, or store a date, weekday, schedule, or time-of-day value.  **\[Must\]**

**Requirement 4**  The app shall not claim that a workout is unique for a specific calendar date.  **\[Must\]**

# **3\. Random workout model**

## **Randomness is constrained by balance and safe sequencing**

Random does not mean arbitrary. The generator selects from an approved, versioned movement catalog and applies explicit composition rules before presenting a workout. If a random draw violates a rule, the generator redraws until the sequence is valid.

**Requirement 5**  Each workout shall contain 12 distinct movements with no duplicate movement in the same sequence.  **\[Must\]**

**Requirement 6**  Each workout shall include three lower-body movements, three upper-body movements, three core movements, and three cardio or full-body movements.  **\[Must\]**

**Requirement 7**  The generator shall avoid adjacent movements that load the same primary region or repeat the same movement pattern.  **\[Must\]**

**Requirement 8**  The generator shall avoid placing two high-impact movements next to each other.  **\[Must\]**

**Requirement 9**  Every selected movement shall have a no-equipment default and a lower-impact alternative.  **\[Must\]**

**Requirement 10**  A wall may be used; a stable chair may appear only in an optional modification and shall never be required by the generated default.  **\[Must\]**

**Requirement 11**  Shuffle shall produce a newly generated valid sequence and shall never alter timer rules.  **\[Must\]**

**Requirement 12**  If the newly generated sequence exactly matches the one currently displayed, the app shall redraw before showing it.  **\[Must\]**

## **The movement catalog is content data**

Each movement record shall include a stable identifier, name, category, impact level, primary movement pattern, demonstration asset, accessibility description, setup cue, action cue, common mistake, lower-impact alternative, and contraindication note where appropriate. Keeping the catalog separate from the player makes the generator testable and allows new exercises without changing timer logic.

| Category | Example movements | Sequence purpose |
| :---- | :---- | :---- |
| Lower body | Squat, lunge, bridge | Leg and hip work |
| Upper body | Push-up, shoulder tap | Push and stability |
| Core | Plank, dead bug | Trunk control |
| Cardio / full body | Jacks, march, skater | Raise effort |

## **Preview explains the complete commitment**

**Requirement 13**  Preview shall show all 12 movements in workout order before the user starts.  **\[Must\]**

**Requirement 14**  Each preview item shall show the movement name, demonstration, primary form cue, and lower-impact alternative.  **\[Must\]**

**Requirement 15**  Preview shall show the exact total duration and explain the work and transition timing.  **\[Must\]**

**Requirement 16**  Start and Shuffle shall remain visible and easy to reach from the preview screen.  **\[Must\]**

# **4\. Workout timing and guided player**

## **The default promise is exactly seven minutes**

| Default timing 10-second preparation \+ 12 movements at 25 seconds each \+ 11 transitions at 10 seconds each \= 7 minutes exactly. There is no transition after the final movement. |
| :---- |

The interval structure is fixed for the minimum viable product. Randomization changes only the selected movements and their valid order. The interface must show the true total duration before the workout begins.

**Requirement 17**  The player shall show the movement name, looping demonstration, one concise form cue, interval countdown, overall progress, and next movement.  **\[Must\]**

**Requirement 18**  The player shall provide spoken cues at preparation, work start, the final three seconds, transition, movement change, pause, resume, and completion.  **\[Must\]**

**Requirement 19**  Where supported, distinct vibration cues shall mark work, transition, pause, and completion.  **\[Should\]**

**Requirement 20**  The player shall expose Pause, Resume, Skip, Audio, Vibration, and End without opening another screen.  **\[Must\]**

**Requirement 21**  The timer shall reconcile against elapsed timestamps so delayed browser callbacks do not accumulate drift.  **\[Must\]**

**Requirement 22**  The display shall remain awake during an active workout when the browser permits, with a graceful fallback when it does not.  **\[Should\]**

**Requirement 23**  The user shall be able to switch to the lower-impact alternative before or during an interval without stopping the timer.  **\[Must\]**

**Requirement 24**  Reduced-motion mode shall replace animated demonstrations with key poses or step illustrations.  **\[Must\]**

## **Interruptions preserve the active experience, not a record**

* **Pause:** Freeze the interval and announce that the workout is paused.  
* **Resume:** Restart with a three-second countdown so movement does not resume unexpectedly.  
* **Skip:** Advance to the next movement without recording the skipped interval.  
* **End:** Confirm the choice, return home, and discard the session state.  
* **App switch:** Use in-memory timestamps to reconcile elapsed time while the page remains open.  
* **Closed app:** Do not restore, count, or save the interrupted workout after a fresh launch.

# **5\. Completion feedback without tracking**

## **The finish screen celebrates only the session that just happened**

Completion feedback confirms that the seven-minute session ended and provides a brief, varied message that encourages the user to return another time. It is not a progress dashboard and does not compare the session with earlier activity.

**Requirement 25**  At completion, the app shall show the workout is finished and summarize only the current session duration and intervals reached.  **\[Must\]**

**Requirement 26**  The completion message shall avoid weight, calorie, body-shape, guilt, competition, punishment, streak, and missed-day language.  **\[Must\]**

**Requirement 27**  The completion screen shall offer Done and Generate another workout, with neither option writing a behavioral record.  **\[Must\]**

**Requirement 28**  The app shall not store or display completed sessions, total minutes, weekly counts, ratings, bests, streaks, badges, dates, or scheduled days.  **\[Must\]**

**Requirement 29**  Reloading or reopening the app shall reveal no evidence of earlier exercise behavior.  **\[Must\]**

## **Repeatability comes from low friction and novelty**

His Ability supports a repeatable habit through fast access, short duration, varied routines, and a useful home-screen installation. Any Monday, Wednesday, and Friday reminder belongs outside the app. The app itself has no awareness of that cadence.

# **6\. Progressive Web App and GitHub Pages deployment**

## **The app ships as static files**

| Deployment model Installable Progressive Web App, static files only: HTML, Cascading Style Sheets, JavaScript, web app manifest, service worker, movement data, demonstration assets, and icons. There is no application server, database, account system, secret configuration, or runtime build service. |
| :---- |

**Requirement 30**  The complete app shall run from a GitHub repository with GitHub Pages enabled.  **\[Must\]**

**Requirement 31**  A release shall require only committing and pushing static files to the configured Pages source branch or folder.  **\[Must\]**

**Requirement 32**  All asset paths, service-worker scope, manifest paths, and navigation fallbacks shall work from a GitHub project-site subpath.  **\[Must\]**

**Requirement 33**  The repository shall include concise local-preview, deployment, cache-update, and rollback instructions.  **\[Must\]**

**Requirement 34**  No credentials, personal data, or environment-specific secrets shall be committed.  **\[Must\]**

## **The manifest and service worker create the app-like experience**

**Requirement 35**  The web app manifest shall define the name His Ability, a usable short name, stable identifier, start URL, scope, standalone display, portrait-primary orientation, and theme and background colors.  **\[Must\]**

**Requirement 36**  The installed app shall use the motto “From each according to his ability” on its home screen or opening view.  **\[Must\]**

**Requirement 37**  The app shall include 192-pixel and 512-pixel icons plus maskable variants with safe-zone artwork.  **\[Must\]**

**Requirement 38**  The service worker shall precache the app shell, approved movement catalog, icons, and all media required to generate and complete any launch workout.  **\[Must\]**

**Requirement 39**  After the first successful online load, the installed app shall launch, generate, preview, shuffle, and complete a workout with no connection.  **\[Must\]**

**Requirement 40**  Static assets shall use a cache-first strategy, page navigation shall fall back to the cached entry page, and each release shall remove obsolete versioned caches.  **\[Must\]**

**Requirement 41**  A ready update shall offer a clear refresh action and shall not interrupt an active workout.  **\[Must\]**

**Requirement 42**  If first-load caching fails, the app shall remain usable online and explain that offline use is not ready.  **\[Must\]**

| Platform | Install path | Required guidance |
| :---- | :---- | :---- |
| iPhone / iPad | Safari Share menu | Add to Home Screen steps |
| Android | Install prompt | Button plus menu fallback |
| Desktop | Browser install | Optional and unobtrusive |

**Requirement 43**  On iOS, the app shall show concise Safari-specific Add to Home Screen guidance and shall not promise a native install prompt.  **\[Must\]**

**Requirement 44**  On supported Android browsers, a user-initiated Install action shall use the captured install prompt, with browser-menu guidance as fallback.  **\[Must\]**

**Requirement 45**  Install guidance shall be dismissible and shall never block Start, Preview, or Shuffle.  **\[Must\]**

# **7\. Accessibility, safety, privacy, and quality**

## **The interface remains usable under exertion**

**Requirement 46**  Body text shall meet Web Content Accessibility Guidelines level AA contrast and the timer shall remain readable in bright light.  **\[Must\]**

**Requirement 47**  Interactive controls shall have a minimum target size of 44 by 44 CSS pixels with visible focus states.  **\[Must\]**

**Requirement 48**  Semantic headings, buttons, status announcements, and meaningful demonstration descriptions shall support screen readers.  **\[Must\]**

**Requirement 49**  Color shall never be the only signal for work, transition, completion, or error states.  **\[Must\]**

**Requirement 50**  Audio and vibration shall be independently controllable, and the workout shall remain fully usable with both disabled.  **\[Must\]**

## **Safety guidance is visible but not obstructive**

* **Before the first workout:** Advise the user to use a clear, non-slip space and a stable wall if needed.  
* **During effort:** Keep End visible and never require completion of a painful movement.  
* **Language:** Use “stop if you feel pain, dizziness, or unusual shortness of breath,” not diagnostic or treatment claims.  
* **Scope:** The app provides general exercise guidance and does not replace individualized medical advice.

## **Zero tracking is a product requirement**

**Requirement 51**  The app shall not use local storage, IndexedDB, cookies, remote storage, or analytics to record exercise behavior.  **\[Must\]**

**Requirement 52**  The app shall not request identity, age, body measurements, location, calendar access, notification access, or health data.  **\[Must\]**

**Requirement 53**  The app shall include no advertising trackers, third-party analytics, telemetry, crash-reporting service, or remote profile.  **\[Must\]**

**Requirement 54**  Session-only state may exist in memory while the page remains open and shall be discarded on reload or close.  **\[Must\]**

## **Performance and resilience protect the workout**

| Quality | Launch requirement |
| :---- | :---- |
| First load | Useful screen within 2 seconds |
| Return load | Useful screen within 1 second |
| Timer | Less than 1 second drift |
| Viewport | 320 to 1024 CSS pixels |
| Orientation | Portrait optimized |
| Browsers | Current Safari and Chrome |
| Network loss | No active-session failure |

# **8\. Release acceptance criteria**

## **The minimum viable product is ready when every critical path passes**

1. **Immediate generation:** A fresh launch displays one valid 12-movement workout without asking for a goal, date, or profile.  
2. **Stable selection:** Previewing does not change the generated sequence.  
3. **Effective shuffle:** Shuffle replaces the full sequence with a different valid sequence and leaves timing unchanged.  
4. **Balanced composition:** Automated tests generate at least 10,000 workouts with correct category counts, no duplicates, and no invalid adjacency.  
5. **Exact duration:** The workout completes exactly 7 minutes after the preparation countdown begins.  
6. **Complete preview:** All 12 movements, demonstrations, cues, and lower-impact alternatives appear before Start.  
7. **Complete guidance:** Every interval shows a movement, demonstration, cue, countdown, next movement, and overall progress.  
8. **Reliable controls:** Pause, Resume, Skip, Audio, Vibration, End, and lower-impact switching behave correctly in every interval state.  
9. **No tracking:** Closing and reopening reveals no history, dates, streaks, counts, ratings, or prior workout.  
10. **No date access:** Static and runtime audits find no calendar, weekday, date, or notification logic.  
11. **Offline workout:** After one online load, airplane mode permits launch, generation, preview, shuffle, and completion.  
12. **Install on iOS:** Safari guidance leads to a home-screen icon that opens in standalone mode.  
13. **Install on Android:** The install action or documented menu fallback produces a standalone app.  
14. **Safe update:** A newly deployed service worker does not replace assets during an active workout and offers refresh afterward.  
15. **Accessible operation:** A keyboard and screen reader can preview, shuffle, start, control, and finish; reduced motion removes nonessential animation.  
16. **GitHub Pages:** A clean clone deploys by enabling Pages and pushing static files, with no application server or secret configuration.

## **Required device matrix**

| Environment | Required checks |
| :---- | :---- |
| iPhone Safari | Install guidance, audio, offline |
| iPhone installed | Standalone, resume, shuffle |
| Android Chrome | Prompt, vibration, offline |
| Android installed | Standalone, updates |
| Desktop browser | Keyboard, responsive layout |

# **9\. Explicitly out of scope**

The following capabilities are outside the minimum viable product because they conflict with the chosen zero-tracking, no-calendar, single-workout experience or the static deployment model.

* **Habit tracking:** No streaks, histories, totals, calendars, weekly summaries, achievements, or badges.  
* **Schedule awareness:** No days of the week, dates, reminders, notifications, or Add to Calendar flow.  
* **Profiles and sync:** No sign-in, identity, cloud data, cross-device state, or health-platform integration.  
* **Goal selection:** No weight-loss, strength, fitness-goal, or program-selection onboarding.  
* **Routine library:** No catalog browsing, favorites, saved routines, or named programs.  
* **Personalization engine:** No automated progression, difficulty rating, medical personalization, or generated coaching.  
* **Social and commerce:** No leaderboards, sharing feed, challenges, subscriptions, payments, or advertising.

# **10\. Product references and decision log**

Seven remains the experience reference for short bodyweight sessions, guided intervals, movement instruction, and low-equipment exercise. His Ability deliberately rejects its tracking and program mechanics in favor of one randomized workout at a time.

1. **Seven, official product website.** [seven.app](https://seven.app/?source=trendsvc&)  
2. **Seven, Google Play listing.** [Google Play](https://play.google.com/store/apps/details?id=se.perigee.android.seven&hl=en_ZA)

## **Decision log**

| Decision | Reason |
| :---- | :---- |
| Name: His Ability | Personal, memorable identity |
| Exact seven minutes | Promise matches elapsed time |
| One workout on launch | No routine planning |
| Constrained shuffle | Variety with balance |
| No dates or schedule | Requested app simplicity |
| No behavioral storage | No tracking of any kind |
| Static GitHub Pages | Simple PWA deployment |
| Offline after first load | Usable wherever time opens |

# **11\. Summary of Technical Requirements for Coding Agent**

This section provides a consolidated summary of the technical specifications and constraints for implementation by an automated coding agent.

## **Architecture & Stack**

1. **Static PWA:** Pure client-side application (HTML, CSS, JS) served as static files via GitHub Pages from a subpath repository structure.

2. **No Backend:** No server runtime, APIs, database, analytics, or third-party SDK dependencies.

3. **Offline Capabilities:** Service worker precaching static assets, movement metadata, and media so the full experience operates offline after initial load.

## **State & Data Management**

4. **Zero Storage:** Do not use localStorage, IndexedDB, cookies, or remote endpoints for user history, statistics, streaks, dates, or accounts.

5. **In-Memory Session:** Active session state resides entirely in memory and is cleared upon page reload or close.

## **Workout Generation Engine**

6. **Composition:** 12 unique movements per workout (3 lower body, 3 upper body, 3 core, 3 cardio/full body) without identical consecutive category loads or high-impact adjacencies.

7. **Deterministic Timing:** 10s prep \+ (12 × 25s work) \+ (11 × 10s rest) \= 7 minutes total. Timers reconcile against elapsed system timestamps to avoid drift.

## **UI & Visual Design Requirements**

8. **No Emojis:** The user interface must strictly avoid using emojis for icons, cues, or UI decorative elements.

9. **Guided Human-Like Animations:** Demonstrations must use clean, guided human-like vector or model animations for clear exercise technique visibility.

**Circular Interval Countdown:** Each active interval must display a circular countdown progress graphic surrounding or accompanying the numerical timer.