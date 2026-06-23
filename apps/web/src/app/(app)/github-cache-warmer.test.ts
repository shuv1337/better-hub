import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GITHUB_CACHE_WARM_THROTTLE_MS,
	isGithubCacheBrowserWarmEnabled,
	shouldStartGithubCacheWarm,
} from "./github-cache-warmer";

describe("GithubCacheWarmer helpers", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("is disabled unless the public warm flag is explicitly enabled", () => {
		vi.stubEnv("NEXT_PUBLIC_GITHUB_CACHE_WARM_ENABLED", "0");
		expect(isGithubCacheBrowserWarmEnabled()).toBe(false);

		vi.stubEnv("NEXT_PUBLIC_GITHUB_CACHE_WARM_ENABLED", "1");
		expect(isGithubCacheBrowserWarmEnabled()).toBe(true);
	});

	it("starts only when the last browser warm is outside the throttle window", () => {
		const now = Date.parse("2026-06-23T12:00:00.000Z");

		expect(shouldStartGithubCacheWarm(null, now)).toBe(true);
		expect(shouldStartGithubCacheWarm("not-a-number", now)).toBe(true);
		expect(shouldStartGithubCacheWarm(String(now - 1_000), now)).toBe(false);
		expect(
			shouldStartGithubCacheWarm(
				String(now - GITHUB_CACHE_WARM_THROTTLE_MS),
				now,
			),
		).toBe(true);
	});
});
