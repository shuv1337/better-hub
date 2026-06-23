# Personal GitHub Cache Plan

> **Revisions (2026-06-23):** Revised after plan review. This version keeps Phase 0 as the first shippable security fix, aligns warm stages with the cache stores the UI actually reads, makes lock ownership single-runId based across API → Inngest worker, specifies a concrete background GitHub auth-context resolver, repairs Prisma sync-job dedupe so failed rows do not block future refreshes, makes repo events a real cached warm target, adds a central cache descriptor/key-builder map, includes polluted `ghpub:*` cleanup, structured warm-run logs, and requires new cache env vars in `apps/web/.env.example`. **Second pass:** makes the README HTML read seam explicitly cache-first so warmed `readme_html:*` is used on first navigation, clarifies auth-injected paths must use lower-level helpers instead of React `cache()` wrappers, fixes repo-page-entry/status phase ordering, and defines quick/full ownership for layout metadata caches (languages, contributors, branches, tags).
>
> **Prior revision (2026-03-23):** Updated after codebase review (`~/.agent/diagrams/better-hub-personal-github-cache-plan-review.html`). Changes: Phase 0 security first, shared-cache severity corrected, warm execution split (sync dev vs Inngest prod), lock/coordination rules, repo-page-data versioning, warm-stage fixes, explicit stage→data-class map.

## Context

Better Hub is being used for a small, trusted set of personal repositories. The goal is to make repository navigation feel local-first: repo lists, repo chrome, PRs, issues, README, file tree, CI, and activity should load from a warm cache with GitHub refreshes happening in the background.

The existing codebase already has most of the right primitives:

- `apps/web/src/lib/github.ts` contains the primary GitHub access module and most pages already call through it.
- `apps/web/src/lib/github.ts` has `readLocalFirstGitData`, which returns cached data, enqueues a refresh, and drains sync jobs opportunistically.
- `apps/web/src/lib/github-sync-store.ts` stores user-scoped GitHub cache entries in Redis and has a Prisma-backed sync-job queue.
- `apps/web/src/lib/repo-data-cache.ts` has Redis helpers for repo page data, file trees, overview PRs/issues/events/CI, branches, tags, languages, and contributors.
- `apps/web/prisma/schema.prisma` already defines `GithubCacheEntry`, but the table is currently unused by `github-sync-store.ts`; cache entries are Redis-only.
- `apps/web/src/lib/inngest.ts` exists and can run long-running work outside HTTP request timeouts.
- Repo pages already use cached fragments and background revalidation through:
  - `apps/web/src/app/(app)/repos/[owner]/[repo]/layout.tsx`
  - `apps/web/src/app/(app)/repos/[owner]/[repo]/page.tsx`
  - `apps/web/src/components/repo/repo-revalidator.tsx`
  - `apps/web/src/app/(app)/repos/[owner]/[repo]/revalidate-actions.ts`
  - `apps/web/src/app/(app)/repos/[owner]/[repo]/overview-actions.ts`

Build a first-class personal cache warmer on top of these seams, not a parallel GitHub client.

## Goals

- [ ] Keep all personal repositories discoverable and warm after sign-in.
- [ ] Make first navigation to a warmed repo return cached data quickly.
- [ ] Refresh hot repo data in the background without blocking page loads.
- [ ] Keep stale data available when GitHub is slow, rate-limited, or temporarily unavailable.
- [ ] **Eliminate cross-user private-repo leakage via `ghpub:*` shared cache (pre-existing bug).**
- [ ] Provide observability: cache status, job backlog, last refresh time, failure details, and structured warm-run logs.
- [ ] Local-dev friendly by default; production warm path must not rely on a single long HTTP request.
- [ ] Document cache policy and operational notes in project `AGENTS.md` when behavior ships.

## Non-Goals

- [ ] Do not build a full GitHub data mirror in V1.
- [ ] Do not require OAuth App setup; the current PAT sign-in path should work.
- [ ] Do not add webhooks in V1.
- [ ] Do not make GitHub mutation paths cache-first. Writes hit GitHub, then invalidate or refresh affected keys.
- [ ] Do not cache raw token values or log PATs.
- [ ] Do not run unbounded synchronous warm (hundreds of GitHub calls) inside a serverless HTTP handler in production.
- [ ] Do not import app-route Server Action modules into `lib` warmer code; extract shared library helpers and let Server Actions delegate to them.

## Important Current-State Findings

### Existing Local-First Read Path

`readLocalFirstGitData` in `apps/web/src/lib/github.ts`:

- returns user-scoped cached data if available,
- enqueues a refresh job,
- checks shared cache for allowlisted data,
- falls back to synchronous GitHub fetch on a miss,
- falls back to default data if GitHub fails.

This is the correct seam for most GitHub API response caches.

### Repo Page Data Is Cached Separately

`getRepoPageData` reads `repo_page_data:{userId}:{owner}/{repo}` via `repo-data-cache.ts`. The Redis key currently uses `ex: 3600` (1 hour). When it expires, the key is gone and the next request blocks on `fetchRepoPageDataGraphQL`.

For a personal repo cache, this should become stale-while-revalidate rather than expire-to-cold.

### Redis Is the Real Cache Store Today

`GithubCacheEntry` exists in Prisma (table created in `20260220141241_init`), but `getGithubCacheEntry` / `upsertGithubCacheEntry` are Redis-only.

V1 stays Redis-only. Phase 12 (optional) adds Postgres read-through without a new migration.

Local dev: app uses Upstash REST (`@upstash/redis`) → `serverless-redis-http` → Docker `better-hub-redis`. `redis-cli` against the Docker container inspects the same data.

### Shared Cache — Active Security Issue (not “personal-only”)

The comment above `SHAREABLE_CACHE_TYPES` (`github.ts` ~97–102) says repo data is excluded from the shared cache. **The set contradicts the comment:** it includes `repo_issues`, `repo_pull_requests`, `issue`, `issue_comments`, `pull_request`, `pull_request_files`, `pull_request_comments`, `pull_request_reviews`, `repo_branches`, `repo_tags`, `repo_releases`, `repo_contributors`, `repo_workflow_runs`, `repo_nav_counts`, `org`, `org_members`, and more.

