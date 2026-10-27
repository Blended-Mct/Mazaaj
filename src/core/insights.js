// Turns mood evidence into things an agent can act on: escalation flags,
// missed commitments, frustration triggers and suggested greeting/tone/next step.

import { category, categoryTitle } from './categories.js';
import { DAY, ts, iso, shortDate, duration, relative, muscatHour } from './time.js';

const ROUTE = {
  cancellation: 'Retention desk',
  'switching provider': 'Retention desk',
  'regulator complaint': 'Complaints team lead',
  'legal action': 'Complaints team lead',
  'public complaint': 'Complaints team lead',
};

/** Follow-ups promised to the customer that are past due and not done. */
export function missedCommitments(customer, now) {
  return (customer.followUps || [])
    .filter((f) => f.status === 'open' && ts(f.dueAt) < now)
    .map((f) => ({
      id: f.id,
      title: f.title,
      category: f.category,
      dueAt: f.dueAt,
      overdueBy: duration(now - ts(f.dueAt)),
      owner: f.owner,
      ticketId: f.ticketId || null,
      text: `"${f.title}" was due ${shortDate(f.dueAt)} (${duration(now - ts(f.dueAt))} overdue)`,
    }))
    .sort((a, b) => ts(a.dueAt) - ts(b.dueAt));
}

/** Everything still open for this customer. */
export function unresolvedIssues(customer, now) {
  const items = [];
  for (const t of customer.tickets || []) {
    if (t.status === 'resolved') continue;
    const openFor = now - ts(t.openedAt);
    const breached = openFor > t.slaHours * 3600 * 1000;
    items.push({
      type: 'ticket', id: t.id, category: t.category, title: t.subject, since: t.openedAt,
      status: breached ? 'sla_breached' : 'open',
      detail: `${categoryTitle(t.category)} · open ${duration(openFor)} · ${t.team}${breached ? ' · SLA breached' : ''}`,
    });
  }
  for (const f of customer.followUps || []) {
    if (f.status !== 'open') continue;
    const overdue = ts(f.dueAt) < now;
    items.push({
      type: 'followUp', id: f.id, category: f.category, title: f.title, since: f.createdAt,
      status: overdue ? 'overdue' : 'pending',
      detail: overdue ? `Overdue by ${duration(now - ts(f.dueAt))} · ${f.owner}` : `Due ${relative(f.dueAt, now)} · ${f.owner}`,
    });
  }
  for (const s of customer.services || []) {
    for (const inc of s.incidents || []) {
      if (inc.endAt && ts(inc.endAt) <= now) continue;
      items.push({
        type: 'incident', id: inc.id, category: inc.category || 'network_outage', title: inc.title, since: inc.startAt,
        status: 'active', detail: `Affects ${s.name} · since ${shortDate(inc.startAt)}`,
      });
    }
  }
  const rank = { sla_breached: 0, overdue: 0, active: 1, open: 2, pending: 3 };
  return items.sort((a, b) => rank[a.status] - rank[b.status] || ts(a.since) - ts(b.since));
}

/** Issue areas and service behaviours that keep showing up in negative evidence. */
export function frustrationTriggers(customer, signals, now) {
  const triggers = [];
  const byCat = new Map();
  for (const s of signals) {
    if (s.weight >= 0 || !s.category || s.category === 'general') continue;
    const g = byCat.get(s.category) || { weight: 0, count: 0, last: 0 };
    g.weight += s.weight;
    g.count += 1;
    g.last = Math.max(g.last, s.ongoing ? now : s.at);
    byCat.set(s.category, g);
  }
  for (const [cat, g] of [...byCat].sort((a, b) => a[1].weight - b[1].weight)) {
    if (g.weight > -6) continue;
    triggers.push({ key: cat, type: 'topic', label: categoryTitle(cat), detail: `${g.count} negative signal${g.count === 1 ? '' : 's'}`, lastAt: iso(g.last) });
  }

  const recent = (t) => now - ts(t) <= 90 * DAY;
  const transfers = (customer.calls || []).filter((c) => recent(c.at) && (c.transfers >= 1 || c.outcome === 'transferred')).length;
  if (transfers >= 2) triggers.push({ key: 'transfers', type: 'behaviour', label: 'Being transferred', detail: `${transfers} calls transferred in 90 days` });
  const waits = [
    ...(customer.calls || []).filter((c) => recent(c.at) && c.holdMin >= 10),
    ...(customer.visits || []).filter((v) => recent(v.at) && v.waitMin >= 30),
  ].length;
  if (waits >= 2) triggers.push({ key: 'waiting', type: 'behaviour', label: 'Long waiting times', detail: `${waits} long waits in 90 days` });
  const broken = signals.filter((s) => s.kind === 'missed_commitment' || s.kind === 'late_commitment').length;
  if (broken >= 1) triggers.push({ key: 'promises', type: 'behaviour', label: 'Promises not kept', detail: `${broken} missed or late commitment${broken === 1 ? '' : 's'}` });
  const reopened = signals.filter((s) => s.kind === 'ticket_reopened').length;
  if (reopened >= 1) triggers.push({ key: 'repeat_fix', type: 'behaviour', label: 'Fixes that did not hold', detail: `${reopened} reopened ticket${reopened === 1 ? '' : 's'}` });
  return triggers;
}

