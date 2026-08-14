import { describe, it, expect } from "vitest";
import { checkHubVisibility, parseGithubOwnerRepo } from "../src/config/hubVisibility.js";

function fakeFetch(status: number, body: unknown = {}): typeof fetch {
  return (async () =>
    ({
      status,
      json: async () => body,
    }) as Response) as typeof fetch;
}

describe("parseGithubOwnerRepo", () => {
  it("parses an SSH URL", () => {
    expect(parseGithubOwnerRepo("git@github.com:example-user/my-hub.git")).toEqual({
      owner: "example-user",
      repo: "my-hub",
    });
  });

  it("parses an HTTPS URL without .git suffix", () => {
    expect(parseGithubOwnerRepo("https://github.com/example-user/my-hub")).toEqual({
      owner: "example-user",
      repo: "my-hub",
    });
  });

  it("returns null for a non-GitHub host", () => {
    expect(parseGithubOwnerRepo("git@gitlab.com:example-user/my-hub.git")).toBeNull();
  });
});

describe("checkHubVisibility", () => {
  it("reports public when the API returns private: false", async () => {
    const result = await checkHubVisibility(
      "git@github.com:example-user/my-hub.git",
      fakeFetch(200, { private: false }),
    );
    expect(result).toEqual({ checked: true, visibility: "public" });
  });

  it("reports private when the API returns private: true", async () => {
    const result = await checkHubVisibility(
      "git@github.com:example-user/my-hub.git",
      fakeFetch(200, { private: true }),
    );
    expect(result).toEqual({ checked: true, visibility: "private" });
  });

  it("treats a 404 as private (can't distinguish from nonexistent, safe default)", async () => {
    const result = await checkHubVisibility("git@github.com:example-user/my-hub.git", fakeFetch(404));
    expect(result).toEqual({ checked: true, visibility: "private" });
  });

  it("reports checked:false for a non-GitHub host, with a clear reason", async () => {
    const result = await checkHubVisibility("git@gitlab.com:example-user/my-hub.git", fakeFetch(200));
    expect(result.checked).toBe(false);
    if (!result.checked) expect(result.reason).toMatch(/GitHub/);
  });

  it("reports checked:false on network failure rather than throwing", async () => {
    const failingFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await checkHubVisibility("git@github.com:example-user/my-hub.git", failingFetch);
    expect(result.checked).toBe(false);
  });
});
