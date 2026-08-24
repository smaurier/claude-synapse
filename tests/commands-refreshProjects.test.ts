import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshProjects, ensureCurrentProjectLinked } from "../src/commands/refreshProjects.js";
import { inspectLink } from "../src/jonction/jonction.js";

let root: string;
let hubDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "synapse-refresh-projects-"));
  hubDir = join(root, "hub");
  mkdirSync(hubDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("refreshProjects", () => {
  it("links memory for every subdirectory that has a .claude/ marker", () => {
    mkdirSync(join(root, "projet-a", ".claude"), { recursive: true });
    mkdirSync(join(root, "projet-b", ".claude"), { recursive: true });

    const results = refreshProjects(root, hubDir);

    // Only the two real projects, not "hub" itself (no .claude/ marker there).
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.link.action === "created")).toBe(true);
    expect(inspectLink(join(root, "projet-a", ".claude", "memory"), hubDir)).toBe("ok");
  });

  it("skips directories without a .claude/ marker", () => {
    mkdirSync(join(root, "pas-un-projet"), { recursive: true });
    expect(refreshProjects(root, hubDir)).toEqual([]);
  });

  it("respects the exclusions list", () => {
    mkdirSync(join(root, "projet-a", ".claude"), { recursive: true });
    mkdirSync(join(root, "archive", ".claude"), { recursive: true });

    const results = refreshProjects(root, hubDir, ["archive"]);

    expect(results.map((r) => r.projectDir)).toEqual([join(root, "projet-a")]);
  });

  it("is idempotent — a second pass reports already-ok, not errors", () => {
    mkdirSync(join(root, "projet-a", ".claude"), { recursive: true });
    refreshProjects(root, hubDir);

    const second = refreshProjects(root, hubDir);
    expect(second[0]?.link.action).toBe("already-ok");
  });
});

describe("ensureCurrentProjectLinked", () => {
  it("links the given project's .claude/memory to the hub", () => {
    const projectDir = join(root, "mon-projet");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });

    const result = ensureCurrentProjectLinked(projectDir, hubDir);

    expect(result.action).toBe("created");
    expect(inspectLink(join(projectDir, ".claude", "memory"), hubDir)).toBe("ok");
  });

  it("works on a genuinely brand-new project — .claude/ doesn't exist yet at all", () => {
    // The actual "zero action required" case this function exists for
    // (DESIGN.md decision #6: "a brand-new project gets linked
    // automatically at session start"), found missing 24/08 by running the
    // real SessionStart hook end-to-end rather than only the unit tests —
    // every existing test here (including the one right above) pre-creates
    // .claude/ first, masking that createLink() never creates linkPath's
    // own parent directory.
    const projectDir = join(root, "projet-jamais-ouvert-avant");
    mkdirSync(projectDir, { recursive: true }); // the project itself exists, .claude/ does not

    const result = ensureCurrentProjectLinked(projectDir, hubDir);

    expect(result.action).toBe("created");
    expect(inspectLink(join(projectDir, ".claude", "memory"), hubDir)).toBe("ok");
  });
});
