import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PromptList } from "@/components/prompt-request/prompt-list";
import { getOctokit } from "@/lib/github";
import { listPromptRequests } from "@/lib/prompt-request-store";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
	const { owner, repo } = await params;
	return { title: `Prompts · ${owner}/${repo}` };
}

export default async function PromptsPage({
	params,
}: {
	params: Promise<{ owner: string; repo: string }>;
}) {
	const { owner, repo } = await params;

	const octokit = await getOctokit();
	if (!octokit) {
		notFound();
	}

	try {
		await octokit.repos.get({ owner, repo });
	} catch {
		notFound();
	}

	const promptRequests = await listPromptRequests(owner, repo);

	return <PromptList owner={owner} repo={repo} promptRequests={promptRequests} />;
}
