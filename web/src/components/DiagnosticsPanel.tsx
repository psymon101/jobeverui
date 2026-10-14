import { useState } from 'react';
import type { NdjsonEnd, PerSourceRow, PerSourceSummary } from '../lib/types';
import { REASON_LABELS } from '../lib/sources';
import { Badge, reasonTone } from './ui';

export interface SearchStats {
  rawCount: number; // jobs received (pre-dedup as counted by API)
  dedupedCount: number; // jobs kept
  mergedPairs?: number;
  durationMs?: number;
  end?: NdjsonEnd;
  perSource?: PerSourceRow[];
  summary?: PerSourceSummary;
  requests?: number; // API searches run (terms); > 1 when sources were queried repeatedly
  partial?: boolean;
  partialReason?: string;
}

export default function DiagnosticsPanel({ stats }: { stats: SearchStats }) {
  const [open, setOpen] = useState(false);
  const rows = stats.perSource ?? [];
  const summary = stats.summary;

  const byReason = summary?.by_reason ?? {};
  const okCount = byReason.ok ?? 0;
  const emptyCount = byReason.empty ?? 0;
  const blockedCount = byReason.blocked ?? 0;
  const failedCount = (byReason.fetch_error ?? 0) + (byReason.timeout ?? 0) + (byReason.circuit_open ?? 0) + (byReason.browser_unavailable ?? 0) + (byReason.unknown ?? 0) + (byReason.bad_input ?? 0);
  const skippedCount = byReason.skipped ?? 0;

  const problemRows = rows.filter((r) => r.reason !== 'ok' && r.reason !== 'empty');
  const hasProblems = problemRows.length > 0 || (summary?.actionable ?? 0) > 0 || stats.partial;

  return (
    <div className="rounded-lg border border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-900">
      <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left">
        <span className="font-semibold">{stats.dedupedCount} jobs</span>
        {stats.rawCount !== stats.dedupedCount && (
          <span className="text-slate-500">{stats.rawCount} raw → {stats.dedupedCount} after dedup ({stats.rawCount - stats.dedupedCount} duplicates merged)</span>
        )}
        {stats.durationMs != null && <span className="text-slate-500">{(stats.durationMs / 1000).toFixed(1)}s</span>}
        {summary && (
          <span className="text-slate-500">
            sources: {summary.total} queried{stats.requests && stats.requests > 1 ? ` (${stats.requests} searches)` : ''} · {okCount} with results · {emptyCount} empty · {blockedCount} blocked · {failedCount} failed
            {skippedCount ? ` · ${skippedCount} skipped` : ''}
          </span>
        )}
        {stats.partial && <Badge tone="amber">partial results</Badge>}
        {hasProblems ? <Badge tone="red">{(problemRows.length || summary?.actionable) ? `${problemRows.length || summary?.actionable} issues` : 'stopped early'}</Badge> : <Badge tone="green">all ok</Badge>}
        <span className="ml-auto text-xs text-blue-600 dark:text-blue-400">{open ? 'hide details ▲' : 'show details ▼'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-200 p-3 dark:border-slate-700">
          {stats.partial && (
            <div className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              Partial results: {stats.partialReason || 'the search did not complete across all sources'}
              {stats.end?.stopReason ? ` (stop reason: ${stats.end.stopReason})` : ''}. Jobs missing from this result may still exist.
            </div>
          )}
          {stats.end && !stats.end.complete && (
            <div className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              The API reported the fan-out incomplete (skipped {stats.end.sourcesSkipped ?? 0}, failed {stats.end.sourcesFailed ?? 0}, partial{' '}
              {stats.end.sourcesPartial ?? 0}).
            </div>
          )}
          {rows.length === 0 ? (
            <div className="text-xs text-slate-500">
              No per-source rows returned. {summary ? `Summary: ${JSON.stringify(summary.by_reason)}.` : ''} Rows appear after a search with
              diagnostics enabled (always on for streamed searches).
            </div>
          ) : (
            <div className="scroll-thin max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left uppercase tracking-wide text-slate-500 dark:bg-slate-800">
                  <tr>
                    <th className="px-2 py-1">Source</th>
                    <th className="px-2 py-1">Status</th>
                    <th className="px-2 py-1 text-right">Jobs</th>
                    <th className="px-2 py-1">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort((a, b) => (a.reason === 'ok' ? 1 : 0) - (b.reason === 'ok' ? 1 : 0) || a.site.localeCompare(b.site)).map((r) => (
                    <tr key={r.site} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-2 py-1 font-mono">{r.site}</td>
                      <td className="px-2 py-1"><Badge tone={reasonTone(r.reason)}>{REASON_LABELS[r.reason] ?? r.reason}</Badge></td>
                      <td className="px-2 py-1 text-right">{r.count ?? '—'}</td>
                      <td className="max-w-[480px] break-words px-2 py-1 text-slate-500">{r.detail ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {stats.end?.problemSources && stats.end.problemSources.length > 0 && rows.length === 0 && (
            <div className="mt-2 text-xs text-slate-500">
              Problem sources: {stats.end.problemSources.map((p) => `${p.site} (${p.reason})`).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
