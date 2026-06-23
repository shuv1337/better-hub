import { redis } from "./redis";
import type { GithubCacheWarmResult } from "./github-cache-warmer";

export const GITHUB_CACHE_WARM_LOCK_TTL_SECONDS = 15 * 60;
export const GITHUB_CACHE_WARM_RESULT_TTL_SECONDS = 24 * 60 * 60;

const COMPARE_AND_DELETE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("DEL", KEYS[1])
end
return 0
`;

type RedisEval = {
	eval: (script: string, keys: string[], args: string[]) => Promise<number | string>;
};

export function githubCacheWarmLockKey(userId: string): string {
	return `github-cache-warm-lock:${userId}`;
}

export function githubCacheWarmLastResultKey(userId: string): string {
	return `github-cache-warm-last:${userId}`;
}

export function getGithubCacheWarmLockTtlSeconds(): number {
	const value = Number(process.env["GITHUB_CACHE_WARM_LOCK_TTL_SECONDS"]);
	return Number.isFinite(value) && value > 0 ? value : GITHUB_CACHE_WARM_LOCK_TTL_SECONDS;
}

export async function acquireGithubCacheWarmLock(
	userId: string,
	runId: string,
	ttlSeconds = getGithubCacheWarmLockTtlSeconds(),
): Promise<{ acquired: boolean; lockKey: string }> {
	const lockKey = githubCacheWarmLockKey(userId);
	const result = await redis.set(lockKey, runId, { ex: ttlSeconds, nx: true });
	return { acquired: result === "OK", lockKey };
}

export async function isGithubCacheWarmLockHeld(userId: string, runId: string): Promise<boolean> {
	return (await redis.get<string>(githubCacheWarmLockKey(userId))) === runId;
}

export async function getGithubCacheWarmLockStatus(userId: string): Promise<{
	locked: boolean;
	lockKey: string;
	runId: string | null;
}> {
	const lockKey = githubCacheWarmLockKey(userId);
	const runId = await redis.get<string>(lockKey);
	return { locked: Boolean(runId), lockKey, runId: runId ?? null };
}

export async function renewGithubCacheWarmLock(
	userId: string,
	runId: string,
	ttlSeconds = getGithubCacheWarmLockTtlSeconds(),
): Promise<boolean> {
	const lockKey = githubCacheWarmLockKey(userId);
	if ((await redis.get<string>(lockKey)) !== runId) return false;
	await redis.set(lockKey, runId, { ex: ttlSeconds });
	return true;
}

export async function releaseGithubCacheWarmLock(userId: string, runId: string): Promise<boolean> {
	const result = await (redis as unknown as RedisEval).eval(
		COMPARE_AND_DELETE_SCRIPT,
		[githubCacheWarmLockKey(userId)],
		[runId],
	);
	return Number(result) === 1;
}

export async function storeGithubCacheWarmResult(
	userId: string,
	result: GithubCacheWarmResult,
	ttlSeconds = GITHUB_CACHE_WARM_RESULT_TTL_SECONDS,
): Promise<void> {
	await redis.set(githubCacheWarmLastResultKey(userId), result, { ex: ttlSeconds });
}

export async function getGithubCacheWarmResult(
	userId: string,
): Promise<GithubCacheWarmResult | null> {
	return redis.get<GithubCacheWarmResult>(githubCacheWarmLastResultKey(userId));
}
