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
 * to printing `{}`. The session must never be blocked by a recall attempt,
 * including a slow one: see recallDeadline.ts for the internal deadline.
 */

import { runProactiveRecall } from "./proactiveRecall.js";
import { withDeadline, recordRecallTimeout, RECALL_DEADLINE_MS } from "./recallDeadline.js";

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
    const { value, timedOut } = await withDeadline(runProactiveRecall(pluginDataDir, prompt), RECALL_DEADLINE_MS, {});
    if (timedOut) recordRecallTimeout(pluginDataDir, RECALL_DEADLINE_MS);
    console.log(JSON.stringify(value));
  } catch {
    console.log("{}");
  }
}

// process.exit et pas un simple retour : après l'échéance, l'inférence
// abandonnée tient encore la boucle d'événements, et le harnais attendrait
// la fin du processus, donc le timeout qu'on cherche à éviter.
void main().finally(() => process.exit(0));
