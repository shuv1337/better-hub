"use server";

import { fetchAndCacheRepoPageData } from "@/lib/github";
import { warmRepoFileTreeForLayout } from "@/lib/repo-overview-cache-warmer";

export async function revalidateRepoPageData(owner: string, repo: string): Promise<void> {
	await fetchAndCacheRepoPageData(owner, repo);
}

export async function revalidateRepoTree(
	owner: string,
	repo: string,
	defaultBranch: string,
): Promise<void> {
	await warmRepoFileTreeForLayout(owner, repo, defaultBranch);
}
