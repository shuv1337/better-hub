#!/usr/bin/env bun

import { prisma } from "../src/lib/db";
import { encryptSettingSecret } from "../src/lib/user-settings-secrets";

const ENCRYPTED_PREFIX = "enc:v1:";
const dryRun = process.argv.includes("--dry-run");

async function main() {
	const rows = await prisma.userSettings.findMany({
		where: {
			OR: [{ openrouterApiKey: { not: null } }, { githubPat: { not: null } }],
		},
		select: {
			userId: true,
			openrouterApiKey: true,
			githubPat: true,
		},
	});

	let openrouterCandidates = 0;
	let githubPatCandidates = 0;
	let openrouterEncrypted = 0;
	let githubPatEncrypted = 0;

	for (const row of rows) {
		const updates: {
			openrouterApiKey?: string | null;
			githubPat?: string | null;
		} = {};

		if (row.openrouterApiKey && !row.openrouterApiKey.startsWith(ENCRYPTED_PREFIX)) {
			openrouterCandidates += 1;
			if (!dryRun) {
				updates.openrouterApiKey = await encryptSettingSecret(
					row.openrouterApiKey,
				);
				openrouterEncrypted += 1;
			}
		}

		if (row.githubPat && !row.githubPat.startsWith(ENCRYPTED_PREFIX)) {
			githubPatCandidates += 1;
			if (!dryRun) {
				updates.githubPat = await encryptSettingSecret(row.githubPat);
				githubPatEncrypted += 1;
			}
		}

		if (!dryRun && Object.keys(updates).length > 0) {
			await prisma.userSettings.update({
				where: { userId: row.userId },
				data: updates,
			});
		}
	}

	if (dryRun) {
		console.log(
			`Would encrypt ${openrouterCandidates} openrouterApiKey rows and ${githubPatCandidates} githubPat rows`,
		);
	} else {
		console.log(
			`Encrypted ${openrouterEncrypted} openrouterApiKey rows and ${githubPatEncrypted} githubPat rows`,
		);
	}
}

main()
	.catch((error) => {
		console.error("Failed to encrypt user settings secrets");
		console.error(error instanceof Error ? error.message : "Unknown error");
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
