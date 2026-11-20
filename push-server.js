// Web Push for Tenang: subscription API, cron sender, VAPID signing and RFC 8291 encryption on WebCrypto.
// Source file: scripts/build-worker.mjs strips the `export` keywords and inlines this into worker.js.
// Storage: Cloudflare D1 (binding DB). Secrets: VAPID_PRIVATE_JWK. Vars: VAPID_PUBLIC, VAPID_SUB.
// We store only: the push endpoint + its keys, and each reminder's UTC minute and notification text.
// No readings, no names, no account data ever reach the server.

const pEnc = new TextEncoder();
const pB64 = {
  enc(buf) { let s = ''; for (const c of new Uint8Array(buf)) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str) { str = String(str).replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; const bin = atob(str); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
};
const pCat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

/* ---------- RFC 8291 (aes128gcm) payload encryption ---------- */
async function pHkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
// `fixed` ({ephemeral, salt}) lets tests pin the random parts.
export async function encryptPayload(p256dh, authSecret, plaintext, fixed = {}) {
  const ua = pB64.dec(p256dh), auth = pB64.dec(authSecret);
  const eph = fixed.ephemeral || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await pHkdf(auth, shared, pCat(pEnc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await pHkdf(salt, ikm, pEnc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await pHkdf(salt, ikm, pEnc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, pCat(plaintext, new Uint8Array([2]))));
  return pCat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, ct);
}

/* ---------- VAPID (RFC 8292) ---------- */
let pVapidKey;
async function pSigningKey(env) {
  if (!pVapidKey) pVapidKey = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return pVapidKey;
}
export async function vapidAuth(env, endpoint, now = Date.now()) {
  const head = pB64.enc(pEnc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = pB64.enc(pEnc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: env.VAPID_SUB || 'https://tenang.pm2120600.workers.dev' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await pSigningKey(env), pEnc.encode(head + '.' + claims));
  return `vapid t=${head}.${claims}.${pB64.enc(sig)}, k=${env.VAPID_PUBLIC}`;
}

export async function sendPush(env, sub, text) {
  const body = await encryptPayload(sub.p256dh, sub.auth, pEnc.encode(text));
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'normal' },
    body
  });
}

/* ---------- validation ---------- */
// Only real browser push services; otherwise anyone could make this Worker POST to arbitrary URLs.
const P_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
export function validEndpoint(e) {
  try { const u = new URL(e); return u.protocol === 'https:' && e.length <= 600 && P_HOSTS.some(r => r.test(u.hostname)); } catch (x) { return false; }
}
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
export function cleanSync(b) {
  if (!b || typeof b !== 'object' || !validEndpoint(b.endpoint) || !b.keys) return null;
  let ua, auth;
  try { ua = pB64.dec(b.keys.p256dh); auth = pB64.dec(b.keys.auth); } catch (e) { return null; }
  if (ua.length !== 65 || ua[0] !== 4 || auth.length !== 16) return null;
  const offset = Number(b.offset);
  if (!Number.isInteger(offset) || offset < -840 || offset > 840) return null;
  if (!Array.isArray(b.reminders) || b.reminders.length > 8) return null;
  const rems = [];
  for (const r of b.reminders) {
    if (!r || !/^[a-zA-Z0-9]{1,12}$/.test(r.k) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.t) || !/^\/#[a-z0-9-]{0,20}$/.test(String(r.url || '/#home'))) return null;
    const utc = (((+r.t.slice(0, 2) * 60 + +r.t.slice(3, 5) - offset) % 1440) + 1440) % 1440;
    rems.push({ k: r.k, utc, payload: JSON.stringify({ title: clip(r.title, 60), body: clip(r.body, 140), url: r.url || '/#home', k: r.k }) });
  }
  return { endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, rems };
}

/* ---------- storage ---------- */
async function dropSub(env, endpoint) {
  await env.DB.batch([env.DB.prepare('DELETE FROM rems WHERE endpoint=?').bind(endpoint), env.DB.prepare('DELETE FROM subs WHERE endpoint=?').bind(endpoint)]);
}
async function saveSub(env, s) {
  const ks = s.rems.map(r => r.k);
  const st = [
    env.DB.prepare('INSERT INTO subs(endpoint,p256dh,auth,updated) VALUES(?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,updated=excluded.updated').bind(s.endpoint, s.p256dh, s.auth, Date.now()),
    // Drop reminders the user switched off (snooze rows, once=1, are left alone).
    ks.length ? env.DB.prepare(`DELETE FROM rems WHERE endpoint=? AND once=0 AND k NOT IN (${ks.map(() => '?').join(',')})`).bind(s.endpoint, ...ks) : env.DB.prepare('DELETE FROM rems WHERE endpoint=? AND once=0').bind(s.endpoint)
  ];
  // Upsert (not delete + insert) so a "done today" mark (skip_until) survives every re-sync.
  for (const r of s.rems) st.push(env.DB.prepare('INSERT INTO rems(endpoint,k,utc_min,payload) VALUES(?,?,?,?) ON CONFLICT(endpoint,k) DO UPDATE SET utc_min=excluded.utc_min,payload=excluded.payload').bind(s.endpoint, r.k, r.utc, r.payload));
  await env.DB.batch(st);
}

