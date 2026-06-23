import { beforeEach, describe, expect, it, vi } from "vitest";

const redisGet = vi.fn();
const redisSet = vi.fn();

vi.mock("./redis", () => ({
	redis: {
		get: redisGet,
		set: redisSet,
	},
}));

describe("repo-data-cache repo page envelopes", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-23T12:00:00.000Z"));
		redisGet.mockReset();
		redisSet.mockReset();
	});

	it("unwraps legacy raw repo page data", async () => {
		const { getCachedRepoPageData, getCachedRepoPageDataEntry } =
			await import("./repo-data-cache");
		const legacy = { repoData: { name: "repo" }, navCounts: { openPrs: 1 } };
		redisGet.mockResolvedValue(legacy);

		await expect(getCachedRepoPageData("user-1", "Owner", "Repo")).resolves.toBe(
			legacy,
		);
		await expect(
			getCachedRepoPageDataEntry("user-1", "Owner", "Repo"),
		).resolves.toEqual({
			data: legacy,
			syncedAt: null,
		});
	});

	it("unwraps v2 repo page data entries with syncedAt", async () => {
		const { getCachedRepoPageData, getCachedRepoPageDataEntry } =
			await import("./repo-data-cache");
		const data = { repoData: { name: "repo" } };
		redisGet.mockResolvedValue({
			v: 2,
			syncedAt: "2026-06-23T11:45:00.000Z",
			data,
		});

		await expect(getCachedRepoPageData("user-1", "Owner", "Repo")).resolves.toBe(data);
		await expect(
			getCachedRepoPageDataEntry("user-1", "Owner", "Repo"),
		).resolves.toEqual({
			data,
			syncedAt: "2026-06-23T11:45:00.000Z",
		});
	});

	it("writes v2 repo page envelopes without a hard TTL", async () => {
		const { setCachedRepoPageData } = await import("./repo-data-cache");
		const data = { repoData: { name: "repo" } };

		await setCachedRepoPageData("user-1", "Owner", "Repo", data);

		expect(redisSet).toHaveBeenCalledWith("repo_page_data:user-1:owner/repo", {
			v: 2,
			syncedAt: "2026-06-23T12:00:00.000Z",
			data,
		});
	});

	it("rewraps nav count updates and preserves existing syncedAt", async () => {
		const { updateCachedRepoPageDataNavCounts } = await import("./repo-data-cache");
		redisGet.mockResolvedValue({
			v: 2,
			syncedAt: "2026-06-23T11:45:00.000Z",
			data: {
				repoData: { name: "repo" },
				navCounts: { openPrs: 1, openIssues: 2, activeRuns: 3 },
			},
		});

		await updateCachedRepoPageDataNavCounts("user-1", "Owner", "Repo", {
			openPrs: 4,
		});

		expect(redisSet).toHaveBeenCalledWith("repo_page_data:user-1:owner/repo", {
			v: 2,
			syncedAt: "2026-06-23T11:45:00.000Z",
			data: {
				repoData: { name: "repo" },
				navCounts: { openPrs: 4, openIssues: 2, activeRuns: 3 },
			},
		});
	});

	it("acquires repo page refresh locks with NX and EX", async () => {
		const { tryAcquireRepoPageRefreshLock } = await import("./repo-data-cache");
		redisSet.mockResolvedValue("OK");

		await expect(
			tryAcquireRepoPageRefreshLock("user-1", "Owner", "Repo", 99),
		).resolves.toBe(true);

		expect(redisSet).toHaveBeenCalledWith(
			"repo-page-refresh-lock:user-1:owner/repo",
			"1",
			{ ex: 99, nx: true },
		);
	});
});
