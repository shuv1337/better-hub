import type { GitHubAuthContext } from "./github-auth-context";
import { renewGithubCacheWarmLock } from "./github-cache-lock";
import { githubCacheKeys } from "./github-cache-descriptors";
import { shouldRefresh, type GithubCacheDataClass } from "./github-cache-policy";
import {
	fetchAndCacheRepoPageDataWithAuth,
	getOrgRepos,
	getRepoDiscussionsPage,
	getRepoReleases,
	getRepoWorkflowRuns,
	getUserOrgs,
	getUserRepos,
	type RepoPageData,
} from "./github";
import {
	getRepoReadmeHtmlCacheFirst,
	warmLayoutMetadataFull,
	warmLayoutMetadataQuick,
	warmOverviewCIStatus,
	warmOverviewCommitActivity,
	warmOverviewEvents,
	warmOverviewIssues,
	warmOverviewPRs,
	warmRepoFileTreeForLayout,
} from "./repo-overview-cache-warmer";
import {
	getCachedBranches,
	getCachedContributorAvatars,
	getCachedOverviewCI,
	getCachedOverviewCommitActivity,
	getCachedOverviewEvents,
	getCachedOverviewIssues,
	getCachedOverviewPRs,
	getCachedRepoLanguages,
	getCachedRepoPageDataEntry,
	getCachedRepoTree,
	getCachedTags,
} from "./repo-data-cache";
import { getCachedReadmeHtml } from "./readme-cache";
import { getGithubCacheEntrySyncedAt } from "./github-sync-store";

export const DEFAULT_MAX_REPOS = 100;
export const DEFAULT_CONCURRENT_REPOS = 3;
export const DEFAULT_CONCURRENT_STAGES_PER_REPO = 2;

export type GithubCacheWarmMode = "quick" | "full";

export interface GithubCacheWarmOptions {
	mode: GithubCacheWarmMode;
	maxRepos?: number;
	maxConcurrentRepos?: number;
	refreshStaleOnly?: boolean;
}

export interface GithubCacheWarmRun {
	runId: string;
	source: "api-inline" | "inngest" | "debug" | "script";
	lockKey: string;
	lockAlreadyHeld: true;
}

export interface GithubCacheWarmResult {
	userId: string;
	runId: string;
	source: GithubCacheWarmRun["source"];
	discoveredRepos: number;
	selectedRepos: number;
	warmedRepos: number;
	skippedRepos: number;
	failedRepos: number;
	jobsQueued: number;
	durationMs: number;
	skippedReason?:
		| "already-running"
		| "disabled"
		| "throttled"
		| "auth-unavailable"
		| "lock-lost";
	errors: Array<{ repo: string; stage: string; message: string }>;
}

export interface WarmableRepo {
	owner: string;
	repo: string;
	name: string;
	fullName: string;
	private: boolean;
	pushedAt: string | null;
	updatedAt: string | null;
	defaultBranch: string | null;
}

type AuthOverride = { authCtx: GitHubAuthContext };

interface StageError {
	repo: string;
	stage: string;
	message: string;
}

class GithubCacheWarmLockLostError extends Error {
	constructor() {
		super("GitHub cache warm lock was lost");
		this.name = "GithubCacheWarmLockLostError";
	}
}

function isLockLostError(error: unknown): boolean {
	return error instanceof GithubCacheWarmLockLostError;
}

function authOverride(authCtx: GitHubAuthContext): AuthOverride {
	return { authCtx };
}

