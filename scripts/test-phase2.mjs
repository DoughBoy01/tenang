// Phase 2 UI tests (fake clock, Asia/Kuala_Lumpur): context tags, patterns panels, weekly review, shortcuts, icon badge.
// Needs: npm i -D playwright. Usage: node scripts/test-phase2.mjs   (screenshots in shots/phase2-*.png)
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { chromium } from 'playwright';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const f = q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1); if (!existsSync(f) || !statSync(f).isFile()) { r.statusCode = 404; return r.end(); } r.setHeader('Content-Type', TYPES[extname(f)] || 'application/octet-stream'); r.end(readFileSync(f)); }).listen(0);
const base = `http://localhost:${srv.address().port}`;
mkdirSync('shots', { recursive: true });
const b = await chromium.launch(); let n = 0; const ok = m => console.log('ok', ++n, m);
const ISO = (y, mo, d, h = 8, m = 0) => new Date(y, mo - 1, d, h, m).getTime(); // KL-local when the browser runs in KL; readings are seeded relative to the page clock below
async function open(iso, seed = {}, { scheme = 'light', badge = false, path = '/#home' } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Kuala_Lumpur', colorScheme: scheme });
  await ctx.addInitScript(([s, badge]) => {
    localStorage.setItem('tenang:setup', '{"done":true}');
    for (const [k, v] of Object.entries(s)) localStorage.setItem('tenang:' + k, JSON.stringify(v));
    if (badge) { window.__badge = []; navigator.setAppBadge = n => { window.__badge.push(n); return Promise.resolve(); }; navigator.clearAppBadge = () => { window.__badge.push(0); return Promise.resolve(); }; }
  }, [seed, badge]);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.clock.setFixedTime(new Date(iso)); await page.goto(base + path); await page.waitForTimeout(600);
  page.errs = errs; page.ctx = ctx; return page;
}
// readings relative to Fri 20 Nov 2026 (KL time): `d` days ago at hour h
const rt = (d, s, dd, h = 8, extra = {}) => ({ s, d: dd, p: 70, t: new Date(`2026-11-${String(20 - d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+08:00`).getTime(), c: 'Morning', ...extra });
const day = off => `2026-11-${String(20 - off).padStart(2, '0')}`;
const text = (p, s) => p.textContent(s);
const FRI = '2026-11-20T09:00:00+08:00', SUN = '2026-11-22T19:00:00+08:00', MON = '2026-11-23T09:00:00+08:00', TUE = '2026-11-24T09:00:00+08:00';
// 14 days of data: this week lower than last, breathing on odd days
const rich = []; const mins = {};
for (let d = 0; d < 14; d++) { const thisWeek = d < 7; rich.push(rt(d, thisWeek ? (d % 2 ? 120 : 128) : 134, thisWeek ? 78 : 86, 8), rt(d, thisWeek ? 118 : 130, 76, 20)); if (d % 2) mins[day(d)] = 6; }
rich[0].g = ['salt']; rich[2].g = ['salt']; rich[4].g = ['salt'];

