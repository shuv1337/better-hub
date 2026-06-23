const SHAREABLE_CACHE_TYPES: ReadonlySet<string> = new Set([
	"user_profile",
	"user_public_orgs",
	"user_events",
	"trending_repos",
]);

const UNSAFE_EXACT_SHARED_CACHE_TYPES: ReadonlySet<string> = new Set([
	"repo",
	"org",
	"org_repos",
	"org_members",
	"repo_contents",
	"file_content",
	"notifications",
	"search_issues",
	"authenticated_user",
	"starred_repos",
	"contributions",
	"person_repo_activity",
	"pr_bundle",
]);

export function isUnsafeSharedCacheType(cacheType: string): boolean {
	return (
		cacheType.startsWith("repo_") ||
		cacheType.startsWith("issue") ||
		cacheType.startsWith("pull_request") ||
		UNSAFE_EXACT_SHARED_CACHE_TYPES.has(cacheType)
	);
}

/** Types safe for ghpub:* - allowlist only; no repo-scoped or viewer-specific data. */
export function isShareableCacheType(cacheType: string): boolean {
	if (isUnsafeSharedCacheType(cacheType)) return false;
	return SHAREABLE_CACHE_TYPES.has(cacheType);
}

export function isSharedCacheReadEnabled(): boolean {
	return process.env.GITHUB_CACHE_SHARED_READ !== "0";
}
