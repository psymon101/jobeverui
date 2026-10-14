import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { SourceHealth, SourceInfo } from '../lib/types';
import { observedSources, type ObservedSource } from '../lib/storage';
import { BENIGN_REASONS, CATEGORY_LABELS, REASON_LABELS, categorize, requiresCompanySlug, type SourceCategory } from '../lib/sources';
import { Badge, Button, reasonTone } from './ui';

const CATEGORY_ORDER: SourceCategory[] = ['major', 'remote', 'ats', 'company', 'other'];

// The API emits breaker states hyphenated ("half-open"); normalize to the
// underscore form used for counting, tone, and label.
function normCircuit(state: string | undefined): string {
  return (state || '').replace(/-/g, '_');
}

export default function SourcesPage({
  sources,
  loading,
  error,
  onRetry,
}: {
  sources: SourceInfo[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [health, setHealth] = useState<SourceHealth[] | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [text, setText] = useState('');
  const [cat, setCat] = useState<SourceCategory | ''>('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [observed, setObserved] = useState<Record<string, ObservedSource>>(() => observedSources.list());

  function loadHealth() {
    setLoadingHealth(true);
    setHealthError(null);
    // Re-read this UI's observations too, so "Last seen" is current.
    setObserved(observedSources.list());
    api
      .sourcesHealth()
      .then((r) => setHealth(r.sources))
      .catch((e) => setHealthError(String((e as Error).message || e)))
      .finally(() => setLoadingHealth(false));
  }

  useEffect(loadHealth, []);

  const healthMap = useMemo(() => {
    const m = new Map<string, SourceHealth>();
    for (const h of health ?? []) m.set(h.site, h);
    return m;
  }, [health]);

  const rows = useMemo(() => {
    const t = text.trim().toLowerCase();
    return sources
      .filter((s) => (cat ? categorize(s.value) === cat : true))
      .filter((s) => (t ? s.value.includes(t) || s.name.toLowerCase().includes(t) : true))
      .filter((s) => {
        if (!problemsOnly) return true;
        const obs = observed[s.value];
        const h = healthMap.get(s.value);
        return (obs && !BENIGN_REASONS.has(obs.reason)) || (h && normCircuit(h.state) !== 'closed');
      })
      .map((s) => ({
        info: s,
        category: categorize(s.value),
        needsSlug: requiresCompanySlug(s.value),
        circuit: healthMap.get(s.value) ?? null,
        observed: observed[s.value] ?? null,
      }));
  }, [sources, text, cat, problemsOnly, observed, healthMap]);

  const circuitCount = (state: string) => (health ?? []).filter((h) => normCircuit(h.state) === state).length;

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold">Job Sources</h2>
        <span className="text-sm text-slate-500">
          {sources.length} registered{health ? ` · circuit breakers: ${circuitCount('closed')} closed, ${circuitCount('half_open')} half-open, ${circuitCount('open')} open` : ''}
        </span>
        <Button variant="secondary" onClick={loadHealth} disabled={loadingHealth} className="ml-auto">
          {loadingHealth ? 'Refreshing…' : 'Refresh circuit state'}
        </Button>
      </div>

      <p className="text-xs text-slate-500">
        The catalogue is read live from the API (GraphQL <code>listSources</code>). <strong>Circuit</strong> is the API's breaker state — a
        breaker that has never tripped reads "closed" even for sources that were never called, so it is not a health guarantee ("no recent
        traffic" means the API has no signal). <strong>Last seen</strong> is what this frontend observed in your searches. Only observed
        results or a tripped breaker tell you about real health.
      </p>

      {healthError && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Could not load circuit-breaker state: {healthError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Filter sources…"
          aria-label="Filter sources by name"
          className="w-64 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
        />
        <select value={cat} onChange={(e) => setCat(e.target.value as SourceCategory | '')} aria-label="Filter sources by category" className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800">
          <option value="">All categories</option>
          {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" className="accent-blue-600" aria-label="Show only sources with problems" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
          Problems only
        </label>
        <span className="text-xs text-slate-400">{rows.length} shown</span>
      </div>

      {loading ? (
        <div className="p-6 text-slate-500">Loading catalogue…</div>
      ) : error ? (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error} <button onClick={onRetry} className="ml-2 underline">Retry</button>
        </div>
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Configuration</th>
                <th className="px-3 py-2">Circuit</th>
                <th className="px-3 py-2">Last seen (this UI)</th>
                <th className="px-3 py-2">Last error / detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 600).map(({ info, category, needsSlug, circuit, observed: obs }) => (
                <tr key={info.value} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-1.5 font-mono text-xs">{info.value}</td>
                  <td className="px-3 py-1.5 text-xs">{CATEGORY_LABELS[category]}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {needsSlug ? <Badge tone="amber">needs company slug</Badge> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {circuit ? (
                      <span className="flex items-center gap-1.5">
                        <Badge tone={normCircuit(circuit.state) === 'closed' ? 'green' : normCircuit(circuit.state) === 'half_open' ? 'amber' : 'red'}>
                          {normCircuit(circuit.state).replace('_', ' ')}
                        </Badge>
                        {circuit.p95LatencyMs > 0 || circuit.successRate < 1 ? (
                          <span className="text-slate-400">
                            {(circuit.successRate * 100).toFixed(0)}% · p95 {circuit.p95LatencyMs}ms
                          </span>
                        ) : (
                          <span className="text-slate-400">no recent traffic</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400">no data</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {obs ? (
                      <span className="flex items-center gap-1.5">
                        <Badge tone={reasonTone(obs.reason)}>{REASON_LABELS[obs.reason] ?? obs.reason}</Badge>
                        <span className="text-slate-400">{new Date(obs.at).toLocaleString()}</span>
                      </span>
                    ) : (
                      <span className="text-slate-400">not used yet</span>
                    )}
                  </td>
                  <td className="max-w-[360px] break-words px-3 py-1.5 text-xs text-slate-500">
                    {obs?.reason && !BENIGN_REASONS.has(obs.reason) ? obs.detail : circuit && normCircuit(circuit.state) !== 'closed' ? 'breaker engaged by the API' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 600 && (
            <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-400 dark:border-slate-700">
              Showing first 600 of {rows.length} — narrow with the filter.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
