/**
 * /synapse-market-watch (périmètre IN) — report only, GitHub API,
 * unauthenticated (same reasoning as hubVisibility.ts: a read-only public
 * check, no token worth the setup friction). Tracks the known direct
 * competitors (6 from the design study of 13/08, grown since), plus whatever the
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
  // Ajoutés 19/11 : remontés comme nouveaux entrants par la veille du jour
  // et lus (descriptions) : mémoire persistante pour Claude Code, voisins
  // directs. hippo-memory pousse « une seule mémoire, lue par tous les
  // agents » : la thèse de Synapse sur l'axe des agents au lieu des machines.
  "kitfunso/hippo-memory",
  "raiyanyahya/recall",
  "davegoldblatt/total-recall",
  "Avijit07x/claude-db",
];

/** Synapse lui-même : affiché en tête comme point de comparaison, jamais
 *  compté parmi les concurrents ni remonté comme nouvel entrant. */
const SELF_REPO = "smaurier/claude-synapse";

/** Au-delà, un dépôt est signalé « en sommeil » dans le rapport. Signalé,
 *  jamais filtré : le sommeil reste un jugement humain (cf. pushedAt). */
export const DORMANT_AFTER_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const DESCRIPTION_MAX_LENGTH = 100;

/** Les noms de dépôts GitHub sont insensibles à la casse. */
function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Dédoublonne sans tenir compte de la casse, garde la première graphie.
 *  Sans ça, un dépôt présent dans la liste de base ET dans
 *  marketWatchExtraSources sortait deux fois (claude-brain, 19/11). */
function uniqueRepos(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
  /** Description GitHub du dépôt (19/11) : c'est elle qui permet de trier un
   *  nouvel entrant sans ouvrir chaque lien. Absente si le dépôt n'en a pas. */
  description?: string;
}

function withDescription(description: string | null | undefined): { description?: string } {
  return description ? { description } : {};
}

