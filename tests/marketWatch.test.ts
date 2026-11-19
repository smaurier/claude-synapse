import { describe, it, expect } from "vitest";
import {
  fetchRepoStats,
  watchKnownCompetitors,
  searchForNewCompetitors,
  searchForNewCompetitorsMultiQuery,
  runMarketWatch,
  isDormant,
  truncateDescription,
  formatMarketWatchReport,
  DORMANT_AFTER_DAYS,
} from "../src/commands/marketWatch.js";

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

  // Backlog A (16/08/2026, item codé le 01/11/2026) : contrairement à pushedAt
  // (surfacé pour un jugement humain, jamais filtré — voir le test ci-dessus), un
  // fork n'est jamais un concurrent indépendant : c'est une copie d'un projet déjà
  // présent ailleurs dans le rapport (connu ou lui-même remonté par la recherche).
  // Du bruit objectif, pas un jugement de valeur — exclu, pas seulement annoté.
  it("excludes forks from search results, unlike an ordinary unrelated repo", async () => {
    const results = await searchForNewCompetitors(
      "claude memory",
      fakeFetch({
        "search/repositories": {
          status: 200,
          body: {
            items: [
              { full_name: "someone/fork-of-popular-tool", stargazers_count: 12, html_url: "x", fork: true },
              { full_name: "someone-new/claude-mind", stargazers_count: 5, html_url: "y", fork: false },
            ],
          },
        },
      }),
    );
    expect(results).toEqual([{ fullName: "someone-new/claude-mind", stars: 5, url: "y" }]);
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

// 19/11/2026 : tri du rapport (items 1 à 5 de la veille du 19/11). Le rapport
// réel affichait claude-brain deux fois, aucune description (impossible de
// trier sans cliquer), aucun point de comparaison pour Synapse lui-même, et
// aucun signal pour les dépôts en sommeil.
function recordingFetch(responses: Record<string, { status: number; body: unknown }>): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const inner = fakeFetch(responses);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(input.toString());
    return inner(input, init);
  }) as typeof fetch;
  return { fetchImpl, urls };
}

describe("watchKnownCompetitors : dédoublonnage", () => {
  it("ne suit qu'une fois un dépôt présent à la fois dans la liste de base et dans les sources ajoutées, casse comprise", async () => {
    const { fetchImpl, urls } = recordingFetch({
      "toroleapinc/claude-brain": { status: 200, body: { stargazers_count: 95, html_url: "x" } },
    });
    const results = await watchKnownCompetitors(fetchImpl, ["toroleapinc/claude-brain", "ToroLeapInc/Claude-Brain"]);
    expect(results.filter((r) => r.fullName.toLowerCase() === "toroleapinc/claude-brain")).toHaveLength(1);
    expect(urls.filter((u) => u.toLowerCase().endsWith("/repos/toroleapinc/claude-brain"))).toHaveLength(1);
  });
});

describe("liste connue : ajouts du 19/11", () => {
  it("suit hippo-memory, recall, total-recall et claude-db sans qu'on les ajoute à la main", async () => {
    const { fetchImpl, urls } = recordingFetch({});
    await watchKnownCompetitors(fetchImpl);
    for (const repo of ["kitfunso/hippo-memory", "raiyanyahya/recall", "davegoldblatt/total-recall", "Avijit07x/claude-db"]) {
      expect(urls).toContain(`https://api.github.com/repos/${repo}`);
    }
  });
});

describe("descriptions", () => {
  it("fetchRepoStats remonte la description du dépôt", async () => {
    const stats = await fetchRepoStats(
      "example/repo",
      fakeFetch({ "example/repo": { status: 200, body: { stargazers_count: 1, html_url: "u", pushed_at: "p", description: "Une mémoire." } } }),
    );
    expect(stats?.description).toBe("Une mémoire.");
  });

  it("searchForNewCompetitors remonte la description de chaque résultat", async () => {
    const results = await searchForNewCompetitors(
      "q",
      fakeFetch({
        "search/repositories": {
          status: 200,
          body: { items: [{ full_name: "a/b", stargazers_count: 2, html_url: "u", pushed_at: "p", description: "Autre mémoire." }] },
        },
      }),
    );
    expect(results[0]?.description).toBe("Autre mémoire.");
  });
});

describe("searchForNewCompetitors : exclusion insensible à la casse", () => {
  it("n'affiche pas comme nouveau un dépôt connu écrit avec une autre casse", async () => {
    const results = await searchForNewCompetitors(
      "q",
      fakeFetch({
        "search/repositories": { status: 200, body: { items: [{ full_name: "Toroleapinc/Claude-Brain", stargazers_count: 95, html_url: "x" }] } },
      }),
      ["toroleapinc/claude-brain"],
    );
    expect(results).toEqual([]);
  });
});

