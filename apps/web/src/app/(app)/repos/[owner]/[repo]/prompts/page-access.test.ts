import { beforeEach, describe, expect, it, vi } from "vitest";

const promptStore = vi.hoisted(() => ({
	getPromptRequestForRepo: vi.fn(),
	listPromptRequestComments: vi.fn(),
	listPromptRequestReactions: vi.fn(),
}));

const authModule = vi.hoisted(() => ({
	getServerSession: vi.fn(),
}));

const githubModule = vi.hoisted(() => ({
	getOctokit: vi.fn(),
	extractRepoPermissions: vi.fn(),
	getRepo: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
	notFound: vi.fn(() => {
		throw new Error("NOT_FOUND");
	}),
}));

vi.mock("@/lib/prompt-request-store", () => promptStore);
vi.mock("@/lib/auth", () => authModule);
vi.mock("@/lib/github", () => githubModule);
vi.mock("next/navigation", () => navigation);

const mockPrompt = {
	id: "prompt-1",
	userId: "user-1",
	userLogin: "alice",
	userName: "Alice",
	userAvatarUrl: null,
	owner: "ownerA",
	repo: "repoA",
	title: "Test prompt",
	body: "Body",
	status: "open" as const,
	acceptedById: null,
	acceptedByName: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

function mockOctokitWithRepoAccess() {
	const reposGet = vi.fn().mockResolvedValue({
		data: { permissions: { pull: true, push: false, admin: false, maintain: false } },
	});
	githubModule.getOctokit.mockResolvedValue({ repos: { get: reposGet } });
	githubModule.extractRepoPermissions.mockReturnValue({
		pull: true,
		push: false,
		admin: false,
		maintain: false,
	});
	return reposGet;
}

describe("prompt detail page access", () => {
	beforeEach(() => {
		for (const fn of Object.values(promptStore)) fn.mockReset();
		authModule.getServerSession.mockReset();
		githubModule.getOctokit.mockReset();
		githubModule.extractRepoPermissions.mockReset();
		githubModule.getRepo.mockReset();
		navigation.notFound.mockClear();

		authModule.getServerSession.mockResolvedValue({
			user: { id: "user-1", name: "Alice", image: "" },
			githubUser: { login: "alice" },
		});
		promptStore.listPromptRequestComments.mockResolvedValue([]);
		promptStore.listPromptRequestReactions.mockResolvedValue([]);
		mockOctokitWithRepoAccess();
	});

	it("returns notFound when prompt id belongs to a different repo route", async () => {
		promptStore.getPromptRequestForRepo.mockResolvedValue(null);

		const { default: PromptDetailPage } = await import("./[id]/page");

		await expect(
			PromptDetailPage({
				params: Promise.resolve({
					owner: "ownerB",
					repo: "repoB",
					id: "prompt-1",
				}),
			}),
		).rejects.toThrow("NOT_FOUND");

		expect(promptStore.getPromptRequestForRepo).toHaveBeenCalledWith(
			"prompt-1",
			"ownerB",
			"repoB",
		);
		expect(promptStore.listPromptRequestComments).not.toHaveBeenCalled();
		expect(promptStore.listPromptRequestReactions).not.toHaveBeenCalled();
	});

	it("renders prompt when id matches route repo", async () => {
		promptStore.getPromptRequestForRepo.mockResolvedValue(mockPrompt);

		const { default: PromptDetailPage } = await import("./[id]/page");

		const result = await PromptDetailPage({
			params: Promise.resolve({ owner: "ownerA", repo: "repoA", id: "prompt-1" }),
		});

		expect(navigation.notFound).not.toHaveBeenCalled();
		expect(promptStore.listPromptRequestComments).toHaveBeenCalledWith("prompt-1");
		expect(promptStore.listPromptRequestReactions).toHaveBeenCalledWith("prompt-1");
		expect(result).toBeTruthy();
	});

	it("returns notFound when viewer cannot access route repo", async () => {
		githubModule.getOctokit.mockResolvedValue({
			repos: { get: vi.fn().mockRejectedValue(new Error("404")) },
		});

		const { default: PromptDetailPage } = await import("./[id]/page");

		await expect(
			PromptDetailPage({
				params: Promise.resolve({
					owner: "ownerA",
					repo: "repoA",
					id: "prompt-1",
				}),
			}),
		).rejects.toThrow("NOT_FOUND");

		expect(promptStore.getPromptRequestForRepo).not.toHaveBeenCalled();
	});
});

describe("prompt detail metadata access", () => {
	beforeEach(() => {
		for (const fn of Object.values(promptStore)) fn.mockReset();
		githubModule.getOctokit.mockReset();
		githubModule.getRepo.mockReset();

		promptStore.getPromptRequestForRepo.mockResolvedValue(mockPrompt);
	});

	it("returns a generic title when octokit.repos.get fails", async () => {
		githubModule.getOctokit.mockResolvedValue({
			repos: { get: vi.fn().mockRejectedValue(new Error("404")) },
		});

		const { generateMetadata } = await import("./[id]/page");
		const metadata = await generateMetadata({
			params: Promise.resolve({ owner: "ownerA", repo: "repoA", id: "prompt-1" }),
		});

		expect(metadata).toEqual({ title: "Prompt · ownerA/repoA" });
		expect(promptStore.getPromptRequestForRepo).not.toHaveBeenCalled();
	});

	it("returns a generic title for private repos without loading the prompt title", async () => {
		githubModule.getOctokit.mockResolvedValue({
			repos: {
				get: vi.fn().mockResolvedValue({
					data: { private: true, permissions: { pull: true } },
				}),
			},
		});

		const { generateMetadata } = await import("./[id]/page");
		const metadata = await generateMetadata({
			params: Promise.resolve({ owner: "ownerA", repo: "repoA", id: "prompt-1" }),
		});

		expect(metadata).toEqual({ title: "Prompt · ownerA/repoA" });
		expect(promptStore.getPromptRequestForRepo).not.toHaveBeenCalled();
	});

	it("returns the prompt title for accessible public repos", async () => {
		mockOctokitWithRepoAccess();

		const { generateMetadata } = await import("./[id]/page");
		const metadata = await generateMetadata({
			params: Promise.resolve({ owner: "ownerA", repo: "repoA", id: "prompt-1" }),
		});

		expect(metadata).toEqual({ title: "Test prompt · ownerA/repoA" });
		expect(promptStore.getPromptRequestForRepo).toHaveBeenCalledWith(
			"prompt-1",
			"ownerA",
			"repoA",
		);
	});
});
