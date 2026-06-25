import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PromptDetail } from "@/components/prompt-request/prompt-detail";
import { getServerSession } from "@/lib/auth";
import { getOctokit, extractRepoPermissions } from "@/lib/github";
import {
	getPromptRequestForRepo,
	listPromptRequestComments,
	listPromptRequestReactions,
} from "@/lib/prompt-request-store";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ owner: string; repo: string; id: string }>;
}): Promise<Metadata> {
	const { owner, repo, id } = await params;
	const fallbackTitle = { title: `Prompt · ${owner}/${repo}` };

	const octokit = await getOctokit();
	if (!octokit) return fallbackTitle;

	try {
		const { data: repoData } = await octokit.repos.get({ owner, repo });
		if (repoData.private) return fallbackTitle;
	} catch {
		return fallbackTitle;
	}

	const promptRequest = await getPromptRequestForRepo(id, owner, repo);
	if (!promptRequest) return fallbackTitle;
	return { title: `${promptRequest.title} · ${owner}/${repo}` };
}

export default async function PromptDetailPage({
	params,
}: {
	params: Promise<{ owner: string; repo: string; id: string }>;
}) {
	const { owner, repo, id } = await params;
	const session = await getServerSession();

	const octokit = await getOctokit();
	if (!octokit) {
		notFound();
	}

	let repoData;
	try {
		({ data: repoData } = await octokit.repos.get({ owner, repo }));
	} catch {
		notFound();
	}

	const promptRequest = await getPromptRequestForRepo(id, owner, repo);
	if (!promptRequest) {
		notFound();
	}

	const [comments, reactions] = await Promise.all([
		listPromptRequestComments(id),
		listPromptRequestReactions(id),
	]);

	const currentUser = session?.user
		? {
				id: session.user.id,
				login: session.githubUser?.login ?? null,
				name: session.user.name,
				image: session.user.image ?? "",
			}
		: null;

	let isMaintainer = false;
	if (currentUser) {
		const perms = extractRepoPermissions(repoData);
		isMaintainer = perms.push || perms.admin || perms.maintain;
	}

	const canManage = isMaintainer || currentUser?.id === promptRequest.userId;

	return (
		<PromptDetail
			owner={owner}
			repo={repo}
			promptRequest={promptRequest}
			comments={comments}
			reactions={reactions}
			currentUser={currentUser}
			canManage={canManage}
			isMaintainer={isMaintainer}
		/>
	);
}
