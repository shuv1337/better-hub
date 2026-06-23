"use server";

import { getCompareLinkStatus, type CompareLinkStatus } from "@/lib/github";
import {
	warmOverviewCIStatus,
	warmOverviewCommitActivity,
	warmOverviewEvents,
	warmOverviewIssues,
	warmOverviewPRs,
	type OverviewIssueItem,
	type OverviewPRItem,
	type OverviewRepoEvent,
} from "@/lib/repo-overview-cache-warmer";
import type { CheckStatus, CommitActivityWeek } from "@/lib/github";

export type { OverviewIssueItem, OverviewPRItem, OverviewRepoEvent };

export async function fetchOverviewPRs(owner: string, repo: string): Promise<OverviewPRItem[]> {
	return warmOverviewPRs(owner, repo);
}

export async function fetchOverviewIssues(
	owner: string,
	repo: string,
): Promise<OverviewIssueItem[]> {
	return warmOverviewIssues(owner, repo);
}

export async function fetchOverviewCommitActivity(
	owner: string,
	repo: string,
): Promise<CommitActivityWeek[]> {
	return warmOverviewCommitActivity(owner, repo);
}

export async function fetchOverviewEvents(
	owner: string,
	repo: string,
): Promise<OverviewRepoEvent[]> {
	return warmOverviewEvents(owner, repo);
}

export async function fetchOverviewCIStatus(
	owner: string,
	repo: string,
	defaultBranch: string,
): Promise<CheckStatus | null> {
	return warmOverviewCIStatus(owner, repo, defaultBranch);
}

export async function fetchCompareLinkStatus(params: {
	baseOwner: string;
	baseRepo: string;
	headOwner: string;
	headRepo: string;
	baseBranch: string;
	headBranch: string;
}): Promise<CompareLinkStatus | null> {
	return getCompareLinkStatus(params);
}
