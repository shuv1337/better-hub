import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheHelpers = vi.hoisted(() => ({
	getCachedRepoPageDataEntry: vi.fn(),
	getCachedRepoTree: vi.fn(),
	getCachedBranches: vi.fn(),
	getCachedTags: vi.fn(),
	getCachedContributorAvatars: vi.fn(),
	getCachedRepoLanguages: vi.fn(),
	getCachedOverviewPRs: vi.fn(),
	getCachedOverviewIssues: vi.fn(),
	getCachedOverviewEvents: vi.fn(),
	getCachedOverviewCommitActivity: vi.fn(),
	getCachedOverviewCI: vi.fn(),
}));

const readmeHelpers = vi.hoisted(() => ({
	getCachedReadmeHtml: vi.fn(),
}));

const syncHelpers = vi.hoisted(() => ({
	getGithubCacheEntrySyncedAt: vi.fn(),
	getGithubSyncJobStatusSummary: vi.fn(),
}));

vi.mock("./repo-data-cache", () => cacheHelpers);
vi.mock("./readme-cache", () => readmeHelpers);
vi.mock("./github-sync-store", () => syncHelpers);

describe("getRepoCacheStatus", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-23T18:00:00.000Z"));
		for (const helper of Object.values(cacheHelpers)) helper.mockReset();
		readmeHelpers.getCachedReadmeHtml.mockReset();
		syncHelpers.getGithubCacheEntrySyncedAt.mockReset();
		syncHelpers.getGithubSyncJobStatusSummary.mockReset();

		cacheHelpers.getCachedRepoPageDataEntry.mockResolvedValue({
			data: { repoData: { name: "repo" } },
			syncedAt: "2026-06-23T17:20:00.000Z",
		});
		cacheHelpers.getCachedRepoTree.mockResolvedValue([{ path: "README.md" }]);
		cacheHelpers.getCachedBranches.mockResolvedValue(null);
		cacheHelpers.getCachedTags.mockResolvedValue(null);
		cacheHelpers.getCachedContributorAvatars.mockResolvedValue(null);
		cacheHelpers.getCachedRepoLanguages.mockResolvedValue({ TypeScript: 1 });
		cacheHelpers.getCachedOverviewPRs.mockResolvedValue(null);
		cacheHelpers.getCachedOverviewIssues.mockResolvedValue(null);
		cacheHelpers.getCachedOverviewEvents.mockResolvedValue(null);
		cacheHelpers.getCachedOverviewCommitActivity.mockResolvedValue(null);
		cacheHelpers.getCachedOverviewCI.mockResolvedValue(null);
		readmeHelpers.getCachedReadmeHtml.mockResolvedValue("<h1>Readme</h1>");
		syncHelpers.getGithubCacheEntrySyncedAt.mockImplementation(
			(_userId: string, cacheKey: string) =>
				Promise.resolve(
					cacheKey === "repo:owner/repo"
						? "2026-06-23T17:55:00.000Z"
						: null,
				),
		);
		syncHelpers.getGithubSyncJobStatusSummary.mockResolvedValue({
			counts: { pending: 1, running: 0, failed: 1 },
			failed: [
				{
					id: 9,
					dedupeKey: "repo_events:owner/repo:30",
					jobType: "repo_events",
					attempts: 8,
					lastError: "rate limited",
					updatedAt: "2026-06-23T17:59:00.000Z",
				},
			],
		});
	});

	it("builds repo cache status without GitHub calls", async () => {
		const { getRepoCacheStatus } = await import("./github-cache-status");

		const status = await getRepoCacheStatus("user-1", "Owner", "Repo");

		expect(status.generatedAt).toBe("2026-06-23T18:00:00.000Z");
		expect(status.github.find((entry) => entry.cacheType === "repo")).toMatchObject({
			cacheKey: "repo:owner/repo",
			dataClass: "repo-chrome",
			status: "fresh",
			syncedAt: "2026-06-23T17:55:00.000Z",
			ageMs: 5 * 60 * 1000,
		});
		expect(
			status.ui.find((entry) => entry.cacheType === "repo_page_data"),
		).toMatchObject({
			cacheKey: "repo_page_data:user-1:owner/repo",
			status: "stale",
			syncedAt: "2026-06-23T17:20:00.000Z",
		});
		expect(status.ui.find((entry) => entry.cacheType === "readme_html")).toMatchObject({
			cacheKey: "readme_html:owner/repo",
			status: "present",
			syncedAt: null,
		});
		expect(status.syncJobs).toEqual({
			counts: { pending: 1, running: 0, failed: 1 },
			failed: [
				{
					id: 9,
					dedupeKey: "repo_events:owner/repo:30",
					jobType: "repo_events",
					attempts: 8,
					lastError: "rate limited",
					updatedAt: "2026-06-23T17:59:00.000Z",
				},
			],
		});
		expect(syncHelpers.getGithubSyncJobStatusSummary).toHaveBeenCalledWith("user-1", {
			dedupeKeyContains: "owner/repo",
		});
	});
});
