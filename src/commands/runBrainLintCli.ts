/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/runBrainLintCli.js" "${CLAUDE_PLUGIN_DATA}"
 */

import { runBrainLint } from "./runBrainLint.js";

async function main(): Promise<void> {
  const [pluginDataDir] = process.argv.slice(2);

  if (!pluginDataDir) {
    console.error("Usage: runBrainLintCli <pluginDataDir>");
    process.exitCode = 1;
    return;
  }

  try {
    const report = await runBrainLint(pluginDataDir);

    if (report.findings.length === 0 && report.mergeCandidates.length === 0) {
      console.log("synapse: rien à signaler.");
      return;
    }

    for (const f of report.findings) {
      console.log(`[${f.severity}] ${f.path} — ${f.message}`);
    }
    for (const c of report.mergeCandidates) {
      console.log(`[fusion possible] ${c.a} <-> ${c.b} (similarité ${c.score.toFixed(3)})`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

main();
