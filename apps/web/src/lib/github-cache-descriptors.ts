export type GithubCacheDataClass =
	| "repo-chrome"
	| "repo-inventory"
	| "hot-list"
	| "ci"
	| "activity"
	| "code-tree"
	| "readme"
	| "stats"
	| "identity";

export type GithubCacheScope = "user" | "owner-repo" | "org" | "shared-public" | "viewer";

export interface GithubCacheDescriptor {
	cacheType: string;
	dataClass: GithubCacheDataClass;
	scope: GithubCacheScope;
	shareable: boolean;
}

export const GITHUB_CACHE_DESCRIPTORS = {
	user_repos: {
		cacheType: "user_repos",
		dataClass: "repo-inventory",
		scope: "user",
		shareable: false,
	},
	user_orgs: {
		cacheType: "user_orgs",
		dataClass: "repo-inventory",
		scope: "user",
		shareable: false,
	},
	org_repos: {
		cacheType: "org_repos",
		dataClass: "repo-inventory",
		scope: "org",
		shareable: false,
	},
	repo: {
		cacheType: "repo",
		dataClass: "repo-chrome",
		scope: "owner-repo",
		shareable: false,
	},
	repo_tree: {
		cacheType: "repo_tree",
		dataClass: "code-tree",
		scope: "owner-repo",
		shareable: false,
	},
	repo_readme: {
		cacheType: "repo_readme",
		dataClass: "readme",
		scope: "owner-repo",
		shareable: false,
	},
	repo_issues: {
		cacheType: "repo_issues",
		dataClass: "hot-list",
		scope: "owner-repo",
		shareable: false,
	},
	repo_pull_requests: {
		cacheType: "repo_pull_requests",
		dataClass: "hot-list",
		scope: "owner-repo",
		shareable: false,
	},
	repo_events: {
		cacheType: "repo_events",
		dataClass: "activity",
		scope: "owner-repo",
		shareable: false,
	},
	repo_workflow_runs: {
		cacheType: "repo_workflow_runs",
		dataClass: "ci",
		scope: "owner-repo",
		shareable: false,
	},
	repo_branches: {
		cacheType: "repo_branches",
		dataClass: "code-tree",
		scope: "owner-repo",
		shareable: false,
	},
	repo_tags: {
		cacheType: "repo_tags",
		dataClass: "code-tree",
		scope: "owner-repo",
		shareable: false,
	},
	repo_releases: {
		cacheType: "repo_releases",
		dataClass: "repo-chrome",
		scope: "owner-repo",
		shareable: false,
	},
	repo_contributors: {
		cacheType: "repo_contributors",
		dataClass: "stats",
		scope: "owner-repo",
		shareable: false,
	},
	repo_discussions: {
		cacheType: "repo_discussions",
		dataClass: "hot-list",
		scope: "owner-repo",
		shareable: false,
	},
	repo_nav_counts: {
		cacheType: "repo_nav_counts",
		dataClass: "repo-chrome",
		scope: "owner-repo",
		shareable: false,
	},
	repo_languages: {
		cacheType: "repo_languages",
		dataClass: "stats",
		scope: "owner-repo",
		shareable: false,
	},
	repo_workflows: {
		cacheType: "repo_workflows",
		dataClass: "ci",
		scope: "owner-repo",
		shareable: false,
	},
	repo_contents: {
		cacheType: "repo_contents",
		dataClass: "code-tree",
		scope: "owner-repo",
		shareable: false,
	},
	file_content: {
		cacheType: "file_content",
		dataClass: "code-tree",
		scope: "owner-repo",
		shareable: false,
	},
	user_profile: {
		cacheType: "user_profile",
		dataClass: "identity",
		scope: "shared-public",
		shareable: true,
	},
	user_public_orgs: {
		cacheType: "user_public_orgs",
		dataClass: "identity",
		scope: "shared-public",
		shareable: true,
	},
	user_events: {
		cacheType: "user_events",
		dataClass: "activity",
		scope: "shared-public",
		shareable: true,
	},
	trending_repos: {
		cacheType: "trending_repos",
		dataClass: "repo-inventory",
		scope: "shared-public",
		shareable: true,
	},
	user_public_repos: {
		cacheType: "user_public_repos",
		dataClass: "repo-inventory",
		scope: "viewer",
		shareable: false,
	},
	authenticated_user: {
		cacheType: "authenticated_user",
		dataClass: "identity",
		scope: "viewer",
		shareable: false,
	},
	org: {
		cacheType: "org",
		dataClass: "identity",
		scope: "org",
		shareable: false,
	},
	org_members: {
		cacheType: "org_members",
		dataClass: "identity",
		scope: "org",
		shareable: false,
	},
	notifications: {
		cacheType: "notifications",
		dataClass: "activity",
		scope: "viewer",
		shareable: false,
	},
	search_issues: {
		cacheType: "search_issues",
		dataClass: "hot-list",
		scope: "viewer",
		shareable: false,
	},
	starred_repos: {
		cacheType: "starred_repos",
		dataClass: "repo-inventory",
		scope: "viewer",
		shareable: false,
	},
	contributions: {
		cacheType: "contributions",
		dataClass: "activity",
		scope: "viewer",
		shareable: false,
	},
	person_repo_activity: {
		cacheType: "person_repo_activity",
		dataClass: "activity",
		scope: "owner-repo",
		shareable: false,
	},
	pr_bundle: {
		cacheType: "pr_bundle",
		dataClass: "hot-list",
		scope: "owner-repo",
		shareable: false,
	},
	repo_page_data: {
		cacheType: "repo_page_data",
		dataClass: "repo-chrome",
		scope: "user",
		shareable: false,
	},
	repo_file_tree: {
		cacheType: "repo_file_tree",
		dataClass: "code-tree",
		scope: "owner-repo",
		shareable: false,
	},
	readme_html: {
		cacheType: "readme_html",
		dataClass: "readme",
		scope: "owner-repo",
		shareable: false,
	},
	overview_prs: {
		cacheType: "overview_prs",
		dataClass: "hot-list",
		scope: "owner-repo",
		shareable: false,
	},
	overview_issues: {
		cacheType: "overview_issues",
		dataClass: "hot-list",
		scope: "owner-repo",
		shareable: false,
	},
	overview_events: {
		cacheType: "overview_events",
		dataClass: "activity",
		scope: "owner-repo",
		shareable: false,
	},
	overview_commit_activity: {
		cacheType: "overview_commit_activity",
		dataClass: "stats",
		scope: "owner-repo",
		shareable: false,
	},
	overview_ci: {
		cacheType: "overview_ci",
		dataClass: "ci",
		scope: "owner-repo",
		shareable: false,
	},
} as const satisfies Record<string, GithubCacheDescriptor>;