describe("runMarketWatch : Synapse comme référence", () => {
  it("met Synapse à part, hors des concurrents et hors des nouveaux entrants", async () => {
    const report = await runMarketWatch(
      fakeFetch({
        "repos/smaurier/claude-synapse": { status: 200, body: { stargazers_count: 1, html_url: "s", pushed_at: "2026-11-18T00:00:00Z" } },
        "search/repositories": {
          status: 200,
          body: { items: [{ full_name: "smaurier/claude-synapse", stargazers_count: 1, html_url: "s", pushed_at: "2026-11-18T00:00:00Z" }] },
        },
      }),
    );
    expect(report.self).toEqual({ fullName: "smaurier/claude-synapse", stars: 1, url: "s", pushedAt: "2026-11-18T00:00:00Z" });
    expect(report.possibleNewEntrants).toEqual([]);
    expect(report.knownCompetitors.map((r) => r.fullName)).not.toContain("smaurier/claude-synapse");
  });

  it("ne suit pas Synapse comme concurrent même si l'utilisateur l'a ajouté aux sources", async () => {
    const synapse = { status: 200, body: { stargazers_count: 1, html_url: "s", pushed_at: "2026-11-18T00:00:00Z" } };
    const report = await runMarketWatch(
      fakeFetch({
        // Les deux casses répondent : sans exclusion, la source ajoutée serait
        // bien récupérée et finirait dans les concurrents (le test peut rougir).
        "repos/smaurier/claude-synapse": synapse,
        "repos/Smaurier/Claude-Synapse": synapse,
        "search/repositories": { status: 200, body: { items: [] } },
      }),
      ["Smaurier/Claude-Synapse"],
    );
    expect(report.knownCompetitors.map((r) => r.fullName.toLowerCase())).not.toContain("smaurier/claude-synapse");
  });

  it("rend self à null si le dépôt de Synapse est injoignable, sans faire échouer le rapport", async () => {
    const report = await runMarketWatch(fakeFetch({ "search/repositories": { status: 200, body: { items: [] } } }));
    expect(report.self).toBeNull();
  });
});

describe("isDormant", () => {
  const now = new Date("2026-11-19T12:00:00Z");

  it(`est vrai au-delà de ${DORMANT_AFTER_DAYS} jours sans push`, () => {
    expect(isDormant("2026-06-09T01:00:30Z", now)).toBe(true);
  });

  it(`est faux à ${DORMANT_AFTER_DAYS} jours pile ou moins`, () => {
    expect(isDormant("2026-08-21T12:00:00Z", now)).toBe(false);
    expect(isDormant("2026-11-18T00:00:00Z", now)).toBe(false);
  });

  it("est faux quand la date est absente ou illisible, plutôt que d'affirmer un sommeil non prouvé", () => {
    expect(isDormant(undefined, now)).toBe(false);
    expect(isDormant("pas une date", now)).toBe(false);
  });
});

describe("truncateDescription", () => {
  it("laisse intacte une description courte", () => {
    expect(truncateDescription("Une mémoire.", 20)).toBe("Une mémoire.");
  });

  it("coupe une description longue sur une frontière de mot et le signale", () => {
    expect(truncateDescription("One memory for every agent you will ever use", 20)).toBe("One memory for every…");
  });

  it("aplatit les retours à la ligne et les espaces multiples", () => {
    expect(truncateDescription("Ligne un\n\n  ligne   deux", 80)).toBe("Ligne un ligne deux");
  });
});

describe("formatMarketWatchReport", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const report = {
    self: {
      fullName: "smaurier/claude-synapse",
      stars: 1,
      url: "https://github.com/smaurier/claude-synapse",
      pushedAt: "2026-11-18T20:24:31Z",
      description: "Don't sync, link.",
    },
    knownCompetitors: [
      {
        fullName: "zilliztech/memsearch",
        stars: 2905,
        url: "https://github.com/zilliztech/memsearch",
        pushedAt: "2026-11-19T07:05:58Z",
        description: "A persistent, unified memory layer.",
      },
      { fullName: "toroleapinc/claude-brain", stars: 95, url: "https://github.com/toroleapinc/claude-brain", pushedAt: "2026-06-09T01:00:30Z" },
    ],
    possibleNewEntrants: [
      {
        fullName: "kitfunso/hippo-memory",
        stars: 794,
        url: "https://github.com/kitfunso/hippo-memory",
        pushedAt: "2026-11-19T10:45:36Z",
        description: "One memory for every agent.",
      },
    ],
  };
  const lines = (): string[] => formatMarketWatchReport(report, now);
  const text = (): string => lines().join("\n");

  it("ouvre sur la ligne de référence de Synapse", () => {
    expect(lines()[0]).toContain("smaurier/claude-synapse");
    expect(lines()[0]).toContain("1★");
  });

  it("affiche la description sous chaque dépôt qui en a une", () => {
    expect(text()).toContain("A persistent, unified memory layer.");
    expect(text()).toContain("One memory for every agent.");
  });

  it("marque en sommeil un dépôt sans push depuis plus de 90 jours, et seulement lui", () => {
    expect(lines().find((l) => l.includes("toroleapinc/claude-brain"))).toMatch(/en sommeil/);
    expect(lines().find((l) => l.includes("zilliztech/memsearch"))).not.toMatch(/en sommeil/);
  });

  it("n'écrit aucun tiret cadratin", () => {
    expect(text()).not.toContain("—");
  });

  it("annonce l'absence de nouvel entrant plutôt qu'une section vide", () => {
    expect(formatMarketWatchReport({ ...report, possibleNewEntrants: [] }, now).join("\n")).toContain("Aucun nouvel entrant détecté.");
  });

  it("signale quand la référence Synapse est indisponible", () => {
    expect(formatMarketWatchReport({ ...report, self: null }, now)[0]).toMatch(/Synapse.*indisponible/);
  });
});
