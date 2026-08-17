/**
 * /brain-lint (périmètre IN) — reports only, never auto-fixes or
 * auto-executes anything (a merge/split/deletion suggestion acted on
 * automatically could conflate two distinct facts in silence, worse than
 * a stale link — see project memory's own reasoning for this). Frontmatter
 * validation needs no YAML library: the convention used is a flat 2-level
 * structure (top-level keys + one nesting level under `metadata:`), simple
 * enough to hand-parse without pulling in a dependency (léger bias).
 */

import { cosineSimilarity } from "../rag/store.js";
import { chunkFile, type Chunk } from "../rag/chunk.js";

export interface Frontmatter {
  fields: Record<string, string>;
}

export function extractFrontmatter(content: string): Frontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
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

const VALID_TYPES = ["user", "feedback", "project", "reference"];
const DIVISION_LINE_THRESHOLD = 150;
const DIVISION_SECTION_THRESHOLD = 4;
const JOURNAL_DATE_HEADER_THRESHOLD = 4;

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
    } else if (expires !== "ongoing") {
      const expiryDate = new Date(expires);
      if (!Number.isNaN(expiryDate.getTime()) && expiryDate < today) {
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

  const dateHeaderCount = (content.match(/^##\s.*\d{2}[/-]\d{2}([/-]\d{2,4})?/gm) ?? []).length;
  if (dateHeaderCount >= JOURNAL_DATE_HEADER_THRESHOLD) {
    findings.push({
      path,
      severity: "warning",
      message: `ressemble à un journal narratif (${dateHeaderCount} sections datées) — envisager une consolidation en état courant.`,
    });
  }

  return findings;
}

export function lintCorpus(files: { path: string; content: string }[], today: Date = new Date()): LintFinding[] {
  return files.flatMap((f) => lintFile(f.path, f.content, today));
}

const DEFAULT_WIP_LIMIT = 5;

/**
 * WIP limiter (périmètre IN) — counts `project`-type memories that are
 * currently active (expires: ongoing, or a future date) and flags it as a
 * single corpus-wide finding if over the limit. Deliberately a count, not
 * a judgment call about which projects to close — that's for the user.
 */
export function checkWipLimit(
  files: { path: string; content: string }[],
  today: Date = new Date(),
  limit = DEFAULT_WIP_LIMIT,
): LintFinding[] {
  const activeProjects = files.filter((f) => {
    const fm = extractFrontmatter(f.content);
    if (fm?.fields["metadata.type"] !== "project") return false;
    const expires = fm.fields["metadata.expires"];
    if (!expires) return true; // no expiry set at all — still counts as active
    if (expires === "ongoing") return true;
    const expiryDate = new Date(expires);
    return Number.isNaN(expiryDate.getTime()) || expiryDate >= today;
  });

  if (activeProjects.length <= limit) return [];

  return [
    {
      path: "(corpus)",
      severity: "warning",
      message:
        `${activeProjects.length} mémoires "project" actives simultanément (limite indicative : ${limit}) — ` +
        `envisager d'en clôturer avant d'en ouvrir de nouvelles : ${activeProjects.map((f) => f.path).join(", ")}.`,
    },
  ];
}

/**
 * Backlog 16/08 (agentic-stack's superseded_by, refined by Sylvain): flags
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

export interface MergeCandidate {
  a: string;
  b: string;
  score: number;
}

/**
 * Merge candidates via RAG similarity — the one check that needs a real
 * embedding model, kept separate from lintFile/lintCorpus so those stay
 * fast and model-free. embed is injected (same pattern as production.ts)
 * so this stays testable with a fake; the real wiring uses embedLocal.
 * Suggestions only, as designed — this never merges anything itself.
 *
 * Chunked before embedding — found 14/08 on the real 121-file hub: the
 * first version embedded each file's FULL raw content directly, silently
 * truncated by the model past its token window (embedLocal's own defensive
 * warning fired for every file over the limit — "shouldn't happen if the
 * text comes from chunkFileForEmbedding()", and it was happening, because
 * this function never called it). That meant merge candidates were
 * computed from only the first ~128 tokens of each file, not its real
 * content — a likely contributor to an implausibly large false-positive
 * count (3001 pairs at ≥0.85 on that corpus, including clearly unrelated
 * files). chunkFn defaults to the character heuristic (fast, no model) for
 * unit tests, matching production.ts's split; the real wiring uses
 * chunkFileForEmbedding — same token-exact chunker as everything else,
 * never a second, weaker chunking path.
 *
 * Two files are scored by the MAX similarity across any pair of their
 * chunks — "these files overlap somewhere," not "their first chunks
 * happen to be similar."
 *
 * `metadata.protected: true` (backlog 16/08, étude de marché Synapse —
 * "Von Restorff" protection, mnemoverse) excludes a file from pairing
 * entirely, before any embedding call: a deliberately singular memory
 * (a garde-fou, say) must never become a merge candidate, no matter how
 * similar its content looks to another file. Excluded upstream of
 * embedding rather than filtered from the results afterward — cheaper
 * (protected files never pay the embed cost either), and it's the only
 * way to make the guarantee unconditional rather than "unless a future
 * change filters results differently".
 */
function isProtected(content: string): boolean {
  const fm = extractFrontmatter(content);
  return fm?.fields["metadata.protected"] === "true";
}

function supersessionTarget(content: string): string | undefined {
  return extractFrontmatter(content)?.fields["metadata.superseded_by"];
}

export async function findMergeCandidates(
  files: { path: string; content: string }[],
  embed: (text: string) => number[] | Promise<number[]>,
  chunkFn: (path: string, content: string) => Chunk[] | Promise<Chunk[]> = chunkFile,
  threshold = 0.85,
): Promise<MergeCandidate[]> {
  // NB: this function has no size guard of its own — O(n²) pairwise chunk
  // comparison, measured 16/08 at 117s for 2000 files (scripts/scale-
  // test.mjs). Real callers (runBrainLint.ts, synapseDoctor.ts) go through
  // findMergeCandidatesGuarded() below instead, which skips the comparison
  // above SharedConfig.mergeCandidatesMaxFiles. This function stays a pure
  // algorithm — the size policy belongs at the application layer, same
  // reasoning as checkWipLimit being a separate concern from lintFile.
  const eligibleFiles = files.filter((f) => !isProtected(f.content));
  // metadata.superseded_by (found redundant 16/08 by manual testing on a
  // disposable hub, not by guessing): a pair already linked that way has
  // its relationship already named and resolved — suggesting a merge on
  // top of that is noise, not a second opinion.
  const supersessionTargetByPath = new Map(eligibleFiles.map((f) => [f.path, supersessionTarget(f.content)]));
  const fileEmbeddings = await Promise.all(
    eligibleFiles.map(async (f) => {
      const chunks = await chunkFn(f.path, f.content);
      return { path: f.path, embeddings: await Promise.all(chunks.map((c) => embed(c.text))) };
    }),
  );

  const candidates: MergeCandidate[] = [];
  for (let i = 0; i < fileEmbeddings.length; i++) {
    for (let j = i + 1; j < fileEmbeddings.length; j++) {
      const pathA = fileEmbeddings[i]!.path;
      const pathB = fileEmbeddings[j]!.path;
      if (supersessionTargetByPath.get(pathA) === pathB || supersessionTargetByPath.get(pathB) === pathA) continue;

      let best = 0;
      for (const eA of fileEmbeddings[i]!.embeddings) {
        for (const eB of fileEmbeddings[j]!.embeddings) {
          const score = cosineSimilarity(eA, eB);
          if (score > best) best = score;
        }
      }
      if (best >= threshold) {
        candidates.push({ a: pathA, b: pathB, score: best });
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * The size-guarded entrypoint real callers use instead of findMergeCandidates
 * directly. Above maxFiles, skips the O(n²) comparison entirely and reports
 * why via a corpus-wide finding — never silently returns an empty list that
 * would read as "no duplicates found" when the real answer is "not checked".
 */
export async function findMergeCandidatesGuarded(
  files: { path: string; content: string }[],
  embed: (text: string) => number[] | Promise<number[]>,
  chunkFn: (path: string, content: string) => Chunk[] | Promise<Chunk[]>,
  maxFiles: number,
): Promise<{ mergeCandidates: MergeCandidate[]; findings: LintFinding[] }> {
  if (files.length > maxFiles) {
    return {
      mergeCandidates: [],
      findings: [
        {
          path: "(corpus)",
          severity: "warning",
          message:
            `détection de fusion sautée : ${files.length} fichiers dépasse le seuil configuré ` +
            `(${maxFiles}) — comparaison par paire en O(n²), mesurée à plusieurs minutes au-delà de ` +
            `quelques milliers de fichiers, risquerait de dépasser le budget du hook. Ajuster ` +
            `mergeCandidatesMaxFiles via /synapse-config si le temps d'attente est acceptable.`,
        },
      ],
    };
  }
  return { mergeCandidates: await findMergeCandidates(files, embed, chunkFn), findings: [] };
}
