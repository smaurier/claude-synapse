/**
 * A plugin installed the way `claude plugin marketplace add` +
 * `claude plugin install` actually work — confirmed 24/08 on two real
 * installs (LR and sylva) — is a plain `git clone`: no `npm install`, no
 * build step runs automatically. Committing dist/ (a packaging decision,
 * not code) solves half of that; this solves the other half, for the one
 * real npm dependency (@huggingface/transformers) this plugin has at
 * runtime. Rather than documenting "run npm install once after installing"
 * somewhere a fresh user would have to already know to look, the hooks that
 * run unattended (SessionStart/PostCompact/SessionEnd) self-heal on first
 * real invocation.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
/** The real installer, used everywhere except tests (which inject a fake). */
export function npmInstallProd(pluginRoot) {
    execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
        cwd: pluginRoot,
        stdio: "inherit",
    });
}
/** Idempotent: a no-op on every session after the first, since node_modules
 *  then already exists — this is NOT re-checked against package.json/
 *  package-lock.json changing (there's no auto-update mechanism for an
 *  already-installed plugin's dependencies yet; out of scope here). */
export function ensureDependencies(pluginRoot, install = npmInstallProd) {
    if (existsSync(join(pluginRoot, "node_modules")))
        return;
    install(pluginRoot);
}
/** Derives the plugin's root directory from the currently-running compiled
 *  module's own URL — NOT from process.env.CLAUDE_PLUGIN_ROOT, whose
 *  inheritance into a spawned hook process isn't documented (see
 *  defaultLocalConfigPath's doc comment for the same reasoning applied to
 *  CLAUDE_PLUGIN_DATA). The path shape is fixed by the plugin layout itself:
 *  every CLI entrypoint compiles to <pluginRoot>/dist/commands/<name>.js. */
export function resolvePluginRoot(moduleUrl) {
    return dirname(dirname(dirname(fileURLToPath(moduleUrl))));
}
//# sourceMappingURL=dependencies.js.map