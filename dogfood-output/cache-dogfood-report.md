# Better Hub Cache Dogfood Report

| Field | Value |
|-------|-------|
| Date | 2026-06-24 |
| Target URL | http://127.0.0.1:3000 |
| Session | better-hub-cache-dogfood |
| Account | shuv1337 |
| Output Directory | dogfood-output/ |

## Glossary

| Term (plan) | Term (inspector UI) | Meaning |
|-------------|---------------------|---------|
| `absent` | `missing` | Cache target not populated |
| `stale` | `stale` | Cached but past freshness threshold |
| `fresh` | `fresh` | Cached and within freshness threshold |
| — | `present` | UI-layer cache populated (descriptor scope) |

## Summary

Browser dogfood of the personal GitHub cache completed with authenticated PAT login. A **genuine cold sample** was obtained on `shuv1337/oak-spike` (all inspector targets `missing`/`absent` before first visit). **Only one genuine cold navigation** was possible without cache eviction; oak-spike runs 2–3 during the cold phase were relabeled as **repeat-navigation-warm** (cache already populated after run 1).

Repeat navigations showed materially faster loads: `tldraw` first visit **24,298 ms** visible-content vs **~5 ms** on reruns; oak-spike genuine cold network-idle **11,144 ms** vs warm-phase avg **~2,625 ms**. Inspector confirmed `missing` → `fresh`/`present` transitions after cold visit.

**Verdict: PARTIAL PASS** — cache warming via navigation works and inspector evidence supports cold→warm transitions, but hydration mismatch errors on repo pages, disabled manual warm controls, and no user-visible refresh affordance prevent a full pass.

## Auth Precondition (Step 0)

- **Status:** PASS (after PAT login)
- Fresh headless session landed on sign-in landing page (`Continue with GitHub`). Authenticated via **Or use a personal access token** using GitHub CLI token; redirected to `/dashboard` as **shuv1337**.
- **Evidence:** `screenshots/cache-initial.png`, `auth-state.json`, `benchmarks/console-step0-initial.txt`, `benchmarks/errors-step0-initial.txt`

## Step 1 — Ground-truth cache state

**Debug page** (`/debug/github-cache`):
- Last Warm: *No warm result has been stored*
- Sync Jobs: PENDING 0 / RUNNING 0 / FAILED 0
- Warm lock: **open**, owner n/a
- **Evidence:** `screenshots/cache-debug-overview.png`

### Inspector results (before benchmarks)

| Repo | Overview targets | Notes |
|------|------------------|-------|
| **shuv1337/oak-spike** | all `missing` (`absent`) | **Chosen cold control** |
| shuv1337/herdshuvr | all `missing` (`absent`) | Also uncached |
| shuv1337/executor | all `missing` (`absent`) | Also uncached |
| shuv1337/tldraw | all `missing` (`absent`) | Heavy target, uncached at start |
| shuv1337/better-hub | mixed `stale`/`fresh`/`missing` | Partially warm from prior activity |

**Evidence:** `screenshots/cache-inspector-<repo>-before.png`, `benchmarks/inspector-*-before.txt`

### Inspector evidence map (cache-class claims)

| Measurement | Inspector evidence | Timestamp relative to run |
|-------------|-------------------|---------------------------|
| Cold overview oak-spike run 1 | `screenshots/cache-inspector-oak-spike-before.png`, `benchmarks/inspector-oak-spike-oak-spike-before.txt` | Immediately before run 1 |
| Repeat-navigation oak-spike runs 2–3 | `screenshots/cache-inspector-oak-spike-after.png`, `benchmarks/inspector-oak-spike-oak-spike-after.txt` | After run 1; cache partial/fresh — **not cold** |
| Warm overview oak-spike runs 1–3 | Same as above (`cache-inspector-oak-spike-after.png`) | Post-cold-population; pre-warm-run inspector not re-captured |
| Heavy overview tldraw run 1 | `screenshots/cache-inspector-tldraw-before.png`, `benchmarks/inspector-tldraw-tldraw-before.txt` | Before run 1 (all `missing`) |
| Heavy overview tldraw runs 2–3 | No per-run inspector; inferred warm from run 1 population + timing | Claims narrowed to "post-run-1 warm repeat" |
| Active overview better-hub runs 1–3 | `screenshots/cache-inspector-better-hub-before.png` (Step 1 only) | Stale/fresh mix at session start; no per-run re-inspect |
| Steady-state remeasure | `screenshots/cache-inspector-tldraw-post-warm.png`, `screenshots/cache-inspector-better-hub-post-warm.png` | After failed warm attempt; navigation-warm only |

