# Plan 001: Bind prompt requests to their repo and viewer permissions

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6c18b28..HEAD -- apps/web/src/app/(app)/repos/[owner]/[repo]/prompts apps/web/src/lib/prompt-request-store.ts apps/web/src/lib/github.ts apps/web/vitest.config.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `6c18b28`, 2026-06-25

## Why this matters

Prompt requests are stored by global id and the detail/actions paths trust that id without proving it belongs to the `[owner]/[repo]` route or that the viewer can access that repository. A logged-in user who learns a prompt id can load, comment on, or react to that prompt through a different repo route. The fix should bind every prompt read/write to both the route repo and the viewer's GitHub permissions.

## Current state

- `apps/web/src/app/(app)/repos/[owner]/[repo]/prompts/page.tsx` lists prompts by route owner/repo.
- `apps/web/src/app/(app)/repos/[owner]/[repo]/prompts/[id]/page.tsx` fetches the prompt, comments, and reactions by id before checking ownership or authorization.
- `apps/web/src/app/(app)/repos/[owner]/[repo]/prompts/actions.ts` mutates prompts/comments/reactions by id and only later uses the prompt's stored owner/repo.
- `apps/web/src/lib/prompt-request-store.ts` has generic by-id helpers but no repo-bound helpers.

Current excerpts:

```ts
// apps/web/src/app/(app)/repos/[owner]/[repo]/prompts/[id]/page.tsx:39
const [promptRequest, comments, reactions, session] = await Promise.all([
  getPromptRequest(id),
  listPromptRequestComments(id),
  listPromptRequestReactions(id),
  getServerSession(),
]);
```

```ts
// apps/web/src/app/(app)/repos/[owner]/[repo]/prompts/actions.ts:129
export async function addPromptComment(promptRequestId: string, body: string) {
  const session = await getServerSession();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const pr = await getPromptRequest(promptRequestId);
  if (!pr) throw new Error("Prompt request not found");
```

```ts
// apps/web/src/lib/prompt-request-store.ts:89
export async function getPromptRequest(id: string): Promise<PromptRequest | null> {
  const row = await prisma.promptRequest.findUnique({ where: { id } });
  return row ? toPromptRequest(row) : null;
}
```

Repo conventions to match:

- Server actions throw `Error("Unauthorized")` or `Error("Not authorized")` and use `revalidatePath`; see `apps/web/src/app/(app)/repos/[owner]/[repo]/prompts/actions.ts:22-56`.
- GitHub repo permission checks use `getOctokit().repos.get({ owner, repo })` plus `extractRepoPermissions`; see the same file at lines 42-55.
- Tests use Vitest under `apps/web/src/**/*.test.ts` and mock modules with `vi.mock`; see `apps/web/src/app/api/github-cache/warm/route.test.ts`.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Focused tests | `cd apps/web && bun test -- --run src/app/\\(app\\)/repos/\\[owner\\]/\\[repo\\]/prompts/actions.test.ts src/app/\\(app\\)/repos/\\[owner\\]/\\[repo\\]/prompts/page-access.test.ts` | all tests pass |
| All app tests | `cd apps/web && bun test -- --run` | all tests pass |
| Typecheck | `bun typecheck` | exit 0, no TypeScript errors |
| Lint | `bun lint` | exit 0 |

## Scope

**In scope**:

- `apps/web/src/lib/prompt-request-store.ts`
- `apps/web/src/app/(app)/repos/[owner]/[repo]/prompts/actions.ts`
- `apps/web/src/app/(app)/repos/[owner]/[repo]/prompts/page.tsx`
- `apps/web/src/app/(app)/repos/[owner]/[repo]/prompts/[id]/page.tsx`
- New focused tests under `apps/web/src/app/(app)/repos/[owner]/[repo]/prompts/*.test.ts`

**Out of scope**:

- Prompt UI redesign.
- Database schema changes unless the existing `@@index([owner, repo, status])` is not enough.
- Changing public prompt fields or adding visibility modes.

## Git Workflow

- Branch: `advisor/001-bind-prompt-requests-to-repo`
- Commit message style: `fix: bind prompt requests to repo access`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add repo-bound store helpers

In `apps/web/src/lib/prompt-request-store.ts`, add a helper such as:

