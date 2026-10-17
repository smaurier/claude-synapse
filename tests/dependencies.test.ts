import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ensureDependencies,
  resolvePluginRoot,
  dependenciesMarkerPath,
  productionDependenciesPresent,
  resolveNpmBinary,
  npmInstallProd,
} from "../src/config/dependencies.js";
import { rmTree } from "./helpers/fsTemp.js";

// Found 24/08 while resuming the jonction work: a plugin installed via
// `claude plugin marketplace add` + `claude plugin install` (a plain git
// clone, confirmed by checking two real installs — no `npm install`, no
// `npm run build` runs automatically) ships neither dist/ (fixed by
// committing it, a packaging change) nor node_modules (this file's fix) —
// every hook and skill would fail on a genuinely fresh install. This lets
// the hooks that MUST run unattended (SessionStart/PostCompact/SessionEnd)
// self-heal once, rather than requiring a manual `npm install` step nobody
// documented anywhere a fresh user would see.

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-deps-"));
});

afterEach(() => {
  rmTree(root);
});

describe("ensureDependencies", () => {
  it("runs the install when node_modules is absent", () => {
    const install = vi.fn();

    ensureDependencies(root, install);

    expect(install).toHaveBeenCalledWith(root);
  });

  it("does nothing when the completion marker is present — never reinstalls on every session", () => {
    mkdirSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(dependenciesMarkerPath(root), "");
    const install = vi.fn();

    ensureDependencies(root, install);

    expect(install).not.toHaveBeenCalled();
  });

  // Backlog 52 (17/10/2026) : sur la tour, le premier `npm install` du cache
  // 0.1.7 (675 Mo) a pris plus de 6 min 40 s DANS un hook SessionStart de
  // 120 s. Un hook tué au milieu laissait un node_modules partiel que
  // l'ancien test « le dossier existe » prenait pour complet, à jamais.
  // Le marqueur n'est écrit qu'APRÈS le retour de l'installateur : une
  // install interrompue est simplement reprise à la session suivante.
  it("reinstalls when node_modules exists WITHOUT the completion marker (install killed mid-way)", () => {
    mkdirSync(join(root, "node_modules", "some-half-extracted-package"), { recursive: true });
    const install = vi.fn();

    ensureDependencies(root, install);

    expect(install).toHaveBeenCalledWith(root);
  });

  it("writes the completion marker only after the installer returned", () => {
    let markerDuringInstall: boolean | null = null;
    const install = vi.fn((r: string) => {
      mkdirSync(join(r, "node_modules"), { recursive: true });
      markerDuringInstall = existsSync(dependenciesMarkerPath(r));
    });

    ensureDependencies(root, install);

    expect(markerDuringInstall).toBe(false);
    expect(existsSync(dependenciesMarkerPath(root))).toBe(true);
  });

  it("leaves no marker behind when the installer throws", () => {
    const install = vi.fn(() => {
      throw new Error("npm exploded");
    });

    expect(() => ensureDependencies(root, install)).toThrow(/npm exploded/);
    expect(existsSync(dependenciesMarkerPath(root))).toBe(false);
  });

  it("puts the marker inside node_modules, so wiping node_modules by hand also wipes the marker", () => {
    expect(dependenciesMarkerPath(root)).toBe(join(root, "node_modules", ".synapse-deps-complete"));
  });
});

