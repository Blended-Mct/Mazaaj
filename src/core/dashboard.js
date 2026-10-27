// Team-level view: estimated mood mix over time, recurring issues, and the
// customers who need attention now. All mood figures are estimates.

import { estimateMood } from './mood-engine.js';
import { analyze, customerSummary, meta } from './profile.js';
import { categoryTitle } from './categories.js';
import { DAY, ts, iso } from './time.js';

export const RANGES = [30, 60, 90];
const MOOD_KEYS = ['positive', 'neutral', 'frustrated', 'upset', 'unknown'];

const emptyCounts = () => Object.fromEntries(MOOD_KEYS.map((k) => [k, 0]));
const negativeShare = (c) => {
  const known = c.positive + c.neutral + c.frustrated + c.upset;
  return known ? (c.frustrated + c.upset) / known : 0;
};
const pct = (n) => Math.round(n * 1000) / 10;

export function buildDashboard(store, now = Date.now(), requestedDays = 30) {
  const days = RANGES.includes(Number(requestedDays)) ? Number(requestedDays) : 30;
  const customers = store.list();
  const allCorrections = store.corrections();
  const correctionsBy = new Map();
  for (const c of allCorrections) {
    if (!correctionsBy.has(c.customerId)) correctionsBy.set(c.customerId, []);
    correctionsBy.get(c.customerId).push(c);
  }

  // Now ---------------------------------------------------------------------
  const moodNow = emptyCounts();
  const escalations = [];
  const overdue = [];
  const regionMap = new Map();
  for (const c of customers) {
    const a = analyze(c, correctionsBy.get(c.id) || [], now);
    moodNow[a.estimate.mood] += 1;
    const r = regionMap.get(c.region) || { region: c.region, known: 0, negative: 0 };
    if (a.estimate.mood !== 'unknown') r.known += 1;
    if (a.estimate.mood === 'frustrated' || a.estimate.mood === 'upset') r.negative += 1;
    regionMap.set(c.region, r);
    if (a.escalation.needed) {
      escalations.push({
        customer: customerSummary(c), level: a.escalation.level, route: a.escalation.route,
        reason: a.escalation.reasons[0].text, reasonCount: a.escalation.reasons.length, mood: a.display,
        confidence: a.estimate.confidence.level,
      });
    }
    for (const m of a.missed) overdue.push({ customer: customerSummary(c), ...m });
  }
  escalations.sort((x, y) => (x.level === 'urgent' ? 0 : 1) - (y.level === 'urgent' ? 0 : 1) || y.reasonCount - x.reasonCount);
  overdue.sort((x, y) => ts(x.dueAt) - ts(y.dueAt));

  // Weekly trend (estimates recomputed as they would have looked on each date) --
  const points = Math.round(days / 7) + 1;
  const trend = [];
  for (let i = points - 1; i >= 0; i -= 1) {
    const asOf = now - i * 7 * DAY;
    const counts = i === 0 ? { ...moodNow } : emptyCounts();
    if (i !== 0) for (const c of customers) counts[estimateMood(c, { asOf }).mood] += 1;
    trend.push({ asOf: iso(asOf), counts, negativeShare: pct(negativeShare(counts)) });
  }

  // Recurring issues ------------------------------------------------------------
  const from = now - days * DAY;
  const prevFrom = from - days * DAY;
  const issues = new Map();
  for (const c of customers) {
    const contacts = [
      ...c.calls.map((x) => ({ at: ts(x.at), cat: x.category })),
      ...c.messages.filter((m) => m.direction === 'in').map((x) => ({ at: ts(x.at), cat: x.category })),
      ...c.visits.map((x) => ({ at: ts(x.at), cat: x.category })),
    ];
    const perCat = new Map();
    for (const x of contacts) {
      if (!x.cat || x.cat === 'general' || x.at > now) continue;
      const g = issues.get(x.cat) || { category: x.cat, label: categoryTitle(x.cat), contacts: 0, previous: 0, customers: new Set(), repeat: 0 };
      if (x.at >= from) {
        g.contacts += 1;
        g.customers.add(c.id);
        perCat.set(x.cat, (perCat.get(x.cat) || 0) + 1);
      } else if (x.at >= prevFrom) {
        g.previous += 1;
      }
      issues.set(x.cat, g);
    }
    for (const [cat, n] of perCat) if (n >= 2) issues.get(cat).repeat += 1;
  }
  const recurringIssues = [...issues.values()]
    .filter((g) => g.contacts > 0 || g.previous > 0)
    .map((g) => ({
      category: g.category, label: g.label, contacts: g.contacts, previous: g.previous,
      customers: g.customers.size, repeatCustomers: g.repeat,
      change: g.previous ? pct((g.contacts - g.previous) / g.previous) : null,
    }))
    .sort((a, b) => b.contacts - a.contacts);

  // Agent feedback on estimates -------------------------------------------------
  const inRange = allCorrections.filter((c) => ts(c.at) >= from);
  const confirmed = inRange.filter((c) => c.verdict === 'confirmed').length;
  const pairs = new Map();
  for (const c of inRange.filter((x) => x.verdict === 'corrected')) {
    const key = `${c.estimateAtTime?.mood}→${c.mood}`;
    pairs.set(key, (pairs.get(key) || 0) + 1);
  }

  const known = customers.length - moodNow.unknown;
  return {
    meta: meta(now, { note: 'Mood figures are estimates computed from interaction data, not facts.' }),
    range: { days, from: iso(from), to: iso(now), options: RANGES },
    kpis: {
      customers: customers.length,
      withEstimate: known,
      negativeShare: pct(negativeShare(moodNow)),
      negativeShareAtStart: trend[0].negativeShare,
      unknownShare: pct(moodNow.unknown / customers.length),
      escalations: { urgent: escalations.filter((e) => e.level === 'urgent').length, recommended: escalations.filter((e) => e.level === 'recommended').length },
      missedCommitments: { count: overdue.length, customers: new Set(overdue.map((o) => o.customer.id)).size },
      agentFeedback: { total: inRange.length, confirmed, corrected: inRange.length - confirmed, agreementRate: inRange.length ? pct(confirmed / inRange.length) : null },
    },
    moodNow,
    trend,
    recurringIssues,
    regions: [...regionMap.values()]
      .map((r) => ({ ...r, share: r.known ? pct(r.negative / r.known) : 0 }))
      .sort((a, b) => b.share - a.share),
    escalations: escalations.slice(0, 25),
    overdueFollowUps: overdue.slice(0, 25),
    corrections: {
      commonChanges: [...pairs].map(([k, count]) => { const [fromMood, toMood] = k.split('→'); return { from: fromMood, to: toMood, count }; }).sort((a, b) => b.count - a.count),
      recent: inRange.slice(0, 6).map((c) => ({ ...c, customerName: store.get(c.customerId)?.name || c.customerId })),
    },
  };
}
