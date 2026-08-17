import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSessionResults } from "../src/commands/sessionResults.js";
import { buildPostCompactOutput } from "../src/commands/postCompact.js";

let pluginDataDir: string;

beforeEach(() => {
  pluginDataDir = mkdtempSync(join(tmpdir(), "synapse-postcompact-"));
});

afterEach(() => {
  rmSync(pluginDataDir, { recursive: true, force: true });
});

describe("buildPostCompactOutput", () => {
  it("returns additionalContext when this session had search results", () => {
    writeSessionResults(pluginDataDir, "s1", "format de date", [{ path: "new.md", score: 1, matchType: "exact" }]);

    const output = buildPostCompactOutput(pluginDataDir, "s1");

    expect(output.additionalContext).toContain("new.md");
  });

  it("returns an empty object (no additionalContext key) when this session never searched anything — never invents content", () => {
    const output = buildPostCompactOutput(pluginDataDir, "never-searched");
    expect(output).toEqual({});
  });

  it("does not leak another session's results", () => {
    writeSessionResults(pluginDataDir, "s1", "requête s1", [{ path: "a.md", score: 1, matchType: "exact" }]);

    expect(buildPostCompactOutput(pluginDataDir, "s2")).toEqual({});
  });
});
