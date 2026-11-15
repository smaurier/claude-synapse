/**
 * node "${CLAUDE_PLUGIN_ROOT}/dist/commands/commitPathsCli.js" "${CLAUDE_PLUGIN_DATA}" -m "<message>" -- <chemin>...
 *
 * How a session commits into the hub (see commitPaths.ts). Exit 0 when every
 * named path is now in history (committed here or already by someone else),
 * 1 otherwise.
 */
import { type CommitPathsResult } from "./commitPaths.js";
export declare function parseArgs(argv: string[]): {
    pluginDataDir: string;
    message: string;
    paths: string[];
} | null;
export declare function formatResult(result: CommitPathsResult): string[];
