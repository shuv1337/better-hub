import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, getServerSession, getAuthenticated, symmetricDecrypt, OctokitMock } = vi.hoisted(
	() => {
		const getAuthenticated = vi.fn();
		const OctokitMock = vi.fn(function (
			this: {
				auth: string;
				users: { getAuthenticated: typeof getAuthenticated };
			},
			options: { auth: string },
		) {
			this.auth = options.auth;
			this.users = { getAuthenticated };
		});
		return {
			findFirst: vi.fn(),
			getServerSession: vi.fn(),
			getAuthenticated,
			symmetricDecrypt: vi.fn(),
			OctokitMock,
		};
	},
);

vi.mock("./db", () => ({
	prisma: {
		account: { findFirst },
	},
}));

vi.mock("./auth", () => ({
	getServerSession,
}));

vi.mock("better-auth/crypto", () => ({
	symmetricDecrypt,
}));

vi.mock("@octokit/rest", () => ({
	Octokit: OctokitMock,
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers()),
}));

describe("resolveGitHubAuthContextForUser", () => {
	beforeEach(() => {
		findFirst.mockReset();
		getServerSession.mockReset();
		getAuthenticated.mockReset();
		symmetricDecrypt.mockReset();
		OctokitMock.mockClear();
		process.env.BETTER_AUTH_SECRET = "test-secret";
	});

	it("decrypts the stored GitHub account token and builds an auth context", async () => {
		findFirst.mockResolvedValue({ accessToken: "encrypted-token" });
		symmetricDecrypt.mockResolvedValue("plain-token");
		getAuthenticated.mockResolvedValue({
			data: {
				login: "octo",
				id: 123,
				avatar_url: "https://example.com/avatar.png",
			},
		});

		const { resolveGitHubAuthContextForUser } = await import("./github-auth-context");
		const authCtx = await resolveGitHubAuthContextForUser("user-1");

		expect(findFirst).toHaveBeenCalledWith({
			where: {
				userId: "user-1",
				providerId: "github",
				accessToken: { not: null },
			},
			orderBy: { updatedAt: "desc" },
			select: { accessToken: true },
		});
		expect(symmetricDecrypt).toHaveBeenCalledWith({
			key: "test-secret",
			data: "encrypted-token",
		});
		expect(OctokitMock).toHaveBeenCalledWith({ auth: "plain-token" });
		expect(authCtx).toMatchObject({
			userId: "user-1",
			token: "plain-token",
			forceRefresh: false,
			githubUser: { login: "octo", accessToken: "plain-token" },
		});
	});

	it("returns null when no GitHub account token is available", async () => {
		findFirst.mockResolvedValue(null);

		const { resolveGitHubAuthContextForUser } = await import("./github-auth-context");
		await expect(resolveGitHubAuthContextForUser("user-1")).resolves.toBeNull();
		expect(symmetricDecrypt).not.toHaveBeenCalled();
	});

	it("returns a usable context if profile lookup fails", async () => {
		findFirst.mockResolvedValue({ accessToken: "encrypted-token" });
		symmetricDecrypt.mockResolvedValue("plain-token");
		getAuthenticated.mockRejectedValue(new Error("rate limited"));

		const { resolveGitHubAuthContextForUser } = await import("./github-auth-context");
		const authCtx = await resolveGitHubAuthContextForUser("user-1");

		expect(authCtx).toMatchObject({
			userId: "user-1",
			token: "plain-token",
			githubUser: { accessToken: "plain-token" },
		});
	});
});
