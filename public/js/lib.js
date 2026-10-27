// Shared helpers and components for the web app and the call popup.
// All dynamic text goes through html`` which escapes interpolated values.

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const raw = (s) => new Safe(String(s));

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? part(vals[i]) : ''); });
  return new Safe(out);
}

export function render(el, content) {
  el.innerHTML = part(content);
}

// ---------------------------------------------------------------- API
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------- Prefs
const PREF_KEY = 'mizaj.prefs';
export const prefs = {
  get() {
    try { return { workplace: 'call', agent: '', ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return { workplace: 'call', agent: '' }; }
  },
  set(patch) {
    const next = { ...this.get(), ...patch };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep defaults */ }
    return next;
  },
};

// ---------------------------------------------------------------- Formatting
const TZ = 'Asia/Muscat';
const dfDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });
const dfDateTime = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
const dfTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });

function span(ms) {
  const a = Math.abs(ms);
  const m = Math.round(a / 60000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = Math.round(a / 3600000);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(a / 86400000);
  return `${d} day${d === 1 ? '' : 's'}`;
}

export const fmt = {
  rel(iso) {
    if (!iso) return '—';
    const diff = Date.parse(iso) - Date.now();
    if (Math.abs(diff) < 60000) return 'just now';
    return diff < 0 ? `${span(diff)} ago` : `in ${span(diff)}`;
  },
  date: (iso) => (iso ? dfDate.format(new Date(iso)) : '—'),
  dateTime: (iso) => (iso ? dfDateTime.format(new Date(iso)) : '—'),
  time: (iso) => (iso ? dfTime.format(new Date(iso)) : '—'),
  phone(p) {
    const m = /^\+968(\d{4})(\d{4})$/.exec(p || '');
    return m ? `+968 ${m[1]} ${m[2]}` : p || '';
  },
  omr: (n) => `${Number(n).toFixed(3)} OMR`,
  lang: (l) => (l === 'ar' ? 'Prefers Arabic' : 'Prefers English'),
};

// ---------------------------------------------------------------- Icons
const svg = (body, extra = '') => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`);
export const icon = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  warn: svg('<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  stop: svg('<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M12 8v5M12 16h.01"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  message: svg('<path d="M4 5h16v11H8l-4 4z"/>'),
  ticket: svg('<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10"/>'),
  star: svg('<path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.2 9.4l6.1-.8z"/>'),
  store: svg('<path d="M4 9h16l-1-5H5zM5 9v11h14V9M9 20v-6h6v6"/>'),
  flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
  bolt: svg('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  face: svg('<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M9 15h6"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  external: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  popup: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M13 9h5v6h-5z"/>'),
  agent: svg('<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19a4 4 0 0 1-4 3h-2"/>'),
};

const FACE = {
  positive: '<path d="M8 14c1 1.4 2.4 2.1 4 2.1s3-.7 4-2.1"/>',
  neutral: '<path d="M8.5 15h7"/>',
  frustrated: '<path d="M8.5 16.2c.9-.9 2.1-1.3 3.5-1.3s2.6.4 3.5 1.3"/>',
  upset: '<path d="M8 17c1-1.5 2.4-2.2 4-2.2s3 .7 4 2.2"/><path d="M7.5 8.3 10 9.5M16.5 8.3 14 9.5"/>',
};

export function moodIcon(mood) {
  if (mood === 'unknown' || !FACE[mood]) {
    return svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17h.01"/>');
  }
  return svg(`<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10.2" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="10.2" r="1" fill="currentColor" stroke="none"/>${FACE[mood]}`);
}

export const MOOD_LABEL = { positive: 'Positive', neutral: 'Neutral', frustrated: 'Frustrated', upset: 'Upset', unknown: 'Unknown' };

/** Mood pill. `qualifier` (e.g. "Estimated") is part of the label so it is never read as a fact. */
export function moodBadge(mood, { qualifier = '', size = '' } = {}) {
  return html`<span class="mood mood-${mood} ${size === 'lg' ? 'mood-lg' : ''}">${moodIcon(mood)}${qualifier ? html`<span class="qual">${qualifier}:</span> ` : ''}${MOOD_LABEL[mood] || mood}</span>`;
}

export function confidence(conf) {
  if (!conf || conf.level === 'none') return html`<span class="conf">${icon.info} Not enough evidence</span>`;
  const n = { low: 1, medium: 2, high: 3 }[conf.level] || 0;
  return html`<span class="conf" title="Confidence ${Math.round(conf.value * 100)}%"><span class="conf-bars" aria-hidden="true"><i class="${n >= 1 ? 'on' : ''}"></i><i class="${n >= 2 ? 'on' : ''}"></i><i class="${n >= 3 ? 'on' : ''}"></i></span>${conf.label} confidence</span>`;
}

export function demoChip() {
  return html`<span class="chip chip-demo" title="Fictional demo customer — not a real Omantel record">DEMO DATA</span>`;
}

