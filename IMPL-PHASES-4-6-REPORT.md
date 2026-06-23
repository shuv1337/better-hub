# IMPL Phases 4-6 Report

## Scope

Implemented Phases 4, 5, and 6 only from `PLAN-personal-github-cache.md` on branch `feat/personal-github-cache`.

Phase 7 and later were not started.

## Commits

- Phase 4: `feat(github-cache): keep repo page data stale-available`
- Phase 5: `feat(github-cache): add repo cache status introspection`
- Phase 6: `feat(github-cache): add shared overview cache warmers`

## Phase 4 - Repo Page Data Stale-Available

Implemented a v2 repo page data envelope with `syncedAt`, legacy raw payload unwrapping, entry reads via `getCachedRepoPageDataEntry`, and no hard TTL on new repo page writes. `getRepoPageData` now returns cached data immediately and starts a throttled background refresh when repo chrome should refresh.

Files changed:
- `apps/web/src/lib/repo-data-cache.ts`
- `apps/web/src/lib/repo-data-cache-vc.ts`
- `apps/web/src/lib/github.ts`
- `apps/web/src/lib/repo-data-cache.test.ts`

Gate after Phase 4:
- `bun run typecheck`: exit 0; root script prints Bun exec usage in this environment
- `bun run lint`: exit 0 with existing warning baseline
- `cd apps/web && ./node_modules/.bin/vitest run`: 7 files, 54 tests passed

## Phase 5 - Cache Status Introspection

Added Redis-only cache status introspection for repo caches. Status uses descriptor-built keys, reads repo page data through the Phase 4 entry helper, reports envelope freshness when `syncedAt` exists, reports raw owner-scoped UI fragments as present/missing, and includes Prisma sync job counts plus failed summaries without making GitHub calls.

Files changed:
- `apps/web/src/lib/github-sync-store.ts`
- `apps/web/src/lib/github-sync-store.test.ts`
- `apps/web/src/lib/github-cache-status.ts`
- `apps/web/src/lib/github-cache-status.test.ts`

Gate after Phase 5:
- `bun run typecheck`: exit 0; root script prints Bun exec usage in this environment
- `bun run lint`: exit 0 with existing warning baseline
- `cd apps/web && ./node_modules/.bin/vitest run`: 8 files, 57 tests passed

## Phase 6 - Shared UI Cache Warm Helpers

Added `repo-overview-cache-warmer.ts` with shared helpers for:
- layout file tree warming into `repo_file_tree`
- cache-first rendered README HTML
- overview PRs, issues, events, CI, and commit activity
- layout metadata warm helpers for languages, branches, tags, and contributor avatars

Existing Server Actions in `overview-actions.ts`, `readme-actions.ts`, and `revalidate-actions.ts` now delegate to the shared helpers instead of duplicating cache writers.

The README read path is genuinely cache-first now: `apps/web/src/app/(app)/repos/[owner]/[repo]/page.tsx` calls `getRepoReadmeHtmlCacheFirst`, which reads `getCachedReadmeHtml(owner, repo)` before any GitHub README call. On cache hit it returns warmed `readme_html:{owner}/{repo}` immediately and schedules a throttled background refresh. Manual README revalidation uses the same helper with `forceRefresh: true`.

Files changed:
- `apps/web/src/lib/repo-overview-cache-warmer.ts`
- `apps/web/src/lib/repo-overview-cache-warmer.test.ts`
- `apps/web/src/lib/github.ts`
- `apps/web/src/app/(app)/repos/[owner]/[repo]/page.tsx`
- `apps/web/src/app/(app)/repos/[owner]/[repo]/overview-actions.ts`
- `apps/web/src/app/(app)/repos/[owner]/[repo]/readme-actions.ts`
- `apps/web/src/app/(app)/repos/[owner]/[repo]/revalidate-actions.ts`

Final gate after Phase 6:
- `bun run typecheck`: exit 0; root script prints Bun exec usage in this environment
- `bun run lint`: exit 0 with existing warning baseline
- `cd apps/web && ./node_modules/.bin/vitest run`: 9 files, 60 tests passed

Final Vitest result:
```
Test Files  9 passed (9)
Tests       60 passed (60)
```

## Notes

No remote, push, or PR commands were run for this implementation pass.

The required root `bun run typecheck` command exits 0 but prints Bun exec usage in this environment; the report records that behavior because it is the command requested in the phase prompt.
