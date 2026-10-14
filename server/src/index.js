// Ever Jobs UI — self-hosted frontend server.
//
//   Browser → this server (PORT, default 3002, HOST 0.0.0.0)
//               ├─ static React build (web/dist)
//               ├─ /api/settings/*  persistent API-connection settings
//               └─ /api/proxy/*     dynamic proxy to the Ever Jobs API
//
// Zero runtime dependencies (Node >= 20).

import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { SettingsStore } from './settings.js';
import { ApiProxy, parseAllowedHosts } from './proxy.js';
import { validateApiTarget } from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || '0.0.0.0';
const WEB_DIST = path.resolve(process.env.WEB_DIST || path.join(ROOT, '..', 'web', 'dist'));
const SETTINGS_FILE = process.env.SETTINGS_FILE || path.join(ROOT, 'data', 'settings.json');

const TIMEOUTS = {
  health: 10_000,
  sourcesHealth: 15_000,
  graphql: 30_000,
  search: 15 * 60_000, // a full fan-out can legitimately take minutes
};
const MAX_BODY = 1_000_000; // 1 MB request bodies

const store = new SettingsStore(SETTINGS_FILE, process.env);
const api = new ApiProxy(store, { allowedHosts: parseAllowedHosts(process.env.ALLOWED_API_HOSTS) });

// ---- helpers -------------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req, res) {
  const raw = await readBody(req);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: 'Malformed JSON body.' });
    return null;
  }
}

// CSRF defence for state-changing endpoints on a trusted-LAN single-user app:
// same-origin check + a custom header that cross-origin form/fetch requests
// cannot set (we never send CORS headers, so preflights always fail).
function csrfOk(req) {
  if (req.headers['x-everjobs-ui'] !== '1') return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      const o = new URL(origin);
      if (o.host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// Whitelisted upstream query parameters for /api/jobs/search.
const SEARCH_PARAMS = {
  format: /^(json|csv|ndjson)$/,
  dedup: /^(true|false)$/,
  diagnostics: /^(true|false|all)$/,
  diagnostics_limit: /^\d{1,6}$/,
  paginate: /^(true|false)$/,
  page: /^\d{1,7}$/,
  page_size: /^\d{1,3}$/,
};

function buildSearchQuery(searchParams) {
  const out = new URLSearchParams();
  for (const [key, pattern] of Object.entries(SEARCH_PARAMS)) {
    const v = searchParams.get(key);
    if (v != null && pattern.test(v)) out.set(key, v);
  }
  return out.toString();
}

/** Proxy one request upstream and stream the answer back to the browser. */
async function proxyTo(res, opts, label) {
  const t0 = Date.now();
  try {
    const upstream = await api.forward(opts);
    const headers = {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
      'x-everjobs-latency-ms': String(Date.now() - t0),
    };
    const len = upstream.headers.get('content-length');
    if (len) headers['content-length'] = len;
    // The upstream answers searches with 201 Created; for our clients this is
    // just a successful read, so normalise it to 200.
    res.writeHead(upstream.status === 201 ? 200 : upstream.status, headers);
    if (!upstream.body) {
      res.end();
      return;
    }
    const nodeStream = Readable.fromWeb(upstream.body);
    await new Promise((resolve, reject) => {
      nodeStream.on('error', reject);
      res.on('close', resolve);
      nodeStream.pipe(res);
    });
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const info = describeProxyError(err);
    store.setStatus({ state: info.status, detail: `${label}: ${info.detail}`, latencyMs });
    if (!res.headersSent) {
      sendJson(res, info.httpStatus, { error: info.detail, status: info.status, latencyMs });
    } else {
      res.end();
    }
  }
}

function describeProxyError(err) {
  const cause = err.cause?.code || err.cause?.message || '';
  if (err.message === 'client disconnected') return { httpStatus: 499, status: 'disconnected', detail: 'Client disconnected.' };
  if (err.name === 'AbortError' || err.message === 'timeout') {
    return { httpStatus: 504, status: 'timeout', detail: 'The Ever Jobs API did not respond before the timeout.' };
  }
  if (err.code === 'untrusted_host' || err.code === 'dns') {
    return { httpStatus: 400, status: 'invalid', detail: err.message };
  }
  if (err.code === 'redirect') {
    return { httpStatus: 502, status: 'invalid', detail: err.message };
  }
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(`${cause} ${err.message}`)) {
    return {
      httpStatus: 502,
      status: 'disconnected',
      detail: `Could not reach the configured Ever Jobs API (${store.baseUrl()}). ${cause || err.message}`,
    };
  }
  return { httpStatus: 502, status: 'disconnected', detail: `Proxy request failed: ${cause || err.message}` };
}

// ---- static files --------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

async function serveStatic(req, res, pathname) {
  let filePath = path.normalize(path.join(WEB_DIST, pathname));
  if (!filePath.startsWith(WEB_DIST)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  let fileStat = null;
  try {
    fileStat = await stat(filePath);
    if (fileStat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    // SPA fallback: unknown non-asset paths serve index.html
    if (path.extname(pathname)) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    filePath = path.join(WEB_DIST, 'index.html');
  }
  let data;
  try {
    data = await stat(filePath);
  } catch {
    sendJson(res, 404, { error: 'Frontend build not found. Run `npm run build` in web/ first.' });
    return;
  }
  const ext = path.extname(filePath);
  const headers = {
    ...SECURITY_HEADERS,
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': data.size,
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
}

// ---- routing -------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      await routeApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    await serveStatic(req, res, pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[server] ${req.method} ${pathname} failed:`, err);
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'Internal error' });
    else res.end();
  }
});

