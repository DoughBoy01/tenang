// Content-safety tests for the tailored (female / male) guidance. Runs the exact @profiles block from index.html.
// These encode the hard rules in docs/research/sex-specific-bp.md: if someone edits the wording and breaks a rule, this fails.
// Usage: node scripts/test-profiles.mjs
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync('index.html', 'utf8');
const block = src.slice(src.indexOf('/* @profiles:start'), src.indexOf('/* @profiles:end */'));
assert.ok(block.length > 1500, 'profiles block not found');
const P = vm.runInNewContext(block + '\n({PSRC,PSEC,PTIP,profileGuide,profileTip})', { Object, Array, JSON });
const rt = o => JSON.parse(JSON.stringify(o));
const guide = p => rt(P.profileGuide(p));
const PSRC = rt(P.PSRC), PSEC = rt(P.PSEC);
let n = 0; const ok = m => console.log('ok', ++n, m);

const ALL = [
  ['general', null], ['general', { sex: 'general' }],
  ['female/regular', { sex: 'female', stage: 'regular' }], ['female/peri', { sex: 'female', stage: 'peri' }], ['female/post', { sex: 'female', stage: 'post' }],
  ['female/preg', { sex: 'female', stage: 'preg' }], ['female/none', { sex: 'female', stage: 'none' }], ['female/unset', { sex: 'female' }],
  ['male', { sex: 'male' }],
];
const textOf = g => [g.title, g.intro, g.tip, g.medNote, ...g.sections.flatMap(s => [s.h, ...s.p]), ...g.questions, ...g.tips.map(t => t.t)].join('\n');

// 1. Structure: every section is sourced from a known source; every profile resolves; general shows nothing
for (const [name, prof] of ALL) {
  const g = guide(prof);
  for (const s of g.sections) { assert.ok(s.src && s.src.length, `${name}/${s.id}: no source`); for (const id of s.src) assert.ok(PSRC[id], `${name}/${s.id}: unknown source ${id}`); assert.ok(s.p.length && s.h, `${name}/${s.id}: empty`); }
  if (g.sex === 'general') { assert.equal(g.sections.length, 0); assert.equal(g.questions.length, 0); assert.equal(g.medNote, ''); assert.equal(g.tip, ''); assert.ok(!g.tags.includes('flush')); assert.equal(g.moodFlush, false); }
  else { assert.ok(g.title && g.intro && g.sections.length && g.questions.length, name); }
}
for (const [id, s] of Object.entries(PSEC)) assert.ok(s.src.every(x => PSRC[x]), id);
ok('every section has a title, text and at least one known source; "general" shows nothing tailored');

