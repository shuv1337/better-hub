import { describe, expect, it } from "vitest";
import { isShareableCacheType, isUnsafeSharedCacheType } from "./github-cache-policy";

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
});