## Step 2 — Cold overview baseline

- **Target:** `shuv1337/oak-spike` (inspector-verified all `missing` before run 1)
- **Genuine cold runs:** **1 only** (run 1). Runs 2–3 relabeled `repeat-navigation-warm` — cache populated after run 1.
- **Outcome:** Page rendered; network-idle **11,144 ms** on run 1; inspector after shows `missing` → `fresh`/`present`.
- **Evidence:** `benchmarks/timing-cold-overview-oak-spike-run-1.txt`, `screenshots/cache-cold-overview-oak-spike-run-1.png`, `benchmarks/console-cold-overview-oak-spike-run-1.txt`, `screenshots/cache-inspector-oak-spike-after.png`, `benchmarks/inspector-oak-spike-oak-spike-after.txt`

## Step 3 — Warm overview pass

- **Target:** `shuv1337/oak-spike` (inspector `fresh`/`present` per after-cold screenshot)
- **Runs:** 3 warm overview navigations after cold phase
- **Outcome:** Network-idle avg **~2,625 ms** vs cold run 1 **11,144 ms**; visible-content marker noisy on this target.
- **Evidence:** `benchmarks/timing-warm-overview-oak-spike-run-{1,2,3}.txt`, `screenshots/cache-warm-overview-oak-spike-run-{1,2,3}.png`, `benchmarks/console-warm-overview-oak-spike-run-{1,2,3}.txt`, `screenshots/cache-inspector-oak-spike-after.png`

## Step 4 — Heavy + active targets

- **Heavy:** `/shuv1337/tldraw` — 3 runs; run 1 cold (**24,298 ms** visible), runs 2–3 warm repeat
- **Active:** `/shuv1337/better-hub` — 3 runs; partially warm at Step 1
- **Evidence:** `benchmarks/timing-heavy-overview-tldraw-run-{1,2,3}.txt`, `screenshots/cache-heavy-overview-tldraw-run-{1,2,3}.png`, `benchmarks/console-heavy-overview-tldraw-run-{1,2,3}.txt`, `benchmarks/timing-active-overview-better-hub-run-{1,2,3}.txt`, `screenshots/cache-active-overview-better-hub-run-{1,2,3}.png`, `benchmarks/console-active-overview-better-hub-run-{1,2,3}.txt`, `screenshots/cache-inspector-tldraw-before.png`

## Benchmark Table

**Visible-content marker (all rows):** `agent-browser wait --text "<repo>"` with fallback to `wait --text "<owner>"`. See timing file headers for per-run values. This captures repo name in the app shell, **not** the README region — see Benchmark interpretation.

**Console Errors column:** Per-run errors sliced from cumulative `console-*.txt` logs — only `[error]` lines **after** the last exact `[view] <url>` anchor for that run. See `console_errors_summary` and `console_error_anchor_line` in each `timing-*.txt`. Hydration errors observed during Step 6 navigation are documented separately (ISSUE-001/002) and appear earlier in session logs, not in most per-run navigation windows.

