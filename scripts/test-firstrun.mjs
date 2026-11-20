// First run: a brand-new user is asked who Tenang is for (optional), then for their check-in times and reminders.
// Everyone else is never interrupted. The choice is made once and then shapes Today. Fake clock, Asia/Kuala_Lumpur.
// Usage: node scripts/test-firstrun.mjs   (shots/firstrun-*.png)
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
async function open({ seed = {}, hash = '#home', ua, scheme = 'light', iso = '2026-11-20T08:00:00+08:00', w = 390, h = 844 } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, timezoneId: 'Asia/Kuala_Lumpur', colorScheme: scheme, ...(ua ? { userAgent: ua } : {}) });
  await ctx.addInitScript(([s]) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem('tenang:' + k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } }, [seed]);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); p.ctx = ctx;
  await p.clock.setFixedTime(new Date(iso)); await p.goto(base + '/' + hash); await p.waitForTimeout(1300); return p;
}
const store = (p, k) => p.evaluate(k => { const v = localStorage.getItem('tenang:' + k); return v === null ? null : JSON.parse(v); }, k);
const vis = (p, s) => p.isVisible(s);
const settle = p => p.waitForTimeout(700); // let the sheet's slide-up finish
const pickProfile = async (p, sex, stage) => { await p.click(`#suSex [data-sex=${sex}]`); if (stage) await p.click(`#suStage [data-stage=${stage}]`); };

// 1. Step 1 asks who Tenang is for; tiles and the stage chips behave
let p = await open();
assert.ok(await vis(p, '#setup')); assert.ok(await vis(p, '#suStep1')); assert.ok(!(await vis(p, '#suStep2'))); assert.match(await p.textContent('#suTitle'), /Welcome to Tenang/);
assert.deepEqual(await p.$$eval('#suSex button span', e => e.map(x => x.textContent)), ['Female', 'Male', 'Prefer not to say']);
assert.ok(!(await vis(p, '#suStageBox'))); await p.click('#suSex [data-sex=male]'); assert.ok(!(await vis(p, '#suStageBox')));
await p.click('#suSex [data-sex=female]'); assert.ok(await vis(p, '#suStageBox')); assert.equal(await p.locator('#suStage .chip').count(), 5); assert.equal(await p.getAttribute('#suSex [data-sex=male]', 'aria-pressed'), 'false');
await settle(p); await p.screenshot({ path: 'shots/firstrun-step1-female.png' });
ok('step 1: "Who is Tenang for?" with three large choices; life-stage chips appear only for Female'); await p.ctx.close();

// 2. Female + perimenopause, then times: both land, and Today visibly changes
p = await open(); await pickProfile(p, 'female', 'peri'); await p.click('#suNext'); await p.waitForTimeout(300);
assert.ok(!(await vis(p, '#suStep1'))); assert.ok(await vis(p, '#suStep2')); assert.match(await p.textContent('#suTitle'), /Your day/);
const early = await store(p, 'profile'); assert.equal(early.sex, 'female'); assert.equal(early.stage, 'peri'); // saved the moment they move on
assert.equal(await p.inputValue('#suAm'), '07:00'); assert.equal(await p.inputValue('#suPm'), '20:30');
await settle(p); await p.screenshot({ path: 'shots/firstrun-light.png' });
await p.fill('#suAm', '06:45'); await p.fill('#suPm', '21:15'); await p.click('#suGo'); await p.waitForTimeout(400);
assert.ok(!(await vis(p, '#setup')));
const rem = await store(p, 'rem'); assert.deepEqual([rem.amBP.t, rem.amBr.t, rem.pmBr.t, rem.pmBP.t], ['06:45', '07:00', '21:15', '21:45']);
assert.equal((await store(p, 'setup')).skipped, false);
await p.evaluate(() => { location.hash = '#home'; }); await p.waitForTimeout(300);
assert.ok(await vis(p, '#youToday')); assert.equal((await p.textContent('#ytTitle')).trim(), 'Midlife and menopause'); assert.ok((await p.textContent('#ytTip')).length > 40); assert.ok(!(await vis(p, '#tailorPrompt')));
assert.equal(await p.textContent('#ytGlyph'), '女');
await p.waitForTimeout(500); await p.screenshot({ path: 'shots/firstrun-today-tailored.png' });
await p.click('#youToday'); await p.waitForTimeout(400); assert.equal(await p.evaluate(() => location.hash), '#you'); assert.equal(await p.textContent('#youTitle'), 'Midlife and menopause');
await p.reload(); await p.waitForTimeout(1300); assert.ok(!(await vis(p, '#setup')));
ok('female / perimenopause then 06:45 / 21:15: profile saved on Next, reminders set, Today shows a "For you" card with a tip that opens the guide, never asked again'); assert.deepEqual(p.errs, []); await p.ctx.close();