function getRepoTimestamp(repo: WarmableRepo, key: "pushedAt" | "updatedAt"): number {
	const value = repo[key];
	if (!value) return 0;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeWarmableRepo(repo: unknown): WarmableRepo | null {
	if (!repo || typeof repo !== "object") return null;
	const record = repo as {
		name?: unknown;
		full_name?: unknown;
		private?: unknown;
		pushed_at?: unknown;
		updated_at?: unknown;
		default_branch?: unknown;
		owner?: { login?: unknown } | null;
	};
	const name = typeof record.name === "string" ? record.name : null;
	const fullName = typeof record.full_name === "string" ? record.full_name : null;
	const ownerLogin =
		typeof record.owner?.login === "string"
			? record.owner.login
			: fullName?.split("/")[0];
	if (!name || !ownerLogin) return null;
	return {
		owner: ownerLogin,
		repo: name,
		name,
		fullName: fullName ?? `${ownerLogin}/${name}`,
		private: record.private === true,
		pushedAt: typeof record.pushed_at === "string" ? record.pushed_at : null,
		updatedAt: typeof record.updated_at === "string" ? record.updated_at : null,
		defaultBranch:
			typeof record.default_branch === "string" ? record.default_branch : null,
	};
}

function sortWarmableRepos(repos: WarmableRepo[]): WarmableRepo[] {
	return repos.sort((a, b) => {
		const pushedDiff =
			getRepoTimestamp(b, "pushedAt") - getRepoTimestamp(a, "pushedAt");
		if (pushedDiff !== 0) return pushedDiff;
		return getRepoTimestamp(b, "updatedAt") - getRepoTimestamp(a, "updatedAt");
	});
}

export async function discoverPersonalRepos(
	authCtx: GitHubAuthContext,
	options: { maxRepos?: number } = {},
): Promise<WarmableRepo[]> {
	const seen = new Map<string, WarmableRepo>();
	const addRepo = (repo: unknown) => {
		const warmable = normalizeWarmableRepo(repo);
		if (!warmable) return;
		const key = warmable.fullName.toLowerCase();
		const existing = seen.get(key);
		if (!existing) {
			seen.set(key, warmable);
			return;
		}
		seen.set(key, {
			...existing,
			...warmable,
			defaultBranch: existing.defaultBranch ?? warmable.defaultBranch,
		});
	};

	const auth = authOverride(authCtx);
	const userRepos = await getUserRepos("updated", 100, auth);
	for (const repo of userRepos) addRepo(repo);

	const orgs = await getUserOrgs(50, auth);
	for (const org of orgs) {
		const login =
			org &&
			typeof org === "object" &&
			typeof (org as { login?: unknown }).login === "string"
				? (org as { login: string }).login
				: null;
		if (!login) continue;
		const orgRepos = await getOrgRepos(
			login,
			{ perPage: 100, sort: "updated", type: "all" },
			auth,
		);
		for (const repo of orgRepos) addRepo(repo);
	}

	return sortWarmableRepos([...seen.values()]).slice(
		0,
		options.maxRepos ?? DEFAULT_MAX_REPOS,
	);
}

async function mapConcurrent<T, R>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = Array.from({ length: items.length }) as R[];
	let next = 0;
	const workerCount = Math.max(1, Math.min(limit, items.length));
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await worker(items[index], index);
			}
		}),
	);
	return results;
}

