"use server";

import { getOctokit, getGitHubToken } from "@/lib/github";
import {
	fetchRepoReadmeMarkdown,
	getRepoReadmeHtmlCacheFirst,
	warmContributorAvatars,
	warmRepoBranches,
	warmRepoLanguages,
	warmRepoTags,
} from "@/lib/repo-overview-cache-warmer";
import type { BranchRef, ContributorAvatar } from "@/lib/repo-data-cache";

export async function revalidateReadme(
	owner: string,
	repo: string,
	branch: string,
): Promise<string | null> {
	return getRepoReadmeHtmlCacheFirst(owner, repo, branch, null, {
		forceRefresh: true,
		refreshInBackground: false,
	});
}

export async function fetchReadmeMarkdown(
	owner: string,
	repo: string,
	branch: string,
): Promise<string | null> {
	return fetchRepoReadmeMarkdown(owner, repo, branch);
}

export async function revalidateLanguages(
	owner: string,
	repo: string,
): Promise<Record<string, number> | null> {
	return warmRepoLanguages(owner, repo);
}

export async function revalidateContributorAvatars(
	owner: string,
	repo: string,
): Promise<{ avatars: ContributorAvatar[]; totalCount: number } | null> {
	return warmContributorAvatars(owner, repo);
}

export async function revalidateBranches(owner: string, repo: string): Promise<BranchRef[] | null> {
	return warmRepoBranches(owner, repo);
}

export async function revalidateTags(owner: string, repo: string): Promise<BranchRef[] | null> {
	return warmRepoTags(owner, repo);
}

export interface DependentRepo {
	owner: string;
	name: string;
	full_name: string;
	description: string | null;
	stars: number;
	avatar_url: string;
}

export interface UsedByData {
	dependents: DependentRepo[];
	total_count: number;
	package_name: string | null;
}

export async function fetchUsedBy(owner: string, repo: string): Promise<UsedByData | null> {
	const token = await getGitHubToken();
	if (!token) return null;

	try {
		// 1. Detect the package name from package.json
		const octokit = await getOctokit();
		if (!octokit) return null;

		let packageName: string | null = null;
		try {
			const { data } = await octokit.repos.getContent({
				owner,
				repo,
				path: "package.json",
			});
			if ("content" in data) {
				const content = Buffer.from(data.content, "base64").toString(
					"utf-8",
				);
				const pkg = JSON.parse(content);
				packageName = pkg.name || null;
			}
		} catch {
			// No package.json or couldn't parse — try pyproject.toml/setup.py name from repo name
			packageName = repo;
		}

		if (!packageName) return null;

		// 2. Search for repos that depend on this package using code search
		// Search in package.json dependencies for npm packages
		const searchQuery = `"${packageName}" filename:package.json NOT repo:${owner}/${repo}`;
		const res = await fetch(
			`https://api.github.com/search/code?${new URLSearchParams({
				q: searchQuery,
				per_page: "30",
			})}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github+json",
				},
			},
		);

		if (!res.ok) return null;
		const searchData = await res.json();

		// 3. Deduplicate by repo and collect repo info
		const seen = new Set<string>();
		const dependents: DependentRepo[] = [];

		for (const item of searchData.items ?? []) {
			const repoFullName = item.repository?.full_name;
			if (!repoFullName || seen.has(repoFullName)) continue;
			// Skip the source repo itself
			if (repoFullName === `${owner}/${repo}`) continue;
			seen.add(repoFullName);

			dependents.push({
				owner: item.repository.owner?.login ?? "",
				name: item.repository.name ?? "",
				full_name: repoFullName,
				description: item.repository.description ?? null,
				stars: item.repository.stargazers_count ?? 0,
				avatar_url: item.repository.owner?.avatar_url ?? "",
			});
		}

		// Sort by stars descending
		dependents.sort((a, b) => b.stars - a.stars);

		return {
			dependents,
			total_count: searchData.total_count ?? dependents.length,
			package_name: packageName,
		};
	} catch {
		return null;
	}
}
