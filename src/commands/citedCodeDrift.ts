/**
 * Backlog 16/08 (étude de marché Synapse — hippo): staleness judged by
 * whether the code a memory cites has actually moved (git history), not
 * by the memory's calendar age. Deliberately narrow, per feedback: only
 * memories with an explicit `metadata.cites: <path>` — most personal-hub
 * content doesn't cite code, this is not a general staleness mechanism
 * and never claims to be.
 *
 * NOT wired into runBrainLint.ts/synapseDoctor.ts yet, unlike the other
 * checks in brainLint.ts — deliberately. Those operate on the hub's own
 * corpus; this needs to shell out to git against a DIFFERENT repository
 * (whatever project the cited path lives in), and there is no answer yet
 * to "which project root does a given `cites:` path resolve against" —
 * an absolute path in frontmatter would violate feedback_chemins_
 * multipostes (every absolute path belongs to one specific machine), and
 * Synapse has no registry mapping a project name to a local root today
 * (refreshProjectsRoots is a different concern — which roots to re-scan
 * for auto-linking, not a name->path lookup). Real open question, not
 * silently invented a convention for. gitLastCommitDate is injected
 * (same DI pattern as embed elsewhere in this codebase) so the real
 * wiring (once that question is answered) is a thin `runGit(["log",
 * "-1", "--format=%cI", "--", path], projectRoot)` call — see
 * src/config/git.ts's runGit(), already reusable for this.
 */

import { extractFrontmatter } from "./brainLint.js";
import type { LintFinding } from "./brainLint.js";

export type GitLastCommitDate = (citedPath: string) => Promise<string | null>;

export async function checkCitedCodeDrift(
  files: { path: string; content: string }[],
  gitLastCommitDate: GitLastCommitDate,
): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];

  for (const f of files) {
    const fm = extractFrontmatter(f.content);
    const cites = fm?.fields["metadata.cites"];
    if (!cites) continue;

    const created = fm?.fields["metadata.created"];
    if (!created) {
      findings.push({
        path: f.path,
        severity: "warning",
        message: `\`cites: ${cites}\` sans \`metadata.created\` — rien à comparer pour juger si le code cité a bougé depuis.`,
      });
      continue;
    }

    const lastCommit = await gitLastCommitDate(cites);
    if (lastCommit === null) {
      findings.push({
        path: f.path,
        severity: "warning",
        message: `\`cites: ${cites}\` introuvable dans l'historique git du projet — renommage/typo, ou le fichier a été supprimé.`,
      });
      continue;
    }

    const createdDate = new Date(created);
    const lastCommitDate = new Date(lastCommit);
    if (!Number.isNaN(createdDate.getTime()) && !Number.isNaN(lastCommitDate.getTime()) && lastCommitDate > createdDate) {
      findings.push({
        path: f.path,
        severity: "warning",
        message: `\`cites: ${cites}\` a changé (dernier commit ${lastCommit}) depuis l'écriture de cette mémoire (${created}) — peut-être périmée, à vérifier.`,
      });
    }
  }

  return findings;
}