function logWarmEvent(event: string, data: Record<string, unknown>) {
	console.info(event, data);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createGithubCacheWarmSkippedResult(params: {
	userId: string;
	run: GithubCacheWarmRun;
	skippedReason: NonNullable<GithubCacheWarmResult["skippedReason"]>;
	startedAt?: number;
	errors?: GithubCacheWarmResult["errors"];
}): GithubCacheWarmResult {
	const now = Date.now();
	return {
		userId: params.userId,
		runId: params.run.runId,
		source: params.run.source,
		discoveredRepos: 0,
		selectedRepos: 0,
		warmedRepos: 0,
		skippedRepos: 0,
		failedRepos: 0,
		jobsQueued: 0,
		durationMs: params.startedAt ? now - params.startedAt : 0,
		skippedReason: params.skippedReason,
		errors: params.errors ?? [],
	};
}

async function runRepoStage(
	repo: WarmableRepo,
	stage: string,
	errors: StageError[],
	assertRunLock: () => Promise<void>,
	fn: () => Promise<unknown>,
): Promise<void> {
	const startedAt = Date.now();
	try {
		await assertRunLock();
		await fn();
		logWarmEvent("github_cache_warm.stage_completed", {
			repo: repo.fullName,
			stage,
			durationMs: Date.now() - startedAt,
		});
	} catch (error) {
		if (isLockLostError(error)) throw error;
		const message = errorMessage(error);
		errors.push({ repo: repo.fullName, stage, message });
		logWarmEvent("github_cache_warm.stage_failed", {
			repo: repo.fullName,
			stage,
			errorClass: error instanceof Error ? error.name : typeof error,
			message,
		});
	}
}

async function isUserCacheFresh(
	userId: string,
	cacheKey: string,
	dataClass: GithubCacheDataClass,
): Promise<boolean> {
	const syncedAt = await getGithubCacheEntrySyncedAt(userId, cacheKey);
	return !shouldRefresh(syncedAt, dataClass);
}

async function isPresent<T>(value: Promise<T | null>): Promise<boolean> {
	return (await value) !== null;
}

async function shouldRunRepoStage(
	refreshStaleOnly: boolean,
	freshCheck: () => Promise<boolean>,
): Promise<boolean> {
	return !refreshStaleOnly || !(await freshCheck());
}

async function runStageGroup(
	repo: WarmableRepo,
	errors: StageError[],
	assertRunLock: () => Promise<void>,
	stages: Array<{ name: string; run: () => Promise<unknown> }>,
): Promise<void> {
	await mapConcurrent(stages, DEFAULT_CONCURRENT_STAGES_PER_REPO, (stage) =>
		runRepoStage(repo, stage.name, errors, assertRunLock, stage.run),
	);
}

function fullRefreshAuth(authCtx: GitHubAuthContext): GitHubAuthContext {
	return { ...authCtx, forceRefresh: true };
}

async function warmRepo(params: {
	authCtx: GitHubAuthContext;
	mode: GithubCacheWarmMode;
	refreshStaleOnly: boolean;
	repo: WarmableRepo;
	run: GithubCacheWarmRun;
}): Promise<{ warmed: boolean; errors: StageError[]; lockLost?: boolean }> {
	const { authCtx, mode, refreshStaleOnly, repo, run } = params;
	const errors: StageError[] = [];
	let pageData: RepoPageData | null = null;
	const assertRunLock = () => assertGithubCacheWarmLock(authCtx.userId, run);

	await runRepoStage(repo, "fetchAndCacheRepoPageData", errors, assertRunLock, async () => {
		if (refreshStaleOnly) {
			const cached = await getCachedRepoPageDataEntry<RepoPageData>(
				authCtx.userId,
				repo.owner,
				repo.repo,
			);
			if (cached && !shouldRefresh(cached.syncedAt, "repo-chrome")) {
				pageData = cached.data;
				return;
			}
		}
		const result = await fetchAndCacheRepoPageDataWithAuth(
			authCtx,
			repo.owner,
			repo.repo,
		);
		if (!result.success) throw new Error(result.error);
		pageData = result.data;
	});

	const loadedPageData = pageData as RepoPageData | null;
	if (!loadedPageData) return { warmed: false, errors };

	const defaultBranch =
		loadedPageData.repoData.default_branch || repo.defaultBranch || "main";
	const isEmptyRepo = loadedPageData.repoData.size === 0;

	if (!isEmptyRepo) {
		await runRepoStage(repo, "warmRepoFileTreeForLayout", errors, assertRunLock, () =>
			shouldRunRepoStage(refreshStaleOnly, () =>
				isPresent(getCachedRepoTree(repo.owner, repo.repo)),
			).then((shouldRun) =>
				shouldRun
					? warmRepoFileTreeForLayout(
							repo.owner,
							repo.repo,
							defaultBranch,
							authCtx,
						)
					: null,
			),
		);
	}

	const layoutAuthCtx = mode === "full" ? fullRefreshAuth(authCtx) : authCtx;
	await runRepoStage(
		repo,
		mode === "full" ? "warmLayoutMetadataFull" : "warmLayoutMetadataQuick",
		errors,
		assertRunLock,
		async () => {
			const layoutFresh =
				(await isPresent(getCachedRepoLanguages(repo.owner, repo.repo))) &&
				(await isPresent(getCachedBranches(repo.owner, repo.repo))) &&
				(await isPresent(getCachedTags(repo.owner, repo.repo))) &&
				(isEmptyRepo ||
					(await isPresent(
						getCachedContributorAvatars(repo.owner, repo.repo),
					)));
			if (refreshStaleOnly && layoutFresh) return null;
			return mode === "full"
				? warmLayoutMetadataFull({
						owner: repo.owner,
						repo: repo.repo,
						pageData: loadedPageData,
						authCtx: layoutAuthCtx,
						isEmptyRepo,
					})
				: warmLayoutMetadataQuick({
						owner: repo.owner,
						repo: repo.repo,
						pageData: loadedPageData,
						authCtx,
						isEmptyRepo,
					});
		},
	);

	if (!isEmptyRepo) {
		await runRepoStage(repo, "getRepoReadmeHtmlCacheFirst", errors, assertRunLock, () =>
			shouldRunRepoStage(refreshStaleOnly, () =>
				isPresent(getCachedReadmeHtml(repo.owner, repo.repo)),
			).then((shouldRun) =>
				shouldRun
					? getRepoReadmeHtmlCacheFirst(
							repo.owner,
							repo.repo,
							defaultBranch,
							authCtx,
						)
					: null,
			),
		);
	}

	await runStageGroup(repo, errors, assertRunLock, [
		{
			name: "warmOverviewPRs",
			run: async () =>
				(await shouldRunRepoStage(refreshStaleOnly, () =>
					isPresent(getCachedOverviewPRs(repo.owner, repo.repo)),
				))
					? warmOverviewPRs(repo.owner, repo.repo, authCtx)
					: null,
		},
		{
			name: "warmOverviewIssues",
			run: async () =>
				(await shouldRunRepoStage(refreshStaleOnly, () =>
					isPresent(getCachedOverviewIssues(repo.owner, repo.repo)),
				))
					? warmOverviewIssues(repo.owner, repo.repo, authCtx)
					: null,
		},
		{
			name: "warmOverviewEvents",
			run: async () =>
				(await shouldRunRepoStage(refreshStaleOnly, () =>
					isPresent(getCachedOverviewEvents(repo.owner, repo.repo)),
				))
					? warmOverviewEvents(repo.owner, repo.repo, authCtx)
					: null,
		},
		{
			name: "warmOverviewCIStatus",
			run: async () =>
				(await shouldRunRepoStage(refreshStaleOnly, () =>
					isPresent(getCachedOverviewCI(repo.owner, repo.repo)),
				))
					? warmOverviewCIStatus(
							repo.owner,
							repo.repo,
							defaultBranch,
							authCtx,
						)
					: null,
		},
	]);

	await runRepoStage(repo, "getRepoWorkflowRuns", errors, assertRunLock, () =>
		shouldRunRepoStage(refreshStaleOnly, () =>
			isUserCacheFresh(
				authCtx.userId,
				githubCacheKeys.repoWorkflowRuns(repo.owner, repo.repo, 50),
				"ci",
			),
		).then((shouldRun) =>
			shouldRun
				? getRepoWorkflowRuns(
						repo.owner,
						repo.repo,
						50,
						authOverride(authCtx),
					)
				: null,
		),
	);

	if (mode === "full") {
		const refreshAuthCtx = fullRefreshAuth(authCtx);
		await runStageGroup(repo, errors, assertRunLock, [
			{
				name: "getRepoReleases",
				run: async () =>
					(await shouldRunRepoStage(refreshStaleOnly, () =>
						isUserCacheFresh(
							authCtx.userId,
							githubCacheKeys.repoReleases(
								repo.owner,
								repo.repo,
							),
							"repo-chrome",
						),
					))
						? getRepoReleases(
								repo.owner,
								repo.repo,
								authOverride(refreshAuthCtx),
							)
						: null,
			},
			{
				name: "getRepoDiscussionsPage",
				run: async () => {
					if (!loadedPageData.repoData.has_discussions) return null;
					const shouldRun = await shouldRunRepoStage(
						refreshStaleOnly,
						() =>
							isUserCacheFresh(
								authCtx.userId,
								githubCacheKeys.repoDiscussions(
									repo.owner,
									repo.repo,
								),
								"hot-list",
							),
					);
					return shouldRun
						? getRepoDiscussionsPage(
								repo.owner,
								repo.repo,
								authOverride(refreshAuthCtx),
							)
						: null;
				},
			},
			{
				name: "warmOverviewCommitActivity",
				run: async () =>
					(await shouldRunRepoStage(refreshStaleOnly, () =>
						isPresent(
							getCachedOverviewCommitActivity(
								repo.owner,
								repo.repo,
							),
						),
					))
						? warmOverviewCommitActivity(
								repo.owner,
								repo.repo,
								refreshAuthCtx,
							)
						: null,
			},
		]);
	}

	return { warmed: true, errors };
}

async function assertGithubCacheWarmLock(userId: string, run: GithubCacheWarmRun): Promise<void> {
	if (!run.lockAlreadyHeld) return;
	if (!(await renewGithubCacheWarmLock(userId, run.runId))) {
		throw new GithubCacheWarmLockLostError();
	}
}

export async function warmPersonalGithubCache(params: {
	authCtx: GitHubAuthContext;
	options: GithubCacheWarmOptions;
	run: GithubCacheWarmRun;
}): Promise<GithubCacheWarmResult> {
	const startedAt = Date.now();
	const { authCtx, run } = params;
	const options = {
		...params.options,
		maxRepos: params.options.maxRepos ?? DEFAULT_MAX_REPOS,
		maxConcurrentRepos: params.options.maxConcurrentRepos ?? DEFAULT_CONCURRENT_REPOS,
	};
	logWarmEvent("github_cache_warm.requested", {
		userId: authCtx.userId,
		runId: run.runId,
		mode: options.mode,
		source: run.source,
		maxRepos: options.maxRepos,
		refreshStaleOnly: options.refreshStaleOnly ?? false,
	});

	let repos: WarmableRepo[];
	try {
		await assertGithubCacheWarmLock(authCtx.userId, run);
		repos = await discoverPersonalRepos(authCtx, { maxRepos: options.maxRepos });
		await assertGithubCacheWarmLock(authCtx.userId, run);
	} catch (error) {
		if (!isLockLostError(error)) throw error;
		return createGithubCacheWarmSkippedResult({
			userId: authCtx.userId,
			run,
			skippedReason: "lock-lost",
			startedAt,
			errors: [
				{
					repo: "*",
					stage: "lock",
					message: errorMessage(error),
				},
			],
		});
	}
	logWarmEvent("github_cache_warm.started", {
		userId: authCtx.userId,
		runId: run.runId,
		mode: options.mode,
		selectedRepos: repos.length,
		discoveredRepos: repos.length,
	});

	const repoResults = await mapConcurrent(repos, options.maxConcurrentRepos, async (repo) => {
		try {
			return await warmRepo({
				authCtx,
				mode: options.mode,
				refreshStaleOnly: options.refreshStaleOnly ?? false,
				repo,
				run,
			});
		} catch (error) {
			if (isLockLostError(error)) {
				return {
					warmed: false,
					lockLost: true,
					errors: [
						{
							repo: repo.fullName,
							stage: "lock",
							message: errorMessage(error),
						},
					],
				};
			}
			throw error;
		}
	});
	const errors = repoResults.flatMap((result) => result.errors);
	const warmedRepos = repoResults.filter((result) => result.warmed).length;
	const failedRepos = repoResults.filter(
		(result) => result.errors.length > 0 && !result.warmed,
	).length;
	const result: GithubCacheWarmResult = {
		userId: authCtx.userId,
		runId: run.runId,
		source: run.source,
		discoveredRepos: repos.length,
		selectedRepos: repos.length,
		warmedRepos,
		skippedRepos: repos.length - warmedRepos - failedRepos,
		failedRepos,
		jobsQueued: 0,
		durationMs: Date.now() - startedAt,
		errors,
	};
	if (repoResults.some((repoResult) => repoResult.lockLost)) {
		result.skippedReason = "lock-lost";
	}
	logWarmEvent("github_cache_warm.completed", {
		userId: authCtx.userId,
		runId: run.runId,
		warmedRepos: result.warmedRepos,
		failedRepos: result.failedRepos,
		durationMs: result.durationMs,
		errorCount: result.errors.length,
	});
	return result;
}
