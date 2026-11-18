/**
 * Runs the proactive recall in a child process, started by proactiveRecallCli
 * with `{ pluginDataDir, prompt }` on stdin; answers the hook output on
 * stdout. Every synchronous or native step of the recall (importing
 * transformers.js, building the tokenizer, loading the ONNX model, scanning
 * the index) blocks this process, never the hook's deadline (see
 * recallDeadline.ts).
 */
export {};
