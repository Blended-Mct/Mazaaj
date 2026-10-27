// One chronological feed of everything that happened with a customer.

import { analyzeText } from './sentiment.js';
import { categoryTitle } from './categories.js';
import { MOODS } from './mood-engine.js';
import { ts, shortDate } from './time.js';

const OUTCOME = {
  resolved: 'Resolved', unresolved: 'Not resolved', transferred: 'Transferred', dropped: 'Dropped', callback_promised: 'Callback promised',
};

export function buildTimeline(customer, corrections = [], now = Date.now()) {
  const ev = [];
  const push = (e) => ev.push({ flags: [], ...e });

  for (const c of customer.calls || []) {
    const flags = [];
    if (c.holdMin >= 10) flags.push(`${c.holdMin} min hold`);
    if (c.transfers >= 1) flags.push(`${c.transfers} transfer${c.transfers > 1 ? 's' : ''}`);
    push({
      id: c.id, type: 'call', at: c.at, channel: 'Call centre', title: `Call · ${c.reason}`,
      detail: `${OUTCOME[c.outcome] || c.outcome} · ${c.durationMin} min · ${c.agent}`, text: c.note || null,
      category: c.category, flags, outcome: c.outcome,
    });
  }
  for (const m of customer.messages || []) {
    const tone = m.direction === 'in' ? analyzeText(m.text) : null;
    push({
      id: m.id, type: 'message', at: m.at, channel: m.channel,
      title: m.direction === 'in' ? `${m.channel} from customer` : `${m.channel} to customer`,
      text: m.text, category: m.category, direction: m.direction,
      tone: tone && tone.label !== 'neutral' ? { label: tone.label, cues: tone.label === 'negative' ? tone.negative : tone.positive } : null,
      flags: tone?.escalation.length ? [`mentions ${tone.escalation.map((e) => e.label).join(', ')}`] : [],
    });
  }
  for (const t of customer.tickets || []) {
    push({ id: `${t.id}-opened`, type: 'ticket', at: t.openedAt, channel: t.channel, title: `Ticket ${t.id} opened · ${categoryTitle(t.category)}`, detail: `${t.subject} · ${t.team}`, category: t.category, ref: t.id });
    (t.reopenedAt || []).forEach((r, i) => push({ id: `${t.id}-reopened-${i}`, type: 'ticket', at: r, channel: 'System', title: `Ticket ${t.id} reopened`, detail: t.subject, category: t.category, ref: t.id, flags: ['reopened'] }));
    if (t.resolvedAt) {
      const late = ts(t.resolvedAt) - ts(t.openedAt) > t.slaHours * 3600 * 1000;
      push({ id: `${t.id}-resolved`, type: 'ticket', at: t.resolvedAt, channel: 'System', title: `Ticket ${t.id} resolved`, detail: t.subject, category: t.category, ref: t.id, flags: late ? ['after SLA'] : ['within SLA'] });
    }
  }
  for (const f of customer.feedback || []) {
    const scale = f.type === 'NPS' ? 10 : 5;
    push({ id: f.id, type: 'feedback', at: f.at, channel: f.channel, title: `${f.type} survey · ${f.score}/${scale}`, text: f.comment || null, category: f.category, score: f.score, scale });
  }
  for (const v of customer.visits || []) {
    const flags = v.waitMin >= 30 ? [`waited ${v.waitMin} min`] : [];
    push({ id: v.id, type: 'visit', at: v.at, channel: v.outlet, title: `Outlet visit · ${v.purpose}`, detail: `${v.outlet} · ${v.outcome === 'resolved' ? 'Resolved' : v.outcome === 'referred' ? 'Referred' : 'Not resolved'} · waited ${v.waitMin} min`, text: v.note || null, category: v.category, flags });
  }
  for (const f of customer.followUps || []) {
    push({ id: `${f.id}-created`, type: 'followUp', at: f.createdAt, channel: f.owner, title: `Promised: ${f.title}`, detail: `Due ${shortDate(f.dueAt)}`, dueAt: f.dueAt, category: f.category, ref: f.id });
    if (f.status === 'done' && f.completedAt) {
      const late = ts(f.completedAt) > ts(f.dueAt);
      push({ id: `${f.id}-done`, type: 'followUp', at: f.completedAt, channel: f.owner, title: `Done: ${f.title}`, category: f.category, ref: f.id, flags: late ? ['late'] : ['on time'] });
    } else if (f.status === 'open' && ts(f.dueAt) < now) {
      push({ id: `${f.id}-missed`, type: 'followUp', at: f.dueAt, channel: f.owner, title: `Missed: ${f.title}`, category: f.category, ref: f.id, flags: ['missed commitment'] });
    }
  }
  for (const s of customer.services || []) {
    for (const inc of s.incidents || []) {
      push({ id: `${inc.id}-${s.id}-start`, type: 'incident', at: inc.startAt, channel: 'Network', title: `Incident started · ${inc.title}`, detail: `Affects ${s.name}`, category: inc.category });
      if (inc.endAt && ts(inc.endAt) <= now) push({ id: `${inc.id}-${s.id}-end`, type: 'incident', at: inc.endAt, channel: 'Network', title: `Incident cleared · ${inc.title}`, detail: `Affects ${s.name}`, category: inc.category });
    }
  }
  for (const c of corrections) {
    const label = MOODS[c.mood]?.label || c.mood;
    push({
      id: c.id, type: 'mood', at: c.at, channel: 'Mizaj',
      title: c.verdict === 'confirmed' ? `Mood confirmed by agent · ${label}` : `Mood corrected by agent · ${label}`,
      detail: `${c.agent} · estimate at the time: ${MOODS[c.estimateAtTime?.mood]?.label || 'n/a'}`, text: c.note || null,
    });
  }

  return ev.filter((e) => ts(e.at) <= now).sort((a, b) => ts(b.at) - ts(a.at));
}
