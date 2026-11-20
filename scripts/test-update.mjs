// End-to-end upgrade test with REAL generated Workers: a user on build A gets build B (which migrates their data),
// then a build C whose migration crashes, then goes back to the older A. Checks the update banner, that no data is
// ever lost, rollback, backup restore + undo, and service-worker cache cleanup.
// Usage: node scripts/test-update.mjs   (needs playwright; builds temp copies, touches nothing in the repo)
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const root = process.cwd();
function build(name, edit) {
  const d = mkdtempSync(join(tmpdir(), 'tenang-' + name + '-')); mkdirSync(join(d, 'scripts')); mkdirSync(join(d, 'vendor'));
  for (const f of ['index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'sw.js', 'push-server.js', 'scripts/build-worker.mjs', 'vendor/three.min.js']) cpSync(join(root, f), join(d, f));
  if (edit) { const f = join(d, 'index.html'); const before = readFileSync(f, 'utf8'); const after = edit(before); assert.notEqual(after, before, 'edit applied'); writeFileSync(f, after); }
  execFileSync('node', ['scripts/build-worker.mjs'], { cwd: d, stdio: 'pipe' });
  return d;
}
const MIG = "const MIGRATIONS=[{v:1,name:'baseline',up(st){}}];";
const A = build('A', h => h.replace('<title>Tenang</title>', '<title>Tenang A</title>'));
const B = build('B', h => h.replace('<title>Tenang</title>', '<title>Tenang B</title>').replace(MIG, "const MIGRATIONS=[{v:1,name:'baseline',up(st){}},{v:2,name:'tag',up(st){st.set('readings',st.get('readings',[]).map(r=>({...r,tagged:true})));st.set('v2marker',{ok:1})}}];"));
const C = build('C', h => h.replace('<title>Tenang</title>', '<title>Tenang C</title>').replace(MIG, "const MIGRATIONS=[{v:1,name:'baseline',up(st){}},{v:2,name:'tag',up(st){st.set('readings',st.get('readings',[]).map(r=>({...r,tagged:true})));st.set('v2marker',{ok:1})}},{v:3,name:'bad',up(st){st.set('readings',[]);st.set('half-done',1);throw new Error('migration bug')}}];"));
const mods = {}; for (const [k, d] of Object.entries({ A, B, C })) mods[k] = (await import(pathToFileURL(join(d, 'worker.js')).href)).default;
let cur = 'A';
const srv = http.createServer(async (q, r) => { const res = await mods[cur].fetch(new Request('http://localhost' + q.url), {}); res.headers.forEach((v, k) => r.setHeader(k, v)); r.statusCode = res.status; r.end(Buffer.from(await res.arrayBuffer())); }).listen(0);
const base = `http://localhost:${srv.address().port}`;
const b = await chromium.launch(); let n = 0; const ok = m => console.log('ok', ++n, m);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kuala_Lumpur', acceptDownloads: true });
const SEED = { readings: [{ s: 128, d: 82, p: 68, t: 1763600000000, c: 'Morning' }, { s: 134, d: 86, t: 1763686400000, c: 'Evening' }], rem: { amBr: { t: '07:30' } }, path: { start: '2026-11-01', done: { 1: { b1: true } } }, mins: { '2026-11-19': 7 }, notes: 'white coat effect?' };
await ctx.addInitScript(seed => { if (!localStorage.getItem('tenang:seeded')) { for (const [k, v] of Object.entries(seed)) localStorage.setItem('tenang:' + k, JSON.stringify(v)); localStorage.setItem('tenang:seeded', '1'); } }, SEED);
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.clock.setFixedTime(new Date('2026-11-20T08:00:00+08:00'));
const ls = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('tenang:')).map(k => [k, localStorage.getItem(k)])));
const tenangOnly = d => Object.fromEntries(Object.entries(d).filter(([k]) => !['tenang:snapshot', 'tenang:schema', 'tenang:visits', 'tenang:lastExport'].includes(k)));
const reload = async () => { await page.reload(); await page.waitForTimeout(700); };

// 1. Build A: a normal user with data
await page.goto(base + '/#home'); await page.evaluate(() => navigator.serviceWorker.ready); await reload();
assert.equal(await page.title(), 'Tenang A'); assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
let d = await ls(); assert.equal(d['tenang:schema'], '1'); const original = tenangOnly(d);
assert.equal(JSON.parse(d['tenang:readings']).length, 2);
assert.ok(!(await page.isVisible('#updBar')));
ok('build A: user data loaded, schema stamped, service worker in control, no update banner');

// 2. Server now has build B. The banner appears (but never over a half-typed reading), nothing is reloaded automatically
cur = 'B';
await page.click('#tdGo'); assert.ok(await page.isVisible('#qlog')); // user is mid-entry
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(800);
assert.ok(!(await page.isVisible('#updBar'))); assert.equal(await page.title(), 'Tenang A');
await page.keyboard.press('Escape'); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(500);
assert.ok(await page.isVisible('#updBar')); assert.match(await page.textContent('#updBar'), /new version/i); assert.equal(await page.title(), 'Tenang A');
ok('build B on the server: banner stays hidden while a reading is being entered, appears when idle, page is not reloaded for them');
await page.click('#updX'); assert.ok(!(await page.isVisible('#updBar')));
ok('"Later" dismisses it');
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(300);

