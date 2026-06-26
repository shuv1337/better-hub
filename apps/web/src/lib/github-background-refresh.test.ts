import { beforeEach, describe, expect, it, vi } from "vitest";

const waitUntil = vi.hoisted(() => vi.fn());

const githubAuthContext = vi.hoisted(() => ({
	getRequestGitHubAuthContext: vi.fn(),
}));

const repoDataCacheVc = vi.hoisted(() => ({
	getCachedRepoPageDataEntry: vi.fn(),
}));

const githubSyncStore = vi.hoisted(() => ({
	getGithubCacheEntry: vi.fn(),
	enqueueGithubSyncJob: vi.fn(),
	claimDueGithubSyncJobs: vi.fn(),
	markGithubSyncJobFailed: vi.fn(),
	markGithubSyncJobSucceeded: vi.fn(),
	getGithubCacheDescriptor: vi.fn(),
	getSharedCacheEntry: vi.fn(),
	upsertGithubCacheEntry: vi.fn(),
	upsertSharedCacheEntry: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({ waitUntil }));
vi.mock("./github-auth-context", () => githubAuthContext);
vi.mock("./repo-data-cache-vc", () => repoDataCacheVc);
vi.mock("./github-sync-store", () => githubSyncStore);

const authCtx = {
	userId: "user-1",
	token: "token",
	octokit: { repos: { get: vi.fn() } },
	forceRefresh: false,
	githubUser: { login: "alice" },
};

describe("runGithubBackgroundTask", () => {
	beforeEach(() => {
		waitUntil.mockReset();
		waitUntil.mockImplementation((promise: Promise<unknown>) => promise);
	});

	it("registers the task with waitUntil", async () => {
		const { runGithubBackgroundTask } = await import("./github-background");
		const task = Promise.resolve("done");
		runGithubBackgroundTask(task);

		expect(waitUntil).toHaveBeenCalledTimes(1);
		const registered = waitUntil.mock.calls[0]?.[0] as Promise<unknown>;
		await expect(registered).resolves.toBe("done");
	});

	it("falls back to void task when waitUntil throws", async () => {
		waitUntil.mockImplementation(() => {
			throw new Error("waitUntil unavailable");
		});

		const { runGithubBackgroundTask } = await import("./github-background");
		const task = Promise.resolve("done");
		runGithubBackgroundTask(task);

		await expect(task).resolves.toBe("done");
	});

	it("swallows task rejection after registering with waitUntil", async () => {
		waitUntil.mockImplementation((promise: Promise<unknown>) => promise);
		const { runGithubBackgroundTask } = await import("./github-background");
		const task = Promise.reject(new Error("refresh failed"));
		runGithubBackgroundTask(task);

		const registered = waitUntil.mock.calls[0]?.[0] as Promise<unknown>;
		await expect(registered).resolves.toBeUndefined();
	});
});

describe("github.ts background refresh integration", () => {
	beforeEach(() => {
		waitUntil.mockReset();
		waitUntil.mockImplementation((promise: Promise<unknown>) => promise);
		githubAuthContext.getRequestGitHubAuthContext.mockReset();
		repoDataCacheVc.getCachedRepoPageDataEntry.mockReset();
		githubSyncStore.getGithubCacheEntry.mockReset();
		githubSyncStore.enqueueGithubSyncJob.mockReset();
		githubSyncStore.claimDueGithubSyncJobs.mockReset();
		githubSyncStore.getSharedCacheEntry.mockReset();
		githubSyncStore.upsertGithubCacheEntry.mockReset();
		githubSyncStore.upsertSharedCacheEntry.mockReset();

		githubAuthContext.getRequestGitHubAuthContext.mockResolvedValue(authCtx);
		githubSyncStore.enqueueGithubSyncJob.mockResolvedValue(undefined);
		githubSyncStore.claimDueGithubSyncJobs.mockResolvedValue([]);
		githubSyncStore.getSharedCacheEntry.mockResolvedValue(null);
		githubSyncStore.upsertGithubCacheEntry.mockResolvedValue(undefined);
		githubSyncStore.upsertSharedCacheEntry.mockResolvedValue(undefined);
	});

	it("registers repo page refresh when cached page data is stale", async () => {
		repoDataCacheVc.getCachedRepoPageDataEntry.mockResolvedValue({
			data: {
				repoData: {
					private: false,
					owner: { type: "User", login: "owner", avatar_url: "" },
					fork: false,
					size: 1,
					default_branch: "main",
					parent: null,
					has_discussions: false,
				},
				navCounts: {
					openIssues: 0,
					openPrs: 0,
					activeRuns: 0,
					discussions: 0,
				},
				viewerHasStarred: false,
				viewerIsOrgMember: false,
				latestCommit: null,
				viewerLogin: "owner",
			},
			syncedAt: "2000-01-01T00:00:00.000Z",
		});

		const { getRepoPageData } = await import("./github");
		const result = await getRepoPageData("owner", "repo");

		expect(result.success).toBe(true);
		expect(waitUntil).toHaveBeenCalled();
	});

	it("registers sync queue draining when local-first cache is stale", async () => {
		githubSyncStore.getGithubCacheEntry.mockResolvedValue({
			data: { id: 1, name: "repo", full_name: "owner/repo" },
			syncedAt: "2000-01-01T00:00:00.000Z",
		});

		const { getRepo } = await import("./github");
		const result = await getRepo("owner", "repo");

		expect(result).toEqual({ id: 1, name: "repo", full_name: "owner/repo" });
		expect(githubSyncStore.enqueueGithubSyncJob).toHaveBeenCalled();
		expect(waitUntil).toHaveBeenCalled();
	});
});
