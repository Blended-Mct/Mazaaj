// Assembles the API views of a customer: full profile (web app), brief (call
// popup / integrations) and the shared analysis both are built from.

import { extractSignals, estimateMood, activeObservation, displayMood, DISCLAIMER, ENGINE } from './mood-engine.js';
import { missedCommitments, unresolvedIssues, frustrationTriggers, assessEscalation, suggest } from './insights.js';
import { buildTimeline } from './timeline.js';
import { ts, iso, muscatHour } from './time.js';

export const DEMO_NOTICE = 'Demo data — fictional customers and simulated integrations. Not real Omantel records.';

export function meta(now, extra = {}) {
  return { dataMode: 'demo', demoNotice: DEMO_NOTICE, generatedAt: iso(now), ...extra };
}

export function analyze(customer, corrections, now) {
  const signals = extractSignals(customer, now);
  const estimate = estimateMood(customer, { asOf: now, signals });
  const observation = activeObservation(corrections, signals, now);
  const display = displayMood(estimate, observation);
  const missed = missedCommitments(customer, now);
  const escalation = assessEscalation(customer, estimate, signals, now, observation);
  const triggers = frustrationTriggers(customer, signals, now);
  const suggestions = suggest(customer, { mood: display.mood, missed, escalation, signals, now });
  return { signals, estimate, observation, display, missed, escalation, triggers, suggestions };
}

export function customerSummary(c) {
  return {
    id: c.id, name: c.name, nameAr: c.nameAr, phone: c.phone, segment: c.segment, company: c.company || null,
    region: c.region, language: c.language, demo: c.demo === true,
  };
}

function moodBlock(a, corrections) {
  return {
    display: a.display,
    estimate: a.estimate,
    agentObservation: a.observation,
    history: corrections.slice(0, 10),
  };
}

const byNewest = (key) => (a, b) => ts(b[key]) - ts(a[key]);

export function buildProfile(customer, { corrections, now, sources }) {
  const a = analyze(customer, corrections, now);
  const followUps = [...customer.followUps]
    .map((f) => ({ ...f, overdue: f.status === 'open' && ts(f.dueAt) < now }))
    .sort((x, y) => (x.status === 'open' ? 0 : 1) - (y.status === 'open' ? 0 : 1) || (x.status === 'open' ? ts(x.dueAt) - ts(y.dueAt) : ts(y.dueAt) - ts(x.dueAt)));

  return {
    meta: meta(now, { sources }),
    customer: {
      ...customerSummary(customer),
      title: customer.title,
      customerSince: customer.customerSince,
      accountNo: customer.accountNo,
      story: customer.story || null,
      services: customer.services,
      bills: [...customer.bills].sort(byNewest('issuedAt')),
    },
    mood: moodBlock(a, corrections),
    suggestions: a.suggestions,
    alerts: { escalation: a.escalation, missedCommitments: a.missed, frustrationTriggers: a.triggers },
    unresolved: unresolvedIssues(customer, now),
    followUps,
    tickets: [...customer.tickets].sort(byNewest('openedAt')),
    calls: [...customer.calls].sort(byNewest('at')),
    messages: [...customer.messages].sort(byNewest('at')),
    feedback: [...customer.feedback].sort(byNewest('at')),
    visits: [...customer.visits].sort(byNewest('at')),
    timeline: buildTimeline(customer, corrections, now),
  };
}

/** Compact view for the call popup and other systems. */
export function buildBrief(customer, { corrections, now }) {
  const a = analyze(customer, corrections, now);
  const { estimate } = a;
  return {
    meta: meta(now),
    matched: true,
    customer: { ...customerSummary(customer), title: customer.title },
    mood: {
      display: a.display,
      estimate: {
        isEstimate: true,
        mood: estimate.mood,
        label: estimate.label,
        confidence: estimate.confidence,
        mixedSignals: estimate.mixedSignals,
        latestPointsOtherWay: estimate.latestPointsOtherWay,
        unknownReason: estimate.unknownReason,
        signalCount: estimate.signalCount,
        lastEvidenceAt: estimate.lastEvidenceAt,
        computedAt: estimate.computedAt,
        reasons: estimate.reasons.slice(0, 3),
        disclaimer: estimate.disclaimer,
      },
      agentObservation: a.observation,
    },
    greeting: a.suggestions.greeting,
    tone: a.suggestions.tone,
    nextActions: a.suggestions.nextActions.slice(0, 3),
    alerts: {
      escalation: a.escalation,
      missedCommitments: a.missed,
      frustrationTriggers: a.triggers.slice(0, 4),
    },
    openIssues: unresolvedIssues(customer, now).length,
    links: { profile: `/#/customer/${customer.id}`, api: `/api/v1/customers/${customer.id}` },
  };
}

/** Brief for a number with no customer record: say so plainly, never guess. */
export function unmatchedBrief(phone, now) {
  const h = muscatHour(now);
  const tod = h >= 4 && h < 12 ? { en: 'Good morning', ar: 'صباح الخير' } : h < 17 && h >= 12 ? { en: 'Good afternoon', ar: 'مساء الخير' } : { en: 'Good evening', ar: 'مساء الخير' };
  return {
    meta: meta(now),
    matched: false,
    phone,
    customer: null,
    mood: {
      display: { mood: 'unknown', label: 'Unknown', source: 'estimate', sourceLabel: 'Estimated' },
      estimate: {
        isEstimate: true, mood: 'unknown', label: 'Unknown', confidence: { level: 'none', label: 'Not enough evidence', value: 0 },
        unknownReason: 'No customer record matches this number', signalCount: 0, lastEvidenceAt: null, computedAt: iso(now),
        reasons: [], disclaimer: DISCLAIMER, method: ENGINE.method,
      },
      agentObservation: null,
    },
    greeting: {
      language: 'ar',
      call: {
        en: `${tod.en} — thank you for calling Omantel. May I have your name, please?`,
        ar: `${tod.ar}، شكراً لاتصالك بعمانتل. هل لي أن أعرف اسمك الكريم؟`,
      },
      outlet: {
        en: `${tod.en} — welcome to Omantel. How can I help you today?`,
        ar: `${tod.ar}، أهلاً بك في عمانتل. كيف يمكنني مساعدتك اليوم؟`,
      },
    },
    tone: {
      style: ['Friendly', 'Curious'],
      guidance: 'We have no record for this number. Identify the caller, then look them up by their account number or registered number.',
      avoid: ['Assuming who is calling'],
    },
    nextActions: [{ priority: 'normal', text: 'Verify the caller and search by their registered number or account.', ref: null }],
    alerts: { escalation: { needed: false, level: 'none', route: null, reasons: [] }, missedCommitments: [], frustrationTriggers: [] },
    openIssues: 0,
    links: null,
  };
}