| Scenario | Target | Run | URL | Cache class (inspector) | Visible-content ms | Network Idle ms | User-visible Result | Console Errors (per-run window) | Evidence |
|----------|--------|-----|-----|-------------------------|--------------------|-----------------|---------------------|--------------------------------|----------|
| Cold overview | oak-spike | 1 | /shuv1337/oak-spike | `missing` (before run 1) | 8 | 11144 | Page rendered; background sync slow | readme 404 | `benchmarks/timing-cold-overview-oak-spike-run-1.txt`, `benchmarks/console-cold-overview-oak-spike-run-1.txt`, `screenshots/cache-cold-overview-oak-spike-run-1.png`, `screenshots/cache-inspector-oak-spike-before.png` |
| Repeat-navigation-warm † | oak-spike | 2 | /shuv1337/oak-spike | `fresh`/`present` (after run 1) | 39 | 2631 | Fast shell, quicker settle | none | `benchmarks/timing-repeat-navigation-oak-spike-run-2.txt`, `benchmarks/console-repeat-navigation-oak-spike-run-2.txt`, `screenshots/cache-cold-overview-oak-spike-run-2.png`, `screenshots/cache-inspector-oak-spike-after.png` |
| Repeat-navigation-warm † | oak-spike | 3 | /shuv1337/oak-spike | `fresh`/`present` (after run 1) | 7 | 2648 | Fast repeat | none | `benchmarks/timing-repeat-navigation-oak-spike-run-3.txt`, `benchmarks/console-repeat-navigation-oak-spike-run-3.txt`, `screenshots/cache-cold-overview-oak-spike-run-3.png`, `screenshots/cache-inspector-oak-spike-after.png` |
| Warm overview | oak-spike | 1 | /shuv1337/oak-spike | `fresh`/`present` (post-cold) | 35 | 2615 | Fast repeat navigation | none | `benchmarks/timing-warm-overview-oak-spike-run-1.txt`, `benchmarks/console-warm-overview-oak-spike-run-1.txt`, `screenshots/cache-warm-overview-oak-spike-run-1.png`, `screenshots/cache-inspector-oak-spike-after.png` |
| Warm overview | oak-spike | 2 | /shuv1337/oak-spike | `fresh`/`present` (post-cold) | 9 | 2675 | Fast repeat | none | `benchmarks/timing-warm-overview-oak-spike-run-2.txt`, `benchmarks/console-warm-overview-oak-spike-run-2.txt`, `screenshots/cache-warm-overview-oak-spike-run-2.png`, `screenshots/cache-inspector-oak-spike-after.png` |
| Warm overview | oak-spike | 3 | /shuv1337/oak-spike | `fresh`/`present` (post-cold) | 7 | 2584 | Fast repeat | none | `benchmarks/timing-warm-overview-oak-spike-run-3.txt`, `benchmarks/console-warm-overview-oak-spike-run-3.txt`, `screenshots/cache-warm-overview-oak-spike-run-3.png`, `screenshots/cache-inspector-oak-spike-after.png` |
| Heavy overview | tldraw | 1 | /shuv1337/tldraw | `missing` (before run 1) | **24298** | 1204 | Slow first paint of usable content | none | `benchmarks/timing-heavy-overview-tldraw-run-1.txt`, `benchmarks/console-heavy-overview-tldraw-run-1.txt`, `screenshots/cache-heavy-overview-tldraw-run-1.png`, `screenshots/cache-inspector-tldraw-before.png` |
| Heavy overview | tldraw | 2 | /shuv1337/tldraw | warm repeat (inferred post-run 1) | 3 | 4516 | Near-instant shell | none | `benchmarks/timing-heavy-overview-tldraw-run-2.txt`, `benchmarks/console-heavy-overview-tldraw-run-2.txt`, `screenshots/cache-heavy-overview-tldraw-run-2.png` |
| Heavy overview | tldraw | 3 | /shuv1337/tldraw | warm repeat (inferred post-run 1) | 7 | 3914 | Near-instant shell | none | `benchmarks/timing-heavy-overview-tldraw-run-3.txt`, `benchmarks/console-heavy-overview-tldraw-run-3.txt`, `screenshots/cache-heavy-overview-tldraw-run-3.png` |
| Active overview | better-hub | 1 | /shuv1337/better-hub | `stale`/`fresh` mix (Step 1 inspector) | 5 | 9160 | Slower first settle | none | `benchmarks/timing-active-overview-better-hub-run-1.txt`, `benchmarks/console-active-overview-better-hub-run-1.txt`, `screenshots/cache-active-overview-better-hub-run-1.png`, `screenshots/cache-inspector-better-hub-before.png` |
| Active overview | better-hub | 2 | /shuv1337/better-hub | `stale`/`fresh` mix (Step 1; not re-inspected) | 8 | 2999 | Faster repeat | none | `benchmarks/timing-active-overview-better-hub-run-2.txt`, `benchmarks/console-active-overview-better-hub-run-2.txt`, `screenshots/cache-active-overview-better-hub-run-2.png` |
| Active overview | better-hub | 3 | /shuv1337/better-hub | `stale`/`fresh` mix (Step 1; not re-inspected) | 3 | 2763 | Faster repeat | none | `benchmarks/timing-active-overview-better-hub-run-3.txt`, `benchmarks/console-active-overview-better-hub-run-3.txt`, `screenshots/cache-active-overview-better-hub-run-3.png` |
| Steady-state remeasure ‡ | tldraw | 1 | /shuv1337/tldraw | partial `fresh` (post-nav; see inspector) | 12 | 4068 | Fast shell | none | `benchmarks/timing-steady-state-remeasure-tldraw-run-1.txt`, `benchmarks/console-steady-state-remeasure-tldraw-run-1.txt`, `screenshots/cache-post-warm-tldraw-run-1.png`, `screenshots/cache-inspector-tldraw-post-warm.png` |
| Steady-state remeasure ‡ | better-hub | 1 | /shuv1337/better-hub | `stale`/`fresh` mix (post-nav) | 4 | 2962 | Fast shell | none | `benchmarks/timing-steady-state-remeasure-better-hub-run-1.txt`, `benchmarks/console-steady-state-remeasure-better-hub-run-1.txt`, `screenshots/cache-post-warm-better-hub-run-1.png`, `screenshots/cache-inspector-better-hub-post-warm.png` |
| Warmed via debug | — | — | /debug/github-cache | — | — | — | **SKIPPED** (ISSUE-003: warm disabled) | — | `benchmarks/warm-control-response.txt`, `screenshots/cache-debug-warmer-after-click.png` |

