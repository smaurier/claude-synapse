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
 */
export async function findMergeCandidates(
  files: { path: string; content: string }[],
  embed: (text: string) => number[] | Promise<number[]>,
  threshold = 0.85,
): Promise<MergeCandidate[]> {
  const embeddings = await Promise.all(files.map((f) => embed(f.content)));
  const candidates: MergeCandidate[] = [];

  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const score = cosineSimilarity(embeddings[i]!, embeddings[j]!);
      if (score >= threshold) {
        candidates.push({ a: files[i]!.path, b: files[j]!.path, score });
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}
