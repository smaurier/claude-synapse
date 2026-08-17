import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHubGitignore } from "../src/config/hubGitignore.js";

let hubDir: string;

beforeEach(() => {
  hubDir = mkdtempSync(join(tmpdir(), "synapse-gitignore-"));
});

afterEach(() => {
  rmSync(hubDir, { recursive: true, force: true });
});

describe("ensureHubGitignore", () => {
  it("creates .gitignore with the required lines when none exists", () => {
    const wrote = ensureHubGitignore(hubDir);
    expect(wrote).toBe(true);
    const content = readFileSync(join(hubDir, ".gitignore"), "utf8");
    expect(content).toContain(".synapse/index.sqlite");
    expect(content).toContain(".synapse/.sync-lock");
  });

  it("is idempotent — a second call is a no-op", () => {
    ensureHubGitignore(hubDir);
    const wroteAgain = ensureHubGitignore(hubDir);
    expect(wroteAgain).toBe(false);
  });

  it("preserves an existing .gitignore's own lines and only appends what's missing", () => {
    writeFileSync(join(hubDir, ".gitignore"), "*.log\n.synapse/index.sqlite\n", "utf8");
    ensureHubGitignore(hubDir);
    const content = readFileSync(join(hubDir, ".gitignore"), "utf8");
    expect(content).toContain("*.log");
    expect(content).toContain(".synapse/.sync-lock"); // the missing one, appended
  });
});
