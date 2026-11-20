// Verifies the Web Push server code without a real push service:
//  - payload encryption (RFC 8291) is decrypted with an independent node:crypto implementation
//  - the VAPID JWT signature verifies against the public key
//  - input validation, UTC-minute maths, API routes and the cron sender against a REAL SQLite database that runs
//    the migrations in migrations/ (a D1 stand-in), with a fake push service
// Usage: node scripts/test-push.mjs
import crypto, { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { encryptPayload, vapidAuth, validEndpoint, cleanSync, pushRoutes, runReminders } from '../push-server.js';
const b64u = b => Buffer.from(b).toString('base64url');
let n = 0; const ok = m => console.log('ok', ++n, m);

// browser-side keys (what PushManager.subscribe() would produce)
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const uaPub = ua.getPublicKey();

// 1. encryption round trip with an independent decrypt
const msg = JSON.stringify({ title: 'Morning breathing', body: 'Five calm minutes. Tap to begin.', url: '/#breathe' });
const body = Buffer.from(await encryptPayload(b64u(uaPub), b64u(auth), new TextEncoder().encode(msg)));
const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
assert.equal(rs, 4096); assert.equal(idlen, 65);
const shared = ua.computeSecret(asPub);
const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
assert.equal(plain[plain.length - 1], 2); assert.equal(plain.subarray(0, -1).toString(), msg);
ok('payload decrypts with independent RFC 8291 implementation');

// 2. VAPID JWT
const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pubRaw = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey));
const env = { VAPID_PRIVATE_JWK: JSON.stringify(await webcrypto.subtle.exportKey('jwk', kp.privateKey)), VAPID_PUBLIC: b64u(pubRaw), VAPID_SUB: 'https://example.test' };
const h = await vapidAuth(env, 'https://fcm.googleapis.com/fcm/send/abc', 1_700_000_000_000);
const m = h.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/); assert.ok(m);
assert.equal(m[4], env.VAPID_PUBLIC);
const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
assert.equal(claims.aud, 'https://fcm.googleapis.com'); assert.equal(claims.exp, 1_700_000_000 + 43200); assert.equal(claims.sub, 'https://example.test');
assert.ok(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(m[3], 'base64url'), Buffer.from(m[1] + '.' + m[2])));
ok('VAPID JWT claims and ES256 signature verify');

// 3. validation
assert.ok(validEndpoint('https://fcm.googleapis.com/fcm/send/x') && validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x') && validEndpoint('https://web.push.apple.com/x') && validEndpoint('https://wns2-par02p.notify.windows.com/x'));
assert.ok(!validEndpoint('http://fcm.googleapis.com/x') && !validEndpoint('https://evil.example.com/x') && !validEndpoint('https://fcm.googleapis.com.evil.com/x') && !validEndpoint('https://169.254.169.254/') && !validEndpoint('nope'));
ok('only https browser push services are accepted');
const good = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: b64u(uaPub), auth: b64u(auth) }, offset: 480, reminders: [{ k: 'amBr', t: '07:15', title: 'Morning breathing', body: 'Hi', url: '/#breathe' }, { k: 'late', t: '00:30', title: 'x', body: 'y', url: '/#home' }] };
const c = cleanSync(good);
assert.equal(c.rems[0].utc, (7 * 60 + 15 - 480 + 1440) % 1440); assert.equal(c.rems[1].utc, (30 - 480 + 1440) % 1440);
assert.equal(cleanSync({ ...good, offset: -60 }).rems[0].utc, 8 * 60 + 15);
for (const bad of [{ ...good, offset: 'x' }, { ...good, offset: 9999 }, { ...good, keys: { p256dh: 'AAAA', auth: b64u(auth) } }, { ...good, reminders: [{ k: 'a', t: '25:00', url: '/#home' }] }, { ...good, reminders: [{ k: 'a', t: '07:00', url: 'https://evil.test' }] }, { ...good, reminders: Array(9).fill(good.reminders[0]) }, null]) assert.equal(cleanSync(bad), null);
ok('sync validation and local-time -> UTC-minute conversion (incl. wraparound)');

