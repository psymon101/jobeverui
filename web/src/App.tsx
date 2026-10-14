import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import type { FavoriteJob, SearchQuery, SourceInfo } from './lib/types';
import type { ReviewedEntry } from './lib/storage';
import { favorites as favApi, reviewed as revApi, theme as themeStore } from './lib/storage';
import SearchPage from './components/SearchPage';
import SavedSearchesPage from './components/SavedSearchesPage';
import JobSnapshotPage from './components/JobSnapshotPage';
import SourcesPage from './components/SourcesPage';
import SettingsPage from './components/SettingsPage';

type Tab = 'jobs' | 'saved' | 'favorites' | 'reviewed' | 'sources' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'jobs', label: 'Jobs' },
  { id: 'saved', label: 'Saved Searches' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'sources', label: 'Sources' },
  { id: 'settings', label: 'Settings' },
];

interface StatusInfo {
  baseUrl: string;
  state: string;
  detail: string;
  latencyMs: number | null;
}

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('ever-jobs-ui:v1:tab') as Tab) || 'jobs');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => themeStore.get());
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [favoritesMap, setFavoritesMap] = useState<Record<string, FavoriteJob>>(() => favApi.list());
  const [reviewedMap, setReviewedMap] = useState<Record<string, ReviewedEntry>>(() => revApi.list());

  // Source catalogue: loaded once per session (sessionStorage cache), never
  // auto-searching — this is just the registry for the picker.
  const [sources, setSources] = useState<SourceInfo[]>(() => {
    try {
      const raw = sessionStorage.getItem('ever-jobs-ui:sources');
      if (raw) {
        const parsed = JSON.parse(raw) as { at: number; sources: SourceInfo[] };
        if (Date.now() - parsed.at < 6 * 3600_000) return parsed.sources;
      }
    } catch { /* ignore */ }
    return [];
  });
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  // Query handed to SearchPage from Saved Searches (run / edit).
  const [pendingQuery, setPendingQuery] = useState<{ q: SearchQuery; run: boolean; token: number } | null>(null);

  const refreshData = useCallback(() => {
    setFavoritesMap(favApi.list());
    setReviewedMap(revApi.list());
  }, []);

  const refreshStatus = useCallback(() => {
    api
      .status()
      .then((s) => setStatus({ baseUrl: s.baseUrl, state: s.status.state, detail: s.status.detail, latencyMs: s.status.latencyMs }))
      .catch(() => setStatus(null));
  }, []);

  const loadSources = useCallback(() => {
    setSourcesLoading(true);
    setSourcesError(null);
    api
      .listSources()
      .then((list) => {
        setSources(list);
        try {
          sessionStorage.setItem('ever-jobs-ui:sources', JSON.stringify({ at: Date.now(), sources: list }));
        } catch { /* ignore */ }
      })
      .catch((e) => setSourcesError(String((e as Error).message || e)))
      .finally(() => setSourcesLoading(false));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    themeStore.set(theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('ever-jobs-ui:v1:tab', tab);
  }, [tab]);

  useEffect(() => {
    // On first load, run a real health check through the proxy so the status
    // dot reflects reality (not just the server's cached state after a restart),
    // then poll the cached status.
    api.proxyHealth().catch(() => undefined).finally(refreshStatus);
    const t = setInterval(refreshStatus, 60_000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  useEffect(() => {
    if (sources.length === 0 && !sourcesLoading && !sourcesError) loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dot =
    status?.state === 'connected' ? 'bg-emerald-500' :
    status?.state === 'unknown' ? 'bg-slate-400' :
    status?.state === 'timeout' || status?.state === 'auth_required' ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-sm font-bold text-white">EJ</span>
            <span className="text-lg font-bold tracking-tight">Ever Jobs</span>
          </div>

          <nav className="flex flex-wrap items-center gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
                  tab === t.id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700/70'
                }`}
              >
                {t.label}
                {t.id === 'favorites' && Object.keys(favoritesMap).length > 0 && (
                  <span className="ml-1 rounded bg-amber-400 px-1 text-[10px] font-bold text-amber-950">{Object.keys(favoritesMap).length}</span>
                )}
                {t.id === 'reviewed' && Object.keys(reviewedMap).length > 0 && (
                  <span className="ml-1 rounded bg-slate-500 px-1 text-[10px] font-bold text-white">{Object.keys(reviewedMap).length}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setTab('settings')}
              title={status ? `${status.baseUrl}\n${status.detail}` : 'API status unknown — open Settings'}
              className="flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
              API {status?.state === 'connected' ? 'connected' : status?.state === 'unknown' ? 'not tested' : status?.state ?? 'unknown'}
              {status?.latencyMs != null && status.state === 'connected' && <span className="text-slate-400">{status.latencyMs}ms</span>}
            </button>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title="Toggle dark / light mode"
              className="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1500px] flex-1">
        {tab === 'jobs' && (
          <SearchPage
            key={pendingQuery ? `q-${pendingQuery.token}` : 'q-default'}
            initialQuery={pendingQuery?.q}
            autoRun={pendingQuery?.run ?? false}
            sources={sources}
            sourcesLoading={sourcesLoading}
            sourcesError={sourcesError}
            onReloadSources={loadSources}
            favoritesMap={favoritesMap}
            reviewedMap={reviewedMap}
            onDataChanged={refreshData}
            onOpenTab={(t) => setTab(t as Tab)}
          />
        )}
        {tab === 'saved' && (
          <SavedSearchesPage
            onRun={(q) => { setPendingQuery({ q, run: true, token: Date.now() }); setTab('jobs'); }}
            onEdit={(q) => { setPendingQuery({ q, run: false, token: Date.now() }); setTab('jobs'); }}
          />
        )}
        {tab === 'favorites' && (
          <div className="space-y-4 p-6">
            <h2 className="text-xl font-bold">Favorites <span className="text-sm font-normal text-slate-400">({Object.keys(favoritesMap).length})</span></h2>
            <JobSnapshotPage
              kind="favorites"
              rows={Object.values(favoritesMap).map((job) => ({ job }))}
              onChanged={refreshData}
            />
          </div>
        )}
        {tab === 'reviewed' && (
          <div className="space-y-4 p-6">
            <h2 className="text-xl font-bold">Reviewed jobs <span className="text-sm font-normal text-slate-400">({Object.keys(reviewedMap).length})</span></h2>
            <JobSnapshotPage
              kind="reviewed"
              rows={Object.entries(reviewedMap).map(([key, e]) => ({ job: { ...e.job, key }, status: e.status, updatedAt: e.updatedAt }))}
              onChanged={refreshData}
            />
          </div>
        )}
        {tab === 'sources' && <SourcesPage sources={sources} loading={sourcesLoading} error={sourcesError} onRetry={loadSources} />}
        {tab === 'settings' && <SettingsPage onStatusChange={refreshStatus} />}
      </main>

      <footer className="border-t border-slate-200 px-4 py-2 text-center text-xs text-slate-400 dark:border-slate-800">
        Self-hosted Ever Jobs frontend{status ? ` · API: ${status.baseUrl}` : ''} · searches run only when you press Search
      </footer>
    </div>
  );
}