```ts
export async function getPromptRequestForRepo(
  id: string,
  owner: string,
  repo: string,
): Promise<PromptRequest | null> {
  const row = await prisma.promptRequest.findFirst({
    where: { id, owner, repo },
  });
  return row ? toPromptRequest(row) : null;
}
```

Add a comment/helper for comments if needed: when deleting a comment, verify the comment belongs to the prompt id being modified before deletion.

**Verify**: `bun typecheck` -> exit 0, or if unrelated dependency setup is missing, record the missing dependency error and continue to focused tests after install.

### Step 2: Gate reads by route repo and viewer access

In `prompts/[id]/page.tsx`:

- Fetch `session` first.
- Fetch the route repo through the existing authenticated GitHub path. If unauthenticated or repo is inaccessible, return `notFound()` or the existing repo error behavior from the parent layout.
- Replace `getPromptRequest(id)` with `getPromptRequestForRepo(id, owner, repo)`.
- Only after the prompt exists for that route repo, fetch comments and reactions.
- Keep metadata conservative: for private/inaccessible repos, do not fetch the prompt title by id.

**Verify**: `cd apps/web && bun test -- --run src/app/\\(app\\)/repos/\\[owner\\]/\\[repo\\]/prompts/page-access.test.ts` -> new tests pass.

### Step 3: Gate writes by route repo or prompt repo

In `prompts/actions.ts`:

- For `createPromptRequestAction(owner, repo, body)`, verify the current user can access `owner/repo` before writing. Public read access is enough unless product wants prompts to be maintainer-only; do not make that policy change in this plan.
- For `closePromptRequest`, `reopenPromptRequest`, `deletePromptRequestAction`, `addPromptComment`, `deletePromptComment`, and `togglePromptReaction`, load the prompt through a repo-bound path or add route owner/repo arguments and verify they match.
- If changing client call signatures is necessary, update only prompt components that call these actions.
- Ensure `deletePromptComment(commentId, promptRequestId)` confirms the comment's `promptRequestId` equals the supplied prompt id before deleting.

**Verify**: `cd apps/web && bun test -- --run src/app/\\(app\\)/repos/\\[owner\\]/\\[repo\\]/prompts/actions.test.ts` -> new tests pass.

### Step 4: Add focused regression tests

Create tests that cover:

- A prompt id for `ownerA/repoA` does not render through `ownerB/repoB`.
- `addPromptComment` rejects a prompt the viewer cannot access.
- `togglePromptReaction` rejects a prompt the viewer cannot access.
- `deletePromptComment` rejects when `commentId` belongs to a different `promptRequestId`.
- Existing happy paths still call the store update functions and `revalidatePath`.

**Verify**: `cd apps/web && bun test -- --run src/app/\\(app\\)/repos/\\[owner\\]/\\[repo\\]/prompts/actions.test.ts src/app/\\(app\\)/repos/\\[owner\\]/\\[repo\\]/prompts/page-access.test.ts` -> all pass.

## Test Plan

- Model mocks after `apps/web/src/app/api/github-cache/warm/route.test.ts`.
- Mock `@/lib/prompt-request-store`, `@/lib/auth`, `@/lib/github`, and `next/cache`.
- Keep tests assertive: unauthorized paths must not call create/update/delete helpers.

## Done Criteria

- [ ] Prompt detail cannot load a prompt whose stored `owner/repo` differs from the route params.
- [ ] Prompt actions cannot create, comment, react, delete, close, or reopen without repo access.
- [ ] Comment deletion verifies the comment belongs to the prompt being modified.
- [ ] Focused prompt tests pass.
- [ ] `bun typecheck`, `bun lint`, and `cd apps/web && bun test -- --run` pass.
- [ ] No files outside the in-scope list are modified except `plans/README.md` status.

## STOP Conditions

Stop and report if:

- Prompt requests are intentionally public across repos and a product owner confirms that policy.
- The prompt components require a broad UI rewrite to pass route owner/repo into actions.
- Existing tests reveal a separate auth/session regression outside prompt code.

## Maintenance Notes

Future prompt features should route every by-id read through a helper that also checks `owner` and `repo`. Reviewers should scrutinize every server action for direct `getPromptRequest(id)` use.

