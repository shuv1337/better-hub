# Phase 0 Implementation Report

## Scope

Implemented Phase 0 only: the ship-first shared-cache security fix for `ghpub:*`.
Later phases from `PLAN-personal-github-cache.md` are not done.

## Files Changed

- `apps/web/src/lib/github-cache-policy.ts`
  - New shared-cache policy module.
  - Owns `isShareableCacheType`, `isUnsafeSharedCacheType`, and `isSharedCacheReadEnabled`.
- `apps/web/src/lib/github.ts`
  - Removed inline `SHAREABLE_CACHE_TYPES`.
  - Imports shared-cache policy from `github-cache-policy.ts`.
  - Keeps repo/org/viewer-sensitive data user-scoped.
  - Honors `GITHUB_CACHE_SHARED_READ=0` for shared-cache read checks.
- `apps/web/src/lib/github-cache-policy.test.ts`
  - Adds Vitest coverage for allowlisted public types and former unsafe shared types.
- `apps/web/scripts/purge-unsafe-shared-github-cache.ts`
  - Adds one-time Redis cleanup utility for polluted unsafe `ghpub:*` keys.
- `apps/web/.env.example`
  - Documents `GITHUB_CACHE_SHARED_READ=1`.

## Shared Cache Policy

Allowlisted shared cache types:

- `user_profile`
- `user_public_orgs`
- `user_events`
- `trending_repos`

Explicit unsafe guard:

- Any cache type starting with `repo_`
- Any cache type starting with `issue`
- Any cache type starting with `pull_request`
- Exact unsafe cache types:
  - `repo`
  - `org`
  - `org_repos`
  - `org_members`
  - `repo_contents`
  - `file_content`
  - `notifications`
  - `search_issues`
  - `authenticated_user`
  - `starred_repos`
  - `contributions`
  - `person_repo_activity`
  - `pr_bundle`

The policy intentionally does not deny by substring `org`; `user_public_orgs` remains shareable public metadata.

`GITHUB_CACHE_SHARED_READ=0` skips shared-cache reads in both `readLocalFirstGitData` and the shared-refresh short-circuit in `enqueueGitDataSync`. Shared writes are still controlled only by the allowlist.

## Cleanup Utility

Utility:

```bash
cd apps/web
bun run scripts/purge-unsafe-shared-github-cache.ts --dry-run
bun run scripts/purge-unsafe-shared-github-cache.ts
```

Scans and deletes:

- `ghpub:repo_*`
- `ghpub:issue*`
- `ghpub:pull_request*`
- `ghpub:org:*`
- `ghpub:org_repos:*`
- `ghpub:org_members:*`
- `ghpub:file_content:*`
- `ghpub:repo_contents:*`

It does not match `ghpub:user_public_orgs:*`.

## Gate Output

```text
$ bun run typecheck
$ bun -r exec tsc --noEmit
Usage: bun exec <script>

Execute a shell script directly from Bun.

EXIT_CODE=0
```

```text
$ bun run --workspaces typecheck
@better-hub/web typecheck: Exited with code 0

EXIT_CODE=0
```

```text
$ bun run lint
$ oxlint apps packages
Found 62 warnings and 0 errors.
Finished in 34ms on 469 files with 93 rules using 24 threads.

EXIT_CODE=0
```

```text
$ cd apps/web
$ PATH=$PWD/../../node_modules/.bin:$PATH COREPACK_ENABLE_PROJECT_SPEC=0 pnpm --config.verify-deps-before-run=ignore test -- --run
$ vitest -- --run

 RUN  v4.0.18 /home/shuv/.herdr/worktrees/better-hub/feat-personal-github-cache/apps/web

 ✓ src/lib/github-cache-policy.test.ts (4 tests) 2ms
 ✓ src/lib/extract-snippet.test.ts (31 tests) 5ms
 ✓ src/app/(app)/repos/[owner]/[repo]/commits/actions.test.ts (1 test) 75ms

 Test Files  3 passed (3)
      Tests  36 passed (36)
   Duration  165ms

EXIT_CODE=0
```

Notes:

- The repository root `bun run typecheck` script exits 0 but prints Bun `exec` usage in this environment, so `bun run --workspaces typecheck` was also run to perform the actual web typecheck.
- Plain `cd apps/web && pnpm test` tried to bootstrap app-local pnpm dependencies and failed on pnpm ignored-build approval state. The final Vitest gate used the same app `test` script with pnpm's pre-run dependency verifier disabled and the root Bun workspace bin path on `PATH`.

## Manual Validation Steps

1. Run the cleanup dry-run:

```bash
cd apps/web
bun run scripts/purge-unsafe-shared-github-cache.ts --dry-run
```

2. Run the cleanup for real:

```bash
cd apps/web
bun run scripts/purge-unsafe-shared-github-cache.ts
```

3. Browse a private repository through the app, including repo chrome, issues, pull requests, branch/tree/file views, workflow runs, and nav counts.

4. Confirm no new unsafe shared keys exist in Redis by scanning for:

```text
ghpub:repo_*
ghpub:issue*
ghpub:pull_request*
ghpub:org:*
ghpub:org_repos:*
ghpub:org_members:*
ghpub:file_content:*
ghpub:repo_contents:*
```

5. Confirm user-scoped cache entries still populate under `gh:{userId}:*` for private repo data.

6. Confirm `ghpub:user_public_orgs:*`, `ghpub:user_profile:*`, `ghpub:user_events:*`, and `ghpub:trending_repos:*` can still be used for public shared cache data.

## Commits

- `4170cf9 fix(github-cache): restrict shared cache policy`
- Cleanup utility and this report are in the follow-up commit.
