# Plan 003: Fix GitHub user profile cache keying

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6c18b28..HEAD -- apps/web/src/lib/auth.ts apps/web/src/lib/auth*.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `6c18b28`, 2026-06-25

## Why this matters

`getOctokitUser` reads Redis with the raw GitHub token in the key but writes with a hashed token key. That means the cache never hits and the raw token is still sent as part of the Redis lookup key. The fix is one small helper-level change: hash once, use the hash for reads and writes, and keep cached value shape consistent.

## Current State

- `apps/web/src/lib/auth.ts` defines `getOctokitUser(token)`.
- `getServerSession` calls it and expects an Octokit response with a `.data` property.
- The cache read key and write key do not match.

Current excerpt:

```ts
// apps/web/src/lib/auth.ts:18
async function getOctokitUser(token: string) {
  const cached = await redis.get<ReturnType<(typeof octokit)["users"]["getAuthenticated"]>>(
    `github_user:${token}`,
  );
  if (cached) return cached;
  const octokit = new Octokit({ auth: token });
  const githubUser = await octokit.users.getAuthenticated();
  const hash = await createHash("SHA-256", "base64").digest(token);
  waitUntil(redis.set(`github_user:${hash}`, JSON.stringify(githubUser.data), { ex: 3600 }));
  return githubUser;
}
```

Repo conventions to match:

- Existing code already imports `createHash` from `@better-auth/utils/hash`.
- Existing code uses `waitUntil` for best-effort Redis writes.
- Tests use Vitest and module mocks.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Focused tests | `cd apps/web && bun test -- --run src/lib/auth.test.ts` | all tests pass |
| Typecheck | `bun typecheck` | exit 0, no TypeScript errors |
| Lint | `bun lint` | exit 0 |

## Scope

**In scope**:

- `apps/web/src/lib/auth.ts`
- New or existing `apps/web/src/lib/auth.test.ts`

**Out of scope**:

- Changing session cookie behavior.
- Changing Better Auth account token storage.
- Any Redis key migration. The old raw-token read key was never written by this function.

## Git Workflow

- Branch: `advisor/003-fix-github-user-profile-cache`
- Commit message style: `fix: hash github user cache keys consistently`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Make the helper return one shape

In `auth.ts`, replace `getOctokitUser` with a helper that returns GitHub user data, not a mixed cached-data/Octokit-response shape. Suggested shape:

```ts
async function getOctokitUserData(token: string): Promise<Record<string, unknown>> {
  const hash = await createHash("SHA-256", "base64").digest(token);
  const key = `github_user:${hash}`;
  const cached = await redis.get<Record<string, unknown>>(key);
  if (cached) return cached;
  const octokit = new Octokit({ auth: token });
  const githubUser = await octokit.users.getAuthenticated();
  waitUntil(redis.set(key, githubUser.data, { ex: 3600 }));
  return githubUser.data;
}
```

Use the repo's Redis client serialization convention. If other files use `JSON.stringify` with `redis.set`, match that; otherwise store the object directly.

**Verify**: `bun typecheck` -> exit 0.

### Step 2: Update `getServerSession`

Update `getServerSession` so it calls the new helper and does not read `.data` from a cached object:

```ts
const githubUserData = await getOctokitUserData(account.accessToken);
```

Keep the fallback that returns only `accessToken` when GitHub profile lookup fails.

**Verify**: `bun typecheck` -> exit 0.

### Step 3: Add a focused test

Create `apps/web/src/lib/auth.test.ts` that mocks:

- `./redis`
- `@better-auth/utils/hash`
- `@octokit/rest`
- `@vercel/functions`

Test cases:

- Cache hit uses `github_user:<hash>`, returns cached user data, and does not construct Octokit.
- Cache miss fetches GitHub user data and writes the same hashed key.
- No Redis call uses a key containing the raw token string.

**Verify**: `cd apps/web && bun test -- --run src/lib/auth.test.ts` -> all tests pass.

## Test Plan

Use the existing Vitest style in `apps/web/src/lib/github-auth-context.test.ts` as the structural pattern. Keep the test focused on cache keying and value shape.

## Done Criteria

- [ ] `getServerSession` behavior is unchanged for callers.
- [ ] Redis read and write use the same hashed key.
- [ ] The raw GitHub token never appears in a Redis key.
- [ ] Focused test passes.
- [ ] `bun typecheck`, `bun lint`, and `cd apps/web && bun test -- --run` pass.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- Redis client serialization requires a response wrapper instead of raw `githubUser.data`.
- The helper is used elsewhere and callers require the full Octokit response shape.

## Maintenance Notes

Any future token-derived key should hash before constructing a Redis key. Reviewers should look for raw token interpolation into logs, cache keys, or errors.

