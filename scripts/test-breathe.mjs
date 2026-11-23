// Breathe tab: the first screen holds everything needed to start (patterns, the stone, Begin, duration, what the rhythm is);
// secondary things (sound/measuring, the lung diagram) are folded but fully working. Guards against the page growing deep again.
// Usage: node scripts/test-breathe.mjs   (shots/breathe-*.png)
import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { chromium } from 'playwright';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, r) => { const f = q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1); if (!existsSync(f) || !statSync(f).isFile()) { r.statusCode = 404; return r.end(); } r.setHeader('Content-Type', TYPES[extname(f)] || 'application/octet-stream'); r.end(readFileSync(f)); }).listen(0);
const base = `http://localhost:${srv.address().port}`;
const b = await chromium.launch(); let n = 0; const ok = m => console.log('ok', ++n, m);
async function open({ w = 390, h = 844, scheme = 'light', seed = {} } = {}) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, timezoneId: 'Asia/Kuala_Lumpur', colorScheme: scheme });
  await ctx.addInitScript(([s]) => { localStorage.setItem('tenang:setup', '{"done":true}'); if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem('tenang:' + k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } }, [seed]);
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); p.ctx = ctx;
  await p.goto(base + '/#breathe'); await p.waitForTimeout(800); return p;
}
const geo = (p, sels) => p.evaluate(sels => { const nav = document.querySelector('.nav').getBoundingClientRect().top, o = { navTop: nav, vh: innerHeight, page: document.querySelector('#v-breathe').scrollHeight }; for (const s of sels) { const e = document.querySelector(s); if (!e) { o[s] = null; continue; } const r = e.getBoundingClientRect(); o[s] = { top: r.top + scrollY, bottom: r.bottom + scrollY, w: r.width, h: r.height }; } return o; }, sels);

// 1. The first screen: what you need to start is above the tab bar on every phone size
const KEY = ['#chips', '#stage', '#startBtn', '#durSeg'];
for (const [w, h, info] of [[430, 932, true], [390, 844, true], [360, 740, true], [360, 640, false], [320, 568, false]]) {
  const p = await open({ w, h }); const g = await geo(p, [...KEY, '#pName', '#pRhythm', '#pBest']);
  for (const s of KEY) assert.ok(g[s] && g[s].bottom <= g.navTop + 1, `${w}x${h}: ${s} ends at ${g[s] && Math.round(g[s].bottom)}, tab bar starts at ${Math.round(g.navTop)}`);
  if (info) for (const s of ['#pName', '#pRhythm', '#pBest']) assert.ok(g[s].bottom <= g.navTop + 1, `${w}x${h}: ${s} (what this rhythm is) should be above the fold`);
  assert.ok(g['#stage'].h >= 185 && g['#stage'].h <= 255, `${w}x${h}: stage ${g['#stage'].h}px`);
  await p.ctx.close();
}
ok('430x932, 390x844, 360x740: patterns, the stone, Begin, duration and the rhythm name / best-for / timing bar are all above the tab bar; 360x640 and 320x568: patterns, stone and Begin are');

// 2. The page is no longer deep
let p = await open(); const g2 = await geo(p, []); assert.ok(g2.page / g2.vh <= 1.5, `Breathe is ${(g2.page / g2.vh).toFixed(2)} screens`); assert.ok(g2.page <= 1250, g2.page + 'px');
ok(`page depth ${(g2.page / g2.vh).toFixed(2)} screens at 390x844 (was 2.15)`);
await p.screenshot({ path: 'shots/breathe-390.png' });

// 3. Compact pattern cards: all six reachable by swiping, one line each; choosing one updates everything
assert.equal(await p.locator('#chips .pcard').count(), 6);
const ch = await p.$$eval('#chips .pcard', e => e.map(c => c.getBoundingClientRect().height)); assert.ok(Math.max(...ch) <= 90, 'cards ' + Math.max(...ch));
const names = await p.$$eval('#chips .pcard b', e => e.map(x => x.textContent)); assert.ok(names.includes('Box breathing') && names.includes('Physiological sigh'));
for (const nm of names) { await p.click(`#chips .pcard:has(b:text-is("${nm}"))`); await p.waitForTimeout(150); assert.equal(await p.textContent('#pName'), nm); assert.match(await p.textContent('#bpm'), /breaths\/min/); assert.equal(await p.getAttribute(`#chips .pcard:has(b:text-is("${nm}"))`, 'aria-pressed'), 'true'); }
ok('six single-line pattern cards (<= 90px tall); picking each updates the rhythm name, breaths/min and the pressed state');

