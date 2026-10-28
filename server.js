// Mizaj (مزاج) — Customer Mood Intelligence. "Know the mood before you say hello."
// Start with `npm start` (no dependencies needed, Node 18+).

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './src/data/store.js';
import { fileState } from './src/data/file-state.js';
import { createApp } from './src/server/app.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const port = Number(env.PORT) || 3000;
const host = env.HOST || '0.0.0.0';
const stateFile = env.MIZAJ_STATE_FILE === undefined ? path.join(root, '.mizaj', 'state.json') : env.MIZAJ_STATE_FILE || null;

const store = createStore({ persistence: stateFile ? fileState(stateFile) : null });
const app = createApp({
  store,
  publicDir: path.join(root, 'public'),
  ctiKey: env.MIZAJ_CTI_KEY || '',
  corsOrigin: env.MIZAJ_CORS_ORIGIN || '*',
  embedOrigins: env.MIZAJ_EMBED_ORIGINS || '*',
});

const server = http.createServer(app.handler);
server.listen(port, host, () => {
  const shown = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Mizaj (مزاج) running at http://${shown}:${port}`);
  console.log(`  Web app      http://${shown}:${port}/`);
  console.log(`  Call popup   http://${shown}:${port}/popup`);
  console.log(`  API docs     http://${shown}:${port}/docs`);
  console.log('  DEMO MODE — all customer data is fictional and every data source is simulated.');
});

function shutdown() {
  store.flush();
  app.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
