import { createHash } from "@better-auth/utils/hash";
import { Octokit } from "@octokit/rest";
import { waitUntil } from "@vercel/functions";

import { redis } from "./redis";

export async function getOctokitUserData(token: string): Promise<Record<string, unknown>> {
	const hash = await createHash("SHA-256", "base64").digest(token);
	const key = `github_user:${hash}`;
	const cached = await redis.get<Record<string, unknown>>(key);
	if (cached) return cached;

	const octokit = new Octokit({ auth: token });
	const githubUser = await octokit.users.getAuthenticated();
	waitUntil(redis.set(key, githubUser.data, { ex: 3600 }));
	return githubUser.data;
}
