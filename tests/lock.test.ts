import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, releaseLock } from "../src/lock/lock.js";

let hubDir: string;

beforeEach(() => {
  hubDir = mkdtempSync(join(tmpdir(), "synapse-lock-"));
  mkdirSync(join(hubDir, ".synapse"), { recursive: true });
});

afterEach(() => {
  rmSync(hubDir, { recursive: true, force: true });
});

describe("acquireLock", () => {
  it("acquires freely when no lock exists", () => {
    const result = acquireLock(hubDir, "workstation-a", 10);
    expect(result.acquired).toBe(true);
  });

  it("refuses when another machine holds a fresh lock", () => {
    acquireLock(hubDir, "workstation-a", 10);
    const result = acquireLock(hubDir, "workstation-b", 10);
    expect(result.acquired).toBe(false);
    if (!result.acquired) {
      expect(result.heldBy).toBe("workstation-a");
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
