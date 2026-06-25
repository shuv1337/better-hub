import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
	userSettings: {
		findUnique: vi.fn(),
		upsert: vi.fn(),
		update: vi.fn(),
	},
}));

vi.mock("./db", () => ({ prisma }));

import { decryptSettingSecret, encryptSettingSecret } from "./user-settings-secrets";
import { getUserSettings, updateUserSettings } from "./user-settings-store";

const baseRow = {
	userId: "user-1",
	displayName: null,
	theme: "system",
	colorTheme: "default",
	colorMode: "dark",
	ghostModel: "auto",
	useOwnApiKey: false,
	openrouterApiKey: null,
	githubPat: null,
	codeThemeLight: "vitesse-light",
	codeThemeDark: "vitesse-black",
	codeFont: "default",
	codeFontSize: 13,
	onboardingDone: false,
	updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("user settings secret codec", () => {
	const originalSecret = process.env.BETTER_AUTH_SECRET;

	beforeEach(() => {
		process.env.BETTER_AUTH_SECRET = "test-settings-secret-key-32chars!";
	});

	afterEach(() => {
		if (originalSecret === undefined) {
			delete process.env.BETTER_AUTH_SECRET;
		} else {
			process.env.BETTER_AUTH_SECRET = originalSecret;
		}
	});

	it("encrypts and decrypts a round trip", async () => {
		const encrypted = await encryptSettingSecret("sk-or-test-key");
		expect(encrypted).toMatch(/^enc:v1:/);

		const decrypted = await decryptSettingSecret(encrypted, "openrouterApiKey");
		expect(decrypted).toBe("sk-or-test-key");
	});

	it("returns plaintext values for backward compatibility", async () => {
		const decrypted = await decryptSettingSecret("plain-key", "openrouterApiKey");
		expect(decrypted).toBe("plain-key");
	});

	it("returns null when decrypting encrypted value without BETTER_AUTH_SECRET", async () => {
		const encrypted = await encryptSettingSecret("sk-or-test-key");
		delete process.env.BETTER_AUTH_SECRET;

		const decrypted = await decryptSettingSecret(encrypted, "openrouterApiKey");
		expect(decrypted).toBeNull();
	});

	it("throws when encrypting without BETTER_AUTH_SECRET", async () => {
		delete process.env.BETTER_AUTH_SECRET;

		await expect(encryptSettingSecret("sk-or-test-key")).rejects.toThrow(
			"BETTER_AUTH_SECRET is not configured",
		);
	});
});

describe("user settings store", () => {
	const originalSecret = process.env.BETTER_AUTH_SECRET;

	beforeEach(() => {
		process.env.BETTER_AUTH_SECRET = "test-settings-secret-key-32chars!";
		prisma.userSettings.findUnique.mockReset();
		prisma.userSettings.upsert.mockReset();
		prisma.userSettings.update.mockReset();
	});

	afterEach(() => {
		if (originalSecret === undefined) {
			delete process.env.BETTER_AUTH_SECRET;
		} else {
			process.env.BETTER_AUTH_SECRET = originalSecret;
		}
	});

	it("decrypts plaintext secrets on read", async () => {
		prisma.userSettings.findUnique.mockResolvedValue({
			...baseRow,
			openrouterApiKey: "plain-key",
			githubPat: "ghp_plain",
		});

		const settings = await getUserSettings("user-1");

		expect(settings.openrouterApiKey).toBe("plain-key");
		expect(settings.githubPat).toBe("ghp_plain");
	});

	it("decrypts encrypted secrets stored in prisma on read", async () => {
		const encryptedKey = await encryptSettingSecret("sk-or-test-key");
		const encryptedPat = await encryptSettingSecret("ghp_test");

		prisma.userSettings.findUnique.mockResolvedValue({
			...baseRow,
			openrouterApiKey: encryptedKey,
			githubPat: encryptedPat,
		});

		const settings = await getUserSettings("user-1");

		expect(settings.openrouterApiKey).toBe("sk-or-test-key");
		expect(settings.githubPat).toBe("ghp_test");
	});

	it("writes encrypted secrets to prisma", async () => {
		prisma.userSettings.upsert.mockResolvedValue(baseRow);
		prisma.userSettings.update.mockImplementation(async ({ data }) => ({
			...baseRow,
			...data,
		}));

		await updateUserSettings("user-1", {
			openrouterApiKey: "sk-or-test-key",
			githubPat: "ghp_test",
		});

		expect(prisma.userSettings.update).toHaveBeenCalledWith({
			where: { userId: "user-1" },
			data: expect.objectContaining({
				openrouterApiKey: expect.stringMatching(/^enc:v1:/),
				githubPat: expect.stringMatching(/^enc:v1:/),
			}),
		});

		const updateData = prisma.userSettings.update.mock.calls[0]?.[0]?.data as {
			openrouterApiKey: string;
			githubPat: string;
		};
		expect(updateData.openrouterApiKey).not.toBe("sk-or-test-key");
		expect(updateData.githubPat).not.toBe("ghp_test");
	});
});
