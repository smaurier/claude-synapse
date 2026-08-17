/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/registerProjectRootCli.js" \
 *   "${CLAUDE_PLUGIN_DATA}" <projectName> <absolutePath>
 */

import { registerProjectRoot } from "./registerProjectRoot.js";

async function main(): Promise<void> {
  const [pluginDataDir, projectName, absolutePath] = process.argv.slice(2);

  if (!pluginDataDir || !projectName || !absolutePath) {
    console.error("Usage: registerProjectRootCli <pluginDataDir> <projectName> <absolutePath>");
    process.exitCode = 1;
    return;
  }

  try {
    registerProjectRoot(pluginDataDir, projectName, absolutePath);
    console.log(`synapse: "${projectName}" enregistré -> "${absolutePath}" (ce poste seulement).`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

void main();
