import { useMemo, useState } from 'react';
import type { SourceInfo } from '../lib/types';
import { CATEGORY_LABELS, PRESET_QUICK_SELECTS, categorize, requiresCompanySlug, type SourceCategory } from '../lib/sources';
import { Badge } from './ui';

const CATEGORY_ORDER: SourceCategory[] = ['major', 'remote', 'ats', 'company', 'other'];
const RENDER_CAP = 400;

export default function SourcePicker({
  sources,
  selected,
  onChange,
  loading,
  error,
  onRetry,
}: {
  sources: SourceInfo[];
  selected: string[];
  onChange: (next: string[]) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ major: true, remote: false, ats: false, company: false, other: false });

  const grouped = useMemo(() => {
    const g: Record<SourceCategory, SourceInfo[]> = { major: [], remote: [], ats: [], company: [], other: [] };
    for (const s of sources) g[categorize(s.value)].push(s);
    const f = filter.trim().toLowerCase();
    if (!f) return g;
    for (const k of CATEGORY_ORDER) g[k] = g[k].filter((s) => s.value.includes(f) || s.name.toLowerCase().includes(f));
    return g;
  }, [sources, filter]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(value: string) {
    const next = new Set(selectedSet);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange([...next]);
  }

  function addAll(values: string[]) {
    const next = new Set(selectedSet);
    for (const v of values) next.add(v);
    onChange([...next]);
  }

  function removeAll(values: string[]) {
    const drop = new Set(values);
    onChange(selected.filter((v) => !drop.has(v)));
  }

  const atsSelected = selected.filter(requiresCompanySlug);

  if (loading) {
    return <PanelShell>
      <div className="space-y-2 p-3">
        {[...Array(6)].map((_, i) => <div key={i} className="h-4 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />)}
        <div className="text-xs text-slate-400">Loading source catalogue from the API…</div>
      </div>
    </PanelShell>;
  }
  if (error) {
    return <PanelShell>
      <div className="p-3 text-sm">
        <div className="text-red-600 dark:text-red-400">Could not load sources: {error}</div>
        <button onClick={onRetry} className="mt-2 text-blue-600 underline dark:text-blue-400">Retry</button>
      </div>
    </PanelShell>;
  }

  const allValues = sources.map((s) => s.value);

  return (
    <PanelShell>
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        <div className="text-sm font-semibold">Job sources</div>
        <div className="text-xs text-slate-500">{selected.length} of {sources.length} selected</div>
      </div>

      <div className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-700">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter sources…"
          aria-label="Filter source list"
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
        />
        <div className="flex flex-wrap gap-1.5 text-xs">
          <QuickBtn onClick={() => onChange(allValues)}>Select all</QuickBtn>
          <QuickBtn onClick={() => onChange([])}>Clear all</QuickBtn>
          {PRESET_QUICK_SELECTS.map((p) => (
            <QuickBtn key={p.label} onClick={() => onChange([...new Set([...selected, ...p.values])])}>+ {p.label}</QuickBtn>
          ))}
        </div>
        {atsSelected.length > 0 && (
          <div className="rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {atsSelected.length} ATS source{atsSelected.length > 1 ? 's' : ''} selected — these scrape a single company board and need the{' '}
            <strong>Company slug</strong> field (Advanced) to return results.
          </div>
        )}
      </div>

      <div className="scroll-thin max-h-[420px] overflow-y-auto">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped[cat];
          const values = items.map((s) => s.value);
          const selCount = values.filter((v) => selectedSet.has(v)).length;
          const open = expanded[cat];
          return (
            <div key={cat} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  onClick={() => setExpanded({ ...expanded, [cat]: !open })}
                  className="flex flex-1 items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                >
                  <span className="w-3 text-center">{open ? '▾' : '▸'}</span>
                  {CATEGORY_LABELS[cat]}
                  <span className="font-normal normal-case text-slate-400">
                    {selCount}/{items.length}
                  </span>
                </button>
                <button
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() => (selCount === values.length ? removeAll(values) : addAll(values))}
                >
                  {selCount === values.length && values.length ? 'none' : 'all'}
                </button>
              </div>
              {open && (
                <div className="scroll-thin max-h-56 overflow-y-auto px-3 pb-2">
                  {items.length === 0 && <div className="py-1 text-xs text-slate-400">No matches.</div>}
                  {items.slice(0, RENDER_CAP).map((s) => (
                    <label key={s.value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={selectedSet.has(s.value)} onChange={() => toggle(s.value)} className="accent-blue-600" />
                      <span className="truncate">{s.value}</span>
                      {requiresCompanySlug(s.value) && <Badge tone="amber">needs slug</Badge>}
                    </label>
                  ))}
                  {items.length > RENDER_CAP && (
                    <div className="px-1 py-1 text-xs text-slate-400">
                      Showing first {RENDER_CAP} of {items.length} — use the filter to narrow down.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PanelShell>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">{children}</div>;
}

function QuickBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      {children}
    </button>
  );
}
