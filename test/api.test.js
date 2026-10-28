import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/data/store.js';
import { createApp } from '../src/server/app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let app;
let base;

before(async () => {
  const store = createStore({ populationSize: 30 });
  app = createApp({ store, publicDir: path.join(root, 'public'), ctiKey: 'secret-key' });
  server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  app.close();
  server.close();
});

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, headers: res.headers, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
};
const send = async (method, p, body, headers = {}) => {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('health and CORS', async () => {
  const r = await get('/api/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});

test('lookup by phone returns a labelled estimate', async () => {
  const r = await get('/api/v1/lookup?phone=9000%201001');
  assert.equal(r.status, 200);
  assert.equal(r.body.meta.dataMode, 'demo');
  assert.equal(r.body.matched, true);
  assert.equal(r.body.customer.id, 'C1001');
  assert.equal(r.body.mood.estimate.isEstimate, true);
  assert.equal(r.body.mood.display.sourceLabel, 'Estimated');
  assert.ok(r.body.mood.estimate.disclaimer.includes('not a fact'));
  assert.ok(r.body.greeting.call.ar && r.body.greeting.call.en);
});

test('unknown number → Unknown, not a guess', async () => {
  const r = await get('/api/v1/lookup?phone=99999999');
  assert.equal(r.body.matched, false);
  assert.equal(r.body.mood.display.mood, 'unknown');
  assert.match(r.body.mood.estimate.unknownReason, /No customer record/);
});

test('invalid phone → 400', async () => {
  assert.equal((await get('/api/v1/lookup?phone=abc')).status, 400);
});

test('search by partial number and name', async () => {
  assert.equal((await get('/api/v1/customers?q=1003')).body.results[0].id, 'C1003');
  assert.equal((await get('/api/v1/customers?q=fatma')).body.results[0].id, 'C1002');
});

test('profile contains every section', async () => {
  const r = await get('/api/v1/customers/C1001');
  for (const k of ['customer', 'mood', 'suggestions', 'alerts', 'unresolved', 'followUps', 'tickets', 'calls', 'messages', 'feedback', 'visits', 'timeline']) {
    assert.ok(k in r.body, k);
  }
  assert.equal((await get('/api/v1/customers/NOPE')).status, 404);
});

test('agents can correct a mood; the estimate is kept alongside', async () => {
  const bad = await send('POST', '/api/v1/customers/C1003/mood-feedback', { verdict: 'corrected', mood: 'ecstatic' });
  assert.equal(bad.status, 400);
  const r = await send('POST', '/api/v1/customers/C1003/mood-feedback', { verdict: 'corrected', mood: 'neutral', note: 'Calm on the phone', agent: 'Test' });
  assert.equal(r.status, 201);
  assert.equal(r.body.mood.display.source, 'agent');
  assert.equal(r.body.mood.display.mood, 'neutral');
  assert.equal(r.body.mood.estimate.mood, 'frustrated');
  const unknownConfirm = await send('POST', '/api/v1/customers/C1004/mood-feedback', { verdict: 'confirmed' });
  assert.equal(unknownConfirm.status, 400, 'an Unknown estimate cannot be "confirmed"');
});

test('follow-ups can be added and completed', async () => {
  const add = await send('POST', '/api/v1/customers/C1008/follow-ups', { title: 'Call back about auto-pay', dueAt: new Date(Date.now() + 3600e3).toISOString() });
  assert.equal(add.status, 201);
  const done = await send('PATCH', `/api/v1/follow-ups/${add.body.followUp.id}`, { status: 'done' });
  assert.equal(done.status, 200);
  assert.equal(done.body.followUp.status, 'done');
  assert.equal((await send('PATCH', '/api/v1/follow-ups/F-NOPE', { status: 'done' })).status, 404);
});

test('CTI webhook requires the key and pushes the brief over SSE', async () => {
  assert.equal((await send('POST', '/api/v1/calls/incoming', { phone: '90001002' })).status, 401);

  const events = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/v1/events`, (res) => {
      let buf = '';
      res.on('data', async (chunk) => {
        buf += chunk;
        if (buf.includes('event: hello') && !req.sent) {
          req.sent = true;
          const r = await send('POST', '/api/v1/calls/incoming', { phone: '90001002', callId: 'CTI-1' }, { 'X-Api-Key': 'secret-key' });
          assert.equal(r.status, 202);
          assert.equal(r.body.call.mode, 'live');
        }
        if (buf.includes('event: incoming-call')) {
          req.destroy();
          resolve(buf);
        }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
  const data = JSON.parse(events.split('event: incoming-call\ndata: ')[1].split('\n')[0]);
  assert.equal(data.call.id, 'CTI-1');
  assert.equal(data.brief.customer.id, 'C1002');

  const sim = await send('POST', '/api/v1/demo/simulate-call', {});
  assert.equal(sim.body.call.mode, 'simulated');
  const integ = await get('/api/v1/integrations');
  assert.equal(integ.body.channels[0].liveEvents, 1);
  assert.ok(integ.body.dataSources.every((s) => s.mode === 'simulated'));
});

test('dashboard', async () => {
  const r = await get('/api/v1/dashboard?days=30');
  assert.equal(r.status, 200);
  assert.equal(r.body.trend.length, 5);
  assert.ok(r.body.kpis.customers > 0);
  assert.ok(Array.isArray(r.body.recurringIssues));
});

test('static pages are served and paths cannot escape public/', async () => {
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Mizaj/);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal((await get('/popup')).status, 200);
  assert.equal((await get('/docs')).status, 200);
  assert.equal((await get('/..%2f..%2fpackage.json')).status, 404);
  assert.equal((await get('/api/v1/nope')).status, 404);
});