// 3. Refresh: new code, migrated data, snapshot, nothing lost
await page.evaluate(() => { document.querySelector('#updBar').hidden = false; });
await Promise.all([page.waitForNavigation({ timeout: 8000 }).catch(() => {}), page.click('#updGo')]); await page.waitForTimeout(1500);
assert.equal(await page.title(), 'Tenang B');
d = await ls(); assert.equal(d['tenang:schema'], '2');
const rd = JSON.parse(d['tenang:readings']); assert.equal(rd.length, 2); assert.ok(rd.every(r => r.tagged === true)); assert.equal(rd[0].s, 128); assert.equal(rd[1].d, 86);
for (const k of ['rem', 'path', 'mins', 'notes']) assert.equal(d['tenang:' + k], original['tenang:' + k], k + ' unchanged');
const snap = JSON.parse(d['tenang:snapshot']); assert.equal(snap.reason, 'update'); assert.equal(snap.schema, 1); assert.equal(snap.data['tenang:readings'], original['tenang:readings']);
assert.ok(!(await page.isVisible('#updBar'))); assert.match(await page.textContent('#toast'), /latest version/i);
ok('Refresh: new build running, readings migrated (fields added, none lost), all other data identical, safety snapshot holds the old data');
const cacheKeys = await page.evaluate(async () => (await caches.keys()).sort());
assert.equal(cacheKeys.filter(k => k.startsWith('tenang-shell-')).length, 1); assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller));
ok('service worker: old shell cache removed, exactly one current cache');
assert.ok(!(await page.isVisible('#updBar')));
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(500); assert.ok(!(await page.isVisible('#updBar')));
ok('up to date: no banner again');

// 4. Backup restore is undoable
await page.click('#setBtn'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bkExport')]);
const bk = join(tmpdir(), 'tenang-e2e-backup.json'); await dl.saveAs(bk);
const bj = JSON.parse(readFileSync(bk, 'utf8')); assert.ok(!('tenang:snapshot' in bj.data)); assert.equal(bj.data['tenang:schema'], '2');
await page.evaluate(() => localStorage.setItem('tenang:notes', JSON.stringify('written after the backup')));
page.once('dialog', x => x.accept()); await Promise.all([page.waitForNavigation({ timeout: 5000 }).catch(() => {}), page.setInputFiles('#bkFile', bk)]); await page.waitForTimeout(1500);
d = await ls(); assert.equal(d['tenang:notes'], original['tenang:notes']); assert.equal(JSON.parse(d['tenang:snapshot']).reason, 'restore');
await page.click('#setBtn'); assert.ok(await page.isVisible('#bkUndo'));
page.once('dialog', x => x.accept()); await Promise.all([page.waitForNavigation({ timeout: 5000 }).catch(() => {}), page.click('#bkUndo')]); await page.waitForTimeout(1500);
d = await ls(); assert.equal(JSON.parse(d['tenang:notes']), 'written after the backup');
ok('restore a backup, then undo it: notes go original -> restored -> back to what was written after the backup');
// a backup from a newer app is refused, nothing changes
const newer = { ...bj, data: { ...bj.data, 'tenang:schema': '9' } }; const nf = join(tmpdir(), 'tenang-e2e-newer.json'); writeFileSync(nf, JSON.stringify(newer));
const beforeNewer = await ls(); await page.click('#setBtn'); await page.setInputFiles('#bkFile', nf); await page.waitForTimeout(500);
assert.match(await page.textContent('#toast'), /newer version/); assert.deepEqual(await ls(), beforeNewer);
ok('a backup made by a newer app version is refused and nothing changes');

// 5. Build C has a migration that crashes: the app still works and the data is exactly as it was
const beforeC = await ls(); cur = 'C';
await page.keyboard.press('Escape'); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(500);
await page.evaluate(() => { document.querySelector('#updBar').hidden = false; });
await Promise.all([page.waitForNavigation({ timeout: 8000 }).catch(() => {}), page.click('#updGo')]); await page.waitForTimeout(1800);
assert.equal(await page.title(), 'Tenang C'); d = await ls();
assert.equal(d['tenang:schema'], '2'); assert.equal(d['tenang:readings'], beforeC['tenang:readings']); assert.equal(d['tenang:half-done'], undefined);
assert.equal(JSON.stringify(tenangOnly(d)), JSON.stringify(tenangOnly(beforeC)));
assert.ok(await page.isVisible('#todayCard')); assert.match(await page.textContent('#toast'), /left exactly as it was/);
ok('build C (migration crashes): rolled back, every key identical, half-written key gone, app still runs and tells the user their data is safe');

// 6. An OLDER build meets newer data: leaves it alone
cur = 'A'; await page.evaluate(async () => { for (const r of await navigator.serviceWorker.getRegistrations()) await r.update(); });
const beforeOld = await ls(); await reload(); await page.waitForTimeout(500);
d = await ls(); assert.equal(await page.title(), 'Tenang A'); assert.equal(d['tenang:schema'], '2'); assert.equal(JSON.stringify(tenangOnly(d)), JSON.stringify(tenangOnly(beforeOld)));
assert.ok(await page.isVisible('#todayCard'));
ok('older build A on schema-2 data: data untouched, version not lowered, app still renders');
assert.deepEqual(errs, []); ok('no page errors anywhere in the journey');
await b.close(); srv.close(); console.log('update tests passed');
