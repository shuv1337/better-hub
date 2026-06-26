import { beforeEach, describe, expect, it, vi } from "vitest";

const github = vi.hoisted(() => ({
	getRepoPageData: vi.fn(),
	getRepoTree: vi.fn(),
	prefetchPRData: vi.fn(),
	getForkSyncStatus: vi.fn(),
}));

const promptStore = vi.hoisted(() => ({
	countPromptRequests: vi.fn(),
}));

const repoDataCacheVc = vi.hoisted(() => ({
	getCachedRepoTree: vi.fn(),
	getCachedContributorAvatars: vi.fn(),
	getCachedRepoLanguages: vi.fn(),
	getCachedBranches: vi.fn(),
	getCachedTags: vi.fn(),
}));

const nextHeaders = vi.hoisted(() => ({
	cookies: vi.fn(),
	headers: vi.fn(),
}));

const waitUntil = vi.hoisted(() => vi.fn());

vi.mock("@/lib/github", () => github);
vi.mock("@/lib/prompt-request-store", () => promptStore);
vi.mock("@/lib/repo-data-cache-vc", () => repoDataCacheVc);
vi.mock("next/headers", () => nextHeaders);
vi.mock("@vercel/functions", () => ({ waitUntil }));
vi.mock("@/lib/repo-data-cache", () => ({
	setCachedRepoTree: vi.fn(),
}));
vi.mock("@/components/repo/repo-sidebar", () => ({
	RepoSidebar: () => null,
}));
vi.mock("@/components/repo/repo-nav", () => ({
	RepoNav: () => null,
}));
vi.mock("@/components/repo/fork-sync-button", () => ({
	ForkSyncButton: () => null,
}));
vi.mock("@/components/repo/code-content-wrapper", () => ({
	CodeContentWrapper: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/repo/repo-layout-wrapper", () => ({
	RepoLayoutWrapper: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/shared/chat-page-activator", () => ({
	ChatPageActivator: () => null,
}));
vi.mock("@/components/repo/repo-revalidator", () => ({
	RepoRevalidator: () => null,
}));

const successPageData = {
	success: true as const,
	data: {
		repoData: {
			fork: false,
			size: 1,
			private: false,
			default_branch: "main",
			owner: { type: "User", login: "owner", avatar_url: "" },
			parent: null,
			has_discussions: false,
		},
		navCounts: {
			openIssues: 0,
			openPrs: 0,
			activeRuns: 0,
			discussions: 0,
		},
		viewerHasStarred: false,
		viewerIsOrgMember: false,
		latestCommit: null,
		viewerLogin: "owner",
	},
};

describe("RepoLayout cache gating", () => {
	beforeEach(() => {
		for (const fn of Object.values(github)) fn.mockReset();
		promptStore.countPromptRequests.mockReset();
		for (const fn of Object.values(repoDataCacheVc)) fn.mockReset();
		nextHeaders.cookies.mockReset();
		nextHeaders.headers.mockReset();
		waitUntil.mockReset();

		nextHeaders.cookies.mockResolvedValue({ get: () => undefined });
		nextHeaders.headers.mockResolvedValue(new Headers());
		github.prefetchPRData.mockResolvedValue(undefined);
		github.getRepoTree.mockResolvedValue(null);
		repoDataCacheVc.getCachedRepoTree.mockResolvedValue([]);
		repoDataCacheVc.getCachedContributorAvatars.mockResolvedValue([]);
		repoDataCacheVc.getCachedRepoLanguages.mockResolvedValue([]);
		repoDataCacheVc.getCachedBranches.mockResolvedValue([]);
		repoDataCacheVc.getCachedTags.mockResolvedValue([]);
		promptStore.countPromptRequests.mockResolvedValue(0);
	});

	it("does not read fragment caches or prompt counts when repo access fails", async () => {
		github.getRepoPageData.mockResolvedValue({
			success: false,
			error: "Repository not found",
		});

		const { default: RepoLayout } = await import("./layout");
		await RepoLayout({
			children: null,
			params: Promise.resolve({ owner: "owner", repo: "repo" }),
		});

		expect(repoDataCacheVc.getCachedRepoTree).not.toHaveBeenCalled();
		expect(repoDataCacheVc.getCachedContributorAvatars).not.toHaveBeenCalled();
		expect(repoDataCacheVc.getCachedRepoLanguages).not.toHaveBeenCalled();
		expect(repoDataCacheVc.getCachedBranches).not.toHaveBeenCalled();
		expect(repoDataCacheVc.getCachedTags).not.toHaveBeenCalled();
		expect(promptStore.countPromptRequests).not.toHaveBeenCalled();
	});

	it("reads fragment caches and prompt counts after repo access succeeds", async () => {
		github.getRepoPageData.mockResolvedValue(successPageData);

		const { default: RepoLayout } = await import("./layout");
		await RepoLayout({
			children: null,
			params: Promise.resolve({ owner: "owner", repo: "repo" }),
		});

		expect(repoDataCacheVc.getCachedRepoTree).toHaveBeenCalledWith("owner", "repo");
		expect(repoDataCacheVc.getCachedContributorAvatars).toHaveBeenCalledWith(
			"owner",
			"repo",
		);
		expect(repoDataCacheVc.getCachedRepoLanguages).toHaveBeenCalledWith(
			"owner",
			"repo",
		);
		expect(repoDataCacheVc.getCachedBranches).toHaveBeenCalledWith("owner", "repo");
		expect(repoDataCacheVc.getCachedTags).toHaveBeenCalledWith("owner", "repo");
		expect(promptStore.countPromptRequests).toHaveBeenCalledWith(
			"owner",
			"repo",
			"open",
		);
	});
});
