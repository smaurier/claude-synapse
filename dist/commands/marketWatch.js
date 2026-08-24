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
const KNOWN_COMPETITORS = [
    "toroleapinc/claude-brain",
    "renefichtmueller/claude-sync",
    "rohithzr/claudebase",
    "lopadova/claude-mem-sync",
    "hmennen90/claude-device-sync",
    "yang1997434/claude-cowork",
    // Ajouté 16/08, trouvé par searchForNewCompetitorsMultiQuery puis lu en
    // profondeur : official Claude Code plugin, markdown comme source de
    // vérité + index vectoriel (Milvus) reconstructible en cache - la même
    // architecture générale que ce projet-ci, à un niveau de traction bien
    // supérieur (2479★, actif). Le plus proche concurrent direct trouvé.
    "zilliztech/memsearch",
    // Ajouté 16/08, même lot : /backup pousse la mémoire locale vers un repo
    // GitHub privé, /recover la restaure sur un nouveau poste - sync-based
    // (copie push/pull), pas link-based, mais meme categorie exacte (memoire
    // cross-machine via un repo git prive) que ce projet-ci, plus petit
    // (132★) mais un point de comparaison direct reel.
    "HelloRuru/claude-memory-engine",
];
export async function fetchRepoStats(fullName, fetchImpl = fetch) {
    const res = await fetchImpl(`https://api.github.com/repos/${fullName}`, {
        headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status !== 200)
        return null;
    const data = (await res.json());
    return { fullName, stars: data.stargazers_count, url: data.html_url, pushedAt: data.pushed_at };
}
export async function watchKnownCompetitors(fetchImpl = fetch, extraSources = []) {
    const all = [...KNOWN_COMPETITORS, ...extraSources];
    const results = await Promise.all(all.map((name) => fetchRepoStats(name, fetchImpl)));
    return results.filter((r) => r !== null).sort((a, b) => b.stars - a.stars);
}
export async function searchForNewCompetitors(query, fetchImpl = fetch, excludeFullNames = KNOWN_COMPETITORS) {
    const res = await fetchImpl(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc`, {
        headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status !== 200)
        return [];
    const data = (await res.json());
    return data.items
        .filter((item) => !excludeFullNames.includes(item.full_name))
        .map((item) => ({ fullName: item.full_name, stars: item.stargazers_count, url: item.html_url, pushedAt: item.pushed_at }));
}
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
export async function searchForNewCompetitorsMultiQuery(queries, fetchImpl = fetch, excludeFullNames = KNOWN_COMPETITORS) {
    const results = await Promise.all(queries.map((q) => searchForNewCompetitors(q, fetchImpl, excludeFullNames)));
    const byFullName = new Map();
    for (const r of results.flat())
        byFullName.set(r.fullName, r);
    return [...byFullName.values()].sort((a, b) => b.stars - a.stars);
}
/**
 * extraSources: user additions from SharedConfig.marketWatchExtraSources
 * (KNOWN_COMPETITORS above is a hardcoded baseline, shipped with the
 * plugin — this is how a user adds one they've spotted without waiting
 * for a new plugin version). Merged into BOTH the tracked list and the
 * new-entrant search's exclusion list, so a manually-added source is
 * tracked, not re-flagged as "new" on every run.
 */
// Curated 16/08 to cover more than one angle of phrasing, plus a topic-based
// query independent of wording entirely. Still not exhaustive — a deeper
// manual review (reading actual READMEs, as done 16/08) remains the more
// reliable method; this is the cheap, fast first pass.
const SEARCH_QUERIES = [
    "claude code memory sync plugin",
    "claude code memory across machines",
    "topic:claude-code-plugin memory",
];
export async function runMarketWatch(fetchImpl = fetch, extraSources = []) {
    const allKnown = [...KNOWN_COMPETITORS, ...extraSources];
    const [knownCompetitors, possibleNewEntrants] = await Promise.all([
        watchKnownCompetitors(fetchImpl, extraSources),
        searchForNewCompetitorsMultiQuery(SEARCH_QUERIES, fetchImpl, allKnown),
    ]);
    return { knownCompetitors, possibleNewEntrants };
}
//# sourceMappingURL=marketWatch.js.map