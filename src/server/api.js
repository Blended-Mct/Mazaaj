// The /api/v1 routes as plain functions, free of Node APIs, so the same handlers
// serve the HTTP server (src/server/app.js) and the in-browser hosted demo
// (src/browser/local-server.js).

import { buildProfile, buildBrief, unmatchedBrief, analyze, customerSummary, meta } from '../core/profile.js';
import { buildDashboard } from '../core/dashboard.js';
import { buildTimeline } from '../core/timeline.js';
import { ENGINE, MOODS, AGENT_MOODS } from '../core/mood-engine.js';
import { CATEGORIES } from '../core/categories.js';
import { integrationStatus } from '../data/integrations.js';
import { normalizePhone, ValidationError } from '../data/store.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const callId = () => `CALL-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

/**
 * @param {object} o
 * @param {object} o.store         customer store (src/data/store.js)
 * @param {() => number} [o.clock]
 * @param {{ broadcast: Function, listeners: () => number }} [o.events]  incoming-call fan-out
 * @param {(headers: object) => boolean} [o.authorizeCti]  checks the CTI webhook key
 * @param {boolean} [o.ctiKeyConfigured]
 * @param {boolean} [o.hosted]     true for the in-browser demo (no live endpoints)
 */
export function createApi({
  store,
  clock = () => Date.now(),
  events = { broadcast: () => 0, listeners: () => 0 },
  authorizeCti = () => true,
  ctiKeyConfigured = false,
  hosted = false,
}) {
  const routes = [];
  const route = (method, pattern, fn) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
    routes.push({ method, re, keys, fn });
  };

  const customerOr404 = (id) => {
    const c = store.get(id);
    if (!c) throw new HttpError(404, `No customer with id ${id}`);
    return c;
  };
  const sources = () => integrationStatus({ ctiKeyConfigured, calls: store.recentCalls(), generatedAt: store.generatedAt, hosted });
  const sourceSummary = () => {
    const s = sources();
    return { summary: s.summary, dataSources: s.dataSources.map(({ key, name, mode }) => ({ key, name, mode })) };
  };
  const moodSummary = (a) => ({ ...a.display, confidence: a.estimate.confidence.level, isEstimate: a.display.source === 'estimate' });

  function handleCall({ phone, callId: id, agentId, queue }, mode) {
    const now = clock();
    const normalized = normalizePhone(phone);
    if (!normalized) throw new ValidationError('phone must be an Omani number, e.g. +968 9000 1001');
    const customer = store.findByPhone(normalized);
    const brief = customer ? buildBrief(customer, { corrections: store.corrections(customer.id), now }) : unmatchedBrief(normalized, now);
    const call = store.recordCall({
      id: String(id || '').slice(0, 64) || callId(),
      receivedAt: new Date(now).toISOString(),
      phone: normalized,
      mode,
      source: mode === 'live' ? 'CTI webhook' : 'Demo call simulator',
      agentId: agentId ? String(agentId).slice(0, 40) : null,
      queue: queue ? String(queue).slice(0, 40) : null,
      customerId: customer?.id || null,
      customerName: customer?.name || null,
      mood: brief.mood.display,
    });
    const deliveredTo = events.broadcast('incoming-call', { call, brief }, call.agentId);
    return { call, brief, deliveredTo };
  }

  route('GET', '/api/v1/health', () => ({ status: 'ok', time: new Date(clock()).toISOString(), listeners: events.listeners() }));

  route('GET', '/api/v1/meta', () => ({
    meta: meta(clock()),
    engine: { ...ENGINE, moods: MOODS, agentMoods: AGENT_MOODS },
    categories: Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, v.title])),
    integrations: sourceSummary(),
  }));

  route('GET', '/api/v1/customers', ({ query }) => {
    const now = clock();
    const limit = Math.min(20, Math.max(1, Number(query.get('limit')) || 8));
    const q = query.get('q') || query.get('phone') || '';
    const results = store.search(q, limit).map((c) => {
      const a = analyze(c, store.corrections(c.id), now);
      return { ...customerSummary(c), mood: moodSummary(a), escalation: a.escalation.level };
    });
    return { meta: meta(now), query: q, results };
  });

  route('GET', '/api/v1/demo/customers', () => {
    const now = clock();
    return {
      meta: meta(now),
      customers: store.list().slice(0, 11).map((c) => {
        const a = analyze(c, store.corrections(c.id), now);
        return { ...customerSummary(c), story: c.story, mood: moodSummary(a), escalation: a.escalation.level };
      }),
    };
  });

  route('GET', '/api/v1/lookup', ({ query }) => {
    const now = clock();
    const phone = normalizePhone(query.get('phone'));
    if (!phone) throw new ValidationError('phone query parameter must be an Omani number, e.g. 90001001');
    const c = store.findByPhone(phone);
    return c ? buildBrief(c, { corrections: store.corrections(c.id), now }) : unmatchedBrief(phone, now);
  });

  route('GET', '/api/v1/customers/:id', ({ params }) => {
    const c = customerOr404(params.id);
    return buildProfile(c, { corrections: store.corrections(c.id), now: clock(), sources: sourceSummary().dataSources });
  });

  route('GET', '/api/v1/customers/:id/brief', ({ params }) => {
    const c = customerOr404(params.id);
    return buildBrief(c, { corrections: store.corrections(c.id), now: clock() });
  });

  route('GET', '/api/v1/customers/:id/mood', ({ params }) => {
    const c = customerOr404(params.id);
    const now = clock();
    const a = analyze(c, store.corrections(c.id), now);
    return {
      meta: meta(now), customerId: c.id, display: a.display, estimate: a.estimate, agentObservation: a.observation,
      escalation: a.escalation, missedCommitments: a.missed, frustrationTriggers: a.triggers, suggestions: a.suggestions,
    };
  });

  route('GET', '/api/v1/customers/:id/timeline', ({ params, query }) => {
    const c = customerOr404(params.id);
    const now = clock();
    const type = query.get('type');
    const items = buildTimeline(c, store.corrections(c.id), now).filter((e) => !type || e.type === type);
    return { meta: meta(now), customerId: c.id, items };
  });

  route('POST', '/api/v1/customers/:id/mood-feedback', ({ params, body }) => {
    const c = customerOr404(params.id);
    const now = clock();
    const before = analyze(c, store.corrections(c.id), now);
    const correction = store.addCorrection(c.id, body, before.estimate, now);
    const after = analyze(c, store.corrections(c.id), now);
    return {
      status: 201,
      body: { correction, mood: { display: after.display, estimate: after.estimate, agentObservation: after.observation } },
    };
  });

  route('GET', '/api/v1/customers/:id/follow-ups', ({ params }) => {
    const c = customerOr404(params.id);
    const now = clock();
    return { meta: meta(now), customerId: c.id, followUps: c.followUps.map((f) => ({ ...f, overdue: f.status === 'open' && Date.parse(f.dueAt) < now })) };
  });

  route('POST', '/api/v1/customers/:id/follow-ups', ({ params, body }) => {
    const c = customerOr404(params.id);
    return { status: 201, body: { followUp: store.addFollowUp(c.id, body, clock()) } };
  });

  route('PATCH', '/api/v1/follow-ups/:id', ({ params, body }) => {
    const result = store.updateFollowUp(params.id, body, clock());
    if (!result) throw new HttpError(404, `No follow-up with id ${params.id}`);
    return result;
  });

  route('GET', '/api/v1/dashboard', ({ query }) => buildDashboard(store, clock(), query.get('days')));

  route('GET', '/api/v1/integrations', () => ({ meta: meta(clock()), ...sources() }));

  route('POST', '/api/v1/calls/incoming', ({ body, headers }) => {
    if (!authorizeCti(headers)) throw new HttpError(401, 'Missing or invalid X-Api-Key');
    return { status: 202, body: handleCall(body, 'live') };
  });

  route('POST', '/api/v1/demo/simulate-call', ({ body }) => {
    let { phone } = body;
    if (!phone) {
      const heroes = store.list().slice(0, 11);
      phone = heroes[Math.floor(Math.random() * heroes.length)].phone;
    }
    return { status: 202, body: handleCall({ ...body, phone }, 'simulated') };
  });

  route('GET', '/api/v1/calls/recent', () => ({ meta: meta(clock()), calls: store.recentCalls() }));

  route('POST', '/api/v1/demo/reset', () => {
    store.reset(clock());
    return { ok: true, generatedAt: store.generatedAt };
  });

  /**
   * @returns {Promise<{status:number, body:object}>}
   */
  async function handle({ method, pathname, query = new URLSearchParams(), body = {}, headers = {} }) {
    const match = routes.find((r) => r.re.test(pathname) && r.method === method);
    if (!match) {
      const exists = routes.some((r) => r.re.test(pathname));
      return { status: exists ? 405 : 404, body: { error: exists ? 'Method not allowed' : 'Unknown API endpoint' } };
    }
    const m = pathname.match(match.re);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    try {
      const out = await match.fn({ params, query, body, headers });
      if (out && typeof out.status === 'number' && 'body' in out) return out;
      return { status: 200, body: out };
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[mizaj]', err);
      return { status, body: { error: status >= 500 ? 'Internal error' : err.message } };
    }
  }

  return { handle };
}
