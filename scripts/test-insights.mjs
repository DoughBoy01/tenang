// Runs the @insights block from index.html (the exact shipped code) on synthetic data.
// Checks thresholds, honest wording in both directions, minimum sample sizes, the weekly review window,
// and that no generated sentence ever gives advice or makes a medical claim.
// Usage: node scripts/test-insights.mjs   (any timezone: dates are built from local time)
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync('index.html', 'utf8');
const block = src.slice(src.indexOf('/* @insights:start'), src.indexOf('/* @insights:end */'));
assert.ok(block.length > 800, 'insights block not found');
const I = vm.runInNewContext(block + '\n({computeInsights,computeWeek,weekTarget,INS_TAGS,insKey})', { Math, Object, Array, Set, Date, String, Number, JSON });
const rt = o => JSON.parse(JSON.stringify(o));
const NOW = new Date(2026, 10, 20, 12, 0).getTime(); // Fri 20 Nov 2026, local noon
const at = (daysAgo, h = 8, m = 0) => new Date(2026, 10, 20 - daysAgo, h, m).getTime();
const R = (daysAgo, s, d, h = 8, extra = {}) => ({ s, d, p: 70, t: at(daysAgo, h), c: 'x', ...extra });
const ids = r => r.items.map(i => i.id);
const txt = r => r.items.map(i => i.text).join(' | ');
let n = 0; const ok = m => console.log('ok', ++n, m);
const call = o => rt(I.computeInsights({ now: NOW, ...o }));

// 1. too little data: no insights, just a count
let r = call({ readings: [R(0, 120, 80), R(1, 122, 80), R(2, 119, 79), R(3, 121, 80)] });
assert.equal(r.enough, false); assert.equal(r.count, 4); assert.equal(r.items.length, 0);
ok('fewer than 5 real readings: no insights, count reported');
r = call({ readings: Array.from({ length: 9 }, (_, i) => R(i, 130, 85, 8, { ex: true })) });
assert.equal(r.enough, false); assert.equal(r.count, 0);
ok('example readings are ignored');

// 2. trend wording, three ways
const wk = (a, b) => [...[0, 1, 2, 3].map(i => R(i, a, 80)), ...[7, 8, 9, 10].map(i => R(i, b, 80))];
r = call({ readings: wk(120, 130) }); assert.equal(r.items[0].id, 'trend'); assert.match(r.items[0].text, /average 120\/80, 10 lower on top than the week before/);
r = call({ readings: wk(132, 124) }); assert.match(r.items[0].text, /8 higher on top than the week before\. Weeks vary/);
r = call({ readings: wk(126, 127) }); assert.match(r.items[0].text, /much the same as the week before/);
ok('trend: lower / higher (with a calm caveat) / much the same');
r = call({ readings: [R(0, 120, 80), R(1, 120, 80), R(2, 120, 80), R(8, 130, 80), R(9, 130, 80), R(10, 130, 80), R(11, 130, 80)] });
assert.equal(r.items.filter(i => i.id === 'trend').length, 1);
r = call({ readings: [R(0, 120, 80), R(1, 120, 80), R(8, 130, 80), R(9, 130, 80), R(10, 130, 80), R(12, 130, 80)] });
assert.ok(!ids(r).includes('trend')); ok('trend needs at least 3 readings in each week');

