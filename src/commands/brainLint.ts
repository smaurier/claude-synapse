/**
 * /brain-lint (périmètre IN) — reports only, never auto-fixes or
 * auto-executes anything (a merge/split/deletion suggestion acted on
 * automatically could conflate two distinct facts in silence, worse than
 * a stale link — see project memory's own reasoning for this). Frontmatter
 * validation needs no YAML library: the convention used is a flat 2-level
 * structure (top-level keys + one nesting level under `metadata:`), simple
 * enough to hand-parse without pulling in a dependency (léger bias).
 */

export interface Frontmatter {
  fields: Record<string, string>;
}

export function extractFrontmatter(content: string): Frontmatter | null {
  // Strip a leading UTF-8 BOM (U+FEFF) if present — some Windows editors/tools
  // write one, and it sits before the very first `-` the regex anchors on.
  // Left unstripped, the match below silently fails and this file becomes
  // invisible to every check that depends on this parser, not just this one.
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const match = withoutBom.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  let currentPrefix = "";
  for (const rawLine of match[1]!.split("\n")) {
    if (!rawLine.trim()) continue;
    const colonIdx = rawLine.indexOf(":");
    if (colonIdx === -1) continue;
    const indented = /^\s/.test(rawLine);
    const key = rawLine.slice(0, colonIdx).trim();
    const value = rawLine.slice(colonIdx + 1).trim();

    if (!indented) {
      currentPrefix = value === "" ? key : "";
      if (value !== "") fields[key] = value;
    } else if (currentPrefix) {
      fields[`${currentPrefix}.${key}`] = value;
    }
  }
  return { fields };
}

export type LintSeverity = "error" | "warning";

export interface LintFinding {
  path: string;
  severity: LintSeverity;
  message: string;
}

/** Les quatre types de la convention mémoire. Seule déclaration : `SLUG_TYPE_PREFIXES`
 *  en dérive plus bas, pour qu'un cinquième type ajouté ici ne laisse pas la
 *  règle de collision de slug aveugle à son existence. */
/** Gelé : la liste est devenue publique pour que `SLUG_TYPE_PREFIXES` en
 *  dérive au lieu de la recopier, et une liste publique mutable laisserait
 *  n'importe quel appelant redéfinir la convention de nommage à l'exécution.
 *  L'ordre n'est pas porteur aujourd'hui car aucun type n'est préfixe d'un
 *  autre ; ajouter un type comme `project_archive` rendrait l'ordre
 *  d'insertion significatif dans `slugStem`. */
export const VALID_TYPES: readonly string[] = Object.freeze(["user", "feedback", "project", "reference"]);
/** Status alias accepted in place of a date (convention of backlog item 24). */
const EXPIRES_CLOSED = "closed";
const DIVISION_LINE_THRESHOLD = 150;
const DIVISION_SECTION_THRESHOLD = 4;
const JOURNAL_DATE_HEADER_THRESHOLD = 4;

/** One source for "this `##` heading carries a date", used both to count
 *  them (global flag) and to locate the first one (no flag). */
const DATED_HEADER_SOURCE = String.raw`^##\s.*\d{2}[/-]\d{2}([/-]\d{2,4})?`;

