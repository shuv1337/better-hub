import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getRequestGitHubAuthContext } from "@/lib/github-auth-context";
import {
	acquireGithubCacheWarmLock,
	releaseGithubCacheWarmLock,
	storeGithubCacheWarmResult,
} from "@/lib/github-cache-lock";
import {
	createGithubCacheWarmSkippedResult,
	warmPersonalGithubCache,
	type GithubCacheWarmOptions,
	type GithubCacheWarmRun,
} from "@/lib/github-cache-warmer";
import { inngest } from "@/lib/inngest";

const warmRequestSchema = z
	.object({
		mode: z.enum(["quick", "full"]).default("quick"),
		maxRepos: z.number().int().min(1).max(500).optional(),
		refreshStaleOnly: z.boolean().optional(),
	})
	.strict();

function isInlineWarmEnabled(): boolean {
	return (
		process.env.GITHUB_CACHE_WARM_INLINE === "1" ||
		process.env.NODE_ENV !== "production"
	);
}

function isProductionWarmEnabled(): boolean {
	return process.env.GITHUB_CACHE_WARM_PROD_ENABLED === "1";
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
	return { ok: true, options: parsed.data };
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
	try {
		const authCtx = await getRequestGitHubAuthContext();
		if (!authCtx || authCtx.userId !== params.userId) {
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
	} finally {
		await releaseGithubCacheWarmLock(params.userId, params.runId);
	}
}

export async function POST(request: Request) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
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
