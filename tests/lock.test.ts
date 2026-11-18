import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  acquireLock,
  acquireLockWithRetry,
  releaseLock,
  syncLockTakeoverPath,
  takeOverStaleSyncLock,
} from "../src/lock/lock.js";
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

// 18/11/2026 : même enchaînement « lire, supprimer, créer » que le verrou de
// refresh corrigé en 0.1.16. Sonde jetable sur la 0.1.16, huit processus lancés
// ensemble devant le verrou d'un processus mort : deux à sept tenants à chaque
// tour (20 sur 20), et des plantages ENOENT quand un autre avait déjà supprimé
// le fichier. L'enjeu ici : deux opérations git en même temps dans le hub.
describe("reprise du verrou du hub à plusieurs", () => {
  const lockFile = (): string => join(hubDir, ".synapse", ".sync-lock");
  const holderOnDisk = (): unknown => JSON.parse(readFileSync(lockFile(), "utf8"));
  const deadHolder = (): { machineId: string; pid: number; acquiredAt: string } => ({
    machineId: "workstation-a",
    pid: spawnSync(process.execPath, ["-e", ""]).pid as number,
    acquiredAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const writeLock = (holder: object): void => writeFileSync(lockFile(), JSON.stringify(holder), "utf8");

  it("ne supprime pas le verrou qu'un autre vient de reprendre", () => {
    const observedBeforeTheOtherTookOver = deadHolder();
    acquireLock(hubDir, "workstation-a", 10, new Date(), process.ppid);
    const freshLock = holderOnDisk();

    const took = takeOverStaleSyncLock(hubDir, observedBeforeTheOtherTookOver, "workstation-a", process.pid, new Date());

    expect(took).toBe(false);
    expect(holderOnDisk()).toEqual(freshLock);
  });

  it("ne plante pas quand le verrou périmé a déjà disparu, et le prend", () => {
    const vanished = deadHolder();

    const took = takeOverStaleSyncLock(hubDir, vanished, "workstation-a", process.pid, new Date());

    expect(took).toBe(true);
    expect(holderOnDisk()).toMatchObject({ machineId: "workstation-a", pid: process.pid });
  });

  it("laisse la main quand un autre processus est déjà en train de reprendre", () => {
    const dead = deadHolder();
    writeLock(dead);
    writeFileSync(syncLockTakeoverPath(hubDir), "");

    const result = acquireLock(hubDir, "workstation-a", 10, new Date(), process.pid);

    expect(result.acquired).toBe(false);
    expect(holderOnDisk()).toEqual(dead);
  });

  it("passe outre une reprise abandonnée en route", () => {
    writeLock(deadHolder());
    writeFileSync(syncLockTakeoverPath(hubDir), "");
    const aMinuteAgo = new Date(Date.now() - 60_000);
    utimesSync(syncLockTakeoverPath(hubDir), aMinuteAgo, aMinuteAgo);

    expect(acquireLock(hubDir, "workstation-a", 10, new Date(), process.pid).acquired).toBe(true);
  });

  it("ne laisse aucune trace de la reprise une fois le verrou pris", () => {
    writeLock(deadHolder());

    acquireLock(hubDir, "workstation-a", 10, new Date(), process.pid);

    expect(existsSync(syncLockTakeoverPath(hubDir))).toBe(false);
  });

  it("ne plante pas sur un verrou pris entre sa création et son écriture, et ne le reprend pas", () => {
    writeFileSync(lockFile(), "");

    const result = acquireLock(hubDir, "workstation-a", 10, new Date(), process.pid);

    expect(result.acquired).toBe(false);
    expect(readFileSync(lockFile(), "utf8")).toBe("");
  });

  it("le marqueur de reprise vit à côté du verrou, dans .synapse/", () => {
    expect(dirname(syncLockTakeoverPath(hubDir))).toBe(join(hubDir, ".synapse"));
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
