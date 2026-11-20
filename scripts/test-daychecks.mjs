// Regression tests for "daily checks are not saved correctly": rituals, 30-day path and Today steps must always
// match what is stored, survive reloads, follow midnight while the app stays open, credit the right scheduled step,
// and never fail silently. Fake clock, Asia/Kuala_Lumpur. Usage: node scripts/test-daychecks.mjs
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { chromium } from 'playwright';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const f = q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1); if (!existsSync(f) || !statSync(f).isFile()) { r.statusCode = 404; return r.end(); } r.setHeader('Content-Type', TYPES[extname(f)] || 'application/octet-stream'); r.end(readFileSync(f)); }).listen(0);
const base = `http://localhost:${srv.address().port}`;
const b = await chromium.launch(); let n = 0; const ok = m => console.log('ok', ++n, m);
async function open(iso, seed = {}, hash = '#home') {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kuala_Lumpur' });
  await ctx.addInitScript(([s]) => {
    localStorage.setItem('tenang:setup', '{"done":true}');
    for (const [k, v] of Object.entries(s)) if (!localStorage.getItem('tenang:' + k)) localStorage.setItem('tenang:' + k, JSON.stringify(v));
    const real = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (window.__failWrites) throw new Error('QuotaExceededError'); return real.call(this, k, v); };
  }, [seed]);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); p.ctx = ctx;
  await p.clock.setFixedTime(new Date(iso)); await p.goto(base + '/' + hash); await p.waitForTimeout(500); return p;
}
const clock = (p, iso) => p.clock.setFixedTime(new Date(iso));
const store = (p, k) => p.evaluate(k => { const v = localStorage.getItem('tenang:' + k); return v === null ? null : JSON.parse(v); }, k);
const checked = p => p.$$eval('#ritualList input:checked', e => e.map(x => x.dataset.k).sort());
const openHabits = async p => { await p.evaluate(() => { document.querySelector('#habits').open = true; }); await p.waitForTimeout(700); }; // let the enter animation settle
const tick = p => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

// 1. Every ritual ticks, saves and survives a reload
let p = await open('2026-11-20T21:30:00+08:00', {}, '#rituals');
const all = await p.$$eval('#ritualList input', e => e.map(x => x.dataset.k));
for (const k of all) await p.check('#r-' + k);
assert.deepEqual(Object.keys(await store(p, 'rit:2026-11-20')).sort(), [...all].sort()); await p.reload(); await p.waitForTimeout(400); await openHabits(p);
assert.equal((await checked(p)).length, 8); assert.equal(await p.textContent('#ritCount'), '8 of 8'); assert.equal(await p.textContent('#habSum'), '8 of 8');
await p.uncheck('#r-salt'); await p.reload(); await p.waitForTimeout(400); await openHabits(p); assert.ok(!(await checked(p)).includes('salt')); assert.equal((await store(p, 'rit:2026-11-20')).salt, false);
ok('rituals: all 8 save, survive reload, and un-ticking is saved too'); await p.ctx.close();

// 2. App left open past midnight: everything follows the new day
p = await open('2026-11-20T21:30:00+08:00', { 'rit:2026-11-20': { salt: true, tea: true } }, '#rituals');
assert.deepEqual(await checked(p), ['salt', 'tea']); assert.match(await p.textContent('#greet'), /Good evening/); assert.match(await p.textContent('#today'), /Fri/);
await clock(p, '2026-11-21T00:05:00+08:00'); await tick(p); await p.waitForTimeout(400);
assert.deepEqual(await checked(p), []); assert.equal(await p.textContent('#ritCount'), '0 of 8'); assert.equal(await p.textContent('#habSum'), '0 of 8');
assert.match(await p.textContent('#greet'), /Still night/); assert.match(await p.textContent('#today'), /Sat/); assert.match(await p.textContent('#today'), /21/);
await p.check('#r-plants'); assert.deepEqual(Object.keys(await store(p, 'rit:2026-11-21')), ['plants']); assert.deepEqual(Object.keys(await store(p, 'rit:2026-11-20')).sort(), ['salt', 'tea']);
assert.deepEqual(await checked(p), ['plants']);
ok('past midnight: rituals reset to today (0 of 8), date + greeting update, new tick saved to the new day, yesterday untouched'); await p.ctx.close();