/** Rule-based escalation check. Each rule explains itself. */
export function assessEscalation(customer, estimate, signals, now, observation = null) {
  const reasons = [];
  const push = (level, text, route) => reasons.push({ level, text, route });

  for (const s of signals.filter((x) => x.kind === 'escalation_language' && now - x.at <= 14 * DAY)) {
    const label = s.escalation[0];
    push('urgent', `Customer mentioned ${s.escalation.join(' and ')} (${relative(s.at, now)})`, ROUTE[label] || 'Team lead');
  }
  const missed = signals.filter((s) => s.kind === 'missed_commitment');
  if (missed.length >= 2) push('urgent', `${missed.length} commitments to this customer have been missed`, 'Team lead');
  else if (missed.length === 1 && estimate.mood === 'upset') push('recommended', 'A missed commitment while the customer is estimated to be upset', 'Team lead');
  for (const s of signals.filter((x) => x.kind === 'ticket_open' && x.slaRatio > 2)) {
    push('recommended', `${s.source.id} is open more than twice its SLA`, category(s.category).team);
  }
  for (const s of signals.filter((x) => x.kind === 'repeat_contact' && x.count >= 4)) {
    push('recommended', `${s.count} contacts about ${category(s.category).en} in 14 days`, category(s.category).team);
  }
  if (observation?.mood === 'upset') {
    push('recommended', `Agent reported the customer as upset (${relative(observation.at, now)})`, 'Team lead');
  } else if (estimate.mood === 'upset' && estimate.confidence.level === 'high') {
    push('recommended', 'Estimated upset with high confidence', 'Team lead');
  }

  const level = reasons.some((r) => r.level === 'urgent') ? 'urgent' : reasons.length ? 'recommended' : 'none';
  const ordered = [...reasons].sort((a, b) => (a.level === 'urgent' ? -1 : 0) - (b.level === 'urgent' ? -1 : 0));
  return { needed: reasons.length > 0, level, route: ordered[0]?.route || null, reasons: ordered };
}

function timeOfDay(now) {
  const h = muscatHour(now);
  if (h >= 4 && h < 12) return { en: 'Good morning', ar: 'صباح الخير' };
  if (h >= 12 && h < 17) return { en: 'Good afternoon', ar: 'مساء الخير' };
  return { en: 'Good evening', ar: 'مساء الخير' };
}

const TONE = {
  upset: {
    style: ['Calm', 'Apologetic', 'Take ownership'],
    guidance: 'Let them speak first and do not interrupt. Acknowledge the problem without blaming other teams. Give one concrete commitment you can keep.',
    avoid: ['Transferring the call', 'Asking them to repeat details already on file', 'Offers or upselling'],
  },
  frustrated: {
    style: ['Empathetic', 'Direct', 'Solution-first'],
    guidance: 'Acknowledge the issue early, then move quickly to a concrete next step with a clear timeframe.',
    avoid: ['Scripted apologies', 'Vague timelines ("soon")', 'Upselling before the issue is handled'],
  },
  neutral: {
    style: ['Friendly', 'Efficient'],
    guidance: 'Standard service. Confirm the reason for the call and resolve it efficiently.',
    avoid: ['Assuming the reason for the call'],
  },
  positive: {
    style: ['Warm', 'Upbeat'],
    guidance: 'Keep it warm and efficient. A good moment to check everything is working and invite feedback.',
    avoid: ['Over-long scripts'],
  },
  unknown: {
    style: ['Friendly', 'Curious'],
    guidance: 'There is not enough evidence to estimate mood. Open with a question, listen for cues, and record how the customer seemed after the call.',
    avoid: ['Assuming the customer is happy or unhappy'],
  },
};

/**
 * Greeting, tone and next best actions. `mood` is the mood the UI leads with
 * (an agent observation if one is active, otherwise the estimate).
 */