const ARABIC = /[\u0600-\u06FF]/;
/** Curly quotes for left-to-right text; Arabic is shown as a plain quote block (the border marks it). */
export const quoted = (text) => (ARABIC.test(text) ? text : `“${text}”`);

export function reasonItem(r) {
  return html`<li class="reason">
    <span class="dir ${r.direction}" title="${r.direction === 'negative' ? 'Points towards frustration' : 'Points towards a positive mood'}">${r.direction === 'negative' ? icon.down : icon.up}</span>
    <span>${r.text} <span class="when">· ${r.ongoing ? 'ongoing' : fmt.rel(r.at)}</span>
      ${r.quote ? html`<span class="quote" dir="auto">${quoted(r.quote)}</span>` : ''}
      ${r.cues?.length ? html`<span class="small muted">Picked up: ${r.cues.slice(0, 4).map((c, i) => html`${i ? ', ' : ''}<span class="cue" dir="auto">${c}</span>`)}</span>` : ''}
    </span>
  </li>`;
}

/** "Agent-reported: Neutral" when an agent observation is active, otherwise "Estimated: …". */
export function moodHeadline(display, estimate, size) {
  return html`${moodBadge(display.mood, { qualifier: display.source === 'agent' ? display.sourceLabel : 'Estimated', size })}
    ${display.source === 'agent' ? '' : confidence(estimate.confidence)}`;
}

export const PRIORITY_ICON = { urgent: icon.stop, high: icon.warn, normal: icon.check };

export function actionItem(a) {
  return html`<li><span class="prio prio-${a.priority}">${PRIORITY_ICON[a.priority]}${a.priority === 'normal' ? 'Next' : a.priority}</span><span>${a.text}</span></li>`;
}

export function greetingBlock(greeting, workplace, idPrefix) {
  const set = greeting[workplace === 'outlet' ? 'outlet' : 'call'];
  const first = greeting.language === 'ar' ? 'ar' : 'en';
  const other = first === 'ar' ? 'en' : 'ar';
  const label = { ar: 'العربية', en: 'English' };
  return html`<div class="greeting" data-greeting="${idPrefix}">
    <div class="say-tools">
      <div class="seg" role="group" aria-label="Greeting language">
        <button type="button" data-action="greet-lang" data-lang="${first}" aria-pressed="true">${label[first]}${first === greeting.language ? ' (preferred)' : ''}</button>
        <button type="button" data-action="greet-lang" data-lang="${other}" aria-pressed="false">${label[other]}</button>
      </div>
      <button type="button" class="btn btn-sm btn-ghost" data-action="copy-greeting">${icon.copy} Copy</button>
    </div>
    <p class="say" data-lang="ar" dir="rtl" lang="ar" ${first === 'ar' ? '' : 'hidden'}>${set.ar}</p>
    <p class="say" data-lang="en" dir="ltr" lang="en" ${first === 'en' ? '' : 'hidden'}>${set.en}</p>
  </div>`;
}

/** Handles language toggles and copy buttons inside any greeting block. */
export function handleGreetingAction(target) {
  const block = target.closest('.greeting');
  if (!block) return false;
  if (target.dataset.action === 'greet-lang') {
    const lang = target.dataset.lang;
    block.querySelectorAll('[data-action="greet-lang"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    block.querySelectorAll('.say').forEach((p) => { p.hidden = p.dataset.lang !== lang; });
    return true;
  }
  if (target.dataset.action === 'copy-greeting') {
    const p = [...block.querySelectorAll('.say')].find((x) => !x.hidden);
    copyText(p?.textContent || '');
    return true;
  }
  return false;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); toast('Copied'); } catch { toast('Copy not available'); }
    t.remove();
  }
}

