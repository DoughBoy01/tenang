// The simplified daily journey: four tabs, a short Today, one way to log, everything else findable under Learn.
// Guards against Home growing back into a long page. Fake clock, Asia/Kuala_Lumpur. Usage: node scripts/test-journey.mjs
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { chromium } from 'playwright';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const f = q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1); if (!existsSync(f) || !statSync(f).isFile()) { r.statusCode = 404; return r.end(); } r.setHeader('Content-Type', TYPES[extname(f)] || 'application/octet-stream'); r.end(readFileSync(f)); }).listen(0);
const base = `http://localhost:${srv.address().port}`;
const b = await chromium.launch(); let n = 0; const ok = m => console.log('ok', ++n, m);
const rd = (d, s = 126, dd = 80, h = 8) => ({ s, d: dd, p: 68, t: new Date(2026, 10, 20 - d, h).getTime(), c: 'Morning' });
const HISTORY = { readings: [0, 1, 2, 3, 4, 5, 6, 7].map(i => rd(i, 126 + (i % 3))), visits: 5 };
async function open(iso, seed = {}, hash = '#home', { w = 390, h = 844 } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, timezoneId: 'Asia/Kuala_Lumpur' });
  await ctx.addInitScript(([s]) => { localStorage.setItem('tenang:setup', '{"done":true}'); for (const [k, v] of Object.entries(s)) if (!localStorage.getItem('tenang:' + k)) localStorage.setItem('tenang:' + k, JSON.stringify(v)); }, [seed]);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); p.ctx = ctx;
  await p.clock.setFixedTime(new Date(iso)); await p.goto(base + '/' + hash); await p.waitForTimeout(500); return p;
}
const vis = (p, s) => p.isVisible(s);
const screens = (p, v) => p.evaluate(v => { const el = document.querySelector('#v-' + v); return el.scrollHeight / innerHeight; }, 'home');
const NOON = '2026-11-20T08:00:00+08:00';

// 1. Four tabs, right order, right highlight on every route
let p = await open(NOON, HISTORY);
assert.deepEqual(await p.$$eval('.nav a', e => e.map(a => a.textContent.trim())), ['Today', 'Breathe', 'Log', 'Learn']);
for (const [hash, tab] of [['#home', 'Today'], ['#breathe', 'Breathe'], ['#reset', 'Breathe'], ['#log', 'Log'], ['#summary', 'Log'], ['#learn', 'Learn'], ['#numbers', 'Learn'], ['#meds', 'Learn']]) {
  await p.evaluate(h => { location.hash = h; }, hash); await p.waitForTimeout(250);
  assert.equal(await p.$eval('.nav a[aria-current=page]', a => a.textContent.trim()), tab, hash);
}
ok('four tabs (Today, Breathe, Log, Learn); Reset highlights Breathe, Summary highlights Log, Numbers/Medicines highlight Learn');

// 2. Today is short and focused
await p.evaluate(() => { location.hash = '#home'; }); await p.waitForTimeout(300);
const h = await p.evaluate(() => { const el = document.querySelector('#v-home'); return { screens: el.scrollHeight / innerHeight, blocks: [...el.children].filter(c => !c.hidden && c.offsetHeight > 0).length }; });
assert.ok(h.screens <= 1.7, 'Home is ' + h.screens.toFixed(2) + ' screens'); assert.ok(h.blocks <= 8, 'Home has ' + h.blocks + ' blocks');
for (const gone of ['#pathPanel', '#qr', '#why', '.share-card', '[data-go=numbers]', '[data-go=meds]', '.tiles']) assert.equal(await p.locator('#v-home ' + gone).count(), 0, gone + ' should not be on Home');
assert.ok(await vis(p, '#todayCard')); assert.ok(await vis(p, '#moods')); assert.ok(await vis(p, '#habits'));
ok(`Today stays short (${h.screens.toFixed(1)} screens, ${h.blocks} blocks); path, guides, quick resets and sharing are not on it`);

