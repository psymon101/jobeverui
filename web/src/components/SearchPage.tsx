import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Job, NdjsonEnd, NdjsonProgress, PerSourceRow, SearchQuery, SourceInfo } from '../lib/types';
import { DEFAULT_QUERY } from '../lib/types';
import { jobKey, snapshotJob } from '../lib/format';
import { lastQuery, observedSources, savedSearches, favorites as favApi, reviewed as revApi, type ReviewedEntry } from '../lib/storage';
import { BENIGN_REASONS, requiresCompanySlug } from '../lib/sources';
import SourcePicker from './SourcePicker';
import ResultsTable, { DEFAULT_FILTERS, type TableFilters } from './ResultsTable';
import DiagnosticsPanel, { type SearchStats } from './DiagnosticsPanel';
import JobDetails from './JobDetails';
import { Button, Field, Spinner, inputCls } from './ui';

const JOB_TYPES = ['fulltime', 'parttime', 'contract', 'temporary', 'internship', 'perdiem', 'nights', 'other', 'summer', 'volunteer', 'permanent', 'apprenticeship'];
const POSTED_OPTIONS: { label: string; hours: number | null }[] = [
  { label: 'Any time', hours: null },
  { label: 'Last 24 hours', hours: 24 },
  { label: 'Last 3 days', hours: 72 },
  { label: 'Last 7 days', hours: 168 },
  { label: 'Last 14 days', hours: 336 },
  { label: 'Last 30 days', hours: 720 },
];
const COUNTRIES = ['', 'USA', 'US_CANADA', 'WORLDWIDE', 'UK', 'CANADA', 'GERMANY', 'FRANCE', 'INDIA', 'AUSTRALIA', 'BRAZIL', 'SPAIN', 'ITALY', 'NETHERLANDS', 'POLAND', 'SWEDEN', 'SWITZERLAND', 'SINGAPORE', 'JAPAN', 'CHINA', 'MEXICO', 'ARGENTINA'];

