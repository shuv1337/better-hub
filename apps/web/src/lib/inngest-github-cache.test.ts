import { beforeEach, describe, expect, it, vi } from "vitest";

const githubAuthContext = vi.hoisted(() => ({
	resolveGitHubAuthContextForUser: vi.fn(),
}));

const githubCacheLock = vi.hoisted(() => ({
	acquireGithubCacheWarmLock: vi.fn(),
	isGithubCacheWarmLockHeld: vi.fn(),
	releaseGithubCacheWarmLock: vi.fn(),
	renewGithubCacheWarmLock: vi.fn(),
	storeGithubCacheWarmResult: vi.fn(),
}));

const githubCacheWarmer = vi.hoisted(() => ({
	createGithubCacheWarmSkippedResult: vi.fn((params) => ({
		userId: params.userId,
		runId: params.run.runId,
		source: params.run.source,
		discoveredRepos: 0,
		selectedRepos: 0,
		warmedRepos: 0,
		skippedRepos: 0,
		failedRepos: 0,
		jobsQueued: 0,
		durationMs: 0,
		skippedReason: params.skippedReason,
		errors: [],
	})),
	warmPersonalGithubCache: vi.fn(),
}));

vi.mock("@/lib/github-auth-context", () => githubAuthContext);
vi.mock("@/lib/github-cache-lock", () => githubCacheLock);
vi.mock("@/lib/github-cache-warmer", () => githubCacheWarmer);
vi.mock("@/lib/mixedbread", () => ({ embedText: vi.fn(), embedTexts: vi.fn() }));
vi.mock("@/lib/embedding-store", () => ({
	getExistingContentHash: vi.fn(),
	hashContent: vi.fn((value: string) => value),
	upsertEmbedding: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
	prisma: {
		usageLog: {
			findMany: vi.fn(),
			updateMany: vi.fn(),
		},
	},
}));
vi.mock("@/lib/billing/stripe", () => ({ reportUsageToStripe: vi.fn() }));
vi.mock("@/lib/billing/config", () => ({ STRIPE_MAX_EVENT_AGE_DAYS: 35 }));

const eventData = {
	userId: "user-1",
	runId: "run-1",
	lockKey: "github-cache-warm-lock:user-1",
	options: { mode: "quick" as const, maxRepos: 3 },
};

describe("github cache Inngest worker", () => {
	beforeEach(() => {
		for (const helper of Object.values(githubAuthContext)) helper.mockReset();
		for (const helper of Object.values(githubCacheLock)) helper.mockReset();
		for (const helper of Object.values(githubCacheWarmer)) helper.mockReset();
		githubCacheWarmer.createGithubCacheWarmSkippedResult.mockImplementation(
			(params) => ({
				userId: params.userId,
				runId: params.run.runId,
				source: params.run.source,
				discoveredRepos: 0,
				selectedRepos: 0,
				warmedRepos: 0,
				skippedRepos: 0,
				failedRepos: 0,
				jobsQueued: 0,
				durationMs: 0,
				skippedReason: params.skippedReason,
				errors: [],
			}),
		);
		githubCacheLock.releaseGithubCacheWarmLock.mockResolvedValue(true);
		githubCacheLock.renewGithubCacheWarmLock.mockResolvedValue(true);
	});

	it("continues when the API-owned runId lock is held and does not reacquire it", async () => {
		const authCtx = { userId: "user-1", token: "token" };
		const warmResult = {
			userId: "user-1",
			runId: "run-1",
			source: "inngest",
			discoveredRepos: 1,
			selectedRepos: 1,
			warmedRepos: 1,
			skippedRepos: 0,
			failedRepos: 0,
			jobsQueued: 0,
			durationMs: 12,
			errors: [],
		};
		githubCacheLock.isGithubCacheWarmLockHeld.mockResolvedValue(true);
		githubAuthContext.resolveGitHubAuthContextForUser.mockResolvedValue(authCtx);
		githubCacheWarmer.warmPersonalGithubCache.mockResolvedValue(warmResult);

		const { handleGithubCacheWarmEvent } = await import("./inngest");
		await expect(handleGithubCacheWarmEvent(eventData)).resolves.toBe(warmResult);

		expect(githubCacheLock.acquireGithubCacheWarmLock).not.toHaveBeenCalled();
		expect(githubAuthContext.resolveGitHubAuthContextForUser).toHaveBeenCalledWith(
			"user-1",
		);
		expect(githubCacheWarmer.warmPersonalGithubCache).toHaveBeenCalledWith({
			authCtx,
			options: eventData.options,
			run: {
				runId: "run-1",
				source: "inngest",
				lockKey: "github-cache-warm-lock:user-1",
				lockAlreadyHeld: true,
			},
		});
		expect(githubCacheLock.releaseGithubCacheWarmLock).toHaveBeenCalledWith(
			"user-1",
			"run-1",
		);
	});

	it("skips without warming when the runId no longer owns the lock", async () => {
		githubCacheLock.isGithubCacheWarmLockHeld.mockResolvedValue(false);

		const { handleGithubCacheWarmEvent } = await import("./inngest");
		const result = await handleGithubCacheWarmEvent(eventData);

		expect(result.skippedReason).toBe("lock-lost");
		expect(githubAuthContext.resolveGitHubAuthContextForUser).not.toHaveBeenCalled();
		expect(githubCacheWarmer.warmPersonalGithubCache).not.toHaveBeenCalled();
		expect(githubCacheLock.releaseGithubCacheWarmLock).not.toHaveBeenCalled();
	});
});
