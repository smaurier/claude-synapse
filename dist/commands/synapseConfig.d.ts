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
export declare const NUMERIC_EDITABLE_KEYS: readonly ["lockTimeoutMinutes", "auditCadenceDays", "wipLimit", "mergeCandidatesMaxFiles"];
export type NumericEditableKey = (typeof NUMERIC_EDITABLE_KEYS)[number];
export declare const STRING_LIST_EDITABLE_KEYS: readonly ["refreshProjectsExclusions", "marketWatchExtraSources", "refreshProjectsRoots"];
export declare const EDITABLE_KEYS: readonly ["lockTimeoutMinutes", "auditCadenceDays", "wipLimit", "mergeCandidatesMaxFiles", "refreshProjectsExclusions", "marketWatchExtraSources", "refreshProjectsRoots"];
export declare function showSynapseConfig(pluginDataDir: string): Promise<SharedConfig>;
export declare function setSynapseConfig(pluginDataDir: string, key: string, rawValue: string): Promise<SharedConfig>;
