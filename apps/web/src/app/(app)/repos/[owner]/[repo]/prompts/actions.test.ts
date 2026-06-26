import { beforeEach, describe, expect, it, vi } from "vitest";

const promptStore = vi.hoisted(() => ({
	createPromptRequest: vi.fn(),
	updatePromptRequestStatus: vi.fn(),
	acceptPromptRequest: vi.fn(),
	deletePromptRequest: vi.fn(),
	getPromptRequestForRepo: vi.fn(),
	createPromptRequestComment: vi.fn(),
	deletePromptRequestComment: vi.fn(),
	getPromptRequestComment: vi.fn(),
	addPromptRequestReaction: vi.fn(),
	removePromptRequestReaction: vi.fn(),
	listPromptRequestReactions: vi.fn(),
}));

const authModule = vi.hoisted(() => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
	getServerSession: vi.fn(),
}));

const githubModule = vi.hoisted(() => ({
	getOctokit: vi.fn(),
	extractRepoPermissions: vi.fn(),
}));

const nextHeaders = vi.hoisted(() => ({
	headers: vi.fn(),
}));

const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prompt-request-store", () => promptStore);
vi.mock("@/lib/auth", () => authModule);
vi.mock("@/lib/github", () => githubModule);
vi.mock("next/headers", () => nextHeaders);
vi.mock("next/cache", () => ({ revalidatePath }));

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

const closedPrompt = { ...mockPrompt, status: "closed" as const };

