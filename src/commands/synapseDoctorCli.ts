/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseDoctorCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}" <linkPath>
 */

import { runSynapseDoctor } from "./synapseDoctor.js";
import { formatDuplicateCandidate } from "./brainLint.js";
import { resolvePluginRoot } from "../config/dependencies.js";

async function main(): Promise<void> {
  const [pluginDataDir, linkPath] = process.argv.slice(2);

  if (!pluginDataDir || !linkPath) {
    console.error("Usage: synapseDoctorCli <pluginDataDir> <linkPath>");
    process.exitCode = 1;
    return;
  }

  try {
    // Backlog 49 : même calcul que refreshIndexCli.ts — ce module compile
    // toujours vers <pluginRoot>/dist/commands/synapseDoctorCli.js, donc
    // resolvePluginRoot(import.meta.url) retrouve le dossier racine du
    // plugin sans argument CLI supplémentaire.
    const pluginRoot = resolvePluginRoot(import.meta.url);
    const report = await runSynapseDoctor(pluginDataDir, linkPath, pluginRoot);

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
      for (const c of report.duplicateCandidates) console.log(formatDuplicateCandidate(c));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

void main();
