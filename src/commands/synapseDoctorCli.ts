/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseDoctorCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}" <linkPath>
 */

import { runSynapseDoctor } from "./synapseDoctor.js";

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

    if (report.findings.length === 0 && report.mergeCandidates.length === 0) {
      console.log("brain-lint: rien à signaler.");
    } else {
      for (const f of report.findings) console.log(`[${f.severity}] ${f.path} — ${f.message}`);
      for (const c of report.mergeCandidates) {
        console.log(`[fusion possible] ${c.a} <-> ${c.b} (similarité ${c.score.toFixed(3)})`);
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

void main();
