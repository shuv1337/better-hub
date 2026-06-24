import { renderMarkdownToHtml } from "@/components/shared/markdown-renderer";
import { buildFileTree, type FileTreeNode } from "./file-tree";
import {
	fetchCheckStatusForRef,
	getCommitActivity,
	getOctokit,
	getRepoBranches,
	getRepoContributors,
	getRepoEvents,
	getRepoIssues,
	getRepoPullRequests,
	getRepoReadme,
	getRepoTags,
	getRepoTree,
	type CheckStatus,
	type CommitActivityWeek,
	type RepoPageData,
} from "./github";
import type { GitHubAuthContext } from "./github-auth-context";
import { redis } from "./redis";
import { deleteCachedReadmeHtml, getCachedReadmeHtml, setCachedReadmeHtml } from "./readme-cache";
import {
	setCachedBranches,
	setCachedContributorAvatars,
	setCachedOverviewCI,
	setCachedOverviewCommitActivity,
	setCachedOverviewEvents,
	setCachedOverviewIssues,
	setCachedOverviewPRs,
	setCachedRepoLanguages,
	setCachedRepoTree,
	setCachedTags,
	type BranchRef,
	type ContributorAvatarsData,
} from "./repo-data-cache";

const README_REFRESH_LOCK_TTL_SECONDS = 5 * 60;

export interface OverviewPRItem {
	number: number;
	title: string;
	user: { login: string; avatar_url: string } | null;
	created_at: string;
	comments: number;
	draft?: boolean;
}

export interface OverviewIssueItem {
	number: number;
	title: string;
	user: { login: string; avatar_url: string } | null;
	created_at: string;
	comments: number;
	reactions?: { total_count: number };
	labels?: Array<{ name?: string; color?: string }>;
}

export interface OverviewRepoEvent {
	type: string;
	actor: { login: string; avatar_url: string } | null;
	created_at: string;
	repo?: { name: string };
	payload?: {
		action?: string;
		ref?: string;
		ref_type?: string;
		size?: number;
		commits?: { sha: string; message: string }[];
		pull_request?: { number: number; title: string };
		issue?: { number: number; title: string };
		comment?: { body: string };
		forkee?: { full_name: string };
		release?: { tag_name: string; name: string };
	};
}

export interface RepoReadmeHtmlCacheFirstOptions {
	forceRefresh?: boolean;
	refreshInBackground?: boolean;
}

function authOverride(authCtx?: GitHubAuthContext | null) {
	return authCtx ? { authCtx } : undefined;
}

