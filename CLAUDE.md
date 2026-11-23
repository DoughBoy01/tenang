# Tenang: project context for Claude Code

Tenang ("calm" in Malay/Indonesian) is a mobile-first web app that helps people with high blood pressure using natural methods: breathing exercises, nervous-system resets, daily rituals, a readings log and plain-English education. It was designed and built in a long Claude chat session; this file carries that context forward.

Owner: Stephen (GitHub `DoughBoy01`, Asia/Kuala_Lumpur). Repo: https://github.com/DoughBoy01/tenang

## Ground rules (read first)

- **Information only, not medical advice.** The Medicines guide ("Pharmacist 101") and all copy must stay qualified, general and cautious. Never tell a user to start, stop or change a medicine; point to their doctor/pharmacist. Keep the crisis/urgent-reading guidance (very high readings, symptoms, call emergency services) intact.
- **No build step, no framework.** The whole app is one file: `index.html` (about 177 KB, plain HTML + CSS + vanilla JS). Keep it that way unless the owner asks otherwise.
- **Mobile first.** Design and test at 390x844. No horizontal scroll, safe-area insets respected, thumb-reachable controls.
- **Slim, calm UI.** The owner explicitly said buttons looked "bloated or fat". Keep buttons and CTAs slim, quiet and refined.
- **A visual that says "tap to begin" must itself start the action.** Never make the user find a separate button (for example the breathing stage calls `#startBtn.click()`).
- Respect `prefers-reduced-motion` (`reduceMotion` flag in JS, media query in CSS).
- Ask before large scope changes; the owner reacts well to a short recommendation list and answers "Yes" or "What next".

## Files