async function routeApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  // --- app meta / status ---
  if (method === 'GET' && p === '/api/status') {
    sendJson(res, 200, { baseUrl: store.baseUrl(), status: store.connectionStatus });
    return;
  }

  // --- settings ---
  if (method === 'GET' && p === '/api/settings') {
    sendJson(res, 200, store.snapshot());
    return;
  }

  if (method === 'POST' && p === '/api/settings/test') {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'Cross-origin or non-UI request rejected.' });
    const body = await readJsonBody(req, res);
    if (body === null) return;
    let target = store.current;
    if (body.protocol !== undefined || body.host !== undefined || body.port !== undefined) {
      const check = validateApiTarget(body);
      if (!check.ok) {
        // A malformed candidate says nothing about the active connection —
        // report it to the caller without touching the cached status.
        return sendJson(res, 400, { ok: false, status: 'invalid', error: check.error });
      }
      target = check.settings;
    }
    const result = await api.testTarget(target);
    if (store.isActive(target)) {
      store.setStatus({
        state: result.ok ? 'connected' : result.status,
        detail: result.detail,
        latencyMs: result.latencyMs,
        apiVersion: result.apiVersion,
      });
    }
    sendJson(res, 200, { ...result, tested: `${target.protocol}://${target.host}:${target.port}` });
    return;
  }

  if (method === 'PUT' && p === '/api/settings') {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'Cross-origin or non-UI request rejected.' });
    const body = await readJsonBody(req, res);
    if (body === null) return;
    const check = validateApiTarget(body);
    if (!check.ok) {
      return sendJson(res, 400, { ok: false, status: 'invalid', error: check.error, message: 'Settings were NOT saved; the previous configuration stays active.' });
    }
    const result = await api.testTarget(check.settings);
    if (!result.ok) {
      // Requirement: a failed test keeps the previously working configuration.
      // Only update the cached status if the failing target IS the active one.
      if (store.isActive(check.settings)) {
        store.setStatus({
          state: result.status,
          detail: result.detail,
          latencyMs: result.latencyMs,
          apiVersion: result.apiVersion,
        });
      }
      sendJson(res, 400, {
        error: result.detail,
        status: result.status,
        latencyMs: result.latencyMs,
        kept: store.baseUrl(),
        message: 'Settings were NOT saved; the previous configuration stays active.',
      });
      return;
    }
    const saved = await store.save(body);
    if (!saved.ok) return sendJson(res, 400, saved);
    // The saved target is now active and the test just passed.
    store.setStatus({
      state: 'connected',
      detail: result.detail,
      latencyMs: result.latencyMs,
      apiVersion: result.apiVersion,
    });
    sendJson(res, 200, { ok: true, ...store.snapshot(), test: result });
    return;
  }

  if (method === 'POST' && p === '/api/settings/reset') {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'Cross-origin or non-UI request rejected.' });
    await store.reset();
    sendJson(res, 200, store.snapshot());
    return;
  }

  // --- proxy: health ---
  if (method === 'GET' && p === '/api/proxy/health') {
    const t0 = Date.now();
    try {
      const upstream = await api.forward({ method: 'GET', path: '/health', timeoutMs: TIMEOUTS.health });
      const bodyText = upstream.body ? await new Response(upstream.body).text() : '';
      let health = null;
      try { health = JSON.parse(bodyText); } catch { /* ignore */ }
      const ok = upstream.status === 200 && health?.status === 'healthy';
      const latencyMs = Date.now() - t0;
      store.setStatus({
        state: ok ? 'connected' : 'invalid',
        detail: ok ? `Connected to ${store.baseUrl()}.` : `Unexpected answer from ${store.baseUrl()}/health (HTTP ${upstream.status}).`,
        latencyMs,
        apiVersion: health?.version ?? null,
      });
      sendJson(res, upstream.status === 200 ? 200 : 502, { ok, status: store.connectionStatus.state, latencyMs, health, baseUrl: store.baseUrl() });
    } catch (err) {
      const info = describeProxyError(err);
      store.setStatus({ state: info.status, detail: info.detail, latencyMs: Date.now() - t0 });
      sendJson(res, info.httpStatus === 499 ? 502 : info.httpStatus, { ok: false, status: info.status, detail: info.detail, baseUrl: store.baseUrl() });
    }
    return;
  }

  // --- proxy: source health (circuit breakers) ---
  if (method === 'GET' && p === '/api/proxy/sources/health') {
    const include = url.searchParams.get('include') === 'all' ? 'include=all' : '';
    await proxyTo(res, { method: 'GET', path: '/api/sources/health', query: include, timeoutMs: TIMEOUTS.sourcesHealth }, 'Source health request');
    return;
  }

  // --- proxy: GraphQL (source discovery) ---
  if (method === 'POST' && p === '/api/proxy/graphql') {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'Cross-origin or non-UI request rejected.' });
    const body = await readBody(req);
    if (Buffer.byteLength(body) > MAX_BODY) return sendJson(res, 413, { error: 'Request body too large.' });
    await proxyTo(res, { method: 'POST', path: '/graphql', body, timeoutMs: TIMEOUTS.graphql }, 'GraphQL request');
    return;
  }

  // --- proxy: job search (streams NDJSON or JSON) ---
  if (method === 'POST' && p === '/api/proxy/search') {
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'Cross-origin or non-UI request rejected.' });
    const body = await readBody(req);
    if (Buffer.byteLength(body) > MAX_BODY) return sendJson(res, 413, { error: 'Request body too large.' });
    const query = buildSearchQuery(url.searchParams);
    await proxyTo(res, { method: 'POST', path: '/api/jobs/search', query, body, timeoutMs: TIMEOUTS.search, signal: abortedSignal(req) }, 'Search request');
    return;
  }

  sendJson(res, 404, { error: `No route for ${method} ${p}` });
}

function abortedSignal(req) {
  const controller = new AbortController();
  req.on('aborted', () => controller.abort());
  req.on('close', () => {
    if (!req.complete) controller.abort();
  });
  return controller.signal;
}

// Long-running searches must not be cut off by Node's defaults.
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

await store.load();
if (!existsSync(WEB_DIST)) {
  console.warn(`[server] frontend build not found at ${WEB_DIST} — run \`npm run build\` in web/.`);
}
server.listen(PORT, HOST, () => {
  console.log(`[server] Ever Jobs UI listening on http://${HOST}:${PORT}`);
  console.log(`[server] proxying Ever Jobs API at ${store.baseUrl()} (source: ${store.source}, file: ${SETTINGS_FILE})`);
});