export async function fetchRepoStats(fullName: string, fetchImpl: typeof fetch = fetch): Promise<RepoStats | null> {
  const res = await fetchImpl(`https://api.github.com/repos/${fullName}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status !== 200) return null;
  const data = (await res.json()) as { stargazers_count: number; html_url: string; pushed_at: string; description?: string | null };
  return { fullName, stars: data.stargazers_count, url: data.html_url, pushedAt: data.pushed_at, ...withDescription(data.description) };
}

export async function watchKnownCompetitors(
  fetchImpl: typeof fetch = fetch,
  extraSources: readonly string[] = [],
): Promise<RepoStats[]> {
  const all = uniqueRepos([...KNOWN_COMPETITORS, ...extraSources]).filter((name) => !sameRepo(name, SELF_REPO));
  const results = await Promise.all(all.map((name) => fetchRepoStats(name, fetchImpl)));
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
  const data = (await res.json()) as {
    items: { full_name: string; stargazers_count: number; html_url: string; pushed_at: string; fork?: boolean; description?: string | null }[];
  };
  const excluded = new Set(excludeFullNames.map((name) => name.toLowerCase()));
  return data.items
    .filter((item) => !excluded.has(item.full_name.toLowerCase()))
    // Backlog A (16/08, item codé 01/11): a fork is never an independent
    // competitor, it's a copy of a project already counted elsewhere —
    // objective noise, unlike pushedAt below (surfaced for a human to judge,
    // never filtered, because staleness IS a judgment call).
    .filter((item) => !item.fork)
    .map((item) => ({
      fullName: item.full_name,
      stars: item.stargazers_count,
      url: item.html_url,
      pushedAt: item.pushed_at,
      ...withDescription(item.description),
    }));
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
export async function searchForNewCompetitorsMultiQuery(
  queries: readonly string[],
  fetchImpl: typeof fetch = fetch,
  excludeFullNames: readonly string[] = KNOWN_COMPETITORS,
): Promise<RepoStats[]> {
  const results = await Promise.all(queries.map((q) => searchForNewCompetitors(q, fetchImpl, excludeFullNames)));
  const byFullName = new Map<string, RepoStats>();
  for (const r of results.flat()) byFullName.set(r.fullName.toLowerCase(), r);
  return [...byFullName.values()].sort((a, b) => b.stars - a.stars);
}

export interface MarketWatchReport {
  /** Synapse lui-même, pour comparer ; null si son dépôt est injoignable. */
  self: RepoStats | null;
  knownCompetitors: RepoStats[];
  possibleNewEntrants: RepoStats[];
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

export async function runMarketWatch(
  fetchImpl: typeof fetch = fetch,
  extraSources: readonly string[] = [],
): Promise<MarketWatchReport> {
  const excludedFromSearch = [...KNOWN_COMPETITORS, ...extraSources, SELF_REPO];
  const [self, knownCompetitors, possibleNewEntrants] = await Promise.all([
    fetchRepoStats(SELF_REPO, fetchImpl),
    watchKnownCompetitors(fetchImpl, extraSources),
    searchForNewCompetitorsMultiQuery(SEARCH_QUERIES, fetchImpl, excludedFromSearch),
  ]);
  return { self, knownCompetitors, possibleNewEntrants };
}

function daysSince(pushedAt: string | undefined, now: Date): number | null {
  if (!pushedAt) return null;
  const pushed = Date.parse(pushedAt);
  if (Number.isNaN(pushed)) return null;
  return (now.getTime() - pushed) / DAY_MS;
}

/** Vrai au-delà de DORMANT_AFTER_DAYS jours sans push. Faux si la date
 *  manque ou est illisible : on ne déclare pas un sommeil qu'on ne prouve pas. */
export function isDormant(pushedAt: string | undefined, now: Date): boolean {
  const days = daysSince(pushedAt, now);
  return days !== null && days > DORMANT_AFTER_DAYS;
}

/** Une ligne, coupée sur une frontière de mot, « … » si coupée. */
export function truncateDescription(text: string, maxLength: number = DESCRIPTION_MAX_LENGTH): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLength) return flat;
  const window = flat.slice(0, maxLength + 1);
  const lastSpace = window.lastIndexOf(" ");
  const head = lastSpace > 0 ? window.slice(0, lastSpace) : flat.slice(0, maxLength);
  return `${head.replace(/[\s,;:.]+$/, "")}…`;
}

function describeRepo(repo: RepoStats, now: Date): string {
  const pushed = repo.pushedAt ? repo.pushedAt.slice(0, 10) : "inconnu";
  const days = daysSince(repo.pushedAt, now);
  const sleeping = isDormant(repo.pushedAt, now) && days !== null ? `, en sommeil (${Math.floor(days)} j sans push)` : "";
  return `${repo.fullName} : ${repo.stars}★, dernier push ${pushed}${sleeping} (${repo.url})`;
}

function repoLines(repo: RepoStats, now: Date): string[] {
  const lines = [`  ${describeRepo(repo, now)}`];
  if (repo.description) lines.push(`      ${truncateDescription(repo.description)}`);
  return lines;
}

/** Le rapport tel que la CLI l'affiche, une ligne par élément. `now` est
 *  injecté pour que le marquage « en sommeil » soit testable. */
export function formatMarketWatchReport(report: MarketWatchReport, now: Date, maxNewEntrants = 10): string[] {
  const lines = [report.self ? `Référence Synapse : ${describeRepo(report.self, now)}` : "Référence Synapse : indisponible (dépôt injoignable)."];

  lines.push("Concurrents connus (par étoiles) :");
  for (const repo of report.knownCompetitors) lines.push(...repoLines(repo, now));

  if (report.possibleNewEntrants.length > 0) {
    lines.push("Nouveaux entrants possibles (non déjà suivis, plusieurs requêtes dont une par topic) :");
    for (const repo of report.possibleNewEntrants.slice(0, maxNewEntrants)) lines.push(...repoLines(repo, now));
  } else {
    lines.push("Aucun nouvel entrant détecté.");
  }
  return lines;
}
