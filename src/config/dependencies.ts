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

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/** The real installer, used everywhere except tests (which inject a fake). */
export function npmInstallProd(pluginRoot: string): void {
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: pluginRoot,
    stdio: "inherit",
  });
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
  if (existsSync(join(pluginRoot, "node_modules"))) {
    console.error("synapse : installation des dépendances interrompue précédemment, reprise…");
  } else {
    console.error("synapse : première installation des dépendances (plusieurs minutes ; si le hook est interrompu, elle reprend à la prochaine session).");
  }
  install(pluginRoot);
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
