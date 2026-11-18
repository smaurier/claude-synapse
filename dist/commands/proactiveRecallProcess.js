/**
 * Runs the proactive recall in a child process, started by proactiveRecallCli
 * with `{ pluginDataDir, prompt }` on stdin; answers the hook output on
 * stdout. Every synchronous or native step of the recall (importing
 * transformers.js, building the tokenizer, loading the ONNX model, scanning
 * the index) blocks this process, never the hook's deadline (see
 * recallDeadline.ts).
 */
import { runProactiveRecall } from "./proactiveRecall.js";
async function main() {
    let raw = "";
    for await (const chunk of process.stdin)
        raw += chunk;
    const { pluginDataDir, prompt } = JSON.parse(raw);
    const output = await runProactiveRecall(pluginDataDir, prompt);
    // Exit once written: the embedding library may still hold the event loop.
    process.stdout.write(JSON.stringify(output), () => process.exit(0));
}
void main();
//# sourceMappingURL=proactiveRecallProcess.js.map