// 3. breathing days vs not: honest in both directions, with sample sizes
const mins = {}; const rd = [];
for (const d of [1, 3, 5, 7, 9]) { mins[I.insKey(at(d))] = 6; rd.push(R(d, 120, 78), R(d, 122, 79, 20)); }
for (const d of [0, 2, 4, 6, 8]) rd.push(R(d, 130, 84), R(d, 131, 85, 20));
r = call({ readings: rd, mins }); const br = r.items.find(i => i.id === 'breath'); assert.ok(br);
assert.match(br.text, /On days you breathed, your top number averaged 10 lower \(10 readings on 5 days against 10 readings on 5 days\)/); assert.match(br.text, /pattern worth noticing/);
const mins2 = {}; for (const d of [0, 2, 4, 6, 8]) mins2[I.insKey(at(d))] = 6;
r = call({ readings: rd, mins: mins2 }); const br2 = r.items.find(i => i.id === 'breath'); assert.match(br2.text, /10 higher/); assert.match(br2.text, /does not mean it is not helping/);
const same = []; const mins3 = {}; for (const d of [1, 3, 5, 7]) { mins3[I.insKey(at(d))] = 5; same.push(R(d, 126, 80), R(d, 127, 80, 20)); } for (const d of [0, 2, 4, 6]) same.push(R(d, 126, 80), R(d, 126, 80, 20));
r = call({ readings: same, mins: mins3 }); assert.match(r.items.find(i => i.id === 'breath').text, /similar on days with and without breathing/);
r = call({ readings: rd, mins: Object.fromEntries(Object.entries(mins).slice(0, 2)) }); assert.ok(!r.items.some(i => i.id === 'breath'));
ok('breathing days: lower / higher (with context) / similar, sample sizes shown, hidden when too few days');

// 4. tags: strongest effect only, thresholds, neutral phrasing
const tg = []; for (const d of [0, 1, 2, 3, 4, 5, 6]) tg.push(R(d, 124, 80)); for (const d of [7, 8, 9]) tg.push(R(d, 138, 88, 8, { g: ['salt'] }), R(d, 130, 84, 21, { g: ['stress'] }));
r = call({ readings: tg }); const tag = r.items.find(i => i.id === 'tag'); assert.ok(tag); assert.match(tag.text, /“Salty food” averaged 12 higher on top \(3 readings\)\. Just a pattern, not a verdict\./);
const tg2 = tg.map(x => ({ ...x, g: x.g && x.g.includes('salt') ? ['salt'] : undefined })).filter(x => !(x.g === undefined && x.s === 130)); // drop the stress ones
r = call({ readings: tg.slice(0, 7).concat([R(7, 126, 80, 8, { g: ['salt'] }), R(8, 127, 80, 8, { g: ['salt'] }), R(9, 126, 80, 8, { g: ['salt'] })]) });
assert.ok(!r.items.some(i => i.id === 'tag')); ok('tags: biggest difference wins, needs >=5 difference and 3 readings each side');

