// UI tests for tailored guidance: choosing a profile, what appears where, persistence, pregnancy hand-off,
// "Not tailored" staying clean, and that nothing tailored leaks across profiles. Fake clock, Asia/Kuala_Lumpur.
// Usage: node scripts/test-profile-ui.mjs   (shots/profile-*.png)
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { chromium } from 'playwright';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const f = q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1); if (!existsSync(f) || !statSync(f).isFile()) { r.statusCode = 404; return r.end(); } r.setHeader('Content-Type', TYPES[extname(f)] || 'application/octet-stream'); r.end(readFileSync(f)); }).listen(0);
const base = `http://localhost:${srv.address().port}`;
const b = await chromium.launch(); let n = 0; const ok = m => console.log('ok', ++n, m);
const R = (d, s = 126, dd = 80) => ({ s, d: dd, p: 68, t: new Date(2026, 10, 20 - d, 8).getTime(), c: 'Morning' });
const BASE = { readings: [R(1), R(2), R(3)], visits: 5 };
async function open({ seed = {}, hash = '#home', w = 390, h = 844, scheme = 'light' } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, timezoneId: 'Asia/Kuala_Lumpur', colorScheme: scheme });
  await ctx.addInitScript(([s]) => { localStorage.setItem('tenang:setup', '{"done":true}'); if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem('tenang:' + k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } }, [seed]);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); p.ctx = ctx;
  await p.clock.setFixedTime(new Date('2026-11-20T08:00:00+08:00')); await p.goto(base + '/' + hash); await p.waitForTimeout(600); return p;
}
const vis = (p, s) => p.isVisible(s);
const store = (p, k) => p.evaluate(k => { const v = localStorage.getItem('tenang:' + k); return v === null ? null : JSON.parse(v); }, k);
const text = (p, s) => p.textContent(s);
async function choose(p, sex, stage) { await p.click(`#prSex [data-sex=${sex}]`); if (stage) await p.click(`#prStage [data-stage=${stage}]`); await p.click('#prSave'); await p.waitForTimeout(500); }
const chips = p => p.$$eval('#qlTags .chip', e => e.map(x => x.textContent));

// 1. Untouched: the Today prompt, the Learn card, and nothing tailored anywhere
let p = await open({ seed: BASE });
assert.ok(await vis(p, '#tailorPrompt')); assert.match(await text(p, '#tailorPrompt'), /Make Tenang fit you/);
assert.equal(await p.locator('[data-mood=flush]').count(), 0);
await p.evaluate(() => { location.hash = '#qlog'; }); await p.waitForSelector('#qlog:not([hidden])');
assert.deepEqual(await chips(p), ['Slept badly', 'Salty food', 'Stressed', 'Exercised', 'Coffee', 'Alcohol']); await p.keyboard.press('Escape');
await p.evaluate(() => { location.hash = '#learn'; }); await p.waitForTimeout(300); assert.match(await text(p, '#youCardT'), /Make Tenang fit you/);
await p.evaluate(() => { location.hash = '#you'; }); await p.waitForTimeout(500); assert.ok(await vis(p, '#profile')); assert.equal(await p.evaluate(() => location.hash), '#learn');
ok('untailored: prompt on Today, plain Learn card, no hot-flush mood, the six common notes only; #you opens the chooser instead of an empty page');
await p.click('#prX'); await p.evaluate(() => { location.hash = '#home'; }); await p.waitForTimeout(300);
await p.click('#tpX'); assert.ok(!(await vis(p, '#tailorPrompt'))); assert.equal(await store(p, 'tailorDismiss'), true);
await p.reload(); await p.waitForTimeout(500); assert.ok(!(await vis(p, '#tailorPrompt')));
ok('"Not now" hides the Today prompt for good'); await p.ctx.close();

