// Call popup: a small window (or iframe) that shows the mood brief for the caller.
//   /popup                     → waits for incoming-call events (keep it open beside the softphone)
//   /popup?phone=90001001      → screen-pop for one number (CTI / softphone can open this URL)
//   /popup?phone=…&embed=1     → chrome-less card for embedding in other systems

import { html, render, api, prefs, briefCard, quickCorrect, handleGreetingAction, subscribeCalls, toast, MOOD_LABEL } from './lib.js';

const params = new URLSearchParams(location.search);
const phone = params.get('phone');
const embed = params.get('embed') === '1';
const host = document.getElementById('brief');
const status = document.getElementById('status');
let current = null;

if (embed) document.body.classList.add('embed');

function show(brief, call = null) {
  current = { brief, call };
  render(host, briefCard(brief, { call, workplace: prefs.get().workplace, profileTarget: 'mizaj-main' }));
  document.title = brief.customer ? `${brief.customer.name} · Mizaj` : 'Mizaj call popup';
}

function waiting() {
  render(host, html`<div class="card waiting">
    <p style="margin:0 0 6px"><span class="dot" aria-hidden="true"></span><b>Waiting for the next call…</b></p>
    <p class="small muted" style="margin:0 0 14px">Keep this window open next to your softphone. The caller’s mood brief appears here as soon as the call arrives.</p>
    <button type="button" class="btn btn-primary" data-action="simulate">Simulate a call</button>
  </div>`);
}

async function lookup(number) {
  try {
    show(await api(`/lookup?phone=${encodeURIComponent(number)}`));
  } catch (err) {
    toast(err.message);
  }
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || handleGreetingAction(el)) return;
  if (el.dataset.action === 'simulate') {
    const res = await api('/demo/simulate-call', { method: 'POST', body: {} }).catch((err) => toast(err.message));
    if (res && !current?.call) setTimeout(() => { if (current?.call?.id !== res.call.id) show(res.brief, res.call); }, 1200);
  } else if (el.dataset.action === 'quick-correct') {
    const id = el.closest('[data-customer]').dataset.customer;
    try {
      await quickCorrect(id, el.dataset.mood);
      toast(`Recorded: ${MOOD_LABEL[el.dataset.mood]} (agent-reported)`);
      const fresh = await api(`/customers/${encodeURIComponent(id)}/brief`);
      show(fresh, current?.call);
    } catch (err) { toast(err.message); }
  } else if (el.dataset.action === 'open-profile' && window.opener && !window.opener.closed) {
    // Reuse the agent's main Mizaj tab when the popup was opened from it.
    e.preventDefault();
    window.opener.location.hash = `customer-${el.dataset.id}`;
    window.opener.focus();
  }
});

document.getElementById('lookup').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = document.getElementById('lookup-phone').value.trim();
  if (v) lookup(v);
});

if (phone) {
  lookup(phone);
} else {
  waiting();
}

if (!embed) {
  subscribeCalls(({ call, brief }) => {
    show(brief, call);
    window.focus();
  }, {
    onStatus: (s) => { status.textContent = s === 'connected' ? 'Connected — listening for incoming calls.' : 'Reconnecting to the call feed…'; },
  });
}
