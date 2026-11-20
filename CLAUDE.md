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
| `worker.js` | **Generated.** Single-file Cloudflare Worker with the HTML, manifest, icons, `sw.js` and Three.js embedded. Do not hand-edit. |
| `scripts/build-worker.mjs` | Regenerates `worker.js` from the files above |
| `scripts/smoke.mjs` | Playwright mobile smoke test (all views, light and dark, page errors, horizontal overflow). Needs `npm i -D playwright` |

Workflow after any change to `index.html` or the PWA files: `node scripts/build-worker.mjs`, run `node scripts/smoke.mjs`, commit both `index.html` and `worker.js`, then deploy.

## Deploy

- Live (test) site: https://tenang.pm2120600.workers.dev (Cloudflare Workers, account has many other Workers; this one is named `tenang`).
- Deploy: `npx wrangler deploy worker.js --name tenang --compatibility-date 2026-10-01`
- Do not use `tenang.pages.dev`: that address is owned by someone else (it served an unrelated spam site).
- The live site may lag the repo; redeploy after pulling.
- A Claude-hosted copy also exists as a Claude artifact (https://claude.ai/artifact/Np8XXjU3Deyg6DwJk1EFRu). It differs only by two header tags (`<meta name="claude:viewport-fit-sides" content="cover">`) and no manifest link. It is not part of this repo's workflow. In the app, `APP_URL` uses the origin on `*.workers.dev`/`*.pages.dev` and falls back to the artifact URL elsewhere. Update `APP_URL` when a permanent domain exists.

## Design language

Inspired by Japanese, Korean and Balinese Buddhist aesthetics: quiet, spacious, paper-and-ink, moss green, indigo and saffron accents, generous whitespace, soft shapes, gentle motion.

- Fonts (Google Fonts): Shippori Mincho (display), Zen Kaku Gothic New (body), IBM Plex Mono (numbers/data).
- CSS tokens on `:root`: `--paper --surface --sunk --ink --moss --indigo --saffron`, semantic `--ok --warn --high --crisis`, `--hero`. Dark theme via `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` and `:root[data-theme="dark"]`. Always use tokens, never hard-coded colours.
- Seasonal themes: 24 Japanese sekki (solar terms) set `data-season` on the root, each with light and dark palettes; the user can follow the date or pick one.
- Motion: spring/ease CSS variables, `replay()`, `countUp()`, ripple on pointerdown, `pebble()` micro-interactions.
- Mobile patterns used throughout: scroll-snap carousels (`.snap` + `.dotsnav` + `initSnap`), swipe between the 5 main tabs, swipe-to-delete with Undo toast, drag-down sheets, filter chips.

## Architecture (in `index.html`)

- Hash router over views `home, breathe, reset, rituals, log, summary, meds, numbers` (`route()`). Bottom nav highlights: summary and numbers map to Log, meds maps to Home.
- State in `localStorage` via `store.get/set` (keys prefixed `tenang:`, always try/catch): readings, rituals, 30-day path, reminders, sound, season, notes, minutes.
- **Breathing engine:** `PATTERNS` (phases `[label, secs, kind]`), `levels()`, `ease()`, `lungPoint()`, a `requestAnimationFrame` loop, WebAudio tones plus SpeechSynthesis for "Eyes closed" mode, Wake Lock to keep the screen on. Techniques: Resonance, Long exhale, Physiological sigh, Bee breath, Box breathing and 4-7-8, each with animated diagrams and timers.
- **Features:** 30-day path, before/after readings, mood check-in leading to a "calm now" sequence, rituals, reminders with auto-complete (`markRem`), doctor-ready summary (`renderSummary`, `buildSumText`, `copyText`), Medicines guide, shareable card/sheet with a "who could this help" reason, timers sheet (`#tmr`), settings sheet (`#sheet`).
- **Top and bottom numbers guide (`#v-numbers`):** animated 3D explanation (Three.js r128 loaded on demand from cdnjs, `bp3Load/bp3Init/bpRender`): a pumping heart, a cut-open artery with blood cells, and a vertical gauge with "top 120 / bottom 80" marks. Modes Watch/Squeeze/Rest, speeds Slow/Real, presets (including a high 160/100 reading), number cards carousel, quick quiz. If WebGL or the script fails, a 2D SVG fallback (`#bp2d`) with the same gauge shows. The owner found an earlier 2D wave graph "confusing", so keep it simple: one caption, one gauge.
- CSP-style constraint carried over from the artifact host: external scripts only from cdnjs, CSS only from Google Fonts. Keep everything else inline. Three.js now comes from `/vendor/three.min.js`.
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
- Reminders still only show while the app is open; background alerts need Web Push (Worker + Cron + KV) or a Capacitor wrapper with local notifications.
- Medicines content and BP category thresholds should get a clinician review before any public launch.
- No translations yet; English only.
