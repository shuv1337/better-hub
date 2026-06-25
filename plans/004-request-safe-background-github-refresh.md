# Plan 004: Make background GitHub refreshes request-lifetime safe

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6c18b28..HEAD -- apps/web/src/lib/github.ts apps/web/src/lib/github-sync-store.ts apps/web/src/lib/github*.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/003-fix-github-user-profile-cache.md
- **Category**: bug
- **Planned at**: commit `6c18b28`, 2026-06-25

## Why this matters

Several stale-cache paths intentionally return cached data and refresh GitHub data in the background. In a serverless/request runtime, plain unawaited promises can be terminated after the response is sent. The lazy fix is to keep the current local-first design but register those background promises with `waitUntil` so the platform knows they are part of the request's background work.

## Current State

- `readLocalFirstGitData` returns stale cached data and calls `enqueueGitDataSync`.
- `enqueueGitDataSync` calls `triggerGitDataSyncDrain(authCtx)`.
- `triggerGitDataSyncDrain` starts an untracked async IIFE.
- `getRepoPageData` calls `scheduleRepoPageDataRefresh` when cached repo page data is stale.
- `scheduleRepoPageDataRefresh` starts an untracked async IIFE.

Current excerpts:

```ts
// apps/web/src/lib/github.ts:2420
function triggerGitDataSyncDrain(authCtx: GitHubAuthContext) {
  if (githubSyncDrainingUsers.has(authCtx.userId)) return;

  githubSyncDrainingUsers.add(authCtx.userId);
  void (async () => {
    try {
      for (let round = 0; round < 3; round++) {
        const processed = await drainGitDataSyncQueue(authCtx, 4);
        if (processed === 0) break;
      }
    } finally {
      githubSyncDrainingUsers.delete(authCtx.userId);
    }
  })();
}
```

```ts
// apps/web/src/lib/github.ts:7027
function scheduleRepoPageDataRefresh(authCtx: GitHubAuthContext, owner: string, repo: string): void {
  void (async () => {
    const { tryAcquireRepoPageRefreshLock } = await import("@/lib/repo-data-cache");
    const acquired = await tryAcquireRepoPageRefreshLock(authCtx.userId, owner, repo);
    if (!acquired) return;
    await fetchAndCacheRepoPageDataWithAuth(authCtx, owner, repo);
  })().catch((error) => {
    console.error(`[getRepoPageData] Background refresh failed for ${owner}/${repo}:`, error);
  });
}
```

Repo conventions to match:

- `@vercel/functions` is already installed and imported elsewhere.
- Errors in background refreshes should be logged without secrets.
- Existing queue dedupe and locks should stay intact.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Focused tests | `cd apps/web && bun test -- --run src/lib/github-background-refresh.test.ts src/lib/repo-data-cache.test.ts src/lib/github-sync-store.test.ts` | all tests pass |
| All app tests | `cd apps/web && bun test -- --run` | all tests pass |
| Typecheck | `bun typecheck` | exit 0, no TypeScript errors |
| Lint | `bun lint` | exit 0 |

## Scope

**In scope**:

- `apps/web/src/lib/github.ts`
- New focused tests under `apps/web/src/lib/`

**Out of scope**:

- Replacing the existing sync queue with Inngest.
- Changing cache freshness policies.
- Changing warm lock semantics.
- Refactoring `github.ts` broadly.

## Git Workflow

- Branch: `advisor/004-request-safe-background-github-refresh`
- Commit message style: `fix: register github refresh work with waitUntil`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a tiny background runner

In `apps/web/src/lib/github.ts`, import `waitUntil` from `@vercel/functions` if not already present. Add a small helper near the queue code:

```ts
function runGithubBackgroundTask(task: Promise<unknown>): void {
  waitUntil(task.catch((error) => {
    console.error("[github] background task failed", error);
  }));
}
```

If `waitUntil` is not safe outside Vercel, wrap it with a try/catch and fall back to `void task`. Do not add a new dependency.

**Verify**: `bun typecheck` -> exit 0.

### Step 2: Register sync queue draining

Change `triggerGitDataSyncDrain` so the async IIFE is assigned to a promise and passed to `runGithubBackgroundTask`. Preserve:

- Per-user in-memory `githubSyncDrainingUsers` guard.
- Three rounds.
- `finally` cleanup.

**Verify**: `cd apps/web && bun test -- --run src/lib/github-sync-store.test.ts` -> existing sync-store tests still pass.

### Step 3: Register repo page refresh

Change `scheduleRepoPageDataRefresh` so its async work is passed to `runGithubBackgroundTask`. Preserve:

- `tryAcquireRepoPageRefreshLock`.
- Existing `fetchAndCacheRepoPageDataWithAuth(authCtx, owner, repo)`.
- Error message without token values.

**Verify**: `cd apps/web && bun test -- --run src/lib/repo-data-cache.test.ts` -> existing repo-data-cache tests still pass.

### Step 4: Add focused tests for waitUntil registration

Create `apps/web/src/lib/github-background-refresh.test.ts` if practical. Mock `@vercel/functions` and the cache helpers. Test:

- A stale cached repo page schedules a `waitUntil` task.
- A stale local-first GitHub cache schedules queue draining through `waitUntil`.
- Fresh cached data does not schedule unnecessary refresh.

If importing `github.ts` directly makes this test too brittle because the file is large, extract only the new `runGithubBackgroundTask` helper to a tiny `github-background.ts` module and test that helper plus one caller.

**Verify**: `cd apps/web && bun test -- --run src/lib/github-background-refresh.test.ts` -> all tests pass.

## Test Plan

Use mocks rather than real Redis or GitHub. The regression test should fail if a future edit replaces `waitUntil(task)` with a plain `void task`.

## Done Criteria

- [ ] Stale cache refreshes are registered with `waitUntil`.
- [ ] Existing dedupe/lock behavior is unchanged.
- [ ] No token values are logged.
- [ ] Focused tests pass.
- [ ] `bun typecheck`, `bun lint`, and `cd apps/web && bun test -- --run` pass.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- `@vercel/functions.waitUntil` cannot be imported in this module without breaking local tests.
- The change requires replacing the sync queue architecture.
- Background tasks need request headers after the response lifecycle.

## Maintenance Notes

Future stale-while-revalidate paths should use the same helper. Reviewers should search for `void (async () =>` in server code and ask whether it needs `waitUntil`.

