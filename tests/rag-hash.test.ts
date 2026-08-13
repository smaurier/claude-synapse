import { describe, it, expect } from "vitest";
import { computeCorpusFingerprint } from "../src/rag/hash.js";

describe("computeCorpusFingerprint", () => {
  it("is stable for the same content", () => {
    const files = [{ path: "a.md", content: "hello" }];
    expect(computeCorpusFingerprint(files)).toBe(computeCorpusFingerprint(files));
  });

  it("changes when a file's content changes", () => {
    const before = [{ path: "a.md", content: "hello" }];
    const after = [{ path: "a.md", content: "hello world" }];
    expect(computeCorpusFingerprint(before)).not.toBe(computeCorpusFingerprint(after));
  });

  it("changes when a file is added or removed", () => {
    const one = [{ path: "a.md", content: "hello" }];
    const two = [
      { path: "a.md", content: "hello" },
      { path: "b.md", content: "new" },
    ];
    expect(computeCorpusFingerprint(one)).not.toBe(computeCorpusFingerprint(two));
  });

  it("is independent of file ordering (same set, different order -> same fingerprint)", () => {
    const a = [
      { path: "a.md", content: "1" },
      { path: "b.md", content: "2" },
    ];
    const b = [
      { path: "b.md", content: "2" },
      { path: "a.md", content: "1" },
    ];
    expect(computeCorpusFingerprint(a)).toBe(computeCorpusFingerprint(b));
  });
});
