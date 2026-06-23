import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
	eval: vi.fn(),
	get: vi.fn(),
	set: vi.fn(),
}));

vi.mock("./redis", () => ({ redis }));

describe("github-cache-lock", () => {
	beforeEach(() => {
		redis.eval.mockReset();
		redis.get.mockReset();
		redis.set.mockReset();
	});

	it("acquires a user warm lock with the run id as the lock owner", async () => {
		redis.set.mockResolvedValue("OK");
		const { acquireGithubCacheWarmLock } = await import("./github-cache-lock");

		await expect(acquireGithubCacheWarmLock("user-1", "run-1", 99)).resolves.toEqual({
			acquired: true,
			lockKey: "github-cache-warm-lock:user-1",
		});
		expect(redis.set).toHaveBeenCalledWith("github-cache-warm-lock:user-1", "run-1", {
			ex: 99,
			nx: true,
		});
	});

	it("releases locks with a compare-and-delete script", async () => {
		redis.eval.mockResolvedValue(1);
		const { releaseGithubCacheWarmLock } = await import("./github-cache-lock");

		await expect(releaseGithubCacheWarmLock("user-1", "run-1")).resolves.toBe(true);
		expect(redis.eval).toHaveBeenCalledWith(
			expect.stringContaining('redis.call("GET", KEYS[1]) == ARGV[1]'),
			["github-cache-warm-lock:user-1"],
			["run-1"],
		);
	});

	it("does not extend a lock owned by another run", async () => {
		redis.get.mockResolvedValue("run-2");
		const { renewGithubCacheWarmLock } = await import("./github-cache-lock");

		await expect(renewGithubCacheWarmLock("user-1", "run-1", 99)).resolves.toBe(false);
		expect(redis.set).not.toHaveBeenCalled();
	});

	it("reports sanitized lock status for the debug UI", async () => {
		redis.get.mockResolvedValue("run-1");
		const { getGithubCacheWarmLockStatus } = await import("./github-cache-lock");

		await expect(getGithubCacheWarmLockStatus("user-1")).resolves.toEqual({
			locked: true,
			lockKey: "github-cache-warm-lock:user-1",
			runId: "run-1",
		});
		expect(redis.get).toHaveBeenCalledWith("github-cache-warm-lock:user-1");
	});
});
