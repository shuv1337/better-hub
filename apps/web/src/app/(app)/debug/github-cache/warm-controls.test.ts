import { describe, expect, it } from "vitest";
import { formatWarmResponseMessage } from "./warm-controls";

describe("formatWarmResponseMessage", () => {
	it("includes disabled warm remediation details", () => {
		expect(
			formatWarmResponseMessage("quick", {
				accepted: false,
				runId: "run-1",
				skippedReason: "disabled",
				message: "GitHub cache warming is disabled by configuration.",
				blockedBy: [
					"GITHUB_CACHE_WARM_INLINE",
					"GITHUB_CACHE_WARM_PROD_ENABLED",
				],
				remediation:
					"Set GITHUB_CACHE_WARM_INLINE=1 for local inline warming.",
			}),
		).toBe(
			"quick warm skipped: disabled GitHub cache warming is disabled by configuration. Blocked by: GITHUB_CACHE_WARM_INLINE, GITHUB_CACHE_WARM_PROD_ENABLED Set GITHUB_CACHE_WARM_INLINE=1 for local inline warming.",
		);
	});
});
