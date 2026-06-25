import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextHeaders = vi.hoisted(() => ({
	headers: vi.fn(),
}));

const authModule = vi.hoisted(() => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

const githubAuthContext = vi.hoisted(() => ({
	resolveGitHubAuthContextForUser: vi.fn(),
}));

const githubCacheLock = vi.hoisted(() => ({
	acquireGithubCacheWarmLock: vi.fn(),
	releaseGithubCacheWarmLock: vi.fn(),
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

const inngestModule = vi.hoisted(() => ({
	inngest: {
		send: vi.fn(),
	},
	sendInngestEvent: vi.fn(),
}));

vi.mock("next/headers", () => nextHeaders);
vi.mock("@/lib/auth", () => authModule);
vi.mock("@/lib/github-auth-context", () => githubAuthContext);
vi.mock("@/lib/github-cache-lock", () => githubCacheLock);
vi.mock("@/lib/github-cache-warmer", () => githubCacheWarmer);
vi.mock("@/lib/inngest", () => inngestModule);

function warmRequest(body: unknown): Request {
	return new Request("http://localhost/api/github-cache/warm", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("github cache warm API route", () => {
	beforeEach(() => {
		nextHeaders.headers.mockReset();
		authModule.auth.api.getSession.mockReset();
		githubAuthContext.resolveGitHubAuthContextForUser.mockReset();
		for (const helper of Object.values(githubCacheLock)) helper.mockReset();
		for (const helper of Object.values(githubCacheWarmer)) helper.mockReset();
		inngestModule.inngest.send.mockReset();
		inngestModule.sendInngestEvent.mockReset();
		inngestModule.sendInngestEvent.mockResolvedValue({ skipped: false });
		nextHeaders.headers.mockResolvedValue(new Headers());
		authModule.auth.api.getSession.mockResolvedValue({
			user: { id: "user-1", role: "admin" },
		});
		githubCacheLock.acquireGithubCacheWarmLock.mockResolvedValue({
			acquired: true,
			lockKey: "github-cache-warm-lock:user-1",
		});
		githubCacheLock.releaseGithubCacheWarmLock.mockResolvedValue(true);
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("GITHUB_CACHE_WARM_INLINE", "0");
		vi.stubEnv("GITHUB_CACHE_WARM_PROD_ENABLED", "1");
		vi.stubEnv("GITHUB_CACHE_WARM_CONCURRENCY", "4");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("explicitly releases the API-owned lock when Inngest enqueue fails", async () => {
		emitRandomUuid("run-1");
		inngestModule.sendInngestEvent.mockResolvedValue({
			skipped: true,
			reason: "send-failed",
		});

		const { POST } = await import("./route");
		const response = await POST(warmRequest({ mode: "quick", maxRepos: 5 }));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			accepted: false,
			runId: "run-1",
			skippedReason: "send-failed",
		});
		expect(inngestModule.sendInngestEvent).toHaveBeenCalledWith({
			name: "github/cache.warm",
			data: {
				userId: "user-1",
				runId: "run-1",
				lockKey: "github-cache-warm-lock:user-1",
				options: { mode: "quick", maxRepos: 5, maxConcurrentRepos: 4 },
			},
		});
		expect(githubCacheLock.releaseGithubCacheWarmLock).toHaveBeenCalledWith(
			"user-1",
			"run-1",
		);
	});

	it("rejects authenticated users who are not allowed to use the debug surface", async () => {
		authModule.auth.api.getSession.mockResolvedValue({
			user: { id: "user-2", role: "user" },
		});

		const { POST } = await import("./route");
		const response = await POST(warmRequest({ mode: "quick", maxRepos: 5 }));

		expect(response.status).toBe(403);
		expect(githubCacheLock.acquireGithubCacheWarmLock).not.toHaveBeenCalled();
		expect(inngestModule.sendInngestEvent).not.toHaveBeenCalled();
	});

	it("returns actionable disabled guidance when no warm path is enabled", async () => {
		emitRandomUuid("run-disabled");
		vi.stubEnv("GITHUB_CACHE_WARM_INLINE", "0");
		vi.stubEnv("GITHUB_CACHE_WARM_PROD_ENABLED", "0");

		const { POST } = await import("./route");
		const response = await POST(warmRequest({ mode: "full", maxRepos: 5 }));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			accepted: false,
			runId: "run-disabled",
			skippedReason: "disabled",
			message: "GitHub cache warming is disabled by configuration.",
			blockedBy: ["GITHUB_CACHE_WARM_PROD_ENABLED"],
		});
		expect(body.remediation).toContain("GITHUB_CACHE_WARM_PROD_ENABLED=1");
		expect(githubCacheLock.releaseGithubCacheWarmLock).toHaveBeenCalledWith(
			"user-1",
			"run-disabled",
		);
	});

	it("does not run inline just because NODE_ENV is not production", async () => {
		emitRandomUuid("run-2");
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("GITHUB_CACHE_WARM_INLINE", "0");

		const { POST } = await import("./route");
		const response = await POST(warmRequest({ mode: "quick", maxRepos: 5 }));

		expect(response.status).toBe(200);
		expect(githubAuthContext.resolveGitHubAuthContextForUser).not.toHaveBeenCalled();
		expect(githubCacheWarmer.warmPersonalGithubCache).not.toHaveBeenCalled();
		expect(inngestModule.sendInngestEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "github/cache.warm",
				data: expect.objectContaining({ runId: "run-2" }),
			}),
		);
	});

	it("uses the background auth resolver for explicit inline warm", async () => {
		emitRandomUuid("run-3");
		vi.stubEnv("GITHUB_CACHE_WARM_INLINE", "1");
		const authCtx = { userId: "user-1", token: "token" };
		githubAuthContext.resolveGitHubAuthContextForUser.mockResolvedValue(authCtx);
		githubCacheWarmer.warmPersonalGithubCache.mockResolvedValue({
			userId: "user-1",
			runId: "run-3",
			source: "api-inline",
			discoveredRepos: 0,
			selectedRepos: 0,
			warmedRepos: 0,
			skippedRepos: 0,
			failedRepos: 0,
			jobsQueued: 0,
			durationMs: 1,
			errors: [],
		});

		const { POST } = await import("./route");
		const response = await POST(warmRequest({ mode: "quick", maxRepos: 5 }));

		expect(response.status).toBe(200);
		expect(githubAuthContext.resolveGitHubAuthContextForUser).toHaveBeenCalledWith(
			"user-1",
		);
		expect(githubCacheWarmer.warmPersonalGithubCache).toHaveBeenCalledWith(
			expect.objectContaining({ authCtx }),
		);
		expect(githubCacheLock.releaseGithubCacheWarmLock).toHaveBeenCalledWith(
			"user-1",
			"run-3",
		);
	});
});

function emitRandomUuid(runId: string) {
	vi.spyOn(crypto, "randomUUID").mockReturnValue(runId as never);
}