`upsertCacheWithShared` writes those types to `ghpub:{cacheKey}` where cache keys are owner/repo scoped without `userId` (for example `repo_issues:owner/repo:open`). Any user who hits `readLocalFirstGitData`’s shared-cache branch can receive another user’s cached private-repo payload without a GitHub permission check.

**This is live in any multi-user deployment. Phase 0 ships first and is deployable alone. Do not defer it because usage is “personal.”**

### The UI Reads Multiple Cache Families

The warmer must populate the cache stores that the first navigation path actually reads:

- Repo layout reads `repo_page_data:{userId}:...` and owner-scoped `repo_file_tree:{owner}/{repo}` before falling back to `getRepoTree(owner, repo, defaultBranch, true)`.
- Repo overview currently calls `revalidateReadme(owner, repo, defaultBranch)` synchronously, while rendered README HTML is stored under `readme_html:{owner}/{repo}`. V1 must make this read seam cache-first: either `page.tsx` reads `getCachedReadmeHtml` first and schedules a background refresh, or `revalidateReadme` delegates to a shared cache-first helper that only blocks on GitHub on a true miss.
- Repo overview also reads `overview_prs`, `overview_issues`, `overview_events`, `overview_commit_activity`, and `overview_ci` owner-scoped caches.
- The code page reads `getRepoReadme(owner, repo, defaultBranch)` for the raw README response.
- Actions pages read `getRepoWorkflowRuns`.

Therefore, V1 warm stages must not only call `readLocalFirstGitData` functions; they must also populate the owner-scoped UI fragment caches where the UI already reads them. If a future refactor makes the UI read only user-scoped `gh:{userId}:*` entries, that can become a follow-up simplification.

### Background Auth Is Not Available Through Request Helpers

`getGitHubAuthContext` in `github.ts` is request-header/session based and private. An Inngest worker with only `{ userId }` cannot call the current `getRepo*` functions successfully because they fall back to unauthenticated data without request headers.

V1 must extract an explicit GitHub auth-context resolver for background jobs and make warmer-used GitHub functions accept an injected auth context.

### Prisma Sync-Job Dedupe Can Block Future Refreshes

`GithubSyncJob` has a unique `(userId, dedupeKey)` constraint and `enqueueGithubSyncJob` currently upserts with `update: {}`. A permanently `failed` row can block future refresh attempts for the same dedupe key.

V1 must repair this so enqueueing a deduped refresh revives or updates failed rows instead of silently doing nothing.

### Coordination Layers (document precedence)

V1 will use several mechanisms. Document this at the top of `github-cache-warmer.ts`:

1. **Redis user warm lock** (`github-cache-warm-lock:{userId}`) — only one active warm run per user.
2. **Run ID lease** — a `runId` is generated by the API and passed to Inngest; lock release only happens if Redis still stores that same `runId`.
3. **Prisma `GithubSyncJob` dedupe** — one refresh row per `userId` + `dedupeKey`, with failed-row revival.
4. **Browser localStorage / BroadcastChannel** — avoid duplicate client triggers across tabs.
5. **Optional per-repo warm throttle** (`github-cache-warm-repo:{userId}:{owner}/{repo}`) — skip if warmed recently when `refreshStaleOnly: true`. Defer to V1.1 if Prisma dedupe + user lock are sufficient.

Precedence: if user lock is held, API returns `already-running` and does not start work. Client throttle only prevents starting a POST; it does not override the server lock.

## Target Architecture

### New / changed modules

| Module | Role |
| --- | --- |
| `apps/web/src/lib/github-auth-context.ts` | Request and background GitHub auth-context resolution; no token logging. |
| `apps/web/src/lib/github-cache-descriptors.ts` | Stable cache-key builders, cache type → data class map, UI fragment keys, and shareability metadata. |
| `apps/web/src/lib/github-cache-policy.ts` | Freshness policies plus the shared-cache allowlist/deny guard, backed by descriptors. |
| `apps/web/src/lib/github-cache-warmer.ts` | Discovery, staged warm, result aggregation, structured logs. Accepts auth context and an existing lock lease; does not acquire a second lock for API/Inngest runs. |
| `apps/web/src/lib/repo-overview-cache-warmer.ts` | Shared server-side helpers for rendered README, overview PRs/issues/events/CI, commit activity, and layout file-tree cache. Server Actions delegate to these helpers. |
| `apps/web/src/lib/github-cache-status.ts` | Introspection without GitHub calls, using descriptors instead of duplicating private key builders. |
| `apps/web/src/app/api/github-cache/warm/route.ts` | Authenticated trigger. Generates `runId`, acquires lock, runs inline in dev or sends Inngest event in production. |
| `apps/web/src/components/github-cache/github-cache-warmer.tsx` | Client trigger (gated). |

### Auth context contract

Add an explicit `GitHubAuthContext` module and make warmer-used functions accept an injected context.

Required behavior:

- Request path: `getRequestGitHubAuthContext()` keeps existing behavior from `getServerSession()` + request headers.
- Background path: `resolveGitHubAuthContextForUser(userId)`:
  - reads the user’s GitHub `Account` row (`providerId = "github"`) from Prisma,
  - decrypts `account.accessToken` with Better Auth’s symmetric decrypt utility and `BETTER_AUTH_SECRET`, matching how PAT sign-in and `encryptOAuthTokens` store tokens,
  - creates an `Octokit({ auth: token })`,
  - optionally fetches `/user` to populate `githubUser`, but does not fail the warm solely because profile lookup is rate-limited,
  - never logs, returns, or stores the raw token outside the in-memory auth context.
- Refactor only the GitHub functions used by the warmer to accept an optional auth override first. Existing call sites remain unchanged and fall back to request context.
- Auth-injected/background paths must use lower-level helpers, not React `cache()` wrappers such as the current `getRepoPageData` export. Expose lower-level `*WithAuth`/helper functions for background use so React request memoization cannot capture request-only auth or headers.
- If background auth cannot resolve a token, the Inngest function records a failed warm result (`stage: "auth"`, `message: "github-token-unavailable"`), releases the lock by matching `runId`, and exits.