function readmeRefreshLockKey(owner: string, repo: string): string {
	return `readme-html-refresh-lock:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

class RepoReadmeNotFoundError extends Error {
	constructor() {
		super("Repository README was not found");
		this.name = "RepoReadmeNotFoundError";
	}
}

function isNotFoundError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { status?: unknown }).status === 404
	);
}

async function tryAcquireReadmeRefreshLock(owner: string, repo: string): Promise<boolean> {
	const result = await redis.set(readmeRefreshLockKey(owner, repo), "1", {
		ex: README_REFRESH_LOCK_TTL_SECONDS,
		nx: true,
	});
	return result === "OK";
}

async function fetchReadmeMarkdownFromGitHub(
	owner: string,
	repo: string,
	branch: string,
	authCtx?: GitHubAuthContext | null,
): Promise<string | null> {
	const octokit = authCtx?.octokit ?? (await getOctokit());
	if (!octokit) return null;
	try {
		const { data } = await octokit.repos.getReadme({ owner, repo, ref: branch });
		return Buffer.from(data.content, "base64").toString("utf-8");
	} catch (error) {
		if (isNotFoundError(error)) throw new RepoReadmeNotFoundError();
		return null;
	}
}

async function refreshReadmeHtml(
	owner: string,
	repo: string,
	branch: string,
	authCtx?: GitHubAuthContext | null,
	forceFreshFromGitHub = false,
): Promise<string | null> {
	let markdown: string | null = null;
	try {
		markdown = forceFreshFromGitHub
			? await fetchReadmeMarkdownFromGitHub(owner, repo, branch, authCtx)
			: ((await getRepoReadme(owner, repo, branch, authOverride(authCtx)))
					?.content ?? null);
	} catch (error) {
		if (error instanceof RepoReadmeNotFoundError) {
			await deleteCachedReadmeHtml(owner, repo);
			return null;
		}
		throw error;
	}
	if (!markdown) return null;

	const html = await renderMarkdownToHtml(markdown, { owner, repo, branch });
	await setCachedReadmeHtml(owner, repo, html);
	return html;
}

function scheduleReadmeRefresh(
	owner: string,
	repo: string,
	branch: string,
	authCtx?: GitHubAuthContext | null,
): void {
	void (async () => {
		let acquired = false;
		try {
			acquired = await tryAcquireReadmeRefreshLock(owner, repo);
			if (!acquired) return;
			await refreshReadmeHtml(owner, repo, branch, authCtx, true);
		} finally {
			if (acquired) await redis.del(readmeRefreshLockKey(owner, repo));
		}
	})().catch((error) => {
		console.error(
			`[getRepoReadmeHtmlCacheFirst] Background refresh failed for ${owner}/${repo}:`,
			error,
		);
	});
}

export async function getRepoReadmeHtmlCacheFirst(
	owner: string,
	repo: string,
	branch: string,
	authCtx?: GitHubAuthContext | null,
	options: RepoReadmeHtmlCacheFirstOptions = {},
): Promise<string | null> {
	if (!options.forceRefresh) {
		const cached = await getCachedReadmeHtml(owner, repo);
		if (cached !== null) {
			if (options.refreshInBackground !== false) {
				scheduleReadmeRefresh(owner, repo, branch, authCtx);
			}
			return cached;
		}
	}

	return refreshReadmeHtml(owner, repo, branch, authCtx, options.forceRefresh === true);
}

export async function fetchRepoReadmeMarkdown(
	owner: string,
	repo: string,
	branch: string,
	authCtx?: GitHubAuthContext | null,
): Promise<string | null> {
	return fetchReadmeMarkdownFromGitHub(owner, repo, branch, authCtx);
}

export async function warmRepoFileTreeForLayout(
	owner: string,
	repo: string,
	defaultBranch: string,
	authCtx?: GitHubAuthContext | null,
): Promise<FileTreeNode[] | null> {
	const treeResult = await getRepoTree(
		owner,
		repo,
		defaultBranch,
		true,
		authOverride(authCtx),
	);
	if (!treeResult || treeResult.truncated || !treeResult.tree) return null;

	const tree = buildFileTree(
		treeResult.tree as { path: string; type: string; size?: number }[],
	);
	await setCachedRepoTree(owner, repo, tree);
	return tree;
}

type RepoPullRequestListItem = Awaited<ReturnType<typeof getRepoPullRequests>>[number];
type RepoIssueListItem = Awaited<ReturnType<typeof getRepoIssues>>[number];

function mapOverviewPR(pr: RepoPullRequestListItem): OverviewPRItem {
	return {
		number: pr.number,
		title: pr.title,
		user: pr.user ? { login: pr.user.login, avatar_url: pr.user.avatar_url } : null,
		created_at: pr.created_at,
		comments: 0,
		draft: pr.draft,
	};
}

function mapOverviewIssue(issue: RepoIssueListItem): OverviewIssueItem {
	return {
		number: issue.number,
		title: issue.title,
		user: issue.user
			? { login: issue.user.login, avatar_url: issue.user.avatar_url }
			: null,
		created_at: issue.created_at,
		comments: issue.comments ?? 0,
		reactions: issue.reactions
			? { total_count: issue.reactions.total_count ?? 0 }
			: undefined,
		labels: issue.labels?.map((label) =>
			typeof label === "string"
				? { name: label }
				: { name: label.name, color: label.color ?? undefined },
		),
	};
}

export async function warmOverviewPRs(
	owner: string,
	repo: string,
	authCtx?: GitHubAuthContext | null,
): Promise<OverviewPRItem[]> {
	const raw = await getRepoPullRequests(owner, repo, "open", authOverride(authCtx));
	const result = raw.map(mapOverviewPR);
	await setCachedOverviewPRs(owner, repo, result);
	return result;
}

export async function warmOverviewIssues(
	owner: string,
	repo: string,
	authCtx?: GitHubAuthContext | null,
): Promise<OverviewIssueItem[]> {
	const raw = await getRepoIssues(owner, repo, "open", authOverride(authCtx));
	const result = raw.filter((item) => !item.pull_request).map(mapOverviewIssue);
	await setCachedOverviewIssues(owner, repo, result);
	return result;
}

export async function warmOverviewEvents(
	owner: string,
	repo: string,
	authCtx?: GitHubAuthContext | null,
): Promise<OverviewRepoEvent[]> {
	const raw = await getRepoEvents(owner, repo, 30, authOverride(authCtx));
	const result = raw as OverviewRepoEvent[];
	await setCachedOverviewEvents(owner, repo, result);
	return result;
}

export async function warmOverviewCIStatus(
	owner: string,
	repo: string,
	defaultBranch: string,
	authCtx?: GitHubAuthContext | null,
): Promise<CheckStatus | null> {
	const octokit = authCtx?.octokit ?? (await getOctokit());
	if (!octokit) return null;
	const result = await fetchCheckStatusForRef(octokit, owner, repo, defaultBranch);
	if (result) await setCachedOverviewCI(owner, repo, result);
	return result;
}

export async function warmOverviewCommitActivity(
	owner: string,
	repo: string,
	authCtx?: GitHubAuthContext | null,
): Promise<CommitActivityWeek[]> {
	const result = await getCommitActivity(owner, repo, authOverride(authCtx));
	await setCachedOverviewCommitActivity(owner, repo, result);
	return result;
}

export async function warmRepoLanguages(
	owner: string,
	repo: string,
	pageData?: RepoPageData | null,
	authCtx?: GitHubAuthContext | null,
): Promise<Record<string, number> | null> {
	if (pageData) {
		await setCachedRepoLanguages(owner, repo, pageData.languages);
		return pageData.languages;
	}

	const octokit = authCtx?.octokit ?? (await getOctokit());
	if (!octokit) return null;
	try {
		const { data } = await octokit.repos.listLanguages({ owner, repo });
		await setCachedRepoLanguages(owner, repo, data);
		return data;
	} catch {
		return null;
	}
}

export async function warmRepoBranches(
	owner: string,
	repo: string,
	authCtx?: GitHubAuthContext | null,
): Promise<BranchRef[]> {
	const branches = await getRepoBranches(owner, repo, authOverride(authCtx));
	const result = branches.map((branch) => ({ name: branch.name }));
	await setCachedBranches(owner, repo, result);
	return result;
}

export async function warmRepoTags(
	owner: string,
	repo: string,
	authCtx?: GitHubAuthContext | null,
): Promise<BranchRef[]> {
	const tags = await getRepoTags(owner, repo, authOverride(authCtx));
	const result = tags.map((tag) => ({ name: tag.name }));
	await setCachedTags(owner, repo, result);
	return result;
}

export async function warmContributorAvatars(
	owner: string,
	repo: string,
	authCtx?: GitHubAuthContext | null,
	perPage = 30,
): Promise<ContributorAvatarsData> {
	const contributors = await getRepoContributors(owner, repo, perPage, authOverride(authCtx));
	const data: ContributorAvatarsData = {
		avatars: contributors.list
			.filter((contributor) => !!contributor.login)
			.map((contributor) => ({
				login: contributor.login,
				avatar_url: contributor.avatar_url ?? "",
			})),
		totalCount: contributors.totalCount,
	};
	await setCachedContributorAvatars(owner, repo, data);
	return data;
}

export async function warmLayoutMetadataQuick(params: {
	owner: string;
	repo: string;
	pageData?: RepoPageData | null;
	authCtx?: GitHubAuthContext | null;
	isEmptyRepo?: boolean;
}): Promise<void> {
	const { owner, repo, pageData, authCtx, isEmptyRepo } = params;
	await Promise.allSettled([
		warmRepoLanguages(owner, repo, pageData, authCtx),
		warmRepoBranches(owner, repo, authCtx),
		warmRepoTags(owner, repo, authCtx),
		isEmptyRepo
			? Promise.resolve(null)
			: warmContributorAvatars(owner, repo, authCtx, 30),
	]);
}

export async function warmLayoutMetadataFull(params: {
	owner: string;
	repo: string;
	pageData?: RepoPageData | null;
	authCtx?: GitHubAuthContext | null;
	isEmptyRepo?: boolean;
}): Promise<void> {
	await warmLayoutMetadataQuick(params);
}
