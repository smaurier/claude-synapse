import { describe, it, expect } from "vitest";
import { scanContentForPersonalData, scanFilesForPersonalData } from "../src/security/personalDataScan.js";

// Backlog 16/08 (étude de marché Synapse) — inspired by grandma's "sweater"
// test (isolation between contexts proven by a test, not a manual review),
// adapted to Synapse's real boundary: not two memory contexts at runtime,
// but two REPOS — claude-synapse (public) vs the private system. Answers a
// real gap already found once (14/08): "revue anti-données-perso avant
// premier push" only had a targeted scan, never a full re-read, per project
// memory. Same shape as secretScan.ts on purpose — same problem class
// (something that must never reach the public repo), different denylist.

describe("scanContentForPersonalData", () => {
  it("finds nothing in ordinary source/doc content", () => {
    expect(scanContentForPersonalData("Le hub git est référencé par jonction, jamais copié.")).toEqual([]);
  });

  it("flags a hardcoded Windows absolute path", () => {
    const matches = scanContentForPersonalData('const p = "C:\\\\Users\\\\alice\\\\Documents\\\\projects";');
    expect(matches.some((m) => m.pattern === "hardcoded Windows path")).toBe(true);
  });

  it("flags a hardcoded Windows absolute path with forward slashes", () => {
    const matches = scanContentForPersonalData("const p = 'C:/Users/bob/Documents';");
    expect(matches.some((m) => m.pattern === "hardcoded Windows path")).toBe(true);
  });

  it("flags a POSIX /Users/<user>/ path", () => {
    const matches = scanContentForPersonalData("path = '/Users/alice/projects/foo'");
    expect(matches.some((m) => m.pattern === "hardcoded POSIX path")).toBe(true);
  });

  it("flags a POSIX /home/<user>/ path", () => {
    const matches = scanContentForPersonalData("const h = '/home/bob/.config'");
    expect(matches.some((m) => m.pattern === "hardcoded POSIX path")).toBe(true);
  });

  it("does not flag a relative path", () => {
    expect(scanContentForPersonalData("const p = './projects/foo';")).toEqual([]);
  });

  it("reports the line number of each match", () => {
    const content = "line 1\nline 2 const p = 'C:/Users/alice/docs'\nline 3";
    const matches = scanContentForPersonalData(content);
    expect(matches[0]?.line).toBe(2);
  });
});

describe("scanFilesForPersonalData", () => {
  it("only includes files with at least one match", () => {
    const result = scanFilesForPersonalData([
      { path: "clean.ts", content: "nothing to flag here" },
      { path: "leak.ts", content: "const p = 'C:/Users/alice/Documents';" },
    ]);
    expect(Object.keys(result)).toEqual(["leak.ts"]);
  });

  it("returns an empty object when the whole tree is clean", () => {
    expect(scanFilesForPersonalData([{ path: "a.ts", content: "rien" }])).toEqual({});
  });
});
