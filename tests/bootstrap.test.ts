import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "../src/config/bootstrap.js";
import { DEFAULT_SHARED_CONFIG, writeSharedConfig } from "../src/config/config.js";
import { rmTree } from "./helpers/fsTemp.js";

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
  rmTree(root);
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
      return true;
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
      createHubLink: vi.fn(() => true),
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
      createHubLink: vi.fn(() => true),
      verifyLink: vi.fn(() => true),
    });

    expect(result.sharedConfig.lockTimeoutMinutes).toBe(42);
  });

  it("applies a corpusRoot override on first bootstrap — the 'adopt an existing directory' path", async () => {
    const cloneOrPullHub = vi.fn(async () => {
      mkdirSync(hubClonePath, { recursive: true }); // fresh hub, no shared config yet
    });

    const result = await bootstrap({
      hubUrl: "git@github.com:example-user/my-hub.git",
      localConfigPath,
      hubClonePath,
      linkPath,
      machineId: "workstation-a",
      corpusRoot: "memory",
      cloneOrPullHub,
      createHubLink: vi.fn(() => true),
      verifyLink: vi.fn(() => true),
    });

    expect(result.sharedConfig.corpusRoot).toBe("memory");
  });

  it("leaves an existing hub's corpusRoot untouched when no override is given", async () => {
    const cloneOrPullHub = vi.fn(async () => {
      mkdirSync(hubClonePath, { recursive: true });
      writeSharedConfig(hubClonePath, { ...DEFAULT_SHARED_CONFIG, corpusRoot: "memory" });
    });

    const result = await bootstrap({
      hubUrl: "git@github.com:example-user/my-hub.git",
      localConfigPath,
      hubClonePath,
      linkPath,
      machineId: "workstation-b",
      // no corpusRoot passed — a second machine re-running /synapse-init
      // plain must not silently reset what the first machine configured.
      cloneOrPullHub,
      createHubLink: vi.fn(() => true),
      verifyLink: vi.fn(() => true),
    });

    expect(result.sharedConfig.corpusRoot).toBe("memory");
  });

  it("acquires and releases the whole-repo lock around the shared-config write, leaving no lock behind", async () => {
    const cloneOrPullHub = vi.fn(async () => {
      mkdirSync(hubClonePath, { recursive: true });
    });

    await bootstrap({
      hubUrl: "git@github.com:example-user/my-hub.git",
      localConfigPath,
      hubClonePath,
      linkPath,
      machineId: "workstation-a",
      cloneOrPullHub,
      createHubLink: vi.fn(() => true),
      verifyLink: vi.fn(() => true),
    });

    expect(existsSync(join(hubClonePath, ".synapse", ".sync-lock"))).toBe(false);
  });

  it("refuses to bootstrap while another machine holds a fresh lock on the hub", async () => {
    const cloneOrPullHub = vi.fn(async () => {
      mkdirSync(join(hubClonePath, ".synapse"), { recursive: true });
      writeFileSync(
        join(hubClonePath, ".synapse", ".sync-lock"),
        JSON.stringify({ machineId: "workstation-b", acquiredAt: new Date().toISOString() }),
      );
    });

    await expect(
      bootstrap({
        hubUrl: "git@github.com:example-user/my-hub.git",
        localConfigPath,
        hubClonePath,
        linkPath,
        machineId: "workstation-a",
        cloneOrPullHub,
        createHubLink: vi.fn(() => true),
        verifyLink: vi.fn(() => true),
      }),
    ).rejects.toThrow(/verrou/i);
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
        createHubLink: vi.fn(() => true),
        verifyLink: vi.fn(() => false),
      }),
    ).rejects.toThrow(/v.rification/i);
  });

  // Régression 03/10 : le correctif de la boucle de jonction (46a7fda) a ajouté
  // l'action skipped-inside-hub — ensureHubLink ne crée alors AUCUN lien. Mais
  // bootstrap vérifiait quand même l'écriture traversante, sur un chemin qui
  // n'existe pas : ENOENT brut au lieu du message de skip que le CLI sait déjà
  // formuler. Le garde protégeait, l'intégration le trahissait.
  it("ne vérifie rien quand createHubLink signale qu'aucun lien n'a été créé (chemin DANS le hub)", async () => {
    const cloneOrPullHub = vi.fn(async () => {
      mkdirSync(hubClonePath, { recursive: true });
    });
    const verifyLink = vi.fn(() => true);

    await expect(
      bootstrap({
        hubUrl: "git@github.com:example-user/my-hub.git",
        localConfigPath,
        hubClonePath,
        linkPath,
        machineId: "workstation-a",
        cloneOrPullHub,
        createHubLink: vi.fn(() => false),
        verifyLink,
      }),
    ).resolves.toBeDefined();

    expect(verifyLink).not.toHaveBeenCalled();
  });
});