function isCurrentStateHeading(heading: string): boolean {
  const text = heading
    .replace(/^#+\s*/, "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return text.startsWith("etat courant");
}

/**
 * Backlog item 42 (13/10/2026): the journal heuristic counts dated sections,
 * so it kept re-flagging fiches that had already been given the very remedy
 * its message recommends ("envisager une consolidation en état courant").
 * Four fiches of a real hub were consolidated on 13/10 and all four came
 * back identical at the next run, with the total unchanged at 15 — a report
 * that cannot tell a treated fiche from an untreated one is not a work
 * queue, it is 15 lines to re-read every time.
 *
 * The head section is recognised by position, not by content: it has to come
 * before any other dated section. A "État courant" paragraph buried under
 * ten dated entries is exactly the journal shape this check is meant to
 * catch, so it must keep firing. The heading itself usually carries its own
 * date ("## État courant (au 13/10/2026)"), hence the self-exclusion when
 * looking for the first dated section.
 */
function hasConsolidatedHeadSection(content: string): boolean {
  const headings = content.split("\n").filter((line) => /^##\s/.test(line));
  const headIndex = headings.findIndex(isCurrentStateHeading);
  if (headIndex === -1) return false;

  const datedHeader = new RegExp(DATED_HEADER_SOURCE);
  const firstOtherDated = headings.findIndex((h, i) => i !== headIndex && datedHeader.test(h));
  return firstOtherDated === -1 || headIndex < firstOtherDated;
}

/** One file's checks — frontmatter validity, expiry, and the two
 *  structural heuristics. Pure, fast, no model needed. */
export function lintFile(path: string, content: string, today: Date = new Date()): LintFinding[] {
  const findings: LintFinding[] = [];
  const fm = extractFrontmatter(content);

  if (!fm) {
    return [{ path, severity: "error", message: "aucun frontmatter détecté (bloc --- ... ---)." }];
  }

  if (!fm.fields.name) findings.push({ path, severity: "error", message: "champ `name` manquant." });
  if (!fm.fields.description) findings.push({ path, severity: "error", message: "champ `description` manquant." });

  const type = fm.fields["metadata.type"];
  if (!type) {
    findings.push({ path, severity: "error", message: "champ `metadata.type` manquant." });
  } else if (!VALID_TYPES.includes(type)) {
    findings.push({ path, severity: "error", message: `type "${type}" invalide (attendus : ${VALID_TYPES.join(", ")}).` });
  } else if (type === "feedback" || type === "project") {
    if (!fm.fields["metadata.created"]) {
      findings.push({ path, severity: "warning", message: "type feedback/project sans `metadata.created` (convention datée)." });
    }
    const expires = fm.fields["metadata.expires"];
    if (!expires) {
      findings.push({ path, severity: "warning", message: "type feedback/project sans `metadata.expires` (convention datée)." });
    } else if (expires !== "ongoing" && expires !== EXPIRES_CLOSED) {
      const expiryDate = new Date(expires);
      if (Number.isNaN(expiryDate.getTime())) {
        // Item 41: this used to be visible only as a side effect of
        // checkWipLimit counting an unparseable expiry as active. That count
        // is gone, so the defect is reported here, where the field is
        // already being validated.
        findings.push({ path, severity: "warning", message: `\`expires: ${expires}\` illisible — attendu une date ISO, \`ongoing\` ou \`${EXPIRES_CLOSED}\`.` });
      } else if (expiryDate < today) {
        findings.push({ path, severity: "warning", message: `\`expires\` dépassé (${expires}) — à vérifier, pas à supprimer sans confirmation.` });
      }
    }
  }

  const lineCount = content.split("\n").length;
  const sectionCount = (content.match(/^##\s/gm) ?? []).length;
  if (lineCount > DIVISION_LINE_THRESHOLD && sectionCount > DIVISION_SECTION_THRESHOLD) {
    findings.push({
      path,
      severity: "warning",
      message: `candidat division : ${lineCount} lignes, ${sectionCount} sections — heuristique longueur+structure, à confirmer manuellement.`,
    });
  }

  const dateHeaderCount = (content.match(new RegExp(DATED_HEADER_SOURCE, "gm")) ?? []).length;
  if (dateHeaderCount >= JOURNAL_DATE_HEADER_THRESHOLD && !hasConsolidatedHeadSection(content)) {
    findings.push({
      path,
      severity: "warning",
      message: `ressemble à un journal narratif (${dateHeaderCount} sections datées) — envisager une consolidation en état courant.`,
    });
  }

  return findings;
}

/**
 * Backlog item 37 (13/10/2026): the index (`MEMORY.md`) and its sub-indexes
 * (`MEMORY-dormant.md`, ...) are a table of contents, not memories — they
 * carry no frontmatter by convention. Linting them as memories produced the
 * single `[error]` of a 257-line report on a real hub, and that one fake
 * error masked the fact that no memory in the corpus had a real one.
 * Matched on the basename, so a nested index is covered too: the uppercase
 * spelling is the convention and memory slugs are lowercase kebab-case, so
 * a real memory never collides with it.
 */
function isIndexFile(path: string): boolean {
  const basename = path.split("/").pop() ?? path;
  return basename === "MEMORY.md" || /^MEMORY-.+\.md$/.test(basename);
}

export function lintCorpus(files: { path: string; content: string }[], today: Date = new Date()): LintFinding[] {
  return files.filter((f) => !isIndexFile(f.path)).flatMap((f) => lintFile(f.path, f.content, today));
}

const DEFAULT_WIP_LIMIT = 5;

/**
 * WIP limiter (périmètre IN) — counts `project`-type memories that carry a
 * deadline still ahead of them, and flags it as a single corpus-wide finding
 * if over the limit. Deliberately a count, not a judgment call about which
 * projects to close — that's for the user.
 *
 * Backlog item 41 (13/10/2026): it used to count every project that wasn't
 * demonstrably finished, which on a real hub read "109 mémoires project
 * actives (limite indicative : 5)" followed by all 109 paths. Unreadable,
 * therefore unactionable, and measuring three different things at once: 52
 * `ongoing` (permanent by design, they will never be closed), 38 with no
 * `expires` at all, 19 with a real future deadline. Proof that the number
 * said nothing: closing 10 fiches did not move it by a single unit, while
 * flipping 3 dormant fiches to `ongoing` took it from 106 to 109 — and a
 * limit of 5 is unreachable by construction while the 52 permanent ones are
 * in the count. Only dated deadlines count now; the other populations are
 * named in the message, and "project without `expires`" is a convention
 * defect already reported per-file by lintFile, not a workload.
 */
export function checkWipLimit(
  files: { path: string; content: string }[],
  today: Date = new Date(),
  limit = DEFAULT_WIP_LIMIT,
): LintFinding[] {
  const dated: string[] = [];
  let ongoing = 0;
  let undated = 0;

  for (const f of files) {
    const fm = extractFrontmatter(f.content);
    if (fm?.fields["metadata.type"] !== "project") continue;

    const expires = fm.fields["metadata.expires"];
    if (!expires) {
      undated++;
    } else if (expires === "ongoing") {
      ongoing++;
    } else if (expires !== EXPIRES_CLOSED) {
      const expiryDate = new Date(expires);
      // An unreadable expiry is not a deadline anyone signed up for; lintFile
      // reports it as the convention defect it is.
      if (!Number.isNaN(expiryDate.getTime()) && expiryDate >= today) dated.push(f.path);
    }
  }

  if (dated.length <= limit) return [];

  const aside: string[] = [];
  if (ongoing > 0) aside.push(`${ongoing} en \`expires: ongoing\` (permanents par conception)`);
  if (undated > 0) aside.push(`${undated} sans \`expires\` (défaut de convention, signalé fiche par fiche)`);

  return [
    {
      path: "(corpus)",
      severity: "warning",
      message:
        `${dated.length} projets à échéance datée encore ouverte (limite indicative : ${limit}) — ` +
        `envisager d'en clôturer avant d'en ouvrir de nouveaux : ${dated.join(", ")}.` +
        (aside.length > 0 ? ` Hors limite : ${aside.join(", ")}.` : ""),
    },
  ];
}

/**
 * Backlog 16/08 (agentic-stack's superseded_by, refined after review): flags
 * a `metadata.superseded_by: <path>` that names a file absent from the
 * corpus — hybridSearch.ts deliberately ignores this case rather than
 * annotating a link to nothing (see applySupersession()), so this is the
 * one place it actually gets surfaced to the user. A dangling reference
 * usually means a rename/typo, or the replacement was deleted without
 * updating the pointer — worth a look, not a silent no-op forever.
 */
export function checkSupersessionReferences(files: { path: string; content: string }[]): LintFinding[] {
  const knownPaths = new Set(files.map((f) => f.path));
  const findings: LintFinding[] = [];

  for (const f of files) {
    const target = extractFrontmatter(f.content)?.fields["metadata.superseded_by"];
    if (target && !knownPaths.has(target)) {
      findings.push({
        path: f.path,
        severity: "warning",
        message: `\`superseded_by: ${target}\` pointe vers un fichier absent du corpus — renommage/typo, ou le remplaçant a été supprimé sans mettre à jour ce champ.`,
      });
    }
  }

  return findings;
}

/** Les préfixes de nom de fichier de la règle de collision de slug : les mêmes
 *  quatre types que `VALID_TYPES` (dont cette liste dérive, pas une copie),
 *  dans leurs deux orthographes (`project_` et `project-` — le hub réel
 *  contient les deux, vérifié sur le hub réel 222-fiches le 15/10/2026). */
const SLUG_TYPE_PREFIXES: readonly string[] = VALID_TYPES;

/**
 * Décision délibérée (item 44) : les primitives ci-dessous (`slugStem`,
 * `findSlugCollisions`, `comparableWords`, `shingles`, `containment`,
 * `findVerbatimOverlaps`) sont exportées bien que seules `findDuplicateCandidates`
 * et `DuplicateCandidate` aient un consommateur en production — tout le reste
 * n'est atteint que par les tests. Choisi plutôt que dérivé : tester chaque
 * règle isolément a attrapé plusieurs défauts réels pendant ce travail, et les
 * consommateurs du plugin publié sont ses propres skills, pas des imports
 * externes — le coût d'une surface `.d.ts` plus large est donc faible ici.
 * `bodyWithoutFrontmatter`, plus bas, n'a aucun consommateur même en test ;
 * elle reste interne (pas d'`export`) pour cette raison précise.
 *
 * Le radical d'un nom de fiche (ci-dessous) : son nom de fichier sans préfixe
 * de type, sans séparateurs et en minuscules. `null` pour une fiche dont le
 * nom ne porte pas un préfixe de type reconnu, auquel cas la règle de
 * collision ne s'y applique pas. Également `null` pour un radical vide (ex.
 * `project_.md`), car il n'est pas utile pour la détection de collisions.
 */
export function slugStem(path: string): string | null {
  const basename = (path.split("/").pop() ?? path).replace(/\.md$/i, "").toLowerCase();
  for (const prefix of SLUG_TYPE_PREFIXES) {
    for (const separator of ["_", "-"]) {
      if (basename.startsWith(prefix + separator)) {
        const stem = basename.slice(prefix.length + 1).replace(/[-_]/g, "");
        return stem === "" ? null : stem;
      }
    }
  }
  return null;
}

/**
 * Une paire de fiches que l'une des deux règles signale comme doublon
 * probable, avec la preuve qui l'a fait sortir. La preuve est structurée et
 * non rédigée : c'est `formatDuplicateCandidate` qui compose la phrase, pas
 * les données elles-mêmes.
 */
export type DuplicateCandidate =
  | { a: string; b: string; rule: "slug"; stem: string }
  | { a: string; b: string; rule: "verbatim"; containment: number; shingleSize: number };

/**
 * Rend la preuve structurée d'un `DuplicateCandidate` en une phrase lisible —
 * nomme toujours la règle qui a déclenché (critère falsifiable de la spec de
 * l'item 44). Narrowed sur `rule` plutôt que castée, pour qu'une troisième
 * règle future soit une erreur de compilation ici jusqu'à être prise en
 * compte. Partagée par les deux CLI (`runBrainLintCli.ts`, `synapseDoctorCli.ts`),
 * qui avaient chacune leur copie avant l'item 44 — déplacée ici pour être
 * testable, une entrée CLI ne pouvant pas être importée par un test.
 */
export function formatDuplicateCandidate(c: DuplicateCandidate): string {
  if (c.rule === "slug") {
    return `[doublon probable] ${c.a} <-> ${c.b} (même radical \`${c.stem}\`)`;
  }
  const percent = Math.round(c.containment * 100);
  return `[doublon probable] ${c.a} <-> ${c.b} (${percent} % des suites de ${c.shingleSize} mots de la plus courte se retrouvent dans l'autre)`;
}

/**
 * Règle A de l'item 44 : deux fiches distinctes au même radical traitent le
 * même sujet sous deux étiquettes. Mesurée sur le hub réel (222 fiches) : 1
 * paire, qui était le seul vrai doublon identifié à la main, zéro faux
 * positif. Les chemins sont triés pour que la paire soit stable d'une
 * exécution à l'autre.
 */
export function findSlugCollisions(paths: string[]): DuplicateCandidate[] {
  const uniquePaths = Array.from(new Set(paths));
  const byStem = new Map<string, string[]>();
  for (const path of uniquePaths) {
    const stem = slugStem(path);
    if (!stem) continue;
    const group = byStem.get(stem) ?? [];
    group.push(path);
    byStem.set(stem, group);
  }

  const candidates: DuplicateCandidate[] = [];
  for (const [stem, group] of byStem) {
    if (group.length < 2) continue;
    const sorted = [...group].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        candidates.push({ a: sorted[i]!, b: sorted[j]!, rule: "slug", stem });
      }
    }
  }
  return candidates;
}

const SHINGLE_SIZE = 8;
const CONTAINMENT_THRESHOLD = 0.3;

/**
 * Le texte tel qu'on le compare : minuscules, sans accents, sans code inline,
 * sans ponctuation ni marques markdown. L'ordre des opérations compte : le
 * backtick (U+0060) est classé Unicode diacritic=yes, donc il est supprimé par
 * le `.replace(/\p{Diacritic}/gu, "")` ; il faut ôter le code inline AVANT le
 * pass diacritique, sinon les backticks disparaissent sans emporter leur contenu.
 */
export function comparableWords(body: string): string[] {
  return body
    .toLowerCase()
    .replace(/`[^`]*`/g, " ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

export function shingles(words: string[], size: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) set.add(words.slice(i, i + size).join(" "));
  return set;
}

/** Intersection divisée par la taille du plus petit ensemble, et non Jaccard :
 *  une fiche courte entièrement absorbée dans une longue doit marquer 1, ce que
 *  Jaccard masquerait derrière la différence de taille. */
export function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const shingle of small) if (large.has(shingle)) shared++;
  return shared / small.size;
}

/**
 * Règle B de l'item 44 : recouvrement verbatim par n-grammes (shingles) de
 * mots. Deux fiches partageant un passage d'au moins huit mots consécutifs
 * signalent une possible duplication par copier-coller — le seul cas où deux
 * fiches distinctes partagent mot pour mot une séquence de ce genre.
 *
 * Mesuré sur le hub réel (222 fiches, 15/10/2026) : le recouvrement maximal
 * observé entre deux fiches quelconques était 0,076 à 8-grammes, et aucune
 * paire ne dépassait 0,10 à 6, 8 ou 12 mots — c'est cette stabilité d'une
 * taille de n-gramme à l'autre qui justifie le choix de 8, et pas seulement
 * le chiffre à 8. Le seuil 0,30 laisse un facteur 4 de marge au-dessus du
 * plancher observé.
 * Cette règle rend zéro paire aujourd'hui, et c'est assumé : elle existe
 * comme garde-fou de régression contre un futur copier-coller, pas comme
 * source de suggestions quotidiennes.
 *
 * Point faible connu : les shingles sont dédupliqués en Set, donc deux
 * fiches dominées par la même courte phrase répétée se réduisent à des
 * ensembles identiques minuscules et marquent 1.0 par répétition plutôt que
 * par passage partagé. Jamais observé sur un hub réel, mais reproductible à
 * volonté : `scripts/scale-test.mjs` génère justement des fiches de ce type
 * et fait donc sortir 100 % des paires. Un humain lit la suggestion, donc le
 * coût reste faible.
 *
 * Remplace l'ancien détecteur par embeddings (un appel modèle par chunk, et
 * non par fiche — c'est ce dépliage qui coûtait les ~145 s) :
 * ici, aucun appel modèle ni I/O, uniquement des opérations en mémoire sur
 * des sets (O(n²) de comparaisons brutes, ~24 000 sur 222 fiches, bon marché).
 */
export function findVerbatimOverlaps(files: { path: string; content: string }[]): DuplicateCandidate[] {
  const prepared = files
    .map((f) => ({ path: f.path, shingles: shingles(comparableWords(bodyWithoutFrontmatter(f.content)), SHINGLE_SIZE) }))
    .filter((f) => f.shingles.size > 0);

  const candidates: DuplicateCandidate[] = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const score = containment(prepared[i]!.shingles, prepared[j]!.shingles);
      if (score < CONTAINMENT_THRESHOLD) continue;
      candidates.push({
        a: prepared[i]!.path,
        b: prepared[j]!.path,
        rule: "verbatim",
        containment: score,
        shingleSize: SHINGLE_SIZE,
      });
    }
  }
  return candidates;
}

/**
 * Clé de paire non ordonnée — le tri est structurant. Les deux règles ne
 * s'accordent pas sur l'orientation de la paire : `findSlugCollisions` trie
 * ses groupes, donc émet des paires avec les chemins en ordre alphabétique ;
 * `findVerbatimOverlaps` reflète l'ordre d'entrée des fichiers. Quand la même
 * paire est trouvée par les deux règles, elles peuvent l'émettre avec `a` et
 * `b` inversés l'une par rapport à l'autre. La déduplication dans
 * `findDuplicateCandidates` s'appuie sur ce tri pour les fondre en un seul
 * candidat. (Que ça marche en production dépend aussi d'un hasard amont :
 * `loadCorpus` trie déjà le corpus par chemin, ce qui fait souvent coïncider
 * l'ordre de `findVerbatimOverlaps` — mais cette fonction ne doit pas s'appuyer
 * là-dessus, c'est elle qui porte la garantie.)
 */
function pairKey(candidate: DuplicateCandidate): string {
  return [candidate.a, candidate.b].sort().join(" ");
}

/**
 * Point d'entrée pour les deux rapports de détection de doublons — applique
 * les deux règles déterministes (collision de slug, recouvrement verbatim)
 * et écarte les paires inéligibles en amont de toute comparaison, jamais en
 * filtrant le résultat après coup, pour que l'exclusion soit inconditionnelle.
 *
 * Remplace la comparaison O(n²) par embeddings de l'ancien `MergeCandidate`,
 * qui mesurait le registre d'écriture (les fiches feedback partagent un bloc
 * frontmatter et une convention rédactionnelle, pas un sujet) plutôt que la
 * vraie duplication.
 *
 * Trois exclusions, appliquées avant toute comparaison :
 * (1) `isIndexFile` : un index (MEMORY.md et sous-index) est une table des
 * matières qui liste toutes les fiches — il ressemble donc un peu à chacune
 * d'elles et ne peut jamais être fusionné utilement.
 * (2) `isProtected` : une fiche `metadata.protected: true` (garde-fou,
 * mémoire délibérément singulière) ne doit jamais être proposée en fusion,
 * quelle que soit la ressemblance de son contenu.
 * (3) `supersessionTarget` : une paire déjà liée par `metadata.superseded_by`
 * a sa relation déjà nommée et résolue — la signaler à nouveau est du bruit.
 */
export function findDuplicateCandidates(files: { path: string; content: string }[]): DuplicateCandidate[] {
  const eligible = files.filter((f) => !isIndexFile(f.path) && !isProtected(f.content));
  const supersessionTargetByPath = new Map(eligible.map((f) => [f.path, supersessionTarget(f.content)]));

  const alreadyLinked = (candidate: DuplicateCandidate): boolean =>
    supersessionTargetByPath.get(candidate.a) === candidate.b ||
    supersessionTargetByPath.get(candidate.b) === candidate.a;

  const seen = new Set<string>();
  const candidates: DuplicateCandidate[] = [];
  // La collision de slug d'abord : c'est la règle la plus sûre, donc c'est son
  // explication qu'on garde si les deux règles trouvent la même paire.
  for (const candidate of [...findSlugCollisions(eligible.map((f) => f.path)), ...findVerbatimOverlaps(eligible)]) {
    if (alreadyLinked(candidate)) continue;
    const key = pairKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * Une fiche marquée `metadata.protected: true` (backlog 16/08, étude de
 * marché Synapse — « Von Restorff », mnemoverse) ne doit jamais devenir un
 * candidat doublon, quelle que soit la ressemblance de son contenu avec un
 * autre fichier. Utilisé par `findDuplicateCandidates` pour écarter ces
 * fiches en amont de toute comparaison (voir sa documentation pour le
 * raisonnement complet). Historiquement, c'était déjà l'exclusion appliquée
 * par l'ancien détecteur par similarité avant son appel au modèle.
 */
function isProtected(content: string): boolean {
  const fm = extractFrontmatter(content);
  return fm?.fields["metadata.protected"] === "true";
}

function supersessionTarget(content: string): string | undefined {
  return extractFrontmatter(content)?.fields["metadata.superseded_by"];
}

/**
 * Backlog item 39 (13/10/2026): the frontmatter is stripped before a file is
 * compared to another, because it was the single biggest source of false
 * positives for the detector that used to live here. On the real 222-fiche
 * hub, the deleted cosine-similarity detector returned 59 pairs at its 0.85
 * threshold, and 47 of them were feedback<->feedback: those fiches share a
 * frontmatter block (name / description / metadata.type / created / expires)
 * and a writing template, and the frontmatter dominated the first chunk of
 * every one of them — the similarity was measuring the register, not the
 * subject. That measurement no longer applies as-is (the detector and its
 * threshold are both gone), but the principle it proved still holds and is
 * still exercised today: `findVerbatimOverlaps` compares bodies via this
 * function, and its own tests ("ne compare jamais le frontmatter...") pin
 * that two fiches sharing nothing but an identical frontmatter block never
 * pair.
 *
 * Only this check strips it. The RAG index keeps embedding whole files on
 * purpose — searching for "the fiche about X" legitimately matches on the
 * description — and the two must never share a transformed embedding space
 * (same reasoning as the chunker note above).
 */
function bodyWithoutFrontmatter(content: string): string {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  return withoutBom.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "");
}
