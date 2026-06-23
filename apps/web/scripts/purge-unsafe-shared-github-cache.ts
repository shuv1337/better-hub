#!/usr/bin/env bun

import { redis } from "../src/lib/redis";

const UNSAFE_SHARED_CACHE_PATTERNS = [
	"ghpub:repo_*",
	"ghpub:issue*",
	"ghpub:pull_request*",
	"ghpub:org:*",
	"ghpub:org_repos:*",
	"ghpub:org_members:*",
	"ghpub:file_content:*",
	"ghpub:repo_contents:*",
];

const dryRun = process.argv.includes("--dry-run");

async function scanAndDelete(pattern: string): Promise<number> {
	let cursor = 0;
	let matched = 0;

	do {
		const result = await redis.scan(cursor, { match: pattern, count: 100 });
		const keys = result[1];
		cursor = Number(result[0]);
		matched += keys.length;

		if (!dryRun && keys.length > 0) {
			await redis.del(...keys);
		}
	} while (cursor !== 0);

	return matched;
}

let total = 0;

for (const pattern of UNSAFE_SHARED_CACHE_PATTERNS) {
	const count = await scanAndDelete(pattern);
	total += count;
	console.log(
		`${dryRun ? "Would delete" : "Deleted"} ${count} shared GitHub cache keys matching ${pattern}`,
	);
}

console.log(
	`${dryRun ? "Would delete" : "Deleted"} ${total} unsafe shared GitHub cache keys total`,
);