// 2. Hard rule: nothing tells anyone to stop, switch or start a medicine, hormone or contraceptive
const FORBID_ADVICE = [
  /\byou should (take|start|stop|switch|use|try|avoid taking)\b/i, /(?<!\bnot )(?<!n't )\b(stop|skip|reduce|increase|change) (taking )?(your|the) (medic|pill|tablet|dose|dosage|treatment|hormone|contracept)/i, // negated forms (\"do not stop your medicine\") are the wording we want
  /\bswitch (to|your|from)\b/i, /\bstart (taking|using|hormone|therapy|testosterone)\b/i, /(?<!\bif you )\btake (hormone therapy|testosterone|aspirin|an? (ace|arb|beta|statin))\b/i, // \"If you take hormone therapy, mention it...\" is a safe conditional
  /\b(cure|cures|treats?|heals?|prevents?) (hot|high blood|menopaus|hypertension)/i, /\b(guarantee|proven to|will lower|will reduce)\b/i,
];
for (const [name, prof] of ALL) {
  const g = guide(prof);
  // questions are phrased as questions to the doctor, so only the explanatory text is checked for imperatives about aspirin
  const body = [g.title, g.intro, g.tip, g.medNote, ...g.sections.flatMap(s => [s.h, ...s.p]), ...g.tips.map(t => t.t)].join('\n');
  for (const re of FORBID_ADVICE) assert.doesNotMatch(body, re, `${name}: ${re}`);
  // "stop" is allowed only as "do not stop ...", and "starting/starting a method" only as a thing to talk about
  for (const m of body.matchAll(/\bstop\b/gi)) assert.match(body.slice(Math.max(0, m.index - 8), m.index + 4), /not stop|n't stop/i, `${name}: unqualified "stop" near: ${body.slice(Math.max(0, m.index - 30), m.index + 30)}`);
}
ok('no text tells anyone to stop, switch or start a medicine/hormone/contraceptive; "stop" only ever appears as "do not stop"');

// 3. Hard rule: every medicine, hormone or contraception topic hands the decision to a professional
for (const id of ['ht', 'contra', 'planning', 'preg', 'ed', 'testo', 'flush']) {
  const t = PSEC[id].p.join(' '); assert.match(t, /doctor|clinician|prescriber|pharmacist|care team|midwife/i, id);
}
for (const [name, prof] of ALL) { const g = guide(prof); if (g.medNote) assert.match(g.medNote, /doctor|pharmacist|prescriber|clinician|care team|mention it to anyone/i, name + ' medNote'); }
ok('medicine, hormone, contraception, flush and pregnancy topics all hand the decision to a doctor, pharmacist or care team');

// 4. Hard rule: breathing is never presented as a treatment for hot flushes (NAMS 2023: paced respiration not recommended)
const flush = PSEC.flush.p.join(' ');
assert.match(flush, /has not been shown to reduce hot flushes/i); assert.match(flush, /cognitive behavioural therapy|clinical hypnosis/i);
for (const [name, prof] of ALL) { const t = textOf(guide(prof)); assert.doesNotMatch(t, /(breath\w*|relax\w*)[^.]{0,60}(?<!not been shown to )(?<!not shown to )(reduce|stop|treat|ease|relieve|prevent)[^.]{0,30}(hot flush|hot flash|night sweat)/i, name); }
assert.match('Slow breathing can reduce hot flushes.', /(breath\w*|relax\w*)[^.]{0,60}(?<!not been shown to )(?<!not shown to )(reduce|stop|treat|ease|relieve|prevent)[^.]{0,30}(hot flush|hot flash|night sweat)/i); // the rule still catches a positive claim
ok('breathing is only offered for calm: the flush text states it has not been shown to reduce flushes and points to CBT / hypnosis / a clinician');

// 5. Hard rule: no sex-specific blood pressure thresholds; the only numbers are the pregnancy hand-off (140/90)
for (const [name, prof] of ALL) {
  const g = guide(prof);
  for (const s of g.sections) for (const m of s.p.join(' ').matchAll(/\b\d{2,3}\/\d{2,3}\b/g)) { assert.equal(m[0], '140/90', `${name}/${s.id}: unexpected BP number ${m[0]}`); assert.equal(s.id, 'preg', `${name}: 140/90 outside the pregnancy section`); }
  assert.doesNotMatch(textOf(g), /\b(target|goal|aim for|should be below)\b[^.]{0,40}\b\d{2,3}\/\d{2,3}/i, name);
}
assert.match(guide({ sex: 'female' }).intro, /categories are the same for women and men/i); assert.match(guide({ sex: 'male' }).intro, /categories are the same for men and women/i);
ok('no sex-specific BP targets anywhere; 140/90 appears only in the pregnancy hand-off; both intros say the categories are the same for everyone');

// 6. Pregnancy: a hand-off, never coaching
const preg = guide({ sex: 'female', stage: 'preg' });
assert.deepEqual(preg.sections.map(s => s.id), ['preg']); assert.equal(preg.pregnant, true);
const pt = preg.sections[0].p.join(' '); assert.match(pt, /not a pregnancy blood pressure monitor/i); assert.match(pt, /same day/i); assert.match(pt, /140\/90/); assert.match(pt, /Share every reading/i);
assert.ok(!preg.tags.includes('flush')); assert.equal(preg.moodFlush, false); assert.equal(guide({ sex: 'female', stage: 'peri' }).pregnant, false);
ok('pregnancy profile: only the hand-off section, says Tenang is not a pregnancy monitor, same-day contact rule, readings go to the care team');

// 7. Tags, mood and tip follow the life stage; no cross-over between the sexes
const has = (prof, k) => guide(prof).tags.includes(k);
assert.ok(has({ sex: 'female', stage: 'peri' }, 'flush') && has({ sex: 'female', stage: 'post' }, 'flush') && has({ sex: 'female', stage: 'none' }, 'flush'));
assert.ok(!has({ sex: 'female', stage: 'regular' }, 'flush') && !has({ sex: 'male' }, 'flush') && !has(null, 'flush'));
for (const [name, prof] of ALL) assert.ok(['sleep', 'salt', 'stress', 'move', 'coffee', 'alcohol'].every(k => guide(prof).tags.includes(k)), name);
assert.equal(guide({ sex: 'female', stage: 'peri' }).moodFlush, true); assert.equal(guide({ sex: 'male' }).moodFlush, false);
const male = textOf(guide({ sex: 'male' })), fem = [guide({ sex: 'female', stage: 'peri' }), guide({ sex: 'female', stage: 'regular' })].map(textOf).join('\n');
assert.doesNotMatch(male, /menopaus|hot flush|pregnan|contracept|period/i); assert.doesNotMatch(fem, /erect|testosterone|prostate/i);
ok('"Hot flush" note and mood only for perimenopause / after menopause / unspecified; no menopause or pregnancy wording in the men\'s guide and no erection or testosterone wording in the women\'s');

// 8. The alcohol limit differs by sex and is stated with "less is better"
assert.match(PSEC.alcF.p[0], /no more than one drink a day for women/i); assert.match(PSEC.alcM.p[0], /no more than two drinks a day for men/i); assert.match(PSEC.alcF.p[0] + PSEC.alcM.p[0], /less is better/i);
assert.ok(guide({ sex: 'male' }).sections.some(s => s.id === 'alcM') && !guide({ sex: 'male' }).sections.some(s => s.id === 'alcF'));
ok('alcohol: one drink for women, two for men, "less is better", matching section per sex');

// 9. Readable: short paragraphs, short sentences on average, plain words
for (const [name, prof] of ALL) for (const s of guide(prof).sections) for (const para of s.p) { assert.ok(para.length <= 430, `${name}/${s.id}: paragraph is ${para.length} chars`); const sent = para.split(/(?<=[.!?])\s+/); const avg = para.length / sent.length; assert.ok(avg <= 190, `${name}/${s.id}: long sentences (${Math.round(avg)})`); }
ok('every paragraph is short enough to read on a phone');

// 10. Sources are cited by name, not as claims of endorsement
for (const v of Object.values(PSRC)) assert.doesNotMatch(v, /https?:\/\//);
assert.match(PSRC.ukmec, /UK guidance/); assert.match(PSEC.contra.p[0], /do not stop a method without a plan/i); assert.match(PSEC.contra.p[0], /doctor or nurse/i);
ok('sources are named (not linked), the UK-specific contraception source is labelled as UK guidance');

// 11. Daily tips: the same safety rules, plus sources, rotation and no cross-over
const PTIP = rt(P.PTIP);
for (const [id, t] of Object.entries(PTIP)) { assert.ok(t.src.length && t.src.every(x => PSRC[x]), 'tip ' + id + ': unknown or missing source'); assert.ok(t.t.length <= 260, 'tip ' + id + ' too long: ' + t.t.length); }
for (const id of ['contra', 'planning', 'ed', 'testo', 'preg', 'flushCalm']) assert.match(PTIP[id].t, /doctor|clinician|prescriber|pharmacist|care team|midwife|nurse/i, 'tip ' + id + ' must name a professional');
for (const [id, t] of Object.entries(PTIP)) for (const m of t.t.matchAll(/\b\d{2,3}\/\d{2,3}\b/g)) { assert.equal(m[0], '140/90'); assert.equal(id, 'preg', 'BP number outside the pregnancy tip'); }
assert.match(PTIP.flushCalm.t, /has not been shown to reduce hot flushes/);
for (const [name, prof] of ALL) {
  const g = guide(prof), exp = g.sex === 'general' ? 0 : g.pregnant ? 1 : g.sex === 'male' ? 5 : g.stage === 'regular' ? 4 : 6;
  assert.equal(g.tips.length, exp, name + ' tip count');
  for (const t of g.tips) assert.ok(PTIP[t.id] && PTIP[t.id].t === t.t, name);
  if (!g.sections.length) assert.equal(P.profileTip(g, '2026-11-20'), null);
}
const maleTips = guide({ sex: 'male' }).tips.map(t => t.t).join(' '), femTips = [guide({ sex: 'female', stage: 'peri' }), guide({ sex: 'female', stage: 'regular' }), guide({ sex: 'female', stage: 'none' })].flatMap(g => g.tips.map(t => t.t)).join(' ');
assert.doesNotMatch(maleTips, /menopaus|hot flush|pregnan|contracept|period/i); assert.doesNotMatch(femTips, /erect|testosterone|prostate/i);
const peri = guide({ sex: 'female', stage: 'peri' }); const days = Array.from({ length: 14 }, (_, i) => `2026-11-${String(10 + i).padStart(2, '0')}`);
const seen = new Set(days.map(d => P.profileTip(peri, d).id)); assert.ok(seen.size >= 4, 'rotation covers ' + seen.size);
assert.equal(P.profileTip(peri, '2026-11-20').id, P.profileTip(peri, '2026-11-20').id);
assert.equal(P.profileTip(guide({ sex: 'female', stage: 'preg' }), '2026-11-20').id, 'preg'); assert.equal(P.profileTip(null, 'x'), null);
ok('daily tips: sourced, short, professional named where medicines/contraception/pregnancy are involved, 140/90 only in the pregnancy tip, no cross-over between sexes, deterministic per day and rotating across days');
console.log('profile content tests passed');
