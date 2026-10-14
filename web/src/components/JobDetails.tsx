import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Job, ReviewedStatus } from '../lib/types';
import { formatSalary, formatDate, jobLocation, jobApplyUrl, prettySource } from '../lib/format';
import { Badge } from './ui';

// Descriptions arrive as Markdown (may embed raw HTML). Render Markdown →
// HTML, then sanitize with DOMPurify before injection. The server CSP also
// blocks scripts as defense in depth.
function renderDescription(md: string): string {
  const raw = marked.parse(md, { async: false, gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):)/i,
    FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'object', 'embed'],
    ADD_ATTR: ['target', 'rel'],
  });
}

export default function JobDetails({
  job,
  isFavorite,
  reviewedStatus,
  onToggleFavorite,
  onReviewed,
  onClose,
}: {
  job: Job;
  isFavorite: boolean;
  reviewedStatus: ReviewedStatus;
  onToggleFavorite: () => void;
  onReviewed: (s: ReviewedStatus) => void;
  onClose: () => void;
}) {
  const html = useMemo(() => (job.description ? renderDescription(job.description) : ''), [job.description]);
  const applyUrl = jobApplyUrl(job);
  const salary = formatSalary(job.compensation);
  const loc = jobLocation(job);
  const jobTypes = Array.isArray(job.jobType) ? job.jobType : job.jobType ? [job.jobType] : [];

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-bold leading-snug">{job.title || '(untitled job)'}</h3>
          <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{job.companyName || 'Unknown company'}</div>
        </div>
        <button onClick={onClose} aria-label="Close details" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800">
          ✕
        </button>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {job.isRemote ? <Badge tone="violet">Remote</Badge> : <Badge>Onsite/Hybrid</Badge>}
          {job.site && <Badge tone="blue">{prettySource(job.site)}</Badge>}
          {jobTypes.map((t) => <Badge key={t}>{t}</Badge>)}
          {salary && <Badge tone="green">{salary}</Badge>}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {loc && <><dt className="text-slate-500">Location</dt><dd>{loc}</dd></>}
          <dt className="text-slate-500">Posted</dt>
          <dd>{formatDate(job)}{job.datePosted ? ` (${job.datePosted})` : ''}</dd>
          {job.careerLevel?.level && job.careerLevel.level !== 'unknown' && (
            <><dt className="text-slate-500">Level</dt><dd className="capitalize">{job.careerLevel.level}</dd></>
          )}
          {job.skills && job.skills.length > 0 && (
            <><dt className="text-slate-500">Skills</dt><dd className="flex flex-wrap gap-1">{job.skills.slice(0, 15).map((s) => <Badge key={s}>{s}</Badge>)}</dd></>
          )}
          {job.compensation?.interval && !salary && <><dt className="text-slate-500">Pay interval</dt><dd>{job.compensation.interval}</dd></>}
          <dt className="text-slate-500">Source id</dt>
          <dd className="break-all font-mono text-xs text-slate-500">{job.id}</dd>
        </dl>

        <div className="mt-4 flex flex-wrap gap-2">
          {applyUrl && (
            <a
              href={applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-block rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:hover:bg-blue-500"
            >
              Apply on source site ↗
            </a>
          )}
          {job.jobUrl && job.jobUrl !== applyUrl && (
            <a
              href={job.jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-block rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              View original posting ↗
            </a>
          )}
        </div>

        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Status:</span>
            {(['new', 'reviewed', 'not_interested'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onReviewed(s)}
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  reviewedStatus === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {s === 'not_interested' ? 'Not interested' : s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
            <button
              onClick={onToggleFavorite}
              className={`ml-auto rounded px-2 py-0.5 text-xs font-medium ${
                isFavorite ? 'bg-amber-400 text-amber-950' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {isFavorite ? '★ Favorited' : '☆ Favorite'}
            </button>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Description</div>
          {html ? (
            <div className="jobdesc" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <div className="rounded bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-800/60">
              No description was returned for this posting by {prettySource(job.site || 'the source')}. Open the original posting for full
              details.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
