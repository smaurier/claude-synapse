/**
 * /synapse-market-watch (périmètre IN) — report only, GitHub API,
 * unauthenticated (same reasoning as hubVisibility.ts: a read-only public
 * check, no token worth the setup friction). Tracks the 6 known direct
 * competitors identified during the design study (13/08), plus whatever the
 * user has added via SharedConfig.marketWatchExtraSources (14/08 — the
 * hardcoded list below can't grow without a new plugin version otherwise),
 * and searches for new ones matching relevant keywords — never acts on what
 * it finds, just reports.
 */
export interface RepoStats {
    fullName: string;
    stars: number;
    url: string;
    /** ISO timestamp of the last push — surfaced so a human can judge
     *  staleness themselves (16/08). Stars-only ranking buries active-but-new
     *  projects behind popular-but-abandoned ones; auto-filtering on this
     *  would risk hiding a legitimately good, just infrequently-updated
     *  project, so it's reported, not filtered. */
    pushedAt: string;
}
export declare function fetchRepoStats(fullName: string, fetchImpl?: typeof fetch): Promise<RepoStats | null>;
export declare function watchKnownCompetitors(fetchImpl?: typeof fetch, extraSources?: readonly string[]): Promise<RepoStats[]>;
export declare function searchForNewCompetitors(query: string, fetchImpl?: typeof fetch, excludeFullNames?: readonly string[]): Promise<RepoStats[]>;
/**
 * Runs several query variants and merges the results, deduplicated by repo.
 * Added 16/08: a single fixed keyword query misses projects that describe
 * themselves with different wording — proven on Synapse's own repo, invisible
 * to "claude code memory sync plugin" until its description literally said
 * "code" and "plugin". Includes a topic-based query (GitHub's `topic:`
 * qualifier) as a second, independent discovery axis: it matches on a
 * repo's actual topic tags rather than free-text wording, catching properly-
 * tagged projects a keyword phrasing would miss entirely.
 */
export declare function searchForNewCompetitorsMultiQuery(queries: readonly string[], fetchImpl?: typeof fetch, excludeFullNames?: readonly string[]): Promise<RepoStats[]>;
export interface MarketWatchReport {
    knownCompetitors: RepoStats[];
    possibleNewEntrants: RepoStats[];
}
export declare function runMarketWatch(fetchImpl?: typeof fetch, extraSources?: readonly string[]): Promise<MarketWatchReport>;
