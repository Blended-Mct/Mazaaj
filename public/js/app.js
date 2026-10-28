// Mizaj web app: phone search → unified customer profile, dashboard, integrations,
// and incoming-call panels pushed from the CTI channel.

import {
  html, render, api, prefs, fmt, icon, moodBadge, moodIcon, confidence, demoChip, reasonItem, actionItem,
  greetingBlock, handleGreetingAction, escalationAlert, missedAlert, briefCard, quickCorrect, subscribeCalls, toast, MOOD_LABEL, quoted, runtime,
} from './lib.js';
import { moodMixChart, moodMixTable, barList, deltaNote } from './charts.js';

const view = document.getElementById('view');
const dock = document.getElementById('call-dock');
const quick = document.getElementById('quick-search');

const state = {
  profile: null,
  timelineFilter: 'all',
  correcting: false,
  pickedMood: null,
  dueHours: 24,
  dashDays: 30,
  dashboard: null,
  tables: {},
  shownCalls: new Set(),
  popupCall: null,
};

// ------------------------------------------------------------------ Routing
// Routes are plain hash names (#dashboard, #customer-C1001) so they survive
// hosts that only pass simple fragments; older slash-style links still parse.

const VIEWS = ['dashboard', 'integrations', 'popup', 'api'];

function parseRoute() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const m = /^(customer|phone)[-/](.+)$/.exec(h);
  if (m) return m[1] === 'customer' ? { name: 'customer', id: m[2] } : { name: 'phone', phone: m[2] };
  if (!h) return { name: 'search' };
  return VIEWS.includes(h) ? { name: h } : { name: 'notfound' };
}

function setNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  quick.hidden = name === 'search';
}

async function route() {
  const r = parseRoute();
  state.correcting = false;
  window.scrollTo(0, 0);
  try {
    if (r.name === 'search') await viewSearch();
    else if (r.name === 'customer') await viewCustomer(r.id);
    else if (r.name === 'phone') await viewPhone(r.phone);
    else if (r.name === 'dashboard') await viewDashboard();
    else if (r.name === 'integrations') await viewIntegrations();
    else if (r.name === 'popup') viewPopup();
    else if (r.name === 'api') viewApi();
    else render(view, html`<div class="card"><h2>Page not found</h2><p><a href="#">Back to search</a></p></div>`);
  } catch (err) {
    render(view, html`<div class="card"><h2>Something went wrong</h2><p class="muted">${err.message}</p><p><a href="#">Back to search</a></p></div>`);
  }
}

const loading = (what) => render(view, html`<p class="muted" role="status">Loading ${what}…</p>`);
const pageTitle = (t) => { document.title = t ? `${t} · Mizaj` : 'Mizaj — Customer Mood'; };

// ------------------------------------------------------------------ Search

function moodChip(m) {
  return moodBadge(m.mood, { qualifier: m.isEstimate === false || m.source === 'agent' ? 'Agent' : 'Est.' });
}

function wireSearch(form) {
  const input = form.querySelector('input');
  const box = form.querySelector('.results');
  let results = [];
  let active = -1;
  let timer;
  let seq = 0;

  const show = (q) => {
    if (!q.trim()) { box.hidden = true; return; }
    if (!results.length) {
      render(box, html`<div class="result"><span class="who"><b>No match</b><span>No demo customer matches “${q}”. Try 9000 1001.</span></span></div>`);
    } else {
      render(box, results.map((c, i) => html`<a class="result ${i === active ? 'active' : ''}" href="#customer-${c.id}" data-id="${c.id}">
        <span class="who"><b>${c.name}</b><span>${fmt.phone(c.phone)} · ${c.segment} · ${c.region}</span></span>${moodChip(c.mood)}</a>`));
    }
    box.hidden = false;
  };

  const lookup = async (q) => {
    const mine = ++seq;
    const data = await api(`/customers?q=${encodeURIComponent(q)}`).catch(() => ({ results: [] }));
    if (mine !== seq) return;
    results = data.results;
    active = results.length ? 0 : -1;
    show(q);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value;
    if (q.trim().length < 2) { box.hidden = true; results = []; return; }
    timer = setTimeout(() => lookup(q), 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      show(input.value);
    } else if (e.key === 'Escape') {
      box.hidden = true;
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    clearTimeout(timer);
    await lookup(q);
    const pick = results[Math.max(0, active)];
    if (pick) {
      box.hidden = true;
      input.value = '';
      location.hash = `#customer-${pick.id}`;
    } else if (q.replace(/\D/g, '').length >= 8) {
      location.hash = `#phone-${q.replace(/\D/g, '')}`;
    }
  });
  box.addEventListener('click', () => { box.hidden = true; input.value = ''; });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) box.hidden = true; });
}

