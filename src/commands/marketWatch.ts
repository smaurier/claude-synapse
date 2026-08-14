/**
 * /synapse-market-watch (périmètre IN) — report only, GitHub API,
 * unauthenticated (same reasoning as hubVisibility.ts: a read-only public
 * check, no token worth the setup friction). Tracks the 6 known direct
 * competitors identified during the design study (13/08) and searches for
 * new ones matching relevant keywords — never acts on what it finds, just
 * reports.
 */

const KNOWN_COMPETITORS = [
  "toroleapinc/claude-brain",
  "renefichtmueller/claude-sync",
  "rohithzr/claudebase",
  "lopadova/claude-mem-sync",
  "hmennen90/claude-device-sync",
  "yang1997434/claude-cowork",
];

export interface RepoStats {
  fullName: string;
  stars: number;
  url: string;
}

export async function fetchRepoStats(fullName: string, fetchImpl: typeof fetch = fetch): Promise<RepoStats | null> {
  const res = await fetchImpl(`https://api.github.com/repos/${fullName}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status !== 200) return null;
  const data = (await res.json()) as { stargazers_count: number; html_url: string };
  return { fullName, stars: data.stargazers_count, url: data.html_url };
}

export async function watchKnownCompetitors(fetchImpl: typeof fetch = fetch): Promise<RepoStats[]> {
  const results = await Promise.all(KNOWN_COMPETITORS.map((name) => fetchRepoStats(name, fetchImpl)));
  return results.filter((r): r is RepoStats => r !== null).sort((a, b) => b.stars - a.stars);
}

export async function searchForNewCompetitors(
  query: string,
  fetchImpl: typeof fetch = fetch,
  excludeFullNames: readonly string[] = KNOWN_COMPETITORS,
): Promise<RepoStats[]> {
  const res = await fetchImpl(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status !== 200) return [];
  const data = (await res.json()) as { items: { full_name: string; stargazers_count: number; html_url: string }[] };
  return data.items
    .filter((item) => !excludeFullNames.includes(item.full_name))
    .map((item) => ({ fullName: item.full_name, stars: item.stargazers_count, url: item.html_url }));
}

export interface MarketWatchReport {
  knownCompetitors: RepoStats[];
  possibleNewEntrants: RepoStats[];
}

export async function runMarketWatch(fetchImpl: typeof fetch = fetch): Promise<MarketWatchReport> {
  const [knownCompetitors, possibleNewEntrants] = await Promise.all([
    watchKnownCompetitors(fetchImpl),
    searchForNewCompetitors("claude code memory sync plugin", fetchImpl),
  ]);
  return { knownCompetitors, possibleNewEntrants };
}
