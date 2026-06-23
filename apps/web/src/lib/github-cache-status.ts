import {
	getCachedBranches,
	getCachedContributorAvatars,
	getCachedOverviewCI,
	getCachedOverviewCommitActivity,
	getCachedOverviewEvents,
	getCachedOverviewIssues,
	getCachedOverviewPRs,
	getCachedRepoLanguages,
	getCachedRepoPageDataEntry,
	getCachedRepoTree,
	getCachedTags,
} from "./repo-data-cache";
import { getCachedReadmeHtml } from "./readme-cache";
import {
	getGithubCacheDescriptor,
	githubCacheKeys,
	normalizeGithubRepoKey,
	type GithubCacheDataClass,
	type GithubCacheScope,
} from "./github-cache-descriptors";
import { shouldRefresh } from "./github-cache-policy";
import {
	getGithubCacheEntrySyncedAt,
	getGithubSyncJobStatusSummary,
	type GithubSyncJobStatusSummary,
} from "./github-sync-store";

export type GithubCachePresenceStatus = "fresh" | "stale" | "present" | "missing";

export interface RepoCacheStatusEntry {
	cacheType: string;
	cacheKey: string;
	dataClass: GithubCacheDataClass;
	scope: GithubCacheScope;
	status: GithubCachePresenceStatus;
	syncedAt: string | null;
	ageMs: number | null;
}

export interface RepoCacheStatus {
	userId: string;
	owner: string;
	repo: string;
	generatedAt: string;
	github: RepoCacheStatusEntry[];
	ui: RepoCacheStatusEntry[];
	syncJobs: GithubSyncJobStatusSummary;
}

interface CacheProbe {
	cacheType: string;
	cacheKey: string;
}

function descriptorFor(cacheType: string) {
	const descriptor = getGithubCacheDescriptor(cacheType);
	if (!descriptor) throw new Error(`Unknown GitHub cache descriptor: ${cacheType}`);
	return descriptor;
}

function ageMs(syncedAt: string | null, nowMs: number): number | null {
	if (!syncedAt) return null;
	const timestamp = Date.parse(syncedAt);
	if (Number.isNaN(timestamp)) return null;
	return Math.max(0, nowMs - timestamp);
}

function entryFromSyncedAt(
	probe: CacheProbe,
	syncedAt: string | null,
	nowMs: number,
): RepoCacheStatusEntry {
	const descriptor = descriptorFor(probe.cacheType);
	return {
		cacheType: descriptor.cacheType,
		cacheKey: probe.cacheKey,
		dataClass: descriptor.dataClass,
		scope: descriptor.scope,
		status: syncedAt
			? shouldRefresh(syncedAt, descriptor.dataClass)
				? "stale"
				: "fresh"
			: "missing",
		syncedAt,
		ageMs: ageMs(syncedAt, nowMs),
	};
}

function entryFromRawPresence(
	probe: CacheProbe,
	present: boolean,
	nowMs: number,
	syncedAt: string | null = null,
): RepoCacheStatusEntry {
	if (syncedAt) return entryFromSyncedAt(probe, syncedAt, nowMs);
	const descriptor = descriptorFor(probe.cacheType);
	return {
		cacheType: descriptor.cacheType,
		cacheKey: probe.cacheKey,
		dataClass: descriptor.dataClass,
		scope: descriptor.scope,
		status: present ? "present" : "missing",
		syncedAt: null,
		ageMs: null,
	};
}

async function readGithubResponseStatuses(
	userId: string,
	owner: string,
	repo: string,
	nowMs: number,
): Promise<RepoCacheStatusEntry[]> {
	const probes: CacheProbe[] = [
		{ cacheType: "repo", cacheKey: githubCacheKeys.repo(owner, repo) },
		{ cacheType: "repo_readme", cacheKey: githubCacheKeys.repoReadme(owner, repo) },
		{
			cacheType: "repo_issues",
			cacheKey: githubCacheKeys.repoIssues(owner, repo, "open"),
		},
		{
			cacheType: "repo_pull_requests",
			cacheKey: githubCacheKeys.repoPullRequests(owner, repo, "open"),
		},
		{ cacheType: "repo_events", cacheKey: githubCacheKeys.repoEvents(owner, repo, 30) },
		{
			cacheType: "repo_workflow_runs",
			cacheKey: githubCacheKeys.repoWorkflowRuns(owner, repo, 50),
		},
		{ cacheType: "repo_branches", cacheKey: githubCacheKeys.repoBranches(owner, repo) },
		{ cacheType: "repo_tags", cacheKey: githubCacheKeys.repoTags(owner, repo) },
		{ cacheType: "repo_releases", cacheKey: githubCacheKeys.repoReleases(owner, repo) },
		{
			cacheType: "repo_contributors",
			cacheKey: githubCacheKeys.repoContributors(owner, repo, 20),
		},
		{
			cacheType: "repo_discussions",
			cacheKey: githubCacheKeys.repoDiscussions(owner, repo),
		},
		{
			cacheType: "repo_nav_counts",
			cacheKey: githubCacheKeys.repoNavCounts(owner, repo),
		},
		{
			cacheType: "repo_languages",
			cacheKey: githubCacheKeys.repoLanguages(owner, repo),
		},
	];

	return Promise.all(
		probes.map(async (probe) =>
			entryFromSyncedAt(
				probe,
				await getGithubCacheEntrySyncedAt(userId, probe.cacheKey),
				nowMs,
			),
		),
	);
}

