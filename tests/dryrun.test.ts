import { describe, it, expect } from "vitest";
import { parseGitStatusPorcelain } from "../src/lock/dryrun.js";

describe("parseGitStatusPorcelain", () => {
  it("parses an empty status as no changes", () => {
    expect(parseGitStatusPorcelain("")).toEqual([]);
  });

  it("parses added, modified and deleted entries", () => {
    const porcelain = ["A  memory/new-file.md", " M memory/edited-file.md", " D memory/gone.md"].join("\n");
    const changes = parseGitStatusPorcelain(porcelain);
    expect(changes).toEqual([
      { status: "added", path: "memory/new-file.md" },
      { status: "modified", path: "memory/edited-file.md" },
      { status: "deleted", path: "memory/gone.md" },
    ]);
  });

  it("parses untracked entries", () => {
    const changes = parseGitStatusPorcelain("?? memory/scratch.md");
    expect(changes).toEqual([{ status: "untracked", path: "memory/scratch.md" }]);
  });
});
