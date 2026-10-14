# Review & Fix Log

## Verification round (2026-10-13)

End-to-end through the proxy on :3002: streaming search (15 jobs, one source
ok; indeed/zip_recruiter/glassdoor/google correctly reported blocked),
settings save → file → immediate effect, failed save keeps old config,
candidate tests don't pollute the active status, CSRF 403, public-IP targets
blocked, SPA fallback, persistence across `systemctl restart`,
favorites/reviewed/saved-search flows, dark mode.

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
