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
import { fileURLToPath } from "node:url";
import { recordRecallTimeout, RECALL_DEADLINE_MS, runInChildWithDeadline } from "./recallDeadline.js";
async function readStdin() {
    let data = "";
    for await (const chunk of process.stdin)
        data += chunk;
    return data;
}
async function main() {
    const [pluginDataDir] = process.argv.slice(2);
    if (!pluginDataDir) {
        console.log("{}");
        return;
    }
    try {
        const raw = await readStdin();
        const payload = JSON.parse(raw);
        const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
        const { value, timedOut } = await runInChildWithDeadline(fileURLToPath(new URL("./proactiveRecallProcess.js", import.meta.url)), { pluginDataDir, prompt }, RECALL_DEADLINE_MS, {});
        if (timedOut)
            recordRecallTimeout(pluginDataDir, RECALL_DEADLINE_MS);
        console.log(JSON.stringify(value));
    }
    catch {
        console.log("{}");
    }
}
// process.exit et pas un simple retour : rien ne doit retenir le processus du
// hook une fois sa réponse écrite, le harnais attend sa fin.
void main().finally(() => process.exit(0));
//# sourceMappingURL=proactiveRecallCli.js.map