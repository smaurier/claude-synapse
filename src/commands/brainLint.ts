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
/** Backlog item 40 (13/10/2026): words a description already uses to announce its
 *  own closure. Found by reading the real overdue entries on one hub — 9 of 14
 *  carried one of these. Deliberately a short, editable list rather than a
 *  clever heuristic: a false negative here just means the fiche keeps its plain
 *  "overdue" warning, never a wrong auto-action (this only ever proposes). */
const CLOSURE_MARKERS = ["clos", "close", "stoppe", "pas retenu", "non retenu", "decline", "complet et deploye", "perdu", "resolu", "abandonne"];

/** Accent-insensitive, case-insensitive containment check against CLOSURE_MARKERS. */
function describesItsOwnClosure(description: string): boolean {
  const normalized = description
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return CLOSURE_MARKERS.some((marker) => normalized.includes(marker));
}
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
        if (fm.fields.description && describesItsOwnClosure(fm.fields.description)) {
          findings.push({
            path,
            severity: "warning",
            message: `la description annonce déjà sa clôture — proposer \`expires: closed\`, jamais en auto-fix.`,
          });
        }
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
export function isIndexFile(path: string): boolean {
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

/** Markdown link target syntax, `[texte](cible)` — used by checkIndexLinks below to
 *  pull every link out of an index file's body. */
const MARKDOWN_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

/**
 * Backlog item 38 (13/10/2026): nothing verified the index's own links, nor the
 * reverse — a fiche silently absent from every index. Measured by hand that day:
 * 187 links cited, 0 broken, 1 orphan — a clean result, but guaranteed by nothing;
 * the next fiche created without an index line would never be caught. Two
 * findings, scoped deliberately to the index's markdown links only (not every
 * `[[wikilink]]` in every fiche's body, a much noisier and differently-scoped
 * question): a link cited with no matching file, and a real fiche cited by no
 * index file at all.
 */
export function checkIndexLinks(files: { path: string; content: string }[]): LintFinding[] {
  const findings: LintFinding[] = [];
  const indexFiles = files.filter((f) => isIndexFile(f.path));
  const byBasename = new Set(files.map((f) => f.path.split("/").pop() ?? f.path));
  const linkedBasenames = new Set<string>();

  for (const index of indexFiles) {
    for (const match of index.content.matchAll(MARKDOWN_LINK_RE)) {
      const target = match[1];
      if (!target || /^[a-z]+:\/\//i.test(target)) continue; // external link, not a corpus file
      const basename = target.split("/").pop() ?? target;
      if (!basename.toLowerCase().endsWith(".md")) continue;
      linkedBasenames.add(basename);
      if (!byBasename.has(basename)) {
        findings.push({
          path: index.path,
          severity: "warning",
          message: `lien vers \`${basename}\` — aucun fichier de ce nom dans le corpus (renommage/typo probable).`,
        });
      }
    }
  }

  for (const f of files) {
    if (isIndexFile(f.path)) continue;
    if (!extractFrontmatter(f.content)) continue; // not a real fiche by convention, see lintFile
    const basename = f.path.split("/").pop() ?? f.path;
    if (!linkedBasenames.has(basename)) {
      findings.push({
        path: f.path,
        severity: "warning",
        message: "aucune ligne d'index ne pointe vers cette fiche — orpheline, invisible depuis MEMORY.md.",
      });
    }
  }

  return findings;
}

/**
 * Backlog item 36 (13/10/2026): `MEMORY.md` is the one file paid at EVERY
 * `SessionStart`, regardless of topic — and nothing measured its weight or
 * how it breaks down by section. Scoped deliberately to `MEMORY.md` itself,
 * not the `MEMORY-*.md` sub-indexes (those are loaded on demand by the hub's
 * own convention, not paid on every session — item 37 already draws this
 * same line between "the index" and "a memory"). `indexMaxBytes` is the one
 * configurable threshold, same pattern as `wipLimit`: it gates the whole
 * finding, and once past it the message lists every `##` section by weight,
 * heaviest first, so the next person reading the report knows exactly where
 * the bytes are going rather than just that there are too many of them.
 */
export function checkIndexWeight(files: { path: string; content: string }[], indexMaxBytes: number): LintFinding[] {
  const index = files.find((f) => (f.path.split("/").pop() ?? f.path) === "MEMORY.md");
  if (!index) return [];

  const totalBytes = Buffer.byteLength(index.content, "utf8");
  if (totalBytes <= indexMaxBytes) return [];

  const headingPositions = [...index.content.matchAll(/^##\s+(.+)$/gm)].map((m) => ({ heading: m[1]!.trim(), start: m.index! }));
  const sections = headingPositions.map((h, i) => {
    const end = i + 1 < headingPositions.length ? headingPositions[i + 1]!.start : index.content.length;
    return { heading: h.heading, bytes: Buffer.byteLength(index.content.slice(h.start, end), "utf8") };
  });
  sections.sort((a, b) => b.bytes - a.bytes);

  const breakdown = sections.map((s) => `${s.heading} (${s.bytes} o)`).join(", ");

  return [
    {
      path: index.path,
      severity: "warning",
      message:
        `${totalBytes} octets, au-dessus du seuil configuré (${indexMaxBytes}) — payé à chaque SessionStart.` +
        (breakdown ? ` Par section, la plus lourde en tête : ${breakdown}.` : ""),
    },
  ];
}
