// Mizaj mood engine — a transparent, rule-based *estimate* of how a customer is
// likely to feel, built only from interaction evidence. Every signal carries the
// sentence an agent sees, so the estimate can always be explained and challenged.
//
// Design rules:
//  • Evidence decays: a complaint from yesterday matters more than one from last month.
//  • Ongoing problems (open tickets, missed promises, active incidents) do not decay.
//  • Too little evidence ⇒ "Unknown". We never guess a mood from demographics or tenure.

import { analyzeText } from './sentiment.js';
import { category, categoryTitle } from './categories.js';
import { DAY, HOUR, ts, iso, shortDate, duration, slaWords } from './time.js';

export const ENGINE = Object.freeze({
  method: 'rules-v1',
  halfLifeDays: 21,
  windowDays: 90,
  repeatWindowDays: 14,
  minSignals: 2,
  minStrength: 8,
  thresholds: { upset: -40, frustrated: -12, positive: 12 },
  confidence: { high: 0.8, medium: 0.55 },
  observationTtlHours: 72,
});

export const MOODS = Object.freeze({
  positive: { key: 'positive', label: 'Positive' },
  neutral: { key: 'neutral', label: 'Neutral' },
  frustrated: { key: 'frustrated', label: 'Frustrated' },
  upset: { key: 'upset', label: 'Upset' },
  unknown: { key: 'unknown', label: 'Unknown' },
});

export const AGENT_MOODS = ['positive', 'neutral', 'frustrated', 'upset'];

export const DISCLAIMER = 'Estimated from recent interaction data. This is not a fact — confirm with the customer.';

const CALL_OUTCOME = {
  resolved: { w: 3, text: 'resolved on the call' },
  unresolved: { w: -5, text: 'not resolved' },
  transferred: { w: -4, text: 'transferred to another team' },
  dropped: { w: -5, text: 'call dropped before resolution' },
  callback_promised: { w: -1, text: 'callback promised' },
};

const CSAT_WEIGHT = { 1: -16, 2: -11, 3: -2, 4: 7, 5: 11 };

function npsWeight(score) {
  if (score <= 6) return -(4 + (6 - score) * 2);
  if (score <= 8) return 2;
  return 10;
}

const round1 = (n) => Math.round(n * 10) / 10;