export default function SearchPage({
  initialQuery,
  autoRun,
  sources,
  sourcesLoading,
  sourcesError,
  onReloadSources,
  favoritesMap,
  reviewedMap,
  onDataChanged,
  onOpenTab,
}: {
  initialQuery?: SearchQuery;
  autoRun?: boolean;
  sources: SourceInfo[];
  sourcesLoading: boolean;
  sourcesError: string | null;
  onReloadSources: () => void;
  favoritesMap: Record<string, unknown>;
  reviewedMap: Record<string, ReviewedEntry>;
  onDataChanged: () => void;
  onOpenTab: (tab: string) => void;
}) {
  const [query, setQuery] = useState<SearchQuery>(() => initialQuery ?? lastQuery.get() ?? DEFAULT_QUERY);
  const [showSources, setShowSources] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [termsText, setTermsText] = useState(() => (initialQuery ?? lastQuery.get() ?? DEFAULT_QUERY).terms.join('\n'));

  const [jobs, setJobs] = useState<Job[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [progress, setProgress] = useState<NdjsonProgress | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stats, setStats] = useState<SearchStats | null>(null);
  const [filters, setFilters] = useState<TableFilters>(DEFAULT_FILTERS);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [ranOnce, setRanOnce] = useState(false);
  const [saveNameOpen, setSaveNameOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const seenKeys = useRef<Set<string>>(new Set());

  useEffect(() => () => abortRef.current?.abort(), []);

  // While the details drawer is open, reserve its width (max-w-xl = 36rem) on
  // wide screens so it sits beside the page instead of covering the results
  // table and header controls. On narrow screens it stays a full-width sheet.
  useEffect(() => {
    document.body.classList.toggle('job-drawer-open', !!openJob);
    return () => document.body.classList.remove('job-drawer-open');
  }, [openJob]);

  const terms = useMemo(() => termsText.split('\n').map((t) => t.trim()).filter(Boolean), [termsText]);
  const multiTerm = terms.length > 1;

  const effectiveQuery = useMemo<SearchQuery>(() => ({ ...query, terms: terms.length ? terms : [''] }), [query, terms]);

  // ATS sources without a company slug are skipped (querying them blindly is pointless).
  const atsSkipped = useMemo(
    () => (query.companySlug.trim() ? [] : query.sources.filter(requiresCompanySlug)),
    [query.sources, query.companySlug],
  );

  async function runSearch() {
    if (searching) return; // prevent duplicate submissions
    if (query.sources.length === 0) {
      setSearchError('Select at least one job source before searching.');
      return;
    }
    const siteTypes = query.sources.filter((s) => !atsSkipped.includes(s));
    if (siteTypes.length === 0) {
      setSearchError('Only ATS sources are selected and no company slug is set — pick a regular job board or provide a company slug (Advanced).');
      return;
    }

    setSearching(true);
    setSearchError(null);
    setJobs([]);
    setStats(null);
    setProgress(null);
    setElapsedMs(0);
    setRanOnce(true);
    seenKeys.current = new Set();
    const controller = new AbortController();
    abortRef.current = controller;
    const started = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - started), 250);

    const q = effectiveQuery;
    const searchTerms = q.terms[0] === '' ? [''] : q.terms;
    const collected: Job[] = [];
    const jobsBySite = new Map<string, number>();
    // reason priority: hard failures beat truncation notes (results_wanted / partial)
    const REASON_PRIORITY = ['blocked', 'fetch_error', 'timeout', 'circuit_open', 'browser_unavailable', 'bad_input', 'skipped', 'unknown', 'results_wanted', 'partial'];
    const problemMap = new Map<string, { reason: string; detail: string }>();
    const recordProblem = (site: string, reason: string, detail: string) => {
      const prev = problemMap.get(site);
      if (!prev || REASON_PRIORITY.indexOf(reason) < REASON_PRIORITY.indexOf(prev.reason)) {
        problemMap.set(site, { reason, detail });
      }
    };
    let endInfo: NdjsonEnd | undefined;
    let rawCount = 0;
    let partial = false;
    let partialReason = '';
    let problemsTruncated = false;

    try {
      for (let i = 0; i < searchTerms.length; i++) {
        if (controller.signal.aborted) break;
        const term = searchTerms[i];
        const body: Record<string, unknown> = {
          siteType: siteTypes,
          resultsWanted: q.resultsWanted,
          descriptionFormat: 'markdown',
        };
        if (term) body.searchTerm = term;
        if (q.location.trim()) body.location = q.location.trim();
        if (q.distance) body.distance = q.distance;
        if (q.isRemote) body.isRemote = true;
        if (q.jobType) body.jobType = q.jobType;
        if (q.hoursOld) body.hoursOld = q.hoursOld;
        if (q.country) body.country = q.country;
        if (q.easyApply) body.easyApply = true;
        if (q.companySlug.trim()) body.companySlug = q.companySlug.trim();
        if (q.companyUrl.trim()) body.companyUrl = q.companyUrl.trim();
        if (q.excludeTitleTerms.length) body.excludeTitleTerms = q.excludeTitleTerms;
        if (q.excludeKeywords.length) body.excludeKeywords = q.excludeKeywords;

        await api.searchStream(
          body,
          {
            onProgress: (p) => {
              setProgress({
                type: 'progress',
                sourcesTotal: p.sourcesTotal * searchTerms.length,
                sourcesDone: p.sourcesDone + i * p.sourcesTotal,
                jobs: p.jobs + collected.length,
              });
            },
            onJob: (job) => {
              rawCount++;
              if (job.site) jobsBySite.set(job.site, (jobsBySite.get(job.site) ?? 0) + 1);
              const key = jobKey(job);
              if (seenKeys.current.has(key)) return; // merge across term-searches by dedupKey
              seenKeys.current.add(key);
              collected.push(job);
              setJobs([...collected]);
            },
            onEnd: (end) => {
              // merge end events across term searches
              endInfo = endInfo
                ? {
                    ...end,
                    total: endInfo.total + end.total,
                    complete: endInfo.complete && end.complete,
                    durationMs: endInfo.durationMs + end.durationMs,
                    sourcesSkipped: (endInfo.sourcesSkipped ?? 0) + (end.sourcesSkipped ?? 0),
                    sourcesFailed: (endInfo.sourcesFailed ?? 0) + (end.sourcesFailed ?? 0),
                    sourcesPartial: (endInfo.sourcesPartial ?? 0) + (end.sourcesPartial ?? 0),
                    problemSources: [...(endInfo.problemSources ?? []), ...(end.problemSources ?? [])],
                    problemSourcesTotal: (endInfo.problemSourcesTotal ?? 0) + (end.problemSourcesTotal ?? 0),
                  }
                : { ...end };
              if (!end.complete) {
                partial = true;
                partialReason =
                  end.stopReason === 'deadline'
                    ? 'the API search deadline was reached'
                    : end.stopReason === 'job_ceiling'
                      ? 'the per-search job ceiling was reached'
                      : 'the search did not complete';
              }
              if (end.problemSources?.length) {
                for (const p of end.problemSources) recordProblem(p.site, p.reason, `reported by API at stream end (${p.reason})`);
              }
              if ((end.problemSourcesTotal ?? 0) > (end.problemSources?.length ?? 0)) problemsTruncated = true;
            },
          },
          controller.signal,
        );
      }

      // Derive the full per-source picture from stream facts (no re-query):
      // queried set = siteTypes; problems from end.problemSources;
      // "returned results" from streamed job counts; the rest are empty.
      const rows: PerSourceRow[] = siteTypes.map((site) => {
        const count = jobsBySite.get(site) ?? 0;
        const problem = problemMap.get(site);
        if (problem && !BENIGN_REASONS.has(problem.reason)) {
          return { site, count, reason: problem.reason, detail: problem.detail };
        }
        if (problem) {
          // results_wanted / partial: the source worked, it just had more
          // results than we asked for — a truncation note, not a failure.
          return { site, count, reason: 'ok', detail: `more results existed; truncated at ${q.resultsWanted} per source` };
        }
        return { site, count, reason: count > 0 ? 'ok' : 'empty' };
      });
      if (problemsTruncated) {
        rows.push({ site: '(more)', reason: 'unknown', detail: 'the API truncated its problem-source list; assume additional sources may have issues' });
      }
      const byReason: Record<string, number> = {};
      for (const r of rows) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;

      observedSources.record(rows.filter((r) => r.reason !== 'ok' || r.count));
      setStats({
        rawCount,
        dedupedCount: collected.length,
        durationMs: Date.now() - started,
        end: endInfo,
        perSource: rows,
        summary: {
          // rows are per unique source; requests counts the API searches
          // (one per term) that fed them.
          total: rows.length,
          actionable: rows.filter((r) => r.reason !== 'ok' && r.reason !== 'empty').length,
          returned: rows.length,
          truncated: problemsTruncated ? 1 : 0,
          by_reason: byReason,
        },
        requests: searchTerms.length,
        partial,
        partialReason: partialReason || undefined,
      });
      lastQuery.set(q);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setSearchError('Search cancelled.');
      } else {
        setSearchError(String((err as Error).message || err));
      }
      if (collected.length) {
        setStats({ rawCount, dedupedCount: collected.length, durationMs: Date.now() - started, partial: true, partialReason: 'the search stopped with an error' });
      }
    } finally {
      clearInterval(timer);
      setSearching(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  function cancelSearch() {
    abortRef.current?.abort();
  }

  // Auto-run when handed a saved search with "Run now".
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (autoRun && !autoRanRef.current) {
      autoRanRef.current = true;
      void runSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearForm() {
    setQuery(DEFAULT_QUERY);
    setTermsText(DEFAULT_QUERY.terms.join('\n'));
    setJobs([]);
    setStats(null);
    setSearchError(null);
    setFilters(DEFAULT_FILTERS);
    setRanOnce(false);
    lastQuery.set(DEFAULT_QUERY);
  }

  // Inline save dialog (window.prompt is unreliable in embedded webviews).
  function openSaveDialog() {
    setSaveName(terms.join(' + ') || 'Browse all');
    setSavedFlash(null);
    setSaveNameOpen(true);
  }

  function commitSaveSearch() {
    const name = saveName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    savedSearches.upsert({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, createdAt: now, updatedAt: now, query: effectiveQuery });
    setSaveNameOpen(false);
    setSavedFlash(`Saved "${name}" — see Saved Searches.`);
    window.setTimeout(() => setSavedFlash(null), 5000);
  }

  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) if (j.site) m.set(j.site, (m.get(j.site) ?? 0) + 1);
    return m;
  }, [jobs]);

  const blockedSources = useMemo(() => (stats?.perSource ?? []).filter((r) => r.reason !== 'ok' && r.reason !== 'empty').map((r) => ({ site: r.site, reason: r.reason })), [stats]);

  const favoriteKeys = useMemo(() => new Set(Object.keys(favoritesMap)), [favoritesMap]);

  function toggleFavorite(job: Job) {
    favApi.toggle(snapshotJob(job));
    onDataChanged();
  }

  function setReviewed(job: Job, status: 'new' | 'reviewed' | 'not_interested') {
    revApi.setStatus(jobKey(job), status, snapshotJob(job));
    onDataChanged();
  }

  return (
    <div className="space-y-4 p-4">
      {/* Search form */}
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.2fr_auto_auto]">
          <Field label="Keywords (one term per line = separate merged searches)">
            <textarea
              rows={2}
              className={`${inputCls} resize-y`}
              placeholder={'react engineer\nfrontend developer'}
              aria-label="Search keywords, one term per line"
              value={termsText}
              onChange={(e) => setTermsText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runSearch(); }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location">
              <input className={inputCls} placeholder="City, state or region" aria-label="Job location" value={query.location} onChange={(e) => setQuery({ ...query, location: e.target.value })} />
            </Field>
            <Field label="Distance (miles)">
              <input
                className={inputCls}
                type="number"
                min={5}
                max={500}
                placeholder="50"
                aria-label="Search radius in miles"
                disabled={!query.location}
                value={query.distance ?? ''}
                onChange={(e) => setQuery({ ...query, distance: e.target.value ? Number(e.target.value) : null })}
              />
            </Field>
          </div>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-blue-600" checked={query.isRemote} onChange={(e) => setQuery({ ...query, isRemote: e.target.checked })} />
              Remote only
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-blue-600" checked={query.easyApply} onChange={(e) => setQuery({ ...query, easyApply: e.target.checked })} />
              Easy apply
            </label>
          </div>
          <div className="flex flex-col items-stretch justify-end gap-2">
            <Button onClick={runSearch} disabled={searching}>
              <span className="inline-flex items-center gap-2">{searching && <Spinner className="h-3.5 w-3.5" />}{searching ? 'Searching…' : 'Search'}</span>
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={clearForm} disabled={searching}>Clear</Button>
              {saveNameOpen ? (
                <span className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitSaveSearch();
                      if (e.key === 'Escape') setSaveNameOpen(false);
                    }}
                    placeholder="Search name"
                    aria-label="Name for the saved search"
                    className={`w-40 rounded border px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 ${inputCls}`}
                  />
                  <Button onClick={commitSaveSearch} disabled={!saveName.trim()}>Save</Button>
                  <Button variant="secondary" onClick={() => setSaveNameOpen(false)}>Cancel</Button>
                </span>
              ) : (
                <Button variant="secondary" onClick={openSaveDialog} disabled={searching} title="Save current filters for reuse">Save search</Button>
              )}
              {savedFlash && <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{savedFlash}</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Posted within
            <select
              className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
              value={query.hoursOld ?? ''}
              onChange={(e) => setQuery({ ...query, hoursOld: e.target.value ? Number(e.target.value) : null })}
            >
              {POSTED_OPTIONS.map((o) => <option key={o.label} value={o.hours ?? ''}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Job type
            <select className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800" value={query.jobType} onChange={(e) => setQuery({ ...query, jobType: e.target.value })}>
              <option value="">Any</option>
              {JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Results per source
            <input
              type="number"
              min={1}
              max={250}
              className="w-16 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
              value={query.resultsWanted}
              onChange={(e) => setQuery({ ...query, resultsWanted: Math.max(1, Math.min(250, Number(e.target.value) || 15)) })}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Country
            <select className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-800" value={query.country} onChange={(e) => setQuery({ ...query, country: e.target.value })}>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c || 'Default (USA)'}</option>)}
            </select>
          </label>
          <button className="text-xs text-blue-600 hover:underline dark:text-blue-400" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? 'Hide advanced ▲' : 'Advanced ▼'}
          </button>
          <button className="ml-auto text-xs text-blue-600 hover:underline dark:text-blue-400" onClick={() => setShowSources(!showSources)}>
            {showSources ? 'Hide source selection ▲' : `Show source selection ▼ (${query.sources.length} selected)`}
          </button>
        </div>

        {showAdvanced && (
          <div className="grid grid-cols-1 gap-3 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800/50 md:grid-cols-3">
            <Field label="Company slug (ATS boards)">
              <input className={inputCls} placeholder="e.g. stripe (for Greenhouse/Lever/Ashby…)" value={query.companySlug} onChange={(e) => setQuery({ ...query, companySlug: e.target.value })} />
            </Field>
            <Field label="Company career URL">
              <input className={inputCls} placeholder="https://careers.example.com" value={query.companyUrl} onChange={(e) => setQuery({ ...query, companyUrl: e.target.value })} />
            </Field>
            <Field label="Exclude from title (comma-sep)">
              <input className={inputCls} placeholder="senior, staff" value={query.excludeTitleTerms.join(', ')} onChange={(e) => setQuery({ ...query, excludeTitleTerms: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
            </Field>
            <Field label="Exclude from title+description (comma-sep)" className="md:col-span-2">
              <input className={inputCls} placeholder="clearance, c2c" value={query.excludeKeywords.join(', ')} onChange={(e) => setQuery({ ...query, excludeKeywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
            </Field>
            <div className="text-xs text-slate-400 md:col-span-3">
              Sent to the API as-is: companySlug drives ATS board scrapers; companyUrl resolves custom career portals; exclusions are applied
              server-side.
            </div>
          </div>
        )}

        {multiTerm && (
          <div className="rounded bg-blue-50 p-2 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-200">
            <strong>{terms.length} search terms</strong> — the Ever Jobs API takes one search term per request, so this runs {terms.length} separate
            searches and merges the results, deduplicating by the API's dedupKey.
          </div>
        )}
        {atsSkipped.length > 0 && (
          <div className="rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {atsSkipped.length} ATS source{atsSkipped.length > 1 ? 's are' : ' is'} selected but skipped: {atsSkipped.slice(0, 6).join(', ')}
            {atsSkipped.length > 6 ? '…' : ''}. ATS boards need a <strong>Company slug</strong> (Advanced) to know which company to query.
          </div>
        )}
        {effectiveQuery.terms[0] === '' && (
          <div className="rounded bg-slate-100 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            No keywords — the search runs in <strong>browse (list) mode</strong>: sources return what they can list without a keyword.
          </div>
        )}
      </div>

      {/* Source selection */}
      {showSources && (
        <SourcePicker
          sources={sources}
          selected={query.sources}
          onChange={(next) => setQuery({ ...query, sources: next })}
          loading={sourcesLoading}
          error={sourcesError}
          onRetry={onReloadSources}
        />
      )}

      {/* Progress */}
      {searching && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm dark:border-blue-900 dark:bg-blue-950">
          <Spinner className="h-4 w-4 text-blue-600" />
          <span className="font-medium text-blue-800 dark:text-blue-200">
            Searching {query.sources.length - atsSkipped.length} source{query.sources.length - atsSkipped.length !== 1 ? 's' : ''}
            {multiTerm ? ` × ${terms.length} terms` : ''}…
          </span>
          {progress && progress.sourcesTotal > 0 && (
            <span className="text-blue-700 dark:text-blue-300">
              {progress.sourcesDone > 0
                ? `sources ${progress.sourcesDone}/${progress.sourcesTotal}`
                : `querying ${progress.sourcesTotal} source${progress.sourcesTotal !== 1 ? 's' : ''}`} · {progress.jobs} jobs so far
            </span>
          )}
          <span className="text-xs text-blue-500">{(elapsedMs / 1000).toFixed(1)}s</span>
          <button onClick={cancelSearch} className="ml-auto rounded border border-blue-300 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900">
            Cancel
          </button>
        </div>
      )}

      {searchError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {searchError}
        </div>
      )}

      {/* Diagnostics */}
      {stats && <DiagnosticsPanel stats={stats} />}

      {/* Results */}
      {jobs.length > 0 && (
        <ResultsTable
          jobs={jobs}
          totalBeforeFilter={stats?.rawCount ?? jobs.length}
          reviewedMap={reviewedMap}
          favoriteKeys={favoriteKeys}
          onOpenJob={setOpenJob}
          onToggleFavorite={toggleFavorite}
          onReviewed={setReviewed}
          filters={filters}
          onFilters={setFilters}
          sourceCounts={sourceCounts}
          blockedSources={blockedSources}
        />
      )}
      {!searching && !jobs.length && !ranOnce && (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
          <p className="font-medium text-slate-700 dark:text-slate-200">Search job sources without leaving this page.</p>
          <p className="mt-1">
            Pick sources on the left panel, enter keywords, and press <kbd className="rounded border border-slate-300 px-1 text-xs">Ctrl/⌘+Enter</kbd> in the keywords box.
            Nothing runs until you ask — <button className="text-blue-600 underline dark:text-blue-400" onClick={() => onOpenTab('saved')}>run a saved search</button> or{' '}
            <button className="text-blue-600 underline dark:text-blue-400" onClick={() => onOpenTab('sources')}>check source health</button>.
          </p>
        </div>
      )}

      {/* Details drawer */}
      {openJob && (
        <JobDetails
          job={openJob}
          isFavorite={favoriteKeys.has(jobKey(openJob))}
          reviewedStatus={reviewedMap[jobKey(openJob)]?.status ?? 'new'}
          onToggleFavorite={() => toggleFavorite(openJob)}
          onReviewed={(s) => setReviewed(openJob, s)}
          onClose={() => setOpenJob(null)}
        />
      )}
    </div>
  );
}