### Central cache descriptors

Do not let status, warmer, and tests reimplement private cache-key builders from `github.ts`.

Add descriptors for at least these V1 cache families:

- GitHub response caches: `user_repos`, `user_orgs`, `org_repos`, `repo`, `repo_tree`, `repo_readme`, `repo_issues`, `repo_pull_requests`, `repo_events`, `repo_workflow_runs`, `repo_branches`, `repo_tags`, `repo_releases`, `repo_contributors`, `repo_discussions`, `repo_nav_counts`, `repo_languages`.
- UI fragment caches: `repo_page_data`, `repo_file_tree`, `readme_html`, `overview_prs`, `overview_issues`, `overview_events`, `overview_commit_activity`, `overview_ci`.
- Shared public caches: `user_profile`, `user_public_orgs`, `user_events`, `trending_repos`.

Descriptor responsibilities:

- build the exact Redis key used by producers/consumers,
- identify the data class,
- indicate whether the cache is user-scoped, owner/repo-scoped, or shared-public,
- indicate whether `ghpub:*` sharing is allowed,
- provide a single source for status UI and regression tests.

`github.ts` private builder functions should be replaced or wrapped by descriptor calls as they are touched. V1 must at least centralize every key the warmer/status/test suite uses.

### Warmer public API

The warmer should not discover auth from request globals and should not acquire a second user lock when invoked from the API/Inngest path.

```ts
export type GithubCacheWarmMode = "quick" | "full";

export interface GithubCacheWarmOptions {
  mode: GithubCacheWarmMode;
  maxRepos?: number;
  maxConcurrentRepos?: number;
  refreshStaleOnly?: boolean;
}

export interface GithubCacheWarmRun {
  runId: string;
  source: "api-inline" | "inngest" | "debug" | "script";
  lockKey: string;
  lockAlreadyHeld: true;
}

export interface GithubCacheWarmResult {
  userId: string;
  runId: string;
  source: GithubCacheWarmRun["source"];
  discoveredRepos: number;
  selectedRepos: number;
  warmedRepos: number;
  skippedRepos: number;
  failedRepos: number;
  jobsQueued: number;
  durationMs: number;
  skippedReason?: "already-running" | "disabled" | "throttled" | "auth-unavailable" | "lock-lost";
  errors: Array<{ repo: string; stage: string; message: string }>;
}

export async function warmPersonalGithubCache(params: {
  authCtx: GitHubAuthContext;
  options: GithubCacheWarmOptions;
  run: GithubCacheWarmRun;
}): Promise<GithubCacheWarmResult>;
```

Script-only callers may use a small wrapper that acquires the lock before calling `warmPersonalGithubCache`; the core warmer should still receive an explicit `runId` lease.

### Cache policy module

```ts
export type GithubCacheDataClass =
  | "repo-chrome"
  | "repo-inventory"
  | "hot-list"
  | "ci"
  | "activity"
  | "code-tree"
  | "readme"
  | "stats"
  | "identity";

export interface GithubCachePolicy {
  freshForMs: number;
  refreshAfterMs: number;
  expireAfterMs: number | null;
}

export function getGithubCachePolicy(dataClass: GithubCacheDataClass): GithubCachePolicy;
export function isFresh(syncedAt: string | null, dataClass: GithubCacheDataClass): boolean;
export function shouldRefresh(syncedAt: string | null, dataClass: GithubCacheDataClass): boolean;

/** Types safe for ghpub:* — allowlist only; no repo-scoped or viewer-specific data. */
export function isShareableCacheType(cacheType: string): boolean;
```

Policy defaults (V1: prefer stale over empty; `expireAfterMs: null`):

| Data class | Examples | Fresh for | Refresh after |
| --- | --- | ---: | ---: |
| `hot-list` | open PRs, open issues, discussions | 1 min | 2 min |
| `ci` | workflow runs, check status | 30 sec | 1 min |
| `activity` | repo events | 2 min | 5 min |
| `repo-chrome` | repo page GraphQL bundle, nav counts | 10 min | 30 min |
| `code-tree` | layout file tree, default branch tree, branches, tags | 15 min | 60 min |
| `readme` | README raw response, rendered README HTML | 15 min | 60 min |
| `stats` | languages, contributors, commit activity | 6 hr | 24 hr |
| `repo-inventory` | user repos, org repos | 5 min | 15 min |
| `identity` | authenticated user, public user profile/orgs | 15 min | 60 min |

### Warm stage → data class → cache target map

Use this in the warmer and in status UI; do not infer ad hoc.