const quote = (text, max = 90) => {
  const t = String(text).trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * Turns a customer's history into weighted evidence, as it stood at `asOf`.
 * Negative weight = points towards frustration; positive = points towards a good mood.
 */
export function extractSignals(customer, asOf = Date.now()) {
  const signals = [];
  const ageDays = (t) => (asOf - t) / DAY;
  const decay = (w, t) => w * Math.pow(0.5, ageDays(t) / ENGINE.halfLifeDays);
  const inWindow = (t) => t <= asOf && ageDays(t) <= ENGINE.windowDays;
  const add = (s) => signals.push({ ongoing: false, category: 'general', ...s, weight: round1(s.weight) });

  // Tickets ---------------------------------------------------------------
  for (const t of customer.tickets || []) {
    const opened = ts(t.openedAt);
    if (opened > asOf) continue;
    const resolved = t.resolvedAt ? ts(t.resolvedAt) : null;
    const isOpen = !resolved || resolved > asOf;
    const sla = t.slaHours * HOUR;
    const title = categoryTitle(t.category);
    const source = { type: 'ticket', id: t.id };
    if (isOpen) {
      const openFor = asOf - opened;
      let weight = -5;
      let text = `Ticket ${t.id} (${title}) has been open for ${duration(openFor)}`;
      if (openFor > 2 * sla) {
        weight = -16;
        text = `Ticket ${t.id} (${title}) open ${duration(openFor)} — more than twice its ${slaWords(t.slaHours)} SLA`;
      } else if (openFor > sla) {
        weight = -11;
        text = `Ticket ${t.id} (${title}) open ${duration(openFor)} — past its ${slaWords(t.slaHours)} SLA`;
      }
      add({ id: `${t.id}:open`, kind: 'ticket_open', category: t.category, weight, at: opened, ongoing: true, text, source, slaBreach: openFor > sla, slaRatio: openFor / sla });
    } else if (inWindow(resolved)) {
      const withinSla = resolved - opened <= sla;
      add({
        id: `${t.id}:resolved`, kind: 'ticket_resolved', category: t.category, at: resolved, source,
        weight: decay(withinSla ? 5 : 2, resolved),
        text: `Ticket ${t.id} (${title}) resolved ${withinSla ? 'within' : 'after'} SLA on ${shortDate(resolved)}`,
      });
    }
    (t.reopenedAt || []).map(ts).filter(inWindow).forEach((r, i) => {
      add({
        id: `${t.id}:reopen${i}`, kind: 'ticket_reopened', category: t.category, at: r, source,
        weight: decay(-6, r), text: `Ticket ${t.id} was reopened on ${shortDate(r)} — the earlier fix did not hold`,
      });
    });
  }

  // Calls -------------------------------------------------------------------
  for (const c of customer.calls || []) {
    const at = ts(c.at);
    if (!inWindow(at)) continue;
    const source = { type: 'call', id: c.id };
    const outcome = CALL_OUTCOME[c.outcome] || { w: 0, text: c.outcome };
    let w = outcome.w;
    const extras = [];
    if (c.holdMin >= 10) { w -= 4; extras.push(`${c.holdMin} min on hold`); }
    if (c.transfers >= 2) { w -= 3; extras.push(`transferred ${c.transfers} times`); }
    if (w !== 0) {
      add({
        id: `${c.id}:call`, kind: 'call', category: c.category, at, source, weight: decay(w, at),
        text: `Call on ${shortDate(at)} about ${category(c.category).en}: ${outcome.text}${extras.length ? ` (${extras.join(', ')})` : ''}`,
      });
    }
    if (c.note) {
      const a = analyzeText(c.note);
      if (a.label !== 'neutral') {
        add({
          id: `${c.id}:note`, kind: 'agent_note', category: c.category, at, source, weight: decay(a.score * 10, at),
          text: `Agent wrap-up note (${shortDate(at)}) sounds ${a.label}`, quote: quote(c.note), cues: a.label === 'negative' ? a.negative : a.positive,
        });
      }
    }
  }

  // Inbound messages --------------------------------------------------------
  for (const m of customer.messages || []) {
    if (m.direction !== 'in') continue;
    const at = ts(m.at);
    if (!inWindow(at)) continue;
    const a = analyzeText(m.text);
    const source = { type: 'message', id: m.id };
    if (a.label !== 'neutral') {
      add({
        id: `${m.id}:tone`, kind: 'message', category: m.category, at, source, weight: decay(a.score * 14, at),
        text: `${m.channel} message on ${shortDate(at)} uses ${a.label} language`, quote: quote(m.text),
        cues: a.label === 'negative' ? a.negative : a.positive,
      });
    }
    if (a.escalation.length) {
      const labels = [...new Set(a.escalation.map((e) => e.label))];
      add({
        id: `${m.id}:escalation`, kind: 'escalation_language', category: m.category, at, source, weight: decay(-10, at),
        text: `${m.channel} message on ${shortDate(at)} mentions ${labels.join(' and ')}`, quote: quote(m.text),
        cues: a.escalation.map((e) => e.term), escalation: labels,
      });
    }
  }

  // Feedback ----------------------------------------------------------------
  for (const f of customer.feedback || []) {
    const at = ts(f.at);
    if (!inWindow(at)) continue;
    let w = f.type === 'NPS' ? npsWeight(f.score) : CSAT_WEIGHT[f.score] ?? 0;
    const a = f.comment ? analyzeText(f.comment) : null;
    if (a) w += a.score * 6;
    const scale = f.type === 'NPS' ? '10' : '5';
    add({
      id: `${f.id}:fb`, kind: 'feedback', category: f.category || 'general', at, source: { type: 'feedback', id: f.id },
      weight: decay(w, at), text: `${f.type} survey on ${shortDate(at)}: ${f.score}/${scale}`, quote: f.comment ? quote(f.comment) : undefined,
    });
  }

  // Outlet visits -----------------------------------------------------------
  for (const v of customer.visits || []) {
    const at = ts(v.at);
    if (!inWindow(at)) continue;
    let w = 0;
    const parts = [];
    if (v.waitMin >= 60) { w -= 8; parts.push(`waited ${v.waitMin} min`); }
    else if (v.waitMin >= 30) { w -= 5; parts.push(`waited ${v.waitMin} min`); }
    if (v.outcome === 'unresolved') { w -= 6; parts.push('not resolved'); }
    else if (v.outcome === 'referred') { w -= 3; parts.push('referred elsewhere'); }
    else if (v.outcome === 'resolved') { w += 3; parts.push('resolved'); }
    if (w !== 0) {
      add({
        id: `${v.id}:visit`, kind: 'visit', category: v.category, at, source: { type: 'visit', id: v.id }, weight: decay(w, at),
        text: `${v.outlet} visit on ${shortDate(at)} (${category(v.category).en}): ${parts.join(', ')}`,
      });
    }
  }

  // Commitments (follow-ups promised to the customer) -------------------------
  let missedCount = 0;
  for (const f of customer.followUps || []) {
    const created = ts(f.createdAt);
    if (created > asOf || f.status === 'cancelled') continue;
    const due = ts(f.dueAt);
    const done = f.completedAt ? ts(f.completedAt) : null;
    const doneByAsOf = done !== null && done <= asOf;
    const source = { type: 'followUp', id: f.id };
    if (due < asOf && !doneByAsOf) {
      missedCount += 1;
      add({
        id: `${f.id}:missed`, kind: 'missed_commitment', category: f.category, at: due, ongoing: true, source,
        weight: missedCount <= 2 ? -14 : -4,
        text: `Promised "${f.title}" by ${shortDate(due)} — not done (${duration(asOf - due)} overdue)`,
      });
    } else if (doneByAsOf && inWindow(done)) {
      const late = done > due;
      add({
        id: `${f.id}:done`, kind: late ? 'late_commitment' : 'kept_commitment', category: f.category, at: done, source,
        weight: decay(late ? -4 : 3, done),
        text: late ? `"${f.title}" was completed ${duration(done - due)} late` : `Promise kept: "${f.title}"`,
      });
    }
  }

  // Service incidents -------------------------------------------------------
  for (const s of customer.services || []) {
    for (const inc of s.incidents || []) {
      const start = ts(inc.startAt);
      if (start > asOf) continue;
      const end = inc.endAt ? ts(inc.endAt) : null;
      const source = { type: 'incident', id: inc.id };
      if (!end || end > asOf) {
        add({
          id: `${inc.id}:active`, kind: 'incident', category: inc.category || 'network_outage', at: start, ongoing: true, source,
          weight: -7, text: `Known incident affecting ${s.name}: ${inc.title} (since ${shortDate(start)})`,
        });
      } else if (asOf - end <= 7 * DAY) {
        add({
          id: `${inc.id}:recent`, kind: 'incident', category: inc.category || 'network_outage', at: end, source,
          weight: decay(-3, end), text: `${s.name} was affected by "${inc.title}" until ${shortDate(end)}`,
        });
      }
    }
  }

  // Bill shock --------------------------------------------------------------
  const bills = (customer.bills || []).filter((b) => ts(b.issuedAt) <= asOf).sort((a, b) => ts(a.issuedAt) - ts(b.issuedAt));
  if (bills.length >= 2) {
    const latest = bills[bills.length - 1];
    const prev = bills.slice(-4, -1);
    const avg = prev.reduce((s, b) => s + b.amount, 0) / prev.length;
    const ratio = latest.amount / avg;
    const at = ts(latest.issuedAt);
    if (ratio >= 1.4 && inWindow(at)) {
      add({
        id: `${latest.id}:shock`, kind: 'bill_shock', category: 'billing', at, source: { type: 'bill', id: latest.id },
        weight: decay(ratio >= 2 ? -9 : -6, at),
        text: `${latest.period} bill is ${latest.amount.toFixed(3)} OMR — ${ratio.toFixed(1)}× the recent average of ${avg.toFixed(3)} OMR`,
      });
    }
  }

  // Repeat contacts about the same issue --------------------------------------
  const contacts = [
    ...(customer.calls || []).map((c) => ({ at: ts(c.at), category: c.category })),
    ...(customer.messages || []).filter((m) => m.direction === 'in').map((m) => ({ at: ts(m.at), category: m.category })),
    ...(customer.visits || []).map((v) => ({ at: ts(v.at), category: v.category })),
  ].filter((c) => c.at <= asOf && asOf - c.at <= ENGINE.repeatWindowDays * DAY && c.category && c.category !== 'general');
  const byCat = new Map();
  for (const c of contacts) {
    const g = byCat.get(c.category) || { n: 0, latest: 0 };
    g.n += 1;
    g.latest = Math.max(g.latest, c.at);
    byCat.set(c.category, g);
  }
  for (const [cat, g] of byCat) {
    if (g.n < 3) continue;
    add({
      id: `repeat:${cat}`, kind: 'repeat_contact', category: cat, at: g.latest, source: { type: 'pattern', id: cat },
      weight: decay(-Math.min(20, 8 + 4 * (g.n - 3)), g.latest), count: g.n,
      text: `${g.n} contacts about ${category(cat).en} in the last ${ENGINE.repeatWindowDays} days`,
    });
  }

  return signals
    .filter((s) => Math.abs(s.weight) >= 0.5)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

function confidenceLevel(value) {
  if (value >= ENGINE.confidence.high) return { level: 'high', label: 'High' };
  if (value >= ENGINE.confidence.medium) return { level: 'medium', label: 'Medium' };
  return { level: 'low', label: 'Low' };
}

function toReason(s) {
  return {
    id: s.id,
    kind: s.kind,
    text: s.text,
    direction: s.weight < 0 ? 'negative' : 'positive',
    weight: s.weight,
    at: iso(s.at),
    ongoing: s.ongoing,
    category: s.category,
    source: s.source,
    quote: s.quote,
    cues: s.cues,
  };
}

/**
 * Estimates mood as of `asOf`. Always returns an *estimate* object — never a bare label.
 */
export function estimateMood(customer, { asOf = Date.now(), signals } = {}) {
  const all = signals || extractSignals(customer, asOf);
  const meaningful = all.filter((s) => Math.abs(s.weight) >= 1);
  const score = all.reduce((sum, s) => sum + s.weight, 0);
  const strength = all.reduce((sum, s) => sum + Math.abs(s.weight), 0);
  const latest = meaningful.reduce((m, s) => Math.max(m, s.ongoing ? asOf : s.at), 0);
  const latestEvidence = meaningful.reduce((m, s) => Math.max(m, s.at), 0);

  const base = {
    isEstimate: true,
    method: ENGINE.method,
    computedAt: iso(asOf),
    lastEvidenceAt: latestEvidence ? iso(latestEvidence) : null,
    evidenceWindowDays: ENGINE.windowDays,
    signalCount: meaningful.length,
    disclaimer: DISCLAIMER,
  };

  if (meaningful.length < ENGINE.minSignals || strength < ENGINE.minStrength) {
    const unknownReason = meaningful.length === 0
      ? `No interactions with mood evidence in the last ${ENGINE.windowDays} days`
      : `Only ${meaningful.length} weak signal${meaningful.length === 1 ? '' : 's'} in the last ${ENGINE.windowDays} days — not enough to estimate`;
    return {
      ...base,
      mood: 'unknown',
      label: MOODS.unknown.label,
      score: null,
      confidence: { level: 'none', label: 'Not enough evidence', value: 0 },
      mixedSignals: false,
      latestPointsOtherWay: false,
      unknownReason,
      reasons: meaningful.slice(0, 3).map(toReason),
      counterEvidence: [],
    };
  }

  const { thresholds } = ENGINE;
  const mood = score <= thresholds.upset ? 'upset'
    : score <= thresholds.frustrated ? 'frustrated'
      : score >= thresholds.positive ? 'positive'
        : 'neutral';

  // Confidence = how much evidence, how consistent, how fresh, how strong.
  const amount = Math.min(1, meaningful.length / 6);
  // For "neutral", strong evidence that cancels out means mixed signals, not calm.
  const agreement = mood === 'neutral' ? Math.max(0, 1 - strength / 40) : Math.abs(score) / strength;
  const mixed = agreement < 0.5;
  const freshness = Math.pow(0.5, (asOf - latest) / DAY / ENGINE.halfLifeDays);
  const weight = Math.min(1, strength / 50);
  let value = 0.35 * amount + 0.35 * Math.max(0, agreement) + 0.15 * freshness + 0.15 * weight;

  const supportsNegative = mood === 'upset' || mood === 'frustrated';
  // If the most recent interaction points the other way, the mood may be turning.
  const newest = meaningful.filter((s) => !s.ongoing).sort((a, b) => b.at - a.at)[0];
  const turning = Boolean(newest) && mood !== 'neutral' && (supportsNegative ? newest.weight > 0 : newest.weight < 0);
  if (turning) value *= 0.85;
  if (mixed) value = Math.min(value, mood === 'neutral' ? ENGINE.confidence.medium - 0.01 : ENGINE.confidence.high - 0.01);
  const supporting = mood === 'neutral'
    ? meaningful
    : meaningful.filter((s) => (supportsNegative ? s.weight < 0 : s.weight > 0));
  const counter = mood === 'neutral' ? [] : meaningful.filter((s) => (supportsNegative ? s.weight > 0 : s.weight < 0));

  return {
    ...base,
    mood,
    label: MOODS[mood].label,
    score: Math.round(score),
    confidence: { ...confidenceLevel(value), value: Math.round(value * 100) / 100 },
    mixedSignals: mixed,
    latestPointsOtherWay: turning,
    unknownReason: null,
    reasons: supporting.slice(0, 5).map(toReason),
    counterEvidence: counter.slice(0, 3).map(toReason),
  };
}

/**
 * The latest agent observation stays in force for a limited time and only while
 * no newer interaction evidence has arrived.
 */
export function activeObservation(corrections, signals, now = Date.now()) {
  const latest = [...(corrections || [])].sort((a, b) => ts(b.at) - ts(a.at))[0];
  if (!latest) return null;
  const at = ts(latest.at);
  const expires = at + ENGINE.observationTtlHours * HOUR;
  if (now > expires) return null;
  const newer = (signals || []).some((s) => !s.ongoing && s.at > at);
  if (newer) return null;
  return {
    mood: latest.mood,
    label: MOODS[latest.mood]?.label || latest.mood,
    verdict: latest.verdict,
    agent: latest.agent,
    note: latest.note,
    at: latest.at,
    expiresAt: iso(expires),
  };
}

/** What the UI should lead with: an active agent observation, else the estimate. */
export function displayMood(estimate, observation) {
  if (observation) {
    return {
      mood: observation.mood,
      label: observation.label,
      source: 'agent',
      sourceLabel: observation.verdict === 'confirmed' ? 'Agent-confirmed' : 'Agent-reported',
    };
  }
  return { mood: estimate.mood, label: estimate.label, source: 'estimate', sourceLabel: 'Estimated' };
}
