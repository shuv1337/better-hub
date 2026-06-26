import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
	get: vi.fn(),
	set: vi.fn(),
}));

const createHash = vi.hoisted(() => ({
	createHash: vi.fn(),
}));

const waitUntil = vi.hoisted(() => vi.fn());

const getAuthenticated = vi.hoisted(() => vi.fn());

const OctokitMock = vi.hoisted(() =>
	vi.fn(function (
		this: { users: { getAuthenticated: typeof getAuthenticated } },
		_options: { auth: string },
	) {
		this.users = { getAuthenticated };
	}),
);

vi.mock("./redis", () => ({ redis }));
vi.mock("@better-auth/utils/hash", () => createHash);
vi.mock("@vercel/functions", () => ({ waitUntil }));
vi.mock("@octokit/rest", () => ({ Octokit: OctokitMock }));

const mockUserData = {
	id: 1,
	login: "alice",
	name: "Alice",
};

describe("getOctokitUserData cache keying", () => {
	beforeEach(() => {
		redis.get.mockReset();
		redis.set.mockReset();
		createHash.createHash.mockReset();
		waitUntil.mockReset();
		getAuthenticated.mockReset();
		OctokitMock.mockClear();

		createHash.createHash.mockReturnValue({
			digest: vi.fn().mockResolvedValue("hashed-token"),
		});
		waitUntil.mockImplementation((promise: Promise<unknown>) => promise);
	});

	it("returns cached user data from the hashed key without calling Octokit", async () => {
		redis.get.mockResolvedValue(mockUserData);

		const { getOctokitUserData } = await import("./github-user-cache");
		const result = await getOctokitUserData("raw-github-token");

		expect(redis.get).toHaveBeenCalledWith("github_user:hashed-token");
		expect(OctokitMock).not.toHaveBeenCalled();
		expect(result).toEqual(mockUserData);
	});

	it("fetches GitHub user data on cache miss and writes the hashed key", async () => {
		redis.get.mockResolvedValue(null);
		getAuthenticated.mockResolvedValue({ data: mockUserData });

		const { getOctokitUserData } = await import("./github-user-cache");
		const result = await getOctokitUserData("raw-github-token");

		expect(OctokitMock).toHaveBeenCalledWith({ auth: "raw-github-token" });
		expect(waitUntil).toHaveBeenCalled();
		expect(redis.set).toHaveBeenCalledWith("github_user:hashed-token", mockUserData, {
			ex: 3600,
		});
		expect(result).toEqual(mockUserData);
	});

	it("never uses the raw token in a redis key", async () => {
		redis.get.mockResolvedValue(null);
		getAuthenticated.mockResolvedValue({ data: mockUserData });

		const { getOctokitUserData } = await import("./github-user-cache");
		await getOctokitUserData("raw-github-token");

		const redisKeys = [
			...redis.get.mock.calls.map((call) => String(call[0])),
			...redis.set.mock.calls.map((call) => String(call[0])),
		];
		for (const key of redisKeys) {
			expect(key).not.toContain("raw-github-token");
		}
	});
});