/* ---------- HTTP API: /api/push/* ---------- */
const pJson = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function pushRoutes(req, env, path, now = Date.now()) {
  if (!path.startsWith('/api/push/')) return null;
  if (!env.DB || !env.VAPID_PUBLIC || !env.VAPID_PRIVATE_JWK) return pJson({ error: 'push not configured' }, 503);
  if (path === '/api/push/key' && req.method === 'GET') return pJson({ key: env.VAPID_PUBLIC });
  if (req.method !== 'POST') return pJson({ error: 'method' }, 405);
  if (Number(req.headers.get('content-length') || 0) > 6000) return pJson({ error: 'too large' }, 413);
  let b;
  try { b = JSON.parse(await req.text()); } catch (e) { return pJson({ error: 'bad json' }, 400); }
  if (path === '/api/push/sync') {
    const s = cleanSync(b);
    if (!s) return pJson({ error: 'invalid' }, 400);
    await saveSub(env, s);
    return pJson({ ok: true, reminders: s.rems.length });
  }
  if (path === '/api/push/unsubscribe') {
    if (!b || !validEndpoint(b.endpoint)) return pJson({ error: 'invalid' }, 400);
    await dropSub(env, b.endpoint);
    return pJson({ ok: true });
  }
  const kOk = k => typeof k === 'string' && /^[a-zA-Z0-9]{1,12}$/.test(k);
  if (path === '/api/push/done') {
    // "I did this one": no push for it before `until` (end of the user's local day); also cancels a pending snooze.
    const until = Number(b && b.until);
    if (!b || !validEndpoint(b.endpoint) || !kOk(b.k) || !Number.isInteger(until) || until < now - 36e5 || until > now + 36 * 36e5) return pJson({ error: 'invalid' }, 400);
    await env.DB.batch([
      env.DB.prepare('UPDATE rems SET skip_until=? WHERE endpoint=? AND k=? AND once=0').bind(until, b.endpoint, b.k),
      env.DB.prepare('DELETE FROM rems WHERE endpoint=? AND k=? AND once=1').bind(b.endpoint, '~' + b.k)
    ]);
    return pJson({ ok: true });
  }
  if (path === '/api/push/snooze') {
    const mins = Number(b && b.minutes);
    if (!b || !validEndpoint(b.endpoint) || !kOk(b.k) || !Number.isInteger(mins) || mins < 5 || mins > 180) return pJson({ error: 'invalid' }, 400);
    const row = await env.DB.prepare('SELECT payload FROM rems WHERE endpoint=? AND k=? AND once=0').bind(b.endpoint, b.k).first();
    if (!row) return pJson({ error: 'unknown reminder' }, 404);
    const at = now + mins * 60000, d = new Date(at);
    await env.DB.prepare('INSERT INTO rems(endpoint,k,utc_min,payload,once,skip_until) VALUES(?,?,?,?,1,?) ON CONFLICT(endpoint,k) DO UPDATE SET payload=excluded.payload,skip_until=excluded.skip_until,once=1').bind(b.endpoint, '~' + b.k, d.getUTCHours() * 60 + d.getUTCMinutes(), row.payload, at).run();
    return pJson({ ok: true, at });
  }
  return pJson({ error: 'not found' }, 404);
}

/* ---------- cron: runs every minute ---------- */
export async function runReminders(env, now = new Date()) {
  if (!env.DB || !env.VAPID_PRIVATE_JWK) return { sent: 0 };
  const ms = now.getTime(), min = now.getUTCHours() * 60 + now.getUTCMinutes();
  const COLS = 'r.endpoint AS endpoint, r.k AS k, r.once AS once, r.payload AS payload, s.p256dh AS p256dh, s.auth AS auth';
  // Daily reminders due this UTC minute (skipping ones already done today), plus snoozes that came due in the last 10 minutes.
  const daily = await env.DB.prepare(`SELECT ${COLS} FROM rems r JOIN subs s ON s.endpoint = r.endpoint WHERE r.once = 0 AND r.utc_min = ? AND r.skip_until <= ?`).bind(min, ms).all();
  const snoozed = await env.DB.prepare(`SELECT ${COLS} FROM rems r JOIN subs s ON s.endpoint = r.endpoint WHERE r.once = 1 AND r.skip_until <= ? AND r.skip_until > ?`).bind(ms, ms - 600000).all();
  const due = [...daily.results, ...snoozed.results];
  let sent = 0;
  for (let i = 0; i < due.length; i += 10) {
    await Promise.all(due.slice(i, i + 10).map(async row => {
      try {
        const res = await sendPush(env, row, row.payload);
        if (res.status === 404 || res.status === 410) await dropSub(env, row.endpoint);
        else if (res.ok) sent++;
      } catch (e) { /* network error: try again tomorrow */ }
      if (row.once) await env.DB.prepare('DELETE FROM rems WHERE endpoint=? AND k=?').bind(row.endpoint, row.k).run().catch(() => {});
    }));
  }
  await env.DB.prepare('DELETE FROM rems WHERE once = 1 AND skip_until <= ?').bind(ms - 600000).run(); // missed snoozes
  // Once a day, forget phones that haven't opened the app for 90 days.
  if (min === 190) {
    const old = Date.now() - 90 * 864e5;
    await env.DB.batch([env.DB.prepare('DELETE FROM rems WHERE endpoint IN (SELECT endpoint FROM subs WHERE updated < ?)').bind(old), env.DB.prepare('DELETE FROM subs WHERE updated < ?').bind(old)]);
  }
  return { sent, due: due.length };
}
