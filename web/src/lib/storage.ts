// localStorage persistence for saved searches, favorites, reviewed status,
// last-used search settings and theme. Data structures are versioned and
// shaped so scheduling can be added to saved searches later.

import type { FavoriteJob, ReviewedStatus, SavedSearch, SearchQuery } from './types';

const NS = 'ever-jobs-ui:v1:';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch (err) {
    console.warn('localStorage write failed:', err);
  }
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---- saved searches ----

export const savedSearches = {
  list: (): SavedSearch[] => load<SavedSearch[]>('savedSearches', []),
  set: (items: SavedSearch[]) => save('savedSearches', items),
  upsert(item: SavedSearch): SavedSearch[] {
    const items = savedSearches.list();
    const i = items.findIndex((s) => s.id === item.id);
    if (i >= 0) items[i] = item;
    else items.push(item);
    savedSearches.set(items);
    return items;
  },
  remove(id: string): SavedSearch[] {
    const items = savedSearches.list().filter((s) => s.id !== id);
    savedSearches.set(items);
    return items;
  },
};

// ---- last used search settings ----

export const lastQuery = {
  get: (): SearchQuery | null => load<SearchQuery | null>('lastQuery', null),
  set: (q: SearchQuery) => save('lastQuery', q),
};

// ---- favorites ----

export const favorites = {
  list: (): Record<string, FavoriteJob> => load('favorites', {}),
  set: (m: Record<string, FavoriteJob>) => save('favorites', m),
  toggle(job: FavoriteJob): Record<string, FavoriteJob> {
    const m = favorites.list();
    if (m[job.key]) delete m[job.key];
    else m[job.key] = job;
    favorites.set(m);
    return m;
  },
  remove(key: string): Record<string, FavoriteJob> {
    const m = favorites.list();
    delete m[key];
    favorites.set(m);
    return m;
  },
};

// ---- reviewed tracking ----
// Only 'reviewed' and 'not_interested' are stored; absence means 'new'.
// A trimmed job snapshot is kept so the Reviewed page can show the job even
// when it no longer appears in any search result.

export interface ReviewedEntry {
  status: Exclude<ReviewedStatus, 'new'>;
  updatedAt: string;
  job: FavoriteJob;
}

export const reviewed = {
  list: (): Record<string, ReviewedEntry> => load('reviewed', {}),
  set: (m: Record<string, ReviewedEntry>) => save('reviewed', m),
  setStatus(key: string, status: ReviewedStatus, job?: FavoriteJob): Record<string, ReviewedEntry> {
    const m = reviewed.list();
    if (status === 'new') {
      delete m[key];
    } else {
      m[key] = { status, updatedAt: new Date().toISOString(), job: job ?? m[key]?.job ?? emptySnapshot(key) };
    }
    reviewed.set(m);
    return m;
  },
  remove(key: string): Record<string, ReviewedEntry> {
    const m = reviewed.list();
    delete m[key];
    reviewed.set(m);
    return m;
  },
};

function emptySnapshot(key: string): FavoriteJob {
  return { key, title: '(job snapshot unavailable)', companyName: '', location: '', site: '', jobUrl: '', applyUrl: '', datePosted: '', isRemote: null, compensation: null, savedAt: '' };
}

// ---- theme ----

export const theme = {
  get: (): 'light' | 'dark' => {
    const stored = load<'light' | 'dark' | null>('theme', null);
    if (stored) return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },
  set: (t: 'light' | 'dark') => save('theme', t),
};

// ---- observed source outcomes (Sources page "last seen" column) ----

export interface ObservedSource {
  reason: string;
  detail?: string;
  count?: number;
  at: string;
}

export const observedSources = {
  list: (): Record<string, ObservedSource> => load('observedSources', {}),
  record(rows: { site: string; reason: string; detail?: string; count?: number }[]) {
    if (!rows.length) return;
    const m = observedSources.list();
    const at = new Date().toISOString();
    for (const r of rows) m[r.site] = { reason: r.reason, detail: r.detail, count: r.count, at };
    save('observedSources', m);
  },
};
