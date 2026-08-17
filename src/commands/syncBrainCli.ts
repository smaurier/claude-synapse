/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/syncBrainCli.js" "${CLAUDE_PLUGIN_DATA}"
 *
 * Invoked from the SessionEnd hook. Failures here are non-blocking by
 * design (exit 1, never 2), same rationale as refreshIndexCli — a sync
 * that didn't happen this session isn't worth blocking on, it'll retry
 * next time. The one thing this CLI is loud about on purpose is a detected
 * secret: silence there would defeat the entire point of scanning.
 */

import { existsSync } from "node:fs";
import { readLocalConfig, defaultLocalConfigPath } from "../config/config.js";
import { syncBrain } from "./syncBrain.js";

const STATUS_LABELS: Record<string, string> = {
  "nothing-to-sync": "rien à synchroniser.",
  synced: "synchronisé.",
  "aborted-lock-held": "verrou du hub détenu par une autre machine — réessai au prochain sync.",
  "aborted-push-conflict": "commit local effectué, mais push refusé (le hub distant a divergé) — résoudre manuellement.",
};

async function main(): Promise<void> {
  const [pluginDataDir] = process.argv.slice(2);

  if (!pluginDataDir) {
    console.error("Usage: syncBrainCli <pluginDataDir>");
    process.exitCode = 1;
    return;
  }

  if (!existsSync(defaultLocalConfigPath(pluginDataDir))) {
    return; // not initialized yet — normal, same as refreshIndexCli
  }

  try {
    const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
    const result = await syncBrain(local.hubClonePath, local.machineId);

    if (result.status === "aborted-secrets-found") {
      console.error("synapse: SYNC ANNULÉE — secret(s) potentiel(s) détecté(s), rien n'a été committé ni poussé :");
      for (const [path, matches] of Object.entries(result.secretsFound ?? {})) {
        for (const m of matches) {
          console.error(`  ${path}:${m.line} — ${m.pattern} (${m.excerpt})`);
        }
      }
      process.exitCode = 1;
      return;
    }

    console.log(`synapse: ${STATUS_LABELS[result.status] ?? result.status}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

void main();
