// First run: a brand-new user gets two quick choices (check-in times, reminders); everyone else is never interrupted.
// Fake clock, Asia/Kuala_Lumpur. Usage: node scripts/test-firstrun.mjs   (shots/firstrun-*.png)
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { chromium } from 'playwright';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const f = q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1); if (!existsSync(f) || !statSync(f).isFile()) { r.statusCode = 404; return r.end(); } r.setHeader('Content-Type', TYPES[extname(f)] || 'application/octet-stream'); r.end(readFileSync(f)); }).listen(0);
const base = `http://localhost:${srv.address().port}`;
const b = await chromium.launch(); let n = 0; const ok = m => console.log('ok', ++n, m);
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
async function open({ seed = {}, hash = '#home', ua, scheme = 'light' } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Kuala_Lumpur', colorScheme: scheme, ...(ua ? { userAgent: ua } : {}) });
  await ctx.addInitScript(([s]) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem('tenang:' + k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } }, [seed]);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); p.ctx = ctx;
  await p.clock.setFixedTime(new Date('2026-11-20T08:00:00+08:00')); await p.goto(base + '/' + hash); await p.waitForTimeout(1300); return p;
}
const store = (p, k) => p.evaluate(k => { const v = localStorage.getItem('tenang:' + k); return v === null ? null : JSON.parse(v); }, k);

// 1. A brand-new user sees it, with sensible defaults, and Start applies their times everywhere
let p = await open();
assert.ok(await p.isVisible('#setup')); assert.equal(await p.inputValue('#suAm'), '07:00'); assert.equal(await p.inputValue('#suPm'), '20:30');
await p.waitForTimeout(700); await p.screenshot({ path: 'shots/firstrun-light.png' });
await p.fill('#suAm', '06:45'); await p.fill('#suPm', '21:15'); await p.click('#suGo'); await p.waitForTimeout(300);
assert.ok(!(await p.isVisible('#setup')));
const rem = await store(p, 'rem'); assert.deepEqual([rem.amBP.t, rem.amBr.t, rem.pmBr.t, rem.pmBP.t], ['06:45', '07:00', '21:15', '21:45']); assert.ok(rem.amBP.on && rem.amBr.on && rem.pmBr.on && rem.pmBP.on);
assert.equal((await store(p, 'setup')).skipped, false);
await p.evaluate(() => { location.hash = '#home'; }); await p.waitForTimeout(300);
assert.equal(await p.locator('.td-chip').count(), 4); assert.match(await p.textContent('#tdTitle'), /morning reading/i);
await p.reload(); await p.waitForTimeout(1300); assert.ok(!(await p.isVisible('#setup')));
ok('new user: sheet appears with 07:00 / 20:30; their times become the four reminders (reading 06:45, breathing +15 min, evening, evening reading +30 min); never shown again'); assert.deepEqual(p.errs, []); await p.ctx.close();

// 2. Skip keeps the defaults and is remembered
p = await open(); assert.ok(await p.isVisible('#setup')); await p.click('#suSkip'); await p.waitForTimeout(300);
assert.ok(!(await p.isVisible('#setup'))); assert.equal((await store(p, 'setup')).skipped, true); assert.equal(await store(p, 'rem'), null);
assert.equal(await p.locator('.td-chip').count(), 4);
await p.reload(); await p.waitForTimeout(1300); assert.ok(!(await p.isVisible('#setup')));
ok('Skip: default reminders stay, nothing else changes, not asked again'); await p.ctx.close();
p = await open(); await p.keyboard.press('Escape'); await p.waitForTimeout(300); assert.ok(!(await p.isVisible('#setup'))); assert.equal((await store(p, 'setup')).skipped, true);
ok('Escape counts as Skip (never a trap)'); await p.ctx.close();

// 3. Existing users are never interrupted, and are remembered as such
const R = { s: 126, d: 80, p: 68, t: new Date('2026-11-18T08:00:00+08:00').getTime(), c: 'Morning' };
p = await open({ seed: { readings: [R] } }); assert.ok(!(await p.isVisible('#setup'))); assert.equal((await store(p, 'setup')).existing, true); await p.ctx.close();
p = await open({ seed: { mins: { '2026-11-19': 5 } } }); assert.ok(!(await p.isVisible('#setup'))); await p.ctx.close();
p = await open({ seed: { 'remdone:2026-11-19': { amBr: true } } }); assert.ok(!(await p.isVisible('#setup'))); await p.ctx.close();
p = await open({ seed: { setup: { done: true } } }); assert.ok(!(await p.isVisible('#setup'))); assert.equal((await store(p, 'setup')).done, true); await p.ctx.close();
ok('anyone with readings, breathing minutes, completed steps or a saved setup is never shown it'); 

// 4. Shortcuts go straight to the action, first run or not
p = await open({ hash: '#qlog' }); assert.ok(!(await p.isVisible('#setup'))); assert.ok(await p.isVisible('#qlog')); await p.ctx.close();
ok('opening the "Log a reading" shortcut on a fresh install goes straight to logging');

// 5. Reminders line is honest about what this device can do
p = await open({ ua: IOS }); assert.match(await p.textContent('#suNote'), /add Tenang to your Home Screen/i); assert.ok(!(await p.isVisible('#suBell'))); await p.screenshot({ path: 'shots/firstrun-ios.png' }); await p.ctx.close();
p = await open(); const bell = await p.isVisible('#suBell'); const note = await p.textContent('#suNote');
assert.ok(bell ? /gentle nudge/i.test(note) : /home screen while Tenang is open|blocked/i.test(note), note);
ok('iPhone in a browser tab: explains Add to Home Screen first and hides the button; otherwise offers reminders or says what will happen'); await p.ctx.close();

// 6. Dark mode, small phone
p = await open({ scheme: 'dark' }); await p.waitForTimeout(700); await p.screenshot({ path: 'shots/firstrun-dark.png' });
const fits = await p.evaluate(() => { const s = document.querySelector('#setup .sheet'); return s.scrollHeight <= s.clientHeight + 1; }); assert.ok(fits, 'sheet scrolls on a 844px phone');
await p.ctx.close();
const small = await b.newContext({ viewport: { width: 360, height: 640 }, timezoneId: 'Asia/Kuala_Lumpur' }); const sp = await small.newPage(); await sp.clock.setFixedTime(new Date('2026-11-20T08:00:00+08:00')); await sp.goto(base + '/#home'); await sp.waitForTimeout(1300);
assert.ok(await sp.isVisible('#setup')); assert.ok(await sp.isVisible('#suGo'), 'Start button reachable without scrolling on 640px');
assert.ok((await sp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1); await small.close();
ok('fits a 360x640 phone with the Start button visible; dark mode renders'); 
await b.close(); srv.close(); console.log('first-run tests passed');
