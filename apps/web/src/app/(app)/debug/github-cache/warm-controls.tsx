"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type WarmMode = "quick" | "full";

interface WarmResponse {
	accepted?: boolean;
	runId?: string;
	skippedReason?: string;
	error?: string;
}

export function GithubCacheWarmControls() {
	const router = useRouter();
	const [message, setMessage] = useState<string | null>(null);
	const [pendingMode, setPendingMode] = useState<WarmMode | null>(null);

	async function startWarm(mode: WarmMode) {
		setPendingMode(mode);
		setMessage(null);
		try {
			const response = await fetch("/api/github-cache/warm", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ mode, refreshStaleOnly: mode === "quick" }),
			});
			const data = (await response.json().catch(() => ({}))) as WarmResponse;
			if (!response.ok) {
				setMessage(data.error ?? "Warm request failed");
				return;
			}
			setMessage(
				data.accepted
					? `${mode} warm accepted: ${data.runId ?? "inline"}`
					: `${mode} warm skipped: ${data.skippedReason ?? "unknown"}`,
			);
			router.refresh();
		} catch {
			setMessage("Warm request could not reach the API");
		} finally {
			setPendingMode(null);
		}
	}

	return (
		<div className="flex flex-wrap items-center gap-3">
			<button
				type="button"
				onClick={() => startWarm("quick")}
				disabled={pendingMode !== null}
				className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"
			>
				{pendingMode === "quick" ? "Requesting quick warm" : "Quick warm"}
			</button>
			<button
				type="button"
				onClick={() => startWarm("full")}
				disabled={pendingMode !== null}
				className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"
			>
				{pendingMode === "full" ? "Requesting full warm" : "Full warm"}
			</button>
			{message && <p className="text-sm text-muted-foreground">{message}</p>}
		</div>
	);
}
