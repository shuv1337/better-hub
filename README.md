![Better Hub](readme.png)

# Better Hub

Re-imagining code collaboration — a better place to collaborate on code, for humans and agents.

## Why

At Better Auth, we spend a lot of our time on GitHub. So we decided to build the experience we actually wanted. Better Hub improves everything from the home page to repo overview, PR reviews, and AI integration — faster and more pleasant overall.

## Features

- **Repo overview** — cleaner layout with README rendering, file tree, activity feed
- **PR reviews** — inline diffs, AI-powered summaries, review comments
- **Issue management** — triage, filter, and act on issues faster
- **Ghost (AI assistant)** — review PRs, navigate code, triage issues, write commit messages (`⌘I` to toggle)
- **Command center** — search repos, switch themes, navigate anywhere (`⌘K`)x
- **CI/CD status** — view workflow runs and compare across branches
- **Security advisories** — track vulnerabilities per repo
- **Keyboard-first** — most actions accessible via shortcuts
- **Browser extension** — adds a "Open in Better Hub" button on GitHub pages (Chrome & Firefox supported)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, PR workflow, and code style guidelines.

## GitHub Cache Operations

Better Hub keeps GitHub data in per-user Redis keys (`gh:{userId}:...`) and UI fragment keys such as `repo_page_data:*`, `repo_file_tree:*`, `readme_html:*`, and `overview_*`. Cross-user public cache reads use `ghpub:*`, but writes are allowlist-only and must not include repo-scoped, org-scoped, viewer-specific, issue, PR, file, tree, workflow, branch, tag, release, contributor, nav-count, or private-repo data.

Cache warming has two modes:

- `quick`: warms repo page data, layout file tree, layout metadata, cache-first README HTML, overview lists, CI status, and workflow runs.
- `full`: includes quick mode plus releases, discussions when enabled, commit activity, and force-refreshed user-scoped response caches.

Browser-session warming is off by default with `NEXT_PUBLIC_GITHUB_CACHE_WARM_ENABLED=0`. Local/dev can run the warm API inline with `GITHUB_CACHE_WARM_INLINE=1`. Production background warming requires `GITHUB_CACHE_WARM_PROD_ENABLED=1` plus Inngest env vars. Inspect cache health at `/debug/github-cache`; the debug route shows lock state, last warm result, sync job counts, failed jobs, and descriptor-backed per-repo cache target status without exposing tokens or raw cached payloads.

Warm locks are single-owner Redis locks at `github-cache-warm-lock:{userId}`. The API writes a generated `runId` into the lock, passes that runId to Inngest, and both worker renewal and release only proceed when the Redis value still matches. Production worker auth must use the background resolver for the user id, not request-scoped React `cache()` auth getters.

One-time unsafe `ghpub:*` cleanup after deploying the allowlist fix:

```sh
for pattern in 'ghpub:repo_*' 'ghpub:issue*' 'ghpub:pull_request*' 'ghpub:org:*' 'ghpub:org_repos:*' 'ghpub:org_members:*' 'ghpub:file_content:*' 'ghpub:repo_contents:*'; do
  redis-cli --scan --pattern "$pattern"
done
```

After reviewing the scan output, delete only those unsafe patterns:

```sh
for pattern in 'ghpub:repo_*' 'ghpub:issue*' 'ghpub:pull_request*' 'ghpub:org:*' 'ghpub:org_repos:*' 'ghpub:org_members:*' 'ghpub:file_content:*' 'ghpub:repo_contents:*'; do
  redis-cli --scan --pattern "$pattern" | xargs -r redis-cli del
done
```

Validation scans should confirm no unsafe `ghpub:*` keys remain and that allowed public keys such as `ghpub:user_profile:*`, `ghpub:user_public_orgs:*`, `ghpub:user_events:*`, and `ghpub:trending_repos:*` were not removed. Expanding the shared-cache allowlist requires a security review first.

## License

[MIT](LICENSE)
