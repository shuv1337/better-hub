# IMPL Phases 1-3 Report

## Scope

Implemented Phases 1, 2, and 3 only from `PLAN-personal-github-cache.md` on branch `feat/personal-github-cache`.

Phase 4 and later were not started.

## Commits

- Phase 1: `eba07cf feat(github-cache): add descriptors and freshness policy`
- Phase 2: `003f1cb fix(github-cache): revive failed sync jobs`
- Phase 3: included in the final commit with this report

## Phase 1 - Cache Descriptors and Freshness Policy

Added a typed descriptor registry for GitHub cache entries and moved cache key construction into one shared surface. The policy layer now derives shareability, freshness, and refresh behavior from descriptors instead of ad hoc cache-type checks.

Files changed:
- `apps/web/src/lib/github-cache-descriptors.ts`
- `apps/web/src/lib/github-cache-descriptors.test.ts`
- `apps/web/src/lib/github-cache-policy.ts`
- `apps/web/src/lib/github-cache-policy.test.ts`
- `apps/web/src/lib/github.ts`
- `apps/web/src/lib/readme-cache.ts`
- `apps/web/src/lib/repo-data-cache.ts`

Gate after Phase 1:
- `bun run typecheck`: passed, but the root script only prints Bun exec usage in this environment
- `bun run --workspaces typecheck`: passed
- `bun run lint`: passed with existing warnings only
- `apps/web vitest`: passed, 4 files and 41 tests

## Phase 2 - Failed Sync Job Requeue

Updated GitHub sync job enqueueing so retryable failed jobs are revived instead of permanently blocking future cache refreshes for the same user/dedupe key. Pending jobs are refreshed with latest payload and due time; running jobs are left untouched.

Files changed:
- `apps/web/src/lib/github-sync-store.ts`
- `apps/web/src/lib/github-sync-store.test.ts`

Gate after Phase 2:
- `bun run typecheck`: passed, but the root script only prints Bun exec usage in this environment
- `bun run --workspaces typecheck`: passed
- `bun run lint`: passed with existing warnings only
- `apps/web vitest`: passed, 5 files and 46 tests

## Phase 3 - Worker Auth Context and Repo Events Local-First Cache

Extracted GitHub auth context resolution into a reusable module that can resolve request-session auth or decrypt the latest stored GitHub account token for a specific user. The helper avoids logging token material and tolerates profile lookup failures by returning a usable Octokit context.

The existing `github.ts` request path now imports the shared request auth context and exposes worker-friendly auth injection for local-first GitHub reads. Repo events now use the local-first cache/sync path and include a `repo_events` sync job type.

No Inngest worker was present in the current codebase, so there was no worker entrypoint to wire in this phase. `resolveGitHubAuthContextForUser` and `fetchAndCacheRepoPageDataWithAuth` are ready for later worker phases.

Files changed:
- `apps/web/src/lib/github-auth-context.ts`
- `apps/web/src/lib/github-auth-context.test.ts`
- `apps/web/src/lib/github.ts`
- `IMPL-PHASES-1-3-REPORT.md`

Final Phase 3 gate:
- `bun run typecheck`: passed, but the root script only prints Bun exec usage in this environment
- `bun run --workspaces typecheck`: passed
- `bun run lint`: passed with existing warnings only
- `apps/web vitest`: passed, 6 files and 49 tests

Final Vitest result:
```
Test Files  6 passed (6)
Tests  49 passed (49)
```

## Notes

The app-local pnpm bootstrap can create `apps/web/node_modules`, `apps/web/pnpm-lock.yaml`, and `apps/web/pnpm-workspace.yaml`, which cause Better Auth type skew in this worktree. Those generated app-local artifacts were removed before gates. The apps/web Vitest gate was run from `apps/web` with the root workspace bin path and `--config.verify-deps-before-run=ignore`.

No push was performed.

