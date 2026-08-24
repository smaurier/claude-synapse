import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureDependencies, resolvePluginRoot } from "../src/config/dependencies.js";

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
  rmSync(root, { recursive: true, force: true });
});

describe("ensureDependencies", () => {
  it("runs the install when node_modules is absent", () => {
    const install = vi.fn();

    ensureDependencies(root, install);

    expect(install).toHaveBeenCalledWith(root);
  });

  it("does nothing when node_modules already exists — never reinstalls on every session", () => {
    mkdirSync(join(root, "node_modules"), { recursive: true });
    const install = vi.fn();

    ensureDependencies(root, install);

    expect(install).not.toHaveBeenCalled();
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