// 4. The stone still works: tapping it begins, the phase and clock move, tapping again pauses
await p.click('#chips .pcard:has(b:text-is("Resonance"))'); assert.equal((await p.textContent('#phase')).trim(), 'Ready');
await p.click('#stage'); await p.waitForTimeout(1300); const ph = (await p.textContent('#phase')).trim(); assert.notEqual(ph, 'Ready'); assert.equal((await p.textContent('#startBtn')).trim(), 'Pause'); const c1 = await p.textContent('#clock');
await p.waitForTimeout(1200); assert.notEqual(await p.textContent('#clock'), c1);
await p.click('#stage'); await p.waitForTimeout(300); assert.equal((await p.textContent('#phase')).trim(), 'Paused');
ok('tapping the stone starts the session (phase, countdown move) and tapping again pauses it');
assert.deepEqual(p.errs, []);

// 5. Sound and measuring: folded, summarised, fully working
assert.ok(!(await p.$eval('#opts', d => d.open))); assert.equal((await p.textContent('#optsSum')).trim(), 'Silent');
await p.click('#opts > summary'); assert.ok(await p.isVisible('#sndSeg')); assert.ok(await p.isVisible('#ppOn') || await p.isVisible('.pp-toggle'));
await p.click('#sndSeg [data-s=bell]'); assert.equal((await p.textContent('#optsSum')).trim(), 'Bell'); assert.ok((await p.textContent('#sndHint')).length > 5);
await p.click('.pp-toggle'); assert.equal((await p.textContent('#optsSum')).trim(), 'Bell · measuring');
await p.click('#opts > summary'); assert.ok(!(await p.isVisible('#sndSeg')));
await p.reload(); await p.waitForTimeout(700); assert.equal((await p.textContent('#optsSum')).trim(), 'Bell · measuring');
ok('"Sound and measuring" is folded with a live summary (Silent -> Bell -> Bell · measuring) that survives a reload');
await p.click('#startBtn'); await p.waitForTimeout(400); assert.ok(await p.isVisible('#pp')); assert.match(await p.textContent('#ppEy'), /Before you begin/);
await p.fill('#ppS', '130'); await p.fill('#ppD', '84'); await p.click('#ppSkip'); await p.waitForTimeout(900); assert.ok(!(await p.isVisible('#pp')));
ok('with measuring on, Begin opens the before-reading panel even though the options are folded, and Skip starts the session'); await p.ctx.close();

// 6. The rhythm diagram is one tap away and live
p = await open(); assert.ok(!(await p.$eval('#diaFold', d => d.open))); assert.equal((await p.textContent('#diaMode')).trim(), 'Preview');
await p.click('#diaFold > summary'); assert.ok(await p.isVisible('#lungSvg')); assert.ok((await p.$$eval('#lungSvg *', e => e.length)) > 5); assert.ok(!(await p.isVisible('#boxSvg')));
await p.click('#chips .pcard:has(b:text-is("Box breathing"))'); await p.waitForTimeout(250); assert.ok(await p.isVisible('#boxSvg')); assert.ok((await p.$$eval('#boxSvg *', e => e.length)) > 3);
await p.click('#stage'); await p.waitForTimeout(900); assert.equal((await p.textContent('#diaMode')).trim(), 'Live');
await p.screenshot({ path: 'shots/breathe-diagram-open.png', fullPage: false });
ok('the diagram opens on demand, shows the lung curve (or the square for box breathing) and switches to "Live" while breathing'); assert.deepEqual(p.errs, []); await p.ctx.close();

// 7. Keyboard and screen readers: the title is still there, the stone is operable from the keyboard
p = await open(); assert.match(await p.textContent('#v-breathe > h2.sr-only'), /Breath studio/); await p.focus('#stage'); await p.keyboard.press('Enter'); await p.waitForTimeout(1100); assert.notEqual((await p.textContent('#phase')).trim(), 'Ready');
ok('the hidden heading remains for screen readers and the stone starts from the keyboard'); await p.ctx.close();

// 8. Dark mode and small phones: no overflow, no clipped text on the stone
for (const [w, h, scheme] of [[390, 844, 'dark'], [320, 568, 'light']]) { p = await open({ w, h, scheme }); const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(over <= 1, `${w}: overflow ${over}`);
  const t = await p.evaluate(() => { const s = document.querySelector('#stage').getBoundingClientRect(), t = document.querySelector('.stage-text').getBoundingClientRect(), m = document.querySelector('.stage-meta').getBoundingClientRect(); return { within: t.left >= s.left && t.right <= s.right && t.top >= s.top && t.bottom <= s.bottom, noOverlapMeta: document.querySelector('#count').getBoundingClientRect().bottom <= m.top + 1 }; });
  assert.ok(t.within, 'stage text inside the stage'); assert.ok(t.noOverlapMeta, 'stage text clear of the breaths/min row'); if (scheme === 'dark') await p.screenshot({ path: 'shots/breathe-dark.png' }); assert.deepEqual(p.errs, []); await p.ctx.close(); }
ok('dark mode and a 320px phone: no horizontal overflow, the stone text stays inside the stage and clear of the meta row');
await b.close(); srv.close(); console.log('breathe tests passed');