| Warm stage | Data class | Cache target(s) | Notes |
| --- | --- | --- | --- |
| `fetchAndCacheRepoPageData` | `repo-chrome` | `repo_page_data:{userId}:...`; `gh:{userId}:repo_nav_counts:*`; `gh:{userId}:repo_languages:*` | Store v2 envelope for `repo_page_data`. |
| `warmRepoFileTreeForLayout` | `code-tree` | `repo_file_tree:{owner}/{repo}` and `gh:{userId}:repo_tree:{owner}/{repo}:{defaultBranch}:1` | Use `defaultBranch` in V1 because layout fallback asks by branch name, not commit SHA. Do not warm only by SHA unless layout is refactored. |
| `warmRenderedReadmeHtml` | `readme` | `readme_html:{owner}/{repo}` | Extract shared cache-first helper from `readme-actions.ts`; `page.tsx`/Server Action delegates to it so warmed HTML is used before any GitHub fetch. |
| `getRepoReadme(owner, repo, defaultBranch)` | `readme` | `gh:{userId}:repo_readme:*` | Optional quick-stage if code page should be warm too; avoid duplicate GitHub fetch if rendered helper can reuse raw content. |
| `warmOverviewPRs` | `hot-list` | `overview_prs:{owner}/{repo}` plus `gh:{userId}:repo_pull_requests:*` | Shared helper delegates to `getRepoPullRequests`. |
| `warmOverviewIssues` | `hot-list` | `overview_issues:{owner}/{repo}` plus `gh:{userId}:repo_issues:*` | Shared helper filters PRs as overview does today. |
| `warmOverviewEvents` | `activity` | `overview_events:{owner}/{repo}` plus `gh:{userId}:repo_events:*` | Add real cached `getRepoEvents` wrapper in `github.ts` with `cacheType: "repo_events"`. |
| `warmOverviewCIStatus` | `ci` | `overview_ci:{owner}/{repo}` | Uses `fetchCheckStatusForRef`; also call `getRepoWorkflowRuns` when warming Actions page. |
| `getRepoWorkflowRuns` | `ci` | `gh:{userId}:repo_workflow_runs:*` | Keeps Actions page/API warm. |
| `warmLayoutMetadataQuick` | `code-tree` / `stats` | owner-scoped `repo_languages:*`, `repo_branches:*`, `repo_tags:*`, `repo_contributor_avatars:*` | Quick mode; supports layout/sidebar first paint. |
| `getRepoBranches` / `getRepoTags` | `code-tree` | `gh:{userId}:repo_branches:*`, `gh:{userId}:repo_tags:*`; owner-scoped `repo_branches:*`, `repo_tags:*` | Quick warms owner-scoped layout caches; full also refreshes user-scoped response caches. |
| `getRepoReleases` | `code-tree` | `gh:{userId}:repo_releases:*` | Full mode. |
| `getRepoContributors` | `stats` | `gh:{userId}:repo_contributors:*`; owner-scoped `repo_contributor_avatars:*` | Quick warms sidebar avatar cache; full also refreshes user-scoped contributor response cache. |
| `warmOverviewCommitActivity` | `stats` | `overview_commit_activity:{owner}/{repo}` | It persists overview cache. Do not call raw `getCommitActivity` without writing a cache. |
| `getRepoDiscussionsPage` | `hot-list` | `gh:{userId}:repo_discussions:*` | Full mode when discussions enabled. |
| `getUserRepos` / `getUserOrgs` / `getOrgRepos` | `repo-inventory` | `gh:{userId}:user_repos:*`, `gh:{userId}:user_orgs:*`, `gh:{userId}:org_repos:*` | Discovery only; not shareable. |

### Warm execution model

| Environment | Behavior |
| --- | --- |
| **Local dev** | `POST /api/github-cache/warm` validates session, resolves request auth, generates `runId`, acquires the Redis user lock, runs `warmPersonalGithubCache` inline when `GITHUB_CACHE_WARM_INLINE=1` or `NODE_ENV=development`, then releases by matching `runId`. |
| **Production** | Route validates session, generates `runId`, acquires the Redis user lock, sends Inngest event `github/cache.warm` with `{ userId, runId, lockKey, options }`, and returns `{ accepted: true, runId }` immediately. Worker verifies lock value equals `runId`, resolves background auth, runs warmer, stores result, and releases by matching `runId`. |
| **Client** | `github-cache-warmer.tsx` mounts only when `NEXT_PUBLIC_GITHUB_CACHE_WARM_ENABLED=1`; production should keep this off until Inngest + background auth are verified and `GITHUB_CACHE_WARM_PROD_ENABLED=1`. |

Never hold a 10-minute Redis lock across a dead serverless request without crash protection. Use lock TTL for crash safety and release in `finally` only via compare-and-delete.

### Lock acquire / verify / renew / release

API is the sole lock acquirer for API-triggered runs. The worker/core warmer must not call `SET NX` again for the same run.

Required lock helpers:

- `acquireGithubCacheWarmLock(userId, runId, ttlSeconds)` → `SET github-cache-warm-lock:{userId} runId NX EX ttlSeconds`
- `verifyGithubCacheWarmLock(userId, runId)` → `GET lockKey === runId`
- `renewGithubCacheWarmLock(userId, runId, ttlSeconds)` → compare value and extend TTL only if value matches
- `releaseGithubCacheWarmLock(userId, runId)` → atomic compare-and-delete only if value matches

Release must be atomic. Use Redis Lua / Upstash `eval` equivalent:

```lua
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
```

If the worker starts and the lock value is missing or different, it records `skippedReason: "lock-lost"` and exits without warming.

### Warm-run telemetry contract

Structured logs are required from the first implementation:

- `github_cache_warm.requested` — `userId`, `runId`, `mode`, `source`, `maxRepos`, `refreshStaleOnly`.
- `github_cache_warm.lock_acquired` / `already_running` / `lock_lost` — `userId`, `runId`, `lockKey`, `ttlSeconds`.
- `github_cache_warm.started` — `userId`, `runId`, `mode`, `selectedRepos`, `discoveredRepos`.
- `github_cache_warm.stage_completed` — `userId`, `runId`, `repo`, `stage`, `durationMs`, `cacheTargets`.
- `github_cache_warm.stage_failed` — `userId`, `runId`, `repo`, `stage`, `errorClass`, `message`.
- `github_cache_warm.completed` — `userId`, `runId`, counts, `durationMs`, `errorCount`.

Never log PATs, decrypted access tokens, response payloads, or raw request bodies. Repo names are acceptable for local/dev logs; if production logs are exported externally, hash `owner/repo` or make repo-name logging debug-only.

## Implementation Plan

### Phase 0: Fix shared cache safety and purge polluted keys (ship first)

**Target:** `apps/web/src/lib/github-cache-policy.ts`, `apps/web/src/lib/github-cache-descriptors.ts`, `apps/web/src/lib/github.ts`, one-time cleanup utility/script.

- [ ] Move shareability decisions out of inline `github.ts` into policy/descriptors.
- [ ] Use an **allowlist** for shareable types. Initial shareable set:
  - `user_profile`
  - `user_public_orgs`
  - `user_events`
  - `trending_repos`
- [ ] Add an explicit unsafe guard for repo/viewer-scoped families:
  - any `cacheType` starting with `repo_`,
  - any `cacheType` starting with `issue`,
  - any `cacheType` starting with `pull_request`,
  - exact org-scoped/viewer-sensitive types: `org`, `org_repos`, `org_members`,
  - `repo_contents`, `file_content`, `notifications`, `search_issues`, `authenticated_user`, `starred_repos`, `contributions`, `person_repo_activity`, `pr_bundle`.
