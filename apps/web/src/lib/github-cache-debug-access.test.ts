import { afterEach, describe, expect, it, vi } from "vitest";
import { getGithubCacheDebugAccess } from "./github-cache-debug-access";

describe("getGithubCacheDebugAccess", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("allows admins", () => {
		expect(
			getGithubCacheDebugAccess({ user: { id: "user-1", role: "admin" } }),
		).toEqual({ allowed: true, reason: "admin" });
	});

	it("allows configured user ids", () => {
		vi.stubEnv("GITHUB_CACHE_DEBUG_USER_IDS", "user-2,user-3");

		expect(getGithubCacheDebugAccess({ user: { id: "user-2", role: "user" } })).toEqual(
			{ allowed: true, reason: "allowlisted-user" },
		);
	});

	it("allows the explicit dev debug flag outside production", () => {
		vi.stubEnv("NODE_ENV", "development");
		vi.stubEnv("DEBUG_GITHUB_CACHE_ENABLED", "1");

		expect(getGithubCacheDebugAccess({ user: { id: "user-4", role: "user" } })).toEqual(
			{ allowed: true, reason: "dev-debug-enabled" },
		);
	});

	it("does not allow the dev debug flag in production", () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("DEBUG_GITHUB_CACHE_ENABLED", "1");

		expect(getGithubCacheDebugAccess({ user: { id: "user-4", role: "user" } })).toEqual(
			{ allowed: false, reason: "not-authorized" },
		);
	});
});
