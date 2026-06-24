import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const github = vi.hoisted(() => ({
	fetchAndCacheRepoPageDataWithAuth: vi.fn(),
	getOrgRepos: vi.fn(),
	getRepoDiscussionsPage: vi.fn(),
	getRepoReleases: vi.fn(),
	getRepoWorkflowRuns: vi.fn(),
	getUserOrgs: vi.fn(),
	getUserRepos: vi.fn(),
}));

const overviewWarmers = vi.hoisted(() => ({
	getRepoReadmeHtmlCacheFirst: vi.fn(),
	warmLayoutMetadataFull: vi.fn(),
	warmLayoutMetadataQuick: vi.fn(),
	warmOverviewCIStatus: vi.fn(),
	warmOverviewCommitActivity: vi.fn(),
	warmOverviewEvents: vi.fn(),
	warmOverviewIssues: vi.fn(),
	warmOverviewPRs: vi.fn(),
	warmRepoFileTreeForLayout: vi.fn(),
}));

const githubCacheLock = vi.hoisted(() => ({
	renewGithubCacheWarmLock: vi.fn(),
}));

const repoDataCache = vi.hoisted(() => ({
	getCachedBranches: vi.fn(),
	getCachedContributorAvatars: vi.fn(),
	getCachedOverviewCI: vi.fn(),
	getCachedOverviewCommitActivity: vi.fn(),
	getCachedOverviewEvents: vi.fn(),
	getCachedOverviewIssues: vi.fn(),
	getCachedOverviewPRs: vi.fn(),
	getCachedRepoLanguages: vi.fn(),
	getCachedRepoPageDataEntry: vi.fn(),
	getCachedRepoTree: vi.fn(),
	getCachedTags: vi.fn(),
}));

const readmeCache = vi.hoisted(() => ({
	getCachedReadmeHtml: vi.fn(),
}));

const syncStore = vi.hoisted(() => ({
	getGithubCacheEntrySyncedAt: vi.fn(),
}));

vi.mock("./github", () => github);
vi.mock("./repo-overview-cache-warmer", () => overviewWarmers);
vi.mock("./github-cache-lock", () => githubCacheLock);
vi.mock("./repo-data-cache", () => repoDataCache);
vi.mock("./readme-cache", () => readmeCache);
vi.mock("./github-sync-store", () => syncStore);

const authCtx = {
	userId: "user-1",
	token: "token",
	octokit: {},
	forceRefresh: false,
	githubUser: { accessToken: "token" },
} as never;

function repo(overrides: Record<string, unknown>) {
	return {
		name: "repo",
		full_name: "owner/repo",
		private: false,
		pushed_at: "2026-06-23T10:00:00.000Z",
		updated_at: "2026-06-23T09:00:00.000Z",
		default_branch: "main",
		owner: { login: "owner" },
		...overrides,
	};
}