// 1. Tags in the quick log
let p = await open(FRI, {});
await p.click('#tdGo'); assert.equal(await p.locator('#qlTags .chip').count(), 5);
assert.deepEqual(await p.locator('#qlTags .chip').allTextContents(), ['Slept badly', 'Salty food', 'Stressed', 'Exercised', 'Coffee']);
await p.click('[data-st=qlS][data-d="1"]'); await p.click('[data-st=qlD][data-d="1"]');
await p.click('#qlTags [data-tag=sleep]'); await p.click('#qlTags [data-tag=stress]'); await p.click('#qlTags [data-tag=coffee]'); await p.click('#qlTags [data-tag=coffee]');
assert.equal(await p.locator('#qlTags .chip[aria-pressed=true]').count(), 2);
await p.waitForTimeout(900); await p.screenshot({ path: 'shots/phase2-qlog-tags.png' });
await p.click('#qlSave'); await p.waitForTimeout(200);
let saved = await p.evaluate(() => JSON.parse(localStorage.getItem('tenang:readings')).filter(r => !r.ex)); assert.equal(saved.length, 1);
assert.deepEqual(saved[0].g, ['sleep', 'stress']);
await p.click('[data-ql-close]'); await p.click('#qlog', { position: { x: 5, y: 5 }, force: true }).catch(() => {});
await p.evaluate(() => { location.hash = '#log'; }); await p.waitForTimeout(400);
assert.match(await text(p, '#readings'), /Slept badly, Stressed/);
ok('quick log: 5 tags, toggle on/off, saved as an additive field `g`, shown on the log row');
await p.evaluate(() => { location.hash = '#qlog'; }); await p.waitForSelector('#qlog:not([hidden])'); await p.click('[data-st=qlS][data-d="1"]'); await p.click('[data-st=qlD][data-d="1"]'); await p.click('#qlSave');
saved = await p.evaluate(() => JSON.parse(localStorage.getItem('tenang:readings')).filter(r => !r.ex)); assert.equal(saved.length, 2); assert.equal(saved.filter(r => 'g' in r).length, 1); // the clock is frozen, so both share a timestamp; only the tagged one has `g`
ok('no tags selected: no `g` field is written (old and new readings stay interchangeable)');
assert.deepEqual(p.errs, []); await p.ctx.close();

// 2. Patterns: hidden at first, then plain statements; both pages
p = await open(FRI, { readings: [rt(0, 126, 80), rt(1, 125, 80), rt(2, 127, 81)] });
assert.ok(!(await p.isVisible('#insHome')));
await p.evaluate(() => { location.hash = '#log'; }); await p.waitForTimeout(300);
assert.match(await text(p, '#insList'), /after about 5 readings \(3 so far\)/); await p.ctx.close();
p = await open(FRI, { readings: rich, mins });
assert.ok(await p.isVisible('#insHome')); assert.match(await text(p, '#insHomeTxt'), /Your last 7 days average 121\/77, 11 lower on top than the week before\./);
await p.screenshot({ path: 'shots/phase2-home-insight.png' });
await p.evaluate(() => { location.hash = '#log'; }); await p.waitForTimeout(300);
const li = await text(p, '#insList'); assert.equal(await p.locator('#insList .ins-item').count(), 3); assert.match(li, /not medical advice/);
assert.doesNotMatch(li, /\bshould\b|\bmust\b|medicine|dose/i);
await p.locator('#insLog').scrollIntoViewIfNeeded(); await p.screenshot({ path: 'shots/phase2-log-patterns.png' });
ok('patterns: nothing on Home with <5 readings, a calm explainer on Log; with data, the top insight on Home and three on Log with a "not medical advice" note');
assert.deepEqual(p.errs, []); await p.ctx.close();