// Deuxième constat du 17/10/2026, en testant la 0.1.8 sur la tour : c'est le
// gestionnaire de plugins de Claude Code qui installe node_modules lui-même
// (`claude plugin update` a rempli le cache 0.1.8 en 8 s, 173 entrées dev
// incluses, AVANT tout hook). Sans marqueur, la règle « pas de marqueur =
// reprise » relançait npm install sur une installation complète à chaque
// nouveau cache. On reconnaît donc une installation complète par son contenu :
// chaque dépendance de production de package.json a son package.json dans
// node_modules. Le marqueur reste le raccourci pour les sessions suivantes.
describe("ensureDependencies — installation faite par un tiers (gestionnaire de plugins)", () => {
  function writePluginPackageJson(r: string, deps: Record<string, string>): void {
    writeFileSync(join(r, "package.json"), JSON.stringify({ name: "p", dependencies: deps }));
  }

  it("productionDependenciesPresent : vrai quand chaque dépendance de production a son package.json", () => {
    writePluginPackageJson(root, { "@scope/lib": "1.0.0", other: "2.0.0" });
    mkdirSync(join(root, "node_modules", "@scope", "lib"), { recursive: true });
    writeFileSync(join(root, "node_modules", "@scope", "lib", "package.json"), "{}");
    mkdirSync(join(root, "node_modules", "other"), { recursive: true });
    writeFileSync(join(root, "node_modules", "other", "package.json"), "{}");

    expect(productionDependenciesPresent(root)).toBe(true);
  });

  it("productionDependenciesPresent : faux dès qu'une dépendance de production manque (install partielle)", () => {
    writePluginPackageJson(root, { "@scope/lib": "1.0.0", other: "2.0.0" });
    mkdirSync(join(root, "node_modules", "other"), { recursive: true });
    writeFileSync(join(root, "node_modules", "other", "package.json"), "{}");

    expect(productionDependenciesPresent(root)).toBe(false);
  });

  it("n'installe pas quand les dépendances de production sont déjà là sans marqueur, et pose le marqueur", () => {
    writePluginPackageJson(root, { lib: "1.0.0" });
    mkdirSync(join(root, "node_modules", "lib"), { recursive: true });
    writeFileSync(join(root, "node_modules", "lib", "package.json"), "{}");
    const install = vi.fn();

    ensureDependencies(root, install);

    expect(install).not.toHaveBeenCalled();
    expect(existsSync(dependenciesMarkerPath(root))).toBe(true);
  });

  it("installe quand node_modules existe mais qu'une dépendance de production manque", () => {
    writePluginPackageJson(root, { lib: "1.0.0", missing: "1.0.0" });
    mkdirSync(join(root, "node_modules", "lib"), { recursive: true });
    writeFileSync(join(root, "node_modules", "lib", "package.json"), "{}");
    const install = vi.fn();

    ensureDependencies(root, install);

    expect(install).toHaveBeenCalledWith(root);
  });
});

// Troisième constat du 17/10/2026 : `execFileSync("npm", ...)` lève
// `spawnSync npm ENOENT` sous Windows (le binaire s'appelle npm.cmd, et Node
// refuse d'exécuter un .cmd sans shell depuis CVE-2024-27980). L'auto-
// réparation n'a donc JAMAIS marché sur les deux postes Windows de Sylvain ;
// personne ne l'avait vu parce que le gestionnaire de plugins installait
// avant. Même correctif que runNpmJson dans dependencyAudit.ts (16/10).
describe("npmInstallProd — Windows", () => {
  it("resolveNpmBinary : npm.cmd sous win32, npm ailleurs", () => {
    expect(resolveNpmBinary("win32")).toBe("npm.cmd");
    expect(resolveNpmBinary("linux")).toBe("npm");
    expect(resolveNpmBinary("darwin")).toBe("npm");
  });

  it("lance le binaire résolu pour la plateforme courante, via un shell, dans le dossier du plugin", () => {
    const run = vi.fn();

    npmInstallProd(root, run);

    expect(run).toHaveBeenCalledTimes(1);
    const [command, args, options] = run.mock.calls[0] as [string, string[], { cwd: string; shell: boolean }];
    expect(command).toBe(resolveNpmBinary(process.platform));
    expect(args).toEqual(["install", "--omit=dev", "--no-audit", "--no-fund"]);
    expect(options.cwd).toBe(root);
    expect(options.shell).toBe(true);
  });
});

describe("resolvePluginRoot", () => {
  it("derives the plugin root two directory levels up from a dist/commands/*.js module URL", () => {
    // A real plugin, once dist/ is committed and this runs from the compiled
    // output, sits at <pluginRoot>/dist/commands/<name>Cli.js — this is the
    // exact shape ${CLAUDE_PLUGIN_ROOT} substitution produces (see the doc
    // comment on defaultLocalConfigPath for why this is derived from the
    // running module's own path rather than an env var).
    const pluginRoot = join(root, "some-plugin-root");
    mkdirSync(join(pluginRoot, "dist", "commands"), { recursive: true });
    const modulePath = join(pluginRoot, "dist", "commands", "refreshIndexCli.js");

    expect(resolvePluginRoot(pathToFileURL(modulePath).href)).toBe(pluginRoot);
    // Sanity: the module path really is 3 directories below what we assert
    // (filename -> commands/ -> dist/ -> pluginRoot).
    expect(dirname(dirname(dirname(fileURLToPath(pathToFileURL(modulePath).href))))).toBe(pluginRoot);
  });
});
