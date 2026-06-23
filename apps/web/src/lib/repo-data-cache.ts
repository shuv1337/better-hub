import { redis } from "./redis";
import { githubCacheKeys } from "./github-cache-descriptors";

/** TTLs in seconds */
const TTL = {
	/** Rarely changes: languages, contributors */
	slow: 60 * 60 * 24, // 24 hours
	/** Changes occasionally: branches, tags, page data, file tree */
	medium: 60 * 60, // 1 hour
	/** Changes frequently: PRs, issues, events, CI */
	fast: 5 * 60, // 5 minutes
} as const;

function repoKey(owner: string, repo: string, suffix: string): string {
	return `${suffix}:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

function languagesKey(owner: string, repo: string): string {
	return githubCacheKeys.repoLanguages(owner, repo);
}

function contributorAvatarsKey(owner: string, repo: string): string {
	return repoKey(owner, repo, "repo_contributor_avatars");
}

function branchesKey(owner: string, repo: string): string {
	return githubCacheKeys.repoBranches(owner, repo);
}

function tagsKey(owner: string, repo: string): string {
	return githubCacheKeys.repoTags(owner, repo);
}

export async function getCachedRepoLanguages(
	owner: string,
	repo: string,
): Promise<Record<string, number> | null> {
	return redis.get<Record<string, number>>(languagesKey(owner, repo));
}

export async function setCachedRepoLanguages(
	owner: string,
	repo: string,
	languages: Record<string, number>,
): Promise<void> {
	await redis.set(languagesKey(owner, repo), languages, { ex: TTL.slow });
}

export interface ContributorAvatar {
	login: string;
	avatar_url: string;
}

export interface ContributorAvatarsData {
	avatars: ContributorAvatar[];
	totalCount: number;
}

export async function getCachedContributorAvatars(
	owner: string,
	repo: string,
): Promise<ContributorAvatarsData | null> {
	const raw = await redis.get<ContributorAvatarsData | ContributorAvatar[]>(
		contributorAvatarsKey(owner, repo),
	);
	if (!raw) return null;
	if (Array.isArray(raw)) return { avatars: raw, totalCount: raw.length };
	return raw;
}

export async function setCachedContributorAvatars(
	owner: string,
	repo: string,
	data: ContributorAvatarsData,
): Promise<void> {
	await redis.set(contributorAvatarsKey(owner, repo), data, { ex: TTL.slow });
}

export interface BranchRef {
	name: string;
}

export async function getCachedBranches(owner: string, repo: string): Promise<BranchRef[] | null> {
	return redis.get<BranchRef[]>(branchesKey(owner, repo));
}

export async function setCachedBranches(
	owner: string,
	repo: string,
	branches: BranchRef[],
): Promise<void> {
	await redis.set(branchesKey(owner, repo), branches, { ex: TTL.medium });
}

export async function getCachedTags(owner: string, repo: string): Promise<BranchRef[] | null> {
	return redis.get<BranchRef[]>(tagsKey(owner, repo));
}

export async function setCachedTags(owner: string, repo: string, tags: BranchRef[]): Promise<void> {
	await redis.set(tagsKey(owner, repo), tags, { ex: TTL.medium });
}

// --- Core page data (per-user, contains viewerPermission etc.) ---

export async function getCachedRepoPageData<T>(
	userId: string,
	owner: string,
	repo: string,
): Promise<T | null> {
	return redis.get<T>(githubCacheKeys.repoPageData(userId, owner, repo));
}

export async function setCachedRepoPageData<T>(
	userId: string,
	owner: string,
	repo: string,
	data: T,
): Promise<void> {
	await redis.set(githubCacheKeys.repoPageData(userId, owner, repo), data, {
		ex: TTL.medium,
	});
}

export async function updateCachedRepoPageDataNavCounts(
	userId: string,
	owner: string,
	repo: string,
	updates: { openPrs?: number; openIssues?: number },
): Promise<void> {
	const key = githubCacheKeys.repoPageData(userId, owner, repo);
	const existing = await redis.get<{
		navCounts?: { openPrs: number; openIssues: number; activeRuns: number };
	}>(key);
	if (!existing || !existing.navCounts) return;

	const updatedNavCounts = {
		...existing.navCounts,
		...(updates.openPrs !== undefined && { openPrs: updates.openPrs }),
		...(updates.openIssues !== undefined && { openIssues: updates.openIssues }),
	};

	await redis.set(key, { ...existing, navCounts: updatedNavCounts }, { ex: TTL.medium });
}

export async function getCachedRepoTree<T>(owner: string, repo: string): Promise<T | null> {
	return redis.get<T>(githubCacheKeys.repoFileTree(owner, repo));
}

export async function setCachedRepoTree<T>(owner: string, repo: string, tree: T): Promise<void> {
	await redis.set(githubCacheKeys.repoFileTree(owner, repo), tree, { ex: TTL.medium });
}

// --- Overview caches (shared across all viewers) ---

export async function getCachedOverviewPRs<T>(owner: string, repo: string): Promise<T[] | null> {
	return redis.get<T[]>(githubCacheKeys.overviewPRs(owner, repo));
}

export async function setCachedOverviewPRs<T>(
	owner: string,
	repo: string,
	data: T[],
): Promise<void> {
	await redis.set(githubCacheKeys.overviewPRs(owner, repo), data, { ex: TTL.fast });
}

export async function getCachedOverviewIssues<T>(owner: string, repo: string): Promise<T[] | null> {
	return redis.get<T[]>(githubCacheKeys.overviewIssues(owner, repo));
}

export async function setCachedOverviewIssues<T>(
	owner: string,
	repo: string,
	data: T[],
): Promise<void> {
	await redis.set(githubCacheKeys.overviewIssues(owner, repo), data, { ex: TTL.fast });
}

export async function getCachedOverviewEvents<T>(owner: string, repo: string): Promise<T[] | null> {
	return redis.get<T[]>(githubCacheKeys.overviewEvents(owner, repo));
}

export async function setCachedOverviewEvents<T>(
	owner: string,
	repo: string,
	data: T[],
): Promise<void> {
	await redis.set(githubCacheKeys.overviewEvents(owner, repo), data, { ex: TTL.fast });
}

export async function getCachedOverviewCommitActivity<T>(
	owner: string,
	repo: string,
): Promise<T[] | null> {
	return redis.get<T[]>(githubCacheKeys.overviewCommitActivity(owner, repo));
}

export async function setCachedOverviewCommitActivity<T>(
	owner: string,
	repo: string,
	data: T[],
): Promise<void> {
	await redis.set(githubCacheKeys.overviewCommitActivity(owner, repo), data, {
		ex: TTL.fast,
	});
}

export async function getCachedOverviewCI<T>(owner: string, repo: string): Promise<T | null> {
	return redis.get<T>(githubCacheKeys.overviewCI(owner, repo));
}

export async function setCachedOverviewCI<T>(owner: string, repo: string, data: T): Promise<void> {
	await redis.set(githubCacheKeys.overviewCI(owner, repo), data, { ex: TTL.fast });
}

// --- Author dossier cache (per author per repo) ---

function authorDossierKey(owner: string, repo: string, login: string): string {
	return `author_dossier:${owner.toLowerCase()}/${repo.toLowerCase()}/${login.toLowerCase()}`;
}

export async function getCachedAuthorDossier<T>(
	owner: string,
	repo: string,
	login: string,
): Promise<T | null> {
	return redis.get<T>(authorDossierKey(owner, repo, login));
}

export async function setCachedAuthorDossier<T>(
	owner: string,
	repo: string,
	login: string,
	data: T,
): Promise<void> {
	await redis.set(authorDossierKey(owner, repo, login), data, { ex: TTL.medium });
}
