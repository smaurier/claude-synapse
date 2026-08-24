/**
 * Backlog 16/08 (étude de marché Synapse, compaction-light) — pairs with
 * brainSearchCli.ts writing sessionResults on every search. Never invents
 * an empty additionalContext key: an empty object means "nothing to add",
 * matching PostCompact's universal output contract (additionalContext is
 * optional — omit rather than send an empty string).
 */
import { readSessionResults, formatSessionResultsAsContext } from "./sessionResults.js";
export function buildPostCompactOutput(pluginDataDir, sessionId) {
    const stored = readSessionResults(pluginDataDir, sessionId);
    const context = formatSessionResultsAsContext(stored);
    return context ? { additionalContext: context } : {};
}
//# sourceMappingURL=postCompact.js.map