// 3. The 30-day path follows the day too, and ticks land on the day shown
p = await open('2026-11-20T22:00:00+08:00', { path: { start: '2026-11-20', done: {} } }, '#learn');
assert.equal(await p.textContent('#pathDay'), 'Day 1 of 30'); assert.ok((await p.$$eval('#pathTasks label', e => e.map(x => x.textContent))).some(t => /baseline reading/i.test(t)));
await clock(p, '2026-11-21T00:10:00+08:00'); await tick(p); await p.waitForTimeout(400);
assert.equal(await p.textContent('#pathDay'), 'Day 2 of 30'); assert.ok(!(await p.$$eval('#pathTasks label', e => e.map(x => x.textContent))).some(t => /baseline reading/i.test(t)));
await p.locator('#pathTasks input').first().check({ force: true }); await p.waitForTimeout(300);
const path = await store(p, 'path'); assert.deepEqual(Object.keys(path.done), ['2']); assert.deepEqual(Object.keys(path.done['2']), ['b1']);
ok('past midnight: path moves to Day 2 with its own tasks; the tick is saved under Day 2 only (before: Day 1 task saved as Day 2)'); await p.ctx.close();

// 4. Safety net: even if no timer or event ran, a tap never writes to the wrong day and the screen always matches storage
p = await open('2026-11-20T23:55:00+08:00', { 'rit:2026-11-20': { salt: true } }, '#rituals');
await clock(p, '2026-11-21T00:20:00+08:00'); await p.click('label[for=r-tea]'); await p.waitForTimeout(400);
assert.deepEqual(await store(p, 'rit:2026-11-20'), { salt: true });
const stored = Object.entries((await store(p, 'rit:2026-11-21')) || {}).filter(([, v]) => v).map(([k]) => k).sort();
assert.deepEqual(await checked(p), stored); assert.equal(await p.textContent('#ritCount'), stored.length + ' of 8');
ok('a tap right after midnight (no refresh yet): yesterday untouched, and the screen exactly matches what is saved'); await p.ctx.close();

// 5. A reading credits the scheduled step it belongs to (was: fixed 2pm cut-off)
for (const [iso, want, notWant] of [['2026-11-20T14:30:00+08:00', 'amBP', 'pmBP'], ['2026-11-20T21:30:00+08:00', 'pmBP', null], ['2026-11-20T06:30:00+08:00', 'amBP', 'pmBP']]) {
  p = await open(iso, {}, '#log'); await p.click('[data-ql]'); await p.fill('#qlS', '126'); await p.fill('#qlD', '82'); await p.click('#qlSave'); await p.waitForTimeout(300);
  const d = (await store(p, 'remdone:2026-11-20')) || {}; assert.ok(d[want], `${iso}: expected ${want}, got ${JSON.stringify(d)}`); if (notWant) assert.ok(!d[notWant], `${iso}: ${notWant} must not be ticked`);
  await p.ctx.close();
}
ok('a reading at 14:30 ticks the morning reading it was late for, not the evening one; 21:30 ticks evening; 06:30 ticks the next one up');

// 6. Tapping Start on a breathing step does not tick it before anyone has breathed
p = await open('2026-11-20T08:00:00+08:00', {});
assert.equal(await p.locator('.td-chip.s-done').count(), 0);
await p.click('.td-chip[data-rem-start=amBr]'); await p.waitForTimeout(300); assert.equal(await p.evaluate(() => location.hash), '#breathe');
assert.equal((await store(p, 'remdone:2026-11-20')), null);
await p.evaluate(() => { location.hash = '#home'; }); await p.waitForTimeout(300); assert.equal(await p.locator('.td-chip.s-done').count(), 0); assert.equal(await p.textContent('#tdCount'), '0/4');
ok('Start on "AM breath" opens the session but leaves it unticked until you actually breathe'); await p.ctx.close();

// 7. A failed save is never silent, and the screen does not pretend it worked
p = await open('2026-11-20T21:30:00+08:00', {}, '#rituals');
await p.evaluate(() => { window.__failWrites = true; }); await p.check('#r-salt', { force: true }).catch(() => {}); await p.waitForTimeout(300);
assert.match(await p.textContent('#toast'), /Couldn.t save that/); assert.equal(await store(p, 'rit:2026-11-20'), null); assert.deepEqual(await checked(p), []);
ok('storage failure: a clear "couldn\'t save" message, and the box is not left looking ticked'); assert.deepEqual(p.errs, []); await p.ctx.close();

await b.close(); srv.close(); console.log('daily-check tests passed');