† Originally captured as cold runs 2–3; relabeled per methodology (cache populated after run 1). Screenshot filenames retain `cache-cold-overview` prefix from capture time.

‡ Manual Full/Quick warm did not run; remeasure reflects navigation-driven cache only. Screenshot filenames retain `cache-post-warm-*` capture-time prefix (timing/console files use `steady-state-remeasure-*`).

### Benchmark interpretation

- **Visible-content marker** (`wait --text <repo>`) is noisy for oak-spike/better-hub: repo name appears in the app shell in **<10 ms** while network-idle can be **>10 s** on genuine cold loads.
- **Cold-control genuine cold:** oak-spike run 1 only — network-idle **11,144 ms**.
- **Cold-control warm comparison:** warm overview runs avg network-idle **~2,625 ms** (4.2× faster than cold run 1).
- **Strongest visible-content cold signal:** `tldraw` run 1 **24,298 ms** vs runs 2–3 **~5 ms**.
- **Inspector transition:** oak-spike `missing` → `fresh`/`present` (`screenshots/cache-inspector-oak-spike-after.png`).

### Cold vs warm summary (corrected)

| Comparison | Visible-content | Network-idle | Inspector-backed |
|------------|-----------------|--------------|------------------|
| oak-spike cold run 1 vs warm avg | 8 ms vs ~17 ms (**no improvement; marker inconclusive**) | 11,144 ms vs ~2,625 ms (**pass**) | Yes |
| tldraw run 1 vs runs 2–3 avg | 24,298 ms vs ~5 ms (**pass**) | 1,204 ms vs ~4,215 ms (secondary) | Run 1 only |

