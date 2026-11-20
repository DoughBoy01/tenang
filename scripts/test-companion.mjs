// Companion-loop UI tests: the adaptive Today card, forgiving rhythm, ring, and the 10-second log sheet.
// Needs: npm i -D playwright. Usage: node scripts/test-companion.mjs   (screenshots in shots/)
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { chromium } from 'playwright';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const f = q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1); if (!existsSync(f) || !statSync(f).isFile()) { r.statusCode = 404; return r.end(); } r.setHeader('Content-Type', TYPES[extname(f)] || 'application/octet-stream'); r.end(readFileSync(f)); }).listen(0);
const base = `http://localhost:${srv.address().port}`;
mkdirSync('shots', { recursive: true });
const b = await chromium.launch();
let n = 0; const ok = m => console.log('ok', ++n, m);
const day = (off = 0, at = '12:00') => { const d = new Date(Date.UTC(2026, 10, 20 - off)); return d.toISOString().slice(0, 10); };
// Always test in Kuala Lumpur time; "now" is Fri 20 Nov 2026 at the given HH:MM local time.
async function open(hhmm, seed = {}, scheme = 'light') {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Asia/Kuala_Lumpur', colorScheme: scheme });
  await ctx.addInitScript(([s]) => { localStorage.setItem('tenang:setup', '{"done":true}'); for (const [k, v] of Object.entries(s)) localStorage.setItem('tenang:' + k, JSON.stringify(v)); }, [seed]);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.clock.setFixedTime(new Date(`2026-11-20T${hhmm}:00+08:00`));
  await page.goto(base + '/#home'); await page.waitForTimeout(500);
  page.errs = errs; page.ctx = ctx; return page;
}
const text = (p, s) => p.textContent(s);

// 1. Morning, nothing done: the reading comes first, chips show the loop, no rhythm yet
let p = await open('08:00');
assert.match(await text(p, '#tdTitle'), /morning reading/i);
assert.equal((await text(p, '#tdGo')).trim(), 'Log reading');
assert.equal(await text(p, '#tdCount'), '0/4');
assert.equal(await p.locator('.td-chip').count(), 4);
assert.equal(await p.locator('.td-chip.s-due').count(), 2); assert.equal(await p.locator('.td-chip.s-next').count(), 2);
assert.equal((await text(p, '#tdRhythm')).trim(), '');
ok('08:00 fresh user: morning reading is the focus, 0/4, two due and two coming up, no rhythm shown');
await p.screenshot({ path: 'shots/companion-morning.png' });

// 2. Log via the 10-second sheet: first reading
await p.click('#tdGo'); assert.ok(await p.isVisible('#qlog'));
assert.equal(await p.inputValue('#qlS'), ''); // never prefill defaults for a brand-new user
await p.click('[data-st=qlS][data-d="1"]'); assert.equal(await p.inputValue('#qlS'), '120');
await p.click('[data-st=qlS][data-d="1"]'); await p.click('[data-st=qlS][data-d="1"]'); assert.equal(await p.inputValue('#qlS'), '122');
await p.click('[data-st=qlD][data-d="-1"]'); assert.equal(await p.inputValue('#qlD'), '80');
// press and hold repeats
const plus = p.locator('[data-st=qlD][data-d="1"]'); const box = await plus.boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(900); await p.mouse.up();
const held = +(await p.inputValue('#qlD')); assert.ok(held >= 85, 'hold repeats, got ' + held);
await p.fill('#qlD', '82');
assert.equal(await p.inputValue('#qlCtx'), 'Morning, before meds');
await p.click('#qlSave'); await p.waitForTimeout(200);
assert.match(await text(p, '#qlResult'), /122\/82/); assert.match(await text(p, '#qlResult'), /First reading saved/);
await p.screenshot({ path: 'shots/companion-qlog-result.png' });
ok('quick log: no default prefill, steppers, press-and-hold, auto context, first-reading feedback');
await p.click('[data-ql-close]'); await p.waitForTimeout(300);
assert.equal(await text(p, '#tdCount'), '1/4'); assert.equal(await p.locator('.td-chip.s-done').count(), 1);
assert.match(await text(p, '#tdTitle'), /slow breaths/i); assert.equal((await text(p, '#tdGo')).trim(), 'Begin breathing');
ok('after saving, the reading step is ticked, ring is 1/4 and the focus moves on to breathing');
assert.deepEqual(p.errs, []); await p.ctx.close();

