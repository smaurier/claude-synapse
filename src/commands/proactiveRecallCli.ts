/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/proactiveRecallCli.js" "${CLAUDE_PLUGIN_DATA}"
 *
 * Invoked by the UserPromptSubmit hook. Reads the hook's stdin JSON payload
 * for `prompt`, runs a hybrid hub search, and prints the hook output schema
 * on stdout. An empty `{}` (no additionalContext) is a normal no-op —
 * short prompts, absent local-config, or a clean-scoring corpus all
 * legitimately produce nothing.
 *
 * Same fail-silent contract as postCompactCli.ts: any failure here degrades
 * to printing `{}`. The session must never be blocked by a recall attempt.
 */

import { runProactiveRecall } from "./proactiveRecall.js";

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function main(): Promise<void> {
  const [pluginDataDir] = process.argv.slice(2);
  if (!pluginDataDir) {
    console.log("{}");
    return;
  }

  try {
    const raw = await readStdin();
    const payload = JSON.parse(raw) as { prompt?: unknown };
    const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
    console.log(JSON.stringify(await runProactiveRecall(pluginDataDir, prompt)));
  } catch {
    console.log("{}");
  }
}

void main();
