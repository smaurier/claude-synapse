import { describe, it, expect } from "vitest";
import { resolveCitedPath } from "../src/commands/citedCodeDrift.js";

describe("resolveCitedPath", () => {
  it("splits a cites value into a registered project root and the relative path within it", () => {
    const roots = { "claude-synapse": "C:\\Users\\exemple\\Documents\\projects\\claude-synapse" };
    const resolved = resolveCitedPath("claude-synapse/src/commands/brainLint.ts", roots);
    expect(resolved).toEqual({
      root: "C:\\Users\\exemple\\Documents\\projects\\claude-synapse",
      relativePath: "src/commands/brainLint.ts",
    });
  });

  it("returns null when the named project isn't registered on this machine", () => {
    expect(resolveCitedPath("un-projet-inconnu/src/x.ts", { "claude-synapse": "/a" })).toBeNull();
  });

  it("returns null for a cites value with no path component at all", () => {
    expect(resolveCitedPath("claude-synapse", { "claude-synapse": "/a" })).toBeNull();
  });

  it("handles a nested relative path correctly (only the first segment is the project name)", () => {
    const roots = { proj: "/root" };
    expect(resolveCitedPath("proj/a/b/c.ts", roots)).toEqual({ root: "/root", relativePath: "a/b/c.ts" });
  });
});
