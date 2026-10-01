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

  // Liste blanche de placeholders (01/10/2026) : le scan doit distinguer un
  // chemin de DOCUMENTATION d'une identité réelle, sinon il devient
  // impossible de documenter un chemin Windows — ce que ce projet manipule
  // pourtant en permanence.
  it("ne flague pas un nom d'utilisateur manifestement fictif (exemple)", () => {
    expect(scanContentForPersonalData('const p = "C:\\\\Users\\\\exemple\\\\Documents";')).toEqual([]);
  });

  it("ne flague pas les autres placeholders de la liste blanche", () => {
    expect(scanContentForPersonalData("C:/Users/example/Documents")).toEqual([]);
    expect(scanContentForPersonalData("C:/Users/utilisateur/Documents")).toEqual([]);
    expect(scanContentForPersonalData("/home/user/.config")).toEqual([]);
  });

  it("reste insensible à la casse du placeholder", () => {
    expect(scanContentForPersonalData("C:/Users/Exemple/Documents")).toEqual([]);
  });

  it("flague toujours un nom qui n'est PAS dans la liste blanche", () => {
    const matches = scanContentForPersonalData("C:/Users/sylva/Documents/projects");
    expect(matches.some((m) => m.pattern === "hardcoded Windows path")).toBe(true);
  });

  it("ne laisse pas un placeholder masquer une vraie fuite sur une autre ligne", () => {
    const content = "C:/Users/exemple/ok\nC:/Users/alice/secret";
    const matches = scanContentForPersonalData(content);
    // Un chemin Windows declenche AUSSI le motif POSIX (/Users/<x>/ est
    // contenu dedans) : on verifie donc que TOUTES les detections sont sur la
    // ligne 2, pas leur nombre.
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.line === 2)).toBe(true);
    expect(matches[0]?.line).toBe(2);
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
