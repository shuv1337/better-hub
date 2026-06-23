import { Prisma } from "../generated/prisma/client";
import { prisma } from "./db";
import { redis } from "./redis";

export type GithubSyncJobStatus = "pending" | "running" | "failed";

export interface GithubCacheEntry<T> {
	data: T;
	syncedAt: string;
	etag: string | null;
}

export interface GithubSyncJob<TPayload = unknown> {
	id: number;
	userId: string;
	dedupeKey: string;
	jobType: string;
	payload: TPayload;
	attempts: number;
}

const MAX_ATTEMPTS = 8;
const RUNNING_JOB_TIMEOUT_MS = 10 * 60 * 1000;

function redisKey(userId: string, cacheKey: string): string {
	return `gh:${userId}:${cacheKey}`;
}

function parseJson<T>(value: string): T {
	return JSON.parse(value) as T;
}

export async function getGithubCacheEntry<T>(
	userId: string,
	cacheKey: string,
): Promise<GithubCacheEntry<T> | null> {
	const entry = await redis.get<GithubCacheEntry<T>>(redisKey(userId, cacheKey));
	return entry ?? null;
}

export async function upsertGithubCacheEntry<T>(
	userId: string,
	cacheKey: string,
	_cacheType: string,
	data: T,
	etag: string | null = null,
) {
	const now = new Date().toISOString();
	const entry: GithubCacheEntry<T> = { data, syncedAt: now, etag };
	await redis.set(redisKey(userId, cacheKey), entry);
}

export async function touchGithubCacheEntrySyncedAt(userId: string, cacheKey: string) {
	const key = redisKey(userId, cacheKey);
	const entry = await redis.get<GithubCacheEntry<unknown>>(key);
	if (!entry) return;
	entry.syncedAt = new Date().toISOString();
	await redis.set(key, entry, { keepTtl: true });
}

// ── Shared (cross-user) cache for public GitHub data ──

function sharedRedisKey(cacheKey: string): string {
	return `ghpub:${cacheKey}`;
}

export async function getSharedCacheEntry<T>(
	cacheKey: string,
): Promise<GithubCacheEntry<T> | null> {
	const entry = await redis.get<GithubCacheEntry<T>>(sharedRedisKey(cacheKey));
	return entry ?? null;
}

export async function upsertSharedCacheEntry<T>(
	cacheKey: string,
	data: T,
	etag: string | null = null,
) {
	const now = new Date().toISOString();
	const entry: GithubCacheEntry<T> = { data, syncedAt: now, etag };
	await redis.set(sharedRedisKey(cacheKey), entry, { ex: 300 });
}

export async function touchSharedCacheEntrySyncedAt(cacheKey: string) {
	const key = sharedRedisKey(cacheKey);
	const entry = await redis.get<GithubCacheEntry<unknown>>(key);
	if (!entry) return;
	entry.syncedAt = new Date().toISOString();
	await redis.set(key, entry, { ex: 300 });
}

export async function deleteGithubCacheByPrefix(userId: string, prefix: string) {
	const pattern = `gh:${userId}:${prefix}*`;
	let cursor = 0;
	do {
		const result = await redis.scan(cursor, { match: pattern, count: 100 });
		const keys = result[1];
		cursor = Number(result[0]);
		if (keys.length > 0) {
			await redis.del(...keys);
		}
	} while (cursor !== 0);
}

export async function deleteSharedCacheByPrefix(prefix: string) {
	const pattern = `ghpub:${prefix}*`;
	let cursor = 0;
	do {
		const result = await redis.scan(cursor, { match: pattern, count: 100 });
		const keys = result[1];
		cursor = Number(result[0]);
		if (keys.length > 0) {
			await redis.del(...keys);
		}
	} while (cursor !== 0);
}

