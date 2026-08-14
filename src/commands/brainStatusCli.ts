/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/brainStatusCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}" <linkPath>
 */

import { getBrainStatus } from "./brainStatus.js";

const LINK_STATE_LABELS: Record<string, string> = {
  ok: "lié correctement",
  "wrong-target": "lié, mais vers la mauvaise cible — lancer /synapse-init pour corriger",
  broken: "lien cassé — lancer /synapse-init pour corriger",
  missing: "pas encore lié — lancer /synapse-init",
};

async function main(): Promise<void> {
  const [pluginDataDir, linkPath] = process.argv.slice(2);

  if (!pluginDataDir || !linkPath) {
    console.error("Usage: brainStatusCli <pluginDataDir> <linkPath>");
    process.exitCode = 1;
    return;
  }

  try {
    const status = await getBrainStatus(pluginDataDir, linkPath);
    console.log(`hub: ${status.hubClonePath}`);
    console.log(`lien: ${LINK_STATE_LABELS[status.linkState] ?? status.linkState}`);
    console.log(`fichiers mémoire: ${status.fileCount}`);
    console.log(`dernier audit: ${status.lastAuditAt ?? "jamais"} (cadence: ${status.auditCadenceDays}j)`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
