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
	isGithubCacheWarmLockHeld: vi.fn(),
}));

vi.mock("./github", () => github);
vi.mock("./repo-overview-cache-warmer", () => overviewWarmers);
vi.mock("./github-cache-lock", () => githubCacheLock);

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
		githubCacheLock.isGithubCacheWarmLockHeld.mockReset();
		githubCacheLock.isGithubCacheWarmLockHeld.mockResolvedValue(true);
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

		expect(github.getUserRepos).toHaveBeenCalledWith("updated", 100, { authCtx });
		expect(github.getUserOrgs).toHaveBeenCalledWith(50, { authCtx });
		expect(github.getOrgRepos).toHaveBeenCalledWith(
			"org",
			{ perPage: 100, sort: "updated", type: "all" },
			{ authCtx },
		);
		expect(repos.map((item) => item.fullName)).toEqual(["org/newest", "org/same"]);
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
	});

	it("returns lock-lost when the run lock no longer belongs to the run", async () => {
		githubCacheLock.isGithubCacheWarmLockHeld.mockResolvedValue(false);

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
});