export async function enqueueGithubSyncJob<TPayload>(
	userId: string,
	dedupeKey: string,
	jobType: string,
	payload: TPayload,
) {
	const now = new Date().toISOString();
	const payloadJson = JSON.stringify(payload);
	const existing = await prisma.githubSyncJob.findUnique({
		where: { userId_dedupeKey: { userId, dedupeKey } },
		select: { id: true, status: true },
	});

	if (existing?.status === "running") return;

	if (existing?.status === "failed") {
		await prisma.githubSyncJob.updateMany({
			where: { id: existing.id, status: "failed" },
			data: {
				jobType,
				payloadJson,
				status: "pending",
				attempts: 0,
				nextAttemptAt: now,
				startedAt: null,
				lastError: null,
				updatedAt: now,
			},
		});
		return;
	}

	if (existing?.status === "pending") {
		await prisma.githubSyncJob.updateMany({
			where: { id: existing.id, status: "pending" },
			data: {
				jobType,
				payloadJson,
				nextAttemptAt: now,
				updatedAt: now,
			},
		});
		return;
	}

	try {
		await prisma.githubSyncJob.create({
			data: {
				userId,
				dedupeKey,
				jobType,
				payloadJson,
				status: "pending",
				attempts: 0,
				nextAttemptAt: now,
				createdAt: now,
				updatedAt: now,
			},
		});
	} catch (e) {
		if (isKnownPrismaRequestError(e) && (e.code === "P2002" || e.code === "P2025")) {
			// P2002: unique constraint violation (concurrent insert race)
			// P2025: record not found during create/delete race
			return;
		}
		throw e;
	}
}

function isKnownPrismaRequestError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
	if (error instanceof Prisma.PrismaClientKnownRequestError) return true;
	return (
		typeof error === "object" &&
		error !== null &&
		typeof (error as { code?: unknown }).code === "string"
	);
}

async function recoverTimedOutRunningJobs(userId: string) {
	const threshold = new Date(Date.now() - RUNNING_JOB_TIMEOUT_MS).toISOString();
	const now = new Date().toISOString();

	await prisma.githubSyncJob.updateMany({
		where: {
			userId,
			status: "running",
			startedAt: { not: null, lte: threshold },
		},
		data: { status: "pending", startedAt: null, updatedAt: now },
	});
}

export async function claimDueGithubSyncJobs<TPayload>(
	userId: string,
	limit = 5,
): Promise<GithubSyncJob<TPayload>[]> {
	const now = new Date().toISOString();

	await recoverTimedOutRunningJobs(userId);

	const rows = await prisma.githubSyncJob.findMany({
		where: {
			userId,
			status: "pending",
			nextAttemptAt: { lte: now },
		},
		orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
		take: limit,
	});

	if (rows.length === 0) return [];

	const claimed: GithubSyncJob<TPayload>[] = [];

	for (const row of rows) {
		const result = await prisma.githubSyncJob.updateMany({
			where: { id: row.id, status: "pending" },
			data: { status: "running", startedAt: now, updatedAt: now },
		});

		if (result.count === 0) continue;

		claimed.push({
			id: row.id,
			userId: row.userId,
			dedupeKey: row.dedupeKey,
			jobType: row.jobType,
			payload: parseJson<TPayload>(row.payloadJson),
			attempts: row.attempts,
		});
	}

	return claimed;
}

export async function markGithubSyncJobSucceeded(id: number) {
	await prisma.githubSyncJob.delete({ where: { id } });
}

export async function markGithubSyncJobFailed(id: number, attempts: number, error: string) {
	const nextAttempts = attempts + 1;
	const now = Date.now();
	const status: GithubSyncJobStatus = nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";

	const backoffSeconds = Math.min(15 * 60, Math.max(5, 2 ** nextAttempts));
	const nextAttemptAt = new Date(now + backoffSeconds * 1000).toISOString();
	const nowIso = new Date(now).toISOString();

	await prisma.githubSyncJob.update({
		where: { id },
		data: {
			status,
			attempts: nextAttempts,
			nextAttemptAt,
			startedAt: null,
			lastError: error.slice(0, 2000),
			updatedAt: nowIso,
		},
	});
}