- [ ] **Deny-list wording:** do not deny by substring `org`; `user_public_orgs` is intentionally kept because it is public user metadata. Deny exact org-scoped cache types instead.
- [ ] Replace inline `isShareableCacheType` in `github.ts` with import from policy/descriptors.
- [ ] Fix the misleading SECURITY comment to match the allowlist.
- [ ] Add optional `GITHUB_CACHE_SHARED_READ=0` to skip the shared-cache read branch during rollback/emergency response.
- [ ] Add a one-time polluted-key cleanup utility or documented admin command that scans/deletes unsafe shared keys, including:
  - `ghpub:repo_*`
  - `ghpub:issue*`
  - `ghpub:pull_request*`
  - `ghpub:org:*`
  - `ghpub:org_repos:*`
  - `ghpub:org_members:*`
  - `ghpub:file_content:*`
  - `ghpub:repo_contents:*`
- [ ] Unit test: no repo-scoped type is shareable; regression test listing former bad types.
- [ ] Manual validation: browse a private repo and confirm no new unsafe `ghpub:*` keys appear.

**Rollback:** shrinking writes is safe and preferred. `GITHUB_CACHE_SHARED_READ=0` is only for temporarily skipping shared reads if unexpected behavior appears.

**Validation:**

- [ ] Private repo issue/PR/tree/branch/workflow/nav data is never written to `ghpub:*`.
- [ ] User-scoped `gh:{userId}:*` behavior unchanged.
- [ ] Existing polluted `ghpub:repo_*` / `ghpub:issue*` / `ghpub:pull_request*` keys are purged or allowed to expire with a documented verification scan.

### Phase 1: Cache descriptors and freshness policy

**Targets:** `github-cache-descriptors.ts`, `github-cache-policy.ts`, `github.ts` key-builder call sites touched by the warmer/status.

- [ ] Implement central descriptors for V1 GitHub response caches and UI fragment caches.
- [ ] Export stable key-builder functions from descriptors; warmer/status/tests must use these instead of duplicating string formats.
- [ ] Refactor the touched private builders in `github.ts` to call descriptors or share the same builder implementation.
- [ ] Implement `getGithubCachePolicy`, `isFresh`, `shouldRefresh` in `github-cache-policy.ts`.
- [ ] Unit tests for policy table and descriptor key stability.
- [ ] Do not wire freshness decisions into every call site yet; use descriptors first for Phase 0, warmer, status, and tests.

### Phase 2: Repair Prisma sync-job dedupe semantics

**Target:** `apps/web/src/lib/github-sync-store.ts`.

- [ ] Change `enqueueGithubSyncJob` so a pre-existing failed row does not block future refreshes.
- [ ] Desired behavior:
  - missing row: create pending job as today,
  - existing `failed`: reset to `pending`, `attempts = 0`, `lastError = null`, update `payloadJson`, `nextAttemptAt = now`, `updatedAt = now`,
  - existing `pending`: update `payloadJson` and `updatedAt`; ensure `nextAttemptAt` is not pushed later than now for an explicit refresh,
  - existing `running`: leave it alone unless the existing timeout recovery marks it pending.
- [ ] Keep the `(userId, dedupeKey)` unique constraint.
- [ ] Add tests for failed-row revival, pending-row update, and concurrent insert race handling.

### Phase 3: Extract GitHub auth context for request + background execution

**Targets:** `github-auth-context.ts`, `github.ts`, warmer-used GitHub functions.

- [ ] Move `GitHubAuthContext` into an exported module.
- [ ] Implement request resolver by preserving current `getServerSession()` + header force-refresh behavior.
- [ ] Implement background resolver using Prisma `Account` + Better Auth symmetric decrypt with `BETTER_AUTH_SECRET`.
- [ ] Refactor warmer-used functions to accept an optional auth override through lower-level non-React-cache helpers:
  - discovery: `getUserRepos`, `getUserOrgs`, `getOrgRepos`,
  - repo chrome: `fetchAndCacheRepoPageDataWithAuth` / lower-level page-data helpers; do not call the React `cache()`-wrapped `getRepoPageData` from background auth-injected paths,
  - tree/readme/hot lists: `getRepoTree`, `getRepoReadme`, `getRepoPullRequests`, `getRepoIssues`,
  - CI/activity/stats: `getRepoWorkflowRuns`, cached `getRepoEvents`, `getRepoBranches`, `getRepoTags`, `getRepoReleases`, `getRepoContributors`, `getRepoDiscussionsPage`, `getCommitActivity` if persisted by a warmer helper.
- [ ] Existing UI call sites should keep working without passing auth.
- [ ] Inngest worker must use `resolveGitHubAuthContextForUser(userId)` and pass the resulting `authCtx` into the warmer.
- [ ] Add tests with mocked encrypted account token; no real token in fixtures.

### Phase 4: Repo page data stale-available

**Targets:** `repo-data-cache.ts`, `repo-data-cache-vc.ts`, `github.ts`, `updateCachedRepoPageDataNavCounts`.

- [ ] Store versioned wrapper:

```ts
type RepoPageDataEnvelope<T> =
  | { v: 2; syncedAt: string; data: T }
  | T; // legacy: raw payload until migrated
```

- [ ] `getCachedRepoPageData<T>` unwraps v2 and legacy raw `T`.
- [ ] `getCachedRepoPageDataEntry<T>` returns `{ data, syncedAt } | null`.
- [ ] `setCachedRepoPageData` writes v2, with no hard TTL or a very long TTL; policy drives refresh.
- [ ] `getRepoPageData`: if entry exists and `shouldRefresh(syncedAt, "repo-chrome")`, return data immediately and schedule one background `fetchAndCacheRepoPageData` per repo per throttle window.
- [ ] Use a small per-repo refresh lock such as `repo-page-refresh-lock:{userId}:{owner}/{repo}` (`SET NX EX`) so repeated requests do not stampede GitHub.
- [ ] Update `updateCachedRepoPageDataNavCounts` to unwrap v2 before merge and re-wrap v2 after updating.
- [ ] Re-export entry helpers from `repo-data-cache-vc.ts`.

