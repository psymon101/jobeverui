import { useMemo, useState } from 'react';
import type { FavoriteJob } from '../lib/types';
import { favorites as favApi, reviewed as revApi, type ReviewedEntry } from '../lib/storage';
import { formatSalary } from '../lib/format';
import { Badge, Button, EmptyState } from './ui';

type Row = { job: FavoriteJob; status?: ReviewedEntry['status']; updatedAt?: string };

// Anchor styled like the secondary Button (anchors must not nest buttons).
const linkCls =
  'inline-block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';

export default function JobSnapshotPage({
  kind,
  rows,
  onChanged,
}: {
  kind: 'favorites' | 'reviewed';
  rows: Row[];
  onChanged: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'reviewed' | 'not_interested'>('all');
  const [text, setText] = useState('');

  const filtered = useMemo(() => {
    let r = rows;
    if (kind === 'reviewed' && statusFilter !== 'all') r = r.filter((x) => x.status === statusFilter);
    const t = text.trim().toLowerCase();
    if (t) r = r.filter((x) => `${x.job.title} ${x.job.companyName} ${x.job.location}`.toLowerCase().includes(t));
    return [...r].sort((a, b) => (b.updatedAt || b.job.savedAt || '').localeCompare(a.updatedAt || a.job.savedAt || ''));
  }, [rows, statusFilter, text, kind]);

  if (!rows.length) {
    return (
      <EmptyState
        title={kind === 'favorites' ? 'No favorites yet' : 'No reviewed jobs yet'}
        hint={
          kind === 'favorites'
            ? 'Click the ☆ star in search results (or the job details panel) to favorite a job. Favorites keep title, company, location, source and application link, and persist across browser sessions.'
            : 'Mark jobs as Reviewed or Not Interested in search results. They are tracked here — never auto-deleted — and the status follows the same job (by dedupKey) into later searches.'
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter saved jobs by title, company, or location"
          className="w-56 rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
        />
        {kind === 'reviewed' && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          >
            <option value="all">All statuses</option>
            <option value="reviewed">Reviewed</option>
            <option value="not_interested">Not interested</option>
          </select>
        )}
        <span className="text-xs text-slate-400">{filtered.length} of {rows.length}</span>
      </div>

      <div className="scroll-thin overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Salary</th>
              {kind === 'reviewed' && <th className="px-3 py-2">Status</th>}
              <th className="px-3 py-2">{kind === 'favorites' ? 'Saved' : 'Updated'}</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.job.key} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-1.5">
                  <div className="font-medium">{row.job.title}</div>
                  {row.job.isRemote && <Badge tone="violet">Remote</Badge>}
                </td>
                <td className="px-3 py-1.5">{row.job.companyName || '—'}</td>
                <td className="px-3 py-1.5">{row.job.location || '—'}</td>
                <td className="px-3 py-1.5 text-xs">{row.job.site || '—'}</td>
                <td className="px-3 py-1.5 text-xs">{formatSalary(row.job.compensation) || '—'}</td>
                {kind === 'reviewed' && (
                  <td className="px-3 py-1.5">
                    {row.status === 'reviewed' ? <Badge tone="green">Reviewed</Badge> : <Badge tone="red">Not interested</Badge>}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-500">
                  {(() => {
                    const when = row.updatedAt || row.job.savedAt;
                    return when ? new Date(when).toLocaleDateString() : '—';
                  })()}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <div className="flex gap-1.5">
                    {row.job.applyUrl && (
                      <a href={row.job.applyUrl} target="_blank" rel="noopener noreferrer" className={linkCls}>
                        Apply ↗
                      </a>
                    )}
                    {row.job.jobUrl && row.job.jobUrl !== row.job.applyUrl && (
                      <a href={row.job.jobUrl} target="_blank" rel="noopener noreferrer" className={linkCls}>
                        Posting ↗
                      </a>
                    )}
                    <Button
                      variant="danger"
                      onClick={() => {
                        if (kind === 'favorites') favApi.remove(row.job.key);
                        else revApi.remove(row.job.key);
                        onChanged();
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