// 3. Weekly review
p = await open(FRI, { readings: rich, mins }); assert.ok(!(await p.isVisible('#weekCard'))); await p.ctx.close();
const act = Object.fromEntries([16, 17, 18, 20, 21].map(d => ['remdone:2026-11-' + d, { amBr: true }]));
p = await open(SUN, { readings: rich, mins, ...act });
assert.ok(await p.isVisible('#weekCard')); assert.match(await text(p, '#weekCardSub'), /steady week\. 6 of 7 days/);
await p.screenshot({ path: 'shots/phase2-week-card.png' });
await p.click('#weekCard'); assert.ok(await p.isVisible('#weekly'));
const wb = await text(p, '#wkBody'); assert.match(wb, /16 Nov – 22 Nov|Nov 16 – Nov 22|16 – 22/); assert.match(wb, /A steady week\./); assert.match(wb, /6\/7/); assert.match(wb, /Lowest reading/);
assert.equal(await p.locator('.wk-d.on').count(), 6); assert.equal(await p.locator('.wk-d').allTextContents().then(a => a.join('')), 'MTWTFSS');
assert.match(wb, /Day \d+ of 30/); assert.match(wb, /See you next week/);
await p.waitForTimeout(900); await p.screenshot({ path: 'shots/phase2-week-sheet.png' });
await p.click('#wkDone'); assert.ok(!(await p.isVisible('#weekly'))); assert.ok(!(await p.isVisible('#weekCard')));
assert.equal(await p.evaluate(() => localStorage.getItem('tenang:wk:2026-11-16')), 'true');
await p.reload(); await p.waitForTimeout(500); assert.ok(!(await p.isVisible('#weekCard')));
ok('Sunday: card shows "steady week, 6 of 7" (days with readings count as practised); sheet has days, stats, path note; Done marks it seen and it stays gone after reload'); await p.ctx.close();
p = await open(MON, { readings: rich, mins, ...act }); assert.ok(await p.isVisible('#weekCard')); await p.click('#weekCard'); assert.match(await text(p, '#wkBody'), /A steady week\./); await p.keyboard.press('Escape'); assert.ok(!(await p.isVisible('#weekCard'))); await p.ctx.close();
p = await open(TUE, { readings: rich, mins, ...act }); assert.ok(!(await p.isVisible('#weekCard'))); await p.ctx.close();
p = await open(SUN, {}); await p.click('#weekCard'); assert.match(await text(p, '#wkBody'), /A quiet week\. Starting again is easy\./); assert.doesNotMatch(await text(p, '#wkBody'), /missed|failed|behind|streak/i); await p.ctx.close();
ok('Monday still offers the week that just ended, Tuesday does not; an empty week gets a kind headline (no scolding words)');

// 4. Shortcuts
p = await open(FRI, {}, { path: '/#qlog' }); assert.ok(await p.isVisible('#qlog')); assert.equal(await p.evaluate(() => location.hash), '#home'); await p.ctx.close();
p = await open(FRI, {}, { path: '/#calmnow' }); assert.ok(await p.isVisible('#calm')); assert.equal(await p.evaluate(() => location.hash), '#home'); await p.ctx.close();
p = await open(FRI, {}, { path: '/#breathe' }); assert.ok(await p.isVisible('#v-breathe')); await p.ctx.close();
const man = JSON.parse(readFileSync('manifest.webmanifest', 'utf8')); assert.deepEqual(man.shortcuts.map(s => s.url), ['/#qlog', '/#breathe', '/#calmnow']);
assert.ok(man.shortcuts.every(s => s.name && s.icons[0].src.startsWith('/') && existsSync(s.icons[0].src.slice(1))));
ok('home-screen shortcuts: #qlog opens the log sheet, #calmnow starts the calm sequence, #breathe opens Breathe; manifest declares all three');

// 5. Icon badge follows what is due
p = await open('2026-11-20T08:00:00+08:00', {}, { badge: true }); assert.equal((await p.evaluate(() => window.__badge)).at(-1), 2);
await p.click('#tdGo'); await p.click('[data-st=qlS][data-d="1"]'); await p.click('[data-st=qlD][data-d="1"]'); await p.click('#qlSave'); await p.waitForTimeout(300);
assert.equal((await p.evaluate(() => window.__badge)).at(-1), 1); await p.ctx.close();
p = await open('2026-11-20T15:00:00+08:00', {}, { badge: true }); assert.equal((await p.evaluate(() => window.__badge)).at(-1), 0);
ok('badge: 2 due at 08:00, 1 after logging the reading, cleared when nothing is due'); await p.ctx.close();

// 6. Dark mode and mobile fit
p = await open(SUN, { readings: rich, mins, ...act }, { scheme: 'dark' }); await p.screenshot({ path: 'shots/phase2-home-dark.png' });
await p.click('#weekCard'); await p.waitForTimeout(900); await p.screenshot({ path: 'shots/phase2-week-sheet-dark.png' }); await p.keyboard.press('Escape');
const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(over <= 1); assert.deepEqual(p.errs, []);
ok('dark mode: no overflow, no page errors'); await p.ctx.close();
await b.close(); srv.close(); console.log('phase 2 tests passed');
