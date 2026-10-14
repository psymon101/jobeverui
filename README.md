# Ever Jobs UI

A self-hosted web frontend for the [Ever Jobs](http://192.168.1.45:3001) job-search
API. React frontend + a zero-dependency Node proxy server on **port 3002**.

The browser never talks to the API directly — every request goes through the
server-side proxy, which holds the (hot-swappable) API connection settings and
enforces SSRF and CSRF protections.

## Layout

```
jobeverui/
├─ server/            Node ESM server (no dependencies)
│  ├─ src/index.js    HTTP server: static files, /api/* routes, proxy
│  ├─ src/settings.js persistent settings store (file > env > defaults)
│  ├─ src/proxy.js    API proxy: DNS revalidation, SSRF policy, streaming
│  ├─ src/validate.js target validation + trusted-LAN ranges
│  └─ data/settings.json  saved API connection (created by the Settings page)
├─ web/               Vite + React 19 + TypeScript + Tailwind v4 frontend
│  └─ src/            pages/components + lib (api, storage, sources, …)
└─ deploy/ever-jobs-ui.service  systemd unit
```

## Run

```bash
cd web && npm install && npm run build     # builds web/dist, served by the server
cd ../server && PORT=3002 node src/index.js
```

Open **http://192.168.1.73:3002** (this machine). Dev mode: `cd web && npm run dev`
(port 5174, proxies `/api` → 127.0.0.1:3002).

## Deploy (installed on this machine)

```bash
sudo cp deploy/ever-jobs-ui.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ever-jobs-ui
journalctl -u ever-jobs-ui -f
```

The service is enabled and running. After changing `web/`, rebuild
(`cd web && npm run build`) — no service restart needed for frontend changes;
the server reads `web/dist` per request.

## Settings — API connection

The Settings page configures **protocol / host / port** only (no URL paths).
Defaults: `http` `192.168.1.45` `3001`.

- **Test Connection** runs `/health` + a GraphQL `listSources` compatibility probe.
- **Save** tests first; a failed test returns 400 and **keeps the previously
  working configuration**.
- Saved settings persist in `server/data/settings.json` and survive restarts.
  Precedence: file → `EVER_JOBS_API_URL` env → built-in defaults.
- Changes take effect on the next proxied request — **no restart**.
- The header status dot reflects the *active* target only; testing a candidate
  never overwrites it.

## Security model

- Browser → same-origin `/api/*` only; the proxy forwards to the configured
  target after validating it.
- **SSRF guard:** targets must resolve to trusted LAN ranges or be listed in
  `ALLOWED_API_HOSTS`; DNS is revalidated per request; redirects are rejected;
  timeouts per route (search: 15 min).
- **CSRF:** state-changing requests need the `X-EverJobs-UI: 1` header and a
  same-origin `Origin`; no CORS headers are ever emitted.
- Static serving is jailed to `web/dist` (path traversal rejected); security
  headers + CSP on every response; job descriptions are DOMPurify-sanitized.

## Features

- **Search:** explicit source selection from the live catalogue (1 951 sources,
  categorized; ATS tokens flagged as needing a company slug and skipped unless
  one is given). NDJSON streaming with live progress, incremental results, and
  cancel. One keyword per line = separate merged searches.
- **Diagnostics:** per-source returned/empty/blocked/failed derived from stream
  facts (never re-queried). `results_wanted`/`partial` are truncation notes, not
  failures. Expandable panel + per-source table.
- **Results:** local sort/filter/pagination, dedup by `dedupKey`, details drawer
  with sanitized description, apply links.
- **Per-job state:** favorite, reviewed / not-interested — persisted in browser
  storage with job snapshots (Favorites & Reviewed pages work without the API).
- **Saved searches:** store the full query; run (auto-runs on the Jobs page) or
  load into the form.
- **Sources page:** live catalogue + API circuit-breaker state + what this
  browser observed; unobserved sources are never labeled healthy.
- Dark/light theme, no auto-search on load, settings/search state persisted.

## Verification (2026-10-13)

End-to-end through the proxy on :3002: streaming search (15 jobs, linkedin ok;
indeed/zip_recruiter/glassdoor/google correctly reported blocked), settings
save→file→immediate effect, failed save keeps old config, candidate tests don't
pollute the active status, CSRF 403, public-IP targets blocked, SPA fallback,
persistence across `systemctl restart`, favorites/reviewed/saved-search flows,
dark mode.

## Third-party review fixes (2026-10-14)

A second AI ran a deep review; all 14 findings were reproduced against the
live app, then fixed and re-verified:

1. **SSRF/DNS rejection returned HTTP 500** — `testTarget` now reports an
   untrusted or unresolvable candidate as a structured failed test
   (`status:"invalid"`), so `POST /api/settings/test` answers 200 with the
   reason and `PUT /api/settings` answers 400 "not saved". Journal stays clean.
2. **Circuit state `half-open` never matched** — the API emits hyphenated
   states; the Sources page now normalizes `-`→`_` before counting, toning,
   and labeling (header shows "4 half-open", badges render amber "half open").
3. **Multi-term diagnostics double-counted sources** — the summary now counts
   unique sources (breakdown sums to the queried total) and appends
   "(N searches)" when terms were merged.
4. **Details drawer covered the results table and header controls** — on
   viewports ≥ 1280px the app reserves the drawer's 36rem column
   (`body.job-drawer-open #root { padding-right: 36rem }`); narrow screens keep
   the full-width sheet.
5. **Cancelled search showed a misleading source breakdown** — the breakdown
   clause only renders when a real per-source summary exists; the empty
   " issues" badge became "stopped early".
6. **`port: true` passed validation** (`Number(true) === 1`) — ports must now
   be an integer or integer string.
7. **Proxy POST routes bypassed CSRF** — `/api/proxy/search` and
   `/api/proxy/graphql` now require the `X-EverJobs-UI` header like the
   settings routes (verified 403).
8. **Upstream 201 leaked through the proxy** — normalized to 200.
9. **Stuck "sources 0/N" progress counter** (upstream never advances it) —
   shows "querying N sources · M jobs so far" until a real advance arrives.
10. **`<a>` wrapped `<button>`** in Favorites/Reviewed actions and the details
    drawer — replaced with properly styled anchors.
11. **Epoch date fallback** (`new Date(0)` → "1/1/1970") on saved rows —
    missing timestamps now render "—".
12. **Unlabeled controls** — aria-labels added to every filter input, select,
    checkbox, the keywords textarea, location/distance fields, the source
    picker filter, and the save-search name input.
13. **Dead code** — removed the unused `api.searchJson` client method and the
    now-unreferenced `SearchResponse` type.
14. **Sources page "Last seen" could go stale** — observed-source data is now
    re-read on every circuit-state refresh instead of once at mount.

