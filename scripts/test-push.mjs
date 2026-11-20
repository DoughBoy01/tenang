// Verifies the Web Push server code without a real push service:
//  - payload encryption (RFC 8291) is decrypted with an independent node:crypto implementation
//  - the VAPID JWT signature verifies against the public key
//  - input validation, UTC-minute maths, API routes and the cron sender (with a fake D1 and fake push endpoint)
// Usage: node scripts/test-push.mjs
import crypto, { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
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

// 4. API + cron with a fake D1 and fake push service
const rows = { subs: new Map(), rems: [] };
const fakeDB = { prepare(sql) { return { sql, args: [], bind(...a) { this.args = a; return this }, async all() { const min = this.args[0]; return { results: rows.rems.filter(r => r.utc_min === min).map(r => ({ ...r, ...rows.subs.get(r.endpoint) })) } } } }, async batch(st) { for (const s of st) { const q = s.sql, a = s.args; if (q.startsWith('INSERT INTO subs')) rows.subs.set(a[0], { p256dh: a[1], auth: a[2] }); else if (q.startsWith('DELETE FROM rems WHERE endpoint')) rows.rems = rows.rems.filter(r => r.endpoint !== a[0]); else if (q.startsWith('DELETE FROM subs WHERE endpoint')) rows.subs.delete(a[0]); else if (q.startsWith('INSERT INTO rems')) rows.rems.push({ endpoint: a[0], k: a[1], utc_min: a[2], payload: a[3] }) } } };
const E = { ...env, DB: fakeDB };
const post = (path, o) => pushRoutes(new Request('https://t.test' + path, { method: 'POST', body: JSON.stringify(o) }), E, path);
assert.equal((await (await pushRoutes(new Request('https://t.test/api/push/key'), E, '/api/push/key')).json()).key, env.VAPID_PUBLIC);
assert.equal((await post('/api/push/sync', good)).status, 200); assert.equal(rows.rems.length, 2);
assert.equal((await post('/api/push/sync', { ...good, reminders: [good.reminders[0]] })).status, 200); assert.equal(rows.rems.length, 1);
assert.equal((await post('/api/push/sync', { ...good, endpoint: 'https://evil.test/x' })).status, 400);
ok('API: key, sync (replaces reminders), rejects bad endpoint');

const calls = []; const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: calls.length === 99 ? 410 : 201 }) };
const due = (7 * 60 + 15 - 480 + 1440) % 1440;
const r1 = await runReminders(E, new Date(Date.UTC(2026, 0, 1, Math.floor(due / 60), due % 60)));
assert.equal(r1.sent, 1); assert.equal(calls.length, 1); assert.equal(calls[0].url, good.endpoint);
assert.equal(calls[0].init.headers['Content-Encoding'], 'aes128gcm'); assert.match(calls[0].init.headers.Authorization, /^vapid t=/); assert.ok(calls[0].init.body.length > 100);
const r0 = await runReminders(E, new Date(Date.UTC(2026, 0, 1, 3, 3))); assert.equal(r0.sent, 0); assert.equal(calls.length, 1);
globalThis.fetch = async () => new Response(null, { status: 410 });
await runReminders(E, new Date(Date.UTC(2026, 0, 1, Math.floor(due / 60), due % 60)));
assert.equal(rows.subs.size, 0); assert.equal(rows.rems.length, 0);
globalThis.fetch = realFetch;
ok('cron: sends only due reminders, drops subscriptions the push service reports gone (410)');
console.log('push tests passed');