export function toast(message) {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

export function escalationAlert(esc, { compact = false } = {}) {
  if (!esc?.needed) return '';
  const urgent = esc.level === 'urgent';
  return html`<div class="alert alert-${esc.level}" role="${urgent ? 'alert' : 'note'}">
    <span class="ico">${urgent ? icon.stop : icon.warn}</span>
    <div>
      <b>${urgent ? 'Escalation needed' : 'Escalation recommended'} → ${esc.route}</b>
      ${compact
        ? html`<div class="route">${esc.reasons[0].text}${esc.reasons.length > 1 ? ` (+${esc.reasons.length - 1} more)` : ''}</div>`
        : html`<ul>${esc.reasons.map((r) => html`<li>${r.text}${r.route !== esc.route ? html` <span class="muted">→ ${r.route}</span>` : ''}</li>`)}</ul>`}
    </div>
  </div>`;
}

export function missedAlert(missed, { compact = false } = {}) {
  if (!missed?.length) return '';
  return html`<div class="alert alert-recommended">
    <span class="ico">${icon.flag}</span>
    <div>
      <b>${missed.length} missed commitment${missed.length === 1 ? '' : 's'}</b>
      ${compact
        ? html`<div class="route">${missed[0].title} — ${missed[0].overdueBy} overdue</div>`
        : html`<ul>${missed.map((m) => html`<li>${m.title} — due ${fmt.date(m.dueAt)}, <b style="display:inline">${m.overdueBy} overdue</b> · ${m.owner}</li>`)}</ul>`}
    </div>
  </div>`;
}

/**
 * The compact mood brief used by the call popup and the in-app incoming-call panel.
 * `call` (optional) is the CTI event that triggered it.
 */
export function briefCard(brief, { call = null, workplace = 'call', closable = false, profileTarget = '' } = {}) {
  const c = brief.customer;
  const { display, estimate, agentObservation } = brief.mood;
  const modeLabel = call ? (call.mode === 'live' ? 'Live CTI call' : 'Simulated call') : null;
  return html`<section class="call-panel" ${call ? html`data-call-id="${call.id}"` : ''} aria-label="Customer mood brief">
    ${call ? html`<div class="brief-call">
      <span><span class="pulse" aria-hidden="true"></span>Incoming call · ${modeLabel}</span>
      <span class="nowrap">${fmt.time(call.receivedAt)}${closable ? html` <button type="button" class="btn btn-sm btn-ghost" style="color:inherit;min-height:24px;padding:0 4px" data-action="dismiss-call" aria-label="Dismiss">${icon.close}</button>` : ''}</span>
    </div>` : ''}
    <div class="brief">
      <div class="brief-who">
        <div>
          <b>${c ? c.name : fmt.phone(brief.phone)}</b>
          <span class="sub">${c ? html`${fmt.phone(c.phone)} · ${c.segment} · ${fmt.lang(c.language)}` : 'No customer record for this number'}</span>
        </div>
        ${c?.demo ? demoChip() : ''}
      </div>

      <div class="brief-mood">
        <span class="eyebrow">${display.source === 'agent' ? 'Mood reported by an agent' : 'Estimated mood'}</span>
        <div class="row">${moodHeadline(display, estimate)}</div>
        ${agentObservation ? html`<div class="mood-meta">${agentObservation.agent} · ${fmt.rel(agentObservation.at)} · system estimate: ${MOOD_LABEL[estimate.mood]}</div>`
          : html`<div class="mood-meta">${estimate.lastEvidenceAt ? html`Latest evidence ${fmt.rel(estimate.lastEvidenceAt)} · ${estimate.signalCount} signals` : 'No recent evidence'}</div>`}
        ${estimate.unknownReason ? html`<div class="mood-meta">${estimate.unknownReason}</div>` : ''}
        ${!agentObservation && estimate.reasons?.length && estimate.mood !== 'unknown' ? html`<ul class="reasons">${estimate.reasons.slice(0, 3).map((r) => reasonItem({ ...r, cues: null }))}</ul>` : ''}
      </div>

      ${escalationAlert(brief.alerts.escalation, { compact: true })}
      ${missedAlert(brief.alerts.missedCommitments, { compact: true })}

      <div class="brief-sec"><span class="eyebrow">Say</span>${greetingBlock(brief.greeting, workplace, 'brief')}</div>
      <div class="brief-sec"><span class="eyebrow">Tone</span>
        <div class="tone">${brief.tone.style.map((s) => html`<span class="chip">${s}</span>`)}</div>
        <div class="small muted">${brief.tone.guidance}</div>
      </div>
      <div class="brief-sec"><span class="eyebrow">Do next</span><ol class="actions-list">${brief.nextActions.slice(0, 2).map(actionItem)}</ol></div>

      ${c ? html`<div class="brief-actions">
        <a class="btn btn-primary" href="${brief.links.profile}" ${profileTarget ? html`target="${profileTarget}"` : ''} data-action="open-profile" data-id="${c.id}">Open full profile ${icon.external}</a>
      </div>
      <div class="mini-correct" data-customer="${c.id}">
        <span>Mood not right? Tap what you hear:</span>
        ${['positive', 'neutral', 'frustrated', 'upset'].map((m) => html`<button type="button" class="mood mood-${m}" data-action="quick-correct" data-mood="${m}" aria-label="Record mood as ${MOOD_LABEL[m]}">${moodIcon(m)}${MOOD_LABEL[m]}</button>`)}
      </div>` : ''}

      <div class="disclaimer" style="margin-top:0">${icon.info}<span>${estimate.disclaimer}</span></div>
    </div>
  </section>`;
}

export async function quickCorrect(customerId, mood) {
  const { agent } = prefs.get();
  return api(`/customers/${encodeURIComponent(customerId)}/mood-feedback`, { method: 'POST', body: { verdict: 'corrected', mood, agent: agent || 'Agent', note: 'Recorded from call brief' } });
}

/** Subscribes to incoming-call events. Returns the EventSource. */
export function subscribeCalls(onCall, { onStatus } = {}) {
  const es = new EventSource('/api/v1/events');
  es.addEventListener('incoming-call', (e) => {
    try { onCall(JSON.parse(e.data)); } catch { /* ignore malformed event */ }
  });
  es.addEventListener('hello', () => onStatus?.('connected'));
  es.onerror = () => onStatus?.('reconnecting');
  return es;
}
