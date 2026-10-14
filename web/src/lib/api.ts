// Browser client. Every call goes to our own server (/api/*), which proxies
// to the currently saved Ever Jobs API — the browser never talks to the API
// directly and never sees credentials or the API address logic.

import type {
  ApiSettings,
  Job,
  NdjsonEnd,
  NdjsonProgress,
  SettingsSnapshot,
  SourceHealth,
  SourceInfo,
  TestResult,
} from './types';

const UI_HEADER = { 'X-EverJobs-UI': '1' };

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw */
  }
  if (!res.ok) {
    const d = data as Record<string, string> | null;
    throw new Error(d?.error || d?.detail || d?.message || `HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return (data ?? text) as T;
}

const get = <T,>(url: string) => fetch(url, { headers: { accept: 'application/json' } }).then(json<T>);
const mutate = <T,>(method: string, url: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...UI_HEADER },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(json<T>);

// ---- settings & status ----

export const api = {
  getSettings: () => get<SettingsSnapshot>('/api/settings'),
  status: () => get<{ baseUrl: string; status: SettingsSnapshot['status'] }>('/api/status'),
  testSettings: (s: ApiSettings) => mutate<TestResult>('POST', '/api/settings/test', s),
  saveSettings: (s: ApiSettings) => mutate<{ ok: boolean } & SettingsSnapshot & { test: TestResult }>('PUT', '/api/settings', s),
  resetSettings: () => mutate<SettingsSnapshot>('POST', '/api/settings/reset'),

  proxyHealth: () => get<{ ok: boolean; status: string; latencyMs: number; health: Record<string, unknown>; baseUrl: string }>('/api/proxy/health'),
  sourcesHealth: () => get<{ count: number; sources: SourceHealth[] }>('/api/proxy/sources/health?include=all'),

  // ---- source discovery (GraphQL listSources through the proxy) ----
  async listSources(): Promise<SourceInfo[]> {
    const r = await fetch('/api/proxy/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...UI_HEADER },
      body: JSON.stringify({ query: '{ listSources { total sources { name value } } }' }),
    }).then(json<{ data?: { listSources: { total: number; sources: SourceInfo[] } }; errors?: { message: string }[] }>);
    if (r.errors?.length) throw new Error(r.errors[0].message);
    if (!r.data?.listSources) throw new Error('Unexpected listSources response.');
    return r.data.listSources.sources;
  },

  // ---- NDJSON streaming search: live progress + incremental jobs ----
  async searchStream(
    body: unknown,
    handlers: {
      onProgress?: (p: NdjsonProgress) => void;
      onJob?: (job: Job) => void;
      onEnd?: (end: NdjsonEnd) => void;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch('/api/proxy/search?format=ndjson&dedup=true&diagnostics=true', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...UI_HEADER },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text);
        msg = j.error || j.detail || msg;
      } catch {
        if (text) msg = `${msg} ${text.slice(0, 200)}`;
      }
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        switch (msg.type) {
          case 'progress':
            handlers.onProgress?.(msg as unknown as NdjsonProgress);
            break;
          case 'job':
            handlers.onJob?.((msg as { data: Job }).data);
            break;
          case 'end':
            handlers.onEnd?.(msg as unknown as NdjsonEnd);
            break;
        }
      }
    }
    // trailing line without newline
    const line = buf.trim();
    if (line) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'job') handlers.onJob?.(msg.data as Job);
        if (msg.type === 'end') handlers.onEnd?.(msg as NdjsonEnd);
      } catch {
        /* ignore */
      }
    }
  },
};
