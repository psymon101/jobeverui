// Server-side proxy to the Ever Jobs API.
//
// The target is resolved from the SettingsStore on EVERY request, so a
// Settings change takes effect immediately — nothing is cached in a
// module-level constant.
//
// Safety:
//  - only fixed upstream paths are reachable (no arbitrary URLs);
//  - the configured host is re-resolved before each request and every
//    resolved address must pass the trust policy (DNS-rebinding guard);
//  - redirects are never followed;
//  - every request has a timeout.

import dns from 'node:dns/promises';
import net from 'node:net';
import { isTrustedAddress, parseAllowedHosts } from './validate.js';

const USER_AGENT = 'ever-jobs-ui/1.0 (self-hosted frontend)';

export class ApiProxy {
  /**
   * @param {import('./settings.js').SettingsStore} store
   * @param {{ allowedHosts?: Set<string>|null }} [opts]
   */
  constructor(store, opts = {}) {
    this.store = store;
    this.allowedHosts = opts.allowedHosts ?? null;
  }

  /**
   * Forward a request to the active Ever Jobs API.
   * @param {object} o
   * @param {'GET'|'POST'} o.method
   * @param {string} o.path fixed upstream path, e.g. '/api/jobs/search'
   * @param {string} [o.query] query string without '?'
   * @param {string} [o.body] JSON body
   * @param {number} o.timeoutMs
   * @param {AbortSignal} [o.signal] client-disconnect signal
   * @returns {Promise<{status:number, headers:Headers, body:ReadableStream<Uint8Array>}>}
   */
  async forward(o) {
    const url = await this.#targetUrl(o.path, o.query);
    const controller = new AbortController();
    const onClientAbort = () => controller.abort(new Error('client disconnected'));
    if (o.signal) {
      if (o.signal.aborted) throw new Error('client disconnected');
      o.signal.addEventListener('abort', onClientAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(new Error('timeout')), o.timeoutMs);
    try {
      const init = {
        method: o.method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        redirect: 'manual',
        signal: controller.signal,
      };
      if (o.method === 'POST' && o.body != null) {
        init.body = o.body;
      }
      const res = await fetch(url, init);
      if (res.status >= 300 && res.status < 400) {
        // Consume and drop; never follow redirects from the API.
        res.body?.cancel().catch(() => {});
        throw Object.assign(new Error('The API replied with a redirect, which is not accepted.'), { code: 'redirect' });
      }
      return { status: res.status, headers: res.headers, body: res.body };
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onClientAbort);
    }
  }

