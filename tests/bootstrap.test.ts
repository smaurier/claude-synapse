import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "../src/config/bootstrap.js";
import { DEFAULT_SHARED_CONFIG, writeSharedConfig } from "../src/config/config.js";

let root: string;
let localConfigPath: string;
let hubClonePath: string;
let linkPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-bootstrap-"));
  localConfigPath = join(root, "local-config.json");
  hubClonePath = join(root, "hub");
  linkPath = join(root, "project", "memory");
  mkdirSync(join(root, "project"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("bootstrap — order of operations", () => {
  it("runs the 5 steps in order: local config -> clone/pull -> read shared config -> link -> verify", async () => {
    const calls: string[] = [];

    const cloneOrPullHub = vi.fn(async () => {
      calls.push("clone-or-pull");
      mkdirSync(hubClonePath, { recursive: true });
    });
    const createHubLink = vi.fn(() => {
      calls.push("create-link");
    });
    const verifyLink = vi.fn(() => {
      calls.push("verify-link");
      return true;
    });

    await bootstrap({
      hubUrl: "git@github.com:example-user/my-hub.git",
      localConfigPath,
      hubClonePath,
      linkPath,
      machineId: "workstation-a",
      cloneOrPullHub,
      createHubLink,
      verifyLink,
    });

    // Local config is written synchronously before anything else happens —
    // capture that separately since it's not one of the injected calls.
    expect(existsSync(localConfigPath)).toBe(true);
    expect(calls).toEqual(["clone-or-pull", "create-link", "verify-link"]);
  });

  it("first machine ever: no shared config in the freshly-cloned hub -> creates defaults", async () => {
    const cloneOrPullHub = vi.fn(async () => {
      mkdirSync(hubClonePath, { recursive: true }); // empty hub, nothing written yet
    });

    const result = await bootstrap({
      hubUrl: "git@github.com:example-user/my-hub.git",
      localConfigPath,
      hubClonePath,
      linkPath,
      machineId: "workstation-a",
      cloneOrPullHub,
      createHubLink: vi.fn(),
      verifyLink: vi.fn(() => true),
    });

    expect(result.sharedConfig).toEqual(DEFAULT_SHARED_CONFIG);
    expect(existsSync(join(hubClonePath, ".synapse", "config.json"))).toBe(true);
  });

  it("nth machine: shared config already exists in the hub -> reads it, never overwrites", async () => {
    const cloneOrPullHub = vi.fn(async () => {
      mkdirSync(hubClonePath, { recursive: true });
      writeSharedConfig(hubClonePath, { ...DEFAULT_SHARED_CONFIG, lockTimeoutMinutes: 42 });
    });

    const result = await bootstrap({
      hubUrl: "git@github.com:example-user/my-hub.git",
      localConfigPath,
      hubClonePath,
      linkPath,
      machineId: "workstation-b",
      cloneOrPullHub,
      createHubLink: vi.fn(),
      verifyLink: vi.fn(() => true),
    });

    expect(result.sharedConfig.lockTimeoutMinutes).toBe(42);
  });

  it("throws if post-install verification fails, rather than reporting silent success", async () => {
    const cloneOrPullHub = vi.fn(async () => {
      mkdirSync(hubClonePath, { recursive: true });
    });

    await expect(
      bootstrap({
        hubUrl: "git@github.com:example-user/my-hub.git",
        localConfigPath,
        hubClonePath,
        linkPath,
        machineId: "workstation-a",
        cloneOrPullHub,
        createHubLink: vi.fn(),
        verifyLink: vi.fn(() => false),
      }),
    ).rejects.toThrow(/v.rification/i);
  });
});