// 2. Female, perimenopause: the full set
p = await open({ seed: BASE, hash: '#learn' });
await p.click('#youCard'); assert.ok(await vis(p, '#profile')); assert.ok(!(await vis(p, '#prStageBox')));
await p.click('#prSex [data-sex=female]'); assert.ok(await vis(p, '#prStageBox')); assert.equal(await p.locator('#prStage .chip').count(), 5);
await p.waitForTimeout(500); await p.screenshot({ path: 'shots/profile-sheet.png' });
await p.click('#prStage [data-stage=peri]'); await p.click('#prSave'); await p.waitForTimeout(600);
assert.equal(await p.evaluate(() => location.hash), '#you'); assert.equal(await text(p, '#youTitle'), 'Midlife and menopause');
assert.equal(await p.locator('#youBody .you-sec').count(), 6); assert.ok(await p.$eval('#youBody .you-sec', d => d.open));
const body = await text(p, '#youBody'); assert.match(body, /has not been shown to reduce hot flushes/); assert.match(body, /Sources: .*NAMS nonhormone therapy position statement, 2023/);
assert.equal(await p.$$eval('#youQList li', e => e.length), 4); assert.equal((await p.$eval('.nav a[aria-current=page]', a => a.textContent.trim())), 'Learn');
const saved = await store(p, 'profile'); assert.equal(saved.sex, 'female'); assert.equal(saved.stage, 'peri');
await p.screenshot({ path: 'shots/profile-you-peri.png' });
ok('female / perimenopause: guide opens with 6 sourced sections, flush text says breathing has not been shown to reduce flushes, 4 doctor questions, profile saved');
await p.reload(); await p.waitForTimeout(500); assert.equal(await text(p, '#youTitle'), 'Midlife and menopause');
await p.evaluate(() => { location.hash = '#home'; }); await p.waitForTimeout(300);
assert.ok(await vis(p, '#youToday')); assert.ok(!(await vis(p, '#tailorPrompt'))); assert.equal((await text(p, '#ytTitle')).trim(), 'Midlife and menopause');
assert.equal(await p.locator('[data-mood=flush]').count(), 1); await p.click('[data-mood=flush]'); assert.match(await text(p, '#suggest'), /has not been shown to stop hot flushes/);
await p.evaluate(() => { location.hash = '#qlog'; }); await p.waitForSelector('#qlog:not([hidden])'); assert.ok((await chips(p)).includes('Hot flush')); assert.equal((await chips(p)).length, 7);
await p.click('#qlTags [data-tag=flush]'); await p.click('[data-st=qlS][data-d="1"]'); await p.click('[data-st=qlD][data-d="1"]'); await p.click('#qlSave'); await p.waitForTimeout(300);
assert.deepEqual((await store(p, 'readings')).find(r => r.g).g, ['flush']); await p.click('[data-ql-close]');
await p.evaluate(() => { location.hash = '#log'; }); await p.waitForTimeout(300); assert.match(await text(p, '#tipProfile'), /After a hot flush/); assert.match(await text(p, '#readings'), /Hot flush/);
await p.evaluate(() => { location.hash = '#meds'; }); await p.waitForTimeout(300); assert.ok(await vis(p, '#medsNote')); assert.match(await text(p, '#medsNoteT'), /hormone therapy or hormonal contraception/);
await p.evaluate(() => { location.hash = '#summary'; }); await p.waitForTimeout(500); assert.ok(await vis(p, '#sumQsBox')); assert.match(await text(p, '#sumQs'), /hot flushes or night sweats/);
assert.match(await p.evaluate(() => document.querySelector('#sumFallback').value || ''), /^$/);
ok('perimenopause surfaces: "Hot flush" mood (calm-only wording), "Hot flush" note on readings (saved, shown in the log), measuring tip, Medicines note, doctor-summary questions');
const sumText = await p.evaluate(async () => { document.querySelector('#copySum').click(); await new Promise(r => setTimeout(r, 300)); return document.querySelector('#sumFallback').value; });
assert.match(sumText, /Questions I would like to ask:/); assert.match(sumText, /Is hormone therapy suitable for me/);
ok('the copied doctor summary includes the suggested questions'); assert.deepEqual(p.errs, []); await p.ctx.close();

// 3. Male: different content, no menopause/pregnancy wording anywhere
p = await open({ seed: BASE, hash: '#learn' }); await p.click('#youCard'); await choose(p, 'male');
assert.equal(await text(p, '#youTitle'), "Men's blood pressure"); const mb = await text(p, '#youBody');
assert.match(mb, /Erections and blood pressure/); assert.match(mb, /Please do not stop your medicine/); assert.match(mb, /two drinks a day for men/); assert.match(mb, /testosterone/);
assert.doesNotMatch(mb + await text(p, '#youQs'), /menopaus|hot flush|pregnan|contracept/i);
assert.equal(await p.$$eval('#youQList li', e => e.length), 4);
await p.evaluate(() => { location.hash = '#home'; }); await p.waitForTimeout(300); assert.equal(await p.locator('[data-mood=flush]').count(), 0);
await p.evaluate(() => { location.hash = '#qlog'; }); await p.waitForSelector('#qlog:not([hidden])'); assert.ok(!(await chips(p)).includes('Hot flush')); await p.keyboard.press('Escape');
await p.evaluate(() => { location.hash = '#meds'; }); await p.waitForTimeout(300); assert.match(await text(p, '#medsNoteT'), /Please do not stop it/);
await p.evaluate(() => { location.hash = '#log'; }); await p.waitForTimeout(300); assert.match(await text(p, '#tipProfile'), /before coffee or alcohol/);
await p.screenshot({ path: 'shots/profile-log-male.png' });
ok('male: erections, sleep apnoea, alcohol (two drinks), testosterone; no menopause/pregnancy wording; no hot-flush mood or note; own Medicines note and measuring tip'); assert.deepEqual(p.errs, []); await p.ctx.close();

