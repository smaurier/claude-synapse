/**
 * /brain-status — a quick health snapshot, composing already-tested pieces
 * (LocalConfig, jonction state, corpus size, audit cadence) rather than
 * introducing new logic. Distinct from /synapse-doctor (broader, report-
 * only, not built yet): this is the fast single-project check.
 */
import { type LinkState } from "../jonction/jonction.js";
export interface BrainStatusResult {
    hubClonePath: string;
    linkState: LinkState;
    fileCount: number;
    lastAuditAt: string | null;
    auditCadenceDays: number;
}
export declare function getBrainStatus(pluginDataDir: string, linkPath: string): Promise<BrainStatusResult>;
