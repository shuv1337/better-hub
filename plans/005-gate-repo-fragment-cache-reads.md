# Plan 005: Gate repo fragment cache reads after repo authorization

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6c18b28..HEAD -- apps/web/src/app/(app)/repos/[owner]/[repo]/layout.tsx apps/web/src/lib/repo-data-cache.ts apps/web/src/lib/repo-data-cache-vc.ts apps/web/src/lib/prompt-request-store.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `6c18b28`, 2026-06-25

## Why this matters

The repo runbook says owner/repo fragment keys such as `repo_file_tree:*`, `repo_languages:*`, branches, tags, and contributor avatars are permission-gated-at-read. `RepoLayout` currently starts those reads before `getRepoPageData` confirms the current user can access the repo. Moving those reads below the permission result keeps the same UI behavior while enforcing the cache boundary.

## Current State

- `RepoLayout` starts `pageDataPromise`.
- It immediately starts `cachePromise` for owner/repo shared fragments.
- It also starts `promptCountPromise`.
- Only after those promises are started does it check `pageDataResult.success`.

Current excerpt:

```tsx
// apps/web/src/app/(app)/repos/[owner]/[repo]/layout.tsx:104
const pageDataPromise = getRepoPageData(owner, repoName);
const cachePromise = Promise.all([
  getCachedRepoTree<FileTreeNode[]>(owner, repoName),
  getCachedContributorAvatars(owner, repoName),
  getCachedRepoLanguages(owner, repoName),
  getCachedBranches(owner, repoName),
  getCachedTags(owner, repoName),
]);
const promptCountPromise = countPromptRequests(owner, repoName, "open");

const pageDataResult = await pageDataPromise;
if (!pageDataResult.success) {
  return <RepoErrorPage owner={owner} repo={repoName} error={pageDataResult.error} />;
}
```

Repo conventions to match:

- Keep skeleton/loading behavior unchanged.
- Avoid broad data-layer refactors.
- `RepoErrorPage` is the existing unauthorized/not-found path for this layout.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Focused tests | `cd apps/web && bun test -- --run src/app/\\(app\\)/repos/\\[owner\\]/\\[repo\\]/layout-cache-gate.test.ts` | all tests pass |
| All app tests | `cd apps/web && bun test -- --run` | all tests pass |
| Typecheck | `bun typecheck` | exit 0, no TypeScript errors |
| Lint | `bun lint` | exit 0 |

## Scope

**In scope**:

- `apps/web/src/app/(app)/repos/[owner]/[repo]/layout.tsx`
- New focused layout test

**Out of scope**:

- Changing Redis key names.
- Changing cache warm policy.
- Changing prompt request visibility beyond deferring `countPromptRequests` until after repo access succeeds.
- Moving cache helpers.

## Git Workflow

- Branch: `advisor/005-gate-repo-fragment-cache-reads`
- Commit message style: `fix: gate repo fragment cache reads after auth`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Move fragment reads below the repo permission check

In `layout.tsx`:

- Keep `const pageDataPromise = getRepoPageData(owner, repoName)`.
- Await `pageDataResult`.
- If not successful, return `RepoErrorPage` before starting any fragment cache or prompt count reads.
- Only after success, start `Promise.all([...fragment reads])` and `countPromptRequests`.

This is intentionally a reorder, not a new abstraction.

**Verify**: `bun typecheck` -> exit 0.

### Step 2: Preserve parallelism after authorization

After `pageDataResult.success`, keep fragment reads parallel:

```ts
const cachePromise = Promise.all([...]);
const promptCountPromise = countPromptRequests(owner, repoName, "open");
```

Do not serialize those reads unless needed for correctness.

**Verify**: `bun typecheck` -> exit 0.

### Step 3: Add a regression test

Create `apps/web/src/app/(app)/repos/[owner]/[repo]/layout-cache-gate.test.ts`:

- Mock `getRepoPageData` to return `{ success: false, error: "Repository not found" }`.
- Mock `getCachedRepoTree`, `getCachedContributorAvatars`, `getCachedRepoLanguages`, `getCachedBranches`, `getCachedTags`, and `countPromptRequests`.
- Invoke the async layout function with params.
- Assert none of the fragment/prompt count mocks were called.
- Add a success-path test that confirms fragment reads still happen after authorization.

**Verify**: `cd apps/web && bun test -- --run src/app/\\(app\\)/repos/\\[owner\\]/\\[repo\\]/layout-cache-gate.test.ts` -> all tests pass.

## Test Plan

Use module mocks. Do not render the full UI in a browser; this is an ordering/security regression test.

## Done Criteria

- [ ] No repo fragment cache read starts before `getRepoPageData` succeeds.
- [ ] Prompt count read also waits for repo authorization.
- [ ] Success path still reads fragments in parallel.
- [ ] Focused test passes.
- [ ] `bun typecheck`, `bun lint`, and `cd apps/web && bun test -- --run` pass.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- Moving the reads changes a documented performance requirement that requires pre-auth speculative reads.
- Tests reveal parent layout already guarantees these reads cannot execute for unauthorized users in a way not visible in this file.

## Maintenance Notes

The rule is simple: `repo_page_data:{userId}:*` may prove access; owner/repo fragment keys are read only after that proof.

