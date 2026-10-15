/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseDoctorCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}" <linkPath>
 */

import { runSynapseDoctor } from "./synapseDoctor.js";
import type { DuplicateCandidate } from "./brainLint.js";

/**
 * DuplicateCandidate carries structured evidence (which rule fired, and the
 * measurement behind it), not prose — this is where that evidence becomes a
 * sentence a human reads. Narrowed on `rule` rather than cast, so adding a
 * third rule later is a compile error here until this renderer accounts for
 * it too. Same rendering as runBrainLintCli.ts, deliberately duplicated —
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
  const [pluginDataDir, linkPath] = process.argv.slice(2);

  if (!pluginDataDir || !linkPath) {
    console.error("Usage: synapseDoctorCli <pluginDataDir> <linkPath>");
    process.exitCode = 1;
    return;
  }

  try {
    const report = await runSynapseDoctor(pluginDataDir, linkPath);

    console.log(`hub: ${report.hubClonePath} (${report.fileCount} fichiers)`);
    console.log(`lien: ${report.linkState}${report.linkAutoFixed ? " (recréé automatiquement, était cassé)" : ""}`);

    const machines = Object.entries(report.knownMachines).sort(([, a], [, b]) => b.localeCompare(a));
    if (machines.length > 0) {
      console.log(`machines connues (${machines.length}) :`);
      for (const [machineId, lastSeenAt] of machines) console.log(`  ${machineId} — vu la dernière fois : ${lastSeenAt}`);
    }

    if (report.projectsRelinked.length > 0) {
      console.log(`projets (re)liés depuis les racines mémorisées : ${report.projectsRelinked.length}`);
      for (const p of report.projectsRelinked) console.log(`  ${p.projectDir} — ${p.link.action}`);
    }

    if (report.findings.length === 0 && report.duplicateCandidates.length === 0) {
      console.log("brain-lint: rien à signaler, aucun doublon détecté.");
    } else {
      for (const f of report.findings) console.log(`[${f.severity}] ${f.path} — ${f.message}`);
      for (const c of report.duplicateCandidates) console.log(renderDuplicateCandidate(c));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

void main();