// 3. Skipping the times never loses the profile
p = await open(); await pickProfile(p, 'male'); await p.click('#suNext'); await p.click('#suSkip'); await p.waitForTimeout(400);
assert.equal((await store(p, 'profile')).sex, 'male'); assert.equal((await store(p, 'setup')).skipped, true); assert.equal(await store(p, 'rem'), null);
assert.ok(await vis(p, '#youToday')); assert.equal((await p.textContent('#ytTitle')).trim(), "Men's blood pressure"); assert.equal(await p.textContent('#ytGlyph'), '男');
ok('male, then Skip on the times step: profile kept, default reminders, "For you" card on Today'); await p.ctx.close();

// 4. Prefer not to say / not choosing / skipping everything: nothing tailored, nothing nagging on day one
p = await open(); await pickProfile(p, 'general'); await p.click('#suNext'); await p.click('#suGo'); await p.waitForTimeout(400);
assert.equal((await store(p, 'profile')).sex, 'general'); assert.ok(!(await vis(p, '#youToday'))); assert.ok(!(await vis(p, '#tailorPrompt')));
await p.reload(); await p.waitForTimeout(1300); assert.ok(!(await vis(p, '#tailorPrompt'))); await p.ctx.close();
p = await open(); await p.click('#suNext'); await p.click('#suGo'); await p.waitForTimeout(400); assert.equal(await store(p, 'profile'), null); assert.ok(!(await vis(p, '#youToday'))); await p.ctx.close();
p = await open(); await p.click('#suSkip'); await p.waitForTimeout(300); assert.equal(await store(p, 'profile'), null); assert.equal((await store(p, 'setup')).skipped, true); assert.ok(!(await vis(p, '#setup')));
await p.reload(); await p.waitForTimeout(1300); assert.ok(!(await vis(p, '#setup')));
ok('"Prefer not to say" = not tailored and never asked again; Next with no choice or Skip leaves no profile; first run is never repeated');
p.ctx.close();
p = await open(); await p.keyboard.press('Escape'); await p.waitForTimeout(300); assert.ok(!(await vis(p, '#setup'))); assert.equal((await store(p, 'setup')).skipped, true);
ok('Escape counts as Skip (never a trap)'); await p.ctx.close();

// 5. Pregnancy chosen at first run: the tip is the hand-off
p = await open(); await pickProfile(p, 'female', 'preg'); await p.click('#suNext'); await p.click('#suGo'); await p.waitForTimeout(400);
assert.match(await p.textContent('#ytTitle'), /Pregnancy and blood pressure/); assert.match(await p.textContent('#ytTip'), /Share every reading with your midwife or doctor/); assert.match(await p.textContent('#ytTip'), /same day/);
ok('pregnancy at first run: Today\'s card is the care-team hand-off'); await p.ctx.close();

// 6. The daily tip is steady within a day and rotates across days
const tips = new Set();
for (const day of ['20', '21', '22', '23', '24', '25']) { p = await open({ seed: { setup: { done: true }, profile: { sex: 'female', stage: 'peri', at: 1 }, readings: [], visits: 5 }, iso: `2026-11-${day}T08:00:00+08:00` }); tips.add((await p.textContent('#ytTip')).trim()); await p.ctx.close(); }
assert.ok(tips.size >= 3, 'tips rotate: ' + tips.size);
p = await open({ seed: { setup: { done: true }, profile: { sex: 'male', at: 1 }, visits: 5, readings: [{ s: 126, d: 80, t: 1, c: 'x' }] } }); const t1 = await p.textContent('#ytTip'); await p.reload(); await p.waitForTimeout(800); assert.equal(await p.textContent('#ytTip'), t1);
await p.ctx.close();
ok('the "For you" tip is the same all day and changes day to day (at least 3 different tips over 6 days)');

