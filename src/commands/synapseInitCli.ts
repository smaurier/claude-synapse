/**
 * The actual process entrypoint invoked by skills/synapse-init/SKILL.md:
 *   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/synapseInitCli.js" \
 *     "${CLAUDE_PLUGIN_DATA}" <hubUrl> <linkPath>
 *
 * Deliberately thin, same rationale as the other *Cli.ts entrypoints.
 */

import { runSynapseInit } from "./synapseInit.js";

const LINK_ACTION_LABELS: Record<string, string> = {
  "already-ok": "déjà lié correctement — rien à faire.",
  created: "lien créé.",
  recreated: "lien existant incorrect (mauvaise cible ou cassé) — recréé.",
  "recreated-after-backup": "du contenu réel existait à cet emplacement — sauvegardé, puis lien créé.",
};

async function main(): Promise<void> {
  const [pluginDataDir, hubUrl, linkPath] = process.argv.slice(2);

  if (!pluginDataDir || !hubUrl || !linkPath) {
    console.error("Usage: synapseInitCli <pluginDataDir> <hubUrl> <linkPath>");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runSynapseInit({ pluginDataDir, hubUrl, linkPath });
    console.log(`synapse: hub prêt dans "${result.hubClonePath}".`);
    console.log(`synapse: ${LINK_ACTION_LABELS[result.link.action] ?? result.link.action}`);
    if (result.link.backupPath) {
      console.log(`synapse: sauvegarde visible à "${result.link.backupPath}".`);
    }
    if (result.visibilityWarning) {
      console.log(result.visibilityWarning);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
