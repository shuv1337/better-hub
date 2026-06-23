# Better Hub AGENTS.md

## Production Information

- The origin for better-hub is: https://better-hub.com
  in

## Design

- Try to follow the design of the rest of the site as much as possible.
- Avoid loading spinners and prefer skeleton UI for loading states.

## GitHub Cache Runbook

- Shared GitHub cache reads use ghpub:* and are controlled by GITHUB_CACHE_SHARED_READ (1 by default, set 0 only for rollback/emergency response).
- Browser warm is gated by NEXT_PUBLIC_GITHUB_CACHE_WARM_ENABLED; keep it 0 unless intentionally enabling browser-session warm.
- Local/dev warm may run inline with GITHUB_CACHE_WARM_INLINE=1. Production warm requires GITHUB_CACHE_WARM_PROD_ENABLED=1 and Inngest configuration.
- Warm modes: quick warms first-navigation repo overview/layout targets; full adds releases, discussions, commit activity, and force-refreshed user-scoped response caches.
- Debug UI: /debug/github-cache shows current user, warm lock state, last warm result, sync job counts/failures, and descriptor-backed per-repo cache target status. Do not add tokens or raw cached payloads to this page.
- Redis key patterns: per-user GitHub responses use gh:{userId}:...; public shared responses use ghpub:*; UI fragments use keys such as repo_page_data:*, repo_file_tree:*, readme_html:*, overview_*, and github-cache-warm-last:{userId}.
- Warm lock semantics: the API owns github-cache-warm-lock:{userId} with a generated runId; Inngest verifies/renews/releases only when the stored value still matches. Release must remain compare-and-delete.
- Production worker auth must use resolveGitHubAuthContextForUser(userId), not request-scoped React cache() auth getters.
- Do not expand the shareable-cache allowlist without a security review. Repo-scoped, org-scoped, viewer-specific, issue, PR, file/tree, workflow, branch/tag, release, contributor, nav-count, and private-repo data must not be written to ghpub:*.
- Unsafe ghpub:* cleanup targets are ghpub:repo_*, ghpub:issue*, ghpub:pull_request*, ghpub:org:*, ghpub:org_repos:*, ghpub:org_members:*, ghpub:file_content:*, and ghpub:repo_contents:*. Validate scans preserve allowed public keys such as ghpub:user_profile:*, ghpub:user_public_orgs:*, ghpub:user_events:*, and ghpub:trending_repos:*.