export type GithubCacheType = keyof typeof GITHUB_CACHE_DESCRIPTORS;

export function getGithubCacheDescriptor(cacheType: string): GithubCacheDescriptor | undefined {
	return GITHUB_CACHE_DESCRIPTORS[cacheType as GithubCacheType];
}

export function normalizeGithubCacheRef(ref?: string): string {
	const value = ref?.trim();
	return value ? value : "";
}

export function normalizeGithubCachePath(path: string): string {
	return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function normalizeGithubRepoKey(owner: string, repo: string): string {
	return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

export function githubCacheKeyPart(value: string): string {
	return encodeURIComponent(value === "" ? "~" : value);
}

function repoKey(owner: string, repo: string, suffix: string): string {
	return `${suffix}:${normalizeGithubRepoKey(owner, repo)}`;
}

function userRepoKey(userId: string, owner: string, repo: string, suffix: string): string {
	return `${suffix}:${userId}:${normalizeGithubRepoKey(owner, repo)}`;
}

export const githubCacheKeys = {
	userRepos(sort: string, perPage: number): string {
		return `user_repos:${sort}:${perPage}`;
	},
	repo(owner: string, repo: string): string {
		return repoKey(owner, repo, "repo");
	},
	repoContents(owner: string, repo: string, path: string, ref?: string): string {
		return `repo_contents:${normalizeGithubRepoKey(owner, repo)}:${githubCacheKeyPart(
			normalizeGithubCacheRef(ref),
		)}:${githubCacheKeyPart(normalizeGithubCachePath(path))}`;
	},
	repoTree(owner: string, repo: string, treeSha: string, recursive: boolean): string {
		return `repo_tree:${normalizeGithubRepoKey(owner, repo)}:${githubCacheKeyPart(
			treeSha,
		)}:${recursive ? "1" : "0"}`;
	},
	repoBranches(owner: string, repo: string): string {
		return repoKey(owner, repo, "repo_branches");
	},
	repoTags(owner: string, repo: string): string {
		return repoKey(owner, repo, "repo_tags");
	},
	repoReleases(owner: string, repo: string): string {
		return repoKey(owner, repo, "repo_releases");
	},
	fileContent(owner: string, repo: string, path: string, ref?: string): string {
		return `file_content:${normalizeGithubRepoKey(owner, repo)}:${githubCacheKeyPart(
			normalizeGithubCacheRef(ref),
		)}:${githubCacheKeyPart(normalizeGithubCachePath(path))}`;
	},
	repoReadme(owner: string, repo: string, ref?: string): string {
		return `repo_readme:${normalizeGithubRepoKey(owner, repo)}:${githubCacheKeyPart(
			normalizeGithubCacheRef(ref),
		)}`;
	},
	authenticatedUser(): string {
		return "authenticated_user";
	},
	userOrgs(perPage: number): string {
		return `user_orgs:${perPage}`;
	},
	org(org: string): string {
		return `org:${org.toLowerCase()}`;
	},
	orgRepos(org: string, sort: string, type: string, perPage: number): string {
		return `org_repos:${org.toLowerCase()}:${sort}:${type}:${perPage}`;
	},
	notifications(perPage: number): string {
		return `notifications:${perPage}`;
	},
	searchIssues(query: string, perPage: number): string {
		return `search_issues:${githubCacheKeyPart(query)}:${perPage}`;
	},
	userEvents(username: string, perPage: number): string {
		return `user_events:${username.toLowerCase()}:${perPage}`;
	},
	starredRepos(perPage: number): string {
		return `starred_repos:${perPage}`;
	},
	contributions(username: string): string {
		return `contributions:v3:${username.toLowerCase()}`;
	},
	trendingRepos(since: string, perPage: number, language?: string): string {
		return `trending_repos:${since}:${perPage}:${githubCacheKeyPart(language ?? "")}`;
	},
	repoIssues(owner: string, repo: string, state: string): string {
		return `repo_issues:${normalizeGithubRepoKey(owner, repo)}:${state}`;
	},
	repoPullRequests(owner: string, repo: string, state: string): string {
		return `repo_pull_requests:${normalizeGithubRepoKey(owner, repo)}:${state}`;
	},
	issue(owner: string, repo: string, issueNumber: number): string {
		return `issue:${normalizeGithubRepoKey(owner, repo)}:${issueNumber}`;
	},
	issueComments(owner: string, repo: string, issueNumber: number): string {
		return `issue_comments:${normalizeGithubRepoKey(owner, repo)}:${issueNumber}`;
	},
	pullRequest(owner: string, repo: string, pullNumber: number): string {
		return `pull_request:${normalizeGithubRepoKey(owner, repo)}:${pullNumber}`;
	},
	pullRequestFiles(owner: string, repo: string, pullNumber: number): string {
		return `pull_request_files:${normalizeGithubRepoKey(owner, repo)}:${pullNumber}`;
	},
	pullRequestComments(owner: string, repo: string, pullNumber: number): string {
		return `pull_request_comments:${normalizeGithubRepoKey(owner, repo)}:${pullNumber}`;
	},
	pullRequestReviews(owner: string, repo: string, pullNumber: number): string {
		return `pull_request_reviews:${normalizeGithubRepoKey(owner, repo)}:${pullNumber}`;
	},
	pullRequestCommits(owner: string, repo: string, pullNumber: number): string {
		return `pull_request_commits:${normalizeGithubRepoKey(owner, repo)}:${pullNumber}`;
	},
	repoContributors(owner: string, repo: string, perPage: number): string {
		return `repo_contributors:${normalizeGithubRepoKey(owner, repo)}:${perPage}`;
	},
	userProfile(username: string): string {
		return `user_profile:${username.toLowerCase()}`;
	},
	userPublicRepos(username: string, perPage: number): string {
		return `user_public_repos:${username.toLowerCase()}:${perPage}`;
	},
	userPublicOrgs(username: string): string {
		return `user_public_orgs:${username.toLowerCase()}`;
	},
	repoWorkflows(owner: string, repo: string): string {
		return repoKey(owner, repo, "repo_workflows");
	},
	repoWorkflowRuns(owner: string, repo: string, perPage: number): string {
		return `repo_workflow_runs:${normalizeGithubRepoKey(owner, repo)}:${perPage}`;
	},
	repoNavCounts(owner: string, repo: string): string {
		return repoKey(owner, repo, "repo_nav_counts");
	},
	repoLanguages(owner: string, repo: string): string {
		return repoKey(owner, repo, "repo_languages");
	},
	orgMembers(org: string, perPage: number): string {
		return `org_members:${org.toLowerCase()}:${perPage}`;
	},
	personRepoActivity(owner: string, repo: string, username: string): string {
		return `person_repo_activity:${normalizeGithubRepoKey(
			owner,
			repo,
		)}:${username.toLowerCase()}`;
	},
	prBundle(owner: string, repo: string, pullNumber: number): string {
		return `pr_bundle:${normalizeGithubRepoKey(owner, repo)}:${pullNumber}`;
	},
	repoDiscussions(owner: string, repo: string): string {
		return `repo_discussions:v2:${normalizeGithubRepoKey(owner, repo)}`;
	},
	repoIssuesPage(owner: string, repo: string): string {
		return repoKey(owner, repo, "repo_issues_page");
	},
	repoEvents(owner: string, repo: string, perPage: number): string {
		return `repo_events:${normalizeGithubRepoKey(owner, repo)}:${perPage}`;
	},
	defaultBranch(owner: string, repo: string): string {
		return repoKey(owner, repo, "repo_default_branch");
	},
	repoPageData(userId: string, owner: string, repo: string): string {
		return userRepoKey(userId, owner, repo, "repo_page_data");
	},
	repoFileTree(owner: string, repo: string): string {
		return repoKey(owner, repo, "repo_file_tree");
	},
	readmeHtml(owner: string, repo: string): string {
		return repoKey(owner, repo, "readme_html");
	},
	overviewPRs(owner: string, repo: string): string {
		return repoKey(owner, repo, "overview_prs");
	},
	overviewIssues(owner: string, repo: string): string {
		return repoKey(owner, repo, "overview_issues");
	},
	overviewEvents(owner: string, repo: string): string {
		return repoKey(owner, repo, "overview_events");
	},
	overviewCommitActivity(owner: string, repo: string): string {
		return repoKey(owner, repo, "overview_commit_activity");
	},
	overviewCI(owner: string, repo: string): string {
		return repoKey(owner, repo, "overview_ci");
	},
};
