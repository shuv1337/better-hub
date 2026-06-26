import { beforeEach, describe, expect, it, vi } from "vitest";

const github = vi.hoisted(() => ({
	fetchCheckStatusForRef: vi.fn(),
	fetchRepoReadmeMarkdownFromGitHub: vi.fn(),
	getCommitActivity: vi.fn(),
	getOctokit: vi.fn(),
	getRepoBranches: vi.fn(),
	getRepoContributors: vi.fn(),
	getRepoEvents: vi.fn(),
	getRepoIssues: vi.fn(),
	getRepoPullRequests: vi.fn(),
	getRepoReadme: vi.fn(),
	getRepoTags: vi.fn(),
	getRepoTree: vi.fn(),
}));

const readmeCache = vi.hoisted(() => ({
	deleteCachedReadmeHtml: vi.fn(),
	getCachedReadmeHtml: vi.fn(),
	setCachedReadmeHtml: vi.fn(),
}));

const repoDataCache = vi.hoisted(() => ({
	setCachedBranches: vi.fn(),
	setCachedContributorAvatars: vi.fn(),
	setCachedOverviewCI: vi.fn(),
	setCachedOverviewCommitActivity: vi.fn(),
	setCachedOverviewEvents: vi.fn(),
	setCachedOverviewIssues: vi.fn(),
	setCachedOverviewPRs: vi.fn(),
	setCachedRepoLanguages: vi.fn(),
	setCachedRepoTree: vi.fn(),
	setCachedTags: vi.fn(),
}));

const markdownRenderer = vi.hoisted(() => ({
	renderMarkdownToHtml: vi.fn(),
}));

const redis = vi.hoisted(() => ({
	del: vi.fn(),
	set: vi.fn(),
}));

vi.mock("./github", () => github);
vi.mock("./readme-cache", () => readmeCache);
vi.mock("./repo-data-cache", () => repoDataCache);
vi.mock("@/components/shared/markdown-renderer", () => markdownRenderer);
vi.mock("./redis", () => ({ redis }));

describe("repo overview cache warmer helpers", () => {
	beforeEach(() => {
		for (const helper of Object.values(github)) helper.mockReset();
		for (const helper of Object.values(readmeCache)) helper.mockReset();
		for (const helper of Object.values(repoDataCache)) helper.mockReset();
		markdownRenderer.renderMarkdownToHtml.mockReset();
		redis.del.mockReset();
		redis.set.mockReset();
	});

	it("returns cached README HTML before any GitHub read", async () => {
		readmeCache.getCachedReadmeHtml.mockResolvedValue("<h1>Cached</h1>");

		const { getRepoReadmeHtmlCacheFirst } =
			await import("./repo-overview-cache-warmer");

		await expect(
			getRepoReadmeHtmlCacheFirst("Owner", "Repo", "main", null, {
				refreshInBackground: false,
			}),
		).resolves.toBe("<h1>Cached</h1>");
		expect(github.getRepoReadme).not.toHaveBeenCalled();
		expect(github.getOctokit).not.toHaveBeenCalled();
		expect(readmeCache.setCachedReadmeHtml).not.toHaveBeenCalled();
	});

	it("renders and caches README HTML on true miss", async () => {
		readmeCache.getCachedReadmeHtml.mockResolvedValue(null);
		github.getRepoReadme.mockResolvedValue({ content: "# Hello" });
		markdownRenderer.renderMarkdownToHtml.mockResolvedValue("<h1>Hello</h1>");

		const { getRepoReadmeHtmlCacheFirst } =
			await import("./repo-overview-cache-warmer");

		await expect(
			getRepoReadmeHtmlCacheFirst("Owner", "Repo", "main", null, {
				refreshInBackground: false,
			}),
		).resolves.toBe("<h1>Hello</h1>");
		expect(github.getRepoReadme).toHaveBeenCalledWith(
			"Owner",
			"Repo",
			"main",
			undefined,
		);
		expect(markdownRenderer.renderMarkdownToHtml).toHaveBeenCalledWith("# Hello", {
			owner: "Owner",
			repo: "Repo",
			branch: "main",
		});
		expect(readmeCache.setCachedReadmeHtml).toHaveBeenCalledWith(
			"Owner",
			"Repo",
			"<h1>Hello</h1>",
		);
	});

	it("builds and writes the layout file tree through the cached repo tree path", async () => {
		github.getRepoTree.mockResolvedValue({
			truncated: false,
			tree: [
				{ path: "src", type: "tree" },
				{ path: "src/index.ts", type: "blob", size: 12 },
			],
		});
		const authCtx = {
			userId: "user-1",
			token: "token",
			octokit: {},
			forceRefresh: false,
		};

		const { warmRepoFileTreeForLayout } = await import("./repo-overview-cache-warmer");

		const tree = await warmRepoFileTreeForLayout(
			"Owner",
			"Repo",
			"main",
			authCtx as never,
		);

		expect(github.getRepoTree).toHaveBeenCalledWith("Owner", "Repo", "main", true, {
			authCtx,
		});
		expect(tree).toEqual([
			{
				name: "src",
				path: "src",
				type: "dir",
				children: [
					{
						name: "index.ts",
						path: "src/index.ts",
						type: "file",
						size: 12,
					},
				],
			},
		]);
		expect(repoDataCache.setCachedRepoTree).toHaveBeenCalledWith("Owner", "Repo", tree);
	});

	it("deletes cached README HTML when a forced refresh finds no README file", async () => {
		readmeCache.getCachedReadmeHtml.mockResolvedValue("<h1>Old</h1>");
		github.fetchRepoReadmeMarkdownFromGitHub.mockResolvedValue(null);
		const authCtx = {
			userId: "user-1",
			token: "token",
			octokit: {},
			forceRefresh: false,
		};

		const { getRepoReadmeHtmlCacheFirst } =
			await import("./repo-overview-cache-warmer");

		await expect(
			getRepoReadmeHtmlCacheFirst("Owner", "Repo", "main", authCtx as never, {
				forceRefresh: true,
			}),
		).resolves.toBeNull();
		expect(github.fetchRepoReadmeMarkdownFromGitHub).toHaveBeenCalledWith(
			authCtx.octokit,
			"Owner",
			"Repo",
			"main",
		);
		expect(readmeCache.deleteCachedReadmeHtml).toHaveBeenCalledWith("Owner", "Repo");
		expect(readmeCache.setCachedReadmeHtml).not.toHaveBeenCalled();
	});

	it("releases the README background refresh lock after transient refresh failure", async () => {
		readmeCache.getCachedReadmeHtml.mockResolvedValue("<h1>Cached</h1>");
		redis.set.mockResolvedValue("OK");
		github.fetchRepoReadmeMarkdownFromGitHub.mockRejectedValue({ status: 503 });
		const authCtx = {
			userId: "user-1",
			token: "token",
			octokit: {},
			forceRefresh: false,
		};
		vi.spyOn(console, "error").mockImplementation(() => {});

		const { getRepoReadmeHtmlCacheFirst } =
			await import("./repo-overview-cache-warmer");

		await expect(
			getRepoReadmeHtmlCacheFirst("Owner", "Repo", "main", authCtx as never),
		).resolves.toBe("<h1>Cached</h1>");
		await vi.waitFor(() => {
			expect(redis.del).toHaveBeenCalledWith(
				"readme-html-refresh-lock:owner/repo",
			);
		});
	});
});
