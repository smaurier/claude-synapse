/**
 * The actual process entrypoint invoked by the SessionStart hook
 * (hooks/hooks.json):
 *   node "${CLAUDE_PLUGIN_ROOT}/dist/commands/refreshIndexCli.js" \
 *     "${CLAUDE_PLUGIN_DATA}" "${CLAUDE_PROJECT_DIR}"
 *
 * The second argument is optional (older/simpler invocations still work).
 *
 * Deliberately thin, same rationale as brainSearchCli.ts. Failures here are
 * non-blocking by design (exit 1, never 2 — a hook exiting 2 blocks the
 * session per hooks.md, and a stale search index is never worth blocking a
 * session over) except for the expected "not initialized yet" state, which
 * is silent: every session before the first /synapse-init would otherwise
 * print an alarming error for a perfectly normal pre-setup condition.
 */

import { existsSync } from "node:fs";
import { defaultLocalConfigPath } from "../config/config.js";
import { runRefreshIndex } from "./refreshIndex.js";

async function main(): Promise<void> {
  const [pluginDataDir, projectDir] = process.argv.slice(2);

  if (!pluginDataDir) {
    console.error("Usage: refreshIndexCli <pluginDataDir> [projectDir]");
    process.exitCode = 1;
    return;
  }

  // Checked explicitly rather than pattern-matching readLocalConfig's error
  // message: a string match would also silently swallow a genuine path
  // resolution bug that happens to produce a similar-looking error, hiding
  // exactly the kind of failure this hook should surface.
  if (!existsSync(defaultLocalConfigPath(pluginDataDir))) {
    return; // not initialized yet — normal, nothing to refresh
  }

  try {
    const result = await runRefreshIndex(pluginDataDir, projectDir);
    if (result.auditTriggered && result.auditReport) {
      const r = result.auditReport;
      console.log(`synapse: audit périodique déclenché (cadence dépassée) — ${r.fileCount} fichiers, ${r.findings.length} signalement(s), ${r.mergeCandidates.length} candidat(s) fusion.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`synapse: échec du rafraîchissement de l'index — ${message}`);
    process.exitCode = 1;
  }
}

main();
