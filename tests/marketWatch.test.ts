import { describe, it, expect } from "vitest";
import { fetchRepoStats, watchKnownCompetitors, searchForNewCompetitors, searchForNewCompetitorsMultiQuery, runMarketWatch } from "../src/commands/marketWatch.js";

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
      fakeFetch({
        "example/repo": {
          status: 200,
          body: { stargazers_count: 42, html_url: "https://github.com/example/repo", pushed_at: "2026-08-01T00:00:00Z" },
        },
      }),
    );
    expect(stats).toEqual({
      fullName: "example/repo",
      stars: 42,
      url: "https://github.com/example/repo",
      pushedAt: "2026-08-01T00:00:00Z",
    });
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

describe("watchKnownCompetitors — extraSources", () => {
  it("also tracks user-added sources alongside the hardcoded baseline", async () => {
    const results = await watchKnownCompetitors(
      fakeFetch({
        "toroleapinc/claude-brain": { status: 200, body: { stargazers_count: 78, html_url: "x" } },
        "someone/new-source": { status: 200, body: { stargazers_count: 3, html_url: "y" } },
      }),
      ["someone/new-source"],
    );
    expect(results).toEqual([
      { fullName: "toroleapinc/claude-brain", stars: 78, url: "x" },
      { fullName: "someone/new-source", stars: 3, url: "y" },
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

  it("captures pushed_at so staleness can be judged by a human, not auto-filtered", async () => {
    const results = await searchForNewCompetitors(
      "claude memory",
      fakeFetch({
        "search/repositories": {
          status: 200,
          body: { items: [{ full_name: "someone-new/claude-mind", stargazers_count: 5, html_url: "y", pushed_at: "2024-01-01T00:00:00Z" }] },
        },
      }),
    );
    expect(results[0]?.pushedAt).toBe("2024-01-01T00:00:00Z");
  });
});

// Ajouté 16/08 : une seule requête mot-clé fixe ratait des projets dont la
// formulation diffère (prouvé sur claude-synapse lui-même — invisible à
// "claude code memory sync plugin" avant que sa propre description soit
// corrigée). searchForNewCompetitorsMultiQuery lance plusieurs formulations
// + une recherche par topic GitHub (axe indépendant du texte) et fusionne.
describe("searchForNewCompetitorsMultiQuery", () => {
  it("merges results from multiple query variants, deduplicated", async () => {
    const results = await searchForNewCompetitorsMultiQuery(
      ["claude memory sync", "topic:claude-code memory"],
      fakeFetch({
        "q=claude%20memory%20sync": {
          status: 200,
          body: { items: [{ full_name: "found-by/keyword-query", stargazers_count: 5, html_url: "a", pushed_at: "x" }] },
        },
        "q=topic%3Aclaude-code%20memory": {
          status: 200,
          body: {
            items: [
              { full_name: "found-by/topic-query", stargazers_count: 3, html_url: "b", pushed_at: "x" },
              { full_name: "found-by/keyword-query", stargazers_count: 5, html_url: "a", pushed_at: "x" }, // same repo, both queries
            ],
          },
        },
      }),
    );

    expect(results.map((r) => r.fullName).sort()).toEqual(["found-by/keyword-query", "found-by/topic-query"]);
  });

  it("excludes already-known competitors across every query variant", async () => {
    const results = await searchForNewCompetitorsMultiQuery(
      ["query one", "query two"],
      fakeFetch({
        "search/repositories": {
          status: 200,
          body: { items: [{ full_name: "toroleapinc/claude-brain", stargazers_count: 78, html_url: "x", pushed_at: "x" }] },
        },
      }),
      ["toroleapinc/claude-brain"],
    );
    expect(results).toEqual([]);
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

  it("does not re-flag a user-added extra source as a new entrant", async () => {
    const report = await runMarketWatch(
      fakeFetch({
        "someone/added-earlier": { status: 200, body: { stargazers_count: 9, html_url: "z" } },
        "search/repositories": {
          status: 200,
          body: { items: [{ full_name: "someone/added-earlier", stargazers_count: 9, html_url: "z" }] },
        },
      }),
      ["someone/added-earlier"],
    );
    expect(report.knownCompetitors).toEqual([{ fullName: "someone/added-earlier", stars: 9, url: "z" }]);
    expect(report.possibleNewEntrants).toEqual([]);
  });
});
