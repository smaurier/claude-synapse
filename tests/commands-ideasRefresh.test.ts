import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTree } from "./helpers/fsTemp.js";
import { readSharedConfig, writeSharedConfig, DEFAULT_SHARED_CONFIG } from "../src/config/config.js";
import { acquireLock } from "../src/lock/lock.js";
import { markIdeasRefreshed } from "../src/commands/ideasRefresh.js";

// L'autre moitié du mécanisme daemon-less de l'item 54 (voir refreshIndex.ts) : une
// fois que le skill a vraiment fait le travail de synthèse (lecture + jugement, donc
// hors de portée d'un hook), c'est CE commande que le skill appelle pour faire avancer
// l'horloge — même geste que synapseDoctor.ts fait pour lastAuditAt (verrouillé, parce
// que deux postes peuvent écrire la config partagée en même temps).
let root: string;
let hubDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-ideas-refresh-"));
  hubDir = join(root, "hub");
  mkdirSync(hubDir, { recursive: true });
});

afterEach(() => {
  rmTree(root);
});

describe("markIdeasRefreshed", () => {
  it("records lastIdeasRefreshAt as now", () => {
    const before = Date.now();
    const result = markIdeasRefreshed(hubDir, "test-machine");
    const after = Date.now();

    expect(result.written).toBe(true);
    const recorded = new Date(readSharedConfig(hubDir).lastIdeasRefreshAt!).getTime();
    expect(recorded).toBeGreaterThanOrEqual(before);
    expect(recorded).toBeLessThanOrEqual(after);
  });

  it("does not touch unrelated shared config fields", () => {
    writeSharedConfig(hubDir, { ...DEFAULT_SHARED_CONFIG, wipLimit: 9 });

    markIdeasRefreshed(hubDir, "test-machine");

    expect(readSharedConfig(hubDir).wipLimit).toBe(9);
  });

  it("reports written: false, without throwing, when another machine holds the lock", () => {
    acquireLock(hubDir, "other-machine", DEFAULT_SHARED_CONFIG.lockTimeoutMinutes);

    const result = markIdeasRefreshed(hubDir, "test-machine");

    expect(result.written).toBe(false);
    expect(readSharedConfig(hubDir).lastIdeasRefreshAt).toBeNull();
  });
});