**Validation:** stale page data returns without blocking; GitHub failure keeps stale UI.

### Phase 5: Cache status introspection

**Targets:** `github-sync-store.ts`, `repo-data-cache.ts`, `github-cache-status.ts`.

- [ ] Export `getGithubCacheEntrySyncedAt(userId, cacheKey)` or use full entry where cheaper.
- [ ] Repo page data status reads via `getCachedRepoPageDataEntry` from Phase 4; this is why status follows repo-page envelope work.
- [ ] UI fragment status uses descriptors:
  - if a cache has an envelope with `syncedAt`, show age/freshness,
  - if a legacy owner-scoped cache only stores raw data, show `present` / `missing` until migrated.
- [ ] `getRepoCacheStatus(userId, owner, repo)` must make no GitHub calls.
- [ ] Include sync job counts and failed-row summaries.

### Phase 6: Shared UI cache warm helpers

**Targets:** new `repo-overview-cache-warmer.ts`, existing `overview-actions.ts`, `readme-actions.ts`, `revalidate-actions.ts`, `repo-data-cache.ts` as needed.

- [ ] Extract shared helpers from Server Actions so the warmer can populate the exact caches the UI reads without importing app-route modules into `lib`.
- [ ] `warmRepoFileTreeForLayout(owner, repo, defaultBranch, authCtx)`:
  - calls `getRepoTree(owner, repo, defaultBranch, true, { authCtx })`,
  - builds `FileTreeNode[]`,
  - writes `setCachedRepoTree(owner, repo, tree)`,
  - records the user-scoped `gh:{userId}:repo_tree:*` key via `getRepoTree`.
- [ ] `getRepoReadmeHtmlCacheFirst(owner, repo, defaultBranch, authCtx, options?)` shared helper:
  - reads `getCachedReadmeHtml(owner, repo)` before any GitHub call,
  - on cache hit, returns cached HTML immediately and schedules/throttles a background refresh,
  - on true miss, fetches README content, renders HTML with the existing markdown renderer, writes `setCachedReadmeHtml(owner, repo, html)`, and returns it,
  - supports an explicit `forceRefresh` path for manual refresh Server Actions,
  - optionally also populates `getRepoReadme` raw response cache without a duplicate GitHub call.
- [ ] `page.tsx` must use the cache-first README helper (or `revalidateReadme` must become that cache-first wrapper and move force refresh to a separate helper) so warmed `readme_html:{owner}/{repo}` is actually used on first navigation.
- [ ] `warmOverviewPRs` and `warmOverviewIssues`:
  - reuse `getRepoPullRequests` / `getRepoIssues`,
  - transform exactly like current overview actions,
  - write `overview_prs` / `overview_issues`.
- [ ] Add real cached `getRepoEvents(owner, repo, perPage, { authCtx })` in `github.ts`:
  - descriptor/cache type `repo_events`,
  - `readLocalFirstGitData`,
  - `processGitDataSyncJob` support,
  - not shareable.
- [ ] `warmOverviewEvents` uses the cached `getRepoEvents` wrapper and writes `overview_events`.
- [ ] `warmOverviewCIStatus` uses `fetchCheckStatusForRef` and writes `overview_ci`.
- [ ] Layout metadata warm helpers are explicit, not optional:
  - quick mode writes owner-scoped `repo_languages` from repo page data (`setCachedRepoLanguages`) and warms `repo_branches` / `repo_tags` for `CodeContentWrapper`,
  - quick mode warms contributor avatars (`repo_contributor_avatars`) with the existing sidebar-sized limit when the repo is not empty; stage failures are non-fatal,
  - full mode refreshes the same owner-scoped layout caches plus the user-scoped `gh:{userId}:repo_branches:*`, `repo_tags:*`, and `repo_contributors:*` response caches.
- [ ] `warmOverviewCommitActivity` writes `overview_commit_activity`; do not call raw `getCommitActivity` unless the result is persisted.
- [ ] Existing Server Actions in `overview-actions.ts`, `readme-actions.ts`, and `revalidate-actions.ts` delegate to the shared helpers to avoid divergent behavior.

### Phase 7: Personal repo discovery and staged warming

**Target:** `github-cache-warmer.ts`.

- [ ] `discoverPersonalRepos(authCtx)` via `getUserRepos("updated", 100, { authCtx })`, `getUserOrgs(50, { authCtx })`, `getOrgRepos(org, ..., { authCtx })`.
- [ ] Define `WarmableRepo` with owner, repo/name, full name, private flag, pushed/updated timestamps, default branch if known.
- [ ] Dedupe by lowercase `owner/repo`.
- [ ] Sort by `pushedAt` then `updatedAt`, newest first.
- [ ] Respect `maxRepos`.

**Quick mode stage order per repo:**

1. `fetchAndCacheRepoPageData(owner, repo, { authCtx })` first; this provides default branch, latest commit, permissions, nav counts, languages.
2. If repo is not empty, `warmRepoFileTreeForLayout(owner, repo, defaultBranch, authCtx)` using **default branch name** to match layout.
3. `warmLayoutMetadataQuick(owner, repo, pageData, authCtx)`: owner-scoped languages from page data, owner-scoped branches/tags, and sidebar contributor avatars for layout/sidebar first paint.
4. If repo is not empty, `getRepoReadmeHtmlCacheFirst(owner, repo, defaultBranch, authCtx)` so warmed `readme_html` is used by `page.tsx`.
5. `warmOverviewPRs`, `warmOverviewIssues`, `warmOverviewEvents`, `warmOverviewCIStatus`.
6. `getRepoWorkflowRuns(owner, repo, 50, { authCtx })` for Actions page cache.

**Full mode adds:** releases, discussions (when enabled), `warmOverviewCommitActivity`, and full refresh of user-scoped branch/tag/contributor response caches in addition to the owner-scoped layout caches already warmed in quick mode.

**Commit activity:** full mode may call `warmOverviewCommitActivity` because it persists `overview_commit_activity`. If a user-scoped stats cache is desired, add a `repo_commit_activity` `readLocalFirstGitData` wrapper before relying on it for status.

