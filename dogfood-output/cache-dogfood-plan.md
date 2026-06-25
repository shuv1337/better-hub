# Better Hub Cache Dogfood Plan

| Field | Value |
|-------|-------|
| Date | 2026-06-24 |
| Target URL | http://127.0.0.1:3000 |
| Session | better-hub-cache-dogfood |
| Account | shuv1337 (app already authenticated to this account by default) |
| Scope | Validate personal GitHub cache behavior on repo navigation and cache warming with real browser evidence and timing benchmarks |
| Output Directory | dogfood-output/ |
| Report Path | dogfood-output/cache-dogfood-report.md |
| Benchmark Data | dogfood-output/benchmarks/ |

## Goal

Validate that the personal GitHub cache improves real user navigation for repository pages and does not introduce stale, broken, or misleading UI states. The dogfood pass must produce benchmark evidence, screenshots, console/network evidence, and repro artifacts for any bugs found.

The cache under test is **server-side and per-user** (descriptor-backed, keyed by the authenticated user's id). Warming discovers and warms the authenticated user's **own** repositories via `discoverPersonalRepos`. Because the app is authenticated as **shuv1337**, the benchmark targets are shuv1337-owned repos, which the warm flow actually covers — so warm effects are attributable to the cache rather than to a foreign-repo path.

## Constraints

- Test as a user through the browser. Do not inspect the app source while dogfooding.
- Preserve all generated output. Do not delete prior dogfood files.
- Use `agent-browser` directly for browser evidence.
- Record benchmark inputs and raw outputs so results are reproducible.
- Separate measured cache behavior from unrelated local-dev noise such as missing Stripe or Better Auth API keys.

## Routing Facts (verified against codebase)

These are confirmed so execution does not waste time on wrong URLs:

- Repo pages are served from `/{owner}/{repo}` — `next.config.ts` rewrites bare `/:owner/:repo(/...)` to `/repos/:owner/:repo(/...)`. So `/shuv1337/tldraw` resolves to the repo overview. Both forms work; prefer the bare user-facing form.
- Sub-pages exist for: `code`, `issues`, `pulls`, `actions`, `activity`, `commits`, `releases`, `insights`, `discussions`, `security`, `settings`, `tags`, `tree`, `blob`.
- The cache debug surface is `/debug/github-cache`. It exposes: Quick warm / Full warm buttons, a Last Warm summary, Sync Jobs counts, and a **Repo Status inspector** (owner/repo form) that reports per-target cache class and freshness (`absent` / `present` / `stale` / `fresh`).
- All `(app)` routes (repo pages and the debug page) require an authenticated, onboarding-complete session. This is satisfied by default for shuv1337; see Step 0.

## Targets

Chosen from shuv1337-owned repos so the personal warm flow covers them:

| Role | Repo | Why |
|------|------|-----|
| Heavy / best signal | `shuv1337/tldraw` | Largest repo (~1.4 GB), large issue/PR/file surface — biggest expected cache payoff |
| Active mid-size | `shuv1337/better-hub` | The app's own repo, pushed today — realistic everyday navigation |
| Cold control | selected at runtime via the inspector | A target the inspector reports as `absent`/`stale` at Step 1, used for a genuine cold read |

Candidate cold-control repos (low recent activity, likely outside the warm set): `shuv1337/oak-spike`, `shuv1337/herdshuvr`, `shuv1337/executor`. The actual cold target is whichever the inspector confirms is uncached at Step 1 — do not assume.

## Cold vs Warm Methodology (cache state is verified, not assumed)

The cache is server-side, so opening a fresh browser context does **not** reset it, and there is **no UI control to evict/clear** the cache. Therefore cold and warm are defined by **observed server cache state via the debug Repo Status inspector**, not by browser session freshness:

- **Cold sample** = a target whose inspector shows its overview targets as `absent` (or `stale`) *before* the first measured visit. Measure the first load, then re-inspect to confirm the state transitioned toward `fresh`.
- **Warm sample** = the same target after it is confirmed `fresh` (either populated by the cold visit itself or by an explicit Full warm run). Re-measure.
- If every candidate already shows `fresh` at Step 1 (because a prior warm already ran), record that as a finding and fall back to: (a) the lowest-activity candidate most likely still `absent`, or (b) an explicit "warm-only, no true-cold available" measurement, clearly labeled as such in the report. Do not silently present a warm-vs-warm comparison as cold-vs-warm.

Every cold/warm claim in the report must be backed by an inspector screenshot showing the target's cache class at that moment.

## Benchmark Method

### Primary metric — time to usable content

Because the app uses streaming RSC plus background sync/revalidation, `networkidle` can be flaky or never settle. The **primary** timing metric is **navigation start → a known visible overview marker** (e.g. the README region or repo header rendered). Use `agent-browser` to wait on that element and timestamp it.

`networkidle` is captured as a **secondary** signal only:

- Navigation start → visible content marker (primary).
- Navigation start → `agent-browser wait --load networkidle` (secondary; may be noisy).
- Screenshot timestamp after final visible content.
- Console/errors immediately after render.

Collect at least **3 measured runs** per scenario per target. Re-inspect cache state between cold and warm phases.

Planned benchmark table:

| Scenario | Target | Run | URL | Cache class (inspector) | Visible-content ms | Network Idle ms | User-visible Result | Console Errors | Evidence |
|----------|--------|-----|-----|-------------------------|--------------------|-----------------|---------------------|----------------|----------|
| Cold overview | cold-control | 1 | /{owner}/{repo} | absent | TBD | TBD | TBD | TBD | TBD |
| Warm overview | cold-control | 1 | /{owner}/{repo} | fresh | TBD | TBD | TBD | TBD | TBD |
| Heavy overview | shuv1337/tldraw | 1 | /shuv1337/tldraw | TBD | TBD | TBD | TBD | TBD | TBD |
| Active overview | shuv1337/better-hub | 1 | /shuv1337/better-hub | TBD | TBD | TBD | TBD | TBD | TBD |
| Warmed via debug | shuv1337/tldraw | 1 | /debug/github-cache | fresh | TBD | TBD | TBD | TBD | TBD |

### HTTP-level benchmarks (authenticated)

Use local HTTP requests only as supporting evidence, not as the primary user result. **The request must carry the authenticated session cookie** — otherwise it measures the `(app)` sign-in redirect, not the cache. Before recording, assert the response is `200` and a rendered page (not a `307` to sign-in). Capture headers/status/body size/timing for the same URLs before and after warming.

Suggested raw output files:

- `dogfood-output/benchmarks/http-cold.txt`
- `dogfood-output/benchmarks/http-warm.txt`
- `dogfood-output/benchmarks/http-summary.md`

Metrics:

- HTTP status and redirect chain (must be 200, not an auth redirect).
- Total time.
- Time to first byte.
- Response size.
- Whether the response is a redirect, rendered page, or error boundary.

### Evidence naming

- Initial orientation: `screenshots/cache-initial.png`
- Cache-state inspector: `screenshots/cache-inspector-<repo>-<phase>.png`
- Cold overview: `screenshots/cache-cold-overview-<repo>-run-N.png`
- Warm overview: `screenshots/cache-warm-overview-<repo>-run-N.png`
- Debug warmer: `screenshots/cache-debug-warmer-*.png`
- Interactive issue repros: `videos/issue-NNN-repro.webm`
- Raw console/errors: `benchmarks/console-*.txt`
- Raw timings: `benchmarks/timing-*.txt`

## Pass Criteria

The cache functionality passes dogfood validation only if:

- Warm overview navigation is measurably faster (visible-content metric) or visibly avoids expensive loading compared with a cold visit, **with inspector evidence that the cold sample was genuinely uncached**.
- Cached content renders without route crashes, hydration mismatch warnings, or undefined runtime symbols.
- Refresh/warm controls show clear state and recover from failures.
- The Repo Status inspector shows targets transitioning `absent`/`stale` → `fresh` after warming, consistent with the measured UX improvement.
- No cache-specific console errors or failed app requests appear in normal navigation.
- The benchmark report includes raw timing evidence, inspector screenshots, and overview screenshots for cold and warm states.

## Failure Criteria

Open a dogfood finding if any of these happen:

- Repo overview crashes or enters an error boundary.
- Hydration mismatch appears during repo navigation.
- Warm navigation is not meaningfully faster and offers no visible UX improvement, despite the inspector confirming a real cold→fresh transition.
- Cached data is stale without visible indication or refresh path.
- Cache warming silently fails, or reports success (`accepted`) while the inspector and UI remain uncached.
- Warm reports `skipped` with no actionable reason surfaced to the user.
- Console/network errors occur during cache-specific flows.
- Loading states regress to spinners where skeletons are expected.

## Planned Execution Steps

### Step 0 — Confirm app-ready, authenticated session (precondition, not optional)

- Open `http://127.0.0.1:3000` with session `better-hub-cache-dogfood`.
- Confirm the session is authenticated as **shuv1337** and is **not** redirected to sign-in or onboarding. (Auth is a hard gate on every page this plan touches.)
- If sign-in/onboarding is forced, or Better Auth is unconfigured locally: **abort the benchmark**, capture the blocker screenshot + console, write a blocker entry to the report, and stop. Do not attempt to measure cache behavior from an unauthenticated session.
- Capture initial annotated screenshot and interactive snapshot.

### Step 1 — Initialize artifacts and capture ground-truth cache state

- Create `dogfood-output/cache-dogfood-report.md` (no template exists in the repo — author the file directly with the report skeleton: summary, benchmark table, findings, verdict).
- Create benchmark files under `dogfood-output/benchmarks/`.
- Open `/debug/github-cache`. Screenshot Last Warm, Sync Jobs, and warm-lock state.
- For each candidate target, use the **Repo Status inspector** (enter owner + repo) and record the overview targets' cache class. Choose the **cold-control** target = first candidate reported `absent`/`stale`. Screenshot each inspection (`cache-inspector-<repo>-before.png`).

### Step 2 — Cold overview baseline (inspector-verified cold)

- For the cold-control target (confirmed uncached in Step 1), visit `/{owner}/{repo}`.
- Capture primary (visible-content) and secondary (networkidle) timing, screenshot, console, errors. Repeat 3 runs.
- Re-inspect the target in `/debug/github-cache`; confirm it moved toward `fresh`. Screenshot (`cache-inspector-<repo>-after.png`).

### Step 3 — Warm overview pass

- Revisit the same target. Confirm inspector shows `fresh` first.
- Capture the same timing and evidence (3 runs). Compare cold vs warm using the visible-content metric.

### Step 4 — Heavy + active target navigation

- Visit `/shuv1337/tldraw` and `/shuv1337/better-hub`. Record inspector class + timing + evidence for each (3 runs each).
- These show real-world steady-state behavior on large and active repos.

### Step 5 — Validate cache warming controls

- On `/debug/github-cache`, trigger **Full warm** (covers shuv1337's own repos via personal discovery).
- Record the response message (`accepted` / `skipped: <reason>` / error) and the warm-lock behavior.
- After the warm completes, re-inspect tldraw/better-hub and confirm `fresh`; re-measure one warm run each.
- Record video if interaction produces a bug or ambiguous behavior.
- Note: the debug page has no access gate beyond an authenticated session — if that is surprising for a debug/warm surface, log it as an observation.

### Step 6 — Validate navigation consistency

- For one target, navigate overview → code → issues → pulls → actions → activity, then back to overview.
- Capture screenshots and console/errors after each page. Watch for route crashes and hydration mismatches.

### Step 7 — Stale / refresh behavior

- Use any visible refresh/revalidate control on the repo pages (revalidate actions exist on the repo route).
- Confirm the UI communicates refresh state and does not regress to blank or contradictory data.
- Screenshots and, for interactive refresh, a repro video.

### Step 8 — Document issues immediately

- For static issues: annotated screenshot and report entry.
- For interactive/cache action issues: repro video plus step screenshots.
- Severity follows the dogfood taxonomy.

### Step 9 — Summarize benchmarks

- Add the benchmark summary table to the report, including the inspector cache-class column.
- Include raw timing file links, inspector screenshots, and overview screenshots.
- State whether the cache functionality passes, partially passes, or fails — and explicitly state whether a genuine cold sample was obtainable.

## Resolved Pre-conditions (previously open questions)

- **Auth:** Resolved — app is authenticated as shuv1337 by default. Step 0 verifies and aborts on any auth/onboarding redirect rather than measuring from a bad session.
- **Targets:** Resolved — shuv1337-owned repos (`tldraw`, `better-hub`, plus a runtime-selected cold control). These are exactly what `discoverPersonalRepos` warms, so warm effects are attributable to the cache.
- **Cold state:** Resolved via inspector-verified cache class, since there is no evict control. If no `absent` target exists, the report says so instead of faking a cold baseline.

## Open Questions To Resolve During Execution

- Whether any candidate target is genuinely `absent` at Step 1, or whether a prior warm already populated everything (determines if a true cold read is available).
- Whether Full warm covers `tldraw` within its repo cap, or whether the heavy repo is skipped by the discovery volume limits.
- Whether the debug warmer should be treated as a supported user/admin surface given it has no gate beyond authentication.
