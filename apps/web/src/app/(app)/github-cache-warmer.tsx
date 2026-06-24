"use client";

import { useEffect } from "react";

export const GITHUB_CACHE_LAST_WARM_KEY = "better-hub:github-cache:last-warm";
export const GITHUB_CACHE_WARM_CHANNEL = "better-hub:github-cache:warm";
export const GITHUB_CACHE_WARM_THROTTLE_MS = 6 * 60 * 60 * 1000;
export const GITHUB_CACHE_WARM_RETRY_DELAY_MS = 30 * 1000;
export const GITHUB_CACHE_BROWSER_WARM_MAX_REPOS = 25;

type WarmBroadcastMessage = { type: "warm-started"; at: number };

export function isGithubCacheBrowserWarmEnabled(): boolean {
	return process.env.NEXT_PUBLIC_GITHUB_CACHE_WARM_ENABLED === "1";
}

export function shouldStartGithubCacheWarm(
	lastWarmValue: string | null,
	nowMs: number,
	throttleMs = GITHUB_CACHE_WARM_THROTTLE_MS,
): boolean {
	if (!lastWarmValue) return true;
	const lastWarmMs = Number(lastWarmValue);
	return !Number.isFinite(lastWarmMs) || nowMs - lastWarmMs >= throttleMs;
}

function readLastWarm(): string | null {
	try {
		return window.localStorage.getItem(GITHUB_CACHE_LAST_WARM_KEY);
	} catch {
		return null;
	}
}

function writeLastWarm(timestampMs: number) {
	try {
		window.localStorage.setItem(GITHUB_CACHE_LAST_WARM_KEY, String(timestampMs));
	} catch {
		// Warming is opportunistic; storage failures should not affect app rendering.
	}
}

function postWarmStarted(channel: BroadcastChannel | null, timestampMs: number) {
	channel?.postMessage({ type: "warm-started", at: timestampMs });
}

function isWarmBroadcastMessage(value: unknown): value is WarmBroadcastMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "warm-started" &&
		typeof (value as { at?: unknown }).at === "number"
	);
}

export type GithubCacheWarmPostOutcome = "accepted" | "skipped" | "failed";

export function classifyGithubCacheWarmResponse(
	responseOk: boolean,
	accepted: boolean | undefined,
): GithubCacheWarmPostOutcome {
	if (!responseOk) return "failed";
	if (accepted === true) return "accepted";
	return "skipped";
}

async function postWarmRequest(): Promise<GithubCacheWarmPostOutcome> {
	const response = await fetch("/api/github-cache/warm", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			mode: "quick",
			maxRepos: GITHUB_CACHE_BROWSER_WARM_MAX_REPOS,
			refreshStaleOnly: true,
		}),
	});
	let accepted: boolean | undefined;
	if (response.ok) {
		const body: unknown = await response.json().catch(() => null);
		if (body && typeof body === "object" && "accepted" in body) {
			accepted = (body as { accepted?: boolean }).accepted;
		}
	}
	return classifyGithubCacheWarmResponse(response.ok, accepted);
}

export function GithubCacheWarmer() {
	useEffect(() => {
		if (!isGithubCacheBrowserWarmEnabled()) return;

		let closed = false;
		const channel =
			typeof BroadcastChannel === "undefined"
				? null
				: new BroadcastChannel(GITHUB_CACHE_WARM_CHANNEL);

		channel?.addEventListener("message", (event: MessageEvent) => {
			if (!isWarmBroadcastMessage(event.data)) return;
			writeLastWarm(event.data.at);
		});

		const startWarm = async (retryNetworkFailure: boolean) => {
			const now = Date.now();
			if (!retryNetworkFailure) {
				if (!shouldStartGithubCacheWarm(readLastWarm(), now)) return;
			}

			try {
				const outcome = await postWarmRequest();
				if (outcome === "accepted") {
					const at = Date.now();
					writeLastWarm(at);
					postWarmStarted(channel, at);
				} else if (outcome === "failed") {
					if (closed || retryNetworkFailure) return;
					window.setTimeout(() => {
						if (!closed) void startWarm(true);
					}, GITHUB_CACHE_WARM_RETRY_DELAY_MS);
				}
			} catch {
				if (closed || retryNetworkFailure) return;
				window.setTimeout(() => {
					if (!closed) void startWarm(true);
				}, GITHUB_CACHE_WARM_RETRY_DELAY_MS);
			}
		};

		void startWarm(false);

		return () => {
			closed = true;
			channel?.close();
		};
	}, []);

	return null;
}
