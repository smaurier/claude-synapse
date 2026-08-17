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

  it("flags the employer email domain", () => {
    const matches = scanContentForPersonalData("git config user.email sylvain.maurier@lrtechnologies.fr");
    expect(matches.some((m) => m.pattern === "domaine email employeur")).toBe(true);
  });

  it("flags a hardcoded personal Windows home path", () => {
    const matches = scanContentForPersonalData('const p = "C:\\\\Users\\\\sylva\\\\Documents\\\\projects";');
    expect(matches.some((m) => m.pattern === "chemin personnel réel")).toBe(true);
  });

  it("flags a hardcoded personal Windows home path (the other machine)", () => {
    const matches = scanContentForPersonalData('const p = "C:\\\\Users\\\\lrtechnologies\\\\Documents";');
    expect(matches.some((m) => m.pattern === "chemin personnel réel")).toBe(true);
  });

  it("flags a POSIX-style personal home path too", () => {
    const matches = scanContentForPersonalData("path = '/Users/sylva/projects/foo'");
    expect(matches.some((m) => m.pattern === "chemin personnel réel")).toBe(true);
  });

  it("flags a bare first-name mention (found as a real leak 14/08 — code comments naming the author directly)", () => {
    const matches = scanContentForPersonalData("// Sylvain a demandé ce comportement le 14/08");
    expect(matches.some((m) => m.pattern === "prénom en clair")).toBe(true);
  });

  it("does not flag 'sylvain' as a substring of an unrelated identifier", () => {
    // word-boundary aware, same lesson learned building findExactMatches
    // (hybridSearch.ts) — a bare substring check produced real false
    // positives there ("LEP" inside "FilePath").
    expect(scanContentForPersonalData("const sylvainesque = false;")).toEqual([]);
  });

  it("reports the line number of each match", () => {
    const content = "ligne 1\nligne 2 avec sylvain.maurier@lrtechnologies.fr\nligne 3";
    const matches = scanContentForPersonalData(content);
    expect(matches[0]?.line).toBe(2);
  });
});

describe("scanFilesForPersonalData", () => {
  it("only includes files with at least one match", () => {
    const result = scanFilesForPersonalData([
      { path: "clean.ts", content: "rien à signaler" },
      { path: "leak.ts", content: "// contact: sylvain.maurier@lrtechnologies.fr" },
    ]);
    expect(Object.keys(result)).toEqual(["leak.ts"]);
  });

  it("returns an empty object when the whole tree is clean", () => {
    expect(scanFilesForPersonalData([{ path: "a.ts", content: "rien" }])).toEqual({});
  });
});
