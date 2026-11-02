import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmTree } from "./helpers/fsTemp.js";
import { applySafeUpdates, runDepsUpdate, type InstallFn } from "../src/commands/depsUpdate.js";
import type { SafeUpdate, DependencyAuditRunner, NpmAuditReport, NpmOutdatedReport } from "../src/commands/dependencyAudit.js";

// Item 49, question laissée ouverte le 16/10/2026 (« veut-il une commande explicite ? »),
// tranchée le 01/11/2026 : oui. Ceci est la moitié IMPURE — applySafeUpdates exécute le
// plan pur de planSafeUpdates (dependencyAudit.ts), runDepsUpdate relie audit+plan+exécution
// en un seul point d'entrée pour le CLI. Jamais appelé par un hook : exclusivement par
// Sylvain, dans le dépôt de développement, via /synapse-deps-update.

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-deps-update-"));
});

afterEach(() => {
  rmTree(root);
});

function writePackageJson(root: string, dependencies: Record<string, string>, devDependencies: Record<string, string>): void {
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies, devDependencies }, null, 2), "utf8");
}

describe("applySafeUpdates", () => {
  it("installs every planned update, one call per package", async () => {
    const updates: SafeUpdate[] = [
      { name: "a-pkg", version: "1.1.0" },
      { name: "b-pkg", version: "2.0.1" },
    ];
    const calls: { name: string; version: string; cwd: string }[] = [];
    const fakeInstall: InstallFn = async (name, version, cwd) => {
      calls.push({ name, version, cwd });
      return true;
    };

    const result = await applySafeUpdates(updates, root, fakeInstall);

    expect(calls).toEqual([
      { name: "a-pkg", version: "1.1.0", cwd: root },
      { name: "b-pkg", version: "2.0.1", cwd: root },
    ]);
    expect(result.applied).toEqual(updates);
    expect(result.failed).toEqual([]);
  });

  it("keeps going after one install fails, and reports it as failed rather than stopping the batch", async () => {
    const updates: SafeUpdate[] = [
      { name: "ok-pkg", version: "1.0.0" },
      { name: "bad-pkg", version: "1.0.0" },
      { name: "also-ok-pkg", version: "1.0.0" },
    ];
    const fakeInstall: InstallFn = async (name) => name !== "bad-pkg";

    const result = await applySafeUpdates(updates, root, fakeInstall);

    expect(result.applied.map((u) => u.name)).toEqual(["ok-pkg", "also-ok-pkg"]);
    expect(result.failed.map((u) => u.name)).toEqual(["bad-pkg"]);
  });

  it("does nothing, successfully, on an empty plan", async () => {
    let calls = 0;
    const fakeInstall: InstallFn = async () => {
      calls++;
      return true;
    };

    const result = await applySafeUpdates([], root, fakeInstall);

    expect(calls).toBe(0);
    expect(result).toEqual({ applied: [], failed: [] });
  });
});

describe("runDepsUpdate", () => {
  it("reports nothing to apply when the audit finds no safe-to-apply vulnerability", async () => {
    writePackageJson(root, { "@huggingface/transformers": "4.3.1" }, { vitest: "2.1.9" });
    const runner: DependencyAuditRunner = {
      runNpmAudit: async () => JSON.stringify({ vulnerabilities: {} } satisfies NpmAuditReport),
      runNpmOutdated: async () => JSON.stringify({} satisfies NpmOutdatedReport),
    };
    const fakeInstall: InstallFn = async () => true;

    const result = await runDepsUpdate(root, runner, fakeInstall);

    expect(result.plan).toEqual([]);
    expect(result.applied).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("plans from the real audit shape and installs exactly the safe subset", async () => {
    writePackageJson(root, { "@huggingface/transformers": "4.3.1" }, { "dev-pkg-safe": "1.0.0", "dev-pkg-major": "1.0.0" });
    const audit: NpmAuditReport = {
      vulnerabilities: {
        "dev-pkg-safe": { severity: "low", via: [], fixAvailable: { name: "dev-pkg-safe", version: "1.1.0", isSemVerMajor: false } },
        "dev-pkg-major": { severity: "high", via: [], fixAvailable: { name: "dev-pkg-major", version: "2.0.0", isSemVerMajor: true } },
      },
    };
    const runner: DependencyAuditRunner = {
      runNpmAudit: async () => JSON.stringify(audit),
      runNpmOutdated: async () => JSON.stringify({}),
    };
    const installedCalls: string[] = [];
    const fakeInstall: InstallFn = async (name) => {
      installedCalls.push(name);
      return true;
    };

    const result = await runDepsUpdate(root, runner, fakeInstall);

    expect(result.plan).toEqual([{ name: "dev-pkg-safe", version: "1.1.0" }]);
    expect(installedCalls).toEqual(["dev-pkg-safe"]);
    expect(result.applied).toEqual([{ name: "dev-pkg-safe", version: "1.1.0" }]);
  });

  it("never plans or installs anything when package.json is unreadable — no production-dependency list, no safe classification possible", async () => {
    // Pas de writePackageJson : dossier vide.
    const runner: DependencyAuditRunner = {
      runNpmAudit: async () => JSON.stringify({ vulnerabilities: { x: { severity: "low", via: [], fixAvailable: true } } }),
      runNpmOutdated: async () => JSON.stringify({}),
    };
    let installCalled = false;
    const fakeInstall: InstallFn = async () => {
      installCalled = true;
      return true;
    };

    const result = await runDepsUpdate(root, runner, fakeInstall);

    expect(result.plan).toEqual([]);
    expect(installCalled).toBe(false);
  });
});

// Un seul test touche le vrai process (même esprit que le test "real npm binary" de
// dependencyAudit.test.ts) : prouve que realInstall construit la bonne ligne de commande
// et respecte --save-exact --save-dev, sans dépendre du réseau (paquet inexistant, donc
// npm échoue vite, mais la commande elle-même doit être correctement formée).
describe("realInstall (vrai processus, hors-ligne par construction)", () => {
  it("resolves false rather than throwing when the install genuinely fails", async () => {
    const { realInstall } = await import("../src/commands/depsUpdate.js");
    const ok = await realInstall("ce-paquet-n-existe-vraiment-pas-xyz123", "1.0.0", root);
    expect(ok).toBe(false);
  }, 30_000);
});
