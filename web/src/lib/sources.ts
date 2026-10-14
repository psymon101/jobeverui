// Source classification.
//
// The live catalogue (GraphQL listSources, ~1 950 tokens) is the source of
// truth for WHICH sources exist. The API exposes no category metadata, so —
// as permitted by the spec — this small curated map only LABELS them.
// Unknown tokens fall into "other" (the long tail is mostly company career
// site tokens registered in the API's company-domain registry).

export type SourceCategory = 'major' | 'remote' | 'ats' | 'company' | 'other';

export const CATEGORY_LABELS: Record<SourceCategory, string> = {
  major: 'Major Job Boards',
  remote: 'Remote Job Boards',
  ats: 'ATS Platforms',
  company: 'Company Career Sites',
  other: 'Other Sources',
};

const MAJOR = new Set(['linkedin', 'indeed', 'zip_recruiter', 'glassdoor', 'google']);

const REMOTE = new Set([
  'remoteok', 'remotive', 'jobicy', 'himalayas', 'arbeitnow', 'weworkremotely',
  'workingnomads', 'fourdayweek', 'nodesk', 'remotefirstjobs', 'realworkfromanywhere',
  'virtualvocations',
]);

// ATS integrations scrape one company board and need `companySlug`.
const ATS = new Set([
  'greenhouse', 'lever', 'workday', 'ashby', 'smartrecruiters', 'jobvite', 'workable',
  'successfactors', 'taleo', 'icims', 'adp', 'ukg', 'rippling', 'recruitee', 'teamtailor',
  'bamboohr', 'personio', 'jazzhr', 'breezyhr', 'comeet', 'pinpoint', 'manatal', 'paylocity',
  'freshteam', 'bullhorn', 'trakstar', 'hiringthing', 'loxo', 'fountain', 'deel', 'phenom',
  'jobylon', 'homerun', 'jobscore', 'talentlyft', 'crelate', 'ismartrecruit', 'recruiterflow',
  'inhire', 'wellfound_ats', 'zohorecruit', 'eightfold',
]);

// Direct company career APIs (README "Company-Specific Scrapers").
const COMPANY = new Set([
  'amazon', 'apple', 'microsoft', 'nvidia', 'tiktok', 'uber', 'cursor', 'google_careers',
  'meta', 'netflix', 'stripe', 'openai', 'ibm', 'boeing', 'zoom',
]);

export function categorize(value: string): SourceCategory {
  if (MAJOR.has(value)) return 'major';
  if (REMOTE.has(value)) return 'remote';
  if (ATS.has(value)) return 'ats';
  if (COMPANY.has(value)) return 'company';
  return 'other';
}

/** ATS boards need a company slug; querying them without one returns nothing useful. */
export function requiresCompanySlug(value: string): boolean {
  return ATS.has(value);
}

export const PRESET_QUICK_SELECTS: { label: string; values: string[] }[] = [
  { label: 'Major job boards', values: ['linkedin', 'indeed', 'zip_recruiter', 'glassdoor', 'google'] },
  { label: 'Remote boards', values: [...REMOTE] },
];

// Human-readable reason labels for per_source diagnostics.
export const REASON_LABELS: Record<string, string> = {
  ok: 'Returned results',
  empty: 'No results',
  results_wanted: 'Truncated (more existed)',
  partial: 'Truncated (more existed)',
  blocked: 'Blocked (403/anti-bot)',
  fetch_error: 'Request failed',
  timeout: 'Timed out',
  bad_input: 'Bad input',
  circuit_open: 'Circuit open (recent failures)',
  browser_unavailable: 'Browser unavailable',
  skipped: 'Skipped',
  unknown: 'Unknown',
};

/**
 * Reasons that are NOT problems: the source worked but returned fewer jobs
 * than requested (the API flags truncation as `results_wanted` or `partial`).
 * A source with streamed jobs and one of these reasons is healthy.
 */
export const BENIGN_REASONS = new Set(['ok', 'empty', 'results_wanted', 'partial']);