export function suggest(customer, { mood, missed, escalation, signals, now }) {
  const tod = timeOfDay(now);
  const t = customer.title || { en: customer.name, ar: customer.nameAr || customer.name };
  const openTickets = (customer.tickets || []).filter((x) => x.status !== 'resolved').sort((a, b) => ts(b.openedAt) - ts(a.openedAt));
  const billShock = signals.find((s) => s.kind === 'bill_shock');

  // The middle sentence: acknowledge what we know without telling the customer how they feel.
  let follow;
  if ((mood === 'upset' || mood === 'frustrated') && missed.length) {
    const c = category(missed[0].category);
    follow = {
      en: `I'm sorry we didn't get back to you as promised about your ${c.en}. I have your case in front of me and I'll stay with it until it's sorted.`,
      ar: `نعتذر لأننا لم نعاود التواصل معك كما وعدنا بخصوص ${c.ar}. ملفك أمامي الآن وسأتابعه معك حتى يتم حله.`,
    };
  } else if ((mood === 'upset' || mood === 'frustrated') && openTickets.length) {
    const c = category(openTickets[0].category);
    follow = {
      en: `I can see your open request about your ${c.en} — let me get you a proper update right away.`,
      ar: `أرى طلبك المفتوح بخصوص ${c.ar}، دعني أعطيك آخر المستجدات فوراً.`,
    };
  } else if ((mood === 'upset' || mood === 'frustrated') && billShock) {
    follow = {
      en: 'I can see you have a question about your latest bill — let\'s go through it together.',
      ar: 'أرى أن لديك استفساراً بخصوص فاتورتك الأخيرة، دعنا نراجعها معاً.',
    };
  } else if (mood === 'upset' || mood === 'frustrated') {
    follow = { en: "I'm here to help, and I'll make sure we sort this out today.", ar: 'أنا هنا لمساعدتك، وسأحرص على حل الموضوع اليوم.' };
  } else if (mood === 'positive') {
    follow = { en: "It's good to hear from you again — how can I help today?", ar: 'سعداء بتواصلك معنا مجدداً، كيف يمكنني مساعدتك اليوم؟' };
  } else {
    follow = { en: 'How can I help you today?', ar: 'كيف يمكنني مساعدتك اليوم؟' };
  }

  const greeting = {
    language: customer.language === 'ar' ? 'ar' : 'en',
    call: {
      en: `${tod.en}, ${t.en} — thank you for calling Omantel. ${follow.en}`,
      ar: `${tod.ar} ${t.ar}، شكراً لاتصالك بعمانتل. ${follow.ar}`,
    },
    outlet: {
      en: `${tod.en}, ${t.en} — welcome to Omantel. ${follow.en}`,
      ar: `${tod.ar} ${t.ar}، أهلاً بك في عمانتل. ${follow.ar}`,
    },
  };

  const actions = [];
  const act = (priority, text, ref) => actions.push({ priority, text, ref: ref || null });
  if (escalation.needed) {
    act(escalation.level === 'urgent' ? 'urgent' : 'high', `Escalate to ${escalation.route}: ${escalation.reasons[0].text.charAt(0).toLowerCase()}${escalation.reasons[0].text.slice(1)}.`);
  }
  for (const m of missed.slice(0, 2)) {
    act('high', `Deliver the missed commitment "${m.title}" (due ${shortDate(m.dueAt)}). Give a firm date and log a new follow-up.`, { type: 'followUp', id: m.id });
  }
  for (const s of signals.filter((x) => x.kind === 'ticket_open' && x.slaBreach).slice(0, 2)) {
    act('high', `Chase ${s.source.id} with ${category(s.category).team} and give the customer a clear ETA.`, s.source);
  }
  if (billShock) act('normal', 'Walk through the latest bill line by line and check for one-off or roaming charges.', billShock.source);
  const breachedIds = new Set(signals.filter((x) => x.kind === 'ticket_open' && x.slaBreach).map((x) => x.source.id));
  for (const tk of openTickets.filter((x) => !breachedIds.has(x.id)).slice(0, 1)) {
    act('normal', `Share the latest status of ${tk.id} (${categoryTitle(tk.category).toLowerCase()}).`, { type: 'ticket', id: tk.id });
  }
  if (mood === 'positive' && !actions.length) act('normal', 'Confirm everything is working well and invite feedback.');
  if (mood === 'unknown') act('normal', 'Confirm the reason for the call, then record how the customer seemed so future estimates improve.');
  if (!actions.length) act('normal', 'Resolve the reason for the call first time; log a follow-up only if you promise something.');

  return { greeting, tone: TONE[mood] || TONE.unknown, nextActions: actions };
}