**Limits:** `DEFAULT_MAX_REPOS = 100`, `DEFAULT_CONCURRENT_REPOS = 3`, `DEFAULT_CONCURRENT_STAGES_PER_REPO = 2`.

Per-stage errors are aggregated; repo warming continues unless auth is lost or the run lock is lost.

### Phase 8: Locks, warm API, and Inngest

**Files:** `api/github-cache/warm/route.ts`, `github-cache-warmer.ts`, `github-cache-lock.ts` if split, new Inngest function registered in `app/api/inngest/route.ts`.

- [ ] API route validates session and zod body (`mode`, `maxRepos`, `refreshStaleOnly`).
- [ ] API route generates `runId = crypto.randomUUID()` and acquires `github-cache-warm-lock:{userId}` with that value.
- [ ] If lock exists, route returns `{ accepted: false, skippedReason: "already-running" }`.
- [ ] Inline dev path:
  - resolve request auth,
  - call warmer with `{ runId, lockAlreadyHeld: true }`,
  - release lock in `finally` using compare-and-delete.
- [ ] Production path:
  - only enabled when `GITHUB_CACHE_WARM_PROD_ENABLED=1`,
  - send Inngest event `github/cache.warm` with `{ userId, runId, lockKey, options }`,
  - return `{ accepted: true, runId }` immediately,
  - worker verifies lock value equals `runId`, resolves background auth, renews lock as needed, calls warmer, stores result, releases lock by matching `runId`.
- [ ] If production warm is disabled, route releases the lock and returns `{ accepted: false, skippedReason: "disabled" }`.
- [ ] Response never includes PAT; do not log body.
- [ ] Store last `GithubCacheWarmResult` in Redis `github-cache-warm-last:{userId}` for debug UI with a reasonable TTL; no tokens or response payloads.

### Phase 9: Browser-session warmer (gated)

**Target:** `github-cache-warmer.tsx` in `(app)/layout.tsx`.

- [ ] Render only if `NEXT_PUBLIC_GITHUB_CACHE_WARM_ENABLED === "1"`.
- [ ] Use localStorage key `better-hub:github-cache:last-warm` with a throttle window.
- [ ] Use BroadcastChannel when available so multiple tabs do not all POST.
- [ ] POST warm API with quick mode and safe defaults.
- [ ] Quiet retry on network failures only.
- [ ] No spinner. If UI is added later, use skeleton-compatible background/status affordances.

### Phase 10: Debug / cache status UI

**Route:** `apps/web/src/app/(app)/debug/github-cache/page.tsx` (auth required).

- [ ] Show user id/login, lock status, last warm result, sync job counts, failed jobs, and per-repo status from Phase 5.
- [ ] Manual quick/full warm buttons call the same API route.
- [ ] Show which cache targets are present/fresh/stale/missing using descriptors.
- [ ] Never show tokens or raw cached payloads.

### Phase 11: Docs, env example, and AGENTS.md

- [ ] Add short section to repo `AGENTS.md`: env flags, warm modes, debug route, Redis key patterns, lock semantics, background auth resolver, “do not expand shareable cache without security review”.
- [ ] Update `apps/web/.env.example` with cache flags and safe defaults:
  - `NEXT_PUBLIC_GITHUB_CACHE_WARM_ENABLED=0`
  - `GITHUB_CACHE_WARM_INLINE=1` (local/dev only; comment accordingly)
  - `GITHUB_CACHE_WARM_PROD_ENABLED=0`
  - `GITHUB_CACHE_SHARED_READ=1`
  - optionally commented tuning vars: `GITHUB_CACHE_WARM_MAX_REPOS`, `GITHUB_CACHE_WARM_CONCURRENCY`, `GITHUB_CACHE_WARM_LOCK_TTL_SECONDS`
- [ ] Document the one-time unsafe `ghpub:*` cleanup command/utility and validation scans.
- [ ] Document that expanding shared-cache allowlist requires security review.

### Phase 12 (optional): Durable Postgres cache

- [ ] Write-through `GithubCacheEntry` for selected types; size limits; hydrate on Redis miss.
- [ ] No new migration (table exists).

## Proposed Implementation Order

| Order | Phase | Milestone |
| ---: | --- | --- |
| 1 | **0** Shared cache fix + polluted-key cleanup | Security — deployable alone |
| 2 | 1 Cache descriptors + policy | Foundation; removes key-builder drift |
| 3 | 2 Sync-job dedupe repair | Prevent failed rows from blocking refreshes |
| 4 | 3 Background auth context | Enables Inngest/worker warm |
| 5 | 4 Repo page SWR | Faster repo chrome and status entry data |
| 6 | 5 Status introspection | Debug prep |
| 7 | 6 Shared UI cache warm helpers | Warms what UI actually reads |
| 8 | 7 Warmer discovery + stages | Core warmer |
| 9 | 8 API + Inngest + locks | Safe prod trigger |
| 10 | 9 Client (gated) | Auto warm in dev / later prod |
| 11 | 10 Debug UI | Observability |
| 12 | 11 Docs/env/AGENTS | Handoff |
| 13 | 12 Postgres | Optional |

**First useful milestone (local):** Phases 0, 1, 2, 3, 4, 5, 6, 7, 8 (inline), 9 (env on), 10.

**First production-safe milestone:** Phase 0 plus Phases 1–8 with background auth and Inngest verified. Keep client trigger off in production until then.

## Testing Strategy

### Unit

- [ ] Policy freshness; shareable allowlist regression; former bad types are not shareable.
- [ ] Descriptor key builders produce the exact keys existing producers/consumers use.
- [ ] Unsafe shared-cache cleanup matches `ghpub:repo_*`, `ghpub:issue*`, `ghpub:pull_request*`, exact org-scoped patterns, without deleting `ghpub:user_public_orgs:*`.
- [ ] Repo page envelope unwrap (legacy + v2).
- [ ] `updateCachedRepoPageDataNavCounts` unwraps and re-wraps v2 data.
- [ ] Sync-job enqueue revives failed rows and updates pending rows.
- [ ] Background auth resolver decrypts mocked encrypted account token and does not log it.
- [ ] Discovery dedupe/sort; warm error aggregation.
- [ ] Lock acquire/verify/renew/release; release only deletes when stored value matches `runId`.
- [ ] Cached `getRepoEvents` wrapper uses `readLocalFirstGitData` and enqueues `repo_events` jobs.