// 5. mornings vs evenings, best reading, consistency
const tod = []; for (const d of [0, 1, 2, 3, 4]) tod.push(R(d, 132, 84, 7), R(d, 122, 78, 20));
r = call({ readings: tod }); const td = r.items.find(i => i.id === 'tod'); assert.match(td.text, /mornings average 10 higher on top than your evenings/); assert.match(td.text, /good reason to measure at the same time/);
assert.match(r.items.find(i => i.id === 'best').text, /lowest reading in the last 30 days was 122\/78 on (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
const sparse = [R(0, 125, 80), R(14, 126, 80), R(15, 127, 81), R(16, 125, 80), R(17, 124, 79)];
r = call({ readings: sparse }); assert.match(txt(r), /logged readings on 1 of the last 7 days/);
r = call({ readings: [R(10, 125, 80), R(11, 126, 80), R(12, 127, 81), R(13, 125, 80), R(14, 124, 79)] }); assert.ok(!ids(r).includes('consistency'));
ok('mornings vs evenings, lowest recent reading, consistency nudge only when 1-3 days');

// 6. at most 3, ordered by priority; and nothing ever gives advice or a medical claim
const big = []; const m = {}; for (let d = 0; d < 28; d++) { if (d % 2) m[I.insKey(at(d))] = 6; big.push(R(d, d % 2 ? 122 : 132, 80, 7, d % 5 === 0 ? { g: ['coffee'] } : {}), R(d, d % 2 ? 118 : 126, 78, 20)); }
r = call({ readings: big, mins: m }); assert.ok(r.items.length <= 3); assert.equal(r.items[0].id, 'trend');
const FORBID = /\b(should|must|stop|medic|dose|diagnos|treat|cure|danger|you need|prescri|doctor)\b|\bmeds?\b/i;
const sweeps = [wk(120, 130), wk(132, 124), wk(126, 127), rd, tod, tg, sparse, big];
for (const rs2 of sweeps) for (const mm of [{}, mins, mins2, mins3, m]) for (const i of call({ readings: rs2, mins: mm }).items) assert.doesNotMatch(i.text, FORBID, i.text);
ok('at most 3 insights, trend first; no sentence in any scenario contains advice or medical wording');

// 7. weekly review: right window, kind headline, honest numbers
const T = (y, mo, d) => new Date(y, mo, d, 19, 0).getTime();
assert.equal(I.weekTarget(T(2026, 10, 20)), null); // Friday
assert.equal(rt(I.weekTarget(T(2026, 10, 22))).key, '2026-11-16'); // Sunday 22 Nov -> week of Mon 16 Nov
assert.equal(rt(I.weekTarget(T(2026, 10, 23))).key, '2026-11-16'); // Monday 23 Nov -> the week that just ended
assert.equal(rt(I.weekTarget(T(2026, 10, 30))).key, '2026-11-23'); // Monday 30 Nov
assert.equal(rt(I.weekTarget(T(2026, 0, 4))).key, '2025-12-29');   // year boundary: Sunday 4 Jan 2026
ok('review window: Sunday = this week, Monday = the week just ended, other days none, year boundary ok');
const sun = new Date(2026, 10, 22, 19).getTime(); const kd = d => I.insKey(new Date(2026, 10, 16 + d).getTime());
const act = new Set([0, 1, 2, 4, 5].map(kd));
const wr = rt(I.computeWeek({ now: sun, active: act, mins: { [kd(0)]: 5, [kd(1)]: 7.4, [kd(4)]: 6 }, readings: [{ s: 130, d: 84, t: new Date(2026, 10, 16, 8).getTime() }, { s: 124, d: 80, t: new Date(2026, 10, 18, 8).getTime() }, { s: 118, d: 76, t: new Date(2026, 10, 20, 8).getTime() }, { s: 136, d: 88, t: new Date(2026, 10, 10, 8).getTime() }, { s: 134, d: 86, t: new Date(2026, 10, 11, 8).getTime() }, { s: 0, d: 0, t: 1, ex: true }] }));
assert.equal(wr.key, '2026-11-16'); assert.equal(wr.activeCount, 5); assert.equal(wr.headline, 'A steady week.'); assert.equal(wr.minutes, 18);
assert.equal(wr.readings, 3); assert.equal(wr.avg, '124/80'); assert.equal(wr.change, '11 lower on top than the week before'); assert.equal(wr.lowest.s, 118);
assert.equal(wr.days.map(d => d.label).join(''), 'MTWTFSS'); assert.equal(wr.days.filter(d => d.active).length, 5);
for (const [c, h] of [[0, /quiet week/], [1, /gentle week/], [3, /good week to build on/], [7, /steady week/]]) assert.match(rt(I.computeWeek({ now: sun, active: new Set(Array.from({ length: c }, (_, i) => kd(i))), readings: [], mins: {} })).headline, h);
const empty = rt(I.computeWeek({ now: sun, active: new Set(), readings: [], mins: {} })); assert.equal(empty.avg, null); assert.equal(empty.change, null); assert.equal(empty.lowest, null);
assert.equal(I.computeWeek({ now: new Date(2026, 10, 18).getTime(), active: new Set(), readings: [], mins: {} }), null);
ok('weekly review numbers (days, minutes, average, change vs previous week, lowest) and kind headlines at every level');
console.log('insights tests passed');
