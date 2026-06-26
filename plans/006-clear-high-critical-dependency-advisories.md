# Plan 006: Clear high and critical dependency advisories

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report; do not improvise. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6c18b28..HEAD -- package.json apps/web/package.json bun.lock pnpm-lock.yaml`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding. On mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-bind-prompt-requests-to-repo.md, plans/002-encrypt-user-settings-secrets.md, plans/003-fix-github-user-profile-cache.md, plans/004-request-safe-background-github-refresh.md, plans/005-gate-repo-fragment-cache-reads.md
- **Category**: migration
- **Planned at**: commit `6c18b28`, 2026-06-25

## Why this matters

`bun audit --audit-level high` currently fails with 75 high/critical advisories. Some are dev-only, but several flow through runtime dependencies such as Next, Inngest, Vercel, Prisma, Better Auth, and AWS SDK packages. This plan updates existing dependencies only; do not add replacement libraries.

## Current State

- Root package manager is Bun.
- CI installs with `bun install --frozen-lockfile`, then runs lint, format, typecheck, and build.
- `apps/web/package.json` pins runtime packages including `next`, `inngest`, `vercel`, `vitest`, `prisma`, and `@prisma/client`.
- Current audit command output includes high/critical advisories for `next >=16.0.0 <16.2.5`, `inngest >=3.22.0 <3.54.0`, `vitest >=4.0.0 <4.1.0`, `form-data <4.0.4`, `protobufjs <=8.0.1`, `undici <6.24.0`, and others.

Current excerpts:

```json
// package.json:27
"scripts": {
  "build": "bun run --workspaces build",
  "dev": "bun run --workspaces dev",
  "lint": "oxlint apps packages",
  "fmt:check": "oxfmt --ignore-path .oxfmtignore --check apps packages *.json *.yaml",
  "typecheck": "bun -r exec tsc --noEmit",
  "check": "bun lint && bun fmt:check && bun typecheck"
}
```

```json
// apps/web/package.json:84
"vercel": "^50.22.1",
"vitest": "^4.0.18",
"zod": "^4.3.6"
```

Repo conventions to match:

- Use Bun for dependency installation and lockfile updates.
- Keep dependency changes in `package.json` and lockfiles only unless a package update requires a source compatibility fix.
- Prefer compatible updates over major rewrites.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Baseline audit | `bun audit --audit-level high` | currently non-zero; record top direct packages |
| Update deps | `bun update next @sentry/nextjs @vercel/analytics inngest vitest prisma @prisma/client vercel e2b @mixedbread-ai/sdk @better-auth/infra better-auth @better-auth/stripe auth @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` | exit 0 |
| Audit gate | `bun audit --audit-level high` | exit 0, or only documented unreachable dev-only advisories remain |
| Tests | `cd apps/web && bun test -- --run` | all tests pass |
| Typecheck | `bun typecheck` | exit 0, no TypeScript errors |
| Lint | `bun lint` | exit 0 |
| Build | `bun run build` | exit 0 with `SKIP_ENV_VALIDATION=true` if env validation blocks local build |

## Scope

**In scope**:

- `package.json`
- `apps/web/package.json`
- `bun.lock`
- `pnpm-lock.yaml` only if the repo expects it to stay in sync
- Minimal source compatibility fixes caused directly by dependency updates

**Out of scope**:

- Replacing framework/runtime choices.
- Removing features to make audit pass.
- Adding new dependencies.
- Broad formatting churn.

## Git Workflow

- Branch: `advisor/006-clear-high-critical-dependency-advisories`
- Commit message style: `chore: update vulnerable dependencies`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Capture the audit baseline

Run:

```sh
bun audit --audit-level high
```

Save the package names and advisory counts in your notes or PR description. Do not paste full advisory dumps into source files.

**Verify**: command exits non-zero before the update and includes high/critical advisories.

### Step 2: Update existing direct dependencies

Run the update command from the table. If Bun refuses because a package name is not a direct dependency in this workspace, remove only that name and rerun. Do not use `bun update --latest` as the first move; it is too broad.

**Verify**: `git diff -- apps/web/package.json package.json | sed -n '1,220p'` -> only dependency version changes, unless a compatibility fix is required later.

### Step 3: Re-run audit and iterate narrowly

Run:

```sh
bun audit --audit-level high
```

If advisories remain, identify the nearest direct dependency that brings them in with:

```sh
bun pm why <package-name>
```

Then update that direct dependency only. Repeat until the audit exits 0 or only documented unreachable dev-only advisories remain.

**Verify**: `bun audit --audit-level high` -> exit 0 preferred. If not exit 0, document each remaining advisory, why it is unreachable, and what upstream release is needed.

### Step 4: Fix compatibility breaks only if needed

Run typecheck and tests. If package updates create compile errors, make the smallest source changes needed for compatibility. Keep those changes tightly scoped and explain them in the PR.

**Verify**:

- `bun typecheck` -> exit 0.
- `cd apps/web && bun test -- --run` -> all tests pass.
- `bun lint` -> exit 0.

### Step 5: Build with env validation skipped

Run:

```sh
SKIP_ENV_VALIDATION=true bun run build
```

If build fails because Prisma generation requires a database URL, use the repo's documented local env setup from `CONTRIBUTING.md`. Do not commit local env files.

**Verify**: build exits 0 or the only failure is a documented missing local service/env that CI provides.

## Test Plan

This plan is mostly dependency hygiene. The regression check is the existing test suite plus typecheck/build. Do not add tests unless a compatibility source fix changes behavior.

## Done Criteria

- [ ] `bun audit --audit-level high` exits 0, or remaining advisories are documented as unreachable with upstream blockers.
- [ ] Lockfiles are updated consistently.
- [ ] `bun typecheck`, `bun lint`, `cd apps/web && bun test -- --run`, and build pass or have a documented environment-only blocker.
- [ ] No new dependencies are added.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report if:

- Clearing advisories requires a major framework migration beyond dependency bumps.
- A required package has no patched version.
- Source compatibility fixes exceed a handful of localized changes.
- Lockfile tooling wants to remove one package manager's lockfile; ask before doing that.

## Maintenance Notes

Add `bun audit --audit-level high` to CI only after the audit is clean, otherwise CI will be noisy. Reviewers should check that runtime packages, not just dev packages, received patched versions.