// 7. Existing users: never shown first run; invited prominently on Today, directly under the Today card
const R = { s: 126, d: 80, p: 68, t: new Date('2026-11-18T08:00:00+08:00').getTime(), c: 'Morning' };
p = await open({ seed: { readings: [R], visits: 5 } }); assert.ok(!(await vis(p, '#setup'))); assert.equal((await store(p, 'setup')).existing, true);
assert.ok(await vis(p, '#tailorPrompt')); assert.match(await p.textContent('#tailorPrompt'), /you only set it once/i);
const order = await p.evaluate(() => { const ids = [...document.querySelectorAll('#v-home > *')].filter(e => !e.hidden && e.offsetHeight > 0).map(e => e.id || e.className.split(' ')[0]); return ids.slice(0, 3); });
assert.equal(order[0], 'todayCard'); assert.ok(['tailorPrompt'].includes(order[1]) || ['tailorPrompt'].includes(order[2]), 'invite sits right under the Today card: ' + order);
await p.click('#tpGo'); assert.ok(await vis(p, '#profile')); await p.ctx.close();
p = await open({ seed: { mins: { '2026-11-19': 5 } } }); assert.ok(!(await vis(p, '#setup'))); await p.ctx.close();
p = await open({ seed: { 'remdone:2026-11-19': { amBr: true } } }); assert.ok(!(await vis(p, '#setup'))); await p.ctx.close();
p = await open({ seed: { setup: { done: true } } }); assert.ok(!(await vis(p, '#setup'))); await p.ctx.close();
ok('existing users (readings, minutes, completed steps, saved setup) never see first run; those without a profile get a prominent invite right under the Today card');

// 8. Shortcuts bypass first run
p = await open({ hash: '#qlog' }); assert.ok(!(await vis(p, '#setup'))); assert.ok(await vis(p, '#qlog')); await p.ctx.close();
ok('the "Log a reading" shortcut on a fresh install goes straight to logging');

// 9. Reminders line is honest about the device
p = await open({ ua: IOS }); await p.click('#suNext'); await p.waitForTimeout(300);
assert.match(await p.textContent('#suNote'), /add Tenang to your Home Screen/i); assert.ok(!(await vis(p, '#suBell'))); await p.ctx.close();
ok('iPhone in a browser tab: step 2 explains Add to Home Screen first and hides the button');

// 10. Dark mode and a small phone: both steps fit, with the main button reachable
p = await open({ scheme: 'dark' }); await settle(p); await p.screenshot({ path: 'shots/firstrun-dark.png' }); await p.ctx.close();
const small = await b.newContext({ viewport: { width: 360, height: 640 }, timezoneId: 'Asia/Kuala_Lumpur' }); const sp = await small.newPage(); await sp.clock.setFixedTime(new Date('2026-11-20T08:00:00+08:00')); await sp.goto(base + '/#home'); await sp.waitForTimeout(1300);
assert.ok(await vis(sp, '#suNext'), 'Next visible on 640px before any choice');
await sp.click('#suSex [data-sex=female]'); await sp.locator('#suNext').scrollIntoViewIfNeeded(); assert.ok(await vis(sp, '#suNext')); await sp.click('#suStage [data-stage=peri]'); await sp.click('#suNext'); await sp.waitForTimeout(400);
assert.ok(await vis(sp, '#suGo'), 'Start visible on 640px'); assert.ok((await sp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1); await small.close();
ok('360x640 phone: both steps fit, Next and Start are reachable even with the stage chips open; dark mode renders');
await b.close(); srv.close(); console.log('first-run tests passed');