// 4. API + cron against real SQL (migrations applied in order) and a fake push service
const db = new DatabaseSync(':memory:');
for (const f of ['0001_push.sql', '0002_actions.sql']) db.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
const stmt = (sql) => { const q = db.prepare(sql); let args = []; return { sql, bind(...a) { args = a; return this; }, run() { return Promise.resolve(q.run(...args)); }, all() { return Promise.resolve({ results: q.all(...args) }); }, first() { return Promise.resolve(q.get(...args) || null); }, _run() { q.run(...args); } }; };
const D1 = { prepare: stmt, async batch(list) { db.exec('BEGIN'); try { for (const s of list) s._run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
const E = { ...env, DB: D1 };
const call = (path, o, now) => pushRoutes(new Request('https://t.test' + path, { method: 'POST', body: JSON.stringify(o) }), E, path, now);
const count = (t, w = '1') => db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${w}`).get().c;
const NOW = Date.UTC(2026, 10, 20, 0, 0, 0); // 20 Nov 2026 00:00 UTC = 08:00 in Kuala Lumpur
const EOD = Date.UTC(2026, 10, 20, 16, 0, 0); // end of that local day (24:00 +08:00)

assert.equal((await (await pushRoutes(new Request('https://t.test/api/push/key'), E, '/api/push/key')).json()).key, env.VAPID_PUBLIC);
assert.equal((await call('/api/push/sync', good)).status, 200); assert.equal(count('rems'), 2);
assert.equal((await call('/api/push/sync', { ...good, reminders: [good.reminders[0]] })).status, 200); assert.equal(count('rems'), 1);
assert.equal((await call('/api/push/sync', { ...good, endpoint: 'https://evil.test/x' })).status, 400);
ok('API: key, sync (switched-off reminders are removed), rejects bad endpoint');

// "done today" survives re-syncs (upsert) and is validated
assert.equal((await call('/api/push/done', { endpoint: good.endpoint, k: 'amBr', until: EOD }, NOW)).status, 200);
assert.equal(db.prepare("SELECT skip_until s FROM rems WHERE k='amBr'").get().s, EOD);
await call('/api/push/sync', { ...good, reminders: [{ ...good.reminders[0], t: '07:20' }] });
assert.equal(db.prepare("SELECT skip_until s, utc_min u FROM rems WHERE k='amBr'").get().s, EOD);
assert.equal(db.prepare("SELECT utc_min u FROM rems WHERE k='amBr'").get().u, (7 * 60 + 20 - 480 + 1440) % 1440);
for (const bad of [{ endpoint: good.endpoint, k: 'amBr', until: 'x' }, { endpoint: good.endpoint, k: 'amBr', until: NOW + 99 * 36e5 }, { endpoint: good.endpoint, k: 'a/b', until: EOD }, { endpoint: 'https://evil.test/', k: 'amBr', until: EOD }]) assert.equal((await call('/api/push/done', bad, NOW)).status, 400);
ok('done: skip_until is stored, survives a re-sync (and a time edit), bad input rejected');

// cron skips a reminder already done today, then sends it again tomorrow
const calls = []; const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 201 }); };
const at = (h, m, dOff = 0) => new Date(Date.UTC(2026, 10, 20 + dOff, h, m)); // UTC time
const due = (7 * 60 + 20 - 480 + 1440) % 1440, [dh, dm] = [Math.floor(due / 60), due % 60];
// 07:20 local on 20 Nov is 23:20 UTC on 19 Nov (today); 23:20 UTC on 20 Nov is 07:20 local on 21 Nov (tomorrow)
let r = await runReminders(E, at(dh, dm, -1)); assert.equal(r.sent, 0); assert.equal(calls.length, 0);
r = await runReminders(E, at(dh, dm, 0)); assert.equal(r.sent, 1); assert.equal(calls.length, 1);
assert.equal(calls[0].url, good.endpoint); assert.equal(calls[0].init.headers['Content-Encoding'], 'aes128gcm'); assert.match(calls[0].init.headers.Authorization, /^vapid t=/);
r = await runReminders(E, at(3, 3)); assert.equal(r.sent, 0); assert.equal(calls.length, 1);
ok('cron: skips a reminder already marked done today, sends it the next day, ignores other minutes');

// snooze: one-off row, fires once, then is gone; done cancels it
assert.equal((await call('/api/push/snooze', { endpoint: good.endpoint, k: 'nope', minutes: 60 }, NOW)).status, 404);
assert.equal((await call('/api/push/snooze', { endpoint: good.endpoint, k: 'amBr', minutes: 1 }, NOW)).status, 400);
const sz = await (await call('/api/push/snooze', { endpoint: good.endpoint, k: 'amBr', minutes: 60 }, NOW)).json();
assert.equal(sz.at, NOW + 3600000); assert.equal(count('rems', "once=1 AND k='~amBr'"), 1);
await call('/api/push/sync', { ...good, reminders: [{ ...good.reminders[0], t: '07:20' }] }); assert.equal(count('rems', 'once=1'), 1); // re-sync keeps the snooze
const n0 = calls.length;
r = await runReminders(E, new Date(NOW + 30 * 60000)); assert.equal(calls.length, n0);               // too early
r = await runReminders(E, new Date(NOW + 3600000)); assert.equal(calls.length, n0 + 1); assert.equal(count('rems', 'once=1'), 0); // fires, row deleted
r = await runReminders(E, new Date(NOW + 3660000)); assert.equal(calls.length, n0 + 1);               // never twice
await call('/api/push/snooze', { endpoint: good.endpoint, k: 'amBr', minutes: 60 }, NOW);
await call('/api/push/done', { endpoint: good.endpoint, k: 'amBr', until: EOD }, NOW); assert.equal(count('rems', 'once=1'), 0);
await call('/api/push/snooze', { endpoint: good.endpoint, k: 'amBr', minutes: 5 }, NOW);
await runReminders(E, new Date(NOW + 30 * 60000)); assert.equal(count('rems', 'once=1'), 0); // a missed snooze is cleaned up, not sent late
assert.equal(calls.length, n0 + 1);
ok('snooze: fires once at the right time, survives re-sync, cancelled by done, never sent late');

// 410 from the push service removes the subscription
globalThis.fetch = async () => new Response(null, { status: 410 });
await runReminders(E, at(dh, dm, 3)); assert.equal(count('subs'), 0); assert.equal(count('rems'), 0);
globalThis.fetch = realFetch;
ok('cron: drops subscriptions the push service reports gone (410)');
console.log('push tests passed');
