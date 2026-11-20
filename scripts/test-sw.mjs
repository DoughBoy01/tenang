// Runs sw.js in a sandbox with a faked service-worker environment and checks the push/notification behaviour.
// Usage: node scripts/test-sw.mjs
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const handlers = {}, shown = [], puts = [], posted = [], fetched = [], opened = [];
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' };
const ctx = {
  console, URL, Response, Date, JSON, Promise, Request,
  location: { origin: 'https://tenang.test' },
  caches: { keys: async () => [], open: async () => ({ put: async (k, r) => puts.push({ k, body: await r.text() }) }), match: async () => undefined, delete: async () => true },
  fetch: async (u, i) => { fetched.push({ u, body: JSON.parse(i.body) }); return new Response('{}'); },
};
ctx.self = ctx; ctx.addEventListener = (t, f) => { handlers[t] = f; };
ctx.registration = { showNotification: async (t, o) => shown.push({ t, o }), pushManager: { getSubscription: async () => sub } };
ctx.clients = { claim: async () => {}, matchAll: async () => [{ url: 'https://tenang.test/', postMessage: m => posted.push(m), focus: async () => {}, navigate: async u => opened.push(u) }], openWindow: async u => opened.push(u) };
vm.createContext(ctx); vm.runInContext(readFileSync('sw.js', 'utf8'), ctx);
const fire = async (type, ev) => { let p; await handlers[type]({ ...ev, waitUntil: x => { p = x; } }); await p; };
let n = 0; const ok = m => console.log('ok', ++n, m);

await fire('push', { data: { json: () => ({ title: 'Morning breathing', body: 'Five calm minutes.', url: '/#breathe', k: 'amBr' }) } });
assert.equal(shown[0].t, 'Morning breathing'); assert.equal(JSON.stringify(shown[0].o.actions.map(a => a.action)), '["done","snooze"]');
assert.equal(shown[0].o.tag, 'amBr'); assert.equal(shown[0].o.data.url, '/#breathe'); assert.equal(shown[0].o.data.k, 'amBr');
await fire('push', { data: { json: () => ({ title: 'x', url: 'https://evil.test/', k: 'amBr' }) } });
assert.equal(shown[1].o.data.url, '/#home');
await fire('push', { data: null }); assert.equal(shown[2].t, 'Tenang'); assert.equal(shown[2].o.actions.length, 0);
ok('push shows a visible notification with Done/In 1 hour, safe default text, and rejects off-site URLs');

const closed = [];
await fire('notificationclick', { action: 'done', notification: { data: { k: 'amBr', url: '/#breathe' }, close: () => closed.push(1) } });
assert.equal(closed.length, 1); assert.equal(puts.length, 1); assert.match(puts[0].k, /^\/__pending\/done\/amBr\//);
assert.match(JSON.parse(puts[0].body).day, /^\d{4}-\d\d-\d\d$/); assert.equal(JSON.stringify(posted), '[{"type":"rem-done"}]');
assert.equal(fetched[0].u, '/api/push/done'); assert.equal(fetched[0].body.endpoint, sub.endpoint); assert.equal(fetched[0].body.k, 'amBr');
const until = new Date(fetched[0].body.until); assert.equal(until.getHours(), 0); assert.equal(until.getMinutes(), 0); assert.ok(until > new Date());
assert.equal(opened.length, 0);
ok('Done: leaves a note for the app, pings open pages, tells the server to skip until local midnight, does not open the app');

await fire('notificationclick', { action: 'snooze', notification: { data: { k: 'pmBr', url: '/#breathe' }, close() {} } });
assert.equal(fetched[1].u, '/api/push/snooze'); assert.equal(JSON.stringify(fetched[1].body), JSON.stringify({ endpoint: sub.endpoint, k: 'pmBr', minutes: 60 })); assert.equal(puts.length, 1); assert.equal(opened.length, 0);
ok('In 1 hour: asks the server to repeat in 60 minutes, nothing else');

await fire('notificationclick', { action: '', notification: { data: { k: 'amBr', url: '/#breathe' }, close() {} } });
assert.equal(JSON.stringify(opened), '["/#breathe"]');
await fire('notificationclick', { action: 'done', notification: { data: { k: '../x', url: '/#home' }, close() {} } });
assert.equal(fetched.length, 2);
ok('tapping the notification body opens the right screen; a malformed key is ignored');
console.log('sw tests passed');
