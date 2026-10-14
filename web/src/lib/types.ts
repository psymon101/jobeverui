// Types mirroring the actual Ever Jobs API responses (verified against the
// running instance: /api/jobs/search, /graphql listSources, /api/sources/health).

export interface ApiSettings {
  protocol: 'http' | 'https';
  host: string;
  port: number;
}

export interface ConnectionStatus {
  state: 'connected' | 'disconnected' | 'timeout' | 'invalid' | 'incompatible' | 'auth_required' | 'unknown';
  detail: string;
  latencyMs: number | null;
  checkedAt: string | null;
  apiVersion: string | null;
}

export interface SettingsSnapshot {
  settings: ApiSettings;
  baseUrl: string;
  source: 'file' | 'env' | 'default';
  savedAt: string | null;
  defaults: ApiSettings;
  status: ConnectionStatus;
}

export interface TestResult {
  ok: boolean;
  status: string;
  detail: string;
  latencyMs: number | null;
  apiVersion: string | null;
  tested?: string;
  error?: string;
}

export interface JobLocation {
  city?: string;
  state?: string;
  country?: string;
}

export interface JobCompensation {
  interval?: string;
  minAmount?: number;
  maxAmount?: number;
  currency?: string;
}

export interface Job {
  id: string;
  title?: string;
  companyName?: string;
  companyUrl?: string;
  companyLogo?: string | null;
  jobUrl?: string;
  jobUrlDirect?: string | null;
  applyUrl?: string | null;
  location?: JobLocation | null;
  locations?: JobLocation[];
  description?: string | null;
  compensation?: JobCompensation | null;
  datePosted?: string | null;
  datePostedAt?: string | null;
  isRemote?: boolean | null;
  jobType?: string[] | string | null;
  emails?: string[] | null;
  site?: string;
  skills?: string[] | null;
  salarySource?: string | null;
  dedupKey?: string;
  careerLevel?: { level?: string; confidence?: string } | null;
}

export interface PerSourceRow {
  site: string;
  count?: number;
  reason: string; // ok | empty | blocked | fetch_error | timeout | bad_input | circuit_open | browser_unavailable | unknown
  detail?: string;
}

export interface PerSourceSummary {
  total: number;
  actionable: number;
  returned: number;
  truncated: number;
  by_reason: Record<string, number>;
}

export interface NdjsonEnd {
  type: 'end';
  total: number;
  deduped: boolean;
  durationMs: number;
  complete: boolean;
  stopReason: string | null;
  sourcesSkipped?: number;
  sourcesFailed?: number;
  sourcesPartial?: number;
  problemSources?: { site: string; reason: string }[];
  problemSourcesTotal?: number;
}

export interface NdjsonProgress {
  type: 'progress';
  sourcesDone: number;
  sourcesTotal: number;
  jobs: number;
}

export interface SourceInfo {
  name: string;
  value: string;
}

export interface SourceHealth {
  site: string;
  state: string; // closed | open | half_open
  successRate: number;
  p95LatencyMs: number;
  windowMs: number;
}

// ---- frontend domain types ----

export type ReviewedStatus = 'new' | 'reviewed' | 'not_interested';

export interface SearchQuery {
  /** One entry per search term; >1 entry means separate searches merged client-side. */
  terms: string[];
  location: string;
  distance: number | null;
  isRemote: boolean;
  jobType: string; // '' = any
  hoursOld: number | null; // null = any time
  resultsWanted: number;
  country: string; // '' = default (USA)
  sources: string[]; // siteType values
  easyApply: boolean;
  companySlug: string; // for ATS sources
  companyUrl: string; // custom career portal
  excludeTitleTerms: string[];
  excludeKeywords: string[];
}

export interface SavedSearch {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  query: SearchQuery;
}

export interface FavoriteJob {
  key: string;
  title: string;
  companyName: string;
  location: string;
  site: string;
  jobUrl: string;
  applyUrl: string;
  datePosted: string;
  isRemote: boolean | null;
  compensation: JobCompensation | null;
  savedAt: string;
}

export const DEFAULT_QUERY: SearchQuery = {
  terms: [''],
  location: '',
  distance: null,
  isRemote: false,
  jobType: '',
  hoursOld: null,
  resultsWanted: 15,
  country: '',
  sources: ['linkedin', 'indeed', 'zip_recruiter', 'glassdoor', 'google'],
  easyApply: false,
  companySlug: '',
  companyUrl: '',
  excludeTitleTerms: [],
  excludeKeywords: [],
};
