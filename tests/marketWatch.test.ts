import { describe, it, expect } from "vitest";
import { fetchRepoStats, watchKnownCompetitors, searchForNewCompetitors, runMarketWatch } from "../src/commands/marketWatch.js";

function fakeFetch(responses: Record<string, { status: number; body: unknown }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = input.toString();
    const match = Object.entries(responses).find(([pattern]) => url.includes(pattern));
    const response = match?.[1] ?? { status: 404, body: {} };
    return { status: response.status, json: async () => response.body } as Response;
  }) as typeof fetch;
}

describe("fetchRepoStats", () => {
  it("returns stats for an existing repo", async () => {
    const stats = await fetchRepoStats(
      "example/repo",
      fakeFetch({ "example/repo": { status: 200, body: { stargazers_count: 42, html_url: "https://github.com/example/repo" } } }),
    );
    expect(stats).toEqual({ fullName: "example/repo", stars: 42, url: "https://github.com/example/repo" });
  });

  it("returns null for a repo that 404s", async () => {
    const stats = await fetchRepoStats("nope/nope", fakeFetch({}));
    expect(stats).toBeNull();
  });
});

describe("watchKnownCompetitors", () => {
  it("returns stats sorted by stars descending, skipping any that 404", async () => {
    const results = await watchKnownCompetitors(
      fakeFetch({
        "toroleapinc/claude-brain": { status: 200, body: { stargazers_count: 78, html_url: "x" } },
        "renefichtmueller/claude-sync": { status: 200, body: { stargazers_count: 23, html_url: "x" } },
        // the other 4 will 404 via fakeFetch's default — simulates a repo
        // renamed/deleted since the design study, without crashing the report
      }),
    );
    expect(results).toEqual([
      { fullName: "toroleapinc/claude-brain", stars: 78, url: "x" },
      { fullName: "renefichtmueller/claude-sync", stars: 23, url: "x" },
    ]);
  });
});

describe("searchForNewCompetitors", () => {
  it("excludes already-known competitors from search results", async () => {
    const results = await searchForNewCompetitors(
      "claude memory",
      fakeFetch({
        "search/repositories": {
          status: 200,
          body: {
            items: [
              { full_name: "toroleapinc/claude-brain", stargazers_count: 78, html_url: "x" }, // already known
              { full_name: "someone-new/claude-mind", stargazers_count: 5, html_url: "y" },
            ],
          },
        },
      }),
    );
    expect(results).toEqual([{ fullName: "someone-new/claude-mind", stars: 5, url: "y" }]);
  });

  it("returns an empty array rather than throwing on a search failure", async () => {
    expect(await searchForNewCompetitors("x", fakeFetch({}))).toEqual([]);
  });
});

describe("runMarketWatch", () => {
  it("combines known-competitor tracking and new-entrant search into one report", async () => {
    const report = await runMarketWatch(
      fakeFetch({
        "toroleapinc/claude-brain": { status: 200, body: { stargazers_count: 78, html_url: "x" } },
        "search/repositories": { status: 200, body: { items: [] } },
      }),
    );
    expect(report.knownCompetitors).toHaveLength(1);
    expect(report.possibleNewEntrants).toEqual([]);
  });
});
