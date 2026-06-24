import { getServerSession } from "@/lib/auth";
import { getGithubCacheDebugAccess } from "@/lib/github-cache-debug-access";
import { getGithubCacheWarmLockStatus, getGithubCacheWarmResult } from "@/lib/github-cache-lock";
import {
	getRepoCacheStatus,
	type RepoCacheStatus,
	type RepoCacheStatusEntry,
} from "@/lib/github-cache-status";
import { getGithubSyncJobStatusSummary } from "@/lib/github-sync-store";
import { notFound } from "next/navigation";
import { GithubCacheWarmControls } from "./warm-controls";

type SearchParams = Record<string, string | string[] | undefined>;

function singleParam(value: string | string[] | undefined): string {
	return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function formatDate(value: string | null | undefined): string {
	if (!value) return "n/a";
	return value;
}

function formatAge(ageMs: number | null): string {
	if (ageMs === null) return "n/a";
	const seconds = Math.floor(ageMs / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}

function statusClass(status: RepoCacheStatusEntry["status"]): string {
	if (status === "fresh") return "text-emerald-600";
	if (status === "present") return "text-sky-600";
	if (status === "stale") return "text-amber-600";
	return "text-muted-foreground";
}

function CacheStatusTable({ title, entries }: { title: string; entries: RepoCacheStatusEntry[] }) {
	return (
		<section className="space-y-3">
			<h2 className="text-base font-semibold">{title}</h2>
			<div className="overflow-x-auto border border-border">
				<table className="w-full min-w-[820px] text-left text-sm">
					<thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
						<tr>
							<th className="px-3 py-2 font-medium">
								Target
							</th>
							<th className="px-3 py-2 font-medium">
								Status
							</th>
							<th className="px-3 py-2 font-medium">
								Class
							</th>
							<th className="px-3 py-2 font-medium">
								Scope
							</th>
							<th className="px-3 py-2 font-medium">
								Age
							</th>
							<th className="px-3 py-2 font-medium">
								Synced
							</th>
							<th className="px-3 py-2 font-medium">
								Key
							</th>
						</tr>
					</thead>
					<tbody>
						{entries.map((entry) => (
							<tr
								key={entry.cacheKey}
								className="border-b border-border/60"
							>
								<td className="px-3 py-2 font-medium">
									{entry.cacheType}
								</td>
								<td
									className={`px-3 py-2 font-medium ${statusClass(entry.status)}`}
								>
									{entry.status}
								</td>
								<td className="px-3 py-2">
									{entry.dataClass}
								</td>
								<td className="px-3 py-2">
									{entry.scope}
								</td>
								<td className="px-3 py-2">
									{formatAge(entry.ageMs)}
								</td>
								<td className="px-3 py-2">
									{formatDate(entry.syncedAt)}
								</td>
								<td className="max-w-[360px] truncate px-3 py-2 font-mono text-xs text-muted-foreground">
									{entry.cacheKey}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}

function SyncJobSummary({
	summary,
}: {
	summary: Awaited<ReturnType<typeof getGithubSyncJobStatusSummary>>;
}) {
	return (
		<section className="space-y-3">
			<h2 className="text-base font-semibold">Sync Jobs</h2>
			<div className="grid gap-3 sm:grid-cols-3">
				{(["pending", "running", "failed"] as const).map((status) => (
					<div key={status} className="border border-border p-3">
						<div className="text-xs uppercase text-muted-foreground">
							{status}
						</div>
						<div className="text-2xl font-semibold">
							{summary.counts[status]}
						</div>
					</div>
				))}
			</div>
			{summary.failed.length > 0 && (
				<div className="overflow-x-auto border border-border">
					<table className="w-full min-w-[760px] text-left text-sm">
						<thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
							<tr>
								<th className="px-3 py-2 font-medium">
									ID
								</th>
								<th className="px-3 py-2 font-medium">
									Type
								</th>
								<th className="px-3 py-2 font-medium">
									Attempts
								</th>
								<th className="px-3 py-2 font-medium">
									Updated
								</th>
								<th className="px-3 py-2 font-medium">
									Error
								</th>
							</tr>
						</thead>
						<tbody>
							{summary.failed.map((job) => (
								<tr
									key={job.id}
									className="border-b border-border/60"
								>
									<td className="px-3 py-2">
										{job.id}
									</td>
									<td className="px-3 py-2">
										{job.jobType}
									</td>
									<td className="px-3 py-2">
										{job.attempts}
									</td>
									<td className="px-3 py-2">
										{job.updatedAt}
									</td>
									<td className="max-w-[420px] truncate px-3 py-2 text-muted-foreground">
										{job.lastError ??
											"n/a"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

function LastWarmSummary({
	result,
}: {
	result: Awaited<ReturnType<typeof getGithubCacheWarmResult>>;
}) {
	return (
		<section className="space-y-3">
			<h2 className="text-base font-semibold">Last Warm</h2>
			{result ? (
				<div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
					<div className="border border-border p-3">
						<div className="text-xs uppercase text-muted-foreground">
							Run
						</div>
						<div className="truncate font-mono text-xs">
							{result.runId}
						</div>
					</div>
					<div className="border border-border p-3">
						<div className="text-xs uppercase text-muted-foreground">
							Source
						</div>
						<div className="font-medium">{result.source}</div>
					</div>
					<div className="border border-border p-3">
						<div className="text-xs uppercase text-muted-foreground">
							Repos
						</div>
						<div className="font-medium">
							{result.warmedRepos}/{result.selectedRepos}{" "}
							warmed
						</div>
					</div>
					<div className="border border-border p-3">
						<div className="text-xs uppercase text-muted-foreground">
							Result
						</div>
						<div className="font-medium">
							{result.skippedReason ?? "completed"}
						</div>
					</div>
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					No warm result has been stored.
				</p>
			)}
		</section>
	);
}

export default async function GithubCacheDebugPage({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const session = await getServerSession();
	const access = getGithubCacheDebugAccess(session);
	if (!access.allowed) notFound();

	const params = await searchParams;
	const owner = singleParam(params.owner).trim();
	const repo = singleParam(params.repo).trim();
	const userId = session?.user.id ?? "";
	const githubLogin =
		typeof session?.githubUser?.login === "string" ? session.githubUser.login : "n/a";

	const [lockStatus, lastWarm, globalSyncJobs] = await Promise.all([
		getGithubCacheWarmLockStatus(userId),
		getGithubCacheWarmResult(userId),
		getGithubSyncJobStatusSummary(userId),
	]);
	const repoStatus: RepoCacheStatus | null =
		owner && repo ? await getRepoCacheStatus(userId, owner, repo) : null;

	return (
		<main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-8">
			<header className="space-y-4">
				<div>
					<h1 className="text-2xl font-semibold">
						GitHub Cache Debug
					</h1>
					<p className="text-sm text-muted-foreground">
						Inspect cache health and warm runs for the current
						authenticated user.
					</p>
				</div>
				<div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
					<div className="border border-border p-3">
						<div className="text-xs uppercase text-muted-foreground">
							User ID
						</div>
						<div className="truncate font-mono text-xs">
							{userId}
						</div>
					</div>
					<div className="border border-border p-3">
						<div className="text-xs uppercase text-muted-foreground">
							GitHub Login
						</div>
						<div className="font-medium">{githubLogin}</div>
					</div>
					<div className="border border-border p-3">
						<div className="text-xs uppercase text-muted-foreground">
							Warm Lock
						</div>
						<div className="font-medium">
							{lockStatus.locked ? "locked" : "open"}
						</div>
					</div>
					<div className="border border-border p-3">
						<div className="text-xs uppercase text-muted-foreground">
							Lock Owner
						</div>
						<div className="truncate font-mono text-xs">
							{lockStatus.runId ?? "n/a"}
						</div>
					</div>
				</div>
			</header>

			<section className="space-y-3">
				<h2 className="text-base font-semibold">Manual Warm</h2>
				<GithubCacheWarmControls />
			</section>

			<LastWarmSummary result={lastWarm} />
			<SyncJobSummary summary={globalSyncJobs} />

			<section className="space-y-3">
				<h2 className="text-base font-semibold">Repo Status</h2>
				<form className="flex flex-wrap gap-3">
					<input
						name="owner"
						defaultValue={owner}
						placeholder="owner"
						className="h-9 min-w-48 border border-border bg-background px-3 text-sm"
					/>
					<input
						name="repo"
						defaultValue={repo}
						placeholder="repo"
						className="h-9 min-w-48 border border-border bg-background px-3 text-sm"
					/>
					<button
						type="submit"
						className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
					>
						Inspect
					</button>
				</form>
				{repoStatus ? (
					<div className="space-y-6">
						<div className="text-sm text-muted-foreground">
							Generated {repoStatus.generatedAt} for{" "}
							{repoStatus.owner}/{repoStatus.repo}
						</div>
						<SyncJobSummary summary={repoStatus.syncJobs} />
						<CacheStatusTable
							title="GitHub Response Cache Targets"
							entries={repoStatus.github}
						/>
						<CacheStatusTable
							title="UI Cache Targets"
							entries={repoStatus.ui}
						/>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						Enter an owner and repo to inspect descriptor-backed
						cache targets.
					</p>
				)}
			</section>
		</main>
	);
}
