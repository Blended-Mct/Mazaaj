// HTTP layer: JSON API (/api/v1), Server-Sent Events, and the static web app.
// The route handlers live in ./api.js. No login by design — deploy on the agent
// network or behind your gateway.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventHub } from './events.js';
import { createApi, HttpError } from './api.js';

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
  const api = createApi({
    store,
    clock,
    events: { broadcast: (...args) => events.broadcast(...args), listeners: () => events.clients.size },
    authorizeCti: (headers) => !ctiKey || safeEqual(headers['x-api-key'], ctiKey),
    ctiKeyConfigured: Boolean(ctiKey),
  });

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

      if (req.method === 'GET' && pathname === '/api/v1/events') {
        return events.add(req, res, { agentId: url.searchParams.get('agentId') });
      }
      if (req.method === 'GET' && pathname === '/api/v1/openapi.json') {
        return send(res, 200, await fs.readFile(path.join(publicDir, 'openapi.json')));
      }
      try {
        const body = req.method === 'POST' || req.method === 'PATCH' ? await readJson(req) : {};
        const out = await api.handle({ method: req.method, pathname, query: url.searchParams, body, headers: req.headers });
        return send(res, out.status, out.body);
      } catch (err) {
        return send(res, err.status || 500, { error: err.status ? err.message : 'Internal error' });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    return serveStatic(pathname, res);
  }

  return { handler, events, close: () => events.close() };
}