describe("github-cache-warmer", () => {
	beforeEach(() => {
		for (const helper of Object.values(github)) helper.mockReset();
		for (const helper of Object.values(overviewWarmers)) helper.mockReset();
		for (const helper of Object.values(repoDataCache)) helper.mockReset();
		readmeCache.getCachedReadmeHtml.mockReset();
		syncStore.getGithubCacheEntrySyncedAt.mockReset();
		githubCacheLock.renewGithubCacheWarmLock.mockReset();
		githubCacheLock.renewGithubCacheWarmLock.mockResolvedValue(true);
		for (const helper of Object.values(repoDataCache)) helper.mockResolvedValue(null);
		readmeCache.getCachedReadmeHtml.mockResolvedValue(null);
		syncStore.getGithubCacheEntrySyncedAt.mockResolvedValue(null);
		vi.spyOn(console, "info").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("discovers repos from user and org sources, dedupes, sorts, and respects maxRepos", async () => {
		github.getUserRepos.mockResolvedValue([
			repo({
				name: "older",
				full_name: "me/older",
				owner: { login: "me" },
				pushed_at: "2026-06-21T10:00:00.000Z",
			}),
			repo({
				name: "same",
				full_name: "org/same",
				owner: { login: "org" },
				pushed_at: "2026-06-22T10:00:00.000Z",
			}),
		]);
		github.getUserOrgs.mockResolvedValue([{ login: "org" }]);
		github.getOrgRepos.mockResolvedValue([
			repo({
				name: "newest",
				full_name: "org/newest",
				owner: { login: "org" },
				pushed_at: "2026-06-23T10:00:00.000Z",
			}),
			repo({
				name: "same",
				full_name: "org/same",
				owner: { login: "org" },
				pushed_at: "2026-06-22T12:00:00.000Z",
			}),
		]);

		const { discoverPersonalRepos } = await import("./github-cache-warmer");
		const repos = await discoverPersonalRepos(authCtx, { maxRepos: 2 });

		expect(github.getUserRepos).toHaveBeenCalledWith("pushed", 100, { authCtx });
		expect(github.getUserOrgs).toHaveBeenCalledWith(10, { authCtx });
		expect(github.getOrgRepos).toHaveBeenCalledWith(
			"org",
			{ perPage: 50, sort: "pushed", type: "all" },
			{ authCtx },
		);
		expect(repos.map((item) => item.fullName)).toEqual(["org/newest", "org/same"]);
	});

	it("caps org traversal and org repo list volume during discovery", async () => {
		github.getUserRepos.mockResolvedValue([]);
		github.getUserOrgs.mockResolvedValue([
			{ login: "org-a" },
			{ login: "org-b" },
			{ login: "org-c" },
		]);
		github.getOrgRepos.mockResolvedValue([]);

		const { discoverPersonalRepos } = await import("./github-cache-warmer");
		await discoverPersonalRepos(authCtx, {
			maxRepos: 5,
			maxOrgs: 2,
			orgReposPerOrg: 25,
		});

		expect(github.getUserOrgs).toHaveBeenCalledWith(2, { authCtx });
		expect(github.getOrgRepos).toHaveBeenCalledTimes(2);
		expect(github.getOrgRepos).toHaveBeenNthCalledWith(
			1,
			"org-a",
			{ perPage: 25, sort: "pushed", type: "all" },
			{ authCtx },
		);
		expect(github.getOrgRepos).toHaveBeenNthCalledWith(
			2,
			"org-b",
			{ perPage: 25, sort: "pushed", type: "all" },
			{ authCtx },
		);
	});

	it("warms quick-mode repo caches in the expected shared-cache path", async () => {
		github.getUserRepos.mockResolvedValue([repo({})]);
		github.getUserOrgs.mockResolvedValue([]);
		github.fetchAndCacheRepoPageDataWithAuth.mockResolvedValue({
			success: true,
			data: {
				repoData: {
					default_branch: "main",
					size: 1,
					has_discussions: true,
				},
				languages: { TypeScript: 1 },
			},
		});
		for (const helper of Object.values(overviewWarmers)) helper.mockResolvedValue(null);
		github.getRepoWorkflowRuns.mockResolvedValue([]);

		const { warmPersonalGithubCache } = await import("./github-cache-warmer");
		const result = await warmPersonalGithubCache({
			authCtx,
			options: { mode: "quick", maxRepos: 1, maxConcurrentRepos: 1 },
			run: {
				runId: "run-1",
				source: "script",
				lockKey: "lock",
				lockAlreadyHeld: true,
			},
		});

		expect(github.fetchAndCacheRepoPageDataWithAuth).toHaveBeenCalledWith(
			authCtx,
			"owner",
			"repo",
		);
		expect(overviewWarmers.warmRepoFileTreeForLayout).toHaveBeenCalledWith(
			"owner",
			"repo",
			"main",
			authCtx,
		);
		expect(overviewWarmers.warmLayoutMetadataQuick).toHaveBeenCalledWith({
			owner: "owner",
			repo: "repo",
			pageData: expect.objectContaining({ languages: { TypeScript: 1 } }),
			authCtx,
			isEmptyRepo: false,
		});
		expect(overviewWarmers.getRepoReadmeHtmlCacheFirst).toHaveBeenCalledWith(
			"owner",
			"repo",
			"main",
			authCtx,
			{},
		);
		expect(github.getRepoWorkflowRuns).toHaveBeenCalledWith("owner", "repo", 50, {
			authCtx,
		});
		expect(result.warmedRepos).toBe(1);
		expect(result.errors).toEqual([]);
	});

	it("full mode adds release, discussion, commit activity, and full metadata stages", async () => {
		github.getUserRepos.mockResolvedValue([repo({})]);
		github.getUserOrgs.mockResolvedValue([]);
		github.fetchAndCacheRepoPageDataWithAuth.mockResolvedValue({
			success: true,
			data: {
				repoData: {
					default_branch: "main",
					size: 1,
					has_discussions: true,
				},
				languages: {},
			},
		});
		for (const helper of Object.values(overviewWarmers)) helper.mockResolvedValue(null);
		github.getRepoWorkflowRuns.mockResolvedValue([]);
		github.getRepoReleases.mockResolvedValue([]);
		github.getRepoDiscussionsPage.mockResolvedValue({});

		const { warmPersonalGithubCache } = await import("./github-cache-warmer");
		await warmPersonalGithubCache({
			authCtx,
			options: { mode: "full", maxRepos: 1, maxConcurrentRepos: 1 },
			run: {
				runId: "run-1",
				source: "script",
				lockKey: "lock",
				lockAlreadyHeld: true,
			},
		});

		expect(overviewWarmers.warmLayoutMetadataFull).toHaveBeenCalledWith({
			owner: "owner",
			repo: "repo",
			pageData: expect.any(Object),
			authCtx: expect.objectContaining({ forceRefresh: true }),
			isEmptyRepo: false,
		});
		expect(github.getRepoReleases).toHaveBeenCalledWith("owner", "repo", {
			authCtx: expect.objectContaining({ forceRefresh: true }),
		});
		expect(github.getRepoDiscussionsPage).toHaveBeenCalledWith("owner", "repo", {
			authCtx: expect.objectContaining({ forceRefresh: true }),
		});
		expect(overviewWarmers.warmOverviewCommitActivity).toHaveBeenCalledWith(
			"owner",
			"repo",
			expect.objectContaining({ forceRefresh: true }),
		);
		expect(overviewWarmers.warmOverviewPRs).toHaveBeenCalledWith(
			"owner",
			"repo",
			expect.objectContaining({ forceRefresh: true }),
		);
		expect(overviewWarmers.getRepoReadmeHtmlCacheFirst).toHaveBeenCalledWith(
			"owner",
			"repo",
			"main",
			expect.objectContaining({ forceRefresh: true }),
			{ forceRefresh: true },
		);
	});

	it("returns lock-lost when the run lock no longer belongs to the run", async () => {
		githubCacheLock.renewGithubCacheWarmLock.mockResolvedValue(false);

		const { warmPersonalGithubCache } = await import("./github-cache-warmer");
		const result = await warmPersonalGithubCache({
			authCtx,
			options: { mode: "quick", maxRepos: 1, maxConcurrentRepos: 1 },
			run: {
				runId: "run-1",
				source: "script",
				lockKey: "lock",
				lockAlreadyHeld: true,
			},
		});

		expect(result.skippedReason).toBe("lock-lost");
		expect(github.getUserRepos).not.toHaveBeenCalled();
	});

	it("honors refreshStaleOnly by reusing fresh repo page data and skipping fresh stage caches", async () => {
		github.getUserRepos.mockResolvedValue([repo({})]);
		github.getUserOrgs.mockResolvedValue([]);
		repoDataCache.getCachedRepoPageDataEntry.mockResolvedValue({
			data: {
				repoData: {
					default_branch: "main",
					size: 1,
					has_discussions: false,
				},
				languages: {},
			},
			syncedAt: new Date().toISOString(),
		});
		repoDataCache.getCachedRepoTree.mockResolvedValue([{ path: "README.md" }]);
		repoDataCache.getCachedRepoLanguages.mockResolvedValue({});
		repoDataCache.getCachedBranches.mockResolvedValue([{ name: "main" }]);
		repoDataCache.getCachedTags.mockResolvedValue([]);
		repoDataCache.getCachedContributorAvatars.mockResolvedValue({
			avatars: [],
			totalCount: 0,
		});
		readmeCache.getCachedReadmeHtml.mockResolvedValue("<h1>Cached</h1>");
		repoDataCache.getCachedOverviewPRs.mockResolvedValue([]);
		repoDataCache.getCachedOverviewIssues.mockResolvedValue([]);
		repoDataCache.getCachedOverviewEvents.mockResolvedValue([]);
		repoDataCache.getCachedOverviewCI.mockResolvedValue({});
		syncStore.getGithubCacheEntrySyncedAt.mockResolvedValue(new Date().toISOString());

		const { warmPersonalGithubCache } = await import("./github-cache-warmer");
		const result = await warmPersonalGithubCache({
			authCtx,
			options: {
				mode: "quick",
				maxRepos: 1,
				maxConcurrentRepos: 1,
				refreshStaleOnly: true,
			},
			run: {
				runId: "run-1",
				source: "script",
				lockKey: "lock",
				lockAlreadyHeld: true,
			},
		});

		expect(result.warmedRepos).toBe(1);
		expect(github.fetchAndCacheRepoPageDataWithAuth).not.toHaveBeenCalled();
		expect(overviewWarmers.warmRepoFileTreeForLayout).not.toHaveBeenCalled();
		expect(overviewWarmers.warmLayoutMetadataQuick).not.toHaveBeenCalled();
		expect(overviewWarmers.getRepoReadmeHtmlCacheFirst).not.toHaveBeenCalled();
		expect(github.getRepoWorkflowRuns).not.toHaveBeenCalled();
	});
});
