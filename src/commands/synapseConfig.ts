/**
 * /synapse-config show/set — commande-driven config editing (problème 2:
 * "jamais d'édition manuelle de fichier requise"). Only a deliberately
 * narrow subset of SharedConfig is user-editable: ragEmbeddingModelVersion
 * and lastAuditAt are machine-managed (set by the code, not the user, per
 * their own design sections), version is a schema marker, and
 * refreshProjectsExclusions has no settled format yet (problème 6 backlog)
 * — exposing them for hand-editing here would just invite a bad write.
 */

import { readLocalConfig, defaultLocalConfigPath, readSharedConfig, writeSharedConfig, DEFAULT_SHARED_CONFIG, type SharedConfig } from "../config/config.js";
import { acquireLock, releaseLock } from "../lock/lock.js";

export const EDITABLE_KEYS = ["lockTimeoutMinutes", "auditCadenceDays"] as const;
export type EditableKey = (typeof EDITABLE_KEYS)[number];

export async function showSynapseConfig(pluginDataDir: string): Promise<SharedConfig> {
  const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));
  return readSharedConfig(local.hubClonePath);
}

export async function setSynapseConfig(pluginDataDir: string, key: string, rawValue: string): Promise<SharedConfig> {
  if (!(EDITABLE_KEYS as readonly string[]).includes(key)) {
    throw new Error(
      `synapse: clé "${key}" non modifiable via /synapse-config set. Clés valides : ${EDITABLE_KEYS.join(", ")}.`,
    );
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`synapse: valeur invalide "${rawValue}" pour "${key}" — un nombre positif est attendu.`);
  }

  const local = readLocalConfig(defaultLocalConfigPath(pluginDataDir));

  const lockResult = acquireLock(local.hubClonePath, local.machineId, DEFAULT_SHARED_CONFIG.lockTimeoutMinutes);
  if (!lockResult.acquired) {
    throw new Error(
      `synapse: verrou du hub déjà détenu par "${lockResult.heldBy}" depuis ${lockResult.since} — réessayer dans un instant.`,
    );
  }
  try {
    const current = readSharedConfig(local.hubClonePath);
    const updated: SharedConfig = { ...current, [key as EditableKey]: value };
    writeSharedConfig(local.hubClonePath, updated);
    return updated;
  } finally {
    releaseLock(local.hubClonePath, local.machineId);
  }
}
