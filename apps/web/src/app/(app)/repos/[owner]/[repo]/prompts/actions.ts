"use server";

import { revalidatePath } from "next/cache";

import { getServerSession } from "@/lib/auth";
import { getOctokit, extractRepoPermissions } from "@/lib/github";
import {
	createPromptRequest,
	updatePromptRequestStatus,
	acceptPromptRequest as acceptPromptRequestStore,
	deletePromptRequest,
	getPromptRequestForRepo,
	createPromptRequestComment,
	deletePromptRequestComment,
	getPromptRequestComment,
	addPromptRequestReaction,
	removePromptRequestReaction,
	listPromptRequestReactions,
	type PromptReactionContent,
} from "@/lib/prompt-request-store";

type RepoReadAccess = {
	session: NonNullable<Awaited<ReturnType<typeof getServerSession>>>;
	repoData: Parameters<typeof extractRepoPermissions>[0];
};

async function assertRepoReadAccess(owner: string, repo: string): Promise<RepoReadAccess> {
	const session = await getServerSession();
	if (!session?.user?.id) throw new Error("Unauthorized");

	const octokit = await getOctokit();
	if (!octokit) throw new Error("Unauthorized");

	try {
		const { data: repoData } = await octokit.repos.get({ owner, repo });
		return { session, repoData };
	} catch {
		throw new Error("Unauthorized");
	}
}

async function loadPromptForRepo(id: string, owner: string, repo: string) {
	const pr = await getPromptRequestForRepo(id, owner, repo);
	if (!pr) throw new Error("Prompt request not found");
	return pr;
}

function assertMaintainerFromRepoData(access: RepoReadAccess) {
	const perms = extractRepoPermissions(access.repoData);
	if (!perms.push && !perms.admin && !perms.maintain) {
		throw new Error("Not authorized");
	}
	return access.session;
}

async function assertAuthorOrMaintainer(promptUserId: string, access: RepoReadAccess) {
	if (access.session.user.id === promptUserId) return access.session;
	return assertMaintainerFromRepoData(access);
}

async function assertMaintainer(owner: string, repo: string) {
	const access = await assertRepoReadAccess(owner, repo);
	return assertMaintainerFromRepoData(access);
}

export async function acceptPromptRequestAction(owner: string, repo: string, id: string) {
	const session = await assertMaintainer(owner, repo);
	const pr = await loadPromptForRepo(id, owner, repo);
	if (pr.status !== "open") throw new Error("Prompt request is not open");

	await acceptPromptRequestStore(id, session.user.id, session.user.name);
	revalidatePath(`/repos/${owner}/${repo}/prompts`);
	revalidatePath(`/repos/${owner}/${repo}/prompts/${id}`);
}

export async function createPromptRequestAction(owner: string, repo: string, body: string) {
	const { session } = await assertRepoReadAccess(owner, repo);

	// Auto-generate title from first line of body
	const firstLine =
		body
			.split("\n")[0]
			?.replace(/^#+\s*/, "")
			.trim() || "Untitled prompt";
	const title = firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;

	const pr = await createPromptRequest(
		session.user.id,
		session.githubUser?.login ?? null,
		session.user.name,
		session.user.image ?? null,
		owner,
		repo,
		title,
		body,
	);
	revalidatePath(`/repos/${owner}/${repo}/prompts`);
	return pr;
}

export async function closePromptRequest(owner: string, repo: string, id: string) {
	const access = await assertRepoReadAccess(owner, repo);
	const pr = await loadPromptForRepo(id, owner, repo);

	await assertAuthorOrMaintainer(pr.userId, access);

	await updatePromptRequestStatus(id, "closed");
	revalidatePath(`/repos/${owner}/${repo}/prompts`);
	revalidatePath(`/repos/${owner}/${repo}/prompts/${id}`);
}

export async function reopenPromptRequest(owner: string, repo: string, id: string) {
	const access = await assertRepoReadAccess(owner, repo);
	const pr = await loadPromptForRepo(id, owner, repo);
	if (pr.status !== "closed") throw new Error("Prompt request is not closed");

	await assertAuthorOrMaintainer(pr.userId, access);

	await updatePromptRequestStatus(id, "open");
	revalidatePath(`/repos/${owner}/${repo}/prompts`);
	revalidatePath(`/repos/${owner}/${repo}/prompts/${id}`);
}

export async function deletePromptRequestAction(owner: string, repo: string, id: string) {
	const access = await assertRepoReadAccess(owner, repo);
	const pr = await loadPromptForRepo(id, owner, repo);

	await assertAuthorOrMaintainer(pr.userId, access);

	await deletePromptRequest(id);
	revalidatePath(`/repos/${owner}/${repo}/prompts`);
}

export async function addPromptComment(
	owner: string,
	repo: string,
	promptRequestId: string,
	body: string,
) {
	const { session } = await assertRepoReadAccess(owner, repo);
	await loadPromptForRepo(promptRequestId, owner, repo);

	const comment = await createPromptRequestComment(
		promptRequestId,
		session.user.id,
		session.githubUser?.login ?? null,
		session.user.name,
		session.user.image ?? "",
		body,
	);

	revalidatePath(`/repos/${owner}/${repo}/prompts/${promptRequestId}`);
	return comment;
}

export async function deletePromptComment(
	owner: string,
	repo: string,
	commentId: string,
	promptRequestId: string,
) {
	const { session } = await assertRepoReadAccess(owner, repo);

	const comment = await getPromptRequestComment(commentId);
	if (!comment) throw new Error("Comment not found");
	if (comment.promptRequestId !== promptRequestId) {
		throw new Error("Not authorized to delete this comment");
	}
	if (comment.userId !== session.user.id) {
		throw new Error("Not authorized to delete this comment");
	}

	await loadPromptForRepo(promptRequestId, owner, repo);

	await deletePromptRequestComment(commentId);
	revalidatePath(`/repos/${owner}/${repo}/prompts/${promptRequestId}`);
}

export async function togglePromptReaction(
	owner: string,
	repo: string,
	promptRequestId: string,
	content: PromptReactionContent,
) {
	const { session } = await assertRepoReadAccess(owner, repo);
	await loadPromptForRepo(promptRequestId, owner, repo);

	const existing = await listPromptRequestReactions(promptRequestId);
	const userReaction = existing.find(
		(r) => r.userId === session.user.id && r.content === content,
	);

	if (userReaction) {
		await removePromptRequestReaction(promptRequestId, session.user.id, content);
	} else {
		await addPromptRequestReaction(
			promptRequestId,
			session.user.id,
			session.githubUser?.login ?? null,
			session.user.name,
			session.user.image ?? "",
			content,
		);
	}

	revalidatePath(`/repos/${owner}/${repo}/prompts/${promptRequestId}`);
}

export async function getPromptReactions(owner: string, repo: string, promptRequestId: string) {
	await assertRepoReadAccess(owner, repo);
	await loadPromptForRepo(promptRequestId, owner, repo);
	return listPromptRequestReactions(promptRequestId);
}
