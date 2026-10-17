/**
 * A plugin installed the way `claude plugin marketplace add` +
 * `claude plugin install` actually work — confirmed 24/08 on two real
 * installs — is a plain `git clone`: no `npm install`, no
 * build step runs automatically. Committing dist/ (a packaging decision,
 * not code) solves half of that; this solves the other half, for the one
 * real npm dependency (@huggingface/transformers) this plugin has at
 * runtime. Rather than documenting "run npm install once after installing"
 * somewhere a fresh user would have to already know to look, the hooks that
 * run unattended (SessionStart/PostCompact/SessionEnd) self-heal on first
 * real invocation.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/** Sous Windows le binaire s'appelle `npm.cmd` ; `spawn("npm")` donne
 *  `ENOENT`. Même règle que pour l'audit des dépendances (dependencyAudit.ts,
 *  16/10/2026), désormais définie ici et réutilisée là-bas. */
export function resolveNpmBinary(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

type Runner = (command: string, args: string[], options: { cwd: string; stdio: "inherit"; shell: boolean; windowsHide: boolean }) => unknown;

/** The real installer, used everywhere except tests (which inject a fake).
 *
 *  Backlog 52 (17/10/2026) : `execFileSync("npm", ...)` levait
 *  `spawnSync npm ENOENT` sous Windows, donc l'auto-réparation n'a JAMAIS
 *  marché sur un poste Windows ; personne ne l'avait vu parce que le
 *  gestionnaire de plugins de Claude Code installe node_modules avant tout
 *  hook. `shell: true` est nécessaire en plus de `npm.cmd` : Node refuse
 *  d'exécuter un `.cmd` sans shell depuis CVE-2024-27980 (EINVAL). Les
 *  arguments sont des constantes du code, jamais une entrée utilisateur. */
export function npmInstallProd(pluginRoot: string, run: Runner = execFileSync as unknown as Runner): void {
  run(resolveNpmBinary(), ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: pluginRoot,
    stdio: "inherit",
    shell: true,
    windowsHide: true,
  });
}

/** Une installation est complète quand chaque dépendance de PRODUCTION de
 *  package.json a son propre package.json sous node_modules. C'est ce qui
 *  permet de reconnaître une installation faite par un tiers (le
 *  gestionnaire de plugins de Claude Code remplit node_modules lui-même,
 *  dépendances de dev incluses, avant tout hook ; constaté le 17/10/2026)
 *  sans la relancer, et une installation partielle (hook tué pendant
 *  l'extraction) sans la croire complète. package.json illisible = on ne
 *  sait pas = pas complet. */
export function productionDependenciesPresent(pluginRoot: string): boolean {
  let deps: Record<string, string>;
  try {
    const pkg = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    deps = pkg.dependencies ?? {};
  } catch {
    return false;
  }
  return Object.keys(deps).every((name) => existsSync(join(pluginRoot, "node_modules", name, "package.json")));
}

/** Marqueur de fin d'installation (backlog 52, 17/10/2026). Vit DANS
 *  node_modules : un `rm -rf node_modules` à la main l'emporte avec lui, et
 *  la réinstallation suit naturellement. */
export function dependenciesMarkerPath(pluginRoot: string): string {
  return join(pluginRoot, "node_modules", ".synapse-deps-complete");
}

/** Idempotent: a no-op on every session after the first — this is NOT
 *  re-checked against package.json/package-lock.json changing (there's no
 *  auto-update mechanism for an already-installed plugin's dependencies yet;
 *  out of scope here).
 *
 *  Backlog 52 (17/10/2026) : le test « node_modules existe » était faux.
 *  Mesuré sur la tour, le premier `npm install` d'un cache neuf (675 Mo,
 *  transformers + onnxruntime) a pris plus de 6 min 40 s DANS un hook
 *  SessionStart de 120 s. Un hook tué au milieu laissait un dossier partiel
 *  que tous les lancements suivants prenaient pour complet, à jamais. On
 *  teste donc un marqueur écrit APRÈS le retour de l'installateur : une
 *  install interrompue est reprise à la session suivante (npm réutilise ce
 *  qui est déjà extrait), jusqu'à ce qu'elle aboutisse. */
export function ensureDependencies(pluginRoot: string, install: (root: string) => void = npmInstallProd): void {
  if (existsSync(dependenciesMarkerPath(pluginRoot))) return;
  if (productionDependenciesPresent(pluginRoot)) {
    // Installée par un tiers (gestionnaire de plugins) ou terminée par une
    // session précédente tuée juste avant d'écrire le marqueur : on le pose,
    // les sessions suivantes ne relisent plus package.json.
    writeMarker(pluginRoot);
    return;
  }
  if (existsSync(join(pluginRoot, "node_modules"))) {
    console.error("synapse : installation des dépendances incomplète, reprise…");
  } else {
    console.error("synapse : première installation des dépendances (plusieurs minutes ; si le hook est interrompu, elle reprend à la prochaine session).");
  }
  install(pluginRoot);
  writeMarker(pluginRoot);
}

function writeMarker(pluginRoot: string): void {
  mkdirSync(join(pluginRoot, "node_modules"), { recursive: true });
  writeFileSync(dependenciesMarkerPath(pluginRoot), new Date().toISOString());
}

/** Derives the plugin's root directory from the currently-running compiled
 *  module's own URL — NOT from process.env.CLAUDE_PLUGIN_ROOT, whose
 *  inheritance into a spawned hook process isn't documented (see
 *  defaultLocalConfigPath's doc comment for the same reasoning applied to
 *  CLAUDE_PLUGIN_DATA). The path shape is fixed by the plugin layout itself:
 *  every CLI entrypoint compiles to <pluginRoot>/dist/commands/<name>.js. */
export function resolvePluginRoot(moduleUrl: string): string {
  return dirname(dirname(dirname(fileURLToPath(moduleUrl))));
}
