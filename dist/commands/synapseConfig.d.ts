/**
 * /synapse-config show/set — commande-driven config editing (problème 2:
 * "jamais d'édition manuelle de fichier requise"). Only a deliberately
 * narrow subset of SharedConfig is user-editable: ragEmbeddingModelVersion
 * and lastAuditAt are machine-managed (set by the code, not the user, per
 * their own design sections), version is a schema marker — exposing them
 * for hand-editing here would just invite a bad write.
 *
 * refreshProjectsExclusions was excluded too until 14/08 ("format non
 * tranché" backlog item) — now that the format is decided (comma-separated
 * on the CLI), it and marketWatchExtraSources (added same day, same format:
 * "owner/repo" entries) share a string-list parsing path distinct from the
 * numeric one the other keys use.
 */
import { type SharedConfig } from "../config/config.js";
export declare const NUMERIC_EDITABLE_KEYS: readonly ["lockTimeoutMinutes", "auditCadenceDays", "wipLimit"];
export type NumericEditableKey = (typeof NUMERIC_EDITABLE_KEYS)[number];
export declare const STRING_LIST_EDITABLE_KEYS: readonly ["refreshProjectsExclusions", "marketWatchExtraSources", "refreshProjectsRoots"];
export declare const EDITABLE_KEYS: readonly ["lockTimeoutMinutes", "auditCadenceDays", "wipLimit", "refreshProjectsExclusions", "marketWatchExtraSources", "refreshProjectsRoots"];
export declare function showSynapseConfig(pluginDataDir: string): Promise<SharedConfig>;
export declare function setSynapseConfig(pluginDataDir: string, key: string, rawValue: string): Promise<SharedConfig>;
/**
 * Removes a machine from the hub's device registry (12/10/2026).
 *
 * `recordMachineSeen` only ever added, and `knownMachines` is deliberately
 * absent from EDITABLE_KEYS (it is machine-managed, like lastAuditAt), so a
 * retired machine — handed back, its git-crypt key revoked — stayed listed
 * with no command able to remove it. The only way left was hand-editing the
 * hub's config.json, the exact thing /synapse-config exists to avoid.
 *
 * Locked, unlike recordMachineSeen: that one tolerates a lost update because
 * a stale timestamp self-corrects next session, whereas a lost update here
 * would silently resurrect the entry we just removed.
 */
export declare function forgetMachine(pluginDataDir: string, machineId: string): Promise<SharedConfig>;
