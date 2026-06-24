import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { githubSyncJob, redis } = vi.hoisted(() => ({
	githubSyncJob: {
		findUnique: vi.fn(),
		findMany: vi.fn(),
		create: vi.fn(),
		updateMany: vi.fn(),
	},
	redis: {
		get: vi.fn(),
	},
}));

vi.mock("./db", () => ({
	prisma: { githubSyncJob },
}));

vi.mock("./redis", () => ({
	redis,
}));

describe("enqueueGithubSyncJob", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-23T18:00:00.000Z"));
		githubSyncJob.findUnique.mockReset();
		githubSyncJob.findMany.mockReset();
		githubSyncJob.create.mockReset();
		githubSyncJob.updateMany.mockReset();
		redis.get.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("creates a pending job when no dedupe row exists", async () => {
		githubSyncJob.findUnique.mockResolvedValue(null);
		githubSyncJob.create.mockResolvedValue({});

		const { enqueueGithubSyncJob } = await import("./github-sync-store");
		await enqueueGithubSyncJob("user-1", "repo:owner/repo", "repo", {
			owner: "owner",
		});

		expect(githubSyncJob.create).toHaveBeenCalledWith({
			data: {
				userId: "user-1",
				dedupeKey: "repo:owner/repo",
				jobType: "repo",
				payloadJson: JSON.stringify({ owner: "owner" }),
				status: "pending",
				attempts: 0,
				nextAttemptAt: "2026-06-23T18:00:00.000Z",
				createdAt: "2026-06-23T18:00:00.000Z",
				updatedAt: "2026-06-23T18:00:00.000Z",
			},
		});
	});

	it("revives a failed row for a new refresh", async () => {
		githubSyncJob.findUnique.mockResolvedValue({ id: 42, status: "failed" });
		githubSyncJob.updateMany.mockResolvedValue({ count: 1 });

		const { enqueueGithubSyncJob } = await import("./github-sync-store");
		await enqueueGithubSyncJob("user-1", "repo:owner/repo", "repo", {
			owner: "new-owner",
		});

		expect(githubSyncJob.updateMany).toHaveBeenCalledWith({
			where: { id: 42, status: "failed" },
			data: {
				jobType: "repo",
				payloadJson: JSON.stringify({ owner: "new-owner" }),
				status: "pending",
				attempts: 0,
				nextAttemptAt: "2026-06-23T18:00:00.000Z",
				startedAt: null,
				lastError: null,
				updatedAt: "2026-06-23T18:00:00.000Z",
			},
		});
		expect(githubSyncJob.create).not.toHaveBeenCalled();
	});

	it("updates an existing pending row without delaying the refresh", async () => {
		githubSyncJob.findUnique.mockResolvedValue({ id: 7, status: "pending" });
		githubSyncJob.updateMany.mockResolvedValue({ count: 1 });

		const { enqueueGithubSyncJob } = await import("./github-sync-store");
		await enqueueGithubSyncJob("user-1", "repo:owner/repo", "repo", {
			owner: "updated",
		});

		expect(githubSyncJob.updateMany).toHaveBeenCalledWith({
			where: { id: 7, status: "pending" },
			data: {
				jobType: "repo",
				payloadJson: JSON.stringify({ owner: "updated" }),
				nextAttemptAt: "2026-06-23T18:00:00.000Z",
				updatedAt: "2026-06-23T18:00:00.000Z",
			},
		});
		expect(githubSyncJob.create).not.toHaveBeenCalled();
	});

	it("leaves an existing running row untouched", async () => {
		githubSyncJob.findUnique.mockResolvedValue({ id: 9, status: "running" });

		const { enqueueGithubSyncJob } = await import("./github-sync-store");
		await enqueueGithubSyncJob("user-1", "repo:owner/repo", "repo", {
			owner: "owner",
		});

		expect(githubSyncJob.updateMany).not.toHaveBeenCalled();
		expect(githubSyncJob.create).not.toHaveBeenCalled();
	});

	it("ignores concurrent insert race errors", async () => {
		githubSyncJob.findUnique.mockResolvedValue(null);
		githubSyncJob.create.mockRejectedValue({ code: "P2002" });

		const { enqueueGithubSyncJob } = await import("./github-sync-store");
		await expect(
			enqueueGithubSyncJob("user-1", "repo:owner/repo", "repo", {
				owner: "owner",
			}),
		).resolves.toBeUndefined();
	});
});

describe("cache and sync job status helpers", () => {
	beforeEach(() => {
		githubSyncJob.findMany.mockReset();
		redis.get.mockReset();
	});

	it("returns only the syncedAt timestamp for a cache entry", async () => {
		redis.get.mockResolvedValue({
			data: { ok: true },
			syncedAt: "2026-06-23T18:00:00.000Z",
			etag: null,
		});

		const { getGithubCacheEntrySyncedAt } = await import("./github-sync-store");

		await expect(
			getGithubCacheEntrySyncedAt("user-1", "repo:owner/repo"),
		).resolves.toBe("2026-06-23T18:00:00.000Z");
		expect(redis.get).toHaveBeenCalledWith("gh:user-1:repo:owner/repo");
	});

	it("summarizes sync job counts and failed rows", async () => {
		githubSyncJob.findMany.mockResolvedValue([
			{
				id: 1,
				dedupeKey: "repo:owner/repo",
				jobType: "repo",
				status: "pending",
				attempts: 0,
				lastError: null,
				updatedAt: "2026-06-23T18:00:00.000Z",
			},
			{
				id: 2,
				dedupeKey: "repo_events:owner/repo:30",
				jobType: "repo_events",
				status: "failed",
				attempts: 8,
				lastError: "rate limited",
				updatedAt: "2026-06-23T18:01:00.000Z",
			},
		]);

		const { getGithubSyncJobStatusSummary } = await import("./github-sync-store");

		await expect(
			getGithubSyncJobStatusSummary("user-1", {
				dedupeKeyContains: "owner/repo",
				failedLimit: 5,
			}),
		).resolves.toEqual({
			counts: { pending: 1, running: 0, failed: 1 },
			failed: [
				{
					id: 2,
					dedupeKey: "repo_events:owner/repo:30",
					jobType: "repo_events",
					attempts: 8,
					lastError: "rate limited",
					updatedAt: "2026-06-23T18:01:00.000Z",
				},
			],
		});
		expect(githubSyncJob.findMany).toHaveBeenCalledWith({
			where: { userId: "user-1", dedupeKey: { contains: "owner/repo" } },
			select: {
				id: true,
				dedupeKey: true,
				jobType: true,
				status: true,
				attempts: true,
				lastError: true,
				updatedAt: true,
			},
			orderBy: [{ status: "asc" }, { updatedAt: "desc" }, { id: "asc" }],
		});
	});
});
