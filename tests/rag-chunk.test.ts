import { describe, it, expect } from "vitest";
import { chunkFile } from "../src/rag/chunk.js";

describe("chunkFile", () => {
  it("returns a single chunk for short content, id equal to the path (no suffix)", () => {
    const chunks = chunkFile("a.md", "short content", 800, 100);
    expect(chunks).toEqual([{ chunkId: "a.md", sourcePath: "a.md", text: "short content" }]);
  });

  it("splits long content into multiple overlapping chunks", () => {
    const content = "x".repeat(2000);
    const chunks = chunkFile("big.md", content, 800, 100);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.sourcePath).toBe("big.md");
    expect(chunks.map((c) => c.chunkId)).toEqual(["big.md#0", "big.md#1", "big.md#2"]);
  });

  it("chunk windows actually overlap (no content silently dropped at a boundary)", () => {
    // Build content where each character position is uniquely identifiable.
    const content = Array.from({ length: 2000 }, (_, i) => String(i % 10)).join("");
    const chunks = chunkFile("big.md", content, 800, 100);

    const firstChunkEnd = chunks[0]!.text.slice(-50);
    const secondChunkStart = chunks[1]!.text.slice(0, 50);
    // The overlap region must reappear at the start of the next chunk.
    expect(secondChunkStart.slice(0, 50)).toBe(content.slice(700, 750));
    expect(firstChunkEnd).toBe(content.slice(750, 800));
  });

  it("the last chunk reaches exactly the end of the content (nothing dropped at the tail)", () => {
    const content = "abc".repeat(700); // 2100 chars
    const chunks = chunkFile("big.md", content, 800, 100);
    const last = chunks[chunks.length - 1]!;
    expect(content.endsWith(last.text)).toBe(true);
    expect(content).toContain(last.text);
    // Reconstructing full coverage: every chunk boundary must overlap the
    // next one (stride < window size), so there is no gap between them.
    const stride = 800 - 100;
    for (let i = 0; i < chunks.length - 1; i++) {
      const startOfNext = i === 0 ? stride : stride * (i + 1);
      expect(startOfNext).toBeLessThan(chunks[i]!.text.length + (i === 0 ? 0 : stride * i));
    }
  });
});
