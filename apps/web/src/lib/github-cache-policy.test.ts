import { describe, expect, it, vi } from "vitest";
import {
	getGithubCachePolicy,
	isFresh,
	isShareableCacheType,
	isUnsafeSharedCacheType,
	shouldRefresh,
} from "./github-cache-policy";

describe("github cache shared policy", () => {
	it("allows only public cache types to be shared", () => {
		expect(isShareableCacheType("user_profile")).toBe(true);
		expect(isShareableCacheType("user_public_orgs")).toBe(true);
		expect(isShareableCacheType("user_events")).toBe(true);
		expect(isShareableCacheType("trending_repos")).toBe(true);
	});

	it("does not deny public org metadata by substring", () => {
		expect(isUnsafeSharedCacheType("user_public_orgs")).toBe(false);
		expect(isShareableCacheType("user_public_orgs")).toBe(true);
	});

	it("rejects formerly shared repo, issue, pull-request, org, and viewer-scoped types", () => {
		const unsafeTypes = [
			"repo",
			"repo_branches",
			"repo_tags",
			"repo_releases",
			"repo_issues",
			"repo_pull_requests",
			"repo_contributors",
			"repo_workflows",
			"repo_workflow_runs",
			"repo_nav_counts",
			"repo_contents",
			"repo_tree",
			"repo_readme",
			"repo_discussions",
			"issue",
			"issue_comments",
			"pull_request",
			"pull_request_files",
			"pull_request_comments",
			"pull_request_reviews",
			"pull_request_commits",
			"org",
			"org_repos",
			"org_members",
			"file_content",
			"notifications",
			"search_issues",
			"authenticated_user",
			"starred_repos",
			"contributions",
			"person_repo_activity",
			"pr_bundle",
			"user_repos",
			"user_orgs",
			"user_public_repos",
		];

		for (const cacheType of unsafeTypes) {
			expect(isShareableCacheType(cacheType), cacheType).toBe(false);
		}
	});

	it("keeps the explicit unsafe guard in front of future allowlist mistakes", () => {
		expect(isUnsafeSharedCacheType("repo_anything_new")).toBe(true);
		expect(isUnsafeSharedCacheType("issue_activity")).toBe(true);
		expect(isUnsafeSharedCacheType("pull_request_timeline")).toBe(true);
	});

	it("returns V1 freshness policy defaults", () => {
		expect(getGithubCachePolicy("ci")).toEqual({
			freshForMs: 30 * 1000,
			refreshAfterMs: 60 * 1000,
			expireAfterMs: null,
		});
		expect(getGithubCachePolicy("repo-inventory")).toEqual({
			freshForMs: 5 * 60 * 1000,
			refreshAfterMs: 15 * 60 * 1000,
			expireAfterMs: null,
		});
		expect(getGithubCachePolicy("stats")).toEqual({
			freshForMs: 6 * 60 * 60 * 1000,
			refreshAfterMs: 24 * 60 * 60 * 1000,
			expireAfterMs: null,
		});
	});

	it("classifies fresh and refreshable entries by data class", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-23T18:00:00.000Z"));
		try {
			expect(isFresh("2026-06-23T17:59:40.000Z", "ci")).toBe(true);
			expect(isFresh("2026-06-23T17:59:20.000Z", "ci")).toBe(false);
			expect(shouldRefresh("2026-06-23T17:59:20.000Z", "ci")).toBe(false);
			expect(shouldRefresh("2026-06-23T17:58:59.000Z", "ci")).toBe(true);
			expect(isFresh(null, "ci")).toBe(false);
			expect(shouldRefresh(null, "ci")).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});