### Integration

- [ ] Warm API 401 without session; 400 bad body.
- [ ] Lock: second concurrent request returns `already-running`.
- [ ] Inline dev warm releases lock on success and failure.
- [ ] Inngest handler verifies lock, resolves auth by `userId`, releases lock on success/failure, and records `auth-unavailable` without leaking tokens.
- [ ] Warmed repo navigation hits `repo_page_data`, `repo_file_tree`, `readme_html`, owner-scoped layout metadata (`repo_languages`, `repo_branches`, `repo_tags`, `repo_contributor_avatars`), `overview_*`, and `repo_workflow_runs` caches without blocking on GitHub.
- [ ] Existing Server Actions still produce the same data after delegating to shared helpers.

### Manual (local)

```bash
docker compose up -d
cd apps/web && bunx prisma generate && cd ../..
# .env.local: UPSTASH_*, NEXT_PUBLIC_GITHUB_CACHE_WARM_ENABLED=1, GITHUB_CACHE_WARM_INLINE=1
bun dev
```

- [ ] Sign in; trigger quick warm from debug page.
- [ ] `docker exec -it better-hub-redis redis-cli --scan --pattern 'gh:*' | head`
- [ ] `docker exec -it better-hub-redis redis-cli --scan --pattern 'repo_page_data:*' | head`
- [ ] `docker exec -it better-hub-redis redis-cli --scan --pattern 'overview_*' | head`
- [ ] Confirm no new unsafe keys after browsing private repos:
  - `ghpub:repo_*`
  - `ghpub:issue*`
  - `ghpub:pull_request*`
  - `ghpub:org:*`, `ghpub:org_repos:*`, `ghpub:org_members:*`
- [ ] Stale repo page renders with GitHub blocked.
- [ ] Debug page shows freshness/presence and warm errors; no tokens exposed.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Shared cache leak (current) | Cross-user private data | **Phase 0 first**, allowlist, polluted-key cleanup |
| Warmer populates wrong cache | First navigation still blocks | Phase 6 warms `repo_file_tree`, cache-first `readme_html`, `overview_*`, owner-scoped layout metadata, and user-scoped GitHub response caches |
| Long warm in HTTP handler | Timeouts, stuck lock | Inngest + compare-release; inline dev only |
| Token unavailable in Inngest worker | Prod warm blocked | Background auth resolver; prod warm env gate; record `auth-unavailable` |
| API and worker both acquire lock | Worker skips own run | API is sole acquirer for API-triggered runs; worker verifies passed `runId` only |
| Lock expires before worker starts | Duplicate run possible | TTL sized for queue latency; worker exits `lock-lost` if value missing/different; consider renewal once started |
| Failed Prisma sync job blocks refresh | Stale data forever for dedupe key | Phase 2 failed-row revival |
| Legacy `repo_page_data` shape | Parse errors | Envelope v2 + raw fallback |
| `getRepoEvents` uncached | Warm activity does not persist | Add real cached `repo_events` wrapper and overview cache writer |
| `getCommitActivity` uncached | Wasted API in full mode | Only call via helper that writes `overview_commit_activity`, or add user-scoped wrapper later |
| Multi-tab / multi-layer coordination | Rate limits | Document precedence; atomic user lock; client throttle/BroadcastChannel |
| Redis restart | Cold cache | Accept V1; Phase 12 optional |
| Phase 3 / Phase 0 behavior change | Rollback needed | Optional flags; Phase 0 is strictly safer |

## Success Criteria

- [ ] Phase 0 deployed: no repo-scoped/viewer-scoped data in `ghpub:*`.
- [ ] Existing unsafe `ghpub:*` keys are purged or verified expired.
- [ ] After sign-in (dev, flag on), warm runs once per throttle window.
- [ ] Warmed repos: layout/overview use `repo_page_data`, `repo_file_tree`, cache-first `readme_html`, owner-scoped layout metadata (`repo_languages`, `repo_branches`, `repo_tags`, `repo_contributor_avatars`), `overview_*`, and `repo_workflow_runs` caches without blocking on GitHub.
- [ ] Background refresh without loading spinners on hot paths.
- [ ] GitHub outage: stale repo page still renders.
- [ ] Debug page shows freshness, presence, job backlog, last warm result, and errors; no tokens exposed.
- [ ] Inngest worker can warm from `{ userId, runId }` using background auth, or production warm remains disabled by env until it can.
- [ ] Failed `GithubSyncJob` rows do not permanently block future refreshes.
- [ ] `bun lint`, `bun fmt:check`, `bun typecheck`, `bun test` pass.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_GITHUB_CACHE_WARM_ENABLED` | `1` enables client warmer; default `0` in `.env.example` |
| `GITHUB_CACHE_WARM_INLINE` | `1` allows synchronous warm in API route for local/dev |
| `GITHUB_CACHE_WARM_PROD_ENABLED` | `1` allows API to enqueue production Inngest warm; default `0` until verified |
| `GITHUB_CACHE_SHARED_READ` | Optional `0` to disable shared-cache reads during rollback/emergency response |
| `GITHUB_CACHE_WARM_MAX_REPOS` | Optional default max repo count override |
| `GITHUB_CACHE_WARM_CONCURRENCY` | Optional default repo concurrency override |
| `GITHUB_CACHE_WARM_LOCK_TTL_SECONDS` | Optional lock TTL override; default should cover expected Inngest latency + warm time |

## Later Enhancements

- [ ] CLI `apps/web/scripts/warm-github-cache.mts` using the same background auth resolver and lock helpers.
- [ ] Webhooks for invalidation.
- [ ] Cache size accounting and pruning.
- [ ] UI badge for stale/fresh/offline.
- [ ] Adaptive warming from `recent-views` / pinned repos.
- [ ] Refactor layout to use user-scoped `gh:{userId}:repo_tree:*` directly, then retire owner-scoped `repo_file_tree` if safe.
