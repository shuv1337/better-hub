import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getGithubCacheDebugAccess } from "@/lib/github-cache-debug-access";
import { resolveGitHubAuthContextForUser } from "@/lib/github-auth-context";
import {
	acquireGithubCacheWarmLock,
	releaseGithubCacheWarmLock,
	storeGithubCacheWarmResult,
} from "@/lib/github-cache-lock";
import {
	createGithubCacheWarmSkippedResult,
	warmPersonalGithubCache,
	type GithubCacheWarmOptions,
	type GithubCacheWarmResult,
	type GithubCacheWarmRun,
} from "@/lib/github-cache-warmer";
import { inngest } from "@/lib/inngest";

const DEFAULT_API_WARM_MAX_REPOS = 100;
const DEFAULT_API_WARM_CONCURRENCY = 3;

const warmRequestSchema = z
	.object({
		mode: z.enum(["quick", "full"]).default("quick"),
		maxRepos: z.number().int().min(1).max(500).optional(),
		maxConcurrentRepos: z.number().int().min(1).max(10).optional(),
		refreshStaleOnly: z.boolean().optional(),
	})
	.strict();

function envInt(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function withWarmDefaults(options: GithubCacheWarmOptions): GithubCacheWarmOptions {
	return {
		...options,
		maxRepos:
			options.maxRepos ??
			envInt("GITHUB_CACHE_WARM_MAX_REPOS", DEFAULT_API_WARM_MAX_REPOS),
		maxConcurrentRepos:
			options.maxConcurrentRepos ??
			envInt("GITHUB_CACHE_WARM_CONCURRENCY", DEFAULT_API_WARM_CONCURRENCY),
	};
}

function isInlineWarmEnabled(): boolean {
	return process.env.GITHUB_CACHE_WARM_INLINE === "1";
}

function isProductionWarmEnabled(): boolean {
	return process.env.GITHUB_CACHE_WARM_PROD_ENABLED === "1";
}

function warmDisabledDetails() {
	const isProd = process.env.NODE_ENV === "production";
	return {
		message: "GitHub cache warming is disabled by configuration.",
		blockedBy: isProd
			? ["GITHUB_CACHE_WARM_PROD_ENABLED"]
			: ["GITHUB_CACHE_WARM_INLINE", "GITHUB_CACHE_WARM_PROD_ENABLED"],
		remediation: isProd
			? "Set GITHUB_CACHE_WARM_PROD_ENABLED=1 and configure Inngest for production warming."
			: "Set GITHUB_CACHE_WARM_INLINE=1 for local inline warming, or set GITHUB_CACHE_WARM_PROD_ENABLED=1 with Inngest configured.",
	};
}

async function parseWarmOptions(
	request: Request,
): Promise<{ ok: true; options: GithubCacheWarmOptions } | { ok: false; response: Response }> {
	const body = await request.json().catch(() => ({}));
	const parsed = warmRequestSchema.safeParse(body);
	if (!parsed.success) {
		return {
			ok: false,
			response: Response.json(
				{
					error: "Invalid input",
					details: parsed.error.flatten().fieldErrors,
				},
				{ status: 400 },
			),
		};
	}
	return { ok: true, options: withWarmDefaults(parsed.data) };
}

function makeRun(
	runId: string,
	lockKey: string,
	source: GithubCacheWarmRun["source"],
): GithubCacheWarmRun {
	return { runId, source, lockKey, lockAlreadyHeld: true };
}

async function warmInline(params: {
	userId: string;
	runId: string;
	lockKey: string;
	options: GithubCacheWarmOptions;
}): Promise<Response> {
	const run = makeRun(params.runId, params.lockKey, "api-inline");
	const startedAt = Date.now();
	try {
		const authCtx = await resolveGitHubAuthContextForUser(params.userId);
		if (!authCtx) {
			const result = createGithubCacheWarmSkippedResult({
				userId: params.userId,
				run,
				skippedReason: "auth-unavailable",
			});
			await storeGithubCacheWarmResult(params.userId, result);
			return Response.json({
				accepted: false,
				runId: params.runId,
				skippedReason: "auth-unavailable",
			});
		}

		const result = await warmPersonalGithubCache({
			authCtx,
			options: params.options,
			run,
		});
		await storeGithubCacheWarmResult(params.userId, result);
		return Response.json({ accepted: true, runId: params.runId, result });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const failure: GithubCacheWarmResult = {
			userId: params.userId,
			runId: run.runId,
			source: run.source,
			discoveredRepos: 0,
			selectedRepos: 0,
			warmedRepos: 0,
			skippedRepos: 0,
			failedRepos: 1,
			jobsQueued: 0,
			durationMs: Date.now() - startedAt,
			errors: [{ repo: "*", stage: "inline-warm", message }],
		};
		await storeGithubCacheWarmResult(params.userId, failure).catch(() => {});
		return Response.json(
			{
				accepted: false,
				runId: params.runId,
				error: "GitHub cache warm failed",
				message,
			},
			{ status: 500 },
		);
	} finally {
		await releaseGithubCacheWarmLock(params.userId, params.runId);
	}
}

export async function POST(request: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const access = getGithubCacheDebugAccess(session);
	if (!access.allowed) {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}

	const parsed = await parseWarmOptions(request);
	if (!parsed.ok) return parsed.response;

	const userId = session.user.id;
	const runId = crypto.randomUUID();
	const { acquired, lockKey } = await acquireGithubCacheWarmLock(userId, runId);
	if (!acquired) {
		return Response.json({
			accepted: false,
			skippedReason: "already-running",
		});
	}

	if (isInlineWarmEnabled()) {
		return warmInline({ userId, runId, lockKey, options: parsed.options });
	}

	if (!isProductionWarmEnabled()) {
		const disabledDetails = warmDisabledDetails();
		const run = makeRun(runId, lockKey, "inngest");
		const result = createGithubCacheWarmSkippedResult({
			userId,
			run,
			skippedReason: "disabled",
		});
		await storeGithubCacheWarmResult(userId, result);
		await releaseGithubCacheWarmLock(userId, runId);
		return Response.json({
			accepted: false,
			runId,
			skippedReason: "disabled",
			...disabledDetails,
		});
	}

	try {
		await inngest.send({
			name: "github/cache.warm",
			data: {
				userId,
				runId,
				lockKey,
				options: parsed.options,
			},
		});
	} catch (error) {
		await releaseGithubCacheWarmLock(userId, runId);
		return Response.json(
			{
				error: "Failed to queue GitHub cache warm",
				message: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 },
		);
	}

	return Response.json({ accepted: true, runId });
}
