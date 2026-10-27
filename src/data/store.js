// In-memory customer store backed by the demo data generator.
// Agent actions (mood corrections, follow-ups) are kept in a small JSON state
// file so they survive restarts. Set MIZAJ_STATE_FILE="" to keep them in memory only.

import fs from 'node:fs';
import path from 'node:path';
import { generateDemoData } from './demo-data.js';
import { AGENT_MOODS } from '../core/mood-engine.js';
import { iso, ts } from '../core/time.js';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Normalises Omani numbers: "9000 1001", "+968 9000-1001", "0096890001001" → "+96890001001". */
export function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 8) digits = `968${digits}`;
  if (digits.length !== 11 || !digits.startsWith('968')) return null;
  return `+${digits}`;
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

export function createStore({ now = Date.now(), stateFile = null, populationSize } = {}) {
  let customers = [];
  let byId = new Map();
  let byPhone = new Map();
  let seedCorrections = [];
  let state = emptyState();
  const recentCalls = [];
  let writeTimer = null;

  function emptyState() {
    return { version: 1, corrections: [], followUpUpdates: {}, addedFollowUps: [] };
  }

  function load() {
    if (!stateFile) return emptyState();
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return { ...emptyState(), ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[mizaj] Ignoring unreadable state file ${stateFile}: ${err.message}`);
      return emptyState();
    }
  }

  function persist() {
    if (!stateFile) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      const tmp = `${stateFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, stateFile);
    }, 150);
    writeTimer.unref?.();
  }

  function build(generatedAt) {
    const data = generateDemoData(generatedAt, populationSize ? { populationSize } : undefined);
    customers = data.customers;
    seedCorrections = data.corrections;
    byId = new Map(customers.map((c) => [c.id, c]));
    byPhone = new Map(customers.map((c) => [c.phone, c]));
    for (const f of state.addedFollowUps) byId.get(f.customerId)?.followUps.push(stripCustomer(f));
    for (const c of customers) {
      for (const f of c.followUps) Object.assign(f, state.followUpUpdates[f.id] || {});
    }
  }

  const stripCustomer = ({ customerId, ...rest }) => rest;

  state = load();
  build(now);

  return {
    generatedAt: iso(now),

    list: () => customers,
    get: (id) => byId.get(id) || null,

    findByPhone(raw) {
      const phone = normalizePhone(raw);
      return phone ? byPhone.get(phone) || null : null;
    },

    /** Phone (full or partial digits), name or account number. */
    search(q, limit = 8) {
      const query = String(q || '').trim();
      if (!query) return [];
      const exact = this.findByPhone(query);
      if (exact) return [exact];
      const digits = query.replace(/\D/g, '');
      const lower = query.toLowerCase();
      const hits = [];
      for (const c of customers) {
        const phoneHit = digits.length >= 3 && /^[\d\s+()-]+$/.test(query) && c.phone.replace(/\D/g, '').includes(digits);
        const nameHit = lower.length >= 2 && !/^[\d\s+()-]+$/.test(query)
          && (c.name.toLowerCase().includes(lower) || c.nameAr.includes(query) || c.accountNo.toLowerCase().includes(lower) || c.id.toLowerCase() === lower);
        if (phoneHit || nameHit) hits.push(c);
        if (hits.length >= limit) break;
      }
      return hits;
    },

    corrections(customerId) {
      return [...seedCorrections, ...state.corrections]
        .filter((c) => !customerId || c.customerId === customerId)
        .sort((a, b) => ts(b.at) - ts(a.at));
    },

    addCorrection(customerId, body, estimate, at = Date.now()) {
      if (!byId.has(customerId)) return null;
      const verdict = body?.verdict === 'confirmed' ? 'confirmed' : 'corrected';
      let mood = body?.mood;
      if (verdict === 'confirmed') {
        if (estimate.mood === 'unknown') throw new ValidationError('An "Unknown" estimate cannot be confirmed — choose the mood you observed instead.');
        mood = mood || estimate.mood;
      }
      if (!AGENT_MOODS.includes(mood)) throw new ValidationError(`mood must be one of: ${AGENT_MOODS.join(', ')}`);
      const correction = {
        id: `MC-${String(seedCorrections.length + state.corrections.length + 1).padStart(4, '0')}`,
        customerId,
        at: iso(at),
        agent: clean(body.agent, 60) || 'Agent',
        verdict: verdict === 'confirmed' && mood !== estimate.mood ? 'corrected' : verdict,
        mood,
        note: clean(body.note, 500),
        estimateAtTime: { mood: estimate.mood, confidence: estimate.confidence.level, score: estimate.score },
      };
      state.corrections.push(correction);
      persist();
      return correction;
    },

    addFollowUp(customerId, body, at = Date.now()) {
      const customer = byId.get(customerId);
      if (!customer) return null;
      const title = clean(body?.title, 140);
      if (!title) throw new ValidationError('title is required');
      const due = ts(body.dueAt);
      if (!Number.isFinite(due)) throw new ValidationError('dueAt must be an ISO date-time');
      const f = {
        id: `F-${customerId}-U${state.addedFollowUps.length + 1}`,
        title,
        category: clean(body.category, 40) || 'general',
        createdAt: iso(at),
        dueAt: iso(due),
        status: 'open',
        completedAt: null,
        owner: clean(body.owner, 60) || 'Agent',
        source: 'agent',
        ticketId: clean(body.ticketId, 20) || null,
      };
      state.addedFollowUps.push({ customerId, ...f });
      customer.followUps.push(f);
      persist();
      return f;
    },

    updateFollowUp(followUpId, body, at = Date.now()) {
      const status = body?.status;
      if (!['open', 'done', 'cancelled'].includes(status)) throw new ValidationError('status must be open, done or cancelled');
      for (const c of customers) {
        const f = c.followUps.find((x) => x.id === followUpId);
        if (!f) continue;
        const update = { status, completedAt: status === 'done' ? iso(at) : null };
        Object.assign(f, update);
        const added = state.addedFollowUps.find((x) => x.id === followUpId);
        if (added) Object.assign(added, update);
        else state.followUpUpdates[followUpId] = update;
        persist();
        return { customerId: c.id, followUp: f };
      }
      return null;
    },

    recordCall(event) {
      recentCalls.unshift(event);
      recentCalls.length = Math.min(recentCalls.length, 25);
      return event;
    },
    recentCalls: () => recentCalls,

    /** Clears agent actions and regenerates the demo data around the current time. */
    reset(at = Date.now()) {
      state = emptyState();
      recentCalls.length = 0;
      build(at);
      this.generatedAt = iso(at);
      persist();
    },

    flush() {
      if (!stateFile || !writeTimer) return;
      clearTimeout(writeTimer);
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    },
  };
}
