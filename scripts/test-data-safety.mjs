// Runs the @data-safety block from index.html (the exact shipped code) against a fake localStorage and checks that
// no update, failed migration, full disk, damaged value or older/newer app version can lose a user's data.
// Usage: node scripts/test-data-safety.mjs
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync('index.html', 'utf8');
const block = src.slice(src.indexOf('/* @data-safety:start'), src.indexOf('/* @data-safety:end */'));
assert.ok(block.length > 500, 'data-safety block not found');
const ds = vm.runInNewContext(block + '\n({DS_TARGET,MIGRATIONS,dsKeys,dsSchema,dsSnapshot,dsReadSnapshot,dsRestore,dsExpire,dsQuarantine,runMigrations})', { JSON, Math, Object, Array, parseInt, Date, String, Error });

class LS { // minimal localStorage, with an optional size quota
  constructor(init = {}, quota = Infinity) { this.m = new Map(Object.entries(init)); this.quota = quota; }
  get length() { return this.m.size; } key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } removeItem(k) { this.m.delete(k); }
  setItem(k, v) { const next = [...this.m].filter(([a]) => a !== k).reduce((n, [a, b]) => n + a.length + b.length, 0) + k.length + v.length; if (next > this.quota) throw new Error('QuotaExceededError'); this.m.set(k, String(v)); }
  dump() { return Object.fromEntries(this.m); }
}
const J = JSON.stringify;
const rt = o => JSON.parse(JSON.stringify(o)); // results come from another realm: normalise before deep comparisons
const runM = (...a) => rt(ds.runMigrations(...a)), quar = (...a) => rt(ds.dsQuarantine(...a)), rsnap = (...a) => rt(ds.dsReadSnapshot(...a));
const user = () => ({
  'tenang:readings': J([{ s: 128, d: 82, p: 68, t: 1763600000000, c: 'Morning' }, { s: 134, d: 86, t: 1763686400000, c: 'Evening' }]),
  'tenang:rem': J({ amBr: { t: '07:30' } }), 'tenang:path': J({ start: '2026-11-01', done: { 1: { b1: true } } }), 'tenang:mins': J({ '2026-11-19': 7 }), 'tenang:notes': J('white coat effect?'),
  'other-app:keep': 'not ours',
});
const noSnap = d => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'tenang:snapshot' && k !== 'tenang:schema'));
let n = 0; const ok = m => console.log('ok', ++n, m);

// 1. fresh install: nothing to protect, just stamp the version
let ls = new LS(); let r = runM(ls);
assert.equal(r.snapshot, false); assert.equal(ds.dsSchema(ls), ds.DS_TARGET); assert.equal(ls.getItem('tenang:snapshot'), null);
ok('fresh install: version stamped, no snapshot needed');

// 2. existing user (data but no version number, i.e. every phone today): snapshot first, data unchanged
const before = user(); ls = new LS(user()); r = runM(ls);
assert.equal(r.snapshot, true); assert.equal(r.error, null); assert.equal(ds.dsSchema(ls), ds.DS_TARGET);
assert.deepEqual(noSnap(ls.dump()), before);
const snap = rsnap(ls); assert.deepEqual(snap.data, Object.fromEntries(Object.entries(before).filter(([k]) => k.startsWith('tenang:')))); assert.equal(snap.reason, 'update');
ok('existing user: snapshot of every key taken, data byte-for-byte unchanged, version stamped');

// 3. running again is a no-op
const d1 = ls.dump(); r = runM(ls); assert.deepEqual(r.ran, []); assert.deepEqual(ls.dump(), d1);
ok('already up to date: nothing runs, nothing is rewritten');

// 4. multi-step upgrade works and only runs what is missing
const add = (v, f) => ({ v, name: 'add ' + f, up(st) { st.set('readings', st.get('readings', []).map(x => ({ ...x, [f]: v }))); } });
ls = new LS(user()); r = runM(ls, [add(1, 'a'), add(2, 'b'), add(3, 'c')]);
assert.deepEqual(r.ran, [1, 2, 3]); assert.equal(ds.dsSchema(ls), 3);
let rd = JSON.parse(ls.getItem('tenang:readings')); assert.equal(rd[0].a, 1); assert.equal(rd[0].b, 2); assert.equal(rd[0].c, 3); assert.equal(rd[0].s, 128);
const mid = new LS(user()); mid.setItem('tenang:schema', '2'); r = runM(mid, [add(1, 'a'), add(2, 'b'), add(3, 'c')]);
assert.deepEqual(r.ran, [3]); assert.equal(JSON.parse(mid.getItem('tenang:readings'))[0].a, undefined);
ok('migrations run in order, only the missing ones, and keep existing fields');