// 3. Today's focus: only what the steps above don't already cover
p.ctx.close();
p = await open(NOON, { ...HISTORY, path: { start: '2026-11-20', done: {} } });
assert.ok(!(await vis(p, '#focusPanel')));
ok('day 1 (baseline readings + breathing are already steps): no duplicate focus list');
await p.ctx.close();
p = await open(NOON, { ...HISTORY, path: { start: '2026-11-12', done: {} } }); // day 9: a reset practice
assert.ok(await vis(p, '#focusPanel')); assert.match(await p.textContent('#focusDay'), /Day 9 of 30/); assert.equal(await p.locator('#focusList .task').count(), 1);
assert.ok(!/breathing/i.test(await p.textContent('#focusList')));
await p.check('#fc-r'); await p.waitForTimeout(250);
const path = JSON.parse(await p.evaluate(() => localStorage.getItem('tenang:path'))); assert.equal(path.done['9'].r, true);
await p.evaluate(() => { location.hash = '#learn'; }); await p.waitForTimeout(250); assert.ok(await p.isChecked('#pt-r'));
ok('day 9: one focus task, no breathing duplicate; ticking it saves to the path and shows ticked in Learn too'); await p.ctx.close();
p = await open(NOON, { ...HISTORY, path: { start: '2026-11-20', done: {} }, 'remdone:2026-11-20': { amBP: true, pmBP: true } }, '#learn');
assert.ok(await p.isChecked('#pt-base'));
ok('day 1 baseline ticks itself once both readings are done'); await p.ctx.close();

// 4. The old Rituals tab and links still work: habits live on Today
p = await open(NOON, HISTORY, '#rituals'); await p.waitForTimeout(300);
assert.equal(await p.evaluate(() => location.hash), '#home'); assert.ok(await p.$eval('#habits', d => d.open)); assert.ok(await vis(p, '#r-salt'));
assert.equal(await p.locator('#v-rituals').count(), 0);
await p.check('#r-salt'); assert.equal(await p.textContent('#habSum'), '1 of 8');
ok('#rituals opens Today with the habits list expanded; ticking updates "1 of 8"'); await p.ctx.close();

// 5. One way to log
p = await open(NOON, HISTORY, '#log');
assert.equal(await p.locator('#bpForm, #sys, #dia, #pulse').count(), 0); assert.equal(await p.locator('[data-ql]').count(), 1);
assert.match(await p.textContent('#logBP'), /126\/80/); assert.match(await p.textContent('#logWhen'), /8:00/);
await p.click('[data-ql]'); assert.ok(await vis(p, '#qlog')); await p.keyboard.press('Escape');
const hero = await p.evaluate(() => { const r = document.querySelector('[data-ql]').getBoundingClientRect(); return r.top < innerHeight; }); assert.ok(hero, 'Log button is above the fold');
ok('Log: one "Log a reading" button above the fold, last reading shown, old form gone'); await p.ctx.close();
p = await open(NOON, {}, '#log'); assert.match(await p.textContent('#logWhen'), /Example data|first reading/); await p.ctx.close();
ok('Log with no real data: says so plainly');

// 6. Learn holds everything educational, and each link works
p = await open(NOON, HISTORY, '#learn');
for (const sel of ['#pathPanel', '[data-go=numbers]', '[data-go=meds]', '[data-go=summary]', '#why', '.share-card', '#effects']) assert.equal(await p.locator('#v-learn ' + sel).count(), 1, sel);
for (const [go, view] of [['numbers', '#v-numbers'], ['meds', '#v-meds'], ['summary', '#v-summary']]) { await p.click(`#v-learn [data-go=${go}]`); await p.waitForTimeout(250); assert.ok(await vis(p, view), go); await p.evaluate(() => { location.hash = '#learn'; }); await p.waitForTimeout(200); }
await p.evaluate(() => { location.hash = '#breathe'; }); await p.waitForTimeout(250); await p.click('#v-breathe [data-go=reset]'); await p.waitForTimeout(250); assert.ok(await vis(p, '#v-reset'));
ok('Learn: path, numbers guide, medicines, doctor summary, why it works, effects, share; Breathe links to the reset library'); await p.ctx.close();

// 7. Swipe order follows the four tabs (the order users see)
p = await open(NOON, HISTORY);
const order = await p.evaluate(() => { const src = document.documentElement.innerHTML; return /TABS=\['home','breathe','log','learn'\]/.test(src); }); assert.ok(order);
ok('swipe order matches the tab bar');

// 8. Small phone and dark mode: nothing overflows
for (const [w, hh, scheme] of [[360, 640, 'light'], [390, 844, 'dark']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: hh }, timezoneId: 'Asia/Kuala_Lumpur', colorScheme: scheme }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.addInitScript(([s]) => { localStorage.setItem('tenang:setup', '{"done":true}'); for (const [k, v] of Object.entries(s)) localStorage.setItem('tenang:' + k, JSON.stringify(v)); }, [HISTORY]); await pg.clock.setFixedTime(new Date(NOON));
  for (const v of ['home', 'breathe', 'reset', 'log', 'learn']) { await pg.goto(base + '/#' + v); await pg.waitForTimeout(350); const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(over <= 1, `${v} overflows ${over}px at ${w}`); }
  assert.deepEqual(errs, []); await ctx.close();
}
ok('360px and dark mode: no horizontal overflow on any tab, no page errors');
await b.close(); srv.close(); console.log('journey tests passed');
