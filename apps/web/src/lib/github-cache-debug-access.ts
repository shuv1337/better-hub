export interface GithubCacheDebugSession {
	user?: {
		id?: string | null;
		role?: string | null;
	} | null;
}

export interface GithubCacheDebugAccess {
	allowed: boolean;
	reason: "admin" | "allowlisted-user" | "dev-debug-enabled" | "not-authorized";
}

function envList(name: string): string[] {
	return (process.env[name] ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

export function getGithubCacheDebugAccess(
	session: GithubCacheDebugSession | null | undefined,
): GithubCacheDebugAccess {
	const userId = session?.user?.id ?? null;
	if (session?.user?.role === "admin") {
		return { allowed: true, reason: "admin" };
	}

	if (userId && envList("GITHUB_CACHE_DEBUG_USER_IDS").includes(userId)) {
		return { allowed: true, reason: "allowlisted-user" };
	}

	if (
		process.env.NODE_ENV !== "production" &&
		process.env.DEBUG_GITHUB_CACHE_ENABLED === "1"
	) {
		return { allowed: true, reason: "dev-debug-enabled" };
	}

	return { allowed: false, reason: "not-authorized" };
}
