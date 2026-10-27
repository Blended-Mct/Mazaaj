// HTTP layer: JSON API (/api/v1), Server-Sent Events, and the static web app.
// No login by design — deploy on the agent network or behind your gateway.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventHub } from './events.js';
import { buildProfile, buildBrief, unmatchedBrief, analyze, customerSummary, meta } from '../core/profile.js';
import { buildDashboard } from '../core/dashboard.js';
import { buildTimeline } from '../core/timeline.js';
import { ENGINE, MOODS, AGENT_MOODS } from '../core/mood-engine.js';
import { CATEGORIES } from '../core/categories.js';
import { integrationStatus } from '../data/integrations.js';
import { normalizePhone, ValidationError } from '../data/store.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const PAGES = { '/': 'index.html', '/popup': 'popup.html', '/docs': 'docs.html' };
const MAX_BODY = 64 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(body && typeof body === 'object' && !Array.isArray(body) ? body : {});
      } catch {
        reject(new HttpError(400, 'Body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function createApp({
  store,
  publicDir,
  ctiKey = '',
  corsOrigin = '*',
  embedOrigins = '*',
  clock = () => Date.now(),
} = {}) {
  const events = new EventHub();
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
  const sources = () => integrationStatus({ ctiKeyConfigured: Boolean(ctiKey), calls: store.recentCalls(), generatedAt: store.generatedAt });
  const sourceSummary = () => {
    const s = sources();
    return { summary: s.summary, dataSources: s.dataSources.map(({ key, name, mode }) => ({ key, name, mode })) };
  };

  function handleCall({ phone, callId, agentId, queue }, mode) {
    const now = clock();
    const normalized = normalizePhone(phone);
    if (!normalized) throw new ValidationError('phone must be an Omani number, e.g. +968 9000 1001');
    const customer = store.findByPhone(normalized);
    const brief = customer ? buildBrief(customer, { corrections: store.corrections(customer.id), now }) : unmatchedBrief(normalized, now);
    const call = store.recordCall({
      id: String(callId || '').slice(0, 64) || `CALL-${crypto.randomUUID().slice(0, 8)}`,
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

  // --- API -------------------------------------------------------------------

  route('GET', '/api/v1/health', () => ({ status: 'ok', time: new Date(clock()).toISOString(), listeners: events.clients.size }));

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
      return {
        ...customerSummary(c),
        mood: { ...a.display, confidence: a.estimate.confidence.level, isEstimate: a.display.source === 'estimate' },
        escalation: a.escalation.level,
      };
    });
    return { meta: meta(now), query: q, results };
  });

  route('GET', '/api/v1/demo/customers', () => {
    const now = clock();
    return {
      meta: meta(now),
      customers: store.list().slice(0, 11).map((c) => {
        const a = analyze(c, store.corrections(c.id), now);
        return {
          ...customerSummary(c),
          story: c.story,
          mood: { ...a.display, confidence: a.estimate.confidence.level, isEstimate: a.display.source === 'estimate' },
          escalation: a.escalation.level,
        };
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

  route('POST', '/api/v1/customers/:id/mood-feedback', async ({ params, req }) => {
    const c = customerOr404(params.id);
    const body = await readJson(req);
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

  route('POST', '/api/v1/customers/:id/follow-ups', async ({ params, req }) => {
    const c = customerOr404(params.id);
    const followUp = store.addFollowUp(c.id, await readJson(req), clock());
    return { status: 201, body: { followUp } };
  });

  route('PATCH', '/api/v1/follow-ups/:id', async ({ params, req }) => {
    const result = store.updateFollowUp(params.id, await readJson(req), clock());
    if (!result) throw new HttpError(404, `No follow-up with id ${params.id}`);
    return result;
  });

  route('GET', '/api/v1/dashboard', ({ query }) => buildDashboard(store, clock(), query.get('days')));

  route('GET', '/api/v1/integrations', () => ({ meta: meta(clock()), ...sources() }));

  route('POST', '/api/v1/calls/incoming', async ({ req }) => {
    if (ctiKey && !safeEqual(req.headers['x-api-key'], ctiKey)) throw new HttpError(401, 'Missing or invalid X-Api-Key');
    return { status: 202, body: handleCall(await readJson(req), 'live') };
  });

  route('POST', '/api/v1/demo/simulate-call', async ({ req }) => {
    const body = await readJson(req);
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

  route('GET', '/api/v1/openapi.json', async () => ({ raw: await fs.readFile(path.join(publicDir, 'openapi.json')), type: MIME['.json'] }));

  // --- plumbing ------------------------------------------------------------------

  function send(res, status, body, headers = {}) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body, null, 0));
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Content-Length': payload.length, 'Cache-Control': 'no-store', ...headers });
    res.end(payload);
  }

  async function serveStatic(pathname, res) {
    const file = PAGES[pathname] || pathname.replace(/^\/+/, '');
    let resolved;
    try {
      resolved = path.resolve(publicDir, decodeURIComponent(file));
    } catch {
      return send(res, 400, { error: 'Bad path' });
    }
    if (!resolved.startsWith(path.resolve(publicDir) + path.sep)) return send(res, 404, { error: 'Not found' });
    let data;
    try {
      data = await fs.readFile(resolved);
    } catch {
      return send(res, 404, { error: 'Not found' });
    }
    const ext = path.extname(resolved);
    const isPopup = pathname === '/popup' || pathname === '/popup.html';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        `frame-ancestors ${isPopup ? embedOrigins : "'self'"}`,
      ].join('; '),
    });
    res.end(data);
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');

    if (pathname.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

      if (pathname === '/api/v1/events' && req.method === 'GET') {
        return events.add(req, res, { agentId: url.searchParams.get('agentId') });
      }

      const match = routes.find((r) => r.re.test(pathname) && r.method === req.method);
      if (!match) {
        const exists = routes.some((r) => r.re.test(pathname));
        return send(res, exists ? 405 : 404, { error: exists ? 'Method not allowed' : 'Unknown API endpoint' });
      }
      const m = pathname.match(match.re);
      const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      try {
        const out = await match.fn({ req, params, query: url.searchParams });
        if (out?.raw) return send(res, 200, out.raw, { 'Content-Type': out.type });
        if (out && typeof out.status === 'number' && 'body' in out) return send(res, out.status, out.body);
        return send(res, 200, out);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) console.error('[mizaj]', err);
        return send(res, status, { error: status >= 500 ? 'Internal error' : err.message });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    return serveStatic(pathname, res);
  }

  return { handler, events, close: () => events.close() };
}
