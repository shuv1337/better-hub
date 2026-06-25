# Plan 002: Encrypt stored user-supplied API keys

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6c18b28..HEAD -- apps/web/src/lib/user-settings-store.ts apps/web/src/app/api/user-settings/route.ts apps/web/src/lib/billing/ai-models.server.ts apps/web/src/app/api/ai/ghost/route.ts apps/web/prisma/schema.prisma apps/web/src/lib/auth-plugins/pat-signin.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `6c18b28`, 2026-06-25

## Why this matters

The app encrypts OAuth/PAT account tokens but stores user-supplied OpenRouter keys and `githubPat` settings as plaintext in `user_settings`. These values are secrets and should have the same at-rest treatment as account tokens. The smallest useful fix is to encrypt on write, decrypt only inside server code that needs the secret, and keep GET responses masked.

## Current State

- `apps/web/src/app/api/user-settings/route.ts` accepts `openrouterApiKey` and `githubPat` as strings.
- `apps/web/src/lib/user-settings-store.ts` writes those strings directly into Prisma update data.
- `apps/web/src/lib/billing/ai-models.server.ts` reads `settings.openrouterApiKey` and passes it to OpenRouter.
- `apps/web/prisma/schema.prisma` stores `openrouterApiKey String?` and `githubPat String?` on `UserSettings`.
- `apps/web/src/lib/auth-plugins/pat-signin.ts` already shows the repo's token encryption convention with `symmetricEncrypt({ key: secret, data: pat })`.

Current excerpts:

```ts
// apps/web/src/lib/user-settings-store.ts:111
if (updates.openrouterApiKey !== undefined)
  data.openrouterApiKey = updates.openrouterApiKey;
if (updates.githubPat !== undefined) data.githubPat = updates.githubPat;
```

```ts
// apps/web/src/lib/billing/ai-models.server.ts:10
const apiKey = isCustomApiKey
  ? settings.openrouterApiKey
  : (process.env.OPEN_ROUTER_API_KEY ?? "");
```

```ts
// apps/web/src/lib/auth-plugins/pat-signin.ts:68
const encryptedPat = await symmetricEncrypt({
  key: secret,
  data: pat,
});
```

Repo conventions to match:

- Use Better Auth crypto helpers for secrets, not a new dependency.
- Mask secrets in API responses; see `maskApiKey` in `apps/web/src/app/api/user-settings/route.ts:6-10`.
- Keep schema changes minimal. Existing columns can store encrypted strings.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Focused tests | `cd apps/web && bun test -- --run src/lib/user-settings-store.test.ts src/app/api/user-settings/route.test.ts` | all tests pass |
| All app tests | `cd apps/web && bun test -- --run` | all tests pass |
| Typecheck | `bun typecheck` | exit 0, no TypeScript errors |
| Lint | `bun lint` | exit 0 |

## Scope

**In scope**:

- `apps/web/src/lib/user-settings-store.ts`
- `apps/web/src/app/api/user-settings/route.ts`
- `apps/web/src/lib/billing/ai-models.server.ts`
- `apps/web/src/app/api/ai/ghost/route.ts` only if it directly consumes raw settings secrets
- New tests for user settings secret storage
- Optional one-off script under `apps/web/scripts/` to encrypt existing plaintext settings rows

**Out of scope**:

- Reworking Better Auth account token encryption.
- Changing the settings UI beyond preserving masked display behavior.
- Rotating user-owned OpenRouter keys; users own those credentials.
- Adding a new KMS or secrets service.

## Git Workflow

- Branch: `advisor/002-encrypt-user-settings-secrets`
- Commit message style: `fix: encrypt stored user settings secrets`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add a tiny settings-secret codec

In `apps/web/src/lib/user-settings-store.ts`, add local helpers:

- Prefix encrypted values, for example `enc:v1:`.
- `encryptSettingSecret(value: string | null): Promise<string | null>`.
- `decryptSettingSecret(value: string | null): Promise<string | null>`.
- Use `process.env.BETTER_AUTH_SECRET` as the key, matching `pat-signin.ts`.
- If decrypting an `enc:v1:` value fails, return `null` and log only the field name, never the value.
- If a value is non-null and does not start with `enc:v1:`, return it for backward compatibility and let the migration step handle existing rows.

Do not export these helpers unless tests need it. If tests need access, export them with names that make the secret behavior explicit.

**Verify**: `cd apps/web && bun test -- --run src/lib/user-settings-store.test.ts` -> codec tests pass.

### Step 2: Encrypt on writes and decrypt on server reads

Update `updateUserSettings` so `openrouterApiKey` and `githubPat` are encrypted before Prisma update. Update `toSettings` or `getUserSettings` so returned settings contain decrypted values for server consumers.

Keep `GET /api/user-settings` masking exactly as it is: decrypted value in memory, masked value in response.

**Verify**: `cd apps/web && bun test -- --run src/app/api/user-settings/route.test.ts src/lib/user-settings-store.test.ts` -> tests prove Prisma never receives plaintext for new secret writes and GET returns masked values.

### Step 3: Preserve AI key consumers

Check these consumers and update only if necessary:

- `apps/web/src/lib/billing/ai-models.server.ts`
- `apps/web/src/app/api/ai/ghost/route.ts`

They should keep using `getUserSettings(userId)`; after this plan, that function should return decrypted secrets to server-only code.

**Verify**: `bun typecheck` -> exit 0.

### Step 4: Add a one-off migration path for existing plaintext rows

Add `apps/web/scripts/encrypt-user-settings-secrets.ts` if production already has plaintext rows. The script should:

- Select rows with non-null `openrouterApiKey` or `githubPat`.
- Skip values already starting with `enc:v1:`.
- Encrypt values and update the row.
- Log only counts, never secret values.

If there is no production data to migrate, skip the script and record that in the PR description. Do not add a Prisma schema migration unless the existing string columns are too short for encrypted payloads.

**Verify**: `cd apps/web && bun scripts/encrypt-user-settings-secrets.ts --dry-run` -> prints counts and no secret values.

## Test Plan

- Add `apps/web/src/lib/user-settings-store.test.ts` or extend it if it exists.
- Cover encrypt/decrypt round trip, plaintext backward compatibility, GET masking, PATCH writing encrypted strings, and missing `BETTER_AUTH_SECRET` behavior.
- Mock Prisma rather than hitting a real database.

## Done Criteria

- [ ] New writes for `openrouterApiKey` and `githubPat` are encrypted at rest.
- [ ] Existing plaintext values still work until migrated.
- [ ] API responses still return masked values only.
- [ ] No secret value is logged in tests or runtime code.
- [ ] Focused tests, `bun typecheck`, `bun lint`, and `cd apps/web && bun test -- --run` pass.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- Better Auth crypto helpers are unavailable in this runtime.
- Encrypted payloads exceed existing column limits.
- Product decides user settings secrets should be removed entirely instead of encrypted.

## Maintenance Notes

Any future user setting that stores credentials should use the same helper. Reviewers should reject direct assignments of secret fields into Prisma update data.

