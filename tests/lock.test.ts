import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, acquireLockWithRetry, releaseLock } from "../src/lock/lock.js";
import { rmTree } from "./helpers/fsTemp.js";

let hubDir: string;

beforeEach(() => {
  hubDir = mkdtempSync(join(tmpdir(), "synapse-lock-"));
  mkdirSync(join(hubDir, ".synapse"), { recursive: true });
});

afterEach(() => {
  rmTree(hubDir);
});

describe("acquireLock", () => {
  it("acquires on a freshly cloned hub with no .synapse/ directory yet", () => {
    const freshHub = mkdtempSync(join(tmpdir(), "synapse-lock-fresh-"));
    try {
      const result = acquireLock(freshHub, "workstation-a", 10);
      expect(result.acquired).toBe(true);
    } finally {
      rmTree(freshHub);
    }
  });

  it("acquires freely when no lock exists", () => {
    const result = acquireLock(hubDir, "workstation-a", 10);
    expect(result.acquired).toBe(true);
  });

  it("refuses when another machine holds a fresh lock", () => {
    acquireLock(hubDir, "workstation-a", 10);
    const result = acquireLock(hubDir, "workstation-b", 10);
    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.heldBy).toContain("workstation-a");
    }
  });

  it("lets the SAME machine re-acquire its own lock (retry-safe)", () => {
    acquireLock(hubDir, "workstation-a", 10);
    const result = acquireLock(hubDir, "workstation-a", 10);
    expect(result.acquired).toBe(true);
  });

  it("reclaims a stale lock past the timeout — a crashed machine must not block forever", () => {
    const past = new Date(Date.now() - 11 * 60_000); // 11 minutes ago, timeout is 10
    acquireLock(hubDir, "workstation-b", 10, past);
    const result = acquireLock(hubDir, "workstation-a", 10);
    expect(result.acquired).toBe(true);
  });

  it("does NOT reclaim a lock that is old but still within the timeout window", () => {
    const recent = new Date(Date.now() - 5 * 60_000); // 5 minutes ago, timeout is 10
    acquireLock(hubDir, "workstation-b", 10, recent);
    const result = acquireLock(hubDir, "workstation-a", 10);
    expect(result.acquired).toBe(false);
  });
});

describe("releaseLock", () => {
  it("releases a lock held by the same machine", () => {
    acquireLock(hubDir, "workstation-a", 10);
    releaseLock(hubDir, "workstation-a");
    const result = acquireLock(hubDir, "workstation-b", 10);
    expect(result.acquired).toBe(true);
  });

  it("is a safe no-op when called by a machine that doesn't hold the lock (never steals a valid lock)", () => {
    acquireLock(hubDir, "workstation-a", 10);
    releaseLock(hubDir, "workstation-b"); // workstation-b never held it
    const result = acquireLock(hubDir, "workstation-b", 10);
    expect(result.acquired).toBe(false); // workstation-a's lock is still standing
  });

  it("is a safe no-op when no lock exists at all", () => {
    expect(() => releaseLock(hubDir, "workstation-a")).not.toThrow();
  });
});

// 15/11/2026 : deux sessions Claude sur le MEME poste (ex. Nayeli + un ticket)
// partagent le meme machineId. Le verrou leur etait accorde a toutes les deux,
// et la premiere qui finissait retirait celui de l'autre. L'identite du
// detenteur est desormais machineId + pid.
describe("acquireLock, deux processus sur le même poste", () => {
  it("refuses a second LIVE process on the same machine", () => {
    acquireLock(hubDir, "workstation-a", 10, new Date(), process.ppid); // parent process: alive
    const result = acquireLock(hubDir, "workstation-a", 10, new Date(), process.pid);
    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.heldBy).toContain("workstation-a");
      expect(result.heldBy).toContain(String(process.ppid));
    }
  });

  it("reclaims at once a lock left by a DEAD process on the same machine", () => {
    const deadPid = spawnSync(process.execPath, ["-e", ""]).pid as number;
    acquireLock(hubDir, "workstation-a", 10, new Date(), deadPid);
    const result = acquireLock(hubDir, "workstation-a", 10, new Date(), process.pid);
    expect(result.acquired).toBe(true);
  });

  it("reclaims a same-machine lock written before pids existed (format 0.1.13)", () => {
    writeFileSync(
      join(hubDir, ".synapse", ".sync-lock"),
      JSON.stringify({ machineId: "workstation-a", acquiredAt: new Date().toISOString() }),
      "utf8",
    );
    const result = acquireLock(hubDir, "workstation-a", 10, new Date(), process.pid);
    expect(result.acquired).toBe(true);
  });

  it("release by another process of the same machine is a no-op", () => {
    acquireLock(hubDir, "workstation-a", 10, new Date(), process.ppid);
    releaseLock(hubDir, "workstation-a", process.pid);
    const result = acquireLock(hubDir, "workstation-a", 10, new Date(), process.pid);
    expect(result.acquired).toBe(false);
  });
});

describe("acquireLockWithRetry", () => {
  it("waits for the holder to release, then acquires", async () => {
    acquireLock(hubDir, "workstation-a", 10, new Date(), process.ppid);
    setTimeout(() => releaseLock(hubDir, "workstation-a", process.ppid), 300);
    const result = await acquireLockWithRetry(hubDir, "workstation-a", 10, { waitMs: 5_000, intervalMs: 50 });
    expect(result.acquired).toBe(true);
  });

  it("gives up after waitMs when the holder never releases", async () => {
    acquireLock(hubDir, "workstation-a", 10, new Date(), process.ppid);
    const started = Date.now();
    const result = await acquireLockWithRetry(hubDir, "workstation-a", 10, { waitMs: 200, intervalMs: 50 });
    expect(result.acquired).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
