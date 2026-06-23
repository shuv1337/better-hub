import { Octokit } from "@octokit/rest";
import { symmetricDecrypt } from "better-auth/crypto";
import { headers } from "next/headers";
import { cache } from "react";
import { getServerSession } from "./auth";
import type { $Session } from "./auth";
import { prisma } from "./db";

export interface GitHubAuthContext {
	userId: string;
	token: string;
	octokit: Octokit;
	forceRefresh: boolean;
	githubUser: $Session["githubUser"];
}

function getForceRefreshFromHeaders(reqHeaders: Headers): boolean {
	const cacheControl = reqHeaders.get("cache-control") ?? "";
	const pragma = reqHeaders.get("pragma") ?? "";
	return (
		cacheControl.includes("no-cache") ||
		cacheControl.includes("max-age=0") ||
		pragma.includes("no-cache")
	);
}

export const getRequestGitHubAuthContext = cache(async (): Promise<GitHubAuthContext | null> => {
	const session = await getServerSession();
	const reqHeaders = await headers();
	if (!session) return null;
	const token = session.githubUser.accessToken;

	return {
		userId: session.user.id,
		token,
		octokit: new Octokit({ auth: token }),
		forceRefresh: getForceRefreshFromHeaders(reqHeaders),
		githubUser: session.githubUser,
	};
});

async function decryptStoredGitHubToken(encryptedToken: string): Promise<string | null> {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) return null;
	try {
		return await symmetricDecrypt({ key: secret, data: encryptedToken });
	} catch {
		return null;
	}
}

export async function resolveGitHubAuthContextForUser(
	userId: string,
): Promise<GitHubAuthContext | null> {
	const account = await prisma.account.findFirst({
		where: {
			userId,
			providerId: "github",
			accessToken: { not: null },
		},
		orderBy: { updatedAt: "desc" },
		select: { accessToken: true },
	});

	if (!account?.accessToken) return null;

	const token = await decryptStoredGitHubToken(account.accessToken);
	if (!token) return null;

	const octokit = new Octokit({ auth: token });
	let githubUser: GitHubAuthContext["githubUser"] = {
		accessToken: token,
	} as GitHubAuthContext["githubUser"];
	try {
		const response = await octokit.users.getAuthenticated();
		githubUser = {
			...response.data,
			accessToken: token,
		} as GitHubAuthContext["githubUser"];
	} catch {
		// Profile lookup is useful for parity with request auth, but warming can proceed without it.
	}

	return {
		userId,
		token,
		octokit,
		forceRefresh: false,
		githubUser,
	};
}
