# Better Hub Cache Dogfood Plan

| Field | Value |
|-------|-------|
| Date | 2026-06-24 |
| Target URL | http://127.0.0.1:3000 |
| Session | better-hub-cache-dogfood |
| Scope | Validate personal GitHub cache behavior on repo navigation and cache warming with real browser evidence and timing benchmarks |
| Output Directory | dogfood-output/ |
| Report Path | dogfood-output/cache-dogfood-report.md |
| Benchmark Data | dogfood-output/benchmarks/ |

## Goal

Validate that the GitHub cache functionality improves real user navigation for repository pages and does not introduce stale, broken, or misleading UI states. The dogfood pass must produce benchmark evidence, screenshots, console/network evidence, and repro artifacts for any bugs found.

## Constraints

- Test as a user through the browser. Do not inspect the app source while dogfooding.
- Preserve all generated output. Do not delete prior dogfood files.
- Use `agent-browser` directly for browser evidence.
- Record benchmark inputs and raw outputs so results are reproducible.
- Separate measured cache behavior from unrelated local-dev noise such as missing Stripe or Better Auth API keys.

## Target Workflows

1. Repo overview cold visit
   - Visit a repo page from a fresh browser session.
   - Capture perceived load state, skeleton/loading behavior, final rendered sections, console errors, and request timing.
   - Evidence: annotated screenshots, console/errors logs, benchmark JSON/text.

2. Repo overview warm revisit
   - Revisit the same repo page in the same authenticated session after cache has been populated.
   - Compare time to usable overview content versus the cold visit.
   - Evidence: annotated screenshots, timing comparison table, console/errors logs.

3. Cache warmer route and debug surface
   - Open the GitHub cache debug/warm page if accessible from the UI or direct route.
   - Trigger cache warm controls if exposed.
   - Confirm visible status updates and no silent failures.
   - Evidence: screenshots before/after warm action, video for interactive warm flow, console/errors logs.

4. Repo navigation across related pages
   - Navigate overview -> code -> issues -> pulls -> activity/actions, then back to overview.
   - Confirm cached sections stay consistent and no route-level crashes or hydration mismatches appear.
   - Evidence: screenshots for each page, console/errors logs, timing markers.

5. Stale data and refresh behavior
   - Use visible refresh/revalidate controls where available.
   - Confirm the UI communicates refresh state and does not regress to blank or contradictory data.
   - Evidence: screenshots and, for interactive refresh, repro video.

## Benchmark Method

### Browser-level benchmarks

For each target URL, collect at least 3 measured runs for cold-ish and warm cases:

- Navigation start to network idle via `agent-browser wait --load networkidle`.
- Screenshot timestamp after final visible content.
- Console/errors immediately after render.
- Repeat visits in the same browser session to measure warm behavior.

Planned benchmark table:

| Scenario | Run | URL | Start Time | Network Idle ms | User-visible Result | Console Errors | Evidence |
|----------|-----|-----|------------|-----------------|---------------------|----------------|----------|
| Cold repo overview | 1 | /ogulcanc/herdr | TBD | TBD | TBD | TBD | TBD |
| Warm repo overview | 1 | /ogulcanc/herdr | TBD | TBD | TBD | TBD | TBD |
| Warmed via debug page | 1 | /debug/github-cache | TBD | TBD | TBD | TBD | TBD |

### HTTP-level benchmarks

Use local HTTP requests only as supporting evidence, not as the primary user result. Capture headers/status/body size/timing for the same URLs before and after browser warming.

Suggested raw output files:

- `dogfood-output/benchmarks/http-cold.txt`
- `dogfood-output/benchmarks/http-warm.txt`
- `dogfood-output/benchmarks/http-summary.md`

Metrics:

- HTTP status and redirect chain.
- Total time.
- Time to first byte.
- Response size.
- Whether the response is a redirect, rendered page, or error boundary.

### Evidence naming

- Initial orientation: `screenshots/cache-initial.png`
- Cold overview: `screenshots/cache-cold-overview-run-N.png`
- Warm overview: `screenshots/cache-warm-overview-run-N.png`
- Debug warmer: `screenshots/cache-debug-warmer-*.png`
- Interactive issue repros: `videos/issue-NNN-repro.webm`
- Raw console/errors: `benchmarks/console-*.txt`
- Raw timings: `benchmarks/timing-*.txt`

## Pass Criteria

The cache functionality passes dogfood validation only if:

- Warm repo overview navigation is measurably faster or visibly avoids expensive loading compared with cold navigation.
- Cached content renders without route crashes, hydration mismatch warnings, or undefined runtime symbols.
- Refresh/warm controls show clear state and recover from failures.
- No cache-specific console errors or failed app requests appear in normal navigation.
- The benchmark report includes raw timing evidence and screenshots for cold and warm states.

## Failure Criteria

Open a dogfood finding if any of these happen:

- Repo overview crashes or enters an error boundary.
- Hydration mismatch appears during repo navigation.
- Warm navigation is not meaningfully faster and offers no visible UX improvement.
- Cached data is stale without visible indication or refresh path.
- Cache warming silently fails or presents success while the UI remains uncached.
- Console/network errors occur during cache-specific flows.
- Loading states regress to spinners where skeletons are expected.

## Planned Execution Steps

1. Initialize dogfood artifacts
   - Copy the dogfood report template to `dogfood-output/cache-dogfood-report.md`.
   - Create benchmark files under `dogfood-output/benchmarks/`.

2. Start browser session
   - Open `http://127.0.0.1:3000` with session `better-hub-cache-dogfood`.
   - Wait for network idle.
   - Capture initial annotated screenshot and interactive snapshot.

3. Confirm authenticated/app-ready state
   - If redirected to sign-in or blocked by auth, document the blocker and ask for credentials or use the existing browser session only if already authenticated.
   - Save auth state after successful access.

4. Run cold-ish repo overview baseline
   - Visit `/ogulcanc/herdr`.
   - Capture timing, screenshot, console, errors.
   - Repeat for 3 runs after opening fresh page contexts where possible.

5. Run warm repo overview pass
   - Revisit `/ogulcanc/herdr` in the same session.
   - Capture the same timing and evidence.
   - Compare cold vs warm results.

6. Validate cache warming controls
   - Visit `/debug/github-cache`.
   - Capture visible state.
   - Trigger warm flow if controls are available.
   - Record video if interaction produces a bug or ambiguous behavior.

7. Validate navigation consistency
   - Navigate repo overview, code, issues, pulls, actions/activity, then back to overview.
   - Capture screenshots and console/errors after each page.

8. Document issues immediately
   - For static issues: annotated screenshot and report entry.
   - For interactive/cache action issues: repro video plus step screenshots.
   - Severity follows the dogfood taxonomy.

9. Summarize benchmarks
   - Add a benchmark summary table to the report.
   - Include raw timing file links and screenshot evidence.
   - State whether the cache functionality passes, partially passes, or fails.

## Open Questions To Resolve During Execution

- Whether the local browser session is already authenticated.
- Which repositories have enough data to show meaningful cache behavior if `/ogulcanc/herdr` is too small or private.
- Whether the debug cache warmer is intended for local-only use or should be treated as a supported user/admin surface.