async function viewSearch() {
  setNav('search');
  pageTitle('');
  render(view, html`
    <section class="hero">
      <h1>Who’s on the line?</h1>
      <p>Type the customer’s phone number. Mizaj estimates how they are likely feeling and suggests how to open the conversation.</p>
      <form class="search-box" id="main-search" role="search" autocomplete="off">
        ${icon.search}
        <input id="q" type="search" inputmode="tel" placeholder="Phone number, e.g. 9000 1001" aria-label="Customer phone number">
        <div class="results" hidden></div>
        <div class="search-hint">Press Enter to open the profile. Name or account number also works.</div>
      </form>
    </section>
    <section>
      <div class="section-title"><h2>Demo customers ${demoChip()}</h2><span class="small muted">Each one shows a different situation. Click to open.</span></div>
      <div class="demo-grid" id="demo-grid"><p class="muted">Loading…</p></div>
    </section>
    <section id="recent-calls" style="margin-top:28px"></section>`);
  const form = document.getElementById('main-search');
  wireSearch(form);
  form.querySelector('input').focus();

  const [demo, calls] = await Promise.all([api('/demo/customers'), api('/calls/recent')]);
  render(document.getElementById('demo-grid'), demo.customers.map((c) => html`<a class="demo-card" href="#customer-${c.id}">
    <div class="top"><div><b>${c.name}</b><div class="phone">${fmt.phone(c.phone)}</div></div>${moodChip(c.mood)}</div>
    <p>${c.story}</p>
    ${c.escalation !== 'none' ? html`<span class="chip chip-${c.escalation}" style="justify-self:start">${c.escalation === 'urgent' ? icon.stop : icon.warn} Escalation ${c.escalation}</span>` : ''}
  </a>`));
  if (calls.calls.length) {
    render(document.getElementById('recent-calls'), html`<div class="section-title"><h2>Recent calls</h2></div>
      <div class="card"><ul class="list">${calls.calls.slice(0, 6).map((c) => html`<li style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="chip ${c.mode === 'live' ? 'chip-live' : 'chip-sim'}">${c.mode === 'live' ? 'LIVE CTI' : 'SIMULATED'}</span>
        <span class="tabular">${fmt.time(c.receivedAt)}</span>
        ${c.customerId ? html`<a href="#customer-${c.customerId}">${c.customerName}</a>` : html`<span>${fmt.phone(c.phone)} (no record)</span>`}
        ${moodBadge(c.mood.mood, { qualifier: c.mood.source === 'agent' ? 'Agent' : 'Est.' })}
      </li>`)}</ul></div>`);
  }
}

async function viewPhone(phone) {
  setNav('search');
  loading('customer');
  const brief = await api(`/lookup?phone=${encodeURIComponent(phone)}`);
  if (brief.matched) {
    location.replace(`#customer-${brief.customer.id}`);
    return;
  }
  pageTitle('No match');
  render(view, html`<div style="max-width:560px;margin:24px auto" class="stack-gap">
    <p><a href="#">← Back to search</a></p>
    ${briefCard(brief, { workplace: prefs.get().workplace })}
  </div>`);
}

// ------------------------------------------------------------------ Customer profile

async function viewCustomer(id) {
  setNav('search');
  if (state.profile?.customer.id !== id) {
    loading('customer');
    state.timelineFilter = 'all';
  }
  state.profile = await api(`/customers/${encodeURIComponent(id)}`);
  pageTitle(state.profile.customer.name);
  renderProfile();
}

async function refreshProfile() {
  if (!state.profile) return;
  state.profile = await api(`/customers/${encodeURIComponent(state.profile.customer.id)}`);
  renderProfile();
}