## Step 5 — Cache warming controls

| Control | Response | Warm lock |
|---------|----------|-----------|
| Full warm | **skipped: disabled** | open |
| Quick warm | **skipped: disabled** | open |

- Last Warm remained *0/0 warmed*; no sync jobs enqueued.
- Steady-state remeasures (Step 5 follow-up) reflect navigation-warm only, not debug warming.
- **Evidence:** `screenshots/cache-debug-warmer-before.png`, `screenshots/cache-debug-warmer-after-click.png`, `screenshots/cache-debug-warmer-quick-warm.png`, `benchmarks/warm-control-response.txt`, `benchmarks/console-debug-warmer.txt`

## Step 6 — Navigation consistency (better-hub)

Traversed: overview → code → issues → pulls → actions → activity → overview. No route crashes or error boundaries observed.

**Console note:** Hydration mismatch warnings and nested-anchor errors were logged on sub-pages during this traversal (see ISSUE-001, ISSUE-002) — these are console defects, not route crashes.

**Evidence:** `screenshots/cache-nav-better-hub-{overview,code,issues,pulls,actions,activity}.png`, `benchmarks/console-nav-better-hub-{overview,code,issues,pulls,actions,activity}.txt`, `benchmarks/errors-nav-better-hub-{overview,code,issues,pulls,actions,activity}.txt`

## Step 7 — Stale / refresh behavior

- No user-visible **Refresh**, **Revalidate**, or **Sync** control found on repo overview (command menu search for "refresh" returned no matches; settings page had no cache controls).
- Browser reload showed immediate shell render with background hydration; no explicit refresh-state UI.
- **Evidence:** `screenshots/cache-refresh-command-menu.png`, `screenshots/cache-refresh-settings.png`, `screenshots/cache-refresh-reload-{immediate,1s,settled}.png`, `benchmarks/console-refresh-reload.txt`

## Step 8 — Document issues

Four findings documented with repro steps and evidence (ISSUE-001 through ISSUE-004). See Findings section below.

## Step 9 — Summarize benchmarks + verdict

Benchmark table (above), cold-vs-warm summary (corrected), verdict matrix (below), and raw file index (below) complete Step 9.

## HTTP Benchmarks (authenticated)

See `benchmarks/http-summary.md`.

- **Post-cold-visit oak-spike:** HTTP 200, 0.685s — `benchmarks/http-post-cold-visit-oak-spike.txt` (not a pre-navigation baseline)
- **Steady-state better-hub:** HTTP 200, 1.218s — `benchmarks/http-warm.txt`

## Findings

### ISSUE-001 — Hydration mismatch on repo navigation (High)

**Severity:** High

**Description:** Console logs repeated React hydration mismatch warnings during repo page loads after initial navigation. Appears on better-hub overview and sub-pages.

**Repro:**
1. Authenticate and open `http://127.0.0.1:3000/shuv1337/better-hub`
2. Open browser console
3. Observe hydration mismatch errors

**Evidence:** `benchmarks/console-nav-better-hub-overview.txt`, `benchmarks/console-active-overview-better-hub-run-2.txt`

**Repro Video:** N/A (visible in console on load)

---

### ISSUE-002 — Nested anchor hydration error on Activity page (Medium)

**Severity:** Medium

**Description:** Activity tab logs `In HTML, <a> cannot be a descendant of <a>` / nested anchor hydration error.

**Repro:**
1. Open `http://127.0.0.1:3000/shuv1337/better-hub/activity`
2. Check console

**Evidence:** `benchmarks/console-nav-better-hub-activity.txt`, `screenshots/cache-nav-better-hub-activity.png`

**Repro Video:** N/A

---

