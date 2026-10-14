import { useMemo, useState } from 'react';
import type { Job, ReviewedStatus } from '../lib/types';
import { formatDate, jobApplyUrl, jobDate, jobKey, jobKey as keyOf, prettySource, salarySortValue, formatSalary } from '../lib/format';
import { Badge, EmptyState, reasonTone } from './ui';

export type SortField = 'posted' | 'title' | 'company' | 'location' | 'salary';

export interface TableFilters {
  text: string;
  titleOnly: boolean; // keywords must appear in the job title only
  source: string; // '' = all
  company: string;
  locationText: string;
  remote: 'any' | 'only' | 'exclude';
  status: 'all' | 'new' | 'reviewed' | 'not_interested' | 'exclude_reviewed';
}

export const DEFAULT_FILTERS: TableFilters = {
  text: '',
  titleOnly: false,
  source: '',
  company: '',
  locationText: '',
  remote: 'any',
  status: 'all',
};

const PAGE_SIZES = [25, 50, 100, 250];

export default function ResultsTable({
  jobs,
  totalBeforeFilter,
  reviewedMap,
  favoriteKeys,
  onOpenJob,
  onToggleFavorite,
  onReviewed,
  filters,
  onFilters,
  sourceCounts,
  blockedSources,
}: {
  jobs: Job[];
  totalBeforeFilter: number;
  reviewedMap: Record<string, { status: 'reviewed' | 'not_interested'; updatedAt: string }>;
  favoriteKeys: Set<string>;
  onOpenJob: (job: Job) => void;
  onToggleFavorite: (job: Job) => void;
  onReviewed: (job: Job, s: ReviewedStatus) => void;
  filters: TableFilters;
  onFilters: (f: TableFilters) => void;
  sourceCounts: Map<string, number>;
  blockedSources: { site: string; reason: string }[];
}) {
  const [sort, setSort] = useState<{ field: SortField; dir: 1 | -1 }>({ field: 'posted', dir: -1 });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const statusOf = (job: Job): ReviewedStatus => reviewedMap[keyOf(job)]?.status ?? 'new';

  const filtered = useMemo(() => {
    const f = filters;
    // Keyword mode: every whitespace-separated word must appear (in any
    // order) — "senior engineer" matches "Engineer III, Senior".
    const keywords = f.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const company = f.company.trim().toLowerCase();
    const locText = f.locationText.trim().toLowerCase();
    return jobs.filter((j) => {
      if (keywords.length) {
        const haystack = (f.titleOnly ? (j.title || '') : `${j.title} ${j.companyName} ${jLocation(j)}`).toLowerCase();
        if (!keywords.every((k) => haystack.includes(k))) return false;
      }
      if (f.source && j.site !== f.source) return false;
      if (company && !(j.companyName || '').toLowerCase().includes(company)) return false;
      if (locText && !jLocation(j).toLowerCase().includes(locText)) return false;
      if (f.remote === 'only' && !j.isRemote) return false;
      if (f.remote === 'exclude' && j.isRemote) return false;
      const st = statusOf(j);
      if (f.status === 'new' && st !== 'new') return false;
      if (f.status === 'reviewed' && st !== 'reviewed') return false;
      if (f.status === 'not_interested' && st !== 'not_interested') return false;
      if (f.status === 'exclude_reviewed' && st !== 'new') return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, filters, reviewedMap]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let r = 0;
      switch (sort.field) {
        case 'posted': {
          const da = jobDate(a)?.getTime() ?? 0;
          const db = jobDate(b)?.getTime() ?? 0;
          r = da - db;
          break;
        }
        case 'title':
          r = (a.title || '').localeCompare(b.title || '');
          break;
        case 'company':
          r = (a.companyName || '').localeCompare(b.companyName || '');
          break;
        case 'location':
          r = jLocation(a).localeCompare(jLocation(b));
          break;
        case 'salary':
          r = salarySortValue(a.compensation) - salarySortValue(b.compensation);
          break;
      }
      return r * sort.dir;
    });
    return arr;
  }, [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const rows = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  function header(field: SortField, label: string, cls = '') {
    const active = sort.field === field;
    return (
      <th className={`px-2 py-2 text-left font-semibold ${cls}`}>
        <button
          className="inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400"
          onClick={() => setSort(active ? { field, dir: (sort.dir * -1) as 1 | -1 } : { field, dir: field === 'posted' || field === 'salary' ? -1 : 1 })}
        >
          {label}
          <span className={`text-[10px] ${active ? 'opacity-100' : 'opacity-25'}`}>{active && sort.dir === 1 ? '▲' : '▼'}</span>
        </button>
      </th>
    );
  }

  if (jobs.length === 0) {
    return <EmptyState title="No jobs yet" hint="Run a search above. Results appear here as they stream in." />;
  }

  return (
    <div className="space-y-2">
      {/* counts + local filters */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          {sorted.length === jobs.length ? `${jobs.length} jobs` : `${sorted.length} of ${jobs.length} jobs`}
          {totalBeforeFilter > jobs.length && <span className="text-slate-400"> ({totalBeforeFilter} raw before dedup)</span>}
        </span>
        {blockedSources.length > 0 && (
          <span className="text-xs text-slate-500">
            {blockedSources.length} source{blockedSources.length > 1 ? 's' : ''} failed/blocked:
            {blockedSources.slice(0, 4).map((b) => (
              <span key={b.site} className="ml-1">
                <Badge tone={reasonTone(b.reason)}>{b.site}</Badge>
              </span>
            ))}
            {blockedSources.length > 4 && <span> +{blockedSources.length - 4} more</span>}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={filters.text}
          onChange={(e) => onFilters({ ...filters, text: e.target.value })}
          placeholder={filters.titleOnly ? 'Title keywords (all words)…' : 'Keywords: title, company, location (all words)…'}
          aria-label="Filter results by keywords"
          className="w-64 rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-800"
        />
        <label className="flex items-center gap-1.5 text-xs text-slate-500" title="Match the keywords against the job title only">
          <input type="checkbox" className="accent-blue-600" aria-label="Match keywords in job title only" checked={filters.titleOnly} onChange={(e) => onFilters({ ...filters, titleOnly: e.target.checked })} />
          Title only
        </label>
        <select value={filters.source} onChange={(e) => onFilters({ ...filters, source: e.target.value })} aria-label="Filter results by source" className="rounded border border-slate-300 bg-white px-1.5 py-1 dark:border-slate-600 dark:bg-slate-800">
          <option value="">All sources ({sourceCounts.size})</option>
          {[...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => (
            <option key={s} value={s}>{s} ({n})</option>
          ))}
        </select>
        <input
          value={filters.company}
          onChange={(e) => onFilters({ ...filters, company: e.target.value })}
          placeholder="Company contains…"
          aria-label="Filter results by company"
          className="w-36 rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-800"
        />
        <input
          value={filters.locationText}
          onChange={(e) => onFilters({ ...filters, locationText: e.target.value })}
          placeholder="Location contains…"
          aria-label="Filter results by location"
          className="w-36 rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-800"
        />
        <select value={filters.remote} onChange={(e) => onFilters({ ...filters, remote: e.target.value as TableFilters['remote'] })} aria-label="Filter results by remote status" className="rounded border border-slate-300 bg-white px-1.5 py-1 dark:border-slate-600 dark:bg-slate-800">
          <option value="any">Remote: any</option>
          <option value="only">Remote only</option>
          <option value="exclude">Exclude remote</option>
        </select>
        <select value={filters.status} onChange={(e) => onFilters({ ...filters, status: e.target.value as TableFilters['status'] })} aria-label="Filter results by reviewed status" className="rounded border border-slate-300 bg-white px-1.5 py-1 dark:border-slate-600 dark:bg-slate-800">
          <option value="all">Status: all</option>
          <option value="new">New only</option>
          <option value="reviewed">Reviewed only</option>
          <option value="not_interested">Not interested only</option>
          <option value="exclude_reviewed">Exclude reviewed/not-interested</option>
        </select>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="No jobs match the current filters" hint="Adjust or clear the filters above. The underlying search results are still loaded — filtering here does not re-query sources." />
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="w-8 px-2 py-2" title="Favorite">★</th>
                <th className="w-24 px-2 py-2 text-left font-semibold">Status</th>
                {header('title', 'Job title')}
                {header('company', 'Company')}
                {header('location', 'Location')}
                <th className="w-20 px-2 py-2 text-left font-semibold">Remote</th>
                {header('posted', 'Posted')}
                {header('salary', 'Salary')}
                <th className="px-2 py-2 text-left font-semibold">Source</th>
                <th className="w-16 px-2 py-2 text-left font-semibold">Apply</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((job) => {
                const key = jobKey(job);
                const st = statusOf(job);
                const apply = jobApplyUrl(job);
                const salary = formatSalary(job.compensation);
                return (
                  <tr
                    key={key}
                    className={`cursor-pointer border-t border-slate-100 hover:bg-blue-50/60 dark:border-slate-800 dark:hover:bg-slate-800/60 ${
                      st === 'not_interested' ? 'opacity-50' : ''
                    }`}
                    onClick={() => onOpenJob(job)}
                  >
                    <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        title={favoriteKeys.has(key) ? 'Remove favorite' : 'Mark favorite'}
                        onClick={() => onToggleFavorite(job)}
                        className={favoriteKeys.has(key) ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400 dark:text-slate-600'}
                      >
                        {favoriteKeys.has(key) ? '★' : '☆'}
                      </button>
                    </td>
                    <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={st}
                        onChange={(e) => onReviewed(job, e.target.value as ReviewedStatus)}
                        className={`w-full rounded border px-1 py-0.5 text-xs ${
                          st === 'reviewed'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : st === 'not_interested'
                              ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
                              : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800'
                        }`}
                      >
                        <option value="new">New</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="not_interested">Not interested</option>
                      </select>
                    </td>
                    <td className="max-w-[260px] px-2 py-1.5">
                      <div className="truncate font-medium text-slate-900 dark:text-slate-100" title={job.title}>{job.title || '(untitled)'}</div>
                    </td>
                    <td className="max-w-[160px] px-2 py-1.5"><div className="truncate" title={job.companyName}>{job.companyName || '—'}</div></td>
                    <td className="max-w-[180px] px-2 py-1.5"><div className="truncate" title={jLocation(job)}>{jLocation(job) || '—'}</div></td>
                    <td className="px-2 py-1.5">{job.isRemote ? <Badge tone="violet">Remote</Badge> : <span className="text-xs text-slate-400">—</span>}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-500">{formatDate(job)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{salary || <span className="text-slate-400">—</span>}</td>
                    <td className="px-2 py-1.5 text-xs">{job.site ? prettySource(job.site) : '—'}</td>
                    <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      {apply ? (
                        <a
                          href={apply}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                        >
                          Apply ↗
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* pagination */}
      {sorted.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-1">
            <button disabled={safePage === 0} onClick={() => setPage(0)} className="pager-btn">«</button>
            <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="pager-btn">‹</button>
            <span className="px-2 text-xs text-slate-500">Page {safePage + 1} / {pageCount}</span>
            <button disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} className="pager-btn">›</button>
            <button disabled={safePage >= pageCount - 1} onClick={() => setPage(pageCount - 1)} className="pager-btn">»</button>
          </div>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Rows
            <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} className="rounded border border-slate-300 bg-white px-1 py-0.5 dark:border-slate-600 dark:bg-slate-800">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className="text-xs text-slate-400">Sorting and filtering happen locally — no re-query.</span>
        </div>
      )}
    </div>
  );
}

function jLocation(job: Job): string {
  const l = job.location;
  if (l) return [l.city, l.state, l.country].filter(Boolean).join(', ');
  const first = job.locations?.[0];
  return first ? [first.city, first.state, first.country].filter(Boolean).join(', ') : '';
}