function renderProfile() {
  const p = state.profile;
  const c = p.customer;
  render(view, html`
    <div class="profile-head">
      <div>
        <h1>${c.name} <span class="ar" lang="ar" dir="rtl">${c.nameAr}</span> ${c.demo ? demoChip() : ''}</h1>
        <div class="facts">
          <span>${icon.phone}<span class="tabular">${fmt.phone(c.phone)}</span></span>
          <span>${icon.user}${c.segment}${c.company ? ` · ${c.company}` : ''}</span>
          <span>${icon.pin}${c.region}</span>
          <span>${icon.globe}${fmt.lang(c.language)}</span>
          <span>${icon.calendar}Customer since ${new Date(c.customerSince).getFullYear()}</span>
        </div>
        ${c.story ? html`<div class="story">Demo scenario: ${c.story}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-sm" data-action="simulate-call" data-phone="${c.phone}">${icon.phone} Simulate a call from this customer</button>
      </div>
    </div>
    <div class="grid-profile">
      <div>${moodCard(p)}${sayCard(p)}${timelineCard(p)}</div>
      <div>${alertsCard(p)}${unresolvedCard(p)}${followUpsCard(p)}${servicesCard(p)}${feedbackCard(p)}</div>
    </div>`);
}

function moodCard(p) {
  const { display, estimate, agentObservation: obs } = p.mood;
  const unknown = estimate.mood === 'unknown';
  const picker = html`<div class="correct-panel" id="correct-panel">
    <div class="small"><b>What mood are you observing?</b> Your observation is shown to other agents until new evidence arrives (max 72 hours).</div>
    <div class="mood-pick" role="group" aria-label="Observed mood">
      ${['positive', 'neutral', 'frustrated', 'upset'].map((m) => html`<button type="button" class="mood mood-${m}" data-action="pick-mood" data-mood="${m}" aria-pressed="${state.pickedMood === m}">${moodIcon(m)}${MOOD_LABEL[m]}</button>`)}
    </div>
    <label class="field">Note (optional)<textarea id="correct-note" maxlength="500" placeholder="e.g. Calm now — issue fixed yesterday"></textarea></label>
    <div style="display:flex;gap:8px"><button type="button" class="btn btn-primary btn-sm" data-action="save-correction" ${state.pickedMood ? '' : 'disabled'}>Save observation</button><button type="button" class="btn btn-sm" data-action="cancel-correct">Cancel</button></div>
  </div>`;

  return html`<section class="card mood-card" data-mood="${display.mood}" aria-labelledby="mood-h">
    <div class="card-head"><h2 id="mood-h" class="eyebrow">${display.source === 'agent' ? 'Mood · reported by an agent' : 'Mood · estimated'}</h2><span class="sub">Computed ${fmt.rel(estimate.computedAt)}</span></div>
    <div class="mood-main">${moodBadge(display.mood, { qualifier: display.source === 'agent' ? display.sourceLabel : 'Estimated', size: 'lg' })}${display.source === 'estimate' ? confidence(estimate.confidence) : ''}</div>
    ${obs ? html`<div class="observed"><b>${display.sourceLabel} by ${obs.agent}</b> · ${fmt.rel(obs.at)}${obs.note ? html`<span class="quote" dir="auto">${quoted(obs.note)}</span>` : html`<br>`}
      System estimate: <b>${MOOD_LABEL[estimate.mood]}</b>${estimate.mood !== 'unknown' ? html` (${estimate.confidence.label.toLowerCase()} confidence)` : ''}. The agent observation is shown until newer evidence arrives or ${fmt.dateTime(obs.expiresAt)}.</div>` : ''}
    <div class="mood-meta">${unknown ? estimate.unknownReason : html`Based on ${estimate.signalCount} signals from the last ${estimate.evidenceWindowDays} days · latest evidence ${fmt.rel(estimate.lastEvidenceAt)}`}</div>
    ${estimate.mixedSignals || estimate.latestPointsOtherWay ? html`<div class="flags">
      ${estimate.mixedSignals ? html`<span class="chip">${icon.info} Signals are mixed</span>` : ''}
      ${estimate.latestPointsOtherWay ? html`<span class="chip">${icon.info} Latest interaction points the other way</span>` : ''}
    </div>` : ''}
    ${estimate.reasons.length ? html`<h3 class="subhead">${unknown ? 'What little evidence there is' : obs ? `Why the system estimate is ${MOOD_LABEL[estimate.mood]}` : 'Why Mizaj estimates this'}</h3><ul class="reasons">${estimate.reasons.map(reasonItem)}</ul>` : ''}
    ${estimate.counterEvidence?.length ? html`<details class="more"><summary>Points the other way (${estimate.counterEvidence.length})</summary><ul class="reasons">${estimate.counterEvidence.map(reasonItem)}</ul></details>` : ''}

    <div class="feedback-row">
      <span class="label">Does this match what you hear?</span>
      ${unknown ? '' : html`<button type="button" class="btn btn-sm" data-action="confirm-mood">${icon.check} Looks right</button>`}
      <button type="button" class="btn btn-sm" data-action="start-correct" aria-expanded="${state.correcting}">${unknown ? 'Record observed mood' : 'Correct it'}</button>
    </div>
    ${state.correcting ? picker : ''}
    <div class="disclaimer">${icon.info}<span>${estimate.disclaimer} Mizaj never estimates mood from age, gender, nationality or tenure — only from interactions.</span></div>
  </section>`;
}

function sayCard(p) {
  const s = p.suggestions;
  const { workplace } = prefs.get();
  return html`<section class="card" aria-labelledby="say-h">
    <div class="card-head"><h2 id="say-h">Before you say hello</h2><span class="sub">${workplace === 'outlet' ? 'Outlet greeting' : 'Call greeting'} · change in settings</span></div>
    ${greetingBlock(s.greeting, workplace, 'profile')}
    <h3 class="subhead">Tone</h3>
    <div class="tone">${s.tone.style.map((t) => html`<span class="chip">${t}</span>`)}</div>
    <div class="small">${s.tone.guidance}</div>
    ${s.tone.avoid?.length ? html`<div class="avoid"><b>Avoid:</b> ${s.tone.avoid.join(' · ')}</div>` : ''}
    <h3 class="subhead">Next best actions</h3>
    <ol class="actions-list">${s.nextActions.map(actionItem)}</ol>
  </section>`;
}

function alertsCard(p) {
  const { escalation, missedCommitments, frustrationTriggers } = p.alerts;
  const none = !escalation.needed && !missedCommitments.length && !frustrationTriggers.length;
  return html`<section class="card" aria-labelledby="alerts-h">
    <div class="card-head"><h2 id="alerts-h">Alerts</h2></div>
    ${none ? html`<p class="empty">No escalation, missed commitments or frustration triggers.</p>` : ''}
    ${escalationAlert(escalation)}
    ${missedAlert(missedCommitments)}
    ${frustrationTriggers.length ? html`<div class="alert alert-info"><span class="ico">${icon.bolt}</span><div><b>Frustration triggers</b>
      <div class="triggers">${frustrationTriggers.map((t) => html`<span class="chip" title="${t.detail}">${t.label} <span class="muted">· ${t.detail}</span></span>`)}</div></div></div>` : ''}
  </section>`;
}

const ISSUE_STATUS = {
  sla_breached: ['status-bad', 'SLA breached'], overdue: ['status-bad', 'Overdue'], active: ['status-warn', 'Active incident'],
  open: ['status-neutral', 'Open'], pending: ['status-neutral', 'Pending'],
};

function unresolvedCard(p) {
  return html`<section class="card" aria-labelledby="unres-h">
    <div class="card-head"><h2 id="unres-h">Unresolved issues</h2><span class="sub">${p.unresolved.length} open</span></div>
    ${p.unresolved.length ? html`<ul class="list">${p.unresolved.map((u) => {
      const [cls, label] = ISSUE_STATUS[u.status];
      return html`<li class="issue"><span class="t">${u.type === 'ticket' ? `${u.id} · ` : ''}${u.title}</span><span class="status ${cls}">${cls === 'status-bad' ? icon.warn : ''}${label}</span><span class="d">${u.detail}</span></li>`;
    })}</ul>` : html`<p class="empty">Nothing open.</p>`}
  </section>`;
}

function followUpsCard(p) {
  const open = p.followUps.filter((f) => f.status === 'open');
  const done = p.followUps.filter((f) => f.status !== 'open');
  const item = (f) => html`<li class="fu ${f.status === 'done' ? 'done' : ''}">
    <input type="checkbox" data-action="toggle-fu" data-id="${f.id}" ${f.status === 'done' ? 'checked' : ''} aria-label="Mark “${f.title}” as ${f.status === 'done' ? 'open' : 'done'}">
    <div><div class="t">${f.title}</div><div class="d">${f.status === 'done' ? `Done ${fmt.date(f.completedAt)}` : `Due ${fmt.dateTime(f.dueAt)} (${fmt.rel(f.dueAt)})`} · ${f.owner}</div></div>
    ${f.overdue ? html`<span class="status status-bad">${icon.warn}Missed</span>` : f.status === 'open' ? html`<span class="status status-neutral">Open</span>` : html`<span class="status status-ok">${icon.check}Done</span>`}
  </li>`;
  const due = [[2, 'In 2 hours'], [24, 'Tomorrow'], [72, 'In 3 days']];
  return html`<section class="card" aria-labelledby="fu-h">
    <div class="card-head"><h2 id="fu-h">Follow-ups</h2><span class="sub">Promises made to the customer</span></div>
    ${open.length ? html`<ul class="list">${open.map(item)}</ul>` : html`<p class="empty">No open follow-ups.</p>`}
    ${done.length ? html`<details class="more"><summary>Completed (${done.length})</summary><ul class="list" style="margin-top:8px">${done.map(item)}</ul></details>` : ''}
    <form class="fu-form" id="fu-form">
      <label class="sr-only" for="fu-title">New follow-up</label>
      <div class="row"><input id="fu-title" type="text" maxlength="140" placeholder="Promise something? e.g. Call back with ETA" required></div>
      <div class="row">
        <div class="seg" role="group" aria-label="Due">${due.map(([h, l]) => html`<button type="button" data-action="due-pick" data-hours="${h}" aria-pressed="${state.dueHours === h}">${l}</button>`)}</div>
        <button type="submit" class="btn btn-sm btn-primary">Add follow-up</button>
      </div>
    </form>
  </section>`;
}

function servicesCard(p) {
  const c = p.customer;
  return html`<section class="card" aria-labelledby="svc-h">
    <div class="card-head"><h2 id="svc-h">Services & billing</h2><span class="chip chip-sim">Simulated CRM · Billing</span></div>
    <div class="services">${c.services.map((s) => html`<div class="svc"><span>${s.name}</span><span class="status ${s.status === 'active' ? 'status-ok' : 'status-warn'}">${s.status}</span></div>`)}</div>
    ${c.bills.length ? html`<table class="bills"><tbody>${c.bills.slice(0, 3).map((b) => html`<tr><td>${b.period} bill</td><td class="muted">${b.status}</td><td>${fmt.omr(b.amount)}</td></tr>`)}</tbody></table>` : ''}
    <div class="small muted" style="margin-top:8px">Account ${c.accountNo}</div>
  </section>`;
}

function feedbackCard(p) {
  return html`<section class="card" aria-labelledby="fb-h">
    <div class="card-head"><h2 id="fb-h">Survey feedback</h2></div>
    ${p.feedback.length ? html`<ul class="list">${p.feedback.slice(0, 3).map((f) => html`<li><b>${f.type} ${f.score}/${f.type === 'NPS' ? 10 : 5}</b> <span class="muted small">· ${fmt.date(f.at)} · ${f.channel}</span>${f.comment ? html`<span class="quote" dir="auto">${quoted(f.comment)}</span>` : ''}</li>`)}</ul>` : html`<p class="empty">No surveys in the history.</p>`}
  </section>`;
}

const TL_TYPES = [
  ['all', 'All'], ['call', 'Calls'], ['message', 'Messages'], ['ticket', 'Tickets'], ['feedback', 'Feedback'],
  ['visit', 'Visits'], ['followUp', 'Follow-ups'], ['incident', 'Incidents'], ['mood', 'Mood notes'],
];
const TL_ICON = { call: icon.phone, message: icon.message, ticket: icon.ticket, feedback: icon.star, visit: icon.store, followUp: icon.flag, incident: icon.bolt, mood: icon.face };

function tlTone(e) {
  if (e.tone) return e.tone.label;
  if (e.flags?.some((f) => /missed|after SLA|reopened|late|waited/.test(f))) return 'negative';
  if (e.type === 'feedback') return e.score / e.scale >= 0.8 ? 'positive' : e.score / e.scale <= 0.5 ? 'negative' : '';
  return '';
}

function timelineCard(p) {
  const items = p.timeline.filter((e) => state.timelineFilter === 'all' || e.type === state.timelineFilter);
  const counts = Object.fromEntries(TL_TYPES.map(([k]) => [k, k === 'all' ? p.timeline.length : p.timeline.filter((e) => e.type === k).length]));
  return html`<section class="card" aria-labelledby="tl-h" id="timeline">
    <div class="card-head"><h2 id="tl-h">Interaction timeline</h2><span class="sub">${p.timeline.length} events · newest first</span></div>
    <div class="filters" role="group" aria-label="Filter timeline">${TL_TYPES.filter(([k]) => counts[k]).map(([k, l]) => html`<button type="button" data-action="tl-filter" data-type="${k}" aria-pressed="${state.timelineFilter === k}">${l} <span class="muted">${counts[k]}</span></button>`)}</div>
    <ol class="timeline">${items.map((e) => html`<li class="tl" data-tone="${tlTone(e)}">
      <span class="ico">${TL_ICON[e.type] || icon.info}</span>
      <div>
        <div class="head"><span class="title">${e.title}</span><span class="when" title="${fmt.dateTime(e.at)}">${fmt.dateTime(e.at)} · ${fmt.rel(e.at)}</span></div>
        ${e.detail ? html`<div class="detail">${e.detail}</div>` : ''}
        ${e.text ? html`<span class="quote" dir="auto">${e.type === 'message' || e.type === 'feedback' ? quoted(e.text) : e.text}</span>` : ''}
        ${e.tone || e.flags?.length ? html`<div class="meta">
          ${e.tone ? html`<span class="chip" title="Keyword-based estimate of tone">Est. tone: ${e.tone.label}</span>` : ''}
          ${(e.flags || []).map((f) => html`<span class="chip">${f}</span>`)}
        </div>` : ''}
      </div>
    </li>`)}</ol>
  </section>`;
}

// ------------------------------------------------------------------ Dashboard

async function viewDashboard() {
  setNav('dashboard');
  pageTitle('Dashboard');
  if (!state.dashboard) loading('dashboard');
  else view.querySelectorAll('.card, .kpis').forEach((el) => { el.style.opacity = '0.55'; });
  state.dashboard = await api(`/dashboard?days=${state.dashDays}`);
  renderDashboard();
}

function renderDashboard() {
  const d = state.dashboard;
  const k = d.kpis;
  const diff = Math.round((k.negativeShare - k.negativeShareAtStart) * 10) / 10;
  const escTotal = k.escalations.urgent + k.escalations.recommended;
  const tableBtn = (key) => html`<button type="button" class="btn btn-sm" data-action="toggle-table" data-key="${key}" aria-pressed="${Boolean(state.tables[key])}">${state.tables[key] ? 'Show chart' : 'Show table'}</button>`;

  render(view, html`
    <div class="toolbar">
      <h1>Dashboard</h1>
      <span class="small muted">Mood figures are estimates · ${k.customers} demo customers</span>
      <div class="seg" role="group" aria-label="Date range">${d.range.options.map((n) => html`<button type="button" data-action="dash-range" data-days="${n}" aria-pressed="${d.range.days === n}">Last ${n} days</button>`)}</div>
    </div>

    <div class="kpis">
      <div class="kpi"><span class="label">Frustrated or upset (estimated)</span><span class="value">${k.negativeShare}%</span>
        <span class="delta ${diff > 0 ? 'bad' : diff < 0 ? 'good' : ''}">${diff > 0 ? icon.up : diff < 0 ? icon.down : ''}${diff > 0 ? '+' : ''}${diff} pts vs ${fmt.date(d.range.from)}</span></div>
      <div class="kpi"><span class="label">Escalations to review</span><span class="value">${escTotal}</span><span class="delta">${k.escalations.urgent} urgent · ${k.escalations.recommended} recommended</span></div>
      <div class="kpi"><span class="label">Missed commitments</span><span class="value">${k.missedCommitments.count}</span><span class="delta">across ${k.missedCommitments.customers} customers</span></div>
      <div class="kpi"><span class="label">Not enough evidence</span><span class="value">${k.unknownShare}%</span><span class="delta">shown as “Unknown”, never guessed</span></div>
      <div class="kpi"><span class="label">Agents agreed with the estimate</span><span class="value">${k.agentFeedback.agreementRate === null ? '—' : `${k.agentFeedback.agreementRate}%`}</span><span class="delta">${k.agentFeedback.total} agent reviews in range</span></div>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><div><h2>Estimated mood mix by week</h2><div class="sub">Share of customers with an estimate; “Unknown” is left out of the bars.</div></div>${tableBtn('mix')}</div>
        <div id="mix" class="chart">${state.tables.mix ? moodMixTable(d.trend) : ''}</div>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Recurring issues</h2><div class="sub">Contacts in the last ${d.range.days} days · change vs the ${d.range.days} days before</div></div>${tableBtn('issues')}</div>
        <div id="issues" class="chart">${state.tables.issues ? html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Issue</th><th class="num">Contacts</th><th class="num">Previous</th><th class="num">Customers</th><th class="num">Repeat customers</th></tr></thead>
          <tbody>${d.recurringIssues.map((r) => html`<tr><td>${r.label}</td><td class="num">${r.contacts}</td><td class="num">${r.previous}</td><td class="num">${r.customers}</td><td class="num">${r.repeatCustomers}</td></tr>`)}</tbody></table></div>` : ''}</div>
      </section>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <section class="card">
        <div class="card-head"><div><h2>Needs escalation</h2><div class="sub">Rule-based flags · urgent first</div></div></div>
        ${d.escalations.length ? html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Customer</th><th>Mood</th><th>Why</th><th>Route to</th></tr></thead><tbody>
          ${d.escalations.slice(0, 10).map((e) => html`<tr>
            <td><a href="#customer-${e.customer.id}">${e.customer.name}</a><div class="small muted tabular">${fmt.phone(e.customer.phone)}</div></td>
            <td>${moodBadge(e.mood.mood, { qualifier: e.mood.source === 'agent' ? 'Agent' : 'Est.' })}</td>
            <td><span class="chip chip-${e.level}">${e.level === 'urgent' ? icon.stop : icon.warn}${e.level}</span><div class="small">${e.reason}${e.reasonCount > 1 ? html` <span class="muted">(+${e.reasonCount - 1})</span>` : ''}</div></td>
            <td class="small">${e.route}</td></tr>`)}
        </tbody></table></div>` : html`<p class="empty">No customers flagged.</p>`}
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Where frustration is concentrated</h2><div class="sub">Share of customers with an estimate who are estimated frustrated or upset</div></div>${tableBtn('regions')}</div>
        <div id="regions" class="chart">${state.tables.regions ? html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Region</th><th class="num">With estimate</th><th class="num">Frustrated or upset</th><th class="num">Share</th></tr></thead>
          <tbody>${d.regions.map((r) => html`<tr><td>${r.region}</td><td class="num">${r.known}</td><td class="num">${r.negative}</td><td class="num">${r.share}%</td></tr>`)}</tbody></table></div>` : ''}</div>
      </section>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <section class="card">
        <div class="card-head"><div><h2>Missed commitments</h2><div class="sub">Follow-ups past their due date</div></div></div>
        ${d.overdueFollowUps.length ? html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Customer</th><th>Promise</th><th class="num">Overdue</th></tr></thead><tbody>
          ${d.overdueFollowUps.slice(0, 10).map((f) => html`<tr><td><a href="#customer-${f.customer.id}">${f.customer.name}</a></td><td>${f.title}<div class="small muted">${f.owner}</div></td><td class="num nowrap">${f.overdueBy}</td></tr>`)}
        </tbody></table></div>` : html`<p class="empty">No missed commitments.</p>`}
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Agent feedback on estimates</h2><div class="sub">Confirmations and corrections help tune the rules</div></div></div>
        ${d.corrections.recent.length ? html`
          ${d.corrections.commonChanges.length ? html`<p class="small">Most common correction: <b>${MOOD_LABEL[d.corrections.commonChanges[0].from]} → ${MOOD_LABEL[d.corrections.commonChanges[0].to]}</b> (${d.corrections.commonChanges[0].count}×)</p>` : ''}
          <ul class="list">${d.corrections.recent.map((c) => html`<li class="small"><a href="#customer-${c.customerId}">${c.customerName}</a> — ${c.verdict === 'confirmed' ? html`confirmed <b>${MOOD_LABEL[c.mood]}</b>` : html`estimate <b>${MOOD_LABEL[c.estimateAtTime?.mood] || '—'}</b> corrected to <b>${MOOD_LABEL[c.mood]}</b>`} · ${c.agent} · ${fmt.rel(c.at)}</li>`)}</ul>`
          : html`<p class="empty">No agent feedback in this range yet.</p>`}
      </section>
    </div>`);

  if (!state.tables.mix) moodMixChart(document.getElementById('mix'), d.trend);
  if (!state.tables.issues) {
    barList(document.getElementById('issues'), d.recurringIssues.slice(0, 8).map((r) => ({
      label: r.label, value: r.contacts, ...deltaNote(r.change),
      tip: [{ value: String(r.contacts), label: 'contacts' }, { value: String(r.previous), label: 'previous period' }, { value: String(r.customers), label: 'customers' }, { value: String(r.repeatCustomers), label: 'contacted 2+ times' }],
    })), { fill: 'accent', ariaLabel: 'Recurring issues by contacts' });
  }
  if (!state.tables.regions) {
    barList(document.getElementById('regions'), d.regions.map((r) => ({
      label: r.region, value: r.share, valueText: `${Math.round(r.share)}%`, note: `n=${r.known}`,
      tip: [{ value: `${r.share}%`, label: 'frustrated or upset' }, { value: `${r.negative} of ${r.known}`, label: 'customers with an estimate' }],
    })), { fill: 'frustrated', ariaLabel: 'Share frustrated or upset by region' });
  }
}

// ------------------------------------------------------------------ Integrations

async function viewIntegrations() {
  setNav('integrations');
  pageTitle('Integrations');
  loading('integrations');
  const [i, calls] = await Promise.all([api('/integrations'), api('/calls/recent')]);
  const hosted = runtime.mode === 'hosted';
  const origin = hosted ? 'http://localhost:3000' : location.origin;
  const chip = (mode) => ({ live: ['chip-live', 'LIVE'], ready: ['chip-ready', 'READY'], offline: ['chip-ready', 'NOT RUNNING'] }[mode]);
  render(view, html`
    <div class="toolbar"><h1>Integrations</h1><span class="small muted">What is simulated, and what is live</span><button type="button" class="btn btn-sm" data-action="reset-demo">Reset demo data</button></div>
    <div class="alert alert-info" style="margin-bottom:16px"><span class="ico">${icon.info}</span><div>
      <b>${i.summary.simulated} customer data sources are simulated · ${i.summary.live} live.</b>
      <div class="small">Every customer, ticket, message and survey in this build comes from a demo generator — no real Omantel system is connected. ${hosted
        ? 'This hosted demo runs entirely in your browser, so the channels below are not running here. Start the server (npm start) and they become real endpoints other systems can call.'
        : 'The channels below are real endpoints that other systems can call today.'}</div>
    </div></div>

    <section class="card">
      <div class="card-head"><h2>Channels</h2></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Channel</th><th>Status</th><th>Endpoint</th><th>Security</th></tr></thead><tbody>
        ${i.channels.map((ch) => html`<tr>
          <td><b>${ch.name}</b>${ch.key === 'cti' ? html`<div class="small muted">${ch.liveEvents} live · ${ch.simulatedEvents} simulated events since start${ch.lastLiveEventAt ? ` · last live ${fmt.rel(ch.lastLiveEventAt)}` : ''}</div>` : ''}</td>
          <td><span class="chip ${chip(ch.mode)[0]}">${chip(ch.mode)[1]}</span>${ch.status !== 'Live' ? html`<div class="small muted">${ch.status}</div>` : ''}</td>
          <td><code>${ch.endpoint}</code></td><td class="small">${ch.security}</td></tr>`)}
      </tbody></table></div>
    </section>

    <section class="card">
      <div class="card-head"><h2>Customer data sources</h2></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Source</th><th>Provides</th><th>Connection</th><th>Last refresh</th></tr></thead><tbody>
        ${i.dataSources.map((s) => html`<tr><td><b>${s.name}</b></td><td class="small">${s.provides}</td><td><span class="chip chip-sim">SIMULATED</span></td><td class="small nowrap">${fmt.dateTime(s.lastSync)}</td></tr>`)}
      </tbody></table></div>
      <p class="small muted">To connect a real system, replace the demo adapter in <code>src/data/</code> with one that maps that system’s records to the same shapes. The mood engine does not change.</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>Recent call events</h2><button type="button" class="btn btn-sm" data-action="simulate-call">Simulate call</button></div>
      ${calls.calls.length ? html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Time</th><th>Origin</th><th>Number</th><th>Customer</th><th>Mood shown</th></tr></thead><tbody>
        ${calls.calls.map((c) => html`<tr><td class="tabular">${fmt.time(c.receivedAt)}</td><td><span class="chip ${c.mode === 'live' ? 'chip-live' : 'chip-sim'}">${c.mode === 'live' ? 'LIVE' : 'SIMULATED'}</span><div class="small muted">${c.source}</div></td>
          <td class="tabular">${fmt.phone(c.phone)}</td><td>${c.customerId ? html`<a href="#customer-${c.customerId}">${c.customerName}</a>` : 'No record'}</td><td>${moodBadge(c.mood.mood, { qualifier: c.mood.source === 'agent' ? 'Agent' : 'Est.' })}</td></tr>`)}
      </tbody></table></div>` : html`<p class="empty">No calls yet. Use “Simulate call”${hosted ? '. With the server running, a phone system sends live events like this:' : ', or send a live event:'}</p>`}
      <pre class="small" style="overflow-x:auto;background:var(--surface-2);padding:10px;border-radius:8px"><code>curl -X POST ${origin}/api/v1/calls/incoming \\
  -H 'Content-Type: application/json' \\
  -d '{"phone":"+968 9000 1001","callId":"CTI-123","agentId":"CC-214"}'</code></pre>
    </section>`);
}

// ------------------------------------------------------------------ Incoming calls

function showCall({ call, brief }) {
  if (state.shownCalls.has(call.id)) return;
  state.shownCalls.add(call.id);
  const popupHost = document.getElementById('popup-host');
  if (popupHost && parseRoute().name === 'popup') {
    state.popupCall = call;
    render(popupHost, briefCard(brief, { call, workplace: prefs.get().workplace }));
    return;
  }
  const wrap = document.createElement('div');
  wrap.dataset.brief = JSON.stringify({ customerId: brief.customer?.id || null });
  render(wrap, briefCard(brief, { call, workplace: prefs.get().workplace, closable: true }));
  dock.prepend(wrap);
  while (dock.children.length > 2) dock.lastElementChild.remove();
}

async function simulateCall(phone) {
  try {
    const res = await api('/demo/simulate-call', { method: 'POST', body: phone ? { phone } : {} });
    // If the live event stream is unavailable (e.g. a proxy buffers it), show the response directly.
    setTimeout(() => showCall(res), 1200);
  } catch (err) {
    toast(err.message);
  }
}

function openPopupWindow() {
  const w = runtime.mode === 'hosted' ? null : window.open('/popup', 'mizaj-popup', 'popup=yes,width=440,height=760');
  if (!w) location.hash = 'popup';
}

// ------------------------------------------------------------------ Call popup (in-app view)

function popupWaiting() {
  return html`<div class="card waiting">
    <p style="margin:0 0 6px"><span class="dot" aria-hidden="true"></span><b>Waiting for the next call…</b></p>
    <p class="small muted" style="margin:0 0 14px">The caller’s mood brief appears here as soon as the call arrives.</p>
    <button type="button" class="btn btn-primary" data-action="simulate-call">Simulate a call</button>
  </div>`;
}

function viewPopup() {
  setNav('popup');
  pageTitle('Call popup');
  state.popupCall = null;
  render(view, html`<div class="popup-preview">
    <div>
      <h1 class="popup-title">Call popup</h1>
      <p class="small muted" style="margin:4px 0 0;max-width:62ch">What an agent sees while the phone rings: a short brief on the caller.
        ${runtime.mode === 'hosted'
          ? 'In production the phone system opens it as a small window (/popup?phone=…), or the agent keeps it open beside the softphone.'
          : html`Open it as its own window at <a href="/popup" target="mizaj-popup">/popup</a>, or let the phone system open /popup?phone=….`}</p>
    </div>
    <div class="popup-device">
      <div class="popup-top">
        <span class="brand"><svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--accent)"/><circle cx="11.5" cy="13" r="1.9" fill="var(--accent-ink)"/><circle cx="20.5" cy="13" r="1.9" fill="var(--accent-ink)"/><path d="M9.5 19.5c1.7 2.3 4 3.5 6.5 3.5s4.8-1.2 6.5-3.5" fill="none" stroke="var(--accent-ink)" stroke-width="2.4" stroke-linecap="round"/></svg><span class="brand-name">Mizaj<span class="ar" lang="ar">مزاج</span></span></span>
        <span class="chip chip-demo">DEMO</span>
      </div>
      <div class="popup-wrap">
        <div id="popup-host">${popupWaiting()}</div>
        <form class="popup-lookup" id="popup-lookup" autocomplete="off">
          <label class="sr-only" for="popup-phone">Look up a number</label>
          <input id="popup-phone" type="search" inputmode="tel" placeholder="Look up a number, e.g. 9000 1006">
          <button type="submit" class="btn">Look up</button>
        </form>
      </div>
    </div>
  </div>`);
}

// ------------------------------------------------------------------ API docs (hosted demo)

function viewApi() {
  setNav('api');
  pageTitle('API');
  const tpl = document.getElementById('mizaj-docs');
  if (!tpl) {
    render(view, html`<div class="card"><h2>API documentation</h2><p><a href="/docs">Open the API docs</a></p></div>`);
    return;
  }
  render(view, html`<div class="alert alert-info"><span class="ico">${icon.info}</span><div><b>The API runs when you start the server.</b>
    <div class="small">This hosted demo runs in your browser, so these endpoints are not live here. Run <code>npm start</code> and they are served at http://localhost:3000.</div></div></div>`);
  view.appendChild(tpl.content.cloneNode(true));
}

// ------------------------------------------------------------------ Actions

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (handleGreetingAction(el)) return;
  const p = state.profile;

  if (a === 'simulate-call') simulateCall(el.dataset.phone);
  else if (a === 'open-popup') openPopupWindow();
  else if (a === 'dismiss-call') el.closest('.call-dock > div')?.remove();
  else if (a === 'open-profile') {
    e.preventDefault();
    el.closest('.call-dock > div')?.remove();
    location.hash = `customer-${el.dataset.id}`;
  } else if (a === 'reset-demo') {
    try {
      await api('/demo/reset', { method: 'POST' });
      state.profile = null;
      state.dashboard = null;
      toast('Demo data reset');
      route();
    } catch (err) { toast(err.message); }
  }
  else if (a === 'quick-correct') {
    const id = el.closest('[data-customer]').dataset.customer;
    try {
      await quickCorrect(id, el.dataset.mood);
      toast(`Recorded: ${MOOD_LABEL[el.dataset.mood]} (agent-reported)`);
      el.closest('.mini-correct').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
      if (p?.customer.id === id) refreshProfile();
      const popupHost = document.getElementById('popup-host');
      if (popupHost && popupHost.contains(el)) {
        render(popupHost, briefCard(await api(`/customers/${encodeURIComponent(id)}/brief`), { call: state.popupCall, workplace: prefs.get().workplace }));
      }
    } catch (err) { toast(err.message); }
  } else if (a === 'confirm-mood' && p) {
    try {
      await api(`/customers/${p.customer.id}/mood-feedback`, { method: 'POST', body: { verdict: 'confirmed', agent: prefs.get().agent || 'Agent' } });
      toast('Thanks — estimate confirmed');
      refreshProfile();
    } catch (err) { toast(err.message); }
  } else if (a === 'start-correct') {
    state.correcting = !state.correcting;
    state.pickedMood = null;
    renderProfile();
    document.getElementById('correct-panel')?.querySelector('button')?.focus();
  } else if (a === 'cancel-correct') {
    state.correcting = false;
    renderProfile();
  } else if (a === 'pick-mood') {
    state.pickedMood = el.dataset.mood;
    const panel = el.closest('.correct-panel');
    panel.querySelectorAll('[data-action="pick-mood"]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    panel.querySelector('[data-action="save-correction"]').disabled = false;
  } else if (a === 'save-correction' && p && state.pickedMood) {
    const note = document.getElementById('correct-note')?.value || '';
    try {
      await api(`/customers/${p.customer.id}/mood-feedback`, { method: 'POST', body: { verdict: 'corrected', mood: state.pickedMood, note, agent: prefs.get().agent || 'Agent' } });
      state.correcting = false;
      toast('Observation saved');
      refreshProfile();
    } catch (err) { toast(err.message); }
  } else if (a === 'toggle-fu') {
    try {
      await api(`/follow-ups/${encodeURIComponent(el.dataset.id)}`, { method: 'PATCH', body: { status: el.checked ? 'done' : 'open' } });
      toast(el.checked ? 'Follow-up marked done' : 'Follow-up reopened');
      refreshProfile();
    } catch (err) { toast(err.message); el.checked = !el.checked; }
  } else if (a === 'due-pick') {
    state.dueHours = Number(el.dataset.hours);
    el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
  } else if (a === 'tl-filter' && p) {
    state.timelineFilter = el.dataset.type;
    const card = document.getElementById('timeline');
    const tmp = document.createElement('div');
    render(tmp, timelineCard(p));
    card.replaceWith(tmp.firstElementChild);
  } else if (a === 'dash-range') {
    state.dashDays = Number(el.dataset.days);
    viewDashboard();
  } else if (a === 'toggle-table') {
    state.tables[el.dataset.key] = !state.tables[el.dataset.key];
    renderDashboard();
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'popup-lookup') {
    e.preventDefault();
    const number = document.getElementById('popup-phone').value.trim();
    if (!number) return;
    try {
      state.popupCall = null;
      render(document.getElementById('popup-host'), briefCard(await api(`/lookup?phone=${encodeURIComponent(number)}`), { workplace: prefs.get().workplace }));
    } catch (err) { toast(err.message); }
    return;
  }
  if (e.target.id !== 'fu-form' || !state.profile) return;
  e.preventDefault();
  const title = document.getElementById('fu-title').value.trim();
  if (!title) return;
  try {
    await api(`/customers/${state.profile.customer.id}/follow-ups`, {
      method: 'POST',
      body: { title, dueAt: new Date(Date.now() + state.dueHours * 3600000).toISOString(), owner: prefs.get().agent || 'Agent' },
    });
    toast('Follow-up added');
    refreshProfile();
  } catch (err) { toast(err.message); }
});

// Keyboard: "/" jumps to search from anywhere.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || /input|textarea|select/i.test(document.activeElement?.tagName)) return;
  e.preventDefault();
  (document.getElementById('q') || quick.querySelector('input')).focus();
});

// ------------------------------------------------------------------ Settings & start

function initSettings() {
  const p = prefs.get();
  const agent = document.getElementById('pref-agent');
  const workplace = document.getElementById('pref-workplace');
  const label = document.getElementById('agent-label');
  agent.value = p.agent;
  workplace.value = p.workplace;
  label.textContent = p.agent || 'Agent';
  agent.addEventListener('change', () => { prefs.set({ agent: agent.value.trim() }); label.textContent = agent.value.trim() || 'Agent'; });
  workplace.addEventListener('change', () => {
    prefs.set({ workplace: workplace.value });
    if (parseRoute().name === 'customer' && state.profile) renderProfile();
  });
}

export function start() {
  if (runtime.mode === 'hosted') document.querySelectorAll('[data-action="open-popup"]').forEach((b) => { b.hidden = true; });
  initSettings();
  wireSearch(quick);
  subscribeCalls(showCall);
  window.addEventListener('hashchange', route);
  route();
}