### ISSUE-003 — Manual warm controls silently skipped (Medium)

**Severity:** Medium

**Description:** Both Quick warm and Full warm on `/debug/github-cache` return `skipped: disabled` with no explanation of how to enable warming or what configuration is missing.

**Repro:**
1. Open `/debug/github-cache`
2. Click **Full warm** or **Quick warm**
3. Observe `* warm skipped: disabled` message

**Evidence:** `screenshots/cache-debug-warmer-after-click.png`, `screenshots/cache-debug-warmer-quick-warm.png`, `benchmarks/warm-control-response.txt`

**Repro Video:** N/A

---

### ISSUE-004 — README 404 logged for oak-spike (Low)

**Severity:** Low

**Description:** Server logs `GET /repos/shuv1337/oak-spike/readme?ref=main - 404` during oak-spike overview load. Page still renders but console shows error.

**Repro:**
1. Open `http://127.0.0.1:3000/shuv1337/oak-spike` on uncached repo
2. Check console

**Evidence:** `benchmarks/console-cold-overview-oak-spike-run-1.txt`

**Repro Video:** N/A

## Observations

1. **Auth not pre-seeded:** Plan assumed default shuv1337 auth; fresh agent-browser session required PAT login.
2. **Debug page ungated:** `/debug/github-cache` is reachable by any authenticated user (no admin gate).
3. **No refresh affordance:** Users cannot manually trigger cache revalidation from repo UI.
4. **Headless config:** Required custom `agent-browser-headless.json` (Wayland helium config fails in CI-style environment).

## Genuine Cold Sample

**Yes — one navigation.** `shuv1337/oak-spike` had all GitHub/UI cache targets `missing` (`absent`) in inspector before first measured visit (`screenshots/cache-inspector-oak-spike-before.png`). After cold visit, targets transitioned to `fresh`/`present` (`screenshots/cache-inspector-oak-spike-after.png`). Without cache eviction, only run 1 qualifies as cold.

## Verdict

### **PARTIAL PASS**

| Criterion | Result |
|-----------|--------|
| Warm faster than cold — cold-control visible-content (oak-spike) | **Inconclusive** — marker captures shell in <10 ms; no measurable cold→warm improvement (8 ms cold vs ~17 ms warm) |
| Warm faster than cold — cold-control network-idle (oak-spike) | **Pass** — 11,144 ms → ~2,625 ms avg |
| Warm faster than cold — heavy target visible-content (tldraw) | **Pass** — 24,298 ms → ~5 ms |
| No crashes / error boundaries | **Pass** |
| No hydration mismatches | **Fail** — ISSUE-001, ISSUE-002 |
| Inspector absent→fresh transitions | **Pass** |
| No cache-specific console errors | **Fail** — readme 404, hydration errors |
| Warm controls functional | **Fail** — ISSUE-003 (disabled) |
| Refresh UI communicates state | **Fail** — no visible control |
| Planned "Warmed via debug" scenario | **Skipped** — ISSUE-003 |

**Findings:** 4 (1 High, 2 Medium, 1 Low)

## Raw Benchmark Files

- Timings: `benchmarks/timing-*.txt` (include `visible_content_marker`, `console_error_anchor_line`, `console_errors_summary`, and per-run-sliced `---errors---`)
- Console: `benchmarks/console-*.txt` (cumulative session logs; per-run errors require anchor slicing — see timing files)
- Errors (nav + step0): `benchmarks/errors-nav-*.txt`, `benchmarks/errors-step0-initial.txt`
- Inspector dumps: `benchmarks/inspector-*.txt`
- Warm control: `benchmarks/warm-control-response.txt`
- HTTP: `benchmarks/http-post-cold-visit-oak-spike.txt`, `benchmarks/http-warm.txt`, `benchmarks/http-summary.md`
- Deprecated: `benchmarks/http-cold.txt` (points to `http-post-cold-visit-oak-spike.txt`)