// 5. a migration that crashes half way: everything is rolled back exactly
ls = new LS(user());
const boom = [add(1, 'a'), { v: 2, name: 'bad', up(st) { st.set('brand-new-key', 1); st.del('notes'); st.set('readings', []); throw new Error('boom'); } }];
r = runM(ls, boom);
assert.equal(r.restored, true); assert.match(r.error, /boom/); assert.deepEqual(r.ran, []);
assert.deepEqual(noSnap(ls.dump()), user()); assert.equal(ls.getItem('tenang:brand-new-key'), null); assert.equal(ds.dsSchema(ls), 0);
assert.equal(ls.getItem('other-app:keep'), 'not ours');
ok('failed migration: every key restored exactly, keys it created removed, version number not advanced');
r = runM(ls, [add(1, 'a'), add(2, 'b')]); assert.equal(ds.dsSchema(ls), 2);
ok('after a failed migration, the corrected one runs fine next time');

// 6. disk full: cannot make the safety copy, so nothing is touched
const probe = new LS(user()); const size = [...probe.m].reduce((n, [a, b]) => n + a.length + b.length, 0);
ls = new LS(user(), size + 50); r = runM(ls, [add(1, 'a')]);
assert.match(r.error, /no safety copy/); assert.deepEqual(r.ran, []); assert.deepEqual(ls.dump(), user());
ok('storage full: no safety copy possible, so the migration is skipped and data is untouched');

// 7. data from a NEWER app version is never modified or downgraded
ls = new LS({ ...user(), 'tenang:schema': '5' }); const dn = ls.dump(); r = runM(ls, [add(1, 'a'), add(2, 'b')]);
assert.equal(r.newer, true); assert.deepEqual(ls.dump(), dn); assert.equal(ds.dsSchema(ls), 5);
ok('older app on newer data: nothing touched, version never lowered');

// 8. undo after a successful migration restores the old state exactly (and removes what the migration added)
ls = new LS(user()); runM(ls, [add(1, 'a'), { v: 2, name: 'x', up(st) { st.set('extra', { hello: 1 }); } }]);
ls.setItem('tenang:newer-entry', J('logged after the update')); assert.notEqual(ls.getItem('tenang:extra'), null);
assert.equal(ds.dsRestore(ls), true); assert.deepEqual(noSnap(ls.dump()), user()); assert.equal(ls.getItem('tenang:extra'), null); assert.equal(ds.dsSchema(ls), 0);
assert.notEqual(rsnap(ls), null);
ok('undo: data returns exactly to the snapshot, migration additions removed, snapshot kept');

// 9. snapshots do not nest or grow
ls = new LS(user()); ds.dsSnapshot(ls, 'restore', 1); const s1 = ls.getItem('tenang:snapshot').length; ds.dsSnapshot(ls, 'restore', 2); ds.dsSnapshot(ls, 'restore', 3);
assert.ok(Math.abs(ls.getItem('tenang:snapshot').length - s1) < 5); assert.equal(Object.keys(rsnap(ls).data).includes('tenang:snapshot'), false);
ok('snapshot never contains itself, so it cannot snowball');

// 10. snapshots expire after 30 days
ls = new LS(user()); const T = 1_800_000_000_000; ds.dsSnapshot(ls, 'update', T);
assert.equal(ds.dsExpire(ls, T + 29 * 864e5), false); assert.notEqual(rsnap(ls), null);
assert.equal(ds.dsExpire(ls, T + 31 * 864e5), true); assert.equal(rsnap(ls), null);
ok('safety copy kept 30 days, then removed');

// 11. damaged values are set aside, never deleted, and the good ones are untouched
ls = new LS({ ...user(), 'tenang:readings': '{"oops":1}', 'tenang:rem': 'null', 'tenang:path': '{not json', 'tenang:mins': J({ '2026-11-19': 7 }) });
const q = quar(ls, 111);
assert.deepEqual(q.sort(), ['path', 'readings', 'rem']); assert.equal(ls.getItem('tenang:readings'), null); assert.equal(ls.getItem('tenang:mins'), J({ '2026-11-19': 7 }));
const qr = JSON.parse(ls.getItem('tenang:quarantine:readings:111')); assert.equal(qr.raw, '{"oops":1}');
assert.equal(JSON.parse(ls.getItem('tenang:quarantine:path:111')).raw, '{not json');
JSON.parse(ls.getItem('tenang:quarantine:rem:111')); // stays valid JSON so a backup of it still imports
ok('damaged readings / settings are quarantined with the raw text preserved; healthy keys untouched');
ls = new LS(user()); assert.deepEqual(quar(ls), []); assert.deepEqual(ls.dump(), user());
ok('healthy data: quarantine does nothing');

// 12. the shipped migrations list is sane
const vs = rt(ds.MIGRATIONS.map(m => m.v)); assert.deepEqual(vs, [...vs].sort((a, b) => a - b)); assert.equal(new Set(vs).size, vs.length); assert.equal(vs[0], 1);
ok('shipped migration versions are unique, ascending, starting at 1');
console.log('data-safety tests passed');