// 3. Second reading compares with the recent average and offers breathing for an elevated one
p = await open('21:10', { readings: [{ s: 130, d: 84, t: Date.parse('2026-11-19T08:00:00+08:00'), c: 'x' }, { s: 134, d: 86, t: Date.parse('2026-11-18T08:00:00+08:00'), c: 'x' }], 'remdone:2026-11-20': { amBP: true, amBr: true, pmBr: true } });
assert.match(await text(p, '#tdTitle'), /evening reading/i);
await p.click('#tdGo'); assert.equal(await p.inputValue('#qlS'), '130'); assert.equal(await p.inputValue('#qlCtx'), 'Evening'); // prefilled from the last reading
await p.fill('#qlS', '118'); await p.fill('#qlD', '76'); await p.click('#qlSave');
const r = await text(p, '#qlResult'); assert.match(r, /14 lower on top than your recent average of 132\/85/); assert.match(r, /Normal/);
assert.ok(await p.isVisible('#qlResult svg.ql-spark'));
ok('evening reading: prefilled from last, compared with the 7-reading average (132/85), sparkline shown');
await p.click('[data-ql-close]'); await p.waitForTimeout(300);
assert.match(await text(p, '#tdTitle'), /today done/i); assert.equal(await text(p, '#tdCount'), '4/4'); assert.match(await text(p, '#tdSub'), /Last reading 118\/76/);
ok('everything done: "That’s today done", 4/4, summary mentions the last reading');
await p.screenshot({ path: 'shots/companion-done.png' }); await p.ctx.close();

// 4. Severe reading shows the urgent guidance, not a pat on the back
p = await open('08:00'); await p.click('#tdGo'); await p.fill('#qlS', '190'); await p.fill('#qlD', '125'); await p.click('#qlSave');
assert.match(await text(p, '#qlResult'), /severe range/); assert.match(await text(p, '#qlResult'), /emergency services/);
ok('severe reading keeps the urgent-reading guidance'); await p.ctx.close();

// 5. Validation
p = await open('08:00'); await p.click('#tdGo'); await p.fill('#qlS', '80'); await p.fill('#qlD', '90'); await p.click('#qlSave');
assert.match(await text(p, '#qlMsg'), /top number should be higher|unusual/); await p.fill('#qlS', '125'); await p.fill('#qlD', '130'); await p.click('#qlSave');
assert.match(await text(p, '#qlMsg'), /higher than the bottom/); assert.equal((await p.evaluate(() => JSON.parse(localStorage.getItem('tenang:readings') || '[]').filter(r => !r.ex).length)), 0);
ok('bad input is refused and nothing is saved'); await p.ctx.close();

// 6. Welcome back after a gap, and the forgiving rhythm
p = await open('08:00', { mins: { [day(5)]: 6, [day(6)]: 5 } });
assert.match(await text(p, '#tdTitle'), /Welcome back/); assert.match(await text(p, '#tdSub'), /No catching up/);
ok('5 days away: "Welcome back. No catching up needed."');
await p.screenshot({ path: 'shots/companion-welcome.png' }); await p.ctx.close();
// one missed day is forgiven (run continues), two end it
p = await open('08:00', { mins: { [day(1)]: 5, [day(3)]: 5, [day(4)]: 5, [day(5)]: 5 } });
assert.match(await text(p, '#tdRhythm'), /4 of 7 days/); assert.match(await text(p, '#tdRhythm'), /4-day rhythm/);
assert.equal(await p.locator('.td-dots i.on').count(), 4);
ok('a single missed day keeps the rhythm going (4 active days, 4-day rhythm)'); await p.ctx.close();
p = await open('08:00', { mins: { [day(1)]: 5, [day(4)]: 5, [day(5)]: 5 } });
assert.doesNotMatch(await text(p, '#tdRhythm'), /rhythm/); assert.match(await text(p, '#tdRhythm'), /3 of 7 days/);
ok('two missed days in a row end the run, with no scolding'); await p.ctx.close();

// 7. Late steps become "skipped" (not nagging) and stay tappable; ring ignores them
p = await open('15:00');
assert.equal(await p.locator('.td-chip.s-missed').count(), 2); assert.equal(await p.locator('.td-chip.s-next').count(), 2);
assert.equal(await text(p, '#tdCount'), '0/2'); assert.match(await text(p, '#tdSub'), /Next up: evening breathing at 20:30/);
await p.click('.td-chip.s-missed >> nth=0'); assert.ok(await p.isVisible('#qlog')); await p.keyboard.press('Escape'); assert.ok(!(await p.isVisible('#qlog')));
ok('15:00: morning steps are skipped, ring counts only what is still ahead, skipped chip still opens, Escape closes'); await p.ctx.close();

// 7b. "Done" tapped on a notification while the app was closed is applied when the app opens
p = await open('08:00');
assert.equal(await text(p, '#tdCount'), '0/4');
await p.evaluate(async () => { const c = await caches.open('tenang-pending'); const d = new Date(); const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); await c.put('/__pending/done/amBr/1', new Response(JSON.stringify({ k: 'amBr', day }))); await c.put('/__pending/done/amBP/2', new Response(JSON.stringify({ k: 'amBP', day: '2020-01-01' }))); });
await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await p.waitForTimeout(500);
assert.equal(await text(p, '#tdCount'), '1/4'); assert.equal(await p.evaluate(async () => (await (await caches.open('tenang-pending')).keys()).length), 0);
ok('pending "Done" from a notification ticks today\'s step; a stale note from another day is discarded'); await p.ctx.close();

// 8. Dark mode + no errors
p = await open('08:00', {}, 'dark'); await p.screenshot({ path: 'shots/companion-dark.png' });
const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(over <= 1);
assert.deepEqual(p.errs, []); ok('dark mode: no horizontal overflow, no page errors'); await p.ctx.close();
await b.close(); srv.close(); console.log('companion tests passed');
