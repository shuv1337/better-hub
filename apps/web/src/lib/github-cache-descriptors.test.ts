import { describe, expect, it } from "vitest";
import {
	GITHUB_CACHE_DESCRIPTORS,
	getGithubCacheDescriptor,
	githubCacheKeys,
} from "./github-cache-descriptors";

describe("github cache descriptors", () => {
	it("contains descriptors for V1 GitHub response, UI fragment, and public cache families", () => {
		const expectedTypes = [
			"user_repos",
			"user_orgs",
			"org_repos",
			"repo",
			"repo_tree",
			"repo_readme",
			"repo_issues",
			"repo_pull_requests",
			"repo_events",
			"repo_workflow_runs",
			"repo_branches",
			"repo_tags",
			"repo_releases",
			"repo_contributors",
			"repo_discussions",
			"repo_nav_counts",
			"repo_languages",
			"repo_page_data",
			"repo_file_tree",
			"readme_html",
			"overview_prs",
			"overview_issues",
			"overview_events",
			"overview_commit_activity",
			"overview_ci",
			"user_profile",
			"user_public_orgs",
			"user_events",
			"trending_repos",
		];

		for (const cacheType of expectedTypes) {
			expect(getGithubCacheDescriptor(cacheType), cacheType).toBeDefined();
		}
		expect(GITHUB_CACHE_DESCRIPTORS.user_public_orgs.shareable).toBe(true);
		expect(GITHUB_CACHE_DESCRIPTORS.repo_issues.shareable).toBe(false);
	});

	it("builds stable GitHub response cache keys", () => {
		expect(githubCacheKeys.userRepos("updated", 30)).toBe("user_repos:updated:30");
		expect(githubCacheKeys.repo("Owner", "Repo")).toBe("repo:owner/repo");
		expect(
			githubCacheKeys.repoContents("Owner", "Repo", "/src/app.ts/", " main "),
		).toBe("repo_contents:owner/repo:main:src%2Fapp.ts");
		expect(githubCacheKeys.repoContents("Owner", "Repo", "", undefined)).toBe(
			"repo_contents:owner/repo:~:~",
		);
		expect(githubCacheKeys.repoTree("Owner", "Repo", "abc123", true)).toBe(
			"repo_tree:owner/repo:abc123:1",
		);
		expect(githubCacheKeys.repoReadme("Owner", "Repo", "")).toBe(
			"repo_readme:owner/repo:~",
		);
		expect(githubCacheKeys.orgRepos("Org", "pushed", "private", 100)).toBe(
			"org_repos:org:pushed:private:100",
		);
		expect(githubCacheKeys.searchIssues("is:pr is:open repo:Owner/Repo", 20)).toBe(
			"search_issues:is%3Apr%20is%3Aopen%20repo%3AOwner%2FRepo:20",
		);
		expect(githubCacheKeys.trendingRepos("weekly", 10)).toBe(
			"trending_repos:weekly:10:~",
		);
		expect(githubCacheKeys.repoDiscussions("Owner", "Repo")).toBe(
			"repo_discussions:v2:owner/repo",
		);
	});

	it("builds stable UI fragment cache keys", () => {
		expect(githubCacheKeys.repoPageData("user-1", "Owner", "Repo")).toBe(
			"repo_page_data:user-1:owner/repo",
		);
		expect(githubCacheKeys.repoFileTree("Owner", "Repo")).toBe(
			"repo_file_tree:owner/repo",
		);
		expect(githubCacheKeys.readmeHtml("Owner", "Repo")).toBe("readme_html:owner/repo");
		expect(githubCacheKeys.overviewPRs("Owner", "Repo")).toBe(
			"overview_prs:owner/repo",
		);
		expect(githubCacheKeys.overviewIssues("Owner", "Repo")).toBe(
			"overview_issues:owner/repo",
		);
		expect(githubCacheKeys.overviewEvents("Owner", "Repo")).toBe(
			"overview_events:owner/repo",
		);
		expect(githubCacheKeys.overviewCommitActivity("Owner", "Repo")).toBe(
			"overview_commit_activity:owner/repo",
		);
		expect(githubCacheKeys.overviewCI("Owner", "Repo")).toBe("overview_ci:owner/repo");
	});
});