async function readUiFragmentStatuses(
	userId: string,
	owner: string,
	repo: string,
	nowMs: number,
): Promise<RepoCacheStatusEntry[]> {
	const repoPageProbe = {
		cacheType: "repo_page_data",
		cacheKey: githubCacheKeys.repoPageData(userId, owner, repo),
	};
	const repoPageEntry = await getCachedRepoPageDataEntry(userId, owner, repo);

	const rawProbes = await Promise.all([
		Promise.resolve({
			probe: {
				cacheType: "repo_file_tree",
				cacheKey: githubCacheKeys.repoFileTree(owner, repo),
			},
			value: getCachedRepoTree(owner, repo),
		}),
		Promise.resolve({
			probe: {
				cacheType: "readme_html",
				cacheKey: githubCacheKeys.readmeHtml(owner, repo),
			},
			value: getCachedReadmeHtml(owner, repo),
		}),
		Promise.resolve({
			probe: {
				cacheType: "overview_prs",
				cacheKey: githubCacheKeys.overviewPRs(owner, repo),
			},
			value: getCachedOverviewPRs(owner, repo),
		}),
		Promise.resolve({
			probe: {
				cacheType: "overview_issues",
				cacheKey: githubCacheKeys.overviewIssues(owner, repo),
			},
			value: getCachedOverviewIssues(owner, repo),
		}),
		Promise.resolve({
			probe: {
				cacheType: "overview_events",
				cacheKey: githubCacheKeys.overviewEvents(owner, repo),
			},
			value: getCachedOverviewEvents(owner, repo),
		}),
		Promise.resolve({
			probe: {
				cacheType: "overview_commit_activity",
				cacheKey: githubCacheKeys.overviewCommitActivity(owner, repo),
			},
			value: getCachedOverviewCommitActivity(owner, repo),
		}),
		Promise.resolve({
			probe: {
				cacheType: "overview_ci",
				cacheKey: githubCacheKeys.overviewCI(owner, repo),
			},
			value: getCachedOverviewCI(owner, repo),
		}),
		Promise.resolve({
			probe: {
				cacheType: "repo_languages",
				cacheKey: githubCacheKeys.repoLanguages(owner, repo),
			},
			value: getCachedRepoLanguages(owner, repo),
		}),
		Promise.resolve({
			probe: {
				cacheType: "repo_branches",
				cacheKey: githubCacheKeys.repoBranches(owner, repo),
			},
			value: getCachedBranches(owner, repo),
		}),
		Promise.resolve({
			probe: {
				cacheType: "repo_tags",
				cacheKey: githubCacheKeys.repoTags(owner, repo),
			},
			value: getCachedTags(owner, repo),
		}),
		Promise.resolve({
			probe: {
				cacheType: "repo_contributors",
				cacheKey:
					"repo_contributor_avatars:" +
					normalizeGithubRepoKey(owner, repo),
			},
			value: getCachedContributorAvatars(owner, repo),
		}),
	]);

	const entries: RepoCacheStatusEntry[] = [
		entryFromRawPresence(
			repoPageProbe,
			repoPageEntry !== null,
			nowMs,
			repoPageEntry?.syncedAt ?? null,
		),
	];

	for (const { probe, value } of rawProbes) {
		entries.push(entryFromRawPresence(probe, (await value) !== null, nowMs));
	}

	return entries;
}

export async function getRepoCacheStatus(
	userId: string,
	owner: string,
	repo: string,
): Promise<RepoCacheStatus> {
	const nowMs = Date.now();
	const repoKey = normalizeGithubRepoKey(owner, repo);
	const [github, ui, syncJobs] = await Promise.all([
		readGithubResponseStatuses(userId, owner, repo, nowMs),
		readUiFragmentStatuses(userId, owner, repo, nowMs),
		getGithubSyncJobStatusSummary(userId, { dedupeKeyContains: repoKey }),
	]);

	return {
		userId,
		owner,
		repo,
		generatedAt: new Date(nowMs).toISOString(),
		github,
		ui,
		syncJobs,
	};
}
