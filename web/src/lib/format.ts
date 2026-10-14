import type { FavoriteJob, Job, JobCompensation, JobLocation } from './types';

/** Stable identity for favorites/reviewed: prefer the API's dedupKey. */
export function jobKey(job: Job): string {
  return job.dedupKey || job.id;
}

export function formatLocation(loc?: JobLocation | null): string {
  if (!loc) return '';
  return [loc.city, loc.state, loc.country].filter(Boolean).join(', ');
}

export function jobLocation(job: Job): string {
  const main = formatLocation(job.location);
  if (main) return main;
  if (job.locations?.length) return formatLocation(job.locations[0]);
  return '';
}

const INTERVAL_LABEL: Record<string, string> = {
  yearly: 'yr',
  annual: 'yr',
  monthly: 'mo',
  weekly: 'wk',
  hourly: 'hr',
  daily: 'day',
};

export function formatSalary(c?: JobCompensation | null): string {
  if (!c) return '';
  const hasMin = typeof c.minAmount === 'number' && c.minAmount > 0;
  const hasMax = typeof c.maxAmount === 'number' && c.maxAmount > 0;
  if (!hasMin && !hasMax) return '';
  const unit = INTERVAL_LABEL[c.interval ?? ''] ?? c.interval ?? '';
  const fmt = (n: number) => {
    if (c.interval === 'hourly' || c.interval === 'daily') return `$${Math.round(n)}`;
    if (n >= 1000) return `$${Math.round(n / 1000)}k`;
    return `$${Math.round(n)}`;
  };
  const range = hasMin && hasMax && c.minAmount !== c.maxAmount
    ? `${fmt(c.minAmount!)}–${fmt(c.maxAmount!)}`
    : fmt((hasMin ? c.minAmount : c.maxAmount) as number);
  const currency = c.currency && c.currency !== 'USD' ? ` ${c.currency}` : '';
  return `${range}${unit ? `/${unit}` : ''}${currency}`;
}

export function salarySortValue(c?: JobCompensation | null): number {
  if (!c) return 0;
  const mid = ((c.minAmount ?? 0) + (c.maxAmount ?? 0)) / 2 || c.minAmount || c.maxAmount || 0;
  const mult =
    c.interval === 'hourly' ? 2080 :
    c.interval === 'daily' ? 260 :
    c.interval === 'weekly' ? 52 :
    c.interval === 'monthly' ? 12 : 1;
  return mid * mult;
}

export function jobDate(job: Job): Date | null {
  const raw = job.datePostedAt || job.datePosted;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(job: Job): string {
  const d = jobDate(job);
  if (!d) return '—';
  const now = Date.now();
  const days = Math.floor((now - d.getTime()) / 86_400_000);
  const dateStr = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return dateStr;
}

export function jobApplyUrl(job: Job): string {
  return job.applyUrl || job.jobUrlDirect || job.jobUrl || '';
}

/** Trimmed snapshot persisted for favorites / reviewed tracking. */
export function snapshotJob(job: Job): FavoriteJob {
  return {
    key: jobKey(job),
    title: job.title || '(untitled)',
    companyName: job.companyName || '',
    location: jobLocation(job),
    site: job.site || '',
    jobUrl: job.jobUrl || '',
    applyUrl: jobApplyUrl(job),
    datePosted: job.datePosted || '',
    isRemote: job.isRemote ?? null,
    compensation: job.compensation ?? null,
    savedAt: new Date().toISOString(),
  };
}

export function prettySource(value: string): string {
  return value
    .split(/[_-]/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
