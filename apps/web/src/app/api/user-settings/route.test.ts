import { beforeEach, describe, expect, it, vi } from "vitest";

const authModule = vi.hoisted(() => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

const settingsStore = vi.hoisted(() => ({
	getUserSettings: vi.fn(),
	updateUserSettings: vi.fn(),
}));

const nextHeaders = vi.hoisted(() => ({
	headers: vi.fn(),
}));

vi.mock("@/lib/auth", () => authModule);
vi.mock("@/lib/user-settings-store", () => settingsStore);
vi.mock("next/headers", () => nextHeaders);

const baseSettings = {
	userId: "user-1",
	displayName: null,
	theme: "system",
	colorTheme: "default",
	colorMode: "dark",
	ghostModel: "auto",
	useOwnApiKey: true,
	openrouterApiKey: "sk-or-test-key-1234",
	githubPat: "ghp_testtoken1234",
	codeThemeLight: "vitesse-light",
	codeThemeDark: "vitesse-black",
	codeFont: "default",
	codeFontSize: 13,
	onboardingDone: false,
	updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("user settings API route", () => {
	beforeEach(() => {
		authModule.auth.api.getSession.mockReset();
		settingsStore.getUserSettings.mockReset();
		settingsStore.updateUserSettings.mockReset();
		nextHeaders.headers.mockReset();

		authModule.auth.api.getSession.mockResolvedValue({
			user: { id: "user-1" },
		});
		nextHeaders.headers.mockResolvedValue(new Headers());
	});

	it("GET masks secret fields in the response", async () => {
		settingsStore.getUserSettings.mockResolvedValue(baseSettings);

		const { GET } = await import("./route");
		const response = await GET();
		const body = await response.json();

		expect(body.openrouterApiKey).toBe("****1234");
		expect(body.githubPat).toBe("****1234");
		expect(body.openrouterApiKey).not.toBe(baseSettings.openrouterApiKey);
		expect(body.githubPat).not.toBe(baseSettings.githubPat);
	});

	it("PATCH returns masked secret fields after update", async () => {
		settingsStore.updateUserSettings.mockResolvedValue({
			...baseSettings,
			openrouterApiKey: "sk-or-new-key-9999",
			githubPat: "ghp_newtoken9999",
		});

		const { PATCH } = await import("./route");
		const response = await PATCH(
			new Request("http://localhost/api/user-settings", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					openrouterApiKey: "sk-or-new-key-9999",
					githubPat: "ghp_newtoken9999",
				}),
			}),
		);
		const body = await response.json();

		expect(settingsStore.updateUserSettings).toHaveBeenCalledWith("user-1", {
			openrouterApiKey: "sk-or-new-key-9999",
			githubPat: "ghp_newtoken9999",
		});
		expect(body.openrouterApiKey).toBe("****9999");
		expect(body.githubPat).toBe("****9999");
	});
});
