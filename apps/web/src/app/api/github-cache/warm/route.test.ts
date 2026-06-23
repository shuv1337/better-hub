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
	getRequestGitHubAuthContext: vi.fn(),
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
		githubAuthContext.getRequestGitHubAuthContext.mockReset();
		for (const helper of Object.values(githubCacheLock)) helper.mockReset();
		for (const helper of Object.values(githubCacheWarmer)) helper.mockReset();
		inngestModule.inngest.send.mockReset();
		nextHeaders.headers.mockResolvedValue(new Headers());
		authModule.auth.api.getSession.mockResolvedValue({ user: { id: "user-1" } });
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
		ingestSendFailure(new Error("network down"));

		const { POST } = await import("./route");
		const response = await POST(warmRequest({ mode: "quick", maxRepos: 5 }));

		expect(response.status).toBe(500);
		expect(inngestModule.inngest.send).toHaveBeenCalledWith({
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
});

function emitRandomUuid(runId: string) {
	vi.spyOn(crypto, "randomUUID").mockReturnValue(runId as never);
}

function ingestSendFailure(error: Error) {
	inngestModule.inngest.send.mockRejectedValue(error);
}