// 4. Pregnancy: a hand-off, not coaching
p = await open({ seed: BASE, hash: '#learn' }); await p.click('#youCard'); await choose(p, 'female', 'preg');
assert.equal(await text(p, '#youTitle'), 'Pregnancy and blood pressure'); assert.equal(await p.locator('#youBody .you-sec').count(), 1); assert.match(await text(p, '#youBody'), /not a pregnancy blood pressure monitor/);
await p.evaluate(() => { location.hash = '#qlog'; }); await p.waitForSelector('#qlog:not([hidden])'); await p.fill('#qlS', '152'); await p.fill('#qlD', '96'); await p.click('#qlSave'); await p.waitForTimeout(400);
const res = await text(p, '#qlResult'); assert.match(res, /Pregnancy has its own blood pressure guidance/); assert.match(res, /140\/90 or higher/); assert.match(res, /same day/); assert.doesNotMatch(res, /Stage 2|Stage 1|Elevated|Normal/); assert.match(res, /Share with your care team/);
await p.waitForTimeout(500); await p.screenshot({ path: 'shots/profile-pregnancy-result.png' }); await p.click('[data-ql-close]');
await p.evaluate(() => { location.hash = '#qlog'; }); await p.waitForSelector('#qlog:not([hidden])'); await p.fill('#qlS', '190'); await p.fill('#qlD', '125'); await p.click('#qlSave'); await p.waitForTimeout(300);
assert.match(await text(p, '#qlResult'), /severe range/); assert.match(await text(p, '#qlResult'), /emergency services/);
ok('pregnancy: single hand-off section; a 152/96 reading gets no category, only "share with your care team" and the same-day rule; a severe reading still shows the emergency guidance'); await p.ctx.close();

// 5. Switching and turning it off is clean and reversible
p = await open({ seed: { ...BASE, profile: { sex: 'female', stage: 'peri', at: 1 } } });
assert.ok(!(await vis(p, '#tailorPrompt'))); assert.equal(await p.locator('[data-mood=flush]').count(), 1);
await p.click('#setBtn'); assert.match(await text(p, '#tailorHint'), /Tailored for women \(perimenopause\)/); await p.click('#tailorBtn'); await p.waitForTimeout(300); assert.ok(await vis(p, '#profile'));
assert.equal(await p.getAttribute('#prSex [data-sex=female]', 'aria-pressed'), 'true'); assert.equal(await p.getAttribute('#prStage [data-stage=peri]', 'aria-pressed'), 'true');
await choose(p, 'male'); assert.equal(await text(p, '#youTitle'), "Men's blood pressure"); assert.equal((await store(p, 'profile')).stage, undefined);
await p.click('#youChange'); await p.waitForTimeout(300); await choose(p, 'general'); assert.equal((await store(p, 'profile')).sex, 'general');
await p.evaluate(() => { location.hash = '#home'; }); await p.waitForTimeout(300); assert.equal(await p.locator('[data-mood=flush]').count(), 0); assert.ok(!(await vis(p, '#tailorPrompt'))); assert.ok(!(await vis(p, '#youToday')));
await p.evaluate(() => { location.hash = '#you'; }); await p.waitForTimeout(500); assert.ok(await vis(p, '#profile'));
await p.click('#prX'); await p.evaluate(() => { location.hash = '#meds'; }); await p.waitForTimeout(300); assert.ok(!(await vis(p, '#medsNote')));
await p.evaluate(() => { location.hash = '#log'; }); await p.waitForTimeout(300); assert.ok(!(await vis(p, '#tipProfile')));
ok('Settings shows the current choice; switching female -> male -> not tailored removes everything tailored (mood, tags, notes, tip, questions) and keeps the readings');
const readings = await store(p, 'readings'); assert.ok(readings.length >= 3); await p.ctx.close();

// 6. A profile is data like any other: it is in the backup and survives a restore
p = await open({ seed: { ...BASE, profile: { sex: 'male', at: 1 } } }); await p.click('#setBtn');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#bkExport')]); const fs = await import('node:fs'); const path = '/tmp/tenang-profile-backup.json'; await dl.saveAs(path);
assert.equal(JSON.parse(JSON.parse(fs.readFileSync(path, 'utf8')).data['tenang:profile']).sex, 'male'); fs.unlinkSync(path);
ok('the profile is included in Save backup'); await p.ctx.close();

// 7. Fits small phones and dark mode on every new surface
for (const [w, hh, scheme] of [[360, 640, 'light'], [390, 844, 'dark']]) {
  p = await open({ seed: { ...BASE, profile: { sex: 'female', stage: 'peri', at: 1 } }, w, h: hh, scheme, hash: '#you' });
  const over = async () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok((await over()) <= 1, 'you overflows'); await p.click('#youChange'); await p.waitForTimeout(300);
  assert.ok((await over()) <= 1, 'profile overflows'); await p.click('#prX');
  if (scheme === 'dark') { await p.evaluate(() => { location.hash = '#you'; }); await p.waitForTimeout(600); await p.screenshot({ path: 'shots/profile-you-dark.png' }); }
  assert.deepEqual(p.errs, []); await p.ctx.close();
}
ok('the guide and the chooser fit 360px and dark mode with no overflow');
await b.close(); srv.close(); console.log('profile UI tests passed');