  /**
   * Health + compatibility test against an explicit target (not necessarily
   * the saved one — used by "Test Connection" before saving).
   * @returns {Promise<{ok:boolean, status:string, detail:string, latencyMs:number|null, apiVersion:string|null}>}
   */
  async testTarget({ protocol, host, port }, timeoutMs = 8000) {
    const started = Date.now();
    const hostPart = host.includes(':') ? `[${host}]` : host;
    const base = `${protocol}://${hostPart}:${port}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    try {
      // An untrusted/unresolvable candidate is a validation failure, not a
      // server error: report it like the other failed-test outcomes.
      try {
        await this.#assertResolvable(host);
      } catch (err) {
        return { ok: false, status: 'invalid', detail: err.message, latencyMs: Date.now() - started, apiVersion: null };
      }

      // 1) generic health endpoint
      let res;
      try {
        res = await fetch(`${base}/health`, { signal: controller.signal, redirect: 'manual', headers: { 'user-agent': USER_AGENT } });
      } catch (err) {
        const latencyMs = Date.now() - started;
        if (err.name === 'AbortError') {
          return { ok: false, status: 'timeout', detail: `Timed out after ${Math.round(timeoutMs / 1000)}s connecting to ${base}/health.`, latencyMs, apiVersion: null };
        }
        const cause = err.cause?.code || err.cause?.message || err.message;
        return { ok: false, status: 'disconnected', detail: `Could not reach ${base}: ${cause}. Check the server address, port, protocol, and that the Ever Jobs API is running.`, latencyMs, apiVersion: null };
      }
      if (res.status >= 300 && res.status < 400) {
        res.body?.cancel().catch(() => {});
        return { ok: false, status: 'invalid', detail: 'The endpoint answered with a redirect; expected the Ever Jobs API to answer /health directly.', latencyMs: Date.now() - started, apiVersion: null };
      }
      if (res.status === 401 || res.status === 403) {
        res.body?.cancel().catch(() => {});
        return { ok: false, status: 'auth_required', detail: `The endpoint requires authentication (HTTP ${res.status}). This frontend does not send API keys; disable API-key auth on the Ever Jobs API or use a reverse proxy.`, latencyMs: Date.now() - started, apiVersion: null };
      }
      let health = null;
      const text = await res.text().catch(() => '');
      try { health = JSON.parse(text); } catch { /* not JSON — handled below */ }
      if (!res.ok || !health || health.status !== 'healthy') {
        return {
          ok: false,
          status: 'invalid',
          detail: `GET /health answered HTTP ${res.status}${health?.status ? ` (status: ${health.status})` : ''}${health ? '' : ' and did not return a Ever Jobs health payload — the endpoint may not be an Ever Jobs API.'}.`,
          latencyMs: Date.now() - started,
          apiVersion: health?.version ?? null,
        };
      }

      // 2) Ever Jobs compatibility check: GraphQL listSources must answer.
      let gqlOk = false;
      let gqlDetail = '';
      try {
        const gql = await fetch(`${base}/graphql`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
          body: JSON.stringify({ query: '{ listSources { total } }' }),
          signal: controller.signal,
          redirect: 'manual',
        });
        const gj = await gql.json().catch(() => null);
        gqlOk = gql.ok && gj?.data?.listSources?.total > 0;
        if (!gqlOk) gqlDetail = `POST /graphql did not return a Ever Jobs listSources payload (HTTP ${gql.status}).`;
      } catch (err) {
        gqlDetail = `POST /graphql failed: ${err.cause?.code || err.message}`;
      }
      const latencyMs = Date.now() - started;
      if (!gqlOk) {
        return { ok: false, status: 'incompatible', detail: `/health answered, but this does not look like an Ever Jobs API: ${gqlDetail}`, latencyMs, apiVersion: health.version ?? null };
      }

      return {
        ok: true,
        status: 'connected',
        detail: `Connected to Ever Jobs API${health.version ? ` v${health.version}` : ''} (${health.environment ? `${health.environment}, ` : ''}uptime ${Math.round((health.uptime ?? 0) / 60)} min).`,
        latencyMs,
        apiVersion: health.version ?? null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async #targetUrl(pathname, query) {
    const { protocol, host, port } = this.store.current;
    await this.#assertResolvable(host);
    const hostPart = host.includes(':') ? `[${host}]` : host;
    return `${protocol}://${hostPart}:${port}${pathname}${query ? `?${query}` : ''}`;
  }

  /** Explicit allowlist wins; otherwise resolved addresses must be trusted LAN addresses. */
  async #assertResolvable(host) {
    if (this.allowedHosts) {
      if (!this.allowedHosts.has(host.toLowerCase())) {
        throw Object.assign(new Error(`Host "${host}" is not in ALLOWED_API_HOSTS.`), { code: 'untrusted_host' });
      }
      return;
    }
    if (net.isIP(host)) {
      if (!isTrustedAddress(host)) {
        throw Object.assign(new Error(`Address "${host}" is outside the trusted LAN ranges. Set ALLOWED_API_HOSTS to allow it explicitly.`), { code: 'untrusted_host' });
      }
      return;
    }
    let addresses;
    try {
      addresses = await dns.lookup(host, { all: true });
    } catch (err) {
      throw Object.assign(new Error(`Could not resolve "${host}": ${err.code || err.message}`), { code: 'dns' });
    }
    if (!addresses.length) {
      throw Object.assign(new Error(`Could not resolve "${host}".`), { code: 'dns' });
    }
    for (const { address } of addresses) {
      if (!isTrustedAddress(address)) {
        throw Object.assign(
          new Error(`"${host}" resolves to ${address}, which is outside the trusted LAN ranges. Set ALLOWED_API_HOSTS to allow it explicitly.`),
          { code: 'untrusted_host' },
        );
      }
    }
  }
}

export { parseAllowedHosts };
