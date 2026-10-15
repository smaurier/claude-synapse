/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/runBrainLintCli.js" "${CLAUDE_PLUGIN_DATA}"
 */

import { runBrainLint } from "./runBrainLint.js";
import type { DuplicateCandidate } from "./brainLint.js";

/**
 * DuplicateCandidate carries structured evidence (which rule fired, and the
 * measurement behind it), not prose — this is where that evidence becomes a
 * sentence a human reads. Narrowed on `rule` rather than cast, so adding a
 * third rule later is a compile error here until this renderer accounts for
 * it too. Same rendering as synapseDoctorCli.ts, deliberately duplicated —
 * each CLI entrypoint stays thin and self-contained, same bias as the rest
 * of this codebase's *Cli.ts files (they already each duplicate their own
 * usage guard, try/catch wrapper, and findings loop; a shared cli-utils
 * module for a single six-line function would be the inconsistent move).
 */
function renderDuplicateCandidate(c: DuplicateCandidate): string {
  if (c.rule === "slug") {
    return `[doublon probable] ${c.a} <-> ${c.b} (même radical \`${c.stem}\`)`;
  }
  const percent = Math.round(c.containment * 100);
  return `[doublon probable] ${c.a} <-> ${c.b} (${percent} % des suites de ${c.shingleSize} mots de la plus courte se retrouvent dans l'autre)`;
}

async function main(): Promise<void> {
  const [pluginDataDir] = process.argv.slice(2);

  if (!pluginDataDir) {
    console.error("Usage: runBrainLintCli <pluginDataDir>");
    process.exitCode = 1;
    return;
  }

  try {
    const report = await runBrainLint(pluginDataDir);

    if (report.findings.length === 0 && report.duplicateCandidates.length === 0) {
      console.log("synapse: rien à signaler, aucun doublon détecté.");
      return;
    }

    for (const f of report.findings) {
      console.log(`[${f.severity}] ${f.path} — ${f.message}`);
    }
    for (const c of report.duplicateCandidates) {
      console.log(renderDuplicateCandidate(c));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

void main();
