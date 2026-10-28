// Runs the Mizaj API inside the browser for the hosted demo: same store, same
// route handlers, same mood engine as the server. Agent actions are kept in this
// browser's storage; incoming-call events are delivered in-page (and to other
// tabs of the demo via BroadcastChannel where the browser allows it).

import { createStore } from '../data/store.js';
import { createApi } from '../server/api.js';

const STORAGE_KEY = 'mizaj.demo-state.v1';

const browserState = {
  load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  },
  save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable: keep in memory */ }
  },
};

export function createLocalServer() {
  const listeners = new Set();
  let channel = null;
  try {
    channel = new BroadcastChannel('mizaj-calls');
    channel.onmessage = (e) => listeners.forEach((fn) => fn(e.data));
  } catch { /* single tab only */ }

  const events = {
    broadcast(type, data) {
      if (type !== 'incoming-call') return 0;
      listeners.forEach((fn) => fn(data));
      try { channel?.postMessage(data); } catch { /* ignore */ }
      return listeners.size;
    },
    listeners: () => listeners.size,
  };

  const store = createStore({ persistence: browserState });
  const api = createApi({ store, events, hosted: true });

  return {
    async request(method, path, body) {
      const url = new URL(`/api/v1${path}`, 'http://mizaj.local');
      const res = await api.handle({ method, pathname: url.pathname, query: url.searchParams, body: body || {}, headers: {} });
      // Copy like a network response would, so the UI never holds live store objects.
      const data = JSON.parse(JSON.stringify(res.body));
      if (res.status >= 400) throw new Error(data.error || `Request failed (${res.status})`);
      return data;
    },
    subscribe(onCall) {
      listeners.add(onCall);
      return { close: () => listeners.delete(onCall) };
    },
  };
}