| File | Purpose |
|---|---|
| `index.html` | The app. **Source of truth.** Edit this. |
| `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `_headers` | PWA assets (and Cloudflare Pages headers) |
| `sw.js` | Service worker source (offline app shell, font cache). Build swaps its `__VERSION__` placeholder for a content hash; keep that token only on the `VERSION` line. |
| `vendor/three.min.js` | Three.js r128 (MIT), served locally so the 3D guide works offline |
| `push-server.js` | Web Push backend: subscription API (`/api/push/*`), per-minute cron sender, VAPID signing, RFC 8291 encryption. Inlined into `worker.js` by the build (its `export`s are stripped) |
| `migrations/` | D1 schema (`0001_push.sql` subscriptions, `0002_actions.sql` snooze + done-today); always apply remotely BEFORE deploying code that needs it (apply with `npx wrangler d1 migrations apply tenang-push --remote`) |
| `wrangler.jsonc` | Worker config: D1 binding `DB`, cron `* * * * *`, `VAPID_PUBLIC` var |
| `scripts/test-push.mjs` | Tests push crypto (independent decrypt), VAPID signature, validation, API, snooze/done and cron against real SQLite running `migrations/*.sql` |
| `scripts/test-profiles.mjs` | **Content-safety tests** for the tailored guidance (runs the `@profiles` block): every section sourced, no stop/switch/start-a-medicine advice, medicine/hormone/contraception topics hand off to a professional, breathing never presented as a hot-flush treatment, no sex-specific BP targets, pregnancy is a hand-off, no cross-over between the sexes' content |
| `scripts/test-profile-ui.mjs` | Profile chooser, what appears where for female (peri) / male / pregnancy / not tailored, persistence, backup, small phone + dark mode |
| `scripts/test-breathe.mjs` | Breathe tab layout and behaviour: patterns, stone, Begin, duration and rhythm info all above the tab bar at 430x932 / 390x844 / 360x740 (patterns, stone, Begin at 360x640 and 320x568), page <= 1.5 screens, folded options/diagram still work |
| `scripts/test-journey.mjs` | The simplified journey: four tabs and highlights, Today length budget (<=1.7 screens, <=8 blocks), nothing educational on Today, Today's focus, one way to log, Learn contents, 360px + dark overflow |
| `scripts/test-firstrun.mjs` | First-run sheet: new users only, times -> reminders, Skip/Escape, never shown to existing users, shortcuts bypass it, iPhone wording |
| `scripts/test-daychecks.mjs` | Regression tests for daily checks: rituals/path/Today steps persist, follow midnight while the app is open, credit the right scheduled step, and a failed save is never silent |
| `scripts/test-insights.mjs` | Runs the `@insights` block (pure insight + weekly-review engine) on synthetic data: thresholds, honest wording both ways, sample sizes, review window, and a sweep proving no sentence gives advice or medical claims |
| `scripts/test-phase2.mjs` | Playwright: context tags, patterns panels, weekly review (Fri/Sun/Mon/Tue), shortcuts, icon badge; `shots/phase2-*.png` |
| `scripts/test-data-safety.mjs` | Runs the `@data-safety` block of `index.html` against a fake localStorage: snapshot, rollback, full disk, newer data, quarantine, expiry |
| `scripts/test-update.mjs` | End-to-end upgrade journey across real generated Workers (A -> B migrating -> C crashing -> older A): banner, no data loss, rollback, backup restore + undo, cache cleanup |
| `scripts/test-sw.mjs` | Runs `sw.js` in a sandbox: push display, Done / In 1 hour buttons, click routing |
| `scripts/test-companion.mjs` | Playwright tests (fake clock, Asia/Kuala_Lumpur) for the Today card, rhythm, ring, quick-log sheet, pending notification actions; writes `shots/companion-*.png` — look at them |
| `worker.js` | **Generated.** Single-file Cloudflare Worker with the HTML, manifest, icons, `sw.js` and Three.js embedded. Do not hand-edit. |
| `scripts/build-worker.mjs` | Regenerates `worker.js` from the files above |
| `scripts/smoke.mjs` | Playwright mobile smoke test (all views, light and dark, page errors, horizontal overflow). Needs `npm i -D playwright` |

Workflow after any change to `index.html`, `sw.js`, `push-server.js` or the PWA files: `node scripts/build-worker.mjs`, run `node scripts/smoke.mjs`, `test-companion`, `test-phase2`, `test-daychecks`, `test-journey`, `test-breathe`, `test-firstrun`, `test-profiles`, `test-profile-ui`, `test-insights`, `test-push`, `test-sw`, `test-data-safety` and `test-update` (all in `scripts/`), commit the source files and `worker.js`, then deploy.

## Deploy

- Live site: https://tenang.stephenaris.co.uk (Cloudflare Workers custom domain, declared in `wrangler.jsonc` `routes` with `custom_domain: true`; the zone `stephenaris.co.uk` is in the same account). The older test address https://tenang.pm2120600.workers.dev (`workers_dev: true`) still serves the same Worker, but its `localStorage` and push subscriptions are separate (see Updating without losing user data, point 6). Account has many other Workers; this one is named `tenang`.
- Deploy: `npx wrangler deploy` (config in `wrangler.jsonc`). `cf deploy` does not suit this single-file Worker.
- Push resources (Cloudflare account `tenang` Worker): D1 database `tenang-push`, secret `VAPID_PRIVATE_JWK` (never commit; if lost, generate a new key pair, update `VAPID_PUBLIC` in `wrangler.jsonc`, and the app resubscribes phones automatically on next open), cron trigger every minute.
- Do not use `tenang.pages.dev`: that address is owned by someone else (it served an unrelated spam site).
- The live site may lag the repo; redeploy after pulling.
- A Claude-hosted copy also exists as a Claude artifact (https://claude.ai/artifact/Np8XXjU3Deyg6DwJk1EFRu). It differs only by two header tags (`<meta name="claude:viewport-fit-sides" content="cover">`) and no manifest link. It is not part of this repo's workflow. In the app, `APP_URL` uses the origin on `*.workers.dev`, `*.pages.dev` and `tenang.stephenaris.co.uk`, and falls back to the artifact URL elsewhere. Add any new domain to that regex.

## Updating without losing user data (read before changing anything that is stored)

Users' data lives only in their `localStorage` (`tenang:*`) and survives every deploy. Keep it that way:

1. **Stored data is append-only.** Add fields, never rename, repurpose or delete them. Read tolerantly (missing field = default). An old app version and a new one must be able to read each other's data.
2. **A format change that cannot be additive needs a migration** in `MIGRATIONS` (inside the `@data-safety` block of `index.html`; versions ascending, `up(st)` gets `get/set/del` for unprefixed keys). The runner snapshots everything to `tenang:snapshot` first, rolls back automatically if `up` throws, skips if the snapshot cannot be saved (disk full), never touches data from a newer version and never lowers the version. The snapshot is kept 30 days as a recovery copy. Add a case to `test-update.mjs` or `test-data-safety.mjs` for every migration, with old-format data.
3. **Wrongly shaped values** for `readings`, `rem`, `path`, `mins` are moved to `tenang:quarantine:*` (raw text kept) instead of crashing the app or being dropped.
4. **Backup restore** takes a snapshot first (user-visible Undo in Settings, 30 days) and refuses backups from a newer schema. The snapshot itself is never exported.
5. **Staying current:** the build stamps a release id into the page (`const BUILD='__BUILD__'`, replaced only by `scripts/build-worker.mjs`; never write that token anywhere else in `index.html`) and serves `/version`. The page checks on foreground/every 15 min and shows a "new version is ready" banner (never while a session, timer or reading entry is open; never auto-reloads). Refresh activates the waiting service worker, then reloads.
6. **Data belongs to the exact origin.** `tenang.pm2120600.workers.dev` and `tenang.stephenaris.co.uk` are different origins: data saved on one is invisible on the other, and push notifications must be turned on again. Treat `tenang.stephenaris.co.uk` as the permanent address, move people with Save/Restore backup, and do not remove the workers.dev address until they have moved. Any further move (or a Capacitor app) has the same problem.

## Tailored guidance for women and men (branch `feature/sex-specific-guidance`)

Research and the claim limits live in `docs/research/sex-specific-bp.md`; read it before editing any tailored text. In short:

- **Set once, at first run, then visible every day.** First run is now two short steps: (1) "Who is Tenang for?" (Female / Male / Prefer not to say, plus life stage for Female), (2) check-in times and reminders. The profile is saved the moment someone taps Next, so skipping step 2 never loses it. Today then shows a **"For you" card** (`#youToday`) with one sourced tip a day (`profileTip`: deterministic per day, rotates), tapping it opens the guide. Existing users and anyone who skipped get a prominent "Make Tenang fit you" invite (`#tailorPrompt`) directly under the Today card until they choose or dismiss it. Exactly one of the two cards is ever shown, so Today's block budget is unchanged.
- **It is an optional profile, not two apps.** `tenang:profile` = `{sex:'female'|'male'|'general', stage?:'regular'|'peri'|'post'|'preg'|'none', at}` (additive, in backups). Chosen in Settings ("Tailor Tenang"), the Learn card, or a dismissible Today prompt (from the 2nd visit). "Not tailored" is always available and every guide stays reachable. First run is unchanged (two choices).
- **All content comes from the pure `@profiles` block** (`profileGuide(profile)` -> title, intro, sourced sections, doctor questions, extra tags, measuring tip, Medicines note, flags). The UI only renders it: the "For you" view (`#you`, under Learn), "Hot flush"/"Alcohol" notes on readings, a "Hot flush" mood for perimenopause / after menopause / unspecified, a Log tip, a Medicines 101 note, and suggested questions in the doctor summary (also in the copied text).
- **Hard rules (enforced by `test-profiles.mjs`):** no sex-specific BP thresholds or targets (the only number is the pregnancy hand-off, 140/90); never imply breathing treats hot flushes (NAMS 2023: not recommended); never tell anyone to stop, switch or start a medicine, hormone, contraceptive or testosterone: say "do not stop, ask your doctor or pharmacist"; every medicine/hormone/contraception topic names a professional; pregnancy is a hand-off to the care team with no categories or coaching (the quick-log result shows "Share with your care team"); men's and women's content never cross over; show population facts with their source, never personal risk percentages.
- **Every new tailored sentence needs a source id in `PSRC` and a row in the research brief.** This includes the daily tips (`PTIP`), which `test-profiles` holds to the same rules (sourced, short, professional named where medicines/contraception/pregnancy are involved, 140/90 only in the pregnancy tip, no cross-over). Wording changes need clinician review before public launch (see section 4 of the brief).

## Keep the daily journey simple (read before adding anything to Today)

The product is a daily companion: **open, do the one next thing, close.** Rules that `test-journey.mjs` enforces or that reviewers should:

1. **Today stays short** (about one and a half screens): the Today card (steps, ring, rhythm), Today's focus (only path tasks the steps do not already cover), the mood check-in, one insight, a collapsed Daily habits list, the season line. Anything educational, promotional or "browse and explore" belongs in **Learn**, never on Today.
2. **One checklist per idea, no duplicates:** breathing and readings are the Today steps; the path's breathing tasks and the day-1 baseline tick themselves from them; habits are the optional collapsed list.
3. **One way to log a reading:** the quick-log sheet (`openQLog`), reached from Today, the Log tab button, the timer, and the `#qlog` shortcut. Do not reintroduce a second form.
4. **First run is a welcome plus two short steps** (a quiet welcome explaining the name and the East Asian design motifs, with one Continue button; who Tenang is for; then check-in times and reminders) and only for people with no data; skipping is always possible. Do not add more steps to it. Welcome copy stays factual (Tenang = calm in Malay/Indonesian; Japanese dry-garden stone and sand, ensō, the 24 solar terms, 呼吸) and says these are design inspirations, not a religious practice.
5. **Breathe: the first screen is the whole job.** Pattern cards (single-line), the stone (height `clamp(190px,29vh,250px)`), Begin + duration and the rhythm info (name, best-for, timing bar, description) must sit above the tab bar on a 390x844 phone; the page stays about 1.4 screens. Secondary things are folded `<details class="fold">` rows with a live summary: "Sound and measuring" (`#opts`, `optsSum()`) and "How this rhythm moves" (`#diaFold`). The `#pp` before-reading panel stays outside the fold because Begin opens it. `test-breathe.mjs` enforces the geometry; do not add blocks above the stone.
6. New features need a home in this structure first; if a new thing wants a fifth tab or a new block on Today, that is a design discussion, not a code change.

## Design language

Inspired by Japanese, Korean and Balinese Buddhist aesthetics: quiet, spacious, paper-and-ink, moss green, indigo and saffron accents, generous whitespace, soft shapes, gentle motion.

- Fonts (Google Fonts): Shippori Mincho (display), Zen Kaku Gothic New (body), IBM Plex Mono (numbers/data).
- CSS tokens on `:root`: `--paper --surface --sunk --ink --moss --indigo --saffron`, semantic `--ok --warn --high --crisis`, `--hero`. Dark theme via `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` and `:root[data-theme="dark"]`. Always use tokens, never hard-coded colours.
- Seasonal themes: 24 Japanese sekki (solar terms) set `data-season` on the root, each with light and dark palettes; the user can follow the date or pick one.
- Motion: spring/ease CSS variables, `replay()`, `countUp()`, ripple on pointerdown, `pebble()` micro-interactions.
- Mobile patterns used throughout: scroll-snap carousels (`.snap` + `.dotsnav` + `initSnap`), swipe between the 4 main tabs, swipe-to-delete with Undo toast, drag-down sheets, filter chips.

## Architecture (in `index.html`)

- Hash router over views `home, breathe, reset, log, learn, summary, meds, numbers` (`route()`). **Four tabs: Today (`#home`), Breathe, Log, Learn.** Nav highlight: reset -> Breathe, summary -> Log, numbers/meds -> Learn. `#rituals` is a retired route that redirects to Today with the habits list opened; `#qlog` / `#calmnow` are shortcut routes.
- State in `localStorage` via `store.get/set` (keys prefixed `tenang:`, always try/catch): readings, rituals, 30-day path, reminders, sound, season, notes, minutes.
- **Breathing engine:** `PATTERNS` (phases `[label, secs, kind]`), `levels()`, `ease()`, `lungPoint()`, a `requestAnimationFrame` loop, WebAudio tones plus SpeechSynthesis for "Eyes closed" mode, Wake Lock to keep the screen on. Techniques: Resonance, Long exhale, Physiological sigh, Bee breath, Box breathing and 4-7-8, each with animated diagrams and timers.
- **Features:** 30-day path, before/after readings, mood check-in leading to a "calm now" sequence, rituals, reminders with auto-complete (`markRem`), doctor-ready summary (`renderSummary`, `buildSumText`, `copyText`), Medicines guide, shareable card/sheet with a "who could this help" reason, timers sheet (`#tmr`), settings sheet (`#sheet`).
- **Top and bottom numbers guide (`#v-numbers`):** animated 3D explanation (Three.js r128 loaded on demand from cdnjs, `bp3Load/bp3Init/bpRender`): a pumping heart, a cut-open artery with blood cells, and a vertical gauge with "top 120 / bottom 80" marks. Modes Watch/Squeeze/Rest, speeds Slow/Real, presets (including a high 160/100 reading), number cards carousel, quick quiz. If WebGL or the script fails, a 2D SVG fallback (`#bp2d`) with the same gauge shows. The owner found an earlier 2D wave graph "confusing", so keep it simple: one caption, one gauge.
- CSP-style constraint carried over from the artifact host: external scripts only from cdnjs, CSS only from Google Fonts. Keep everything else inline. Three.js now comes from `/vendor/three.min.js`.
- **Companion loop (Today card, top of Home):** `renderToday()` (called from `renderNext()`, every 30s, on minutes logged, on return to foreground) builds an adaptive card from the enabled reminders (or a default 4-step loop if none): the earliest *due* step is the focus (`STEP` copy table: headline, one-line guidance, button); nothing due shows "Next up"; all done shows "That's today done" with minutes + last reading; 3+ days away shows "Welcome back. No catching up needed." Steps >4h late become "skipped" (still tappable, excluded from the progress ring). **Rhythm, not streaks**: `rhythm()` forgives one missed day, two in a row end the run, today never counts against you; the copy never scolds. Reading steps open the quick-log sheet instead of the Log page.
- **Quick log (`#qlog`, `openQLog`/`qlSave`):** big steppers with press-and-hold, prefilled from the last real reading (never prefilled with defaults for a new user), auto context by time of day, validated; result shows category, comparison with the average of the previous 7 readings, a sparkline and a calm next step. Severe readings show the urgent guidance. The timer's "Log your reading" button opens it too. Copy must stay information-only.
- **Patterns (phase 2):** the `@insights` block (`computeInsights`) turns the user's own readings into at most 3 plain statements: week vs week trend, lowest recent reading, days with vs without breathing (>=3 min), notable tags (>=5 difference, 3 vs 3 readings), mornings vs evenings, logging consistency. Minimum sample sizes everywhere; both directions are reported honestly; wording is observational only (never "should", never medicines or doses: `test-insights` fails the build if it is). Shown as "What I'm noticing" on Home (top one) and "Your patterns" on Log (up to 3, with a not-medical-advice note). **Context tags** (`g` on a reading: sleep, salt, stress, move, coffee; ids in `INS_TAGS`) are optional chips in the quick-log sheet only (not yet on the Log page form); `g` is an additive field so no migration was needed.
- **Weekly review:** `weekTarget`/`computeWeek` (pure). Sunday offers the week ending that day (Mon-Sun), Monday the week that just ended, other days nothing. Card on Home -> sheet (day dots, days, minutes, readings, average, change vs previous week, lowest, 30-day-path note). Headlines never scold ("A quiet week. Starting again is easy."). Seen state: `tenang:wk:<Monday date>`. No push notification for it yet (the push schema is per-day reminders).
- **Shortcuts and badge:** manifest `shortcuts` (Log a reading `/#qlog`, Breathe now `/#breathe`, Calm me now `/#calmnow`); `route()` handles `#qlog` and `#calmnow`, then rewrites the hash to `#home`. App icon badge = number of steps due now (`renderToday`), set to 1 by the service worker on a push, cleared when nothing is due. Badging needs an installed app (iOS also needs notification permission).
- **"Today" must follow the day:** a phone can keep the app open or frozen across midnight. `checkDay()` (page load, 30s timer, `visibilitychange`, `focus`, `pageshow`) re-renders header/greeting, rituals, 30-day path, minutes, season and Today when the date changes, and the ritual/path tick handlers call it first and refuse to write if the day just rolled over, so a tick can never land on a different day than the one on screen. Anything new that shows "today's" state must be refreshed from `checkDay()`. Element ids must be unique (`#today` is the header date; the Today card is `#todayCard`).
- **Which step does an action credit?** `pickStep(keys)`: the latest scheduled step that is already due and not done, else the next one (readings: `amBP`/`pmBP`; breathing: `amBr`/`pmBr`, or `bed` for 4-7-8). Never use a fixed hour cut-off. Tapping Start on a breathing step does not tick it; a session ticks it when it finishes or after 3+ minutes.
- **Saves are never silent:** `store.set` returns false and toasts once a minute when localStorage refuses a write (full or blocked).
- **Smarter reminders:** notification buttons "Done" / "In 1 hour" (Android/desktop only; iOS ignores action buttons). `markRem()` also tells the server (`pushDone`) so a reminder already done today is not sent (`rems.skip_until`, survives re-syncs because sync upserts). Snooze = one-off row (`once=1`, key `~`+k). "Done" from a closed app leaves a note in Cache `tenang-pending` that the app applies on open (`drainPending`).
- **Web Push** (end of `index.html` + `push-server.js` + `sw.js` handlers): Settings has Turn on/off notifications. The client sends the push subscription, UTC offset and enabled reminders (title, calm body text, route) to `/api/push/sync` on enable, on every reminder edit and ~1.5s after each app open; the server stores each reminder's UTC minute and fires it from the cron. Server stores no readings or names. Endpoints are restricted to FCM, Mozilla, Apple and Windows push hosts. Offset is captured when the app is opened, so DST changes self-heal on the next open.
- **PWA layer** (end of `index.html`): service worker registration, install card on Home (shown from the second visit, `beforeinstallprompt` on Android, Add-to-Home-Screen hint on iOS), `navigator.storage.persist()`, and Save/Restore backup in Settings (JSON of all `tenang:` keys, validated before restore). Navigations are network-first with a 4s fallback to the cached app, so updates arrive on the next open.

## Testing notes

- `node scripts/smoke.mjs` covers layout and errors only. For visual work, also take screenshots (Playwright, 390x844, deviceScaleFactor 2, light and dark) and look at them; earlier rounds caught clipped labels, wrapped buttons and cut-off text this way.
- Numbers guide checks used before: gauge reads 120 at squeeze, 80 at rest, 160 for the high preset; pause toggles; 2D fallback appears when three.js is blocked.
- Test on localhost via a tiny static server (a service worker is registered, so use http (`file://` skips it)).

## Feedback history (what the owner asked for, in order)

1. Core app for high blood pressure, natural methods, breathing and nervous-system resets, expert-UI-designer feel.
2. Animated timers and diagrams for box breathing and other techniques.
3. Elevation round: 30-day path, before/after readings, mood check-in and calm-now sequence, eyes-closed sound cues.
4. Seasonal themes, reminders, doctor-ready summary.
5. UI polish: slimmer buttons and CTAs.
6. Pharmacist 101 medicines guide (information only).
7. Motion-graphics-grade micro-interactions.
8. Carousels and expected mobile behaviours; timers.
9. Shareability with a genuine reason to share.
10. Another polish round; "tap to begin" visuals must trigger the action themselves.
11. Cloudflare test deployment.
12. Plain-English animated explanation of top vs bottom numbers, then made 3D because the 2D version was confusing.

## Known gaps and ideas

- Live Cloudflare deployment is manual (wrangler). A GitHub Action or Cloudflare Git integration would remove that step.
- Data is local to each device (`localStorage`); there is no account or sync. Manual backup/restore exists in Settings.
- Not yet install-tested on a real phone (Android Chrome and iOS Safari). Offline use and backup were verified in headless Chromium only.
- Web Push reminders are built but only verified with unit tests and a live API/D1 round trip, not yet on a real phone. Free-plan limit: a cron run can make about 50 outbound requests, so more than ~45 reminders due in the same minute will be dropped; fix with a paid plan (1000) or Queues. iOS needs the app installed to the Home Screen (16.4+).
- Medicines content and BP category thresholds should get a clinician review before any public launch.
- No translations yet; English only.
