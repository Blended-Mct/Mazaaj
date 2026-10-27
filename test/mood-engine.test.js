import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateMood, extractSignals, activeObservation, displayMood } from '../src/core/mood-engine.js';
import { analyzeText } from '../src/core/sentiment.js';
import { analyze } from '../src/core/profile.js';
import { generateDemoData } from '../src/data/demo-data.js';
import { normalizePhone } from '../src/data/store.js';

const NOW = Date.parse('2026-10-27T10:00:00Z');
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const { customers, corrections } = generateDemoData(NOW, { populationSize: 20 });
const hero = (id) => customers.find((c) => c.id === id);
const empty = (extra = {}) => ({ id: 'X', tickets: [], calls: [], messages: [], feedback: [], visits: [], followUps: [], services: [], bills: [], ...extra });

test('no evidence → Unknown with a reason, never a guessed mood', () => {
  const e = estimateMood(empty(), { asOf: NOW });
  assert.equal(e.mood, 'unknown');
  assert.equal(e.isEstimate, true);
  assert.equal(e.confidence.level, 'none');
  assert.match(e.unknownReason, /No interactions/);
});

test('stale evidence (70+ days old) → Unknown', () => {
  const e = estimateMood(hero('C1007'), { asOf: NOW });
  assert.equal(e.mood, 'unknown');
});

test('a single weak signal → Unknown', () => {
  const e = estimateMood(hero('C1004'), { asOf: NOW });
  assert.equal(e.mood, 'unknown');
  assert.match(e.unknownReason, /not enough/);
});

test('broken promises, repeat contacts and a cancellation threat → Upset, high confidence, urgent escalation', () => {
  const a = analyze(hero('C1001'), [], NOW);
  assert.equal(a.estimate.mood, 'upset');
  assert.equal(a.estimate.confidence.level, 'high');
  assert.ok(a.estimate.reasons.length >= 3);
  assert.ok(a.estimate.reasons.every((r) => r.direction === 'negative' && r.text));
  assert.equal(a.escalation.level, 'urgent');
  assert.equal(a.escalation.route, 'Retention desk');
  assert.equal(a.missed.length, 2);
  assert.ok(a.triggers.some((t) => t.key === 'network_slow'));
});

test('resolved issue with glowing feedback → Positive', () => {
  const e = estimateMood(hero('C1002'), { asOf: NOW });
  assert.equal(e.mood, 'positive');
  assert.ok(e.counterEvidence.length >= 1, 'older negative evidence is still shown as counter-evidence');
});

test('conflicting evidence → flagged as mixed with low confidence', () => {
  const e = estimateMood(hero('C1005'), { asOf: NOW });
  assert.equal(e.mixedSignals, true);
  assert.equal(e.confidence.level, 'low');
});

test('recent evidence weighs more than old evidence', () => {
  const msg = (daysAgo) => empty({ messages: [{ id: 'm', at: iso(NOW - daysAgo * DAY), channel: 'SMS', direction: 'in', category: 'billing', text: 'This is unacceptable, worst service.' }] });
  const recent = extractSignals(msg(1), NOW)[0].weight;
  const old = extractSignals(msg(60), NOW)[0].weight;
  assert.ok(recent < 0 && old < 0);
  assert.ok(Math.abs(recent) > Math.abs(old) * 4);
});

test('open tickets and missed commitments do not decay', () => {
  const c = empty({
    tickets: [{ id: 'T1', category: 'billing', subject: 's', status: 'open', openedAt: iso(NOW - 40 * DAY), resolvedAt: null, slaHours: 120, reopenedAt: [] }],
    followUps: [{ id: 'F1', title: 'Call back', category: 'billing', createdAt: iso(NOW - 40 * DAY), dueAt: iso(NOW - 39 * DAY), status: 'open', completedAt: null }],
  });
  const s = extractSignals(c, NOW);
  assert.equal(s.find((x) => x.kind === 'ticket_open').weight, -16);
  assert.equal(s.find((x) => x.kind === 'missed_commitment').weight, -14);
});

test('estimates can be recomputed as of a past date (no future evidence leaks in)', () => {
  const past = estimateMood(hero('C1001'), { asOf: NOW - 30 * DAY });
  assert.equal(past.mood, 'unknown');
});

test('agent observation leads the display until newer evidence arrives', () => {
  const c = hero('C1009');
  const signals = extractSignals(c, NOW);
  const estimate = estimateMood(c, { asOf: NOW, signals });
  const mine = corrections.filter((x) => x.customerId === 'C1009');
  const obs = activeObservation(mine, signals, NOW);
  assert.equal(obs.mood, 'neutral');
  const display = displayMood(estimate, obs);
  assert.equal(display.source, 'agent');
  assert.equal(display.sourceLabel, 'Agent-reported');
  assert.notEqual(estimate.mood, 'neutral', 'the system estimate is kept, not overwritten');

  const newer = [...signals, { at: NOW - 1000, ongoing: false, weight: -5 }];
  assert.equal(activeObservation(mine, newer, NOW), null);
  assert.equal(activeObservation(mine, signals, NOW + 4 * DAY), null, 'observations expire');
});

test('greetings acknowledge issues without telling the customer how they feel', () => {
  for (const c of customers.slice(0, 11)) {
    const { suggestions } = analyze(c, [], NOW);
    const g = suggestions.greeting;
    assert.equal(g.language, c.language);
    for (const text of [g.call.en, g.outlet.en]) {
      assert.doesNotMatch(text, /\b(upset|angry|frustrated|annoyed|mood)\b/i, `${c.id}: ${text}`);
      assert.ok(text.includes(c.title.en));
    }
    assert.ok(g.call.ar.includes(c.title.ar));
    assert.ok(suggestions.nextActions.length >= 1);
  }
});

test('sentiment cues: English, Arabic, negation and escalation phrases', () => {
  assert.equal(analyzeText('Thank you so much, working perfectly now!').label, 'positive');
  assert.equal(analyzeText('I am not happy with this').label, 'negative');
  assert.equal(analyzeText('للمرة الثالثة والإنترنت ما يشتغل').label, 'negative');
  assert.equal(analyzeText('شكراً، الخدمة ممتازة').label, 'positive');
  assert.equal(analyzeText('Please send me my invoice').label, 'neutral');
  const esc = analyzeText('If this is not fixed I will cancel and complain to the TRA');
  assert.deepEqual(esc.escalation.map((e) => e.label).sort(), ['cancellation', 'regulator complaint']);
  assert.equal(analyzeText('بلغي الاشتراك وبرفع شكوى لهيئة تنظيم الاتصالات').escalation.length, 2);
  assert.equal(analyzeText('extra data please').escalation.length, 0, '"tra" inside a word is not an escalation');
});

test('phone numbers are normalised to +968XXXXXXXX', () => {
  assert.equal(normalizePhone('9000 1001'), '+96890001001');
  assert.equal(normalizePhone('+968 9000-1001'), '+96890001001');
  assert.equal(normalizePhone('0096890001001'), '+96890001001');
  assert.equal(normalizePhone('12345'), null);
});

test('demo data is clearly marked and deterministic', () => {
  const again = generateDemoData(NOW, { populationSize: 20 });
  assert.deepEqual(again.customers.map((c) => c.name), customers.map((c) => c.name));
  assert.ok(customers.every((c) => c.demo === true && c.accountNo.startsWith('DEMO-')));
  assert.ok(customers.every((c) => [...c.calls, ...c.messages, ...c.feedback, ...c.visits].every((e) => Date.parse(e.at) <= NOW)), 'no events in the future');
});
