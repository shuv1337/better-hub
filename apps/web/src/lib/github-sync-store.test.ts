import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { githubSyncJob } = vi.hoisted(() => ({
	githubSyncJob: {
		findUnique: vi.fn(),
		create: vi.fn(),
		updateMany: vi.fn(),
	},
}));

vi.mock("./db", () => ({
	prisma: { githubSyncJob },
}));

vi.mock("./redis", () => ({
	redis: {},
}));

describe("enqueueGithubSyncJob", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-23T18:00:00.000Z"));
		githubSyncJob.findUnique.mockReset();
		githubSyncJob.create.mockReset();
		githubSyncJob.updateMany.mockReset();
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