const mockSession = {
	user: { id: "user-1", name: "Alice", image: "" },
	githubUser: { login: "alice" },
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

function mockInaccessibleRepo() {
	githubModule.getOctokit.mockResolvedValue({
		repos: { get: vi.fn().mockRejectedValue(new Error("404")) },
	});
}

describe("prompt actions", () => {
	beforeEach(() => {
		for (const fn of Object.values(promptStore)) fn.mockReset();
		authModule.auth.api.getSession.mockReset();
		authModule.getServerSession.mockReset();
		githubModule.getOctokit.mockReset();
		githubModule.extractRepoPermissions.mockReset();
		nextHeaders.headers.mockReset();
		revalidatePath.mockReset();

		authModule.getServerSession.mockResolvedValue(mockSession);
		authModule.auth.api.getSession.mockResolvedValue(mockSession);
		nextHeaders.headers.mockResolvedValue(new Headers());
		mockOctokitWithRepoAccess();
	});

	it("addPromptComment rejects when prompt does not belong to route repo", async () => {
		promptStore.getPromptRequestForRepo.mockResolvedValue(null);

		const { addPromptComment } = await import("./actions");

		await expect(
			addPromptComment("ownerB", "repoB", "prompt-1", "hello"),
		).rejects.toThrow("Prompt request not found");
		expect(promptStore.createPromptRequestComment).not.toHaveBeenCalled();
	});

	it("addPromptComment rejects when viewer cannot access repo", async () => {
		mockInaccessibleRepo();

		const { addPromptComment } = await import("./actions");

		await expect(
			addPromptComment("ownerA", "repoA", "prompt-1", "hello"),
		).rejects.toThrow("Unauthorized");
		expect(promptStore.getPromptRequestForRepo).not.toHaveBeenCalled();
		expect(promptStore.createPromptRequestComment).not.toHaveBeenCalled();
	});

	it("addPromptComment succeeds for accessible route repo", async () => {
		promptStore.getPromptRequestForRepo.mockResolvedValue(mockPrompt);
		promptStore.createPromptRequestComment.mockResolvedValue({
			id: "comment-1",
			promptRequestId: "prompt-1",
			userId: "user-1",
			userLogin: "alice",
			userName: "Alice",
			userAvatarUrl: "",
			body: "hello",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});

		const { addPromptComment } = await import("./actions");

		await addPromptComment("ownerA", "repoA", "prompt-1", "hello");

		expect(promptStore.createPromptRequestComment).toHaveBeenCalledWith(
			"prompt-1",
			"user-1",
			"alice",
			"Alice",
			"",
			"hello",
		);
		expect(revalidatePath).toHaveBeenCalledWith("/repos/ownerA/repoA/prompts/prompt-1");
	});

	it("togglePromptReaction rejects when prompt does not belong to route repo", async () => {
		promptStore.getPromptRequestForRepo.mockResolvedValue(null);

		const { togglePromptReaction } = await import("./actions");

		await expect(
			togglePromptReaction("ownerB", "repoB", "prompt-1", "+1"),
		).rejects.toThrow("Prompt request not found");
		expect(promptStore.addPromptRequestReaction).not.toHaveBeenCalled();
		expect(promptStore.removePromptRequestReaction).not.toHaveBeenCalled();
	});

	it("togglePromptReaction rejects when viewer cannot access repo", async () => {
		mockInaccessibleRepo();

		const { togglePromptReaction } = await import("./actions");

		await expect(
			togglePromptReaction("ownerA", "repoA", "prompt-1", "+1"),
		).rejects.toThrow("Unauthorized");
		expect(promptStore.getPromptRequestForRepo).not.toHaveBeenCalled();
		expect(promptStore.addPromptRequestReaction).not.toHaveBeenCalled();
		expect(promptStore.removePromptRequestReaction).not.toHaveBeenCalled();
	});

	it("togglePromptReaction adds reaction on happy path", async () => {
		promptStore.getPromptRequestForRepo.mockResolvedValue(mockPrompt);
		promptStore.listPromptRequestReactions.mockResolvedValue([]);

		const { togglePromptReaction } = await import("./actions");

		await togglePromptReaction("ownerA", "repoA", "prompt-1", "+1");

		expect(promptStore.addPromptRequestReaction).toHaveBeenCalled();
		expect(revalidatePath).toHaveBeenCalledWith("/repos/ownerA/repoA/prompts/prompt-1");
	});

	it("createPromptRequestAction rejects when viewer cannot access repo", async () => {
		mockInaccessibleRepo();

		const { createPromptRequestAction } = await import("./actions");

		await expect(createPromptRequestAction("ownerA", "repoA", "hello")).rejects.toThrow(
			"Unauthorized",
		);
		expect(promptStore.createPromptRequest).not.toHaveBeenCalled();
	});

	it("closePromptRequest rejects when viewer cannot access repo", async () => {
		mockInaccessibleRepo();

		const { closePromptRequest } = await import("./actions");

		await expect(closePromptRequest("ownerA", "repoA", "prompt-1")).rejects.toThrow(
			"Unauthorized",
		);
		expect(promptStore.getPromptRequestForRepo).not.toHaveBeenCalled();
		expect(promptStore.updatePromptRequestStatus).not.toHaveBeenCalled();
	});

	it("reopenPromptRequest rejects when viewer cannot access repo", async () => {
		mockInaccessibleRepo();

		const { reopenPromptRequest } = await import("./actions");

		await expect(reopenPromptRequest("ownerA", "repoA", "prompt-1")).rejects.toThrow(
			"Unauthorized",
		);
		expect(promptStore.getPromptRequestForRepo).not.toHaveBeenCalled();
		expect(promptStore.updatePromptRequestStatus).not.toHaveBeenCalled();
	});

	it("deletePromptRequestAction rejects when viewer cannot access repo", async () => {
		mockInaccessibleRepo();

		const { deletePromptRequestAction } = await import("./actions");

		await expect(
			deletePromptRequestAction("ownerA", "repoA", "prompt-1"),
		).rejects.toThrow("Unauthorized");
		expect(promptStore.getPromptRequestForRepo).not.toHaveBeenCalled();
		expect(promptStore.deletePromptRequest).not.toHaveBeenCalled();
	});

	it("acceptPromptRequestAction rejects when viewer cannot access repo", async () => {
		mockInaccessibleRepo();

		const { acceptPromptRequestAction } = await import("./actions");

		await expect(
			acceptPromptRequestAction("ownerA", "repoA", "prompt-1"),
		).rejects.toThrow("Unauthorized");
		expect(promptStore.getPromptRequestForRepo).not.toHaveBeenCalled();
		expect(promptStore.acceptPromptRequest).not.toHaveBeenCalled();
	});

	it("deletePromptComment rejects when viewer cannot access repo", async () => {
		promptStore.getPromptRequestComment.mockResolvedValue({
			id: "comment-1",
			promptRequestId: "prompt-1",
			userId: "user-1",
			userLogin: "alice",
			userName: "Alice",
			userAvatarUrl: "",
			body: "hello",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		mockInaccessibleRepo();

		const { deletePromptComment } = await import("./actions");

		await expect(
			deletePromptComment("ownerA", "repoA", "comment-1", "prompt-1"),
		).rejects.toThrow("Unauthorized");
		expect(promptStore.deletePromptRequestComment).not.toHaveBeenCalled();
	});

	it("deletePromptComment rejects when comment belongs to a different prompt", async () => {
		promptStore.getPromptRequestComment.mockResolvedValue({
			id: "comment-1",
			promptRequestId: "other-prompt",
			userId: "user-1",
			userLogin: "alice",
			userName: "Alice",
			userAvatarUrl: "",
			body: "hello",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});

		const { deletePromptComment } = await import("./actions");

		await expect(
			deletePromptComment("ownerA", "repoA", "comment-1", "prompt-1"),
		).rejects.toThrow("Not authorized to delete this comment");
		expect(promptStore.deletePromptRequestComment).not.toHaveBeenCalled();
	});

	it("deletePromptComment succeeds when comment belongs to prompt", async () => {
		promptStore.getPromptRequestComment.mockResolvedValue({
			id: "comment-1",
			promptRequestId: "prompt-1",
			userId: "user-1",
			userLogin: "alice",
			userName: "Alice",
			userAvatarUrl: "",
			body: "hello",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		promptStore.getPromptRequestForRepo.mockResolvedValue(mockPrompt);

		const { deletePromptComment } = await import("./actions");

		await deletePromptComment("ownerA", "repoA", "comment-1", "prompt-1");

		expect(promptStore.deletePromptRequestComment).toHaveBeenCalledWith("comment-1");
		expect(revalidatePath).toHaveBeenCalledWith("/repos/ownerA/repoA/prompts/prompt-1");
	});

	it("closePromptRequest uses repo-bound lookup and revalidates", async () => {
		promptStore.getPromptRequestForRepo.mockResolvedValue(mockPrompt);

		const { closePromptRequest } = await import("./actions");

		await closePromptRequest("ownerA", "repoA", "prompt-1");

		expect(promptStore.getPromptRequestForRepo).toHaveBeenCalledWith(
			"prompt-1",
			"ownerA",
			"repoA",
		);
		expect(promptStore.updatePromptRequestStatus).toHaveBeenCalledWith(
			"prompt-1",
			"closed",
		);
		expect(revalidatePath).toHaveBeenCalledWith("/repos/ownerA/repoA/prompts");
	});
});
