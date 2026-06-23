import { getGithubCacheDescriptor, type GithubCacheDataClass } from "./github-cache-descriptors";

export type { GithubCacheDataClass };

export interface GithubCachePolicy {
	freshForMs: number;
	refreshAfterMs: number;
	expireAfterMs: number | null;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const GITHUB_CACHE_POLICIES = {
	"hot-list": { freshForMs: MINUTE, refreshAfterMs: 2 * MINUTE, expireAfterMs: null },
	ci: { freshForMs: 30 * 1000, refreshAfterMs: MINUTE, expireAfterMs: null },
	activity: { freshForMs: 2 * MINUTE, refreshAfterMs: 5 * MINUTE, expireAfterMs: null },
	"repo-chrome": {
		freshForMs: 10 * MINUTE,
		refreshAfterMs: 30 * MINUTE,
		expireAfterMs: null,
	},
	"code-tree": {
		freshForMs: 15 * MINUTE,
		refreshAfterMs: HOUR,
		expireAfterMs: null,
	},
	readme: { freshForMs: 15 * MINUTE, refreshAfterMs: HOUR, expireAfterMs: null },
	stats: { freshForMs: 6 * HOUR, refreshAfterMs: 24 * HOUR, expireAfterMs: null },
	"repo-inventory": {
		freshForMs: 5 * MINUTE,
		refreshAfterMs: 15 * MINUTE,
		expireAfterMs: null,
	},
	identity: { freshForMs: 15 * MINUTE, refreshAfterMs: HOUR, expireAfterMs: null },
} satisfies Record<GithubCacheDataClass, GithubCachePolicy>;

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
	return getGithubCacheDescriptor(cacheType)?.shareable === true;
}

export function isSharedCacheReadEnabled(): boolean {
	return process.env.GITHUB_CACHE_SHARED_READ !== "0";
}

export function getGithubCachePolicy(dataClass: GithubCacheDataClass): GithubCachePolicy {
	return GITHUB_CACHE_POLICIES[dataClass];
}

function ageMs(syncedAt: string | null): number | null {
	if (!syncedAt) return null;
	const timestamp = Date.parse(syncedAt);
	if (Number.isNaN(timestamp)) return null;
	return Math.max(0, Date.now() - timestamp);
}

export function isFresh(syncedAt: string | null, dataClass: GithubCacheDataClass): boolean {
	const age = ageMs(syncedAt);
	if (age === null) return false;
	return age < getGithubCachePolicy(dataClass).freshForMs;
}

export function shouldRefresh(syncedAt: string | null, dataClass: GithubCacheDataClass): boolean {
	const age = ageMs(syncedAt);
	if (age === null) return true;
	return age >= getGithubCachePolicy(dataClass).refreshAfterMs;
}
