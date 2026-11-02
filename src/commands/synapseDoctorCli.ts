/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseDoctorCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}" <linkPath>
 */

import { runSynapseDoctor, formatDoctorReport } from "./synapseDoctor.js";
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
    for (const line of formatDoctorReport(report)) console.log(line);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

void